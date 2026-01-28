const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("InsurerRegistry", function () {
  let vjToken, insurerRegistry;
  let owner, insurer1, insurer2;
  const MIN_STAKE = ethers.parseEther("10000");

  beforeEach(async function () {
    [owner, insurer1, insurer2] = await ethers.getSigners();

    const VJToken = await ethers.getContractFactory("VJToken");
    vjToken = await VJToken.deploy(owner.address);

    const InsurerRegistry = await ethers.getContractFactory("InsurerRegistry");
    insurerRegistry = await InsurerRegistry.deploy(owner.address, await vjToken.getAddress());

    // Grant staking role
    const STAKING_ROLE = await vjToken.STAKING_ROLE();
    await vjToken.grantRole(STAKING_ROLE, await insurerRegistry.getAddress());

    // Mint tokens to insurers
    await vjToken.mint(insurer1.address, ethers.parseEther("100000"));
    await vjToken.mint(insurer2.address, ethers.parseEther("100000"));
    await vjToken.connect(insurer1).approve(await insurerRegistry.getAddress(), ethers.MaxUint256);
    await vjToken.connect(insurer2).approve(await insurerRegistry.getAddress(), ethers.MaxUint256);
  });

  describe("Deployment", function () {
    it("Should set correct VJ token", async function () {
      expect(await insurerRegistry.vjToken()).to.equal(await vjToken.getAddress());
    });

    it("Should start with zero insurers", async function () {
      expect(await insurerRegistry.totalInsurers()).to.equal(0);
    });

    it("Should reject deployment with invalid token", async function () {
      const InsurerRegistry = await ethers.getContractFactory("InsurerRegistry");
      await expect(
        InsurerRegistry.deploy(owner.address, ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid token address");
    });
  });

  describe("Registration", function () {
    const terms = ethers.toUtf8Bytes("Standard insurance terms");
    const reserveProof = ethers.keccak256(ethers.toUtf8Bytes("reserve-proof"));

    it("Should register an insurer", async function () {
      await insurerRegistry.connect(insurer1).registerInsurer(MIN_STAKE, terms, reserveProof);
      const insurer = await insurerRegistry.getInsurer(1);
      expect(insurer.operator).to.equal(insurer1.address);
      expect(insurer.stake).to.equal(MIN_STAKE);
    });

    it("Should emit InsurerRegistered event", async function () {
      await expect(insurerRegistry.connect(insurer1).registerInsurer(MIN_STAKE, terms, reserveProof))
        .to.emit(insurerRegistry, "InsurerRegistered")
        .withArgs(1, insurer1.address, MIN_STAKE);
    });

    it("Should track operator to insurer mapping", async function () {
      await insurerRegistry.connect(insurer1).registerInsurer(MIN_STAKE, terms, reserveProof);
      expect(await insurerRegistry.getInsurerByOperator(insurer1.address)).to.equal(1);
    });

    it("Should reject registration with insufficient stake", async function () {
      await expect(
        insurerRegistry.connect(insurer1).registerInsurer(ethers.parseEther("100"), terms, reserveProof)
      ).to.be.revertedWith("Insufficient stake");
    });

    it("Should reject registration without terms", async function () {
      await expect(
        insurerRegistry.connect(insurer1).registerInsurer(MIN_STAKE, "0x", reserveProof)
      ).to.be.revertedWith("Terms required");
    });

    it("Should reject duplicate registration", async function () {
      await insurerRegistry.connect(insurer1).registerInsurer(MIN_STAKE, terms, reserveProof);
      await expect(
        insurerRegistry.connect(insurer1).registerInsurer(MIN_STAKE, terms, reserveProof)
      ).to.be.revertedWith("Already registered");
    });
  });

  describe("Terms Update", function () {
    const terms = ethers.toUtf8Bytes("Standard insurance terms");
    const newTerms = ethers.toUtf8Bytes("Updated insurance terms");
    const reserveProof = ethers.keccak256(ethers.toUtf8Bytes("reserve-proof"));

    beforeEach(async function () {
      await insurerRegistry.connect(insurer1).registerInsurer(MIN_STAKE, terms, reserveProof);
    });

    it("Should update terms", async function () {
      await insurerRegistry.connect(insurer1).updateTerms(1, newTerms);
      const insurer = await insurerRegistry.getInsurer(1);
      expect(ethers.hexlify(insurer.terms)).to.equal(ethers.hexlify(newTerms));
    });

    it("Should emit InsurerTermsUpdated event", async function () {
      await expect(insurerRegistry.connect(insurer1).updateTerms(1, newTerms))
        .to.emit(insurerRegistry, "InsurerTermsUpdated");
    });

    it("Should reject update from non-operator", async function () {
      await expect(
        insurerRegistry.connect(insurer2).updateTerms(1, newTerms)
      ).to.be.revertedWith("Not operator");
    });
  });

  describe("Stake Management", function () {
    const terms = ethers.toUtf8Bytes("Standard insurance terms");
    const reserveProof = ethers.keccak256(ethers.toUtf8Bytes("reserve-proof"));

    beforeEach(async function () {
      await insurerRegistry.connect(insurer1).registerInsurer(MIN_STAKE, terms, reserveProof);
    });

    it("Should increase stake", async function () {
      const additionalStake = ethers.parseEther("5000");
      await insurerRegistry.connect(insurer1).increaseStake(1, additionalStake);
      const insurer = await insurerRegistry.getInsurer(1);
      expect(insurer.stake).to.equal(MIN_STAKE + additionalStake);
    });

    it("Should reject stake increase from non-operator", async function () {
      await expect(
        insurerRegistry.connect(insurer2).increaseStake(1, ethers.parseEther("1000"))
      ).to.be.revertedWith("Not operator");
    });
  });

  describe("Slashing", function () {
    const terms = ethers.toUtf8Bytes("Standard insurance terms");
    const reserveProof = ethers.keccak256(ethers.toUtf8Bytes("reserve-proof"));

    beforeEach(async function () {
      await insurerRegistry.connect(insurer1).registerInsurer(MIN_STAKE, terms, reserveProof);
    });

    it("Should slash insurer stake", async function () {
      const slashAmount = ethers.parseEther("5000");
      await insurerRegistry.slashInsurer(1, slashAmount, "Fraudulent claims");
      const insurer = await insurerRegistry.getInsurer(1);
      expect(insurer.stake).to.equal(MIN_STAKE - slashAmount);
      expect(insurer.slashedAmount).to.equal(slashAmount);
    });

    it("Should emit InsurerSlashed event", async function () {
      const slashAmount = ethers.parseEther("5000");
      await expect(insurerRegistry.slashInsurer(1, slashAmount, "Fraudulent claims"))
        .to.emit(insurerRegistry, "InsurerSlashed")
        .withArgs(1, slashAmount, "Fraudulent claims");
    });

    it("Should deactivate insurer if stake falls below minimum", async function () {
      await insurerRegistry.slashInsurer(1, ethers.parseEther("5000"), "Misconduct");
      const insurer = await insurerRegistry.getInsurer(1);
      expect(insurer.active).to.be.false;
    });

    it("Should reject slashing from non-governance", async function () {
      await expect(
        insurerRegistry.connect(insurer1).slashInsurer(1, ethers.parseEther("1000"), "Test")
      ).to.be.reverted;
    });

    it("Should reject slashing more than stake", async function () {
      await expect(
        insurerRegistry.slashInsurer(1, ethers.parseEther("20000"), "Test")
      ).to.be.revertedWith("Amount exceeds stake");
    });
  });

  describe("Listing", function () {
    const terms = ethers.toUtf8Bytes("Standard insurance terms");
    const reserveProof = ethers.keccak256(ethers.toUtf8Bytes("reserve-proof"));

    it("Should list all active insurers", async function () {
      await insurerRegistry.connect(insurer1).registerInsurer(MIN_STAKE, terms, reserveProof);
      await insurerRegistry.connect(insurer2).registerInsurer(MIN_STAKE, terms, reserveProof);

      const insurers = await insurerRegistry.listInsurers();
      expect(insurers.length).to.equal(2);
    });

    it("Should not include deactivated insurers", async function () {
      await insurerRegistry.connect(insurer1).registerInsurer(MIN_STAKE, terms, reserveProof);
      await insurerRegistry.slashInsurer(1, ethers.parseEther("5000"), "Misconduct");

      const insurers = await insurerRegistry.listInsurers();
      expect(insurers.length).to.equal(0);
    });
  });

  describe("View Functions", function () {
    it("Should return correct active insurer count", async function () {
      const terms = ethers.toUtf8Bytes("Standard insurance terms");
      const reserveProof = ethers.keccak256(ethers.toUtf8Bytes("reserve-proof"));

      await insurerRegistry.connect(insurer1).registerInsurer(MIN_STAKE, terms, reserveProof);
      expect(await insurerRegistry.activeInsurerCount()).to.equal(1);
    });

    it("Should revert getInsurer for non-existent insurer", async function () {
      await expect(insurerRegistry.getInsurer(999))
        .to.be.revertedWith("Insurer does not exist");
    });
  });
});
