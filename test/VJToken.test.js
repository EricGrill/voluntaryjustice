const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("VJToken", function () {
  let vjToken;
  let owner;
  let user1;
  let user2;
  let stakingContract;

  beforeEach(async function () {
    [owner, user1, user2, stakingContract] = await ethers.getSigners();

    const VJToken = await ethers.getContractFactory("VJToken");
    vjToken = await VJToken.deploy(owner.address);
    await vjToken.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the correct name and symbol", async function () {
      expect(await vjToken.name()).to.equal("VoluntaryJustice");
      expect(await vjToken.symbol()).to.equal("VJ");
    });

    it("Should grant admin and minter roles to deployer", async function () {
      const DEFAULT_ADMIN_ROLE = await vjToken.DEFAULT_ADMIN_ROLE();
      const MINTER_ROLE = await vjToken.MINTER_ROLE();

      expect(await vjToken.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
      expect(await vjToken.hasRole(MINTER_ROLE, owner.address)).to.be.true;
    });

    it("Should have 18 decimals", async function () {
      expect(await vjToken.decimals()).to.equal(18);
    });
  });

  describe("Minting", function () {
    it("Should allow minter to mint tokens", async function () {
      const amount = ethers.parseEther("1000");
      await vjToken.mint(user1.address, amount);
      expect(await vjToken.balanceOf(user1.address)).to.equal(amount);
    });

    it("Should reject minting from non-minter", async function () {
      const amount = ethers.parseEther("1000");
      await expect(
        vjToken.connect(user1).mint(user1.address, amount)
      ).to.be.reverted;
    });
  });

  describe("Staking Hooks", function () {
    beforeEach(async function () {
      // Grant staking role to stakingContract
      const STAKING_ROLE = await vjToken.STAKING_ROLE();
      await vjToken.grantRole(STAKING_ROLE, stakingContract.address);

      // Mint tokens to user1
      await vjToken.mint(user1.address, ethers.parseEther("1000"));
    });

    it("Should track staked balances", async function () {
      const stakeAmount = ethers.parseEther("500");
      await vjToken.connect(stakingContract).notifyStake(user1.address, stakeAmount);

      expect(await vjToken.stakedBalanceOf(user1.address)).to.equal(stakeAmount);
      expect(await vjToken.unstakedBalanceOf(user1.address)).to.equal(ethers.parseEther("500"));
    });

    it("Should emit Staked event", async function () {
      const stakeAmount = ethers.parseEther("500");
      await expect(vjToken.connect(stakingContract).notifyStake(user1.address, stakeAmount))
        .to.emit(vjToken, "Staked")
        .withArgs(user1.address, stakeAmount);
    });

    it("Should track unstaked balances", async function () {
      const stakeAmount = ethers.parseEther("500");
      await vjToken.connect(stakingContract).notifyStake(user1.address, stakeAmount);
      await vjToken.connect(stakingContract).notifyUnstake(user1.address, ethers.parseEther("200"));

      expect(await vjToken.stakedBalanceOf(user1.address)).to.equal(ethers.parseEther("300"));
      expect(await vjToken.unstakedBalanceOf(user1.address)).to.equal(ethers.parseEther("700"));
    });

    it("Should emit Unstaked event", async function () {
      const stakeAmount = ethers.parseEther("500");
      await vjToken.connect(stakingContract).notifyStake(user1.address, stakeAmount);

      await expect(vjToken.connect(stakingContract).notifyUnstake(user1.address, ethers.parseEther("200")))
        .to.emit(vjToken, "Unstaked")
        .withArgs(user1.address, ethers.parseEther("200"));
    });

    it("Should reject stake notification from non-staking contract", async function () {
      await expect(
        vjToken.connect(user1).notifyStake(user1.address, ethers.parseEther("100"))
      ).to.be.reverted;
    });

    it("Should reject staking more than balance", async function () {
      await expect(
        vjToken.connect(stakingContract).notifyStake(user1.address, ethers.parseEther("1001"))
      ).to.be.revertedWith("Insufficient unstaked balance");
    });

    it("Should reject unstaking more than staked", async function () {
      await vjToken.connect(stakingContract).notifyStake(user1.address, ethers.parseEther("500"));
      await expect(
        vjToken.connect(stakingContract).notifyUnstake(user1.address, ethers.parseEther("501"))
      ).to.be.revertedWith("Insufficient staked balance");
    });
  });

  describe("Transfer Restrictions", function () {
    beforeEach(async function () {
      const STAKING_ROLE = await vjToken.STAKING_ROLE();
      await vjToken.grantRole(STAKING_ROLE, stakingContract.address);
      await vjToken.mint(user1.address, ethers.parseEther("1000"));
    });

    it("Should allow transfer of unstaked tokens", async function () {
      await vjToken.connect(stakingContract).notifyStake(user1.address, ethers.parseEther("500"));
      await vjToken.connect(user1).transfer(user2.address, ethers.parseEther("500"));

      expect(await vjToken.balanceOf(user2.address)).to.equal(ethers.parseEther("500"));
    });

    it("Should reject transfer of staked tokens", async function () {
      await vjToken.connect(stakingContract).notifyStake(user1.address, ethers.parseEther("500"));
      await expect(
        vjToken.connect(user1).transfer(user2.address, ethers.parseEther("501"))
      ).to.be.revertedWith("Cannot transfer staked tokens");
    });

    it("Should allow full transfer when nothing staked", async function () {
      await vjToken.connect(user1).transfer(user2.address, ethers.parseEther("1000"));
      expect(await vjToken.balanceOf(user2.address)).to.equal(ethers.parseEther("1000"));
    });
  });

  describe("Burning", function () {
    beforeEach(async function () {
      await vjToken.mint(user1.address, ethers.parseEther("1000"));
    });

    it("Should allow burning unstaked tokens", async function () {
      await vjToken.connect(user1).burn(ethers.parseEther("500"));
      expect(await vjToken.balanceOf(user1.address)).to.equal(ethers.parseEther("500"));
    });

    it("Should reject burning staked tokens", async function () {
      const STAKING_ROLE = await vjToken.STAKING_ROLE();
      await vjToken.grantRole(STAKING_ROLE, stakingContract.address);
      await vjToken.connect(stakingContract).notifyStake(user1.address, ethers.parseEther("600"));

      await expect(
        vjToken.connect(user1).burn(ethers.parseEther("500"))
      ).to.be.revertedWith("Cannot transfer staked tokens");
    });
  });
});
