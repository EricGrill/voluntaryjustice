const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("InsurancePolicy", function () {
  let vjToken, insurerRegistry, insurancePolicy, disputeResolution;
  let contractFactory, templateRegistry, courtRegistry, reputationScoring;
  let owner, insurer, policyholder, party2, courtOperator;
  const MIN_STAKE = ethers.parseEther("10000");
  const COVERAGE = ethers.parseEther("1000");
  const DURATION = 30 * 24 * 60 * 60; // 30 days

  beforeEach(async function () {
    [owner, insurer, policyholder, party2, courtOperator] = await ethers.getSigners();

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

    // Deploy InsurerRegistry
    const InsurerRegistry = await ethers.getContractFactory("InsurerRegistry");
    insurerRegistry = await InsurerRegistry.deploy(owner.address, await vjToken.getAddress());

    // Deploy InsurancePolicy
    const InsurancePolicy = await ethers.getContractFactory("InsurancePolicy");
    insurancePolicy = await InsurancePolicy.deploy(
      owner.address,
      await vjToken.getAddress(),
      await insurerRegistry.getAddress(),
      await disputeResolution.getAddress()
    );

    // Setup roles
    const STAKING_ROLE = await vjToken.STAKING_ROLE();
    await vjToken.grantRole(STAKING_ROLE, await insurerRegistry.getAddress());

    const GOVERNANCE_ROLE = await insurerRegistry.GOVERNANCE_ROLE();
    await insurerRegistry.grantRole(GOVERNANCE_ROLE, await insurancePolicy.getAddress());

    // Mint tokens
    await vjToken.mint(insurer.address, ethers.parseEther("100000"));
    await vjToken.mint(policyholder.address, ethers.parseEther("10000"));
    await vjToken.connect(insurer).approve(await insurerRegistry.getAddress(), ethers.MaxUint256);
    await vjToken.connect(insurer).approve(await insurancePolicy.getAddress(), ethers.MaxUint256);
    await vjToken.connect(policyholder).approve(await insurancePolicy.getAddress(), ethers.MaxUint256);

    // Register insurer
    const terms = ethers.toUtf8Bytes("Standard terms");
    const reserveProof = ethers.keccak256(ethers.toUtf8Bytes("proof"));
    await insurerRegistry.connect(insurer).registerInsurer(MIN_STAKE, terms, reserveProof);
  });

  describe("Deployment", function () {
    it("Should set correct VJ token", async function () {
      expect(await insurancePolicy.vjToken()).to.equal(await vjToken.getAddress());
    });

    it("Should set correct insurer registry", async function () {
      expect(await insurancePolicy.insurerRegistry()).to.equal(await insurerRegistry.getAddress());
    });

    it("Should start with zero policies", async function () {
      expect(await insurancePolicy.totalPolicies()).to.equal(0);
    });
  });

  describe("Policy Purchase", function () {
    it("Should purchase a policy", async function () {
      await insurancePolicy.connect(policyholder).purchasePolicy(1, COVERAGE, DURATION);
      const policy = await insurancePolicy.getPolicy(1);
      expect(policy.policyholder).to.equal(policyholder.address);
      expect(policy.coverage).to.equal(COVERAGE);
    });

    it("Should emit PolicyPurchased event", async function () {
      await expect(insurancePolicy.connect(policyholder).purchasePolicy(1, COVERAGE, DURATION))
        .to.emit(insurancePolicy, "PolicyPurchased");
    });

    it("Should calculate and transfer premium", async function () {
      const balanceBefore = await vjToken.balanceOf(insurer.address);
      await insurancePolicy.connect(policyholder).purchasePolicy(1, COVERAGE, DURATION);
      const balanceAfter = await vjToken.balanceOf(insurer.address);
      expect(balanceAfter).to.be.gt(balanceBefore);
    });

    it("Should reject zero coverage", async function () {
      await expect(
        insurancePolicy.connect(policyholder).purchasePolicy(1, 0, DURATION)
      ).to.be.revertedWith("Coverage must be positive");
    });

    it("Should reject zero duration", async function () {
      await expect(
        insurancePolicy.connect(policyholder).purchasePolicy(1, COVERAGE, 0)
      ).to.be.revertedWith("Duration must be positive");
    });
  });

  describe("Policy Renewal", function () {
    beforeEach(async function () {
      await insurancePolicy.connect(policyholder).purchasePolicy(1, COVERAGE, DURATION);
    });

    it("Should renew a policy", async function () {
      const policyBefore = await insurancePolicy.getPolicy(1);
      await insurancePolicy.connect(policyholder).renewPolicy(1);
      const policyAfter = await insurancePolicy.getPolicy(1);
      expect(policyAfter.endTime).to.be.gt(policyBefore.endTime);
    });

    it("Should emit PolicyRenewed event", async function () {
      await expect(insurancePolicy.connect(policyholder).renewPolicy(1))
        .to.emit(insurancePolicy, "PolicyRenewed");
    });

    it("Should reject renewal from non-policyholder", async function () {
      await expect(
        insurancePolicy.connect(insurer).renewPolicy(1)
      ).to.be.revertedWith("Not policyholder");
    });
  });

  describe("Policy Cancellation", function () {
    beforeEach(async function () {
      await insurancePolicy.connect(policyholder).purchasePolicy(1, COVERAGE, DURATION);
    });

    it("Should cancel a policy", async function () {
      await insurancePolicy.connect(policyholder).cancelPolicy(1);
      const policy = await insurancePolicy.getPolicy(1);
      expect(policy.status).to.equal(2); // Cancelled
    });

    it("Should emit PolicyCancelled event", async function () {
      await expect(insurancePolicy.connect(policyholder).cancelPolicy(1))
        .to.emit(insurancePolicy, "PolicyCancelled")
        .withArgs(1);
    });

    it("Should reject cancellation from non-policyholder", async function () {
      await expect(
        insurancePolicy.connect(insurer).cancelPolicy(1)
      ).to.be.revertedWith("Not policyholder");
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      await insurancePolicy.connect(policyholder).purchasePolicy(1, COVERAGE, DURATION);
    });

    it("Should return policies by holder", async function () {
      const policies = await insurancePolicy.getPoliciesByHolder(policyholder.address);
      expect(policies.length).to.equal(1);
      expect(policies[0]).to.equal(1);
    });

    it("Should return policies by insurer", async function () {
      const policies = await insurancePolicy.getPoliciesByInsurer(1);
      expect(policies.length).to.equal(1);
    });

    it("Should check if policy is valid", async function () {
      expect(await insurancePolicy.isPolicyValid(1)).to.be.true;
    });

    it("Should return invalid for expired policy", async function () {
      await time.increase(DURATION + 1);
      expect(await insurancePolicy.isPolicyValid(1)).to.be.false;
    });

    it("Should revert getPolicy for non-existent policy", async function () {
      await expect(insurancePolicy.getPolicy(999))
        .to.be.revertedWith("Policy does not exist");
    });
  });
});
