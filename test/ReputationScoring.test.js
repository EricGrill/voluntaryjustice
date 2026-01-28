const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ReputationScoring", function () {
  let reputationScoring;
  let owner;
  let authorizedContract;
  let user1;
  let user2;

  beforeEach(async function () {
    [owner, authorizedContract, user1, user2] = await ethers.getSigners();

    const ReputationScoring = await ethers.getContractFactory("ReputationScoring");
    reputationScoring = await ReputationScoring.deploy(owner.address);
    await reputationScoring.waitForDeployment();

    // Grant authorized contract role
    const AUTHORIZED_CONTRACT_ROLE = await reputationScoring.AUTHORIZED_CONTRACT_ROLE();
    await reputationScoring.grantRole(AUTHORIZED_CONTRACT_ROLE, authorizedContract.address);
  });

  describe("Deployment", function () {
    it("Should grant admin role to deployer", async function () {
      const DEFAULT_ADMIN_ROLE = await reputationScoring.DEFAULT_ADMIN_ROLE();
      expect(await reputationScoring.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
    });

    it("Should return default scores for new address", async function () {
      const [compliance, disputeRate, paymentHistory, counterpartyRating] =
        await reputationScoring.getScores(user1.address);

      expect(compliance).to.equal(100); // Perfect default
      expect(disputeRate).to.equal(100); // Perfect default
      expect(paymentHistory).to.equal(100); // Perfect default
      expect(counterpartyRating).to.equal(50); // Neutral default
    });
  });

  describe("Compliance Recording", function () {
    it("Should record compliance with ruling", async function () {
      await reputationScoring.connect(authorizedContract).updateCompliance(user1.address, 1, true);

      const [compliance,,,] = await reputationScoring.getScores(user1.address);
      expect(compliance).to.equal(100);
    });

    it("Should emit ComplianceRecorded event", async function () {
      await expect(
        reputationScoring.connect(authorizedContract).updateCompliance(user1.address, 1, true)
      )
        .to.emit(reputationScoring, "ComplianceRecorded")
        .withArgs(user1.address, 1, true);
    });

    it("Should calculate compliance percentage correctly", async function () {
      await reputationScoring.connect(authorizedContract).updateCompliance(user1.address, 1, true);
      await reputationScoring.connect(authorizedContract).updateCompliance(user1.address, 2, true);
      await reputationScoring.connect(authorizedContract).updateCompliance(user1.address, 3, false);
      await reputationScoring.connect(authorizedContract).updateCompliance(user1.address, 4, false);

      const [compliance,,,] = await reputationScoring.getScores(user1.address);
      expect(compliance).to.equal(50); // 2/4 = 50%
    });

    it("Should reject calls from unauthorized address", async function () {
      await expect(
        reputationScoring.connect(user1).updateCompliance(user1.address, 1, true)
      ).to.be.reverted;
    });
  });

  describe("Dispute Recording", function () {
    beforeEach(async function () {
      // Record some contracts first
      await reputationScoring.connect(authorizedContract).recordContract(user1.address, 1);
      await reputationScoring.connect(authorizedContract).recordContract(user1.address, 2);
      await reputationScoring.connect(authorizedContract).recordContract(user1.address, 3);
      await reputationScoring.connect(authorizedContract).recordContract(user1.address, 4);
    });

    it("Should record dispute against address", async function () {
      await reputationScoring.connect(authorizedContract).recordDispute(user1.address, 1);

      const [, disputeRate,,] = await reputationScoring.getScores(user1.address);
      expect(disputeRate).to.equal(75); // 1/4 disputes = 25% dispute rate, so 75 score
    });

    it("Should emit DisputeRecorded event", async function () {
      await expect(
        reputationScoring.connect(authorizedContract).recordDispute(user1.address, 1)
      )
        .to.emit(reputationScoring, "DisputeRecorded")
        .withArgs(user1.address, 1);
    });

    it("Should calculate dispute rate correctly", async function () {
      await reputationScoring.connect(authorizedContract).recordDispute(user1.address, 1);
      await reputationScoring.connect(authorizedContract).recordDispute(user1.address, 2);

      const [, disputeRate,,] = await reputationScoring.getScores(user1.address);
      expect(disputeRate).to.equal(50); // 2/4 disputes = 50% rate, so 50 score
    });

    it("Should cap dispute rate at 0", async function () {
      // Add more disputes than contracts
      await reputationScoring.connect(authorizedContract).recordDispute(user1.address, 1);
      await reputationScoring.connect(authorizedContract).recordDispute(user1.address, 2);
      await reputationScoring.connect(authorizedContract).recordDispute(user1.address, 3);
      await reputationScoring.connect(authorizedContract).recordDispute(user1.address, 4);
      await reputationScoring.connect(authorizedContract).recordDispute(user1.address, 5);

      const [, disputeRate,,] = await reputationScoring.getScores(user1.address);
      expect(disputeRate).to.equal(0); // Capped at 0
    });
  });

  describe("Contract Recording", function () {
    it("Should record contract participation", async function () {
      await reputationScoring.connect(authorizedContract).recordContract(user1.address, 1);

      const [,, totalContracts,,,,,] = await reputationScoring.getRawData(user1.address);
      expect(totalContracts).to.equal(1);
    });

    it("Should emit ContractRecorded event", async function () {
      await expect(
        reputationScoring.connect(authorizedContract).recordContract(user1.address, 1)
      )
        .to.emit(reputationScoring, "ContractRecorded")
        .withArgs(user1.address, 1);
    });
  });

  describe("Payment Recording", function () {
    it("Should record on-time payment", async function () {
      await reputationScoring.connect(authorizedContract).recordPayment(
        user1.address,
        ethers.parseEther("100"),
        3 // 3 days to settle
      );

      const [,, paymentHistory,] = await reputationScoring.getScores(user1.address);
      expect(paymentHistory).to.equal(100); // On-time (within 7 days)
    });

    it("Should record late payment", async function () {
      await reputationScoring.connect(authorizedContract).recordPayment(
        user1.address,
        ethers.parseEther("100"),
        14 // 14 days to settle (late)
      );

      const [,, paymentHistory,] = await reputationScoring.getScores(user1.address);
      expect(paymentHistory).to.equal(0); // Late payment
    });

    it("Should emit PaymentRecorded event", async function () {
      await expect(
        reputationScoring.connect(authorizedContract).recordPayment(
          user1.address,
          ethers.parseEther("100"),
          5
        )
      )
        .to.emit(reputationScoring, "PaymentRecorded")
        .withArgs(user1.address, ethers.parseEther("100"), 5);
    });

    it("Should calculate payment history percentage", async function () {
      await reputationScoring.connect(authorizedContract).recordPayment(user1.address, 100, 3);
      await reputationScoring.connect(authorizedContract).recordPayment(user1.address, 100, 5);
      await reputationScoring.connect(authorizedContract).recordPayment(user1.address, 100, 10);
      await reputationScoring.connect(authorizedContract).recordPayment(user1.address, 100, 20);

      const [,, paymentHistory,] = await reputationScoring.getScores(user1.address);
      expect(paymentHistory).to.equal(50); // 2/4 on-time
    });

    it("Should calculate average days to settle", async function () {
      await reputationScoring.connect(authorizedContract).recordPayment(user1.address, 100, 2);
      await reputationScoring.connect(authorizedContract).recordPayment(user1.address, 100, 4);
      await reputationScoring.connect(authorizedContract).recordPayment(user1.address, 100, 6);

      const avgDays = await reputationScoring.getAverageDaysToSettle(user1.address);
      expect(avgDays).to.equal(4); // (2+4+6)/3 = 4
    });
  });

  describe("Rating Submission", function () {
    it("Should submit rating", async function () {
      await reputationScoring.connect(authorizedContract).submitRating(user1.address, user2.address, 80);

      const [,,, counterpartyRating] = await reputationScoring.getScores(user2.address);
      expect(counterpartyRating).to.equal(80);
    });

    it("Should emit RatingSubmitted event", async function () {
      await expect(
        reputationScoring.connect(authorizedContract).submitRating(user1.address, user2.address, 80)
      )
        .to.emit(reputationScoring, "RatingSubmitted")
        .withArgs(user1.address, user2.address, 80);
    });

    it("Should calculate average rating", async function () {
      await reputationScoring.connect(authorizedContract).submitRating(user1.address, user2.address, 80);
      await reputationScoring.connect(authorizedContract).submitRating(owner.address, user2.address, 60);

      const [,,, counterpartyRating] = await reputationScoring.getScores(user2.address);
      expect(counterpartyRating).to.equal(70); // (80+60)/2 = 70
    });

    it("Should reject rating above 100", async function () {
      await expect(
        reputationScoring.connect(authorizedContract).submitRating(user1.address, user2.address, 101)
      ).to.be.revertedWith("Score must be 0-100");
    });

    it("Should reject self-rating", async function () {
      await expect(
        reputationScoring.connect(authorizedContract).submitRating(user1.address, user1.address, 80)
      ).to.be.revertedWith("Cannot rate yourself");
    });
  });

  describe("Raw Data", function () {
    it("Should return correct raw data", async function () {
      await reputationScoring.connect(authorizedContract).updateCompliance(user1.address, 1, true);
      await reputationScoring.connect(authorizedContract).recordContract(user1.address, 1);
      await reputationScoring.connect(authorizedContract).recordDispute(user1.address, 1);
      await reputationScoring.connect(authorizedContract).recordPayment(user1.address, 100, 5);
      await reputationScoring.connect(authorizedContract).submitRating(user2.address, user1.address, 75);

      const [
        totalRulings,
        compliedRulings,
        totalContracts,
        disputesAgainst,
        totalPayments,
        onTimePayments,
        totalRatings,
        sumRatings
      ] = await reputationScoring.getRawData(user1.address);

      expect(totalRulings).to.equal(1);
      expect(compliedRulings).to.equal(1);
      expect(totalContracts).to.equal(1);
      expect(disputesAgainst).to.equal(1);
      expect(totalPayments).to.equal(1);
      expect(onTimePayments).to.equal(1);
      expect(totalRatings).to.equal(1);
      expect(sumRatings).to.equal(75);
    });
  });
});
