const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("JurorPool", function () {
  let vjToken, jurorPool;
  let owner, juror1, juror2, juror3, juror4, juror5, juror6;
  const MIN_STAKE = ethers.parseEther("100");
  const UNSTAKE_TIMELOCK = 14 * 24 * 60 * 60; // 14 days

  beforeEach(async function () {
    [owner, juror1, juror2, juror3, juror4, juror5, juror6] = await ethers.getSigners();

    const VJToken = await ethers.getContractFactory("VJToken");
    vjToken = await VJToken.deploy(owner.address);

    const JurorPool = await ethers.getContractFactory("JurorPool");
    jurorPool = await JurorPool.deploy(owner.address, await vjToken.getAddress());

    // Grant staking role to juror pool
    const STAKING_ROLE = await vjToken.STAKING_ROLE();
    await vjToken.grantRole(STAKING_ROLE, await jurorPool.getAddress());

    // Mint tokens to jurors
    for (const juror of [juror1, juror2, juror3, juror4, juror5, juror6]) {
      await vjToken.mint(juror.address, ethers.parseEther("1000"));
      await vjToken.connect(juror).approve(await jurorPool.getAddress(), ethers.parseEther("1000"));
    }
  });

  describe("Deployment", function () {
    it("Should set correct VJ token", async function () {
      expect(await jurorPool.vjToken()).to.equal(await vjToken.getAddress());
    });

    it("Should start with zero staked", async function () {
      expect(await jurorPool.totalStaked()).to.equal(0);
    });

    it("Should reject deployment with invalid token", async function () {
      const JurorPool = await ethers.getContractFactory("JurorPool");
      await expect(
        JurorPool.deploy(owner.address, ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid token address");
    });
  });

  describe("Staking", function () {
    it("Should stake tokens", async function () {
      await jurorPool.connect(juror1).stakeAsJuror(MIN_STAKE);
      const info = await jurorPool.getJurorInfo(juror1.address);
      expect(info.stakedAmount).to.equal(MIN_STAKE);
    });

    it("Should emit JurorStaked event", async function () {
      await expect(jurorPool.connect(juror1).stakeAsJuror(MIN_STAKE))
        .to.emit(jurorPool, "JurorStaked")
        .withArgs(juror1.address, MIN_STAKE);
    });

    it("Should activate juror meeting minimum stake", async function () {
      await jurorPool.connect(juror1).stakeAsJuror(MIN_STAKE);
      expect(await jurorPool.isActiveJuror(juror1.address)).to.be.true;
    });

    it("Should not activate juror below minimum stake", async function () {
      await jurorPool.connect(juror1).stakeAsJuror(ethers.parseEther("50"));
      expect(await jurorPool.isActiveJuror(juror1.address)).to.be.false;
    });

    it("Should allow adding to existing stake", async function () {
      await jurorPool.connect(juror1).stakeAsJuror(ethers.parseEther("50"));
      await jurorPool.connect(juror1).stakeAsJuror(ethers.parseEther("60"));
      const info = await jurorPool.getJurorInfo(juror1.address);
      expect(info.stakedAmount).to.equal(ethers.parseEther("110"));
      expect(await jurorPool.isActiveJuror(juror1.address)).to.be.true;
    });

    it("Should update total staked", async function () {
      await jurorPool.connect(juror1).stakeAsJuror(MIN_STAKE);
      expect(await jurorPool.totalStaked()).to.equal(MIN_STAKE);
    });

    it("Should reject zero stake", async function () {
      await expect(
        jurorPool.connect(juror1).stakeAsJuror(0)
      ).to.be.revertedWith("Amount must be positive");
    });
  });

  describe("Unstaking", function () {
    beforeEach(async function () {
      await jurorPool.connect(juror1).stakeAsJuror(MIN_STAKE);
    });

    it("Should request unstake", async function () {
      await jurorPool.connect(juror1).requestUnstake(MIN_STAKE);
      const info = await jurorPool.getJurorInfo(juror1.address);
      expect(info.pendingUnstake).to.equal(MIN_STAKE);
    });

    it("Should emit UnstakeRequested event", async function () {
      const tx = await jurorPool.connect(juror1).requestUnstake(MIN_STAKE);
      const block = await ethers.provider.getBlock(tx.blockNumber);
      await expect(tx)
        .to.emit(jurorPool, "UnstakeRequested")
        .withArgs(juror1.address, MIN_STAKE, block.timestamp + UNSTAKE_TIMELOCK);
    });

    it("Should complete unstake after timelock", async function () {
      await jurorPool.connect(juror1).requestUnstake(MIN_STAKE);
      await time.increase(UNSTAKE_TIMELOCK);
      await jurorPool.connect(juror1).completeUnstake();
      const info = await jurorPool.getJurorInfo(juror1.address);
      expect(info.stakedAmount).to.equal(0);
    });

    it("Should emit UnstakeCompleted event", async function () {
      await jurorPool.connect(juror1).requestUnstake(MIN_STAKE);
      await time.increase(UNSTAKE_TIMELOCK);
      await expect(jurorPool.connect(juror1).completeUnstake())
        .to.emit(jurorPool, "UnstakeCompleted")
        .withArgs(juror1.address, MIN_STAKE);
    });

    it("Should reject complete unstake before timelock", async function () {
      await jurorPool.connect(juror1).requestUnstake(MIN_STAKE);
      await expect(
        jurorPool.connect(juror1).completeUnstake()
      ).to.be.revertedWith("Timelock not expired");
    });

    it("Should deactivate juror on full unstake request", async function () {
      await jurorPool.connect(juror1).requestUnstake(MIN_STAKE);
      expect(await jurorPool.isActiveJuror(juror1.address)).to.be.false;
    });

    it("Should cancel unstake request", async function () {
      await jurorPool.connect(juror1).requestUnstake(MIN_STAKE);
      await jurorPool.connect(juror1).cancelUnstake();
      const info = await jurorPool.getJurorInfo(juror1.address);
      expect(info.pendingUnstake).to.equal(0);
      expect(await jurorPool.isActiveJuror(juror1.address)).to.be.true;
    });

    it("Should emit UnstakeCancelled event", async function () {
      await jurorPool.connect(juror1).requestUnstake(MIN_STAKE);
      await expect(jurorPool.connect(juror1).cancelUnstake())
        .to.emit(jurorPool, "UnstakeCancelled")
        .withArgs(juror1.address, MIN_STAKE);
    });
  });

  describe("Jury Drawing", function () {
    beforeEach(async function () {
      // Stake 5 jurors
      for (const juror of [juror1, juror2, juror3, juror4, juror5]) {
        await jurorPool.connect(juror).stakeAsJuror(MIN_STAKE);
      }
    });

    it("Should draw jury of 5", async function () {
      const seed = ethers.keccak256(ethers.toUtf8Bytes("random"));
      const tx = await jurorPool.drawJury(1, seed);
      const receipt = await tx.wait();
      const event = receipt.logs.find(
        log => log.fragment && log.fragment.name === "JuryDrawn"
      );
      expect(event.args.jury.length).to.equal(5);
    });

    it("Should emit JuryDrawn event", async function () {
      const seed = ethers.keccak256(ethers.toUtf8Bytes("random"));
      await expect(jurorPool.drawJury(1, seed))
        .to.emit(jurorPool, "JuryDrawn");
    });

    it("Should increment cases served", async function () {
      const seed = ethers.keccak256(ethers.toUtf8Bytes("random"));
      await jurorPool.drawJury(1, seed);
      
      // At least one juror should have cases served incremented
      let totalCases = 0n;
      for (const juror of [juror1, juror2, juror3, juror4, juror5]) {
        const info = await jurorPool.getJurorInfo(juror.address);
        totalCases += info.casesServed;
      }
      expect(totalCases).to.equal(5n);
    });

    it("Should reject drawing with insufficient jurors", async function () {
      // Create new pool with only 4 jurors
      const JurorPool = await ethers.getContractFactory("JurorPool");
      const newPool = await JurorPool.deploy(owner.address, await vjToken.getAddress());
      
      const STAKING_ROLE = await vjToken.STAKING_ROLE();
      await vjToken.grantRole(STAKING_ROLE, await newPool.getAddress());

      for (const juror of [juror1, juror2, juror3, juror4]) {
        await vjToken.connect(juror).approve(await newPool.getAddress(), MIN_STAKE);
        await newPool.connect(juror).stakeAsJuror(MIN_STAKE);
      }

      const seed = ethers.keccak256(ethers.toUtf8Bytes("random"));
      await expect(
        newPool.drawJury(1, seed)
      ).to.be.revertedWith("Insufficient jurors");
    });

    it("Should reject drawing from non-dispute role", async function () {
      const seed = ethers.keccak256(ethers.toUtf8Bytes("random"));
      await expect(
        jurorPool.connect(juror1).drawJury(1, seed)
      ).to.be.reverted;
    });
  });

  describe("Slashing", function () {
    beforeEach(async function () {
      await jurorPool.connect(juror1).stakeAsJuror(MIN_STAKE);
    });

    it("Should slash juror stake", async function () {
      const slashAmount = ethers.parseEther("50");
      await jurorPool.slashJuror(juror1.address, slashAmount, "Misconduct");
      const info = await jurorPool.getJurorInfo(juror1.address);
      expect(info.stakedAmount).to.equal(MIN_STAKE - slashAmount);
      expect(info.slashedAmount).to.equal(slashAmount);
    });

    it("Should emit JurorSlashed event", async function () {
      const slashAmount = ethers.parseEther("50");
      await expect(jurorPool.slashJuror(juror1.address, slashAmount, "Misconduct"))
        .to.emit(jurorPool, "JurorSlashed")
        .withArgs(juror1.address, slashAmount, "Misconduct");
    });

    it("Should deactivate juror if stake falls below minimum", async function () {
      await jurorPool.slashJuror(juror1.address, ethers.parseEther("50"), "Misconduct");
      expect(await jurorPool.isActiveJuror(juror1.address)).to.be.false;
    });

    it("Should update total slashed", async function () {
      const slashAmount = ethers.parseEther("50");
      await jurorPool.slashJuror(juror1.address, slashAmount, "Misconduct");
      expect(await jurorPool.totalSlashed()).to.equal(slashAmount);
    });

    it("Should reject slashing from non-governance", async function () {
      await expect(
        jurorPool.connect(juror1).slashJuror(juror1.address, ethers.parseEther("50"), "Misconduct")
      ).to.be.reverted;
    });

    it("Should reject slashing more than stake", async function () {
      await expect(
        jurorPool.slashJuror(juror1.address, ethers.parseEther("200"), "Misconduct")
      ).to.be.revertedWith("Amount exceeds stake");
    });

    it("Should reject slashing without reason", async function () {
      await expect(
        jurorPool.slashJuror(juror1.address, ethers.parseEther("50"), "")
      ).to.be.revertedWith("Reason required");
    });
  });

  describe("View Functions", function () {
    it("Should return correct active juror count", async function () {
      await jurorPool.connect(juror1).stakeAsJuror(MIN_STAKE);
      await jurorPool.connect(juror2).stakeAsJuror(MIN_STAKE);
      expect(await jurorPool.activeJurorCount()).to.equal(2);
    });

    it("Should return correct juror info", async function () {
      await jurorPool.connect(juror1).stakeAsJuror(MIN_STAKE);
      const info = await jurorPool.getJurorInfo(juror1.address);
      expect(info.stakedAmount).to.equal(MIN_STAKE);
      expect(info.active).to.be.true;
    });
  });
});
