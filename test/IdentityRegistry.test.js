const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("IdentityRegistry", function () {
  let identityRegistry;
  let owner;
  let user1;
  let user2;

  const sybilProof = ethers.toUtf8Bytes("gitcoin-passport-proof-12345");
  const ensProof = ethers.toUtf8Bytes("ens-ownership-proof");
  const easProof = ethers.toUtf8Bytes("eas-attestation-proof");

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    const IdentityRegistry = await ethers.getContractFactory("IdentityRegistry");
    identityRegistry = await IdentityRegistry.deploy(owner.address);
    await identityRegistry.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should grant admin role to deployer", async function () {
      const DEFAULT_ADMIN_ROLE = await identityRegistry.DEFAULT_ADMIN_ROLE();
      expect(await identityRegistry.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
    });

    it("Should grant verifier role to deployer", async function () {
      const VERIFIER_ROLE = await identityRegistry.VERIFIER_ROLE();
      expect(await identityRegistry.hasRole(VERIFIER_ROLE, owner.address)).to.be.true;
    });

    it("Should start with zero registered identities", async function () {
      expect(await identityRegistry.totalRegistered()).to.equal(0);
    });
  });

  describe("Identity Registration", function () {
    it("Should register a new identity", async function () {
      await identityRegistry.connect(user1).registerIdentity(sybilProof);

      expect(await identityRegistry.isRegistered(user1.address)).to.be.true;
      expect(await identityRegistry.totalRegistered()).to.equal(1);
    });

    it("Should emit IdentityRegistered event", async function () {
      await expect(identityRegistry.connect(user1).registerIdentity(sybilProof))
        .to.emit(identityRegistry, "IdentityRegistered")
        .withArgs(user1.address, await getBlockTimestamp());
    });

    it("Should store sybil proof", async function () {
      await identityRegistry.connect(user1).registerIdentity(sybilProof);

      const identity = await identityRegistry.getIdentity(user1.address);
      expect(identity.sybilProof).to.equal(ethers.hexlify(sybilProof));
    });

    it("Should reject registration without sybil proof", async function () {
      await expect(
        identityRegistry.connect(user1).registerIdentity("0x")
      ).to.be.revertedWith("Sybil proof required");
    });

    it("Should reject duplicate registration", async function () {
      await identityRegistry.connect(user1).registerIdentity(sybilProof);
      await expect(
        identityRegistry.connect(user1).registerIdentity(sybilProof)
      ).to.be.revertedWith("Identity already registered");
    });

    it("Should track registered addresses", async function () {
      await identityRegistry.connect(user1).registerIdentity(sybilProof);
      await identityRegistry.connect(user2).registerIdentity(sybilProof);

      expect(await identityRegistry.getRegisteredAddress(0)).to.equal(user1.address);
      expect(await identityRegistry.getRegisteredAddress(1)).to.equal(user2.address);
    });
  });

  describe("External Identity Linking", function () {
    beforeEach(async function () {
      await identityRegistry.connect(user1).registerIdentity(sybilProof);
    });

    it("Should link an external identity", async function () {
      await identityRegistry.connect(user1).linkExternalIdentity("ENS", ensProof);

      const [linked, proof, linkTime] = await identityRegistry.getExternalIdentity(user1.address, "ENS");
      expect(linked).to.be.true;
      expect(proof).to.equal(ethers.hexlify(ensProof));
    });

    it("Should emit ExternalIdentityLinked event", async function () {
      await expect(identityRegistry.connect(user1).linkExternalIdentity("ENS", ensProof))
        .to.emit(identityRegistry, "ExternalIdentityLinked")
        .withArgs(user1.address, "ENS", await getBlockTimestamp());
    });

    it("Should track linked identity types", async function () {
      await identityRegistry.connect(user1).linkExternalIdentity("ENS", ensProof);
      await identityRegistry.connect(user1).linkExternalIdentity("EAS", easProof);

      const identity = await identityRegistry.getIdentity(user1.address);
      expect(identity.linkedIdentityTypes).to.include("ENS");
      expect(identity.linkedIdentityTypes).to.include("EAS");
    });

    it("Should reject linking without registration", async function () {
      await expect(
        identityRegistry.connect(user2).linkExternalIdentity("ENS", ensProof)
      ).to.be.revertedWith("Identity not registered");
    });

    it("Should reject linking with empty identity type", async function () {
      await expect(
        identityRegistry.connect(user1).linkExternalIdentity("", ensProof)
      ).to.be.revertedWith("Identity type required");
    });

    it("Should reject linking with empty proof", async function () {
      await expect(
        identityRegistry.connect(user1).linkExternalIdentity("ENS", "0x")
      ).to.be.revertedWith("Proof required");
    });

    it("Should allow updating linked identity", async function () {
      await identityRegistry.connect(user1).linkExternalIdentity("ENS", ensProof);
      const newProof = ethers.toUtf8Bytes("updated-ens-proof");
      await identityRegistry.connect(user1).linkExternalIdentity("ENS", newProof);

      const [linked, proof,] = await identityRegistry.getExternalIdentity(user1.address, "ENS");
      expect(linked).to.be.true;
      expect(proof).to.equal(ethers.hexlify(newProof));
    });
  });

  describe("External Identity Unlinking", function () {
    beforeEach(async function () {
      await identityRegistry.connect(user1).registerIdentity(sybilProof);
      await identityRegistry.connect(user1).linkExternalIdentity("ENS", ensProof);
    });

    it("Should unlink an external identity", async function () {
      await identityRegistry.connect(user1).unlinkExternalIdentity("ENS");

      const [linked,,] = await identityRegistry.getExternalIdentity(user1.address, "ENS");
      expect(linked).to.be.false;
    });

    it("Should emit ExternalIdentityUnlinked event", async function () {
      await expect(identityRegistry.connect(user1).unlinkExternalIdentity("ENS"))
        .to.emit(identityRegistry, "ExternalIdentityUnlinked")
        .withArgs(user1.address, "ENS");
    });

    it("Should reject unlinking without registration", async function () {
      await expect(
        identityRegistry.connect(user2).unlinkExternalIdentity("ENS")
      ).to.be.revertedWith("Identity not registered");
    });

    it("Should reject unlinking non-linked identity", async function () {
      await expect(
        identityRegistry.connect(user1).unlinkExternalIdentity("EAS")
      ).to.be.revertedWith("Identity not linked");
    });
  });

  describe("View Functions", function () {
    it("Should return correct identity view", async function () {
      await identityRegistry.connect(user1).registerIdentity(sybilProof);

      const identity = await identityRegistry.getIdentity(user1.address);
      expect(identity.registered).to.be.true;
      expect(identity.sybilProof).to.equal(ethers.hexlify(sybilProof));
    });

    it("Should return false for unregistered address", async function () {
      expect(await identityRegistry.isRegistered(user1.address)).to.be.false;
    });

    it("Should revert on out of bounds index", async function () {
      await expect(
        identityRegistry.getRegisteredAddress(0)
      ).to.be.revertedWith("Index out of bounds");
    });
  });

  // Helper function to get current block timestamp
  async function getBlockTimestamp() {
    const block = await ethers.provider.getBlock("latest");
    return block.timestamp + 1; // +1 because the event is in the next block
  }
});
