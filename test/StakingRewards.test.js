const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("StakingRewards", function () {
  let stakingRewards;
  let vjToken;
  let owner;
  let distributor;
  let staker1;
  let staker2;
  let staker3;

  const UNSTAKE_TIMELOCK = 14 * 24 * 60 * 60; // 14 days
  const stakeAmount = ethers.parseEther("1000");
  const rewardAmount = ethers.parseEther("100");

  const StakeRole = {
    Court: 0,
    Juror: 1,
    Insurer: 2
  };

  beforeEach(async function () {
    [owner, distributor, staker1, staker2, staker3] = await ethers.getSigners();

    // Deploy VJToken
    const VJToken = await ethers.getContractFactory("VJToken");
    vjToken = await VJToken.deploy(owner.address);
    await vjToken.waitForDeployment();

    // Deploy StakingRewards
    const StakingRewards = await ethers.getContractFactory("StakingRewards");
    stakingRewards = await StakingRewards.deploy(owner.address, await vjToken.getAddress());
    await stakingRewards.waitForDeployment();

    // Grant roles
    const STAKING_ROLE = await vjToken.STAKING_ROLE();
    await vjToken.grantRole(STAKING_ROLE, await stakingRewards.getAddress());

    const DISTRIBUTOR_ROLE = await stakingRewards.DISTRIBUTOR_ROLE();
    await stakingRewards.grantRole(DISTRIBUTOR_ROLE, distributor.address);

    // Mint tokens to stakers and distributor
    await vjToken.mint(staker1.address, ethers.parseEther("10000"));
    await vjToken.mint(staker2.address, ethers.parseEther("10000"));
    await vjToken.mint(staker3.address, ethers.parseEther("10000"));
    await vjToken.mint(distributor.address, ethers.parseEther("10000"));

    // Approve staking contract
    await vjToken.connect(staker1).approve(await stakingRewards.getAddress(), ethers.MaxUint256);
    await vjToken.connect(staker2).approve(await stakingRewards.getAddress(), ethers.MaxUint256);
    await vjToken.connect(staker3).approve(await stakingRewards.getAddress(), ethers.MaxUint256);
    await vjToken.connect(distributor).approve(await stakingRewards.getAddress(), ethers.MaxUint256);
  });

  describe("Deployment", function () {
    it("Should set correct VJ token", async function () {
      expect(await stakingRewards.vjToken()).to.equal(await vjToken.getAddress());
    });

    it("Should set default role weights", async function () {
      expect(await stakingRewards.roleWeights(StakeRole.Court)).to.equal(5000);
      expect(await stakingRewards.roleWeights(StakeRole.Juror)).to.equal(3000);
      expect(await stakingRewards.roleWeights(StakeRole.Insurer)).to.equal(2000);
    });

    it("Should reject deployment with invalid token", async function () {
      const StakingRewards = await ethers.getContractFactory("StakingRewards");
      await expect(
        StakingRewards.deploy(owner.address, ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid token address");
    });
  });

  describe("Staking", function () {
    it("Should stake tokens", async function () {
      await stakingRewards.connect(staker1).stake(stakeAmount, StakeRole.Court);

      const stakeInfo = await stakingRewards.getStakeInfo(staker1.address);
      expect(stakeInfo.amount).to.equal(stakeAmount);
      expect(stakeInfo.role).to.equal(StakeRole.Court);
    });

    it("Should emit Staked event", async function () {
      await expect(stakingRewards.connect(staker1).stake(stakeAmount, StakeRole.Court))
        .to.emit(stakingRewards, "Staked")
        .withArgs(staker1.address, stakeAmount, StakeRole.Court);
    });

    it("Should update pool total", async function () {
      await stakingRewards.connect(staker1).stake(stakeAmount, StakeRole.Court);

      const poolInfo = await stakingRewards.getPoolInfo(StakeRole.Court);
      expect(poolInfo.totalStaked).to.equal(stakeAmount);
    });

    it("Should notify token of stake", async function () {
      await stakingRewards.connect(staker1).stake(stakeAmount, StakeRole.Court);

      expect(await vjToken.stakedBalanceOf(staker1.address)).to.equal(stakeAmount);
    });

    it("Should allow adding to existing stake", async function () {
      await stakingRewards.connect(staker1).stake(stakeAmount, StakeRole.Court);
      await stakingRewards.connect(staker1).stake(stakeAmount, StakeRole.Court);

      const stakeInfo = await stakingRewards.getStakeInfo(staker1.address);
      expect(stakeInfo.amount).to.equal(stakeAmount * 2n);
    });

    it("Should reject staking for different role", async function () {
      await stakingRewards.connect(staker1).stake(stakeAmount, StakeRole.Court);

      await expect(
        stakingRewards.connect(staker1).stake(stakeAmount, StakeRole.Juror)
      ).to.be.revertedWith("Already staking for different role");
    });

    it("Should reject zero stake", async function () {
      await expect(
        stakingRewards.connect(staker1).stake(0, StakeRole.Court)
      ).to.be.revertedWith("Amount must be positive");
    });
  });

  describe("Unstaking", function () {
    beforeEach(async function () {
      await stakingRewards.connect(staker1).stake(stakeAmount, StakeRole.Court);
    });

    it("Should request unstake", async function () {
      await stakingRewards.connect(staker1).requestUnstake(stakeAmount);

      const stakeInfo = await stakingRewards.getStakeInfo(staker1.address);
      expect(stakeInfo.pendingUnstake).to.equal(stakeAmount);
    });

    it("Should emit UnstakeRequested event", async function () {
      const expectedUnlockTime = (await time.latest()) + UNSTAKE_TIMELOCK + 1;

      await expect(stakingRewards.connect(staker1).requestUnstake(stakeAmount))
        .to.emit(stakingRewards, "UnstakeRequested");
    });

    it("Should complete unstake after timelock", async function () {
      await stakingRewards.connect(staker1).requestUnstake(stakeAmount);
      await time.increase(UNSTAKE_TIMELOCK);

      const balanceBefore = await vjToken.balanceOf(staker1.address);
      await stakingRewards.connect(staker1).completeUnstake();
      const balanceAfter = await vjToken.balanceOf(staker1.address);

      expect(balanceAfter - balanceBefore).to.equal(stakeAmount);

      const stakeInfo = await stakingRewards.getStakeInfo(staker1.address);
      expect(stakeInfo.amount).to.equal(0);
      expect(stakeInfo.pendingUnstake).to.equal(0);
    });

    it("Should emit UnstakeCompleted event", async function () {
      await stakingRewards.connect(staker1).requestUnstake(stakeAmount);
      await time.increase(UNSTAKE_TIMELOCK);

      await expect(stakingRewards.connect(staker1).completeUnstake())
        .to.emit(stakingRewards, "UnstakeCompleted")
        .withArgs(staker1.address, stakeAmount);
    });

    it("Should reject complete unstake before timelock", async function () {
      await stakingRewards.connect(staker1).requestUnstake(stakeAmount);

      await expect(
        stakingRewards.connect(staker1).completeUnstake()
      ).to.be.revertedWith("Timelock not expired");
    });

    it("Should allow partial unstake", async function () {
      const partialAmount = ethers.parseEther("500");
      await stakingRewards.connect(staker1).requestUnstake(partialAmount);
      await time.increase(UNSTAKE_TIMELOCK);
      await stakingRewards.connect(staker1).completeUnstake();

      const stakeInfo = await stakingRewards.getStakeInfo(staker1.address);
      expect(stakeInfo.amount).to.equal(stakeAmount - partialAmount);
    });

    it("Should cancel unstake request", async function () {
      await stakingRewards.connect(staker1).requestUnstake(stakeAmount);
      await stakingRewards.connect(staker1).cancelUnstake();

      const stakeInfo = await stakingRewards.getStakeInfo(staker1.address);
      expect(stakeInfo.pendingUnstake).to.equal(0);
    });

    it("Should emit UnstakeCancelled event", async function () {
      await stakingRewards.connect(staker1).requestUnstake(stakeAmount);

      await expect(stakingRewards.connect(staker1).cancelUnstake())
        .to.emit(stakingRewards, "UnstakeCancelled")
        .withArgs(staker1.address, stakeAmount);
    });

    it("Should reject unstake request exceeding stake", async function () {
      await expect(
        stakingRewards.connect(staker1).requestUnstake(stakeAmount * 2n)
      ).to.be.revertedWith("Amount exceeds stake");
    });

    it("Should reject duplicate unstake request", async function () {
      await stakingRewards.connect(staker1).requestUnstake(ethers.parseEther("500"));

      await expect(
        stakingRewards.connect(staker1).requestUnstake(ethers.parseEther("500"))
      ).to.be.revertedWith("Pending unstake exists");
    });
  });

  describe("Reward Distribution", function () {
    beforeEach(async function () {
      // Multiple stakers in different pools
      await stakingRewards.connect(staker1).stake(stakeAmount, StakeRole.Court);
      await stakingRewards.connect(staker2).stake(stakeAmount, StakeRole.Juror);
      await stakingRewards.connect(staker3).stake(stakeAmount, StakeRole.Insurer);
    });

    it("Should distribute rewards", async function () {
      await stakingRewards.connect(distributor).distributeRewards(rewardAmount);

      expect(await stakingRewards.totalRewardsDistributed()).to.equal(rewardAmount);
    });

    it("Should emit RewardsDistributed event", async function () {
      await expect(stakingRewards.connect(distributor).distributeRewards(rewardAmount))
        .to.emit(stakingRewards, "RewardsDistributed")
        .withArgs(rewardAmount);
    });

    it("Should distribute according to weights", async function () {
      await stakingRewards.connect(distributor).distributeRewards(rewardAmount);

      // Court gets 50%, Juror 30%, Insurer 20%
      const courtReward = await stakingRewards.pendingReward(staker1.address);
      const jurorReward = await stakingRewards.pendingReward(staker2.address);
      const insurerReward = await stakingRewards.pendingReward(staker3.address);

      // Allow small rounding errors
      expect(courtReward).to.be.closeTo(ethers.parseEther("50"), ethers.parseEther("0.01"));
      expect(jurorReward).to.be.closeTo(ethers.parseEther("30"), ethers.parseEther("0.01"));
      expect(insurerReward).to.be.closeTo(ethers.parseEther("20"), ethers.parseEther("0.01"));
    });

    it("Should reject distribution from non-distributor", async function () {
      await expect(
        stakingRewards.connect(staker1).distributeRewards(rewardAmount)
      ).to.be.reverted;
    });

    it("Should reject zero distribution", async function () {
      await expect(
        stakingRewards.connect(distributor).distributeRewards(0)
      ).to.be.revertedWith("Amount must be positive");
    });
  });

  describe("Reward Claiming", function () {
    beforeEach(async function () {
      await stakingRewards.connect(staker1).stake(stakeAmount, StakeRole.Court);
      await stakingRewards.connect(distributor).distributeRewards(rewardAmount);
    });

    it("Should claim rewards", async function () {
      const pendingBefore = await stakingRewards.pendingReward(staker1.address);
      const balanceBefore = await vjToken.balanceOf(staker1.address);

      await stakingRewards.connect(staker1).claimRewards();

      const balanceAfter = await vjToken.balanceOf(staker1.address);
      expect(balanceAfter - balanceBefore).to.equal(pendingBefore);

      const pendingAfter = await stakingRewards.pendingReward(staker1.address);
      expect(pendingAfter).to.equal(0);
    });

    it("Should emit RewardsClaimed event", async function () {
      const pending = await stakingRewards.pendingReward(staker1.address);

      await expect(stakingRewards.connect(staker1).claimRewards())
        .to.emit(stakingRewards, "RewardsClaimed")
        .withArgs(staker1.address, pending);
    });

    it("Should accumulate rewards over multiple distributions", async function () {
      await stakingRewards.connect(distributor).distributeRewards(rewardAmount);

      const pending = await stakingRewards.pendingReward(staker1.address);
      // Two distributions of 100 each, court gets 50% = 100 total
      expect(pending).to.be.closeTo(ethers.parseEther("100"), ethers.parseEther("0.01"));
    });

    it("Should claim rewards on additional stake", async function () {
      const pendingBefore = await stakingRewards.pendingReward(staker1.address);
      const balanceBefore = await vjToken.balanceOf(staker1.address);

      // Staking additional should claim pending rewards
      await stakingRewards.connect(staker1).stake(stakeAmount, StakeRole.Court);

      const balanceAfter = await vjToken.balanceOf(staker1.address);
      // Balance decreased by stake amount but increased by rewards
      const netChange = balanceAfter - balanceBefore;
      expect(netChange).to.equal(pendingBefore - stakeAmount);
    });
  });

  describe("Role Weight Management", function () {
    it("Should update role weight", async function () {
      await stakingRewards.setRoleWeight(StakeRole.Court, 6000);

      expect(await stakingRewards.roleWeights(StakeRole.Court)).to.equal(6000);
    });

    it("Should emit RoleWeightUpdated event", async function () {
      await expect(stakingRewards.setRoleWeight(StakeRole.Court, 6000))
        .to.emit(stakingRewards, "RoleWeightUpdated")
        .withArgs(StakeRole.Court, 6000);
    });

    it("Should reject weight above maximum", async function () {
      await expect(
        stakingRewards.setRoleWeight(StakeRole.Court, 10001)
      ).to.be.revertedWith("Weight exceeds maximum");
    });

    it("Should reject update from non-admin", async function () {
      await expect(
        stakingRewards.connect(staker1).setRoleWeight(StakeRole.Court, 6000)
      ).to.be.reverted;
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      await stakingRewards.connect(staker1).stake(stakeAmount, StakeRole.Court);
    });

    it("Should return correct stake info", async function () {
      const stakeInfo = await stakingRewards.getStakeInfo(staker1.address);
      expect(stakeInfo.amount).to.equal(stakeAmount);
      expect(stakeInfo.role).to.equal(StakeRole.Court);
      expect(stakeInfo.stakedAt).to.be.gt(0);
    });

    it("Should return correct pool info", async function () {
      const poolInfo = await stakingRewards.getPoolInfo(StakeRole.Court);
      expect(poolInfo.totalStaked).to.equal(stakeAmount);
    });

    it("Should return zero pending reward for non-staker", async function () {
      expect(await stakingRewards.pendingReward(staker2.address)).to.equal(0);
    });
  });
});
