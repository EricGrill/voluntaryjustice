const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("EscrowVault", function () {
  let escrowVault;
  let owner;
  let enforcement;
  let contractFactory;
  let depositor1;
  let depositor2;
  let recipient;

  const contractId = 1;
  const depositAmount = ethers.parseEther("1");

  beforeEach(async function () {
    [owner, enforcement, contractFactory, depositor1, depositor2, recipient] = await ethers.getSigners();

    const EscrowVault = await ethers.getContractFactory("EscrowVault");
    escrowVault = await EscrowVault.deploy(owner.address);
    await escrowVault.waitForDeployment();

    // Grant roles
    const ENFORCEMENT_ROLE = await escrowVault.ENFORCEMENT_ROLE();
    const CONTRACT_FACTORY_ROLE = await escrowVault.CONTRACT_FACTORY_ROLE();
    await escrowVault.grantRole(ENFORCEMENT_ROLE, enforcement.address);
    await escrowVault.grantRole(CONTRACT_FACTORY_ROLE, contractFactory.address);
  });

  describe("Deployment", function () {
    it("Should grant admin role to deployer", async function () {
      const DEFAULT_ADMIN_ROLE = await escrowVault.DEFAULT_ADMIN_ROLE();
      expect(await escrowVault.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
    });

    it("Should start with zero balance", async function () {
      expect(await escrowVault.getBalance(contractId)).to.equal(0);
    });
  });

  describe("Deposits", function () {
    it("Should accept deposit", async function () {
      await escrowVault.connect(depositor1).deposit(contractId, { value: depositAmount });

      expect(await escrowVault.getBalance(contractId)).to.equal(depositAmount);
      expect(await escrowVault.getDepositorBalance(contractId, depositor1.address)).to.equal(depositAmount);
    });

    it("Should emit Deposited event", async function () {
      await expect(escrowVault.connect(depositor1).deposit(contractId, { value: depositAmount }))
        .to.emit(escrowVault, "Deposited")
        .withArgs(contractId, depositor1.address, depositAmount);
    });

    it("Should accept multiple deposits", async function () {
      await escrowVault.connect(depositor1).deposit(contractId, { value: depositAmount });
      await escrowVault.connect(depositor2).deposit(contractId, { value: depositAmount });

      expect(await escrowVault.getBalance(contractId)).to.equal(depositAmount * 2n);
    });

    it("Should accumulate deposits from same depositor", async function () {
      await escrowVault.connect(depositor1).deposit(contractId, { value: depositAmount });
      await escrowVault.connect(depositor1).deposit(contractId, { value: depositAmount });

      expect(await escrowVault.getDepositorBalance(contractId, depositor1.address)).to.equal(depositAmount * 2n);
    });

    it("Should reject zero deposit", async function () {
      await expect(
        escrowVault.connect(depositor1).deposit(contractId, { value: 0 })
      ).to.be.revertedWith("Amount must be positive");
    });

    it("Should deposit for another address", async function () {
      await escrowVault.connect(owner).depositFor(contractId, depositor1.address, { value: depositAmount });

      expect(await escrowVault.getDepositorBalance(contractId, depositor1.address)).to.equal(depositAmount);
    });

    it("Should reject depositFor with invalid depositor", async function () {
      await expect(
        escrowVault.connect(owner).depositFor(contractId, ethers.ZeroAddress, { value: depositAmount })
      ).to.be.revertedWith("Invalid depositor");
    });
  });

  describe("Escrow Locking", function () {
    beforeEach(async function () {
      await escrowVault.connect(depositor1).deposit(contractId, { value: depositAmount });
    });

    it("Should lock escrow", async function () {
      await escrowVault.connect(contractFactory).lockEscrow(contractId);

      expect(await escrowVault.isLocked(contractId)).to.be.true;
    });

    it("Should emit EscrowLocked event", async function () {
      await expect(escrowVault.connect(contractFactory).lockEscrow(contractId))
        .to.emit(escrowVault, "EscrowLocked")
        .withArgs(contractId);
    });

    it("Should reject deposits when locked", async function () {
      await escrowVault.connect(contractFactory).lockEscrow(contractId);

      await expect(
        escrowVault.connect(depositor1).deposit(contractId, { value: depositAmount })
      ).to.be.revertedWith("Escrow is locked");
    });

    it("Should reject locking from non-factory", async function () {
      await expect(
        escrowVault.connect(depositor1).lockEscrow(contractId)
      ).to.be.reverted;
    });

    it("Should reject double locking", async function () {
      await escrowVault.connect(contractFactory).lockEscrow(contractId);

      await expect(
        escrowVault.connect(contractFactory).lockEscrow(contractId)
      ).to.be.revertedWith("Already locked");
    });

    it("Should unlock escrow (admin only)", async function () {
      await escrowVault.connect(contractFactory).lockEscrow(contractId);
      await escrowVault.connect(owner).unlockEscrow(contractId);

      expect(await escrowVault.isLocked(contractId)).to.be.false;
    });

    it("Should emit EscrowUnlocked event", async function () {
      await escrowVault.connect(contractFactory).lockEscrow(contractId);

      await expect(escrowVault.connect(owner).unlockEscrow(contractId))
        .to.emit(escrowVault, "EscrowUnlocked")
        .withArgs(contractId);
    });
  });

  describe("Release", function () {
    beforeEach(async function () {
      await escrowVault.connect(depositor1).deposit(contractId, { value: depositAmount });
      await escrowVault.connect(depositor2).deposit(contractId, { value: depositAmount });
    });

    it("Should release funds to recipient", async function () {
      const recipientBalanceBefore = await ethers.provider.getBalance(recipient.address);

      await escrowVault.connect(enforcement).release(contractId, recipient.address, depositAmount);

      const recipientBalanceAfter = await ethers.provider.getBalance(recipient.address);
      expect(recipientBalanceAfter - recipientBalanceBefore).to.equal(depositAmount);
      expect(await escrowVault.getBalance(contractId)).to.equal(depositAmount);
    });

    it("Should emit Released event", async function () {
      await expect(escrowVault.connect(enforcement).release(contractId, recipient.address, depositAmount))
        .to.emit(escrowVault, "Released")
        .withArgs(contractId, recipient.address, depositAmount);
    });

    it("Should release from specific depositor", async function () {
      await escrowVault.connect(enforcement).releaseFrom(
        contractId,
        depositor1.address,
        recipient.address,
        depositAmount
      );

      expect(await escrowVault.getDepositorBalance(contractId, depositor1.address)).to.equal(0);
      expect(await escrowVault.getDepositorBalance(contractId, depositor2.address)).to.equal(depositAmount);
    });

    it("Should reject release from non-enforcement", async function () {
      await expect(
        escrowVault.connect(depositor1).release(contractId, recipient.address, depositAmount)
      ).to.be.reverted;
    });

    it("Should reject release with insufficient balance", async function () {
      await expect(
        escrowVault.connect(enforcement).release(contractId, recipient.address, ethers.parseEther("10"))
      ).to.be.revertedWith("Insufficient escrow balance");
    });

    it("Should reject releaseFrom with insufficient depositor balance", async function () {
      await expect(
        escrowVault.connect(enforcement).releaseFrom(
          contractId,
          depositor1.address,
          recipient.address,
          ethers.parseEther("2")
        )
      ).to.be.revertedWith("Insufficient depositor balance");
    });

    it("Should reject release to zero address", async function () {
      await expect(
        escrowVault.connect(enforcement).release(contractId, ethers.ZeroAddress, depositAmount)
      ).to.be.revertedWith("Invalid recipient");
    });
  });

  describe("Refund", function () {
    beforeEach(async function () {
      await escrowVault.connect(depositor1).deposit(contractId, { value: depositAmount });
    });

    it("Should refund depositor", async function () {
      const depositorBalanceBefore = await ethers.provider.getBalance(depositor1.address);

      await escrowVault.connect(contractFactory).refund(contractId, depositor1.address);

      const depositorBalanceAfter = await ethers.provider.getBalance(depositor1.address);
      expect(depositorBalanceAfter - depositorBalanceBefore).to.equal(depositAmount);
      expect(await escrowVault.getBalance(contractId)).to.equal(0);
      expect(await escrowVault.getDepositorBalance(contractId, depositor1.address)).to.equal(0);
    });

    it("Should emit Refunded event", async function () {
      await expect(escrowVault.connect(contractFactory).refund(contractId, depositor1.address))
        .to.emit(escrowVault, "Refunded")
        .withArgs(contractId, depositor1.address, depositAmount);
    });

    it("Should refund partial amount", async function () {
      const partialAmount = ethers.parseEther("0.3");

      await escrowVault.connect(contractFactory).refundPartial(contractId, depositor1.address, partialAmount);

      expect(await escrowVault.getDepositorBalance(contractId, depositor1.address))
        .to.equal(depositAmount - partialAmount);
    });

    it("Should reject refund from non-factory", async function () {
      await expect(
        escrowVault.connect(depositor1).refund(contractId, depositor1.address)
      ).to.be.reverted;
    });

    it("Should reject refund with no deposit", async function () {
      await expect(
        escrowVault.connect(contractFactory).refund(contractId, depositor2.address)
      ).to.be.revertedWith("No deposit to refund");
    });

    it("Should reject partial refund exceeding deposit", async function () {
      await expect(
        escrowVault.connect(contractFactory).refundPartial(contractId, depositor1.address, ethers.parseEther("2"))
      ).to.be.revertedWith("Insufficient deposit");
    });
  });

  describe("View Functions", function () {
    it("Should return correct balance", async function () {
      await escrowVault.connect(depositor1).deposit(contractId, { value: depositAmount });

      expect(await escrowVault.getBalance(contractId)).to.equal(depositAmount);
    });

    it("Should return correct depositor balance", async function () {
      await escrowVault.connect(depositor1).deposit(contractId, { value: depositAmount });

      expect(await escrowVault.getDepositorBalance(contractId, depositor1.address)).to.equal(depositAmount);
      expect(await escrowVault.getDepositorBalance(contractId, depositor2.address)).to.equal(0);
    });

    it("Should return correct lock status", async function () {
      expect(await escrowVault.isLocked(contractId)).to.be.false;

      await escrowVault.connect(contractFactory).lockEscrow(contractId);

      expect(await escrowVault.isLocked(contractId)).to.be.true;
    });
  });
});
