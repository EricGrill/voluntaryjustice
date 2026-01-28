const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("DisputeResolution", function () {
  let disputeResolution;
  let contractFactory;
  let templateRegistry;
  let courtRegistry;
  let reputationScoring;
  let vjToken;
  let owner;
  let courtOperator;
  let party1;
  let party2;

  const EVIDENCE_PERIOD = 7 * 24 * 60 * 60; // 7 days
  const RULING_PERIOD = 14 * 24 * 60 * 60; // 14 days

  const claim = "Failure to deliver services as agreed";
  const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("evidence-document-1"));
  const additionalEvidence = ethers.keccak256(ethers.toUtf8Bytes("evidence-document-2"));
  const enforcementInstructions = ethers.toUtf8Bytes("Release escrow to claimant");

  const DisputeState = {
    Filed: 0,
    Evidence: 1,
    Ruling: 2,
    Finalized: 3
  };

  beforeEach(async function () {
    [owner, courtOperator, party1, party2] = await ethers.getSigners();

    // Deploy all dependencies
    const VJToken = await ethers.getContractFactory("VJToken");
    vjToken = await VJToken.deploy(owner.address);
    await vjToken.waitForDeployment();

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

    const DisputeResolution = await ethers.getContractFactory("DisputeResolution");
    disputeResolution = await DisputeResolution.deploy(
      owner.address,
      await contractFactory.getAddress(),
      await courtRegistry.getAddress(),
      await reputationScoring.getAddress()
    );
    await disputeResolution.waitForDeployment();

    // Setup roles
    const AUTHORIZED_CONTRACT_ROLE = await reputationScoring.AUTHORIZED_CONTRACT_ROLE();
    await reputationScoring.grantRole(AUTHORIZED_CONTRACT_ROLE, await contractFactory.getAddress());
    await reputationScoring.grantRole(AUTHORIZED_CONTRACT_ROLE, await disputeResolution.getAddress());

    const SYSTEM_ROLE = await contractFactory.SYSTEM_ROLE();
    await contractFactory.grantRole(SYSTEM_ROLE, await disputeResolution.getAddress());

    // Setup court
    await vjToken.mint(courtOperator.address, ethers.parseEther("10000"));
    await vjToken.connect(courtOperator).approve(await courtRegistry.getAddress(), ethers.MaxUint256);
    await courtRegistry.connect(courtOperator).registerCourt(
      "ipfs://QmCourt",
      ethers.parseEther("1000"),
      ethers.keccak256(ethers.toUtf8Bytes("ruleset"))
    );

    // Register template with court operator as arbitrator
    await templateRegistry.registerTemplate(
      ethers.keccak256(ethers.toUtf8Bytes("template")),
      "ipfs://QmTemplate",
      courtOperator.address,
      0
    );

    // Create and activate a contract
    await contractFactory.createContract(
      1,
      ethers.keccak256(ethers.toUtf8Bytes("params")),
      [party1.address, party2.address],
      ethers.parseEther("1")
    );
    await contractFactory.connect(party1).signContract(1);
    await contractFactory.connect(party2).signContract(1);
  });

  describe("Deployment", function () {
    it("Should set correct dependencies", async function () {
      expect(await disputeResolution.contractFactory()).to.equal(await contractFactory.getAddress());
      expect(await disputeResolution.courtRegistry()).to.equal(await courtRegistry.getAddress());
      expect(await disputeResolution.reputationScoring()).to.equal(await reputationScoring.getAddress());
    });

    it("Should start with zero disputes", async function () {
      expect(await disputeResolution.totalDisputes()).to.equal(0);
    });
  });

  describe("Filing Disputes", function () {
    it("Should file a new dispute", async function () {
      await disputeResolution.connect(party1).fileDispute(1, claim, evidenceHash);

      expect(await disputeResolution.totalDisputes()).to.equal(1);
    });

    it("Should emit DisputeFiled event", async function () {
      await expect(disputeResolution.connect(party1).fileDispute(1, claim, evidenceHash))
        .to.emit(disputeResolution, "DisputeFiled")
        .withArgs(1, 1, party1.address, party2.address);
    });

    it("Should store correct dispute data", async function () {
      await disputeResolution.connect(party1).fileDispute(1, claim, evidenceHash);

      const dispute = await disputeResolution.getDispute(1);
      expect(dispute.id).to.equal(1);
      expect(dispute.contractId).to.equal(1);
      expect(dispute.claimant).to.equal(party1.address);
      expect(dispute.respondent).to.equal(party2.address);
      expect(dispute.claim).to.equal(claim);
      expect(dispute.state).to.equal(DisputeState.Filed);
    });

    it("Should mark contract as disputed", async function () {
      await disputeResolution.connect(party1).fileDispute(1, claim, evidenceHash);

      const contract = await contractFactory.getContract(1);
      expect(contract.state).to.equal(3); // Disputed
    });

    it("Should record dispute in reputation", async function () {
      await disputeResolution.connect(party1).fileDispute(1, claim, evidenceHash);

      const [,,, disputesAgainst,,,,] = await reputationScoring.getRawData(party2.address);
      expect(disputesAgainst).to.equal(1);
    });

    it("Should reject filing from non-party", async function () {
      await expect(
        disputeResolution.connect(owner).fileDispute(1, claim, evidenceHash)
      ).to.be.revertedWith("Not a party to contract");
    });

    it("Should reject filing without claim", async function () {
      await expect(
        disputeResolution.connect(party1).fileDispute(1, "", evidenceHash)
      ).to.be.revertedWith("Claim required");
    });

    it("Should reject filing without evidence", async function () {
      await expect(
        disputeResolution.connect(party1).fileDispute(1, claim, ethers.ZeroHash)
      ).to.be.revertedWith("Evidence hash required");
    });
  });

  describe("Evidence Submission", function () {
    beforeEach(async function () {
      await disputeResolution.connect(party1).fileDispute(1, claim, evidenceHash);
    });

    it("Should submit additional evidence", async function () {
      await disputeResolution.connect(party2).submitEvidence(1, additionalEvidence);

      const dispute = await disputeResolution.getDispute(1);
      expect(dispute.evidenceHashes.length).to.equal(2);
      expect(dispute.state).to.equal(DisputeState.Evidence);
    });

    it("Should emit EvidenceSubmitted event", async function () {
      await expect(disputeResolution.connect(party2).submitEvidence(1, additionalEvidence))
        .to.emit(disputeResolution, "EvidenceSubmitted")
        .withArgs(1, party2.address, additionalEvidence);
    });

    it("Should allow both parties to submit evidence", async function () {
      await disputeResolution.connect(party1).submitEvidence(1, additionalEvidence);
      await disputeResolution.connect(party2).submitEvidence(1, ethers.keccak256(ethers.toUtf8Bytes("ev3")));

      const dispute = await disputeResolution.getDispute(1);
      expect(dispute.evidenceHashes.length).to.equal(3);
    });

    it("Should reject evidence from non-party", async function () {
      await expect(
        disputeResolution.connect(owner).submitEvidence(1, additionalEvidence)
      ).to.be.revertedWith("Not a party to dispute");
    });

    it("Should reject evidence after deadline", async function () {
      await time.increase(EVIDENCE_PERIOD + 1);

      await expect(
        disputeResolution.connect(party1).submitEvidence(1, additionalEvidence)
      ).to.be.revertedWith("Evidence deadline passed");
    });
  });

  describe("Evidence Period End", function () {
    beforeEach(async function () {
      await disputeResolution.connect(party1).fileDispute(1, claim, evidenceHash);
    });

    it("Should end evidence period after deadline", async function () {
      await time.increase(EVIDENCE_PERIOD + 1);

      await disputeResolution.endEvidencePeriod(1);

      const dispute = await disputeResolution.getDispute(1);
      expect(dispute.state).to.equal(DisputeState.Ruling);
    });

    it("Should emit EvidencePeriodEnded event", async function () {
      await time.increase(EVIDENCE_PERIOD + 1);

      await expect(disputeResolution.endEvidencePeriod(1))
        .to.emit(disputeResolution, "EvidencePeriodEnded")
        .withArgs(1);
    });

    it("Should reject ending before deadline", async function () {
      await expect(
        disputeResolution.endEvidencePeriod(1)
      ).to.be.revertedWith("Evidence deadline not passed");
    });
  });

  describe("Ruling Submission", function () {
    beforeEach(async function () {
      await disputeResolution.connect(party1).fileDispute(1, claim, evidenceHash);
      await time.increase(EVIDENCE_PERIOD + 1);
      await disputeResolution.endEvidencePeriod(1);
    });

    it("Should submit ruling", async function () {
      await disputeResolution.connect(courtOperator).submitRuling(
        1,
        party2.address,
        ethers.parseEther("0.5"),
        enforcementInstructions
      );

      const dispute = await disputeResolution.getDispute(1);
      expect(dispute.hasRuling).to.be.true;
      expect(dispute.liable).to.equal(party2.address);
      expect(dispute.restitutionAmount).to.equal(ethers.parseEther("0.5"));
    });

    it("Should emit RulingSubmitted event", async function () {
      await expect(
        disputeResolution.connect(courtOperator).submitRuling(
          1,
          party2.address,
          ethers.parseEther("0.5"),
          enforcementInstructions
        )
      )
        .to.emit(disputeResolution, "RulingSubmitted")
        .withArgs(1, party2.address, ethers.parseEther("0.5"));
    });

    it("Should allow no liability ruling", async function () {
      await disputeResolution.connect(courtOperator).submitRuling(
        1,
        ethers.ZeroAddress,
        0,
        ethers.toUtf8Bytes("No fault found")
      );

      const dispute = await disputeResolution.getDispute(1);
      expect(dispute.liable).to.equal(ethers.ZeroAddress);
    });

    it("Should reject ruling from non-court", async function () {
      await expect(
        disputeResolution.connect(party1).submitRuling(
          1,
          party2.address,
          ethers.parseEther("0.5"),
          enforcementInstructions
        )
      ).to.be.revertedWith("Not the assigned court");
    });

    it("Should reject ruling after deadline", async function () {
      await time.increase(RULING_PERIOD + 1);

      await expect(
        disputeResolution.connect(courtOperator).submitRuling(
          1,
          party2.address,
          ethers.parseEther("0.5"),
          enforcementInstructions
        )
      ).to.be.revertedWith("Ruling deadline passed");
    });
  });

  describe("Dispute Finalization", function () {
    beforeEach(async function () {
      await disputeResolution.connect(party1).fileDispute(1, claim, evidenceHash);
      await time.increase(EVIDENCE_PERIOD + 1);
      await disputeResolution.endEvidencePeriod(1);
      await disputeResolution.connect(courtOperator).submitRuling(
        1,
        party2.address,
        ethers.parseEther("0.5"),
        enforcementInstructions
      );
    });

    it("Should finalize dispute", async function () {
      await disputeResolution.finalizeDispute(1);

      const dispute = await disputeResolution.getDispute(1);
      expect(dispute.state).to.equal(DisputeState.Finalized);
    });

    it("Should emit DisputeFinalized event", async function () {
      await expect(disputeResolution.finalizeDispute(1))
        .to.emit(disputeResolution, "DisputeFinalized")
        .withArgs(1);
    });

    it("Should mark contract as completed", async function () {
      await disputeResolution.finalizeDispute(1);

      const contract = await contractFactory.getContract(1);
      expect(contract.state).to.equal(4); // Completed
    });

    it("Should reject finalization without ruling", async function () {
      // Create another dispute
      await contractFactory.createContract(
        1,
        ethers.keccak256(ethers.toUtf8Bytes("params2")),
        [party1.address, party2.address],
        ethers.parseEther("1")
      );
      await contractFactory.connect(party1).signContract(2);
      await contractFactory.connect(party2).signContract(2);

      await disputeResolution.connect(party1).fileDispute(2, "Another claim", evidenceHash);
      await time.increase(EVIDENCE_PERIOD + 1);
      await disputeResolution.endEvidencePeriod(2);

      await expect(disputeResolution.finalizeDispute(2))
        .to.be.revertedWith("No ruling submitted");
    });
  });

  describe("Compliance Recording", function () {
    beforeEach(async function () {
      await disputeResolution.connect(party1).fileDispute(1, claim, evidenceHash);
      await time.increase(EVIDENCE_PERIOD + 1);
      await disputeResolution.endEvidencePeriod(1);
      await disputeResolution.connect(courtOperator).submitRuling(
        1,
        party2.address,
        ethers.parseEther("0.5"),
        enforcementInstructions
      );
      await disputeResolution.finalizeDispute(1);
    });

    it("Should record compliance", async function () {
      await disputeResolution.recordCompliance(1, true);

      const [compliance,,,] = await reputationScoring.getScores(party2.address);
      expect(compliance).to.equal(100);
    });

    it("Should record non-compliance", async function () {
      await disputeResolution.recordCompliance(1, false);

      const [compliance,,,] = await reputationScoring.getScores(party2.address);
      expect(compliance).to.equal(0);
    });

    it("Should reject compliance recording from non-system", async function () {
      await expect(
        disputeResolution.connect(party1).recordCompliance(1, true)
      ).to.be.reverted;
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      await disputeResolution.connect(party1).fileDispute(1, claim, evidenceHash);
    });

    it("Should get disputes by contract", async function () {
      const disputes = await disputeResolution.getDisputesByContract(1);
      expect(disputes).to.deep.equal([1n]);
    });

    it("Should get disputes by party", async function () {
      const party1Disputes = await disputeResolution.getDisputesByParty(party1.address);
      const party2Disputes = await disputeResolution.getDisputesByParty(party2.address);

      expect(party1Disputes).to.deep.equal([1n]);
      expect(party2Disputes).to.deep.equal([1n]);
    });

    it("Should get enforcement instructions", async function () {
      await time.increase(EVIDENCE_PERIOD + 1);
      await disputeResolution.endEvidencePeriod(1);
      await disputeResolution.connect(courtOperator).submitRuling(
        1,
        party2.address,
        ethers.parseEther("0.5"),
        enforcementInstructions
      );

      const instructions = await disputeResolution.getEnforcementInstructions(1);
      expect(instructions).to.equal(ethers.hexlify(enforcementInstructions));
    });

    it("Should revert getDispute for non-existent dispute", async function () {
      await expect(disputeResolution.getDispute(999))
        .to.be.revertedWith("Dispute does not exist");
    });
  });
});
