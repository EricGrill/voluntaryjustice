const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("CourtRegistry", function () {
  let courtRegistry;
  let vjToken;
  let owner;
  let operator1;
  let operator2;
  let user1;

  const MIN_STAKE = ethers.parseEther("1000");
  const UNSTAKE_TIMELOCK = 14 * 24 * 60 * 60; // 14 days in seconds
  const metadata = "ipfs://QmCourtDetails";
  const rulesetHash = ethers.keccak256(ethers.toUtf8Bytes("court-ruleset-v1"));

  beforeEach(async function () {
    [owner, operator1, operator2, user1] = await ethers.getSigners();

    // Deploy VJToken
    const VJToken = await ethers.getContractFactory("VJToken");
    vjToken = await VJToken.deploy(owner.address);
    await vjToken.waitForDeployment();

    // Deploy CourtRegistry
    const CourtRegistry = await ethers.getContractFactory("CourtRegistry");
    courtRegistry = await CourtRegistry.deploy(owner.address, await vjToken.getAddress());
    await courtRegistry.waitForDeployment();

    // Mint tokens and approve for operators
    await vjToken.mint(operator1.address, ethers.parseEther("10000"));
    await vjToken.mint(operator2.address, ethers.parseEther("10000"));
    await vjToken.connect(operator1).approve(await courtRegistry.getAddress(), ethers.MaxUint256);
    await vjToken.connect(operator2).approve(await courtRegistry.getAddress(), ethers.MaxUint256);
  });

  describe("Deployment", function () {
    it("Should set correct VJ token", async function () {
      expect(await courtRegistry.vjToken()).to.equal(await vjToken.getAddress());
    });

    it("Should grant governance role to deployer", async function () {
      const GOVERNANCE_ROLE = await courtRegistry.GOVERNANCE_ROLE();
      expect(await courtRegistry.hasRole(GOVERNANCE_ROLE, owner.address)).to.be.true;
    });

    it("Should start with zero courts", async function () {
      expect(await courtRegistry.totalCourts()).to.equal(0);
      expect(await courtRegistry.activeCourtCount()).to.equal(0);
    });

    it("Should reject deployment with invalid token", async function () {
      const CourtRegistry = await ethers.getContractFactory("CourtRegistry");
      await expect(
        CourtRegistry.deploy(owner.address, ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid token address");
    });
  });

  describe("Court Registration", function () {
    it("Should register a new court", async function () {
      await courtRegistry.connect(operator1).registerCourt(metadata, MIN_STAKE, rulesetHash);

      expect(await courtRegistry.totalCourts()).to.equal(1);
      expect(await courtRegistry.activeCourtCount()).to.equal(1);
    });

    it("Should emit CourtRegistered event", async function () {
      await expect(
        courtRegistry.connect(operator1).registerCourt(metadata, MIN_STAKE, rulesetHash)
      )
        .to.emit(courtRegistry, "CourtRegistered")
        .withArgs(1, operator1.address, MIN_STAKE);
    });

    it("Should store correct court data", async function () {
      await courtRegistry.connect(operator1).registerCourt(metadata, MIN_STAKE, rulesetHash);

      const court = await courtRegistry.getCourt(1);
      expect(court.id).to.equal(1);
      expect(court.operator).to.equal(operator1.address);
      expect(court.metadata).to.equal(metadata);
      expect(court.rulesetHash).to.equal(rulesetHash);
      expect(court.stakedAmount).to.equal(MIN_STAKE);
      expect(court.active).to.be.true;
    });

    it("Should transfer stake from operator", async function () {
      const balanceBefore = await vjToken.balanceOf(operator1.address);
      await courtRegistry.connect(operator1).registerCourt(metadata, MIN_STAKE, rulesetHash);
      const balanceAfter = await vjToken.balanceOf(operator1.address);

      expect(balanceBefore - balanceAfter).to.equal(MIN_STAKE);
    });

    it("Should track operator to court mapping", async function () {
      await courtRegistry.connect(operator1).registerCourt(metadata, MIN_STAKE, rulesetHash);

      expect(await courtRegistry.getCourtByOperator(operator1.address)).to.equal(1);
    });

    it("Should reject registration with insufficient stake", async function () {
      await expect(
        courtRegistry.connect(operator1).registerCourt(metadata, MIN_STAKE - 1n, rulesetHash)
      ).to.be.revertedWith("Insufficient stake");
    });

    it("Should reject registration without metadata", async function () {
      await expect(
        courtRegistry.connect(operator1).registerCourt("", MIN_STAKE, rulesetHash)
      ).to.be.revertedWith("Metadata required");
    });

    it("Should reject registration without ruleset hash", async function () {
      await expect(
        courtRegistry.connect(operator1).registerCourt(metadata, MIN_STAKE, ethers.ZeroHash)
      ).to.be.revertedWith("Ruleset hash required");
    });

    it("Should reject duplicate registration", async function () {
      await courtRegistry.connect(operator1).registerCourt(metadata, MIN_STAKE, rulesetHash);
      await expect(
        courtRegistry.connect(operator1).registerCourt(metadata, MIN_STAKE, rulesetHash)
      ).to.be.revertedWith("Already registered as court");
    });
  });

  describe("Stake Management", function () {
    beforeEach(async function () {
      await courtRegistry.connect(operator1).registerCourt(metadata, MIN_STAKE, rulesetHash);
    });

    it("Should increase stake", async function () {
      const additionalStake = ethers.parseEther("500");
      await courtRegistry.connect(operator1).increaseStake(1, additionalStake);

      const court = await courtRegistry.getCourt(1);
      expect(court.stakedAmount).to.equal(MIN_STAKE + additionalStake);
    });

    it("Should emit CourtStakeIncreased event", async function () {
      const additionalStake = ethers.parseEther("500");
      await expect(courtRegistry.connect(operator1).increaseStake(1, additionalStake))
        .to.emit(courtRegistry, "CourtStakeIncreased")
        .withArgs(1, additionalStake, MIN_STAKE + additionalStake);
    });

    it("Should reject stake increase from non-operator", async function () {
      await expect(
        courtRegistry.connect(operator2).increaseStake(1, ethers.parseEther("100"))
      ).to.be.revertedWith("Not court operator");
    });
  });

  describe("Unstaking", function () {
    beforeEach(async function () {
      await courtRegistry.connect(operator1).registerCourt(
        metadata,
        ethers.parseEther("2000"),
        rulesetHash
      );
    });

    it("Should request partial unstake", async function () {
      const unstakeAmount = ethers.parseEther("500");
      await courtRegistry.connect(operator1).requestUnstake(1, unstakeAmount);

      const court = await courtRegistry.getCourt(1);
      expect(court.pendingUnstake).to.equal(unstakeAmount);
      expect(court.active).to.be.true;
    });

    it("Should emit CourtUnstakeRequested event", async function () {
      const unstakeAmount = ethers.parseEther("500");
      const expectedUnlockTime = (await time.latest()) + UNSTAKE_TIMELOCK + 1;

      await expect(courtRegistry.connect(operator1).requestUnstake(1, unstakeAmount))
        .to.emit(courtRegistry, "CourtUnstakeRequested");
    });

    it("Should complete unstake after timelock", async function () {
      const unstakeAmount = ethers.parseEther("500");
      await courtRegistry.connect(operator1).requestUnstake(1, unstakeAmount);

      await time.increase(UNSTAKE_TIMELOCK);

      const balanceBefore = await vjToken.balanceOf(operator1.address);
      await courtRegistry.connect(operator1).completeUnstake(1);
      const balanceAfter = await vjToken.balanceOf(operator1.address);

      expect(balanceAfter - balanceBefore).to.equal(unstakeAmount);

      const court = await courtRegistry.getCourt(1);
      expect(court.pendingUnstake).to.equal(0);
      expect(court.stakedAmount).to.equal(ethers.parseEther("1500"));
    });

    it("Should reject complete unstake before timelock", async function () {
      await courtRegistry.connect(operator1).requestUnstake(1, ethers.parseEther("500"));

      await expect(
        courtRegistry.connect(operator1).completeUnstake(1)
      ).to.be.revertedWith("Timelock not expired");
    });

    it("Should deactivate court on full unstake request", async function () {
      await courtRegistry.connect(operator1).requestUnstake(1, ethers.parseEther("2000"));

      const court = await courtRegistry.getCourt(1);
      expect(court.active).to.be.false;
      expect(await courtRegistry.activeCourtCount()).to.equal(0);
    });

    it("Should reject unstake leaving insufficient stake", async function () {
      await expect(
        courtRegistry.connect(operator1).requestUnstake(1, ethers.parseEther("1500"))
      ).to.be.revertedWith("Would leave insufficient stake");
    });

    it("Should cancel pending unstake", async function () {
      await courtRegistry.connect(operator1).requestUnstake(1, ethers.parseEther("500"));
      await courtRegistry.connect(operator1).cancelUnstake(1);

      const court = await courtRegistry.getCourt(1);
      expect(court.pendingUnstake).to.equal(0);
    });

    it("Should reactivate court on cancel full unstake", async function () {
      await courtRegistry.connect(operator1).requestUnstake(1, ethers.parseEther("2000"));
      await courtRegistry.connect(operator1).cancelUnstake(1);

      const court = await courtRegistry.getCourt(1);
      expect(court.active).to.be.true;
      expect(await courtRegistry.activeCourtCount()).to.equal(1);
    });
  });

  describe("Slashing", function () {
    beforeEach(async function () {
      await courtRegistry.connect(operator1).registerCourt(
        metadata,
        ethers.parseEther("2000"),
        rulesetHash
      );
    });

    it("Should slash court stake", async function () {
      const slashAmount = ethers.parseEther("500");
      await courtRegistry.slashCourt(1, slashAmount, "Misconduct");

      const court = await courtRegistry.getCourt(1);
      expect(court.stakedAmount).to.equal(ethers.parseEther("1500"));
    });

    it("Should emit CourtSlashed event", async function () {
      await expect(courtRegistry.slashCourt(1, ethers.parseEther("500"), "Misconduct"))
        .to.emit(courtRegistry, "CourtSlashed")
        .withArgs(1, ethers.parseEther("500"), "Misconduct");
    });

    it("Should deactivate court if stake falls below minimum", async function () {
      await courtRegistry.slashCourt(1, ethers.parseEther("1500"), "Severe misconduct");

      const court = await courtRegistry.getCourt(1);
      expect(court.active).to.be.false;
    });

    it("Should reject slashing from non-governance", async function () {
      await expect(
        courtRegistry.connect(operator1).slashCourt(1, ethers.parseEther("100"), "Reason")
      ).to.be.reverted;
    });

    it("Should reject slashing more than stake", async function () {
      await expect(
        courtRegistry.slashCourt(1, ethers.parseEther("3000"), "Reason")
      ).to.be.revertedWith("Amount exceeds stake");
    });
  });

  describe("Case Recording", function () {
    beforeEach(async function () {
      await courtRegistry.connect(operator1).registerCourt(metadata, MIN_STAKE, rulesetHash);
    });

    it("Should record case outcome", async function () {
      await courtRegistry.recordCase(1, true);
      await courtRegistry.recordCase(1, false);

      const court = await courtRegistry.getCourt(1);
      expect(court.totalCases).to.equal(2);
      expect(court.casesWon).to.equal(1);
    });

    it("Should emit CaseRecorded event", async function () {
      await expect(courtRegistry.recordCase(1, true))
        .to.emit(courtRegistry, "CaseRecorded")
        .withArgs(1, true);
    });

    it("Should reject case recording from non-governance", async function () {
      await expect(
        courtRegistry.connect(operator1).recordCase(1, true)
      ).to.be.reverted;
    });
  });

  describe("Metadata Update", function () {
    beforeEach(async function () {
      await courtRegistry.connect(operator1).registerCourt(metadata, MIN_STAKE, rulesetHash);
    });

    it("Should update metadata", async function () {
      const newMetadata = "ipfs://QmUpdatedCourt";
      await courtRegistry.connect(operator1).updateMetadata(1, newMetadata);

      const court = await courtRegistry.getCourt(1);
      expect(court.metadata).to.equal(newMetadata);
    });

    it("Should emit CourtMetadataUpdated event", async function () {
      const newMetadata = "ipfs://QmUpdatedCourt";
      await expect(courtRegistry.connect(operator1).updateMetadata(1, newMetadata))
        .to.emit(courtRegistry, "CourtMetadataUpdated")
        .withArgs(1, newMetadata);
    });

    it("Should reject update from non-operator", async function () {
      await expect(
        courtRegistry.connect(operator2).updateMetadata(1, "new-metadata")
      ).to.be.revertedWith("Not court operator");
    });
  });

  describe("Listing Courts", function () {
    beforeEach(async function () {
      await courtRegistry.connect(operator1).registerCourt(metadata, MIN_STAKE, rulesetHash);
      await courtRegistry.connect(operator2).registerCourt(
        "ipfs://QmCourt2",
        MIN_STAKE,
        ethers.keccak256(ethers.toUtf8Bytes("ruleset2"))
      );
    });

    it("Should list all active courts", async function () {
      const courts = await courtRegistry.listCourts();
      expect(courts.length).to.equal(2);
    });

    it("Should not include deactivated courts", async function () {
      await courtRegistry.slashCourt(1, MIN_STAKE, "Full slash");

      const courts = await courtRegistry.listCourts();
      expect(courts.length).to.equal(1);
      expect(courts[0].operator).to.equal(operator2.address);
    });
  });

  describe("View Functions", function () {
    it("Should return correct active status", async function () {
      await courtRegistry.connect(operator1).registerCourt(metadata, MIN_STAKE, rulesetHash);

      expect(await courtRegistry.isActive(1)).to.be.true;
      expect(await courtRegistry.isActive(999)).to.be.false;
    });

    it("Should revert getCourt for non-existent court", async function () {
      await expect(courtRegistry.getCourt(999))
        .to.be.revertedWith("Court does not exist");
    });
  });
});
