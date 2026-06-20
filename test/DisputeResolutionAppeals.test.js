const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * Covers the appeal / commit-reveal jury flow and the error branches of
 * DisputeResolution that the main spec does not exercise.
 */
describe("DisputeResolution — Appeals & Edge Cases", function () {
  let disputeResolution;
  let contractFactory;
  let templateRegistry;
  let courtRegistry;
  let reputationScoring;
  let vjToken;
  let owner, courtOperator, party1, party2, jurorPool;
  let jurors;

  const EVIDENCE_PERIOD = 7 * 24 * 60 * 60;
  const RULING_PERIOD = 14 * 24 * 60 * 60;
  const APPEAL_PERIOD = 7 * 24 * 60 * 60;
  const JURY_VOTING_PERIOD = 5 * 24 * 60 * 60;
  const MIN_APPEAL_STAKE = ethers.parseEther("500");

  const claim = "Failure to deliver services as agreed";
  const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("evidence-1"));
  const enforcementInstructions = ethers.toUtf8Bytes("Release escrow to claimant");

  const DisputeState = {
    Filed: 0, Evidence: 1, Ruling: 2, Finalized: 3,
    Appealed: 4, JuryDeliberation: 5, JuryVoting: 6, AppealFinalized: 7,
  };

  const claimantVote = ethers.solidityPackedKeccak256(["string"], ["claimant"]);
  const respondentVote = ethers.solidityPackedKeccak256(["string"], ["respondent"]);
  const salt = ethers.keccak256(ethers.toUtf8Bytes("salt"));
  const commit = (vote) => ethers.solidityPackedKeccak256(["bytes32", "bytes32"], [vote, salt]);

  beforeEach(async function () {
    const signers = await ethers.getSigners();
    [owner, courtOperator, party1, party2, jurorPool] = signers;
    jurors = signers.slice(5, 10); // 5 jurors

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

    const AUTHORIZED_CONTRACT_ROLE = await reputationScoring.AUTHORIZED_CONTRACT_ROLE();
    await reputationScoring.grantRole(AUTHORIZED_CONTRACT_ROLE, await contractFactory.getAddress());
    await reputationScoring.grantRole(AUTHORIZED_CONTRACT_ROLE, await disputeResolution.getAddress());

    const SYSTEM_ROLE = await contractFactory.SYSTEM_ROLE();
    await contractFactory.grantRole(SYSTEM_ROLE, await disputeResolution.getAddress());

    // Court setup
    await vjToken.mint(courtOperator.address, ethers.parseEther("10000"));
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

    await contractFactory.createContract(
      1,
      ethers.keccak256(ethers.toUtf8Bytes("params")),
      [party1.address, party2.address],
      ethers.parseEther("1")
    );
    await contractFactory.connect(party1).signContract(1);
    await contractFactory.connect(party2).signContract(1);

    // Jury pool + appeal stake funding
    await disputeResolution.setJurorPool(jurorPool.address);
    await vjToken.mint(party2.address, ethers.parseEther("1000"));
    await vjToken.connect(party2).approve(await disputeResolution.getAddress(), ethers.MaxUint256);
  });

  // Drive a dispute to the Finalized state with party2 liable.
  async function driveToFinalized() {
    await disputeResolution.connect(party1).fileDispute(1, claim, evidenceHash);
    await time.increase(EVIDENCE_PERIOD + 1);
    await disputeResolution.endEvidencePeriod(1);
    await disputeResolution.connect(courtOperator).submitRuling(
      1, party2.address, ethers.parseEther("0.5"), enforcementInstructions
    );
    await disputeResolution.finalizeDispute(1);
  }

  async function driveToAppealed() {
    await driveToFinalized();
    await disputeResolution.connect(party2).appeal(1, MIN_APPEAL_STAKE);
  }

  describe("setJurorPool", function () {
    it("Should reject zero address", async function () {
      await expect(disputeResolution.setJurorPool(ethers.ZeroAddress))
        .to.be.revertedWith("Invalid juror pool");
    });

    it("Should reject non-admin caller", async function () {
      await expect(disputeResolution.connect(party1).setJurorPool(jurorPool.address))
        .to.be.reverted;
    });
  });

  describe("Filing dispute — error branches", function () {
    it("Should reject filing on an inactive (not fully signed) contract", async function () {
      await contractFactory.createContract(
        1,
        ethers.keccak256(ethers.toUtf8Bytes("params2")),
        [party1.address, party2.address],
        ethers.parseEther("1")
      );
      // Only party1 signs -> contract not Active
      await contractFactory.connect(party1).signContract(2);
      await expect(
        disputeResolution.connect(party1).fileDispute(2, claim, evidenceHash)
      ).to.be.revertedWith("Contract not active");
    });
  });

  describe("Appeal filing", function () {
    it("Should file an appeal and move to Appealed state", async function () {
      await driveToFinalized();
      await expect(disputeResolution.connect(party2).appeal(1, MIN_APPEAL_STAKE))
        .to.emit(disputeResolution, "AppealFiled")
        .withArgs(1, party2.address, MIN_APPEAL_STAKE);

      const dispute = await disputeResolution.getDispute(1);
      expect(dispute.state).to.equal(DisputeState.Appealed);
      expect(await disputeResolution.hasAppeal(1)).to.be.true;
    });

    it("Should reject appeal on a non-existent dispute", async function () {
      await expect(disputeResolution.connect(party2).appeal(999, MIN_APPEAL_STAKE))
        .to.be.revertedWith("Dispute does not exist");
    });

    it("Should reject appeal when not finalized", async function () {
      await disputeResolution.connect(party1).fileDispute(1, claim, evidenceHash);
      await expect(disputeResolution.connect(party2).appeal(1, MIN_APPEAL_STAKE))
        .to.be.revertedWith("Dispute not finalized");
    });

    it("Should reject appeal after the appeal deadline", async function () {
      await driveToFinalized();
      await time.increase(APPEAL_PERIOD + 1);
      await expect(disputeResolution.connect(party2).appeal(1, MIN_APPEAL_STAKE))
        .to.be.revertedWith("Appeal deadline passed");
    });

    it("Should reject an under-funded appeal stake", async function () {
      await driveToFinalized();
      await expect(disputeResolution.connect(party2).appeal(1, MIN_APPEAL_STAKE - 1n))
        .to.be.revertedWith("Insufficient appeal stake");
    });

    it("Should reject appeal from a non-party", async function () {
      await driveToFinalized();
      await expect(disputeResolution.connect(owner).appeal(1, MIN_APPEAL_STAKE))
        .to.be.revertedWith("Not a party to dispute");
    });

    it("Should reject a second appeal once the dispute has left Finalized", async function () {
      await driveToAppealed();
      // State is now Appealed, so the finalized-state guard blocks any further appeal.
      await expect(disputeResolution.connect(party1).appeal(1, MIN_APPEAL_STAKE))
        .to.be.revertedWith("Dispute not finalized");
    });
  });

  describe("Jury assignment", function () {
    it("Should reject assignment from a non-jurorpool caller", async function () {
      await driveToAppealed();
      await expect(
        disputeResolution.connect(party1).assignJury(1, jurors.map(j => j.address))
      ).to.be.reverted;
    });

    it("Should reject assignment when not in Appealed state", async function () {
      await driveToFinalized();
      await expect(
        disputeResolution.connect(jurorPool).assignJury(1, jurors.map(j => j.address))
      ).to.be.revertedWith("Not in appealed state");
    });

    it("Should assign jury and move to JuryDeliberation", async function () {
      await driveToAppealed();
      await expect(
        disputeResolution.connect(jurorPool).assignJury(1, jurors.map(j => j.address))
      ).to.emit(disputeResolution, "JuryAssigned");

      const dispute = await disputeResolution.getDispute(1);
      expect(dispute.state).to.equal(DisputeState.JuryDeliberation);

      const appeal = await disputeResolution.getAppeal(1);
      expect(appeal.appellant).to.equal(party2.address);
      expect(appeal.stake).to.equal(MIN_APPEAL_STAKE);
    });
  });

  describe("Jury voting (commit-reveal)", function () {
    beforeEach(async function () {
      await driveToAppealed();
      await disputeResolution.connect(jurorPool).assignJury(1, jurors.map(j => j.address));
    });

    it("Should commit and reveal votes", async function () {
      await expect(disputeResolution.connect(jurors[0]).submitJuryVote(1, commit(respondentVote)))
        .to.emit(disputeResolution, "JuryVoteCommitted");

      // First commit moves to JuryVoting
      expect((await disputeResolution.getDispute(1)).state).to.equal(DisputeState.JuryVoting);

      await expect(disputeResolution.connect(jurors[0]).revealJuryVote(1, respondentVote, salt))
        .to.emit(disputeResolution, "JuryVoteRevealed");

      const appeal = await disputeResolution.getAppeal(1);
      expect(appeal.votesRevealed).to.equal(1);
    });

    it("Should reject a vote from a non-juror", async function () {
      await expect(disputeResolution.connect(owner).submitJuryVote(1, commit(respondentVote)))
        .to.be.revertedWith("Not a juror");
    });

    it("Should reject a double commit", async function () {
      await disputeResolution.connect(jurors[0]).submitJuryVote(1, commit(respondentVote));
      await expect(disputeResolution.connect(jurors[0]).submitJuryVote(1, commit(respondentVote)))
        .to.be.revertedWith("Already voted");
    });

    it("Should reject votes after the voting deadline", async function () {
      await time.increase(JURY_VOTING_PERIOD + 1);
      await expect(disputeResolution.connect(jurors[0]).submitJuryVote(1, commit(respondentVote)))
        .to.be.revertedWith("Voting deadline passed");
    });

    it("Should reject a reveal with no commitment", async function () {
      // move to JuryVoting via another juror's commit
      await disputeResolution.connect(jurors[1]).submitJuryVote(1, commit(respondentVote));
      await expect(disputeResolution.connect(jurors[0]).revealJuryVote(1, respondentVote, salt))
        .to.be.revertedWith("No vote committed");
    });

    it("Should reject a reveal that does not match the commitment", async function () {
      await disputeResolution.connect(jurors[0]).submitJuryVote(1, commit(respondentVote));
      await expect(disputeResolution.connect(jurors[0]).revealJuryVote(1, claimantVote, salt))
        .to.be.revertedWith("Invalid vote reveal");
    });

    it("Should reject a double reveal", async function () {
      await disputeResolution.connect(jurors[0]).submitJuryVote(1, commit(respondentVote));
      await disputeResolution.connect(jurors[0]).revealJuryVote(1, respondentVote, salt);
      await expect(disputeResolution.connect(jurors[0]).revealJuryVote(1, respondentVote, salt))
        .to.be.revertedWith("Already revealed");
    });
  });

  describe("Appeal finalization", function () {
    beforeEach(async function () {
      await driveToAppealed();
      await disputeResolution.connect(jurorPool).assignJury(1, jurors.map(j => j.address));
    });

    it("Should finalize and return stake when the appellant wins", async function () {
      // 3 jurors vote 'respondent' => respondent (party2 / appellant) wins,
      // new liable = claimant (party1). Stake returns to appellant.
      for (let i = 0; i < 3; i++) {
        await disputeResolution.connect(jurors[i]).submitJuryVote(1, commit(respondentVote));
      }
      for (let i = 0; i < 3; i++) {
        await disputeResolution.connect(jurors[i]).revealJuryVote(1, respondentVote, salt);
      }

      const balBefore = await vjToken.balanceOf(party2.address);
      await expect(disputeResolution.finalizeAppeal(1))
        .to.emit(disputeResolution, "AppealFinalized");

      const dispute = await disputeResolution.getDispute(1);
      expect(dispute.state).to.equal(DisputeState.AppealFinalized);

      const [liable] = await disputeResolution.getFinalRuling(1);
      expect(liable).to.equal(party1.address);

      // Stake (500) returned to appellant
      expect(await vjToken.balanceOf(party2.address)).to.equal(balBefore + MIN_APPEAL_STAKE);
    });

    it("Should keep the original ruling on a tie and NOT return stake", async function () {
      // 1 claimant, 1 respondent => tie; original liable (party2 = appellant) stands.
      await disputeResolution.connect(jurors[0]).submitJuryVote(1, commit(claimantVote));
      await disputeResolution.connect(jurors[1]).submitJuryVote(1, commit(respondentVote));
      await disputeResolution.connect(jurors[0]).revealJuryVote(1, claimantVote, salt);
      await disputeResolution.connect(jurors[1]).revealJuryVote(1, respondentVote, salt);

      // Not enough reveals (<3) — finalize via deadline instead.
      await time.increase(JURY_VOTING_PERIOD + 1);

      const balBefore = await vjToken.balanceOf(party2.address);
      await disputeResolution.finalizeAppeal(1);

      const [liable] = await disputeResolution.getFinalRuling(1);
      expect(liable).to.equal(party2.address); // original ruling stands
      expect(await vjToken.balanceOf(party2.address)).to.equal(balBefore); // no return
    });

    it("Should reject finalization before voting completes", async function () {
      await disputeResolution.connect(jurors[0]).submitJuryVote(1, commit(respondentVote));
      await disputeResolution.connect(jurors[0]).revealJuryVote(1, respondentVote, salt);
      await expect(disputeResolution.finalizeAppeal(1))
        .to.be.revertedWith("Voting not complete");
    });

    it("Should reject finalization when not in JuryVoting state", async function () {
      // Still JuryDeliberation (no commits yet)
      await expect(disputeResolution.finalizeAppeal(1))
        .to.be.revertedWith("Not in voting state");
    });

    it("Should permanently finalize an appeal-finalized dispute without time wait", async function () {
      for (let i = 0; i < 3; i++) {
        await disputeResolution.connect(jurors[i]).submitJuryVote(1, commit(claimantVote));
      }
      for (let i = 0; i < 3; i++) {
        await disputeResolution.connect(jurors[i]).revealJuryVote(1, claimantVote, salt);
      }
      await disputeResolution.finalizeAppeal(1);

      // AppealFinalized -> can permanently finalize immediately
      await disputeResolution.finalizeDisputePermanently(1);
      const contract = await contractFactory.getContract(1);
      expect(contract.state).to.equal(4); // Completed
    });
  });

  describe("State-guard error branches", function () {
    it("submitEvidence reverts on non-existent dispute", async function () {
      await expect(disputeResolution.connect(party1).submitEvidence(999, evidenceHash))
        .to.be.revertedWith("Dispute does not exist");
    });

    it("submitEvidence reverts with zero evidence hash", async function () {
      await disputeResolution.connect(party1).fileDispute(1, claim, evidenceHash);
      await expect(disputeResolution.connect(party1).submitEvidence(1, ethers.ZeroHash))
        .to.be.revertedWith("Evidence hash required");
    });

    it("submitEvidence reverts once past the evidence state", async function () {
      await driveToFinalized();
      await expect(disputeResolution.connect(party1).submitEvidence(1, evidenceHash))
        .to.be.revertedWith("Evidence period ended");
    });

    it("endEvidencePeriod reverts on non-existent dispute", async function () {
      await expect(disputeResolution.endEvidencePeriod(999))
        .to.be.revertedWith("Dispute does not exist");
    });

    it("endEvidencePeriod reverts when already past evidence", async function () {
      await driveToFinalized();
      await expect(disputeResolution.endEvidencePeriod(1))
        .to.be.revertedWith("Evidence period already ended");
    });

    it("submitRuling reverts on non-existent dispute", async function () {
      await expect(
        disputeResolution.connect(courtOperator).submitRuling(999, party2.address, 0, "0x")
      ).to.be.revertedWith("Dispute does not exist");
    });

    it("submitRuling reverts when not in ruling state", async function () {
      await disputeResolution.connect(party1).fileDispute(1, claim, evidenceHash);
      await expect(
        disputeResolution.connect(courtOperator).submitRuling(1, party2.address, 0, "0x")
      ).to.be.revertedWith("Not in ruling state");
    });

    it("submitRuling reverts when liable is not a party", async function () {
      await disputeResolution.connect(party1).fileDispute(1, claim, evidenceHash);
      await time.increase(EVIDENCE_PERIOD + 1);
      await disputeResolution.endEvidencePeriod(1);
      await expect(
        disputeResolution.connect(courtOperator).submitRuling(1, owner.address, 0, "0x")
      ).to.be.revertedWith("Liable party not in dispute");
    });

    it("finalizeDispute reverts on non-existent dispute", async function () {
      await expect(disputeResolution.finalizeDispute(999))
        .to.be.revertedWith("Dispute does not exist");
    });

    it("finalizeDispute reverts when not in ruling state", async function () {
      await disputeResolution.connect(party1).fileDispute(1, claim, evidenceHash);
      await expect(disputeResolution.finalizeDispute(1))
        .to.be.revertedWith("Not in ruling state");
    });

    it("finalizeDisputePermanently reverts on invalid state", async function () {
      await disputeResolution.connect(party1).fileDispute(1, claim, evidenceHash);
      await expect(disputeResolution.finalizeDisputePermanently(1))
        .to.be.revertedWith("Invalid state");
    });

    it("finalizeDisputePermanently reverts before appeal period ends", async function () {
      await driveToFinalized();
      await expect(disputeResolution.finalizeDisputePermanently(1))
        .to.be.revertedWith("Appeal period not ended");
    });

    it("recordCompliance reverts when no liable party", async function () {
      await disputeResolution.connect(party1).fileDispute(1, claim, evidenceHash);
      await time.increase(EVIDENCE_PERIOD + 1);
      await disputeResolution.endEvidencePeriod(1);
      await disputeResolution.connect(courtOperator).submitRuling(1, ethers.ZeroAddress, 0, "0x");
      await disputeResolution.finalizeDispute(1);
      await expect(disputeResolution.recordCompliance(1, true))
        .to.be.revertedWith("No liable party");
    });
  });

  describe("View error branches", function () {
    it("getAppeal reverts when no appeal exists", async function () {
      await expect(disputeResolution.getAppeal(1)).to.be.revertedWith("No appeal");
    });

    it("getFinalRuling reverts on non-existent dispute", async function () {
      await expect(disputeResolution.getFinalRuling(999))
        .to.be.revertedWith("Dispute does not exist");
    });

    it("getEnforcementInstructions reverts when no ruling", async function () {
      await disputeResolution.connect(party1).fileDispute(1, claim, evidenceHash);
      await expect(disputeResolution.getEnforcementInstructions(1))
        .to.be.revertedWith("No ruling");
    });

    it("hasAppeal returns false before any appeal", async function () {
      await disputeResolution.connect(party1).fileDispute(1, claim, evidenceHash);
      expect(await disputeResolution.hasAppeal(1)).to.be.false;
    });
  });
});
