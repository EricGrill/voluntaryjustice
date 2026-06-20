const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * Coverage-focused suite for EnforcementEngine. Exercises the full escrow
 * release flow (partial + full collection), every status guard on
 * executeFromEscrow / recordPayment / triggerInsuranceClaim / markAppealed /
 * markFailed, and the createEnforcement require branches.
 */
describe("EnforcementEngine — Coverage", function () {
  let enforcementEngine, disputeResolution, escrowVault, reputationScoring, insurancePool;
  let contractFactory, templateRegistry, courtRegistry, vjToken;
  let owner, courtOperator, party1, party2, executor, outsider;

  const EVIDENCE_PERIOD = 7 * 24 * 60 * 60;

  beforeEach(async function () {
    [owner, courtOperator, party1, party2, executor, outsider] = await ethers.getSigners();

    const VJToken = await ethers.getContractFactory("VJToken");
    vjToken = await VJToken.deploy(owner.address);

    const ReputationScoring = await ethers.getContractFactory("ReputationScoring");
    reputationScoring = await ReputationScoring.deploy(owner.address);

    const ContractTemplateRegistry = await ethers.getContractFactory("ContractTemplateRegistry");
    templateRegistry = await ContractTemplateRegistry.deploy(owner.address);

    const ContractFactory = await ethers.getContractFactory("ContractFactory");
    contractFactory = await ContractFactory.deploy(
      owner.address,
      await templateRegistry.getAddress(),
      await reputationScoring.getAddress()
    );

    const CourtRegistry = await ethers.getContractFactory("CourtRegistry");
    courtRegistry = await CourtRegistry.deploy(owner.address, await vjToken.getAddress());

    const DisputeResolution = await ethers.getContractFactory("DisputeResolution");
    disputeResolution = await DisputeResolution.deploy(
      owner.address,
      await contractFactory.getAddress(),
      await courtRegistry.getAddress(),
      await reputationScoring.getAddress(),
      await vjToken.getAddress()
    );

    const EscrowVault = await ethers.getContractFactory("EscrowVault");
    escrowVault = await EscrowVault.deploy(owner.address);

    const BaselineInsurancePool = await ethers.getContractFactory("BaselineInsurancePool");
    insurancePool = await BaselineInsurancePool.deploy(
      owner.address,
      await vjToken.getAddress(),
      await disputeResolution.getAddress()
    );

    const EnforcementEngine = await ethers.getContractFactory("EnforcementEngine");
    enforcementEngine = await EnforcementEngine.deploy(
      owner.address,
      await disputeResolution.getAddress(),
      await escrowVault.getAddress(),
      await reputationScoring.getAddress(),
      await insurancePool.getAddress()
    );

    const AUTHORIZED_CONTRACT_ROLE = await reputationScoring.AUTHORIZED_CONTRACT_ROLE();
    await reputationScoring.grantRole(AUTHORIZED_CONTRACT_ROLE, await contractFactory.getAddress());
    await reputationScoring.grantRole(AUTHORIZED_CONTRACT_ROLE, await disputeResolution.getAddress());

    const SYSTEM_ROLE = await contractFactory.SYSTEM_ROLE();
    await contractFactory.grantRole(SYSTEM_ROLE, await disputeResolution.getAddress());

    const DR_SYSTEM_ROLE = await disputeResolution.SYSTEM_ROLE();
    await disputeResolution.grantRole(DR_SYSTEM_ROLE, await enforcementEngine.getAddress());

    const ENFORCEMENT_ROLE = await escrowVault.ENFORCEMENT_ROLE();
    await escrowVault.grantRole(ENFORCEMENT_ROLE, await enforcementEngine.getAddress());

    const EXECUTOR_ROLE = await enforcementEngine.EXECUTOR_ROLE();
    await enforcementEngine.grantRole(EXECUTOR_ROLE, executor.address);

    await vjToken.mint(courtOperator.address, ethers.parseEther("10000"));
    await vjToken.connect(courtOperator).approve(await courtRegistry.getAddress(), ethers.MaxUint256);
    await courtRegistry.connect(courtOperator).registerCourt(
      "Test Court",
      ethers.parseEther("1000"),
      ethers.keccak256(ethers.toUtf8Bytes("rules"))
    );

    await templateRegistry.registerTemplate(
      ethers.keccak256(ethers.toUtf8Bytes("template")),
      "Test Template",
      courtOperator.address,
      0
    );

    await contractFactory.createContract(
      1,
      ethers.keccak256(ethers.toUtf8Bytes("params")),
      [party1.address, party2.address],
      ethers.parseEther("1")
    );
    await contractFactory.connect(party1).signContract(1);
    await contractFactory.connect(party2).signContract(1);
  });

  // Drive dispute 1 to Finalized with party2 liable, restitution = `amount`.
  async function createFinalizedDispute(amount = ethers.parseEther("0.5")) {
    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("evidence"));
    await disputeResolution.connect(party1).fileDispute(1, "Breach", evidenceHash);
    await time.increase(EVIDENCE_PERIOD + 1);
    await disputeResolution.endEvidencePeriod(1);
    await disputeResolution.connect(courtOperator).submitRuling(
      1, party2.address, amount, ethers.toUtf8Bytes("Pay damages")
    );
    await disputeResolution.finalizeDispute(1);
  }

  describe("createEnforcement require branches", function () {
    it("rejects when the dispute is not finalized", async function () {
      const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("e"));
      await disputeResolution.connect(party1).fileDispute(1, "Breach", evidenceHash);
      await expect(enforcementEngine.createEnforcement(1))
        .to.be.revertedWith("Dispute not finalized");
    });

    it("rejects when there is no liable party (no ruling against a party)", async function () {
      const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("e"));
      await disputeResolution.connect(party1).fileDispute(1, "Breach", evidenceHash);
      await time.increase(EVIDENCE_PERIOD + 1);
      await disputeResolution.endEvidencePeriod(1);
      // ruling with zero-address liable -> hasRuling true but liable == 0
      await disputeResolution.connect(courtOperator).submitRuling(
        1, ethers.ZeroAddress, 0, ethers.toUtf8Bytes("none")
      );
      await disputeResolution.finalizeDispute(1);
      await expect(enforcementEngine.createEnforcement(1))
        .to.be.revertedWith("No liable party");
    });

    it("sets beneficiary to the claimant when the respondent is liable", async function () {
      await createFinalizedDispute();
      await enforcementEngine.createEnforcement(1);
      const action = await enforcementEngine.getAction(1);
      // party2 (respondent) liable -> beneficiary is party1 (claimant)
      expect(action.liable).to.equal(party2.address);
      expect(action.beneficiary).to.equal(party1.address);
      expect(action.status).to.equal(0); // Pending
    });
  });

  describe("executeFromEscrow", function () {
    beforeEach(async function () {
      await createFinalizedDispute(ethers.parseEther("0.5"));
      await enforcementEngine.createEnforcement(1);
    });

    it("rejects an action that does not exist", async function () {
      await expect(enforcementEngine.connect(executor).executeFromEscrow(999))
        .to.be.revertedWith("Action does not exist");
    });

    it("rejects a non-executor caller", async function () {
      await expect(enforcementEngine.connect(outsider).executeFromEscrow(1))
        .to.be.reverted;
    });

    it("is a no-op when the escrow balance is zero (status stays Pending)", async function () {
      await enforcementEngine.connect(executor).executeFromEscrow(1);
      const action = await enforcementEngine.getAction(1);
      expect(action.status).to.equal(0); // still Pending, no release
      expect(action.amountCollected).to.equal(0);
    });

    it("releases a partial amount when escrow < restitution (capped at escrow balance)", async function () {
      // Deposit 0.3 ETH escrow for contractId 1; restitution is 0.5
      await escrowVault.connect(party2).deposit(1, { value: ethers.parseEther("0.3") });

      const beneBefore = await ethers.provider.getBalance(party1.address);
      await enforcementEngine.connect(executor).executeFromEscrow(1);
      const beneAfter = await ethers.provider.getBalance(party1.address);

      expect(beneAfter - beneBefore).to.equal(ethers.parseEther("0.3"));
      const action = await enforcementEngine.getAction(1);
      expect(action.amountCollected).to.equal(ethers.parseEther("0.3"));
      expect(action.status).to.equal(1); // InProgress (not fully collected)
    });

    it("releases only the remaining restitution when escrow > restitution (capped at owed amount)", async function () {
      // Deposit 2 ETH escrow; only 0.5 owed should be released
      await escrowVault.connect(party2).deposit(1, { value: ethers.parseEther("2") });

      const beneBefore = await ethers.provider.getBalance(party1.address);
      await enforcementEngine.connect(executor).executeFromEscrow(1);
      const beneAfter = await ethers.provider.getBalance(party1.address);

      expect(beneAfter - beneBefore).to.equal(ethers.parseEther("0.5"));
      const action = await enforcementEngine.getAction(1);
      expect(action.amountCollected).to.equal(ethers.parseEther("0.5"));
      expect(action.status).to.equal(2); // Completed
      expect(action.completedAt).to.be.greaterThan(0);
    });

    it("rejects re-execution once the action is Completed", async function () {
      await escrowVault.connect(party2).deposit(1, { value: ethers.parseEther("1") });
      await enforcementEngine.connect(executor).executeFromEscrow(1);
      expect((await enforcementEngine.getAction(1)).status).to.equal(2);
      await expect(enforcementEngine.connect(executor).executeFromEscrow(1))
        .to.be.revertedWith("Cannot execute");
    });

    it("supports a second execution from InProgress to finish collection", async function () {
      await escrowVault.connect(party2).deposit(1, { value: ethers.parseEther("0.3") });
      await enforcementEngine.connect(executor).executeFromEscrow(1); // collects 0.3, InProgress
      // top up escrow and execute again to finish the remaining 0.2
      await escrowVault.connect(party2).deposit(1, { value: ethers.parseEther("0.5") });
      await enforcementEngine.connect(executor).executeFromEscrow(1);
      const action = await enforcementEngine.getAction(1);
      expect(action.amountCollected).to.equal(ethers.parseEther("0.5"));
      expect(action.status).to.equal(2); // Completed
    });
  });

  describe("recordPayment status guards", function () {
    beforeEach(async function () {
      await createFinalizedDispute();
      await enforcementEngine.createEnforcement(1);
    });

    it("rejects a non-existent action", async function () {
      await expect(enforcementEngine.connect(executor).recordPayment(999, 1))
        .to.be.revertedWith("Action does not exist");
    });

    it("rejects recording once the action is Completed", async function () {
      await enforcementEngine.connect(executor).recordPayment(1, ethers.parseEther("0.5")); // completes
      expect((await enforcementEngine.getAction(1)).status).to.equal(2);
      await expect(enforcementEngine.connect(executor).recordPayment(1, 1))
        .to.be.revertedWith("Cannot record payment");
    });

    it("records compliance and moves to InProgress on a partial payment", async function () {
      await enforcementEngine.connect(executor).recordPayment(1, ethers.parseEther("0.2"));
      const action = await enforcementEngine.getAction(1);
      expect(action.amountCollected).to.equal(ethers.parseEther("0.2"));
      expect(action.status).to.equal(1); // InProgress
    });
  });

  describe("triggerInsuranceClaim status guards", function () {
    beforeEach(async function () {
      await createFinalizedDispute();
      await enforcementEngine.createEnforcement(1);
    });

    it("rejects a non-existent action", async function () {
      await expect(enforcementEngine.connect(executor).triggerInsuranceClaim(999))
        .to.be.revertedWith("Action does not exist");
    });

    it("rejects an action still in Pending status", async function () {
      // no payment recorded yet -> still Pending
      await expect(enforcementEngine.connect(executor).triggerInsuranceClaim(1))
        .to.be.revertedWith("Invalid status for insurance");
    });

    it("succeeds from the Failed status", async function () {
      await enforcementEngine.connect(executor).markFailed(1, "no funds");
      await expect(enforcementEngine.connect(executor).triggerInsuranceClaim(1))
        .to.emit(enforcementEngine, "InsuranceClaimTriggered").withArgs(1);
      expect((await enforcementEngine.getAction(1)).insuranceClaimed).to.be.true;
    });

    it("rejects a duplicate insurance claim", async function () {
      await enforcementEngine.connect(executor).recordPayment(1, ethers.parseEther("0.1"));
      await enforcementEngine.connect(executor).triggerInsuranceClaim(1);
      await expect(enforcementEngine.connect(executor).triggerInsuranceClaim(1))
        .to.be.revertedWith("Insurance already claimed");
    });
  });

  describe("markAppealed status guards", function () {
    beforeEach(async function () {
      await createFinalizedDispute();
      await enforcementEngine.createEnforcement(1);
    });

    it("rejects a non-existent action", async function () {
      await expect(enforcementEngine.connect(executor).markAppealed(999))
        .to.be.revertedWith("Action does not exist");
    });

    it("rejects appealing a Completed action", async function () {
      await enforcementEngine.connect(executor).recordPayment(1, ethers.parseEther("0.5"));
      await expect(enforcementEngine.connect(executor).markAppealed(1))
        .to.be.revertedWith("Cannot appeal");
    });

    it("appeals from InProgress", async function () {
      await enforcementEngine.connect(executor).recordPayment(1, ethers.parseEther("0.1"));
      await enforcementEngine.connect(executor).markAppealed(1);
      expect((await enforcementEngine.getAction(1)).status).to.equal(4); // Appealed
    });
  });

  describe("markFailed status guards", function () {
    beforeEach(async function () {
      await createFinalizedDispute();
      await enforcementEngine.createEnforcement(1);
    });

    it("rejects a non-existent action", async function () {
      await expect(enforcementEngine.connect(executor).markFailed(999, "x"))
        .to.be.revertedWith("Action does not exist");
    });

    it("rejects marking a Completed action as failed", async function () {
      await enforcementEngine.connect(executor).recordPayment(1, ethers.parseEther("0.5"));
      await expect(enforcementEngine.connect(executor).markFailed(1, "x"))
        .to.be.revertedWith("Already completed");
    });

    it("rejects a non-executor caller", async function () {
      await expect(enforcementEngine.connect(outsider).markFailed(1, "x")).to.be.reverted;
    });
  });

  describe("view helpers", function () {
    it("getActionByDispute returns 0 for a dispute without enforcement", async function () {
      expect(await enforcementEngine.getActionByDispute(42)).to.equal(0);
    });
  });
});
