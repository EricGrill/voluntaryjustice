const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * Coverage-focused suite for JurorPool — drives every require/revert branch
 * and both sides of the activate/deactivate, unstake, cancel and slash
 * conditionals, including the swap-and-pop deactivation paths.
 */
describe("JurorPool — Coverage", function () {
  let vjToken, jurorPool;
  let owner, juror1, juror2, juror3, juror4, juror5, juror6, outsider;
  const MIN_STAKE = ethers.parseEther("100");
  const UNSTAKE_TIMELOCK = 14 * 24 * 60 * 60;

  beforeEach(async function () {
    [owner, juror1, juror2, juror3, juror4, juror5, juror6, outsider] = await ethers.getSigners();

    const VJToken = await ethers.getContractFactory("VJToken");
    vjToken = await VJToken.deploy(owner.address);

    const JurorPool = await ethers.getContractFactory("JurorPool");
    jurorPool = await JurorPool.deploy(owner.address, await vjToken.getAddress());

    const STAKING_ROLE = await vjToken.STAKING_ROLE();
    await vjToken.grantRole(STAKING_ROLE, await jurorPool.getAddress());

    for (const juror of [juror1, juror2, juror3, juror4, juror5, juror6]) {
      await vjToken.mint(juror.address, ethers.parseEther("1000"));
      await vjToken.connect(juror).approve(await jurorPool.getAddress(), ethers.MaxUint256);
    }
  });

  describe("requestUnstake error branches", function () {
    it("rejects when caller has no stake", async function () {
      await expect(jurorPool.connect(juror1).requestUnstake(MIN_STAKE))
        .to.be.revertedWith("No stake found");
    });

    it("rejects a zero amount", async function () {
      await jurorPool.connect(juror1).stakeAsJuror(MIN_STAKE);
      await expect(jurorPool.connect(juror1).requestUnstake(0))
        .to.be.revertedWith("Amount must be positive");
    });

    it("rejects an amount that exceeds the stake", async function () {
      await jurorPool.connect(juror1).stakeAsJuror(MIN_STAKE);
      await expect(jurorPool.connect(juror1).requestUnstake(MIN_STAKE + 1n))
        .to.be.revertedWith("Amount exceeds stake");
    });

    it("rejects a second pending unstake", async function () {
      await jurorPool.connect(juror1).stakeAsJuror(ethers.parseEther("300"));
      await jurorPool.connect(juror1).requestUnstake(ethers.parseEther("50"));
      await expect(jurorPool.connect(juror1).requestUnstake(ethers.parseEther("50")))
        .to.be.revertedWith("Pending unstake exists");
    });

    it("does NOT deactivate when remaining stake stays at/above the minimum", async function () {
      await jurorPool.connect(juror1).stakeAsJuror(ethers.parseEther("250"));
      // Unstake 100 -> 150 remains (>= MIN_STAKE) so juror stays active
      await jurorPool.connect(juror1).requestUnstake(ethers.parseEther("100"));
      expect(await jurorPool.isActiveJuror(juror1.address)).to.be.true;
      expect(await jurorPool.activeJurorCount()).to.equal(1);
    });

    it("deactivates when remaining stake drops below the minimum", async function () {
      await jurorPool.connect(juror1).stakeAsJuror(ethers.parseEther("150"));
      await jurorPool.connect(juror1).requestUnstake(ethers.parseEther("100")); // 50 remains
      expect(await jurorPool.isActiveJuror(juror1.address)).to.be.false;
    });
  });

  describe("completeUnstake error branches", function () {
    it("rejects when there is no pending unstake", async function () {
      await jurorPool.connect(juror1).stakeAsJuror(MIN_STAKE);
      await expect(jurorPool.connect(juror1).completeUnstake())
        .to.be.revertedWith("No pending unstake");
    });

    it("returns tokens and updates totals after timelock (partial unstake keeps juror active)", async function () {
      await jurorPool.connect(juror1).stakeAsJuror(ethers.parseEther("250"));
      await jurorPool.connect(juror1).requestUnstake(ethers.parseEther("50"));
      await time.increase(UNSTAKE_TIMELOCK);

      const balBefore = await vjToken.balanceOf(juror1.address);
      await jurorPool.connect(juror1).completeUnstake();
      const balAfter = await vjToken.balanceOf(juror1.address);

      expect(balAfter - balBefore).to.equal(ethers.parseEther("50"));
      const info = await jurorPool.getJurorInfo(juror1.address);
      expect(info.stakedAmount).to.equal(ethers.parseEther("200"));
      expect(info.pendingUnstake).to.equal(0);
      expect(await jurorPool.totalStaked()).to.equal(ethers.parseEther("200"));
    });
  });

  describe("cancelUnstake branches", function () {
    it("rejects when there is no pending unstake", async function () {
      await expect(jurorPool.connect(juror1).cancelUnstake())
        .to.be.revertedWith("No pending unstake");
    });

    it("reactivates a juror that was deactivated by a full unstake request", async function () {
      await jurorPool.connect(juror1).stakeAsJuror(MIN_STAKE);
      await jurorPool.connect(juror1).requestUnstake(MIN_STAKE);
      expect(await jurorPool.isActiveJuror(juror1.address)).to.be.false;

      await jurorPool.connect(juror1).cancelUnstake();
      expect(await jurorPool.isActiveJuror(juror1.address)).to.be.true;
      expect(await jurorPool.activeJurorCount()).to.equal(1);
    });

    it("does NOT re-add a still-active juror to the array on cancel (partial unstake)", async function () {
      await jurorPool.connect(juror1).stakeAsJuror(ethers.parseEther("250"));
      await jurorPool.connect(juror1).requestUnstake(ethers.parseEther("50")); // stays active
      await jurorPool.connect(juror1).cancelUnstake();
      // active and only counted once
      expect(await jurorPool.isActiveJuror(juror1.address)).to.be.true;
      expect(await jurorPool.activeJurorCount()).to.equal(1);
    });

    it("leaves juror inactive on cancel when stake is below the minimum", async function () {
      // Stake exactly MIN, then slash below min so juror is inactive but has stake left.
      await jurorPool.connect(juror1).stakeAsJuror(MIN_STAKE);
      // Add a sub-minimum extra so there is something to unstake without re-meeting MIN
      // First request a partial unstake to create a pending one while below MIN is not possible here;
      // instead: slash to drop below MIN then it is inactive with leftover stake.
      await jurorPool.slashJuror(juror1.address, ethers.parseEther("10"), "minor"); // 90 left, inactive
      expect(await jurorPool.isActiveJuror(juror1.address)).to.be.false;

      await jurorPool.connect(juror1).requestUnstake(ethers.parseEther("10")); // 80 would remain
      await jurorPool.connect(juror1).cancelUnstake();
      // stake (90) still below MIN -> remains inactive (the !active && >=MIN branch is false)
      expect(await jurorPool.isActiveJuror(juror1.address)).to.be.false;
    });
  });

  describe("drawJury", function () {
    it("reverts for a non-DISPUTE_ROLE caller", async function () {
      for (const j of [juror1, juror2, juror3, juror4, juror5]) {
        await jurorPool.connect(j).stakeAsJuror(MIN_STAKE);
      }
      const seed = ethers.keccak256(ethers.toUtf8Bytes("s"));
      await expect(jurorPool.connect(outsider).drawJury(1, seed)).to.be.reverted;
    });

    it("reverts with insufficient jurors", async function () {
      for (const j of [juror1, juror2, juror3, juror4]) {
        await jurorPool.connect(j).stakeAsJuror(MIN_STAKE);
      }
      const seed = ethers.keccak256(ethers.toUtf8Bytes("s"));
      await expect(jurorPool.drawJury(1, seed)).to.be.revertedWith("Insufficient jurors");
    });

    it("draws with more candidates than the jury size", async function () {
      for (const j of [juror1, juror2, juror3, juror4, juror5, juror6]) {
        await jurorPool.connect(j).stakeAsJuror(MIN_STAKE);
      }
      const seed = ethers.keccak256(ethers.toUtf8Bytes("s"));
      const tx = await jurorPool.drawJury(1, seed);
      const receipt = await tx.wait();
      const ev = receipt.logs.find(l => l.fragment && l.fragment.name === "JuryDrawn");
      expect(ev.args.jury.length).to.equal(5);
    });
  });

  describe("slashJuror branches", function () {
    it("rejects slashing a juror with no stake", async function () {
      await expect(jurorPool.slashJuror(juror1.address, ethers.parseEther("10"), "x"))
        .to.be.revertedWith("Juror has no stake");
    });

    it("slashes without deactivating when remaining stake stays at/above the minimum", async function () {
      await jurorPool.connect(juror1).stakeAsJuror(ethers.parseEther("300"));
      await jurorPool.slashJuror(juror1.address, ethers.parseEther("50"), "misconduct"); // 250 left
      expect(await jurorPool.isActiveJuror(juror1.address)).to.be.true;
      const info = await jurorPool.getJurorInfo(juror1.address);
      expect(info.stakedAmount).to.equal(ethers.parseEther("250"));
      expect(info.slashedAmount).to.equal(ethers.parseEther("50"));
      expect(await jurorPool.totalSlashed()).to.equal(ethers.parseEther("50"));
    });

    it("slashing an inactive juror (no stake-array removal) still works", async function () {
      // Juror below minimum (never active)
      await jurorPool.connect(juror1).stakeAsJuror(ethers.parseEther("80"));
      expect(await jurorPool.isActiveJuror(juror1.address)).to.be.false;
      await jurorPool.slashJuror(juror1.address, ethers.parseEther("30"), "x");
      const info = await jurorPool.getJurorInfo(juror1.address);
      expect(info.stakedAmount).to.equal(ethers.parseEther("50"));
    });
  });

  describe("deactivation swap-and-pop (non-last element)", function () {
    it("removes a middle juror and keeps the array consistent", async function () {
      // Stake 3 jurors; juror2 is in the middle of the active array.
      await jurorPool.connect(juror1).stakeAsJuror(MIN_STAKE);
      await jurorPool.connect(juror2).stakeAsJuror(MIN_STAKE);
      await jurorPool.connect(juror3).stakeAsJuror(MIN_STAKE);
      expect(await jurorPool.activeJurorCount()).to.equal(3);

      // Slash juror2 below minimum -> deactivate; juror3 (last) gets swapped into its slot
      await jurorPool.slashJuror(juror2.address, MIN_STAKE, "out");
      expect(await jurorPool.isActiveJuror(juror2.address)).to.be.false;
      expect(await jurorPool.isActiveJuror(juror1.address)).to.be.true;
      expect(await jurorPool.isActiveJuror(juror3.address)).to.be.true;
      expect(await jurorPool.activeJurorCount()).to.equal(2);

      // Now deactivate juror1 (still works after the swap re-indexed juror3)
      await jurorPool.slashJuror(juror1.address, MIN_STAKE, "out");
      expect(await jurorPool.activeJurorCount()).to.equal(1);
      expect(await jurorPool.isActiveJuror(juror3.address)).to.be.true;
    });

    it("removes the last juror in the array (index == lastIndex branch)", async function () {
      await jurorPool.connect(juror1).stakeAsJuror(MIN_STAKE);
      await jurorPool.connect(juror2).stakeAsJuror(MIN_STAKE);
      // juror2 is last; deactivating it hits the index-1 == lastIndex path
      await jurorPool.slashJuror(juror2.address, MIN_STAKE, "out");
      expect(await jurorPool.activeJurorCount()).to.equal(1);
      expect(await jurorPool.isActiveJuror(juror1.address)).to.be.true;
    });
  });
});
