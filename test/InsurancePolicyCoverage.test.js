const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * Branch-coverage focused tests for InsurancePolicy.
 * Exercises purchase/renew/cancel/claim/process flows and every revert branch.
 */
describe("InsurancePolicy — Coverage", function () {
  let vjToken, insurerRegistry, insurancePolicy, disputeResolution;
  let contractFactory, templateRegistry, courtRegistry, reputationScoring;
  let owner, insurer, policyholder, party2, courtOperator, other;

  const MIN_STAKE = ethers.parseEther("10000");
  const COVERAGE = ethers.parseEther("1000");
  const DURATION = 30 * 24 * 60 * 60; // 30 days
  const EVIDENCE_PERIOD = 7 * 24 * 60 * 60;

  const enforcementInstructions = ethers.toUtf8Bytes("Release escrow to claimant");
  const claim = "Failure to deliver services as agreed";
  const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("evidence-1"));

  const PolicyStatus = { Active: 0, Expired: 1, Cancelled: 2, ClaimFiled: 3, ClaimPaid: 4 };

  beforeEach(async function () {
    [owner, insurer, policyholder, party2, courtOperator, other] = await ethers.getSigners();

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

    const InsurerRegistry = await ethers.getContractFactory("InsurerRegistry");
    insurerRegistry = await InsurerRegistry.deploy(owner.address, await vjToken.getAddress());

    const InsurancePolicy = await ethers.getContractFactory("InsurancePolicy");
    insurancePolicy = await InsurancePolicy.deploy(
      owner.address,
      await vjToken.getAddress(),
      await insurerRegistry.getAddress(),
      await disputeResolution.getAddress()
    );

    // Roles
    const STAKING_ROLE = await vjToken.STAKING_ROLE();
    await vjToken.grantRole(STAKING_ROLE, await insurerRegistry.getAddress());

    const GOVERNANCE_ROLE = await insurerRegistry.GOVERNANCE_ROLE();
    await insurerRegistry.grantRole(GOVERNANCE_ROLE, await insurancePolicy.getAddress());

    const AUTHORIZED_CONTRACT_ROLE = await reputationScoring.AUTHORIZED_CONTRACT_ROLE();
    await reputationScoring.grantRole(AUTHORIZED_CONTRACT_ROLE, await contractFactory.getAddress());
    await reputationScoring.grantRole(AUTHORIZED_CONTRACT_ROLE, await disputeResolution.getAddress());

    const SYSTEM_ROLE = await contractFactory.SYSTEM_ROLE();
    await contractFactory.grantRole(SYSTEM_ROLE, await disputeResolution.getAddress());

    // Funds + approvals
    await vjToken.mint(insurer.address, ethers.parseEther("200000"));
    await vjToken.mint(policyholder.address, ethers.parseEther("100000"));
    await vjToken.mint(courtOperator.address, ethers.parseEther("100000"));

    await vjToken.connect(insurer).approve(await insurerRegistry.getAddress(), ethers.MaxUint256);
    // insurer (operator) approves the policy contract so claims can be paid out of its wallet.
    await vjToken.connect(insurer).approve(await insurancePolicy.getAddress(), ethers.MaxUint256);
    await vjToken.connect(policyholder).approve(await insurancePolicy.getAddress(), ethers.MaxUint256);

    // Court + template + signed contract for disputes.
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
    // policyholder = claimant (party1), party2 = respondent.
    await contractFactory.createContract(
      1,
      ethers.keccak256(ethers.toUtf8Bytes("params")),
      [policyholder.address, party2.address],
      ethers.parseEther("1")
    );
    await contractFactory.connect(policyholder).signContract(1);
    await contractFactory.connect(party2).signContract(1);

    // Register insurer (id 1).
    await insurerRegistry.connect(insurer).registerInsurer(
      MIN_STAKE,
      ethers.toUtf8Bytes("Standard terms"),
      ethers.keccak256(ethers.toUtf8Bytes("proof"))
    );
  });

  async function driveToFinalized(liable, restitution) {
    await disputeResolution.connect(policyholder).fileDispute(1, claim, evidenceHash);
    await time.increase(EVIDENCE_PERIOD + 1);
    await disputeResolution.endEvidencePeriod(1);
    await disputeResolution.connect(courtOperator).submitRuling(
      1, liable, restitution, enforcementInstructions
    );
    await disputeResolution.finalizeDispute(1);
  }

  describe("Constructor guards", function () {
    let F;
    beforeEach(async function () {
      F = await ethers.getContractFactory("InsurancePolicy");
    });
    it("rejects zero token", async function () {
      await expect(F.deploy(owner.address, ethers.ZeroAddress, await insurerRegistry.getAddress(), await disputeResolution.getAddress()))
        .to.be.revertedWith("Invalid token address");
    });
    it("rejects zero insurer registry", async function () {
      await expect(F.deploy(owner.address, await vjToken.getAddress(), ethers.ZeroAddress, await disputeResolution.getAddress()))
        .to.be.revertedWith("Invalid insurer registry");
    });
    it("rejects zero dispute resolution", async function () {
      await expect(F.deploy(owner.address, await vjToken.getAddress(), await insurerRegistry.getAddress(), ethers.ZeroAddress))
        .to.be.revertedWith("Invalid dispute resolution");
    });
  });

  describe("purchasePolicy branches", function () {
    it("reverts when the insurer is not active", async function () {
      // Slash insurer below MIN_STAKE -> deactivated.
      await insurerRegistry.slashInsurer(1, ethers.parseEther("5000"), "misconduct");
      await expect(insurancePolicy.connect(policyholder).purchasePolicy(1, COVERAGE, DURATION))
        .to.be.revertedWith("Insurer not active");
    });

    it("reverts when the computed premium is too low", async function () {
      // premium = coverage * duration / (30 days * 100); tiny coverage+duration -> 0.
      await expect(insurancePolicy.connect(policyholder).purchasePolicy(1, 1, 1))
        .to.be.revertedWith("Premium too low");
    });

    it("records the policy against holder and insurer and increments registry", async function () {
      await insurancePolicy.connect(policyholder).purchasePolicy(1, COVERAGE, DURATION);
      const ins = await insurerRegistry.getInsurer(1);
      expect(ins.policiesIssued).to.equal(1);
      expect((await insurancePolicy.getPoliciesByInsurer(1)).length).to.equal(1);
    });
  });

  describe("renewPolicy branches", function () {
    beforeEach(async function () {
      await insurancePolicy.connect(policyholder).purchasePolicy(1, COVERAGE, DURATION);
    });

    it("reverts on a non-existent policy", async function () {
      await expect(insurancePolicy.connect(policyholder).renewPolicy(999))
        .to.be.revertedWith("Policy does not exist");
    });

    it("reverts when the policy cannot be renewed (cancelled)", async function () {
      await insurancePolicy.connect(policyholder).cancelPolicy(1);
      await expect(insurancePolicy.connect(policyholder).renewPolicy(1))
        .to.be.revertedWith("Cannot renew policy");
    });

    it("renews an expired policy", async function () {
      await time.increase(DURATION + 1);
      // Status is still Active in storage; renewal of an Active/Expired allowed.
      await expect(insurancePolicy.connect(policyholder).renewPolicy(1))
        .to.emit(insurancePolicy, "PolicyRenewed");
      const p = await insurancePolicy.getPolicy(1);
      expect(p.status).to.equal(PolicyStatus.Active);
      expect(p.premium).to.be.gt(0);
    });

    it("reverts when the insurer became inactive", async function () {
      await insurerRegistry.slashInsurer(1, ethers.parseEther("5000"), "misconduct");
      await expect(insurancePolicy.connect(policyholder).renewPolicy(1))
        .to.be.revertedWith("Insurer not active");
    });
  });

  describe("cancelPolicy branches", function () {
    beforeEach(async function () {
      await insurancePolicy.connect(policyholder).purchasePolicy(1, COVERAGE, DURATION);
    });

    it("reverts on a non-existent policy", async function () {
      await expect(insurancePolicy.connect(policyholder).cancelPolicy(999))
        .to.be.revertedWith("Policy does not exist");
    });

    it("reverts when the policy is not active", async function () {
      await insurancePolicy.connect(policyholder).cancelPolicy(1);
      await expect(insurancePolicy.connect(policyholder).cancelPolicy(1))
        .to.be.revertedWith("Policy not active");
    });
  });

  describe("fileClaim branches", function () {
    beforeEach(async function () {
      await insurancePolicy.connect(policyholder).purchasePolicy(1, COVERAGE, DURATION);
    });

    it("files a claim and caps the amount at restitution (below coverage)", async function () {
      await driveToFinalized(party2.address, ethers.parseEther("0.5"));
      await expect(insurancePolicy.connect(policyholder).fileClaim(1, 1))
        .to.emit(insurancePolicy, "ClaimFiled")
        .withArgs(1, 1);
      const p = await insurancePolicy.getPolicy(1);
      expect(p.status).to.equal(PolicyStatus.ClaimFiled);
      expect(p.claimAmount).to.equal(ethers.parseEther("0.5"));
    });

    it("caps the claim amount at the coverage when restitution exceeds it", async function () {
      await driveToFinalized(party2.address, ethers.parseEther("999999"));
      await insurancePolicy.connect(policyholder).fileClaim(1, 1);
      const p = await insurancePolicy.getPolicy(1);
      expect(p.claimAmount).to.equal(COVERAGE);
    });

    it("reverts on a non-existent policy", async function () {
      await expect(insurancePolicy.connect(policyholder).fileClaim(999, 1))
        .to.be.revertedWith("Policy does not exist");
    });

    it("reverts when caller is not the policyholder", async function () {
      await driveToFinalized(party2.address, ethers.parseEther("0.5"));
      await expect(insurancePolicy.connect(other).fileClaim(1, 1))
        .to.be.revertedWith("Not policyholder");
    });

    it("reverts when the policy is not active", async function () {
      await insurancePolicy.connect(policyholder).cancelPolicy(1);
      await expect(insurancePolicy.connect(policyholder).fileClaim(1, 1))
        .to.be.revertedWith("Policy not active");
    });

    it("reverts when the policy has expired", async function () {
      await time.increase(DURATION + 1);
      // Still Active status but past endTime.
      await driveToFinalized(party2.address, ethers.parseEther("0.5"));
      await expect(insurancePolicy.connect(policyholder).fileClaim(1, 1))
        .to.be.revertedWith("Policy expired");
    });

    it("reverts when the dispute is not finalized", async function () {
      await disputeResolution.connect(policyholder).fileDispute(1, claim, evidenceHash);
      await expect(insurancePolicy.connect(policyholder).fileClaim(1, 1))
        .to.be.revertedWith("Dispute not finalized");
    });

    it("reverts when the claimant is the liable party", async function () {
      await driveToFinalized(policyholder.address, ethers.parseEther("0.5"));
      await expect(insurancePolicy.connect(policyholder).fileClaim(1, 1))
        .to.be.revertedWith("Claimant is liable party");
    });
  });

  describe("processClaim branches", function () {
    beforeEach(async function () {
      await insurancePolicy.connect(policyholder).purchasePolicy(1, COVERAGE, DURATION);
      await driveToFinalized(party2.address, ethers.parseEther("0.5"));
      await insurancePolicy.connect(policyholder).fileClaim(1, 1);
    });

    it("pays out the claim from the insurer operator to the policyholder", async function () {
      const phBefore = await vjToken.balanceOf(policyholder.address);
      const insBefore = await vjToken.balanceOf(insurer.address);

      await expect(insurancePolicy.processClaim(1))
        .to.emit(insurancePolicy, "ClaimPaid")
        .withArgs(1, ethers.parseEther("0.5"));

      const p = await insurancePolicy.getPolicy(1);
      expect(p.status).to.equal(PolicyStatus.ClaimPaid);
      expect(await vjToken.balanceOf(policyholder.address)).to.equal(phBefore + ethers.parseEther("0.5"));
      expect(await vjToken.balanceOf(insurer.address)).to.equal(insBefore - ethers.parseEther("0.5"));

      const ins = await insurerRegistry.getInsurer(1);
      expect(ins.claimsPaid).to.equal(ethers.parseEther("0.5"));
    });

    it("reverts on a non-existent policy", async function () {
      await expect(insurancePolicy.processClaim(999))
        .to.be.revertedWith("Policy does not exist");
    });

    it("reverts when no claim has been filed", async function () {
      // Fresh policy id 2 with no claim.
      await insurancePolicy.connect(policyholder).purchasePolicy(1, COVERAGE, DURATION);
      await expect(insurancePolicy.processClaim(2))
        .to.be.revertedWith("No claim filed");
    });

    it("requires CLAIMS_ROLE", async function () {
      await expect(insurancePolicy.connect(other).processClaim(1)).to.be.reverted;
    });
  });

  describe("isPolicyValid branches", function () {
    it("returns false for a cancelled policy", async function () {
      await insurancePolicy.connect(policyholder).purchasePolicy(1, COVERAGE, DURATION);
      await insurancePolicy.connect(policyholder).cancelPolicy(1);
      expect(await insurancePolicy.isPolicyValid(1)).to.be.false;
    });
  });
});
