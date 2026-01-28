const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * Integration Test: Full Dispute Flow
 *
 * Tests the complete lifecycle of a dispute from contract creation
 * through resolution and enforcement.
 */
describe("Integration: Full Dispute Flow", function () {
  this.timeout(60000); // 1 minute timeout
  let vjToken;
  let identityRegistry;
  let reputationScoring;
  let templateRegistry;
  let contractFactory;
  let courtRegistry;
  let disputeResolution;
  let escrowVault;
  let enforcementEngine;

  let owner;
  let partyA; // Creditor (service provider)
  let partyB; // Debtor (client)
  let arbitrator;

  const STAKE_AMOUNT = ethers.parseEther("10000");
  const CONTRACT_VALUE = ethers.parseEther("1");

  beforeEach(async function () {
    [owner, partyA, partyB, arbitrator] = await ethers.getSigners();

    // Deploy all contracts
    const VJToken = await ethers.getContractFactory("VJToken");
    vjToken = await VJToken.deploy(owner.address);
    await vjToken.waitForDeployment();

    const IdentityRegistry = await ethers.getContractFactory("IdentityRegistry");
    identityRegistry = await IdentityRegistry.deploy(owner.address);
    await identityRegistry.waitForDeployment();

    const ReputationScoring = await ethers.getContractFactory("ReputationScoring");
    reputationScoring = await ReputationScoring.deploy(owner.address);
    await reputationScoring.waitForDeployment();

    const ContractTemplateRegistry = await ethers.getContractFactory("ContractTemplateRegistry");
    templateRegistry = await ContractTemplateRegistry.deploy(owner.address);
    await templateRegistry.waitForDeployment();

    const ContractFactory = await ethers.getContractFactory("ContractFactory");
    contractFactory = await ContractFactory.deploy(
      owner.address,
      await templateRegistry.getAddress(),
      await reputationScoring.getAddress()
    );
    await contractFactory.waitForDeployment();

    const CourtRegistry = await ethers.getContractFactory("CourtRegistry");
    courtRegistry = await CourtRegistry.deploy(owner.address, await vjToken.getAddress());
    await courtRegistry.waitForDeployment();

    const EscrowVault = await ethers.getContractFactory("EscrowVault");
    escrowVault = await EscrowVault.deploy(owner.address);
    await escrowVault.waitForDeployment();

    const DisputeResolution = await ethers.getContractFactory("DisputeResolution");
    disputeResolution = await DisputeResolution.deploy(
      owner.address,
      await contractFactory.getAddress(),
      await courtRegistry.getAddress(),
      await reputationScoring.getAddress(),
      await vjToken.getAddress()
    );
    await disputeResolution.waitForDeployment();

    // Deploy a baseline insurance pool for EnforcementEngine
    const BaselineInsurancePool = await ethers.getContractFactory("BaselineInsurancePool");
    const insurancePool = await BaselineInsurancePool.deploy(
      owner.address,
      await vjToken.getAddress(),
      await disputeResolution.getAddress()
    );
    await insurancePool.waitForDeployment();

    const EnforcementEngine = await ethers.getContractFactory("EnforcementEngine");
    enforcementEngine = await EnforcementEngine.deploy(
      owner.address,
      await disputeResolution.getAddress(),
      await escrowVault.getAddress(),
      await reputationScoring.getAddress(),
      await insurancePool.getAddress()
    );
    await enforcementEngine.waitForDeployment();

    // Setup roles
    const STAKING_ROLE = await vjToken.STAKING_ROLE();
    await vjToken.grantRole(STAKING_ROLE, await courtRegistry.getAddress());

    const AUTHORIZED_CONTRACT_ROLE = await reputationScoring.AUTHORIZED_CONTRACT_ROLE();
    await reputationScoring.grantRole(AUTHORIZED_CONTRACT_ROLE, await contractFactory.getAddress());
    await reputationScoring.grantRole(AUTHORIZED_CONTRACT_ROLE, await disputeResolution.getAddress());

    const CONTRACT_FACTORY_ROLE = await escrowVault.CONTRACT_FACTORY_ROLE();
    await escrowVault.grantRole(CONTRACT_FACTORY_ROLE, await contractFactory.getAddress());

    const ENFORCEMENT_ROLE = await escrowVault.ENFORCEMENT_ROLE();
    await escrowVault.grantRole(ENFORCEMENT_ROLE, await enforcementEngine.getAddress());

    // Grant SYSTEM_ROLE to DisputeResolution so it can mark contracts as disputed
    const SYSTEM_ROLE = await contractFactory.SYSTEM_ROLE();
    await contractFactory.grantRole(SYSTEM_ROLE, await disputeResolution.getAddress());

    // Setup arbitrator with stake
    await vjToken.mint(arbitrator.address, STAKE_AMOUNT);
    await vjToken.connect(arbitrator).approve(await courtRegistry.getAddress(), STAKE_AMOUNT);
    await courtRegistry.connect(arbitrator).registerCourt(
      "ipfs://court-metadata",
      STAKE_AMOUNT,
      ethers.keccak256(ethers.toUtf8Bytes("standard-ruleset"))
    );

    // Register template (0 = Service category)
    await templateRegistry.registerTemplate(
      ethers.keccak256(ethers.toUtf8Bytes("service-agreement")),
      "ipfs://service-template",
      arbitrator.address,
      0 // TemplateCategory.Service
    );

    // Register identities
    await identityRegistry.connect(partyA).registerIdentity(ethers.toUtf8Bytes("sybil-proof-a"));
    await identityRegistry.connect(partyB).registerIdentity(ethers.toUtf8Bytes("sybil-proof-b"));
  });

  describe("Complete Dispute Lifecycle", function () {
    let contractId;
    let disputeId;

    it("Should create and sign a contract", async function () {
      // Create contract
      const tx = await contractFactory.connect(partyA).createContract(
        1, // template ID
        ethers.keccak256(ethers.toUtf8Bytes("contract-params")),
        [partyA.address, partyB.address],
        CONTRACT_VALUE // escrowRequired
      );
      const receipt = await tx.wait();

      // Get contract ID from event
      const event = receipt.logs.find(
        log => log.fragment && log.fragment.name === "ContractCreated"
      );
      contractId = event.args[0];

      expect(contractId).to.equal(1n);

      // Both parties sign
      await contractFactory.connect(partyA).signContract(contractId);
      await contractFactory.connect(partyB).signContract(contractId);

      // Contract should be active
      const contract = await contractFactory.getContract(contractId);
      expect(contract.state).to.equal(2); // Active
    });

    it("Should deposit escrow and file dispute", async function () {
      // Create and sign contract
      await contractFactory.connect(partyA).createContract(
        1,
        ethers.keccak256(ethers.toUtf8Bytes("contract-params")),
        [partyA.address, partyB.address],
        CONTRACT_VALUE
      );
      contractId = 1n;
      await contractFactory.connect(partyA).signContract(contractId);
      await contractFactory.connect(partyB).signContract(contractId);

      // Deposit escrow
      await escrowVault.connect(partyB).deposit(contractId, { value: CONTRACT_VALUE });
      expect(await escrowVault.getBalance(contractId)).to.equal(CONTRACT_VALUE);

      // File dispute (partyA claims non-payment)
      const tx = await disputeResolution.connect(partyA).fileDispute(
        contractId,
        "Service delivered but payment not released",
        ethers.keccak256(ethers.toUtf8Bytes("evidence-hash"))
      );
      const receipt = await tx.wait();

      const event = receipt.logs.find(
        log => log.fragment && log.fragment.name === "DisputeFiled"
      );
      disputeId = event.args[0];

      expect(disputeId).to.equal(1n);

      // Contract should be disputed
      const contract = await contractFactory.getContract(contractId);
      expect(contract.state).to.equal(3); // Disputed
    });

    it("Should submit evidence and ruling", async function () {
      // Setup: Create contract, deposit, file dispute
      await contractFactory.connect(partyA).createContract(
        1,
        ethers.keccak256(ethers.toUtf8Bytes("contract-params")),
        [partyA.address, partyB.address],
        CONTRACT_VALUE
      );
      contractId = 1n;
      await contractFactory.connect(partyA).signContract(contractId);
      await contractFactory.connect(partyB).signContract(contractId);
      await escrowVault.connect(partyB).deposit(contractId, { value: CONTRACT_VALUE });
      await disputeResolution.connect(partyA).fileDispute(
        contractId,
        "Service delivered but payment not released",
        ethers.keccak256(ethers.toUtf8Bytes("evidence-hash"))
      );
      disputeId = 1n;

      // Submit additional evidence
      await disputeResolution.connect(partyB).submitEvidence(
        disputeId,
        ethers.keccak256(ethers.toUtf8Bytes("counter-evidence"))
      );

      // Fast forward past evidence period
      await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]); // 8 days
      await ethers.provider.send("evm_mine");

      // End evidence period
      await disputeResolution.endEvidencePeriod(disputeId);

      // Arbitrator submits ruling (partyA wins, gets escrow)
      await disputeResolution.connect(arbitrator).submitRuling(
        disputeId,
        partyA.address,
        CONTRACT_VALUE,
        ethers.toUtf8Bytes("Release escrow to creditor")
      );

      const dispute = await disputeResolution.getDispute(disputeId);
      expect(dispute.state).to.equal(2); // Still in Ruling state until finalized
      expect(dispute.hasRuling).to.be.true; // Ruling has been submitted
    });

    it("Should finalize dispute and create enforcement", async function () {
      // Full setup: contract, deposit, dispute, evidence, ruling
      await contractFactory.connect(partyA).createContract(
        1,
        ethers.keccak256(ethers.toUtf8Bytes("contract-params")),
        [partyA.address, partyB.address],
        CONTRACT_VALUE
      );
      contractId = 1n;
      await contractFactory.connect(partyA).signContract(contractId);
      await contractFactory.connect(partyB).signContract(contractId);
      await escrowVault.connect(partyB).deposit(contractId, { value: CONTRACT_VALUE });
      await disputeResolution.connect(partyA).fileDispute(
        contractId,
        "Service delivered but payment not released",
        ethers.keccak256(ethers.toUtf8Bytes("evidence-hash"))
      );
      disputeId = 1n;

      await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
      await ethers.provider.send("evm_mine");
      await disputeResolution.endEvidencePeriod(disputeId);

      await disputeResolution.connect(arbitrator).submitRuling(
        disputeId,
        partyA.address,
        CONTRACT_VALUE,
        ethers.toUtf8Bytes("Release escrow to creditor")
      );

      // Fast forward past appeal period
      await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
      await ethers.provider.send("evm_mine");

      // Finalize dispute
      await disputeResolution.finalizeDispute(disputeId);

      const dispute = await disputeResolution.getDispute(disputeId);
      expect(dispute.state).to.equal(3); // Finalized

      // Create enforcement action
      await enforcementEngine.createEnforcement(disputeId);

      const action = await enforcementEngine.getActionByDispute(disputeId);
      expect(action).to.not.equal(0);
    });

    it("Should execute full flow end-to-end", async function () {
      // Create contract
      await contractFactory.connect(partyA).createContract(
        1,
        ethers.keccak256(ethers.toUtf8Bytes("contract-params")),
        [partyA.address, partyB.address],
        CONTRACT_VALUE
      );
      contractId = 1n;

      // Sign contract
      await contractFactory.connect(partyA).signContract(contractId);
      await contractFactory.connect(partyB).signContract(contractId);

      // Deposit escrow
      await escrowVault.connect(partyB).deposit(contractId, { value: CONTRACT_VALUE });

      // File dispute
      await disputeResolution.connect(partyA).fileDispute(
        contractId,
        "Service delivered but payment not released",
        ethers.keccak256(ethers.toUtf8Bytes("evidence-hash"))
      );
      disputeId = 1n;

      // Submit evidence
      await disputeResolution.connect(partyB).submitEvidence(
        disputeId,
        ethers.keccak256(ethers.toUtf8Bytes("counter-evidence"))
      );

      // End evidence period
      await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
      await ethers.provider.send("evm_mine");
      await disputeResolution.endEvidencePeriod(disputeId);

      // Submit ruling
      await disputeResolution.connect(arbitrator).submitRuling(
        disputeId,
        partyA.address,
        CONTRACT_VALUE,
        ethers.toUtf8Bytes("Release escrow to creditor")
      );

      // Finalize
      await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
      await ethers.provider.send("evm_mine");
      await disputeResolution.finalizeDispute(disputeId);

      // Create enforcement
      await enforcementEngine.createEnforcement(disputeId);

      // Check reputation was updated
      const partyAScores = await reputationScoring.getScores(partyA.address);
      expect(partyAScores[2]).to.be.gt(0); // Has contract participation

      // Verify dispute is finalized
      const dispute = await disputeResolution.getDispute(disputeId);
      expect(dispute.state).to.equal(3); // Finalized
    });
  });

  describe("Reputation Integration", function () {
    it("Should track contract participation", async function () {
      await contractFactory.connect(partyA).createContract(
        1,
        ethers.keccak256(ethers.toUtf8Bytes("contract-params")),
        [partyA.address, partyB.address],
        CONTRACT_VALUE
      );

      const rawData = await reputationScoring.getRawData(partyA.address);
      expect(rawData.totalContracts).to.equal(1);
    });

    it("Should track disputes filed", async function () {
      await contractFactory.connect(partyA).createContract(
        1,
        ethers.keccak256(ethers.toUtf8Bytes("contract-params")),
        [partyA.address, partyB.address],
        CONTRACT_VALUE
      );
      await contractFactory.connect(partyA).signContract(1);
      await contractFactory.connect(partyB).signContract(1);

      await disputeResolution.connect(partyA).fileDispute(
        1,
        "Test dispute",
        ethers.keccak256(ethers.toUtf8Bytes("evidence"))
      );

      const rawData = await reputationScoring.getRawData(partyB.address);
      expect(rawData.disputesAgainst).to.equal(1);
    });
  });
});
