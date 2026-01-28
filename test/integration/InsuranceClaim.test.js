const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * Integration Test: Insurance Claim Flow
 *
 * Tests the insurance system from policy purchase through claim processing.
 */
describe("Integration: Insurance Claim Flow", function () {
  this.timeout(60000); // 1 minute timeout
  let vjToken;
  let reputationScoring;
  let templateRegistry;
  let contractFactory;
  let courtRegistry;
  let disputeResolution;
  let escrowVault;
  let enforcementEngine;
  let insurerRegistry;
  let insurancePolicy;
  let baselinePool;

  let owner;
  let insurer;
  let policyholder;
  let counterparty;
  let arbitrator;

  const INSURER_STAKE = ethers.parseEther("100000");
  const POLICY_COVERAGE = ethers.parseEther("10");
  const POLICY_DURATION = 365 * 24 * 60 * 60; // 1 year
  const COURT_STAKE = ethers.parseEther("10000");

  beforeEach(async function () {
    [owner, insurer, policyholder, counterparty, arbitrator] = await ethers.getSigners();

    // Deploy token
    const VJToken = await ethers.getContractFactory("VJToken");
    vjToken = await VJToken.deploy(owner.address);
    await vjToken.waitForDeployment();

    // Deploy reputation
    const ReputationScoring = await ethers.getContractFactory("ReputationScoring");
    reputationScoring = await ReputationScoring.deploy(owner.address);
    await reputationScoring.waitForDeployment();

    // Deploy template registry
    const ContractTemplateRegistry = await ethers.getContractFactory("ContractTemplateRegistry");
    templateRegistry = await ContractTemplateRegistry.deploy(owner.address);
    await templateRegistry.waitForDeployment();

    // Deploy contract factory
    const ContractFactory = await ethers.getContractFactory("ContractFactory");
    contractFactory = await ContractFactory.deploy(
      owner.address,
      await templateRegistry.getAddress(),
      await reputationScoring.getAddress()
    );
    await contractFactory.waitForDeployment();

    // Deploy court registry
    const CourtRegistry = await ethers.getContractFactory("CourtRegistry");
    courtRegistry = await CourtRegistry.deploy(owner.address, await vjToken.getAddress());
    await courtRegistry.waitForDeployment();

    // Deploy escrow vault
    const EscrowVault = await ethers.getContractFactory("EscrowVault");
    escrowVault = await EscrowVault.deploy(owner.address);
    await escrowVault.waitForDeployment();

    // Deploy dispute resolution
    const DisputeResolution = await ethers.getContractFactory("DisputeResolution");
    disputeResolution = await DisputeResolution.deploy(
      owner.address,
      await contractFactory.getAddress(),
      await courtRegistry.getAddress(),
      await reputationScoring.getAddress(),
      await vjToken.getAddress()
    );
    await disputeResolution.waitForDeployment();

    // Deploy insurer registry
    const InsurerRegistry = await ethers.getContractFactory("InsurerRegistry");
    insurerRegistry = await InsurerRegistry.deploy(owner.address, await vjToken.getAddress());
    await insurerRegistry.waitForDeployment();

    // Deploy insurance policy
    const InsurancePolicy = await ethers.getContractFactory("InsurancePolicy");
    insurancePolicy = await InsurancePolicy.deploy(
      owner.address,
      await vjToken.getAddress(),
      await insurerRegistry.getAddress(),
      await disputeResolution.getAddress()
    );
    await insurancePolicy.waitForDeployment();

    // Deploy baseline insurance pool
    const BaselineInsurancePool = await ethers.getContractFactory("BaselineInsurancePool");
    baselinePool = await BaselineInsurancePool.deploy(
      owner.address,
      await vjToken.getAddress(),
      await disputeResolution.getAddress()
    );
    await baselinePool.waitForDeployment();

    // Deploy enforcement engine (needs baselinePool address)
    const EnforcementEngine = await ethers.getContractFactory("EnforcementEngine");
    enforcementEngine = await EnforcementEngine.deploy(
      owner.address,
      await disputeResolution.getAddress(),
      await escrowVault.getAddress(),
      await reputationScoring.getAddress(),
      await baselinePool.getAddress()
    );
    await enforcementEngine.waitForDeployment();

    // Setup roles
    const STAKING_ROLE = await vjToken.STAKING_ROLE();
    await vjToken.grantRole(STAKING_ROLE, await courtRegistry.getAddress());
    await vjToken.grantRole(STAKING_ROLE, await insurerRegistry.getAddress());

    const AUTHORIZED_CONTRACT_ROLE = await reputationScoring.AUTHORIZED_CONTRACT_ROLE();
    await reputationScoring.grantRole(AUTHORIZED_CONTRACT_ROLE, await contractFactory.getAddress());
    await reputationScoring.grantRole(AUTHORIZED_CONTRACT_ROLE, await disputeResolution.getAddress());

    const CONTRACT_FACTORY_ROLE = await escrowVault.CONTRACT_FACTORY_ROLE();
    await escrowVault.grantRole(CONTRACT_FACTORY_ROLE, await contractFactory.getAddress());

    const ENFORCEMENT_ROLE = await escrowVault.ENFORCEMENT_ROLE();
    await escrowVault.grantRole(ENFORCEMENT_ROLE, await enforcementEngine.getAddress());

    // Grant InsurancePolicy permission to record policies on InsurerRegistry
    const GOVERNANCE_ROLE = await insurerRegistry.GOVERNANCE_ROLE();
    await insurerRegistry.grantRole(GOVERNANCE_ROLE, await insurancePolicy.getAddress());

    // Grant SYSTEM_ROLE to DisputeResolution so it can mark contracts as disputed
    const SYSTEM_ROLE = await contractFactory.SYSTEM_ROLE();
    await contractFactory.grantRole(SYSTEM_ROLE, await disputeResolution.getAddress());

    // Grant SYSTEM_ROLE to EnforcementEngine so it can record compliance
    const DR_SYSTEM_ROLE = await disputeResolution.SYSTEM_ROLE();
    await disputeResolution.grantRole(DR_SYSTEM_ROLE, await enforcementEngine.getAddress());

    // Mint tokens (need extra beyond stake amount due to notifyStake tracking)
    await vjToken.mint(insurer.address, INSURER_STAKE * 2n);
    await vjToken.mint(policyholder.address, ethers.parseEther("1000"));
    await vjToken.mint(arbitrator.address, COURT_STAKE * 2n);
    await vjToken.mint(owner.address, ethers.parseEther("100000")); // For baseline pool

    // Setup insurer
    await vjToken.connect(insurer).approve(await insurerRegistry.getAddress(), INSURER_STAKE);
    await insurerRegistry.connect(insurer).registerInsurer(
      INSURER_STAKE,
      ethers.toUtf8Bytes("Standard coverage terms"),
      ethers.keccak256(ethers.toUtf8Bytes("reserve-proof-1"))
    );

    // Setup arbitrator
    await vjToken.connect(arbitrator).approve(await courtRegistry.getAddress(), COURT_STAKE);
    await courtRegistry.connect(arbitrator).registerCourt(
      "ipfs://court-metadata",
      COURT_STAKE,
      ethers.keccak256(ethers.toUtf8Bytes("standard-ruleset"))
    );

    // Register template (0 = Service category)
    await templateRegistry.registerTemplate(
      ethers.keccak256(ethers.toUtf8Bytes("service-agreement")),
      "ipfs://service-template",
      arbitrator.address,
      0 // TemplateCategory.Service
    );

    // Fund baseline pool
    await vjToken.approve(await baselinePool.getAddress(), ethers.parseEther("100000"));
    await baselinePool.deposit(ethers.parseEther("50000"));
  });

  describe("Private Insurance Flow", function () {
    let policyId;
    let insurerId = 1;

    it("Should purchase an insurance policy", async function () {
      // Approve premium payment
      await vjToken.connect(policyholder).approve(
        await insurancePolicy.getAddress(),
        ethers.parseEther("100")
      );

      // Purchase policy
      const tx = await insurancePolicy.connect(policyholder).purchasePolicy(
        insurerId,
        POLICY_COVERAGE,
        POLICY_DURATION
      );
      const receipt = await tx.wait();

      const event = receipt.logs.find(
        log => log.fragment && log.fragment.name === "PolicyPurchased"
      );
      policyId = event.args[0];

      expect(policyId).to.equal(1n);

      // Verify policy details
      const policy = await insurancePolicy.getPolicy(policyId);
      expect(policy.policyholder).to.equal(policyholder.address);
      expect(policy.coverage).to.equal(POLICY_COVERAGE);
      expect(policy.status).to.equal(0); // Active
    });

    it("Should validate policy is active", async function () {
      await vjToken.connect(policyholder).approve(
        await insurancePolicy.getAddress(),
        ethers.parseEther("100")
      );
      await insurancePolicy.connect(policyholder).purchasePolicy(
        insurerId,
        POLICY_COVERAGE,
        POLICY_DURATION
      );

      expect(await insurancePolicy.isPolicyValid(1)).to.be.true;
    });

    it("Should renew an insurance policy", async function () {
      await vjToken.connect(policyholder).approve(
        await insurancePolicy.getAddress(),
        ethers.parseEther("200")
      );

      await insurancePolicy.connect(policyholder).purchasePolicy(
        insurerId,
        POLICY_COVERAGE,
        POLICY_DURATION
      );

      const policyBefore = await insurancePolicy.getPolicy(1);

      // Renew
      await insurancePolicy.connect(policyholder).renewPolicy(1);

      const policyAfter = await insurancePolicy.getPolicy(1);
      expect(policyAfter.endTime).to.be.gt(policyBefore.endTime);
    });

    it("Should cancel a policy", async function () {
      await vjToken.connect(policyholder).approve(
        await insurancePolicy.getAddress(),
        ethers.parseEther("100")
      );
      await insurancePolicy.connect(policyholder).purchasePolicy(
        insurerId,
        POLICY_COVERAGE,
        POLICY_DURATION
      );

      await insurancePolicy.connect(policyholder).cancelPolicy(1);

      const policy = await insurancePolicy.getPolicy(1);
      expect(policy.status).to.equal(2); // Cancelled
    });
  });

  describe("Baseline Pool Flow", function () {
    it("Should allow deposits to baseline pool", async function () {
      const depositAmount = ethers.parseEther("1000");

      await vjToken.connect(policyholder).approve(
        await baselinePool.getAddress(),
        depositAmount
      );

      await baselinePool.connect(policyholder).deposit(depositAmount);

      const coverage = await baselinePool.getCoverage(policyholder.address);
      expect(coverage.totalContribution).to.equal(depositAmount);
      expect(coverage.active).to.be.true;
    });

    it("Should track pool health", async function () {
      const health = await baselinePool.getPoolHealth();

      expect(health.reserves).to.be.gt(0);
      expect(health.ratio).to.equal(10000); // 100% when no obligations
    });

    it("Should allow withdrawals from pool", async function () {
      const depositAmount = ethers.parseEther("1000");

      await vjToken.connect(policyholder).approve(
        await baselinePool.getAddress(),
        depositAmount
      );
      await baselinePool.connect(policyholder).deposit(depositAmount);

      const balanceBefore = await vjToken.balanceOf(policyholder.address);

      await baselinePool.connect(policyholder).withdraw(depositAmount);

      const balanceAfter = await vjToken.balanceOf(policyholder.address);
      expect(balanceAfter - balanceBefore).to.equal(depositAmount);
    });
  });

  describe("Insurance with Enforcement", function () {
    it("Should trigger insurance claim from enforcement", async function () {
      // Setup: Create contract, dispute, ruling
      await contractFactory.connect(policyholder).createContract(
        1,
        ethers.keccak256(ethers.toUtf8Bytes("contract-params")),
        [policyholder.address, counterparty.address],
        POLICY_COVERAGE // escrowRequired
      );
      await contractFactory.connect(policyholder).signContract(1);
      await contractFactory.connect(counterparty).signContract(1);

      // File dispute
      await disputeResolution.connect(policyholder).fileDispute(
        1,
        "Non-delivery of service",
        ethers.keccak256(ethers.toUtf8Bytes("evidence"))
      );

      // Fast forward and finalize
      await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
      await ethers.provider.send("evm_mine");
      await disputeResolution.endEvidencePeriod(1);

      await disputeResolution.connect(arbitrator).submitRuling(
        1,
        policyholder.address,
        ethers.parseEther("5"),
        ethers.toUtf8Bytes("Pay damages")
      );

      await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
      await ethers.provider.send("evm_mine");
      await disputeResolution.finalizeDispute(1);

      // Create enforcement
      await enforcementEngine.createEnforcement(1);

      // Grant EXECUTOR_ROLE to owner for testing
      const EXECUTOR_ROLE = await enforcementEngine.EXECUTOR_ROLE();
      await enforcementEngine.grantRole(EXECUTOR_ROLE, owner.address);

      // Record payment to move status to InProgress
      await enforcementEngine.recordPayment(1, 0);

      // Trigger insurance claim
      await enforcementEngine.triggerInsuranceClaim(1);

      const action = await enforcementEngine.getAction(1);
      expect(action.insuranceClaimed).to.be.true;
    });
  });

  describe("Insurer Slashing", function () {
    it("Should slash insurer for misbehavior", async function () {
      const slashAmount = ethers.parseEther("10000");

      const insurerBefore = await insurerRegistry.getInsurer(1);

      await insurerRegistry.slashInsurer(1, slashAmount, "Failed to pay valid claim");

      const insurerAfter = await insurerRegistry.getInsurer(1);
      expect(insurerAfter.stake).to.equal(insurerBefore.stake - slashAmount);
      expect(insurerAfter.slashedAmount).to.equal(slashAmount);
    });

    it("Should deactivate insurer if stake falls below minimum", async function () {
      // Slash almost all stake
      await insurerRegistry.slashInsurer(1, ethers.parseEther("95000"), "Major violation");

      const insurer = await insurerRegistry.getInsurer(1);
      expect(insurer.active).to.be.false;
    });
  });

  describe("Multiple Insurers", function () {
    it("Should list all active insurers", async function () {
      // Register another insurer
      const [, , , , , insurer2] = await ethers.getSigners();
      await vjToken.mint(insurer2.address, INSURER_STAKE * 2n);
      await vjToken.connect(insurer2).approve(await insurerRegistry.getAddress(), INSURER_STAKE);
      await insurerRegistry.connect(insurer2).registerInsurer(
        INSURER_STAKE,
        ethers.toUtf8Bytes("Premium coverage terms"),
        ethers.keccak256(ethers.toUtf8Bytes("reserve-proof-2"))
      );

      const insurers = await insurerRegistry.listInsurers();
      expect(insurers.length).to.equal(2);
    });
  });
});
