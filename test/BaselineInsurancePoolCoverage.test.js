const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * Branch-coverage focused tests for BaselineInsurancePool.
 * Drives the full claim/withdraw flow and hits every require/if branch.
 */
describe("BaselineInsurancePool — Coverage", function () {
  let insurancePool, disputeResolution, contractFactory, templateRegistry;
  let courtRegistry, reputationScoring, vjToken;
  let owner, claimsProcessor, depositor1, depositor2, party1, party2, courtOperator;

  const EVIDENCE_PERIOD = 7 * 24 * 60 * 60;
  const enforcementInstructions = ethers.toUtf8Bytes("Release escrow to claimant");
  const claim = "Failure to deliver services as agreed";
  const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("evidence-1"));

  const ClaimStatus = { Filed: 0, Approved: 1, Rejected: 2, Paid: 3 };

  beforeEach(async function () {
    [owner, claimsProcessor, depositor1, depositor2, party1, party2, courtOperator] =
      await ethers.getSigners();

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

    const BaselineInsurancePool = await ethers.getContractFactory("BaselineInsurancePool");
    insurancePool = await BaselineInsurancePool.deploy(
      owner.address,
      await vjToken.getAddress(),
      await disputeResolution.getAddress()
    );

    const AUTHORIZED_CONTRACT_ROLE = await reputationScoring.AUTHORIZED_CONTRACT_ROLE();
    await reputationScoring.grantRole(AUTHORIZED_CONTRACT_ROLE, await contractFactory.getAddress());
    await reputationScoring.grantRole(AUTHORIZED_CONTRACT_ROLE, await disputeResolution.getAddress());

    const SYSTEM_ROLE = await contractFactory.SYSTEM_ROLE();
    await contractFactory.grantRole(SYSTEM_ROLE, await disputeResolution.getAddress());

    const CLAIMS_ROLE = await insurancePool.CLAIMS_ROLE();
    await insurancePool.grantRole(CLAIMS_ROLE, claimsProcessor.address);

    // Fund and approve
    for (const acct of [depositor1, depositor2, party1, party2, courtOperator]) {
      await vjToken.mint(acct.address, ethers.parseEther("100000"));
      await vjToken.connect(acct).approve(await insurancePool.getAddress(), ethers.MaxUint256);
    }

    // Court
    await vjToken.connect(courtOperator).approve(await courtRegistry.getAddress(), ethers.MaxUint256);
    await courtRegistry.connect(courtOperator).registerCourt(
      "ipfs://QmCourt",
      ethers.parseEther("1000"),
      ethers.keccak256(ethers.toUtf8Bytes("ruleset"))
    );

    await templateRegistry.registerTemplate(
      ethers.keccak256(ethers.toUtf8Bytes("template")),
      "ipfs://QmTemplate",
      courtOperator.address,
      0
    );

    // Contract between party1 (claimant) and party2 (respondent)
    await contractFactory.createContract(
      1,
      ethers.keccak256(ethers.toUtf8Bytes("params")),
      [party1.address, party2.address],
      ethers.parseEther("1")
    );
    await contractFactory.connect(party1).signContract(1);
    await contractFactory.connect(party2).signContract(1);
  });

  // Drive dispute #1 to Finalized with `liable` liable, restitution = `restitution`.
  async function driveToFinalized(liable, restitution) {
    await disputeResolution.connect(party1).fileDispute(1, claim, evidenceHash);
    await time.increase(EVIDENCE_PERIOD + 1);
    await disputeResolution.endEvidencePeriod(1);
    await disputeResolution.connect(courtOperator).submitRuling(
      1, liable, restitution, enforcementInstructions
    );
    await disputeResolution.finalizeDispute(1);
  }

  describe("Constructor guards", function () {
    it("rejects zero token address", async function () {
      const F = await ethers.getContractFactory("BaselineInsurancePool");
      await expect(
        F.deploy(owner.address, ethers.ZeroAddress, await disputeResolution.getAddress())
      ).to.be.revertedWith("Invalid token address");
    });

    it("rejects zero dispute resolution address", async function () {
      const F = await ethers.getContractFactory("BaselineInsurancePool");
      await expect(
        F.deploy(owner.address, await vjToken.getAddress(), ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid dispute resolution");
    });
  });

  describe("Withdraw reserve-ratio branch", function () {
    it("blocks a withdrawal that would breach the reserve ratio while a claim is pending", async function () {
      // party1 deposits and has active coverage; file a claim to create an obligation.
      await insurancePool.connect(party1).deposit(ethers.parseEther("1000"));
      await driveToFinalized(party2.address, ethers.parseEther("0.5"));
      await insurancePool.connect(party1).fileClaim(1);

      const [, obligations] = await insurancePool.getPoolHealth();
      expect(obligations).to.be.gt(0);

      // Withdrawing everything would leave reserves below 20% of obligations.
      await expect(
        insurancePool.connect(party1).withdraw(ethers.parseEther("1000"))
      ).to.be.revertedWith("Would breach reserve ratio");
    });

    it("allows a small withdrawal that keeps the reserve ratio satisfied", async function () {
      // Large reserves vs tiny obligation -> ratio stays fine.
      await insurancePool.connect(party1).deposit(ethers.parseEther("1000"));
      await driveToFinalized(party2.address, ethers.parseEther("0.001"));
      await insurancePool.connect(party1).fileClaim(1);

      await expect(
        insurancePool.connect(party1).withdraw(ethers.parseEther("100"))
      ).to.not.be.reverted;
    });
  });

  describe("fileClaim branches", function () {
    beforeEach(async function () {
      await insurancePool.connect(party1).deposit(ethers.parseEther("1000"));
    });

    it("files a claim and creates a pending obligation", async function () {
      await driveToFinalized(party2.address, ethers.parseEther("0.5"));
      await expect(insurancePool.connect(party1).fileClaim(1))
        .to.emit(insurancePool, "ClaimFiled")
        .withArgs(1, party1.address, 1);

      const c = await insurancePool.getClaim(1);
      expect(c.claimant).to.equal(party1.address);
      expect(c.status).to.equal(ClaimStatus.Filed);
      expect(c.amount).to.equal(ethers.parseEther("0.5"));
    });

    it("reverts when the dispute is not finalized", async function () {
      await disputeResolution.connect(party1).fileDispute(1, claim, evidenceHash);
      await expect(insurancePool.connect(party1).fileClaim(1))
        .to.be.revertedWith("Dispute not finalized");
    });

    it("reverts when the caller is not a party to the dispute", async function () {
      await driveToFinalized(party2.address, ethers.parseEther("0.5"));
      // depositor2 has active coverage but is not a party.
      await insurancePool.connect(depositor2).deposit(ethers.parseEther("1000"));
      await expect(insurancePool.connect(depositor2).fileClaim(1))
        .to.be.revertedWith("Not a party to dispute");
    });

    it("reverts when the claimant is the liable party", async function () {
      // party1 is made liable -> party1 cannot claim.
      await driveToFinalized(party1.address, ethers.parseEther("0.5"));
      await expect(insurancePool.connect(party1).fileClaim(1))
        .to.be.revertedWith("Claimant is liable party");
    });

    it("caps the claim at the coverage limit minus claims paid", async function () {
      // coverageLimit = 1000 * 10 = 10000. Set restitution above that.
      await driveToFinalized(party2.address, ethers.parseEther("999999"));
      await insurancePool.connect(party1).fileClaim(1);
      const c = await insurancePool.getClaim(1);
      // Capped first by coverageLimit (10000), then by maxClaim (50% of reserves = 500).
      expect(c.amount).to.equal(ethers.parseEther("500"));
    });

    it("caps the claim at the max coverage ratio of the pool", async function () {
      // reserves = 1000, maxClaim = 50% = 500. restitution 600 within coverage limit (10000)
      // but above maxClaim.
      await driveToFinalized(party2.address, ethers.parseEther("600"));
      await insurancePool.connect(party1).fileClaim(1);
      const c = await insurancePool.getClaim(1);
      expect(c.amount).to.equal(ethers.parseEther("500"));
    });
  });

  describe("processClaim branches", function () {
    beforeEach(async function () {
      await insurancePool.connect(party1).deposit(ethers.parseEther("1000"));
      await driveToFinalized(party2.address, ethers.parseEther("0.5"));
      await insurancePool.connect(party1).fileClaim(1);
    });

    it("approves and pays out a claim", async function () {
      const balBefore = await vjToken.balanceOf(party1.address);
      await expect(insurancePool.connect(claimsProcessor).processClaim(1, true))
        .to.emit(insurancePool, "ClaimProcessed")
        .withArgs(1, ClaimStatus.Paid, ethers.parseEther("0.5"));

      const c = await insurancePool.getClaim(1);
      expect(c.status).to.equal(ClaimStatus.Paid);
      expect(await vjToken.balanceOf(party1.address)).to.equal(balBefore + ethers.parseEther("0.5"));
      expect(await insurancePool.totalClaimsPaid()).to.equal(ethers.parseEther("0.5"));

      const cov = await insurancePool.getCoverage(party1.address);
      expect(cov.claimsPaid).to.equal(ethers.parseEther("0.5"));

      // Obligation cleared.
      const [, obligations] = await insurancePool.getPoolHealth();
      expect(obligations).to.equal(0);
    });

    it("rejects a claim without payout", async function () {
      const reservesBefore = await insurancePool.totalReserves();
      await expect(insurancePool.connect(claimsProcessor).processClaim(1, false))
        .to.emit(insurancePool, "ClaimProcessed")
        .withArgs(1, ClaimStatus.Rejected, 0);

      const c = await insurancePool.getClaim(1);
      expect(c.status).to.equal(ClaimStatus.Rejected);
      // Reserves unchanged for a rejection.
      expect(await insurancePool.totalReserves()).to.equal(reservesBefore);
      const [, obligations] = await insurancePool.getPoolHealth();
      expect(obligations).to.equal(0);
    });

    it("reverts when processing an already-processed claim", async function () {
      await insurancePool.connect(claimsProcessor).processClaim(1, true);
      await expect(insurancePool.connect(claimsProcessor).processClaim(1, true))
        .to.be.revertedWith("Claim already processed");
    });
  });

  describe("getPoolHealth ratio branch", function () {
    it("computes a real ratio once obligations exist", async function () {
      await insurancePool.connect(party1).deposit(ethers.parseEther("1000"));
      await driveToFinalized(party2.address, ethers.parseEther("0.5"));
      await insurancePool.connect(party1).fileClaim(1);

      const [reserves, obligations, ratio] = await insurancePool.getPoolHealth();
      expect(obligations).to.equal(ethers.parseEther("0.5"));
      expect(ratio).to.equal((reserves * 10000n) / obligations);
    });
  });
});
