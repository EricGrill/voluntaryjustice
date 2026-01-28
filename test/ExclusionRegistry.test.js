const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ExclusionRegistry", function () {
  let exclusionRegistry;
  let owner, excluded1, excluded2;

  beforeEach(async function () {
    [owner, excluded1, excluded2] = await ethers.getSigners();

    const ExclusionRegistry = await ethers.getContractFactory("ExclusionRegistry");
    exclusionRegistry = await ExclusionRegistry.deploy(owner.address);
  });

  describe("Deployment", function () {
    it("Should grant governance role to deployer", async function () {
      const GOVERNANCE_ROLE = await exclusionRegistry.GOVERNANCE_ROLE();
      expect(await exclusionRegistry.hasRole(GOVERNANCE_ROLE, owner.address)).to.be.true;
    });

    it("Should start with zero excluded", async function () {
      expect(await exclusionRegistry.totalExcluded()).to.equal(0);
    });
  });

  describe("Adding to Registry", function () {
    const rulingHash = ethers.keccak256(ethers.toUtf8Bytes("ruling-1"));
    const reason = "Failed to comply with ruling";

    it("Should add address to registry", async function () {
      await exclusionRegistry.addToRegistry(
        excluded1.address,
        rulingHash,
        reason,
        ethers.parseEther("1"),
        ethers.parseEther("0.5")
      );
      expect(await exclusionRegistry.isExcluded(excluded1.address)).to.be.true;
    });

    it("Should emit AddressExcluded event", async function () {
      await expect(
        exclusionRegistry.addToRegistry(
          excluded1.address,
          rulingHash,
          reason,
          ethers.parseEther("1"),
          ethers.parseEther("0.5")
        )
      ).to.emit(exclusionRegistry, "AddressExcluded");
    });

    it("Should store correct exclusion info", async function () {
      await exclusionRegistry.addToRegistry(
        excluded1.address,
        rulingHash,
        reason,
        ethers.parseEther("1"),
        ethers.parseEther("0.5")
      );
      const record = await exclusionRegistry.getExclusionRecord(excluded1.address);
      expect(record.excluded).to.be.true;
      expect(record.rulingHash).to.equal(rulingHash);
      expect(record.reason).to.equal(reason);
    });

    it("Should reject adding zero address", async function () {
      await expect(
        exclusionRegistry.addToRegistry(
          ethers.ZeroAddress,
          rulingHash,
          reason,
          ethers.parseEther("1"),
          ethers.parseEther("0.5")
        )
      ).to.be.revertedWith("Invalid address");
    });

    it("Should reject adding without ruling hash", async function () {
      await expect(
        exclusionRegistry.addToRegistry(
          excluded1.address,
          ethers.ZeroHash,
          reason,
          ethers.parseEther("1"),
          ethers.parseEther("0.5")
        )
      ).to.be.revertedWith("Ruling hash required");
    });

    it("Should reject duplicate exclusion", async function () {
      await exclusionRegistry.addToRegistry(
        excluded1.address,
        rulingHash,
        reason,
        ethers.parseEther("1"),
        ethers.parseEther("0.5")
      );
      await expect(
        exclusionRegistry.addToRegistry(
          excluded1.address,
          rulingHash,
          reason,
          ethers.parseEther("1"),
          ethers.parseEther("0.5")
        )
      ).to.be.revertedWith("Already excluded");
    });

    it("Should reject adding from non-governance", async function () {
      await expect(
        exclusionRegistry.connect(excluded1).addToRegistry(
          excluded2.address,
          rulingHash,
          reason,
          ethers.parseEther("1"),
          ethers.parseEther("0.5")
        )
      ).to.be.reverted;
    });
  });

  describe("Removing from Registry", function () {
    const rulingHash = ethers.keccak256(ethers.toUtf8Bytes("ruling-1"));
    const reason = "Failed to comply with ruling";

    beforeEach(async function () {
      await exclusionRegistry.addToRegistry(
        excluded1.address,
        rulingHash,
        reason,
        ethers.parseEther("1"),
        ethers.parseEther("0.5")
      );
    });

    it("Should remove address from registry", async function () {
      await exclusionRegistry.removeFromRegistry(excluded1.address, "Debt settled");
      expect(await exclusionRegistry.isExcluded(excluded1.address)).to.be.false;
    });

    it("Should emit AddressReinstated event", async function () {
      await expect(exclusionRegistry.removeFromRegistry(excluded1.address, "Debt settled"))
        .to.emit(exclusionRegistry, "AddressReinstated")
        .withArgs(excluded1.address, "Debt settled");
    });

    it("Should decrement total excluded", async function () {
      expect(await exclusionRegistry.totalExcluded()).to.equal(1);
      await exclusionRegistry.removeFromRegistry(excluded1.address, "Debt settled");
      expect(await exclusionRegistry.totalExcluded()).to.equal(0);
    });

    it("Should reject removing non-excluded address", async function () {
      await expect(
        exclusionRegistry.removeFromRegistry(excluded2.address, "Test")
      ).to.be.revertedWith("Not excluded");
    });
  });

  describe("Updating Unpaid Amount", function () {
    const rulingHash = ethers.keccak256(ethers.toUtf8Bytes("ruling-1"));
    const reason = "Failed to comply with ruling";

    beforeEach(async function () {
      await exclusionRegistry.addToRegistry(
        excluded1.address,
        rulingHash,
        reason,
        ethers.parseEther("1"),
        ethers.parseEther("0.5")
      );
    });

    it("Should update unpaid amount", async function () {
      await exclusionRegistry.updateUnpaidAmount(excluded1.address, ethers.parseEther("0.25"));
      const record = await exclusionRegistry.getExclusionRecord(excluded1.address);
      expect(record.unpaidAmount).to.equal(ethers.parseEther("0.25"));
    });

    it("Should emit ExclusionUpdated event", async function () {
      await expect(
        exclusionRegistry.updateUnpaidAmount(excluded1.address, ethers.parseEther("0.25"))
      ).to.emit(exclusionRegistry, "ExclusionUpdated");
    });
  });

  describe("View Functions", function () {
    it("Should return all excluded addresses", async function () {
      const rulingHash = ethers.keccak256(ethers.toUtf8Bytes("ruling-1"));
      await exclusionRegistry.addToRegistry(
        excluded1.address,
        rulingHash,
        "Reason 1",
        ethers.parseEther("1"),
        ethers.parseEther("0.5")
      );
      await exclusionRegistry.addToRegistry(
        excluded2.address,
        rulingHash,
        "Reason 2",
        ethers.parseEther("2"),
        ethers.parseEther("1")
      );

      const addresses = await exclusionRegistry.getExcludedAddresses();
      expect(addresses.length).to.equal(2);
    });

    it("Should return correct excluded count", async function () {
      expect(await exclusionRegistry.excludedCount()).to.equal(0);
      const rulingHash = ethers.keccak256(ethers.toUtf8Bytes("ruling-1"));
      await exclusionRegistry.addToRegistry(
        excluded1.address,
        rulingHash,
        "Reason",
        ethers.parseEther("1"),
        ethers.parseEther("0.5")
      );
      expect(await exclusionRegistry.excludedCount()).to.equal(1);
    });
  });
});
