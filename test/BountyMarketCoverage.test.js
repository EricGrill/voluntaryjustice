const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * Coverage-focused suite for BountyMarket. Drives the legacy-court-judgment
 * and debtor-confirmation proof flows, the dispute / resolve flows, oracle
 * removal, and every require/status guard the main spec does not hit.
 */
describe("BountyMarket — Coverage", function () {
  let bountyMarket, disputeResolution, vjToken;
  let contractFactory, templateRegistry, courtRegistry, reputationScoring;
  let owner, creditor, debtor, hunter, oracle1, oracle2, oracle3, courtOperator;

  const EVIDENCE_PERIOD = 7 * 24 * 60 * 60;
  const DISPUTE_PERIOD = 7 * 24 * 60 * 60;
  const PROOF = ProofType();

  function ProofType() {
    return { OracleAttestation: 0, LegacyCourtJudgment: 1, DebtorConfirmation: 2 };
  }

  beforeEach(async function () {
    [owner, creditor, debtor, hunter, oracle1, oracle2, oracle3, courtOperator] = await ethers.getSigners();

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

    const BountyMarket = await ethers.getContractFactory("BountyMarket");
    bountyMarket = await BountyMarket.deploy(
      owner.address,
      await vjToken.getAddress(),
      await disputeResolution.getAddress()
    );

    const AUTHORIZED_CONTRACT_ROLE = await reputationScoring.AUTHORIZED_CONTRACT_ROLE();
    await reputationScoring.grantRole(AUTHORIZED_CONTRACT_ROLE, await contractFactory.getAddress());
    await reputationScoring.grantRole(AUTHORIZED_CONTRACT_ROLE, await disputeResolution.getAddress());

    const SYSTEM_ROLE = await contractFactory.SYSTEM_ROLE();
    await contractFactory.grantRole(SYSTEM_ROLE, await disputeResolution.getAddress());

    await vjToken.mint(creditor.address, ethers.parseEther("10000"));
    await vjToken.mint(courtOperator.address, ethers.parseEther("10000"));
    await vjToken.connect(creditor).approve(await bountyMarket.getAddress(), ethers.MaxUint256);
    await vjToken.connect(courtOperator).approve(await courtRegistry.getAddress(), ethers.MaxUint256);

    await courtRegistry.connect(courtOperator).registerCourt(
      "Test Court",
      ethers.parseEther("1000"),
      ethers.keccak256(ethers.toUtf8Bytes("rules"))
    );

    await templateRegistry.registerTemplate(
      ethers.keccak256(ethers.toUtf8Bytes("template")),
      "Test Template",
      courtOperator.address,
      0
    );
  });

  // Finalize dispute 1 with `debtor` liable (so creditor=claimant=creditor signer).
  async function createFinalizedDispute(restitution = ethers.parseEther("0.5")) {
    await contractFactory.createContract(
      1,
      ethers.keccak256(ethers.toUtf8Bytes("params")),
      [creditor.address, debtor.address],
      ethers.parseEther("1")
    );
    await contractFactory.connect(creditor).signContract(1);
    await contractFactory.connect(debtor).signContract(1);

    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("evidence"));
    await disputeResolution.connect(creditor).fileDispute(1, "Breach", evidenceHash);
    await time.increase(EVIDENCE_PERIOD + 1);
    await disputeResolution.endEvidencePeriod(1);
    await disputeResolution.connect(courtOperator).submitRuling(
      1, debtor.address, restitution, ethers.toUtf8Bytes("Pay damages")
    );
    await disputeResolution.finalizeDispute(1);
  }

  async function createBounty(amount = ethers.parseEther("100")) {
    const deadline = (await time.latest()) + 30 * 24 * 60 * 60;
    await bountyMarket.connect(creditor).createBounty(1, amount, deadline);
  }

  describe("removeOracle", function () {
    it("rejects removing an address that is not an oracle", async function () {
      await expect(bountyMarket.removeOracle(oracle1.address))
        .to.be.revertedWith("Not an oracle");
    });

    it("removes an oracle from the middle of the registry array", async function () {
      await bountyMarket.registerOracle(oracle1.address);
      await bountyMarket.registerOracle(oracle2.address);
      await bountyMarket.registerOracle(oracle3.address);
      expect(await bountyMarket.oracleCount()).to.equal(3);

      await expect(bountyMarket.removeOracle(oracle1.address))
        .to.emit(bountyMarket, "OracleRemoved").withArgs(oracle1.address);
      expect(await bountyMarket.isOracle(oracle1.address)).to.be.false;
      expect(await bountyMarket.oracleCount()).to.equal(2);
    });

    it("rejects registering the zero address", async function () {
      await expect(bountyMarket.registerOracle(ethers.ZeroAddress))
        .to.be.revertedWith("Invalid oracle address");
    });

    it("rejects oracle management from a non-governance caller", async function () {
      await expect(bountyMarket.connect(hunter).registerOracle(oracle1.address)).to.be.reverted;
    });
  });

  describe("createBounty require branches", function () {
    it("rejects when there is no liable party for the ruling", async function () {
      // ruling id 1 never created -> getFinalRuling reverts on non-existent dispute
      const deadline = (await time.latest()) + 1000;
      await expect(bountyMarket.connect(creditor).createBounty(1, ethers.parseEther("100"), deadline))
        .to.be.reverted;
    });

    it("rejects when restitution amount is zero", async function () {
      await createFinalizedDispute(0); // liable set, restitution 0
      const deadline = (await time.latest()) + 1000;
      await expect(bountyMarket.connect(creditor).createBounty(1, ethers.parseEther("100"), deadline))
        .to.be.revertedWith("No restitution amount");
    });

    it("creates and sets the creditor to the non-liable party", async function () {
      await createFinalizedDispute();
      await createBounty();
      const bounty = await bountyMarket.getBounty(1);
      expect(bounty.debtor).to.equal(debtor.address);
      expect(bounty.creditor).to.equal(creditor.address);
      expect(bounty.status).to.equal(0); // Active
    });
  });

  describe("claimBounty error branches", function () {
    beforeEach(async function () {
      await createFinalizedDispute();
      await createBounty();
    });

    it("rejects claiming a bounty that is not Active (already claimed)", async function () {
      await bountyMarket.connect(hunter).claimBounty(1, PROOF.OracleAttestation, ethers.toUtf8Bytes("p"));
      await expect(
        bountyMarket.connect(hunter).claimBounty(1, PROOF.OracleAttestation, ethers.toUtf8Bytes("p2"))
      ).to.be.revertedWith("Bounty not active");
    });

    it("rejects claiming after the deadline", async function () {
      await time.increase(31 * 24 * 60 * 60);
      await expect(
        bountyMarket.connect(hunter).claimBounty(1, PROOF.OracleAttestation, ethers.toUtf8Bytes("p"))
      ).to.be.revertedWith("Bounty expired");
    });
  });

  describe("verifyOracleAttestation branches", function () {
    beforeEach(async function () {
      await createFinalizedDispute();
      await createBounty();
      await bountyMarket.registerOracle(oracle1.address);
      await bountyMarket.registerOracle(oracle2.address);
      await bountyMarket.registerOracle(oracle3.address);
    });

    it("rejects attestation on a non-existent bounty", async function () {
      await expect(bountyMarket.connect(oracle1).verifyOracleAttestation(999))
        .to.be.revertedWith("Bounty does not exist");
    });

    it("rejects attestation when the bounty is not Claimed", async function () {
      await expect(bountyMarket.connect(oracle1).verifyOracleAttestation(1))
        .to.be.revertedWith("Bounty not claimed");
    });

    it("rejects attestation when the claim proof type is not OracleAttestation", async function () {
      await bountyMarket.connect(hunter).claimBounty(1, PROOF.DebtorConfirmation, ethers.toUtf8Bytes("p"));
      await expect(bountyMarket.connect(oracle1).verifyOracleAttestation(1))
        .to.be.revertedWith("Wrong proof type");
    });

    it("does NOT auto-pay while the claim is disputed even with enough attestations", async function () {
      await bountyMarket.connect(hunter).claimBounty(1, PROOF.OracleAttestation, ethers.toUtf8Bytes("p"));
      // Creditor disputes -> status becomes Disputed, attestations now revert (not Claimed)
      await bountyMarket.connect(creditor).disputeBountyClaim(1, ethers.toUtf8Bytes("ev"));
      await expect(bountyMarket.connect(oracle1).verifyOracleAttestation(1))
        .to.be.revertedWith("Bounty not claimed");
    });
  });

  describe("verifyLegacyCourtJudgment", function () {
    beforeEach(async function () {
      await createFinalizedDispute();
      await createBounty();
    });

    it("rejects a non-existent bounty", async function () {
      await expect(bountyMarket.verifyLegacyCourtJudgment(999, ethers.keccak256(ethers.toUtf8Bytes("j"))))
        .to.be.revertedWith("Bounty does not exist");
    });

    it("rejects when bounty is not Claimed", async function () {
      await expect(bountyMarket.verifyLegacyCourtJudgment(1, ethers.keccak256(ethers.toUtf8Bytes("j"))))
        .to.be.revertedWith("Bounty not claimed");
    });

    it("rejects the wrong proof type", async function () {
      await bountyMarket.connect(hunter).claimBounty(1, PROOF.OracleAttestation, ethers.toUtf8Bytes("p"));
      await expect(bountyMarket.verifyLegacyCourtJudgment(1, ethers.keccak256(ethers.toUtf8Bytes("j"))))
        .to.be.revertedWith("Wrong proof type");
    });

    it("rejects an invalid (zero) judgment hash", async function () {
      await bountyMarket.connect(hunter).claimBounty(1, PROOF.LegacyCourtJudgment, ethers.toUtf8Bytes("p"));
      await expect(bountyMarket.verifyLegacyCourtJudgment(1, ethers.ZeroHash))
        .to.be.revertedWith("Invalid judgment hash");
    });

    it("rejects a non-governance caller", async function () {
      await bountyMarket.connect(hunter).claimBounty(1, PROOF.LegacyCourtJudgment, ethers.toUtf8Bytes("p"));
      await expect(
        bountyMarket.connect(hunter).verifyLegacyCourtJudgment(1, ethers.keccak256(ethers.toUtf8Bytes("j")))
      ).to.be.reverted;
    });

    it("pays the hunter on a valid legacy court judgment", async function () {
      await bountyMarket.connect(hunter).claimBounty(1, PROOF.LegacyCourtJudgment, ethers.toUtf8Bytes("p"));
      const before = await vjToken.balanceOf(hunter.address);
      await expect(bountyMarket.verifyLegacyCourtJudgment(1, ethers.keccak256(ethers.toUtf8Bytes("j"))))
        .to.emit(bountyMarket, "BountyPaid");
      const after = await vjToken.balanceOf(hunter.address);
      expect(after - before).to.equal(ethers.parseEther("100"));
      expect((await bountyMarket.getBounty(1)).status).to.equal(3); // Paid
    });
  });

  describe("verifyDebtorConfirmation", function () {
    beforeEach(async function () {
      await createFinalizedDispute();
      await createBounty();
    });

    async function debtorSig(signer, restitution, bountyId) {
      const messageHash = ethers.solidityPackedKeccak256(
        ["string", "uint256", "string", "uint256"],
        ["I confirm restitution of ", restitution, " for bounty ", bountyId]
      );
      return signer.signMessage(ethers.getBytes(messageHash));
    }

    it("rejects a non-existent bounty", async function () {
      await expect(bountyMarket.verifyDebtorConfirmation(999, "0x1234"))
        .to.be.revertedWith("Bounty does not exist");
    });

    it("rejects when bounty is not Claimed", async function () {
      const sig = await debtorSig(debtor, ethers.parseEther("0.5"), 1);
      await expect(bountyMarket.verifyDebtorConfirmation(1, sig))
        .to.be.revertedWith("Bounty not claimed");
    });

    it("rejects the wrong proof type", async function () {
      await bountyMarket.connect(hunter).claimBounty(1, PROOF.OracleAttestation, ethers.toUtf8Bytes("p"));
      const sig = await debtorSig(debtor, ethers.parseEther("0.5"), 1);
      await expect(bountyMarket.verifyDebtorConfirmation(1, sig))
        .to.be.revertedWith("Wrong proof type");
    });

    it("rejects a signature from a non-debtor", async function () {
      await bountyMarket.connect(hunter).claimBounty(1, PROOF.DebtorConfirmation, ethers.toUtf8Bytes("p"));
      const sig = await debtorSig(creditor, ethers.parseEther("0.5"), 1); // wrong signer
      await expect(bountyMarket.verifyDebtorConfirmation(1, sig))
        .to.be.revertedWith("Invalid debtor signature");
    });

    it("pays the hunter on a valid debtor confirmation signature", async function () {
      await bountyMarket.connect(hunter).claimBounty(1, PROOF.DebtorConfirmation, ethers.toUtf8Bytes("p"));
      const sig = await debtorSig(debtor, ethers.parseEther("0.5"), 1);
      const before = await vjToken.balanceOf(hunter.address);
      await expect(bountyMarket.verifyDebtorConfirmation(1, sig))
        .to.emit(bountyMarket, "BountyPaid");
      const after = await vjToken.balanceOf(hunter.address);
      expect(after - before).to.equal(ethers.parseEther("100"));
    });
  });

  describe("disputeBountyClaim branches", function () {
    beforeEach(async function () {
      await createFinalizedDispute();
      await createBounty();
      await bountyMarket.connect(hunter).claimBounty(1, PROOF.OracleAttestation, ethers.toUtf8Bytes("p"));
    });

    it("rejects a non-existent bounty", async function () {
      await expect(bountyMarket.connect(creditor).disputeBountyClaim(999, ethers.toUtf8Bytes("e")))
        .to.be.revertedWith("Bounty does not exist");
    });

    it("allows the debtor to dispute", async function () {
      await bountyMarket.connect(debtor).disputeBountyClaim(1, ethers.toUtf8Bytes("e"));
      expect((await bountyMarket.getBounty(1)).status).to.equal(2); // Disputed
    });

    it("rejects empty evidence", async function () {
      await expect(bountyMarket.connect(creditor).disputeBountyClaim(1, "0x"))
        .to.be.revertedWith("Evidence required");
    });

    it("rejects a second dispute (status no longer Claimed)", async function () {
      await bountyMarket.connect(creditor).disputeBountyClaim(1, ethers.toUtf8Bytes("e"));
      await expect(bountyMarket.connect(debtor).disputeBountyClaim(1, ethers.toUtf8Bytes("e2")))
        .to.be.revertedWith("Bounty not claimed");
    });

    it("rejects a dispute after the dispute period ends", async function () {
      await time.increase(DISPUTE_PERIOD + 1);
      await expect(bountyMarket.connect(creditor).disputeBountyClaim(1, ethers.toUtf8Bytes("e")))
        .to.be.revertedWith("Dispute period ended");
    });
  });

  describe("resolveDispute branches", function () {
    beforeEach(async function () {
      await createFinalizedDispute();
      await createBounty();
      await bountyMarket.connect(hunter).claimBounty(1, PROOF.OracleAttestation, ethers.toUtf8Bytes("p"));
      await bountyMarket.connect(creditor).disputeBountyClaim(1, ethers.toUtf8Bytes("e"));
    });

    it("rejects resolving a non-disputed bounty", async function () {
      await createBounty(ethers.parseEther("50")); // bounty 2, Active (not disputed)
      await expect(bountyMarket.resolveDispute(2, true))
        .to.be.revertedWith("Not disputed");
    });

    it("rejects a non-existent bounty", async function () {
      await expect(bountyMarket.resolveDispute(999, true))
        .to.be.revertedWith("Bounty does not exist");
    });

    it("pays the hunter when payHunter is true", async function () {
      const before = await vjToken.balanceOf(hunter.address);
      await expect(bountyMarket.resolveDispute(1, true)).to.emit(bountyMarket, "BountyPaid");
      const after = await vjToken.balanceOf(hunter.address);
      expect(after - before).to.equal(ethers.parseEther("100"));
      expect((await bountyMarket.getBounty(1)).status).to.equal(3); // Paid
    });

    it("returns funds to the creditor and cancels when payHunter is false", async function () {
      const before = await vjToken.balanceOf(creditor.address);
      await expect(bountyMarket.resolveDispute(1, false)).to.emit(bountyMarket, "BountyCancelled");
      const after = await vjToken.balanceOf(creditor.address);
      expect(after - before).to.equal(ethers.parseEther("100"));
      expect((await bountyMarket.getBounty(1)).status).to.equal(5); // Cancelled
    });

    it("rejects a non-governance caller", async function () {
      await expect(bountyMarket.connect(hunter).resolveDispute(1, true)).to.be.reverted;
    });
  });

  describe("cancelExpiredBounty branches", function () {
    it("rejects a non-existent bounty", async function () {
      await expect(bountyMarket.cancelExpiredBounty(999))
        .to.be.revertedWith("Bounty does not exist");
    });

    it("rejects cancelling a bounty that is not Active", async function () {
      await createFinalizedDispute();
      await createBounty();
      await bountyMarket.connect(hunter).claimBounty(1, PROOF.OracleAttestation, ethers.toUtf8Bytes("p"));
      await time.increase(31 * 24 * 60 * 60);
      await expect(bountyMarket.cancelExpiredBounty(1))
        .to.be.revertedWith("Bounty not active");
    });
  });

  describe("getClaim view", function () {
    it("returns an empty claim for a bounty with no claim", async function () {
      await createFinalizedDispute();
      await createBounty();
      const claim = await bountyMarket.getClaim(1);
      expect(claim.hunter).to.equal(ethers.ZeroAddress);
    });
  });
});
