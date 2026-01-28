const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("BountyMarket", function () {
  let bountyMarket, disputeResolution, vjToken;
  let contractFactory, templateRegistry, courtRegistry, reputationScoring;
  let owner, creditor, debtor, hunter, oracle1, oracle2, oracle3, courtOperator;

  const EVIDENCE_PERIOD = 7 * 24 * 60 * 60;
  const RULING_PERIOD = 14 * 24 * 60 * 60;
  const APPEAL_PERIOD = 7 * 24 * 60 * 60;

  beforeEach(async function () {
    [owner, creditor, debtor, hunter, oracle1, oracle2, oracle3, courtOperator] = await ethers.getSigners();

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

    // Deploy BountyMarket
    const BountyMarket = await ethers.getContractFactory("BountyMarket");
    bountyMarket = await BountyMarket.deploy(
      owner.address,
      await vjToken.getAddress(),
      await disputeResolution.getAddress()
    );

    // Setup roles
    const AUTHORIZED_CONTRACT_ROLE = await reputationScoring.AUTHORIZED_CONTRACT_ROLE();
    await reputationScoring.grantRole(AUTHORIZED_CONTRACT_ROLE, await contractFactory.getAddress());
    await reputationScoring.grantRole(AUTHORIZED_CONTRACT_ROLE, await disputeResolution.getAddress());

    const SYSTEM_ROLE = await contractFactory.SYSTEM_ROLE();
    await contractFactory.grantRole(SYSTEM_ROLE, await disputeResolution.getAddress());

    // Mint tokens
    await vjToken.mint(creditor.address, ethers.parseEther("10000"));
    await vjToken.mint(courtOperator.address, ethers.parseEther("10000"));
    await vjToken.connect(creditor).approve(await bountyMarket.getAddress(), ethers.MaxUint256);
    await vjToken.connect(courtOperator).approve(await courtRegistry.getAddress(), ethers.MaxUint256);

    // Setup court
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
      0
    );
  });

  async function createFinalizedDispute() {
    // Create contract
    await contractFactory.createContract(
      1,
      ethers.keccak256(ethers.toUtf8Bytes("params")),
      [creditor.address, debtor.address],
      ethers.parseEther("1")
    );
    await contractFactory.connect(creditor).signContract(1);
    await contractFactory.connect(debtor).signContract(1);

    // File and resolve dispute
    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("evidence"));
    await disputeResolution.connect(creditor).fileDispute(1, "Breach", evidenceHash);
    await time.increase(EVIDENCE_PERIOD + 1);
    await disputeResolution.endEvidencePeriod(1);
    await disputeResolution.connect(courtOperator).submitRuling(
      1,
      debtor.address,
      ethers.parseEther("0.5"),
      ethers.toUtf8Bytes("Pay damages")
    );
    await disputeResolution.finalizeDispute(1);
  }

  describe("Deployment", function () {
    it("Should set correct VJ token", async function () {
      expect(await bountyMarket.vjToken()).to.equal(await vjToken.getAddress());
    });

    it("Should set correct dispute resolution", async function () {
      expect(await bountyMarket.disputeResolution()).to.equal(await disputeResolution.getAddress());
    });

    it("Should start with zero bounties", async function () {
      expect(await bountyMarket.totalBounties()).to.equal(0);
    });
  });

  describe("Oracle Management", function () {
    it("Should register oracle", async function () {
      await bountyMarket.registerOracle(oracle1.address);
      expect(await bountyMarket.isOracle(oracle1.address)).to.be.true;
    });

    it("Should emit OracleRegistered event", async function () {
      await expect(bountyMarket.registerOracle(oracle1.address))
        .to.emit(bountyMarket, "OracleRegistered")
        .withArgs(oracle1.address);
    });

    it("Should remove oracle", async function () {
      await bountyMarket.registerOracle(oracle1.address);
      await bountyMarket.removeOracle(oracle1.address);
      expect(await bountyMarket.isOracle(oracle1.address)).to.be.false;
    });

    it("Should reject duplicate oracle registration", async function () {
      await bountyMarket.registerOracle(oracle1.address);
      await expect(
        bountyMarket.registerOracle(oracle1.address)
      ).to.be.revertedWith("Already registered");
    });
  });

  describe("Bounty Creation", function () {
    beforeEach(async function () {
      await createFinalizedDispute();
    });

    it("Should create bounty", async function () {
      const deadline = (await time.latest()) + 30 * 24 * 60 * 60;
      await bountyMarket.connect(creditor).createBounty(1, ethers.parseEther("100"), deadline);
      const bounty = await bountyMarket.getBounty(1);
      expect(bounty.rulingId).to.equal(1);
      expect(bounty.bountyAmount).to.equal(ethers.parseEther("100"));
    });

    it("Should emit BountyCreated event", async function () {
      const deadline = (await time.latest()) + 30 * 24 * 60 * 60;
      await expect(bountyMarket.connect(creditor).createBounty(1, ethers.parseEther("100"), deadline))
        .to.emit(bountyMarket, "BountyCreated");
    });

    it("Should transfer bounty amount from creator", async function () {
      const balanceBefore = await vjToken.balanceOf(creditor.address);
      const deadline = (await time.latest()) + 30 * 24 * 60 * 60;
      await bountyMarket.connect(creditor).createBounty(1, ethers.parseEther("100"), deadline);
      const balanceAfter = await vjToken.balanceOf(creditor.address);
      expect(balanceBefore - balanceAfter).to.equal(ethers.parseEther("100"));
    });

    it("Should reject zero bounty amount", async function () {
      const deadline = (await time.latest()) + 30 * 24 * 60 * 60;
      await expect(
        bountyMarket.connect(creditor).createBounty(1, 0, deadline)
      ).to.be.revertedWith("Bounty amount required");
    });

    it("Should reject past deadline", async function () {
      const deadline = (await time.latest()) - 1;
      await expect(
        bountyMarket.connect(creditor).createBounty(1, ethers.parseEther("100"), deadline)
      ).to.be.revertedWith("Invalid deadline");
    });
  });

  describe("Bounty Claiming", function () {
    beforeEach(async function () {
      await createFinalizedDispute();
      const deadline = (await time.latest()) + 30 * 24 * 60 * 60;
      await bountyMarket.connect(creditor).createBounty(1, ethers.parseEther("100"), deadline);
    });

    it("Should claim bounty", async function () {
      const proof = ethers.toUtf8Bytes("recovery-proof");
      await bountyMarket.connect(hunter).claimBounty(1, 0, proof); // ProofType.OracleAttestation
      const bounty = await bountyMarket.getBounty(1);
      expect(bounty.status).to.equal(1); // Claimed
    });

    it("Should emit BountyClaimed event", async function () {
      const proof = ethers.toUtf8Bytes("recovery-proof");
      await expect(bountyMarket.connect(hunter).claimBounty(1, 0, proof))
        .to.emit(bountyMarket, "BountyClaimed");
    });

    it("Should reject claiming non-existent bounty", async function () {
      const proof = ethers.toUtf8Bytes("recovery-proof");
      await expect(
        bountyMarket.connect(hunter).claimBounty(999, 0, proof)
      ).to.be.revertedWith("Bounty does not exist");
    });

    it("Should reject empty proof", async function () {
      await expect(
        bountyMarket.connect(hunter).claimBounty(1, 0, "0x")
      ).to.be.revertedWith("Proof required");
    });
  });

  describe("Oracle Attestation", function () {
    beforeEach(async function () {
      await createFinalizedDispute();
      const deadline = (await time.latest()) + 30 * 24 * 60 * 60;
      await bountyMarket.connect(creditor).createBounty(1, ethers.parseEther("100"), deadline);
      
      await bountyMarket.registerOracle(oracle1.address);
      await bountyMarket.registerOracle(oracle2.address);
      await bountyMarket.registerOracle(oracle3.address);

      const proof = ethers.toUtf8Bytes("recovery-proof");
      await bountyMarket.connect(hunter).claimBounty(1, 0, proof);
    });

    it("Should accept oracle attestation", async function () {
      await bountyMarket.connect(oracle1).verifyOracleAttestation(1);
      const claim = await bountyMarket.getClaim(1);
      expect(claim.oracleAttestations).to.equal(1);
    });

    it("Should emit OracleAttested event", async function () {
      await expect(bountyMarket.connect(oracle1).verifyOracleAttestation(1))
        .to.emit(bountyMarket, "OracleAttested")
        .withArgs(1, oracle1.address);
    });

    it("Should pay bounty after 3 attestations", async function () {
      await bountyMarket.connect(oracle1).verifyOracleAttestation(1);
      await bountyMarket.connect(oracle2).verifyOracleAttestation(1);
      
      const hunterBalanceBefore = await vjToken.balanceOf(hunter.address);
      await bountyMarket.connect(oracle3).verifyOracleAttestation(1);
      const hunterBalanceAfter = await vjToken.balanceOf(hunter.address);
      
      expect(hunterBalanceAfter - hunterBalanceBefore).to.equal(ethers.parseEther("100"));
    });

    it("Should reject duplicate attestation", async function () {
      await bountyMarket.connect(oracle1).verifyOracleAttestation(1);
      await expect(
        bountyMarket.connect(oracle1).verifyOracleAttestation(1)
      ).to.be.revertedWith("Already attested");
    });

    it("Should reject attestation from non-oracle", async function () {
      await expect(
        bountyMarket.connect(hunter).verifyOracleAttestation(1)
      ).to.be.reverted;
    });
  });

  describe("Bounty Disputes", function () {
    beforeEach(async function () {
      await createFinalizedDispute();
      const deadline = (await time.latest()) + 30 * 24 * 60 * 60;
      await bountyMarket.connect(creditor).createBounty(1, ethers.parseEther("100"), deadline);
      
      const proof = ethers.toUtf8Bytes("recovery-proof");
      await bountyMarket.connect(hunter).claimBounty(1, 0, proof);
    });

    it("Should allow creditor to dispute", async function () {
      const evidence = ethers.toUtf8Bytes("dispute-evidence");
      await bountyMarket.connect(creditor).disputeBountyClaim(1, evidence);
      const bounty = await bountyMarket.getBounty(1);
      expect(bounty.status).to.equal(2); // Disputed
    });

    it("Should emit BountyDisputed event", async function () {
      const evidence = ethers.toUtf8Bytes("dispute-evidence");
      await expect(bountyMarket.connect(creditor).disputeBountyClaim(1, evidence))
        .to.emit(bountyMarket, "BountyDisputed");
    });

    it("Should reject dispute from unauthorized address", async function () {
      const evidence = ethers.toUtf8Bytes("dispute-evidence");
      await expect(
        bountyMarket.connect(hunter).disputeBountyClaim(1, evidence)
      ).to.be.revertedWith("Not authorized to dispute");
    });
  });

  describe("Expired Bounty", function () {
    beforeEach(async function () {
      await createFinalizedDispute();
      const deadline = (await time.latest()) + 24 * 60 * 60; // 1 day
      await bountyMarket.connect(creditor).createBounty(1, ethers.parseEther("100"), deadline);
    });

    it("Should cancel expired bounty", async function () {
      await time.increase(2 * 24 * 60 * 60); // 2 days
      await bountyMarket.cancelExpiredBounty(1);
      const bounty = await bountyMarket.getBounty(1);
      expect(bounty.status).to.equal(4); // Expired
    });

    it("Should return funds to creditor", async function () {
      const balanceBefore = await vjToken.balanceOf(creditor.address);
      await time.increase(2 * 24 * 60 * 60);
      await bountyMarket.cancelExpiredBounty(1);
      const balanceAfter = await vjToken.balanceOf(creditor.address);
      expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther("100"));
    });

    it("Should emit BountyExpired event", async function () {
      await time.increase(2 * 24 * 60 * 60);
      await expect(bountyMarket.cancelExpiredBounty(1))
        .to.emit(bountyMarket, "BountyExpired")
        .withArgs(1);
    });

    it("Should reject cancelling non-expired bounty", async function () {
      await expect(
        bountyMarket.cancelExpiredBounty(1)
      ).to.be.revertedWith("Bounty not expired");
    });
  });

  describe("View Functions", function () {
    it("Should return oracle count", async function () {
      await bountyMarket.registerOracle(oracle1.address);
      await bountyMarket.registerOracle(oracle2.address);
      expect(await bountyMarket.oracleCount()).to.equal(2);
    });

    it("Should revert getBounty for non-existent bounty", async function () {
      await expect(bountyMarket.getBounty(999))
        .to.be.revertedWith("Bounty does not exist");
    });
  });
});
