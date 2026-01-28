const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("LegacyCourtBridge", function () {
  let legacyCourtBridge;
  let owner;
  let verifier;
  let submitter;
  let user;

  const CHALLENGE_PERIOD = 7 * 24 * 60 * 60; // 7 days

  beforeEach(async function () {
    [owner, verifier, submitter, user] = await ethers.getSigners();

    // Deploy LegacyCourtBridge
    const LegacyCourtBridge = await ethers.getContractFactory("LegacyCourtBridge");
    legacyCourtBridge = await LegacyCourtBridge.deploy(owner.address);
    await legacyCourtBridge.waitForDeployment();

    // Grant verifier role
    const VERIFIER_ROLE = await legacyCourtBridge.VERIFIER_ROLE();
    await legacyCourtBridge.grantRole(VERIFIER_ROLE, verifier.address);
  });

  describe("Deployment", function () {
    it("Should set correct admin", async function () {
      const DEFAULT_ADMIN_ROLE = await legacyCourtBridge.DEFAULT_ADMIN_ROLE();
      expect(await legacyCourtBridge.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
    });

    it("Should start with zero jurisdictions", async function () {
      expect(await legacyCourtBridge.totalJurisdictions()).to.equal(0);
      expect(await legacyCourtBridge.activeJurisdictionCount()).to.equal(0);
    });

    it("Should start with zero submissions", async function () {
      expect(await legacyCourtBridge.totalSubmissions()).to.equal(0);
    });

    it("Should have correct CHALLENGE_PERIOD", async function () {
      expect(await legacyCourtBridge.CHALLENGE_PERIOD()).to.equal(CHALLENGE_PERIOD);
    });
  });

  describe("Jurisdiction Registration", function () {
    const jurisdictionName = "United States Federal";
    const verificationKey = ethers.keccak256(ethers.toUtf8Bytes("us_federal_key"));

    it("Should register a jurisdiction", async function () {
      await legacyCourtBridge.registerJurisdiction(jurisdictionName, verificationKey);

      expect(await legacyCourtBridge.totalJurisdictions()).to.equal(1);
      expect(await legacyCourtBridge.activeJurisdictionCount()).to.equal(1);
    });

    it("Should emit JurisdictionRegistered event", async function () {
      await expect(legacyCourtBridge.registerJurisdiction(jurisdictionName, verificationKey))
        .to.emit(legacyCourtBridge, "JurisdictionRegistered")
        .withArgs(1, jurisdictionName, verificationKey);
    });

    it("Should store correct jurisdiction info", async function () {
      await legacyCourtBridge.registerJurisdiction(jurisdictionName, verificationKey);

      const jurisdiction = await legacyCourtBridge.getJurisdiction(1);
      expect(jurisdiction.id).to.equal(1);
      expect(jurisdiction.name).to.equal(jurisdictionName);
      expect(jurisdiction.verificationKey).to.equal(verificationKey);
      expect(jurisdiction.active).to.be.true;
    });

    it("Should reject empty name", async function () {
      await expect(
        legacyCourtBridge.registerJurisdiction("", verificationKey)
      ).to.be.revertedWith("Name required");
    });

    it("Should reject zero verification key", async function () {
      await expect(
        legacyCourtBridge.registerJurisdiction(jurisdictionName, ethers.ZeroHash)
      ).to.be.revertedWith("Verification key required");
    });

    it("Should reject duplicate verification key", async function () {
      await legacyCourtBridge.registerJurisdiction(jurisdictionName, verificationKey);

      await expect(
        legacyCourtBridge.registerJurisdiction("Another Jurisdiction", verificationKey)
      ).to.be.revertedWith("Verification key already used");
    });

    it("Should reject from non-governance", async function () {
      await expect(
        legacyCourtBridge.connect(user).registerJurisdiction(jurisdictionName, verificationKey)
      ).to.be.reverted;
    });
  });

  describe("Jurisdiction Management", function () {
    const verificationKey = ethers.keccak256(ethers.toUtf8Bytes("us_federal_key"));

    beforeEach(async function () {
      await legacyCourtBridge.registerJurisdiction("United States Federal", verificationKey);
    });

    it("Should deactivate jurisdiction", async function () {
      await legacyCourtBridge.deactivateJurisdiction(1);

      const jurisdiction = await legacyCourtBridge.getJurisdiction(1);
      expect(jurisdiction.active).to.be.false;
      expect(await legacyCourtBridge.activeJurisdictionCount()).to.equal(0);
    });

    it("Should emit JurisdictionDeactivated event", async function () {
      await expect(legacyCourtBridge.deactivateJurisdiction(1))
        .to.emit(legacyCourtBridge, "JurisdictionDeactivated")
        .withArgs(1);
    });

    it("Should reactivate jurisdiction", async function () {
      await legacyCourtBridge.deactivateJurisdiction(1);
      await legacyCourtBridge.reactivateJurisdiction(1);

      const jurisdiction = await legacyCourtBridge.getJurisdiction(1);
      expect(jurisdiction.active).to.be.true;
    });

    it("Should emit JurisdictionReactivated event", async function () {
      await legacyCourtBridge.deactivateJurisdiction(1);

      await expect(legacyCourtBridge.reactivateJurisdiction(1))
        .to.emit(legacyCourtBridge, "JurisdictionReactivated")
        .withArgs(1);
    });
  });

  describe("Judgment Submission", function () {
    const bountyId = 1;
    const judgmentData = ethers.toUtf8Bytes("Case #12345: Judgment in favor of plaintiff");
    const verificationKey = ethers.keccak256(ethers.toUtf8Bytes("us_federal_key"));

    beforeEach(async function () {
      await legacyCourtBridge.registerJurisdiction("United States Federal", verificationKey);
    });

    it("Should submit a judgment", async function () {
      await legacyCourtBridge.connect(submitter).submitJudgment(bountyId, judgmentData, 1);

      expect(await legacyCourtBridge.totalSubmissions()).to.equal(1);
    });

    it("Should emit JudgmentSubmitted event", async function () {
      await expect(legacyCourtBridge.connect(submitter).submitJudgment(bountyId, judgmentData, 1))
        .to.emit(legacyCourtBridge, "JudgmentSubmitted")
        .withArgs(1, bountyId, 1);
    });

    it("Should store correct judgment info", async function () {
      await legacyCourtBridge.connect(submitter).submitJudgment(bountyId, judgmentData, 1);

      const judgment = await legacyCourtBridge.getJudgment(1);
      expect(judgment.id).to.equal(1);
      expect(judgment.bountyId).to.equal(bountyId);
      expect(judgment.jurisdictionId).to.equal(1);
      expect(judgment.submitter).to.equal(submitter.address);
      expect(judgment.status).to.equal(0); // Pending
    });

    it("Should reject empty judgment data", async function () {
      await expect(
        legacyCourtBridge.connect(submitter).submitJudgment(bountyId, "0x", 1)
      ).to.be.revertedWith("Judgment data required");
    });

    it("Should reject submission to inactive jurisdiction", async function () {
      await legacyCourtBridge.deactivateJurisdiction(1);

      await expect(
        legacyCourtBridge.connect(submitter).submitJudgment(bountyId, judgmentData, 1)
      ).to.be.revertedWith("Jurisdiction not active");
    });

    it("Should track submissions by bounty", async function () {
      await legacyCourtBridge.connect(submitter).submitJudgment(bountyId, judgmentData, 1);
      await legacyCourtBridge.connect(submitter).submitJudgment(bountyId, ethers.toUtf8Bytes("Another judgment"), 1);

      const submissions = await legacyCourtBridge.getSubmissionsByBounty(bountyId);
      expect(submissions.length).to.equal(2);
    });
  });

  describe("Judgment Verification", function () {
    const bountyId = 1;
    const judgmentData = ethers.toUtf8Bytes("Case #12345: Judgment in favor of plaintiff");
    const verificationKey = ethers.keccak256(ethers.toUtf8Bytes("us_federal_key"));

    beforeEach(async function () {
      await legacyCourtBridge.registerJurisdiction("United States Federal", verificationKey);
      await legacyCourtBridge.connect(submitter).submitJudgment(bountyId, judgmentData, 1);
    });

    it("Should verify a judgment", async function () {
      await legacyCourtBridge.connect(verifier).verifyJudgment(1);

      const judgment = await legacyCourtBridge.getJudgment(1);
      expect(judgment.status).to.equal(1); // Verified
    });

    it("Should emit JudgmentVerified event", async function () {
      await expect(legacyCourtBridge.connect(verifier).verifyJudgment(1))
        .to.emit(legacyCourtBridge, "JudgmentVerified")
        .withArgs(1);
    });

    it("Should set challenge deadline", async function () {
      await legacyCourtBridge.connect(verifier).verifyJudgment(1);

      const judgment = await legacyCourtBridge.getJudgment(1);
      expect(judgment.challengeDeadline).to.be.gt(0);
    });

    it("Should reject verification from non-verifier", async function () {
      await expect(
        legacyCourtBridge.connect(user).verifyJudgment(1)
      ).to.be.reverted;
    });

    it("Should increment jurisdiction submissions processed", async function () {
      await legacyCourtBridge.connect(verifier).verifyJudgment(1);

      const jurisdiction = await legacyCourtBridge.getJurisdiction(1);
      expect(jurisdiction.submissionsProcessed).to.equal(1);
    });
  });

  describe("Judgment Challenge", function () {
    const bountyId = 1;
    const judgmentData = ethers.toUtf8Bytes("Case #12345: Judgment in favor of plaintiff");
    const verificationKey = ethers.keccak256(ethers.toUtf8Bytes("us_federal_key"));

    beforeEach(async function () {
      await legacyCourtBridge.registerJurisdiction("United States Federal", verificationKey);
      await legacyCourtBridge.connect(submitter).submitJudgment(bountyId, judgmentData, 1);
      await legacyCourtBridge.connect(verifier).verifyJudgment(1);
    });

    it("Should challenge a judgment", async function () {
      await legacyCourtBridge.connect(user).challengeJudgment(1, "Fraudulent document");

      const judgment = await legacyCourtBridge.getJudgment(1);
      expect(judgment.status).to.equal(2); // Challenged
      expect(judgment.challengeReason).to.equal("Fraudulent document");
    });

    it("Should emit JudgmentChallenged event", async function () {
      await expect(legacyCourtBridge.connect(user).challengeJudgment(1, "Fraudulent document"))
        .to.emit(legacyCourtBridge, "JudgmentChallenged")
        .withArgs(1, "Fraudulent document");
    });

    it("Should reject challenge after deadline", async function () {
      await time.increase(CHALLENGE_PERIOD + 1);

      await expect(
        legacyCourtBridge.connect(user).challengeJudgment(1, "Fraudulent document")
      ).to.be.revertedWith("Challenge period ended");
    });

    it("Should reject challenge without reason", async function () {
      await expect(
        legacyCourtBridge.connect(user).challengeJudgment(1, "")
      ).to.be.revertedWith("Reason required");
    });
  });

  describe("Judgment Rejection", function () {
    const bountyId = 1;
    const judgmentData = ethers.toUtf8Bytes("Case #12345: Judgment in favor of plaintiff");
    const verificationKey = ethers.keccak256(ethers.toUtf8Bytes("us_federal_key"));

    beforeEach(async function () {
      await legacyCourtBridge.registerJurisdiction("United States Federal", verificationKey);
      await legacyCourtBridge.connect(submitter).submitJudgment(bountyId, judgmentData, 1);
    });

    it("Should reject a pending judgment", async function () {
      await legacyCourtBridge.connect(verifier).rejectJudgment(1, "Invalid format");

      const judgment = await legacyCourtBridge.getJudgment(1);
      expect(judgment.status).to.equal(3); // Rejected
    });

    it("Should emit JudgmentRejected event", async function () {
      await expect(legacyCourtBridge.connect(verifier).rejectJudgment(1, "Invalid format"))
        .to.emit(legacyCourtBridge, "JudgmentRejected")
        .withArgs(1, "Invalid format");
    });

    it("Should reject a challenged judgment", async function () {
      await legacyCourtBridge.connect(verifier).verifyJudgment(1);
      await legacyCourtBridge.connect(user).challengeJudgment(1, "Fraudulent");
      await legacyCourtBridge.connect(verifier).rejectJudgment(1, "Challenge upheld");

      const judgment = await legacyCourtBridge.getJudgment(1);
      expect(judgment.status).to.equal(3); // Rejected
    });
  });

  describe("Judgment Finalization", function () {
    const bountyId = 1;
    const judgmentData = ethers.toUtf8Bytes("Case #12345: Judgment in favor of plaintiff");
    const verificationKey = ethers.keccak256(ethers.toUtf8Bytes("us_federal_key"));

    beforeEach(async function () {
      await legacyCourtBridge.registerJurisdiction("United States Federal", verificationKey);
      await legacyCourtBridge.connect(submitter).submitJudgment(bountyId, judgmentData, 1);
      await legacyCourtBridge.connect(verifier).verifyJudgment(1);
    });

    it("Should finalize a judgment after challenge period", async function () {
      await time.increase(CHALLENGE_PERIOD + 1);
      await legacyCourtBridge.finalizeJudgment(1);

      const judgment = await legacyCourtBridge.getJudgment(1);
      expect(judgment.status).to.equal(4); // Finalized
    });

    it("Should emit JudgmentFinalized event", async function () {
      await time.increase(CHALLENGE_PERIOD + 1);

      await expect(legacyCourtBridge.finalizeJudgment(1))
        .to.emit(legacyCourtBridge, "JudgmentFinalized")
        .withArgs(1);
    });

    it("Should reject finalization before challenge period ends", async function () {
      await expect(
        legacyCourtBridge.finalizeJudgment(1)
      ).to.be.revertedWith("Challenge period not ended");
    });

    it("Should set finalizedAt timestamp", async function () {
      await time.increase(CHALLENGE_PERIOD + 1);
      await legacyCourtBridge.finalizeJudgment(1);

      const judgment = await legacyCourtBridge.getJudgment(1);
      expect(judgment.finalizedAt).to.be.gt(0);
    });
  });

  describe("Challenge Resolution", function () {
    const bountyId = 1;
    const judgmentData = ethers.toUtf8Bytes("Case #12345: Judgment in favor of plaintiff");
    const verificationKey = ethers.keccak256(ethers.toUtf8Bytes("us_federal_key"));

    beforeEach(async function () {
      await legacyCourtBridge.registerJurisdiction("United States Federal", verificationKey);
      await legacyCourtBridge.connect(submitter).submitJudgment(bountyId, judgmentData, 1);
      await legacyCourtBridge.connect(verifier).verifyJudgment(1);
      await legacyCourtBridge.connect(user).challengeJudgment(1, "Fraudulent");
    });

    it("Should resolve challenge in favor of judgment", async function () {
      await legacyCourtBridge.connect(verifier).resolveChallenge(1);

      const judgment = await legacyCourtBridge.getJudgment(1);
      expect(judgment.status).to.equal(1); // Verified
      expect(judgment.challengeReason).to.equal("");
    });
  });

  describe("View Functions", function () {
    const bountyId = 1;
    const judgmentData = ethers.toUtf8Bytes("Case #12345: Judgment in favor of plaintiff");
    const verificationKey = ethers.keccak256(ethers.toUtf8Bytes("us_federal_key"));

    beforeEach(async function () {
      await legacyCourtBridge.registerJurisdiction("United States Federal", verificationKey);
      await legacyCourtBridge.connect(submitter).submitJudgment(bountyId, judgmentData, 1);
    });

    it("Should check if judgment is finalized", async function () {
      expect(await legacyCourtBridge.isJudgmentFinalized(1)).to.be.false;

      await legacyCourtBridge.connect(verifier).verifyJudgment(1);
      await time.increase(CHALLENGE_PERIOD + 1);
      await legacyCourtBridge.finalizeJudgment(1);

      expect(await legacyCourtBridge.isJudgmentFinalized(1)).to.be.true;
    });

    it("Should check if bounty has finalized judgment", async function () {
      expect(await legacyCourtBridge.hasFinalizedJudgment(bountyId)).to.be.false;

      await legacyCourtBridge.connect(verifier).verifyJudgment(1);
      await time.increase(CHALLENGE_PERIOD + 1);
      await legacyCourtBridge.finalizeJudgment(1);

      expect(await legacyCourtBridge.hasFinalizedJudgment(bountyId)).to.be.true;
    });

    it("Should list active jurisdictions", async function () {
      const verificationKey2 = ethers.keccak256(ethers.toUtf8Bytes("uk_key"));
      await legacyCourtBridge.registerJurisdiction("United Kingdom", verificationKey2);

      const jurisdictions = await legacyCourtBridge.listActiveJurisdictions();
      expect(jurisdictions.length).to.equal(2);
    });

    it("Should revert getJudgment for non-existent", async function () {
      await expect(legacyCourtBridge.getJudgment(999))
        .to.be.revertedWith("Submission does not exist");
    });

    it("Should revert getJurisdiction for non-existent", async function () {
      await expect(legacyCourtBridge.getJurisdiction(999))
        .to.be.revertedWith("Jurisdiction does not exist");
    });
  });
});
