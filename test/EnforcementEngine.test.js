const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("EnforcementEngine", function () {
  let enforcementEngine, disputeResolution, escrowVault, reputationScoring, insurancePool;
  let contractFactory, templateRegistry, courtRegistry, vjToken;
  let owner, courtOperator, party1, party2;

  const EVIDENCE_PERIOD = 7 * 24 * 60 * 60;
  const RULING_PERIOD = 14 * 24 * 60 * 60;
  const APPEAL_PERIOD = 7 * 24 * 60 * 60;

  beforeEach(async function () {
    [owner, courtOperator, party1, party2] = await ethers.getSigners();

    // Deploy VJToken
    const VJToken = await ethers.getContractFactory("VJToken");
    vjToken = await VJToken.deploy(owner.address);

    // Deploy ReputationScoring
    const ReputationScoring = await ethers.getContractFactory("ReputationScoring");
    reputationScoring = await ReputationScoring.deploy(owner.address);

    // Deploy TemplateRegistry
    const ContractTemplateRegistry = await ethers.getContractFactory("ContractTemplateRegistry");
    templateRegistry = await ContractTemplateRegistry.deploy(owner.address);

    // Deploy ContractFactory
    const ContractFactory = await ethers.getContractFactory("ContractFactory");
    contractFactory = await ContractFactory.deploy(
      owner.address,
      await templateRegistry.getAddress(),
      await reputationScoring.getAddress()
    );

    // Deploy CourtRegistry
    const CourtRegistry = await ethers.getContractFactory("CourtRegistry");
    courtRegistry = await CourtRegistry.deploy(owner.address, await vjToken.getAddress());

    // Deploy DisputeResolution
    const DisputeResolution = await ethers.getContractFactory("DisputeResolution");
    disputeResolution = await DisputeResolution.deploy(
      owner.address,
      await contractFactory.getAddress(),
      await courtRegistry.getAddress(),
      await reputationScoring.getAddress(),
      await vjToken.getAddress()
    );

    // Deploy EscrowVault
    const EscrowVault = await ethers.getContractFactory("EscrowVault");
    escrowVault = await EscrowVault.deploy(owner.address);

    // Deploy BaselineInsurancePool
    const BaselineInsurancePool = await ethers.getContractFactory("BaselineInsurancePool");
    insurancePool = await BaselineInsurancePool.deploy(
      owner.address,
      await vjToken.getAddress(),
      await disputeResolution.getAddress()
    );

    // Deploy EnforcementEngine
    const EnforcementEngine = await ethers.getContractFactory("EnforcementEngine");
    enforcementEngine = await EnforcementEngine.deploy(
      owner.address,
      await disputeResolution.getAddress(),
      await escrowVault.getAddress(),
      await reputationScoring.getAddress(),
      await insurancePool.getAddress()
    );

    // Setup roles
    const AUTHORIZED_CONTRACT_ROLE = await reputationScoring.AUTHORIZED_CONTRACT_ROLE();
    await reputationScoring.grantRole(AUTHORIZED_CONTRACT_ROLE, await contractFactory.getAddress());
    await reputationScoring.grantRole(AUTHORIZED_CONTRACT_ROLE, await disputeResolution.getAddress());

    const SYSTEM_ROLE = await contractFactory.SYSTEM_ROLE();
    await contractFactory.grantRole(SYSTEM_ROLE, await disputeResolution.getAddress());

    const DR_SYSTEM_ROLE = await disputeResolution.SYSTEM_ROLE();
    await disputeResolution.grantRole(DR_SYSTEM_ROLE, await enforcementEngine.getAddress());

    const ENFORCEMENT_ROLE = await escrowVault.ENFORCEMENT_ROLE();
    await escrowVault.grantRole(ENFORCEMENT_ROLE, await enforcementEngine.getAddress());

    // Setup court
    await vjToken.mint(courtOperator.address, ethers.parseEther("10000"));
    await vjToken.connect(courtOperator).approve(await courtRegistry.getAddress(), ethers.MaxUint256);
    await courtRegistry.connect(courtOperator).registerCourt(
      "Test Court",
      ethers.parseEther("1000"),
      ethers.keccak256(ethers.toUtf8Bytes("rules"))
    );

    // Setup template
    await templateRegistry.registerTemplate(
      ethers.keccak256(ethers.toUtf8Bytes("template")),
      "Test Template",
      courtOperator.address,
      0  // TemplateCategory.General
    );

    // Create and activate contract
    await contractFactory.createContract(
      1,
      ethers.keccak256(ethers.toUtf8Bytes("params")),
      [party1.address, party2.address],
      ethers.parseEther("1")
    );
    await contractFactory.connect(party1).signContract(1);
    await contractFactory.connect(party2).signContract(1);
  });

  async function createFinalizedDispute() {
    const claim = "Breach of contract";
    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("evidence"));

    await disputeResolution.connect(party1).fileDispute(1, claim, evidenceHash);
    await time.increase(EVIDENCE_PERIOD + 1);
    await disputeResolution.endEvidencePeriod(1);

    await disputeResolution.connect(courtOperator).submitRuling(
      1,
      party2.address,
      ethers.parseEther("0.5"),
      ethers.toUtf8Bytes("Pay damages")
    );

    await disputeResolution.finalizeDispute(1);
  }

  describe("Deployment", function () {
    it("Should set correct dispute resolution", async function () {
      expect(await enforcementEngine.disputeResolution()).to.equal(await disputeResolution.getAddress());
    });

    it("Should set correct escrow vault", async function () {
      expect(await enforcementEngine.escrowVault()).to.equal(await escrowVault.getAddress());
    });

    it("Should start with zero actions", async function () {
      expect(await enforcementEngine.totalActions()).to.equal(0);
    });
  });

  describe("Enforcement Creation", function () {
    beforeEach(async function () {
      await createFinalizedDispute();
    });

    it("Should create enforcement action", async function () {
      await enforcementEngine.createEnforcement(1);
      const action = await enforcementEngine.getAction(1);
      expect(action.disputeId).to.equal(1);
      expect(action.liable).to.equal(party2.address);
    });

    it("Should emit EnforcementCreated event", async function () {
      await expect(enforcementEngine.createEnforcement(1))
        .to.emit(enforcementEngine, "EnforcementCreated")
        .withArgs(1, 1);
    });

    it("Should reject duplicate enforcement", async function () {
      await enforcementEngine.createEnforcement(1);
      await expect(
        enforcementEngine.createEnforcement(1)
      ).to.be.revertedWith("Enforcement already exists");
    });
  });

  describe("Payment Recording", function () {
    beforeEach(async function () {
      await createFinalizedDispute();
      await enforcementEngine.createEnforcement(1);
    });

    it("Should record payment", async function () {
      await enforcementEngine.recordPayment(1, ethers.parseEther("0.25"));
      const action = await enforcementEngine.getAction(1);
      expect(action.amountCollected).to.equal(ethers.parseEther("0.25"));
      expect(action.status).to.equal(1); // InProgress
    });

    it("Should emit EnforcementProgress event", async function () {
      await expect(enforcementEngine.recordPayment(1, ethers.parseEther("0.25")))
        .to.emit(enforcementEngine, "EnforcementProgress");
    });

    it("Should complete enforcement when fully paid", async function () {
      await enforcementEngine.recordPayment(1, ethers.parseEther("0.5"));
      const action = await enforcementEngine.getAction(1);
      expect(action.status).to.equal(2); // Completed
    });

    it("Should reject recording from non-executor", async function () {
      await expect(
        enforcementEngine.connect(party1).recordPayment(1, ethers.parseEther("0.25"))
      ).to.be.reverted;
    });
  });

  describe("Insurance Claim Triggering", function () {
    beforeEach(async function () {
      await createFinalizedDispute();
      await enforcementEngine.createEnforcement(1);
      await enforcementEngine.recordPayment(1, ethers.parseEther("0.1"));
    });

    it("Should trigger insurance claim", async function () {
      await enforcementEngine.triggerInsuranceClaim(1);
      const action = await enforcementEngine.getAction(1);
      expect(action.insuranceClaimed).to.be.true;
    });

    it("Should emit InsuranceClaimTriggered event", async function () {
      await expect(enforcementEngine.triggerInsuranceClaim(1))
        .to.emit(enforcementEngine, "InsuranceClaimTriggered")
        .withArgs(1);
    });

    it("Should reject duplicate insurance claim", async function () {
      await enforcementEngine.triggerInsuranceClaim(1);
      await expect(
        enforcementEngine.triggerInsuranceClaim(1)
      ).to.be.revertedWith("Insurance already claimed");
    });
  });

  describe("Appeal Marking", function () {
    beforeEach(async function () {
      await createFinalizedDispute();
      await enforcementEngine.createEnforcement(1);
    });

    it("Should mark enforcement as appealed", async function () {
      await enforcementEngine.markAppealed(1);
      const action = await enforcementEngine.getAction(1);
      expect(action.status).to.equal(4); // Appealed
    });

    it("Should emit EnforcementAppealed event", async function () {
      await expect(enforcementEngine.markAppealed(1))
        .to.emit(enforcementEngine, "EnforcementAppealed")
        .withArgs(1);
    });
  });

  describe("Failure Marking", function () {
    beforeEach(async function () {
      await createFinalizedDispute();
      await enforcementEngine.createEnforcement(1);
    });

    it("Should mark enforcement as failed", async function () {
      await enforcementEngine.markFailed(1, "Unable to collect");
      const action = await enforcementEngine.getAction(1);
      expect(action.status).to.equal(3); // Failed
    });

    it("Should emit EnforcementFailed event", async function () {
      await expect(enforcementEngine.markFailed(1, "Unable to collect"))
        .to.emit(enforcementEngine, "EnforcementFailed")
        .withArgs(1, "Unable to collect");
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      await createFinalizedDispute();
      await enforcementEngine.createEnforcement(1);
    });

    it("Should get action by dispute", async function () {
      expect(await enforcementEngine.getActionByDispute(1)).to.equal(1);
    });

    it("Should return zero for non-existent dispute action", async function () {
      expect(await enforcementEngine.getActionByDispute(999)).to.equal(0);
    });

    it("Should revert getAction for non-existent action", async function () {
      await expect(enforcementEngine.getAction(999))
        .to.be.revertedWith("Action does not exist");
    });
  });
});
