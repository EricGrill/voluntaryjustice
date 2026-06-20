const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * Branch-coverage focused tests for InsurerRegistry.
 * Exercises register/update/stake/slash/record paths and every revert branch.
 */
describe("InsurerRegistry — Coverage", function () {
  let vjToken, insurerRegistry;
  let owner, insurer1, insurer2, governor, other;
  const MIN_STAKE = ethers.parseEther("10000");
  const terms = ethers.toUtf8Bytes("Standard insurance terms");
  const newTerms = ethers.toUtf8Bytes("Updated terms");
  const reserveProof = ethers.keccak256(ethers.toUtf8Bytes("reserve-proof"));
  const newProof = ethers.keccak256(ethers.toUtf8Bytes("new-proof"));

  beforeEach(async function () {
    [owner, insurer1, insurer2, governor, other] = await ethers.getSigners();

    const VJToken = await ethers.getContractFactory("VJToken");
    vjToken = await VJToken.deploy(owner.address);

    const InsurerRegistry = await ethers.getContractFactory("InsurerRegistry");
    insurerRegistry = await InsurerRegistry.deploy(owner.address, await vjToken.getAddress());

    const STAKING_ROLE = await vjToken.STAKING_ROLE();
    await vjToken.grantRole(STAKING_ROLE, await insurerRegistry.getAddress());

    for (const acct of [insurer1, insurer2]) {
      await vjToken.mint(acct.address, ethers.parseEther("200000"));
      await vjToken.connect(acct).approve(await insurerRegistry.getAddress(), ethers.MaxUint256);
    }
  });

  async function register(signer) {
    await insurerRegistry.connect(signer).registerInsurer(MIN_STAKE, terms, reserveProof);
  }

  describe("registerInsurer branches", function () {
    it("reverts without a reserve proof", async function () {
      await expect(insurerRegistry.connect(insurer1).registerInsurer(MIN_STAKE, terms, ethers.ZeroHash))
        .to.be.revertedWith("Reserve proof required");
    });

    it("notifies the token of the stake", async function () {
      await register(insurer1);
      expect(await vjToken.stakedBalanceOf(insurer1.address)).to.equal(MIN_STAKE);
    });
  });

  describe("updateReserveProof branches", function () {
    beforeEach(async function () {
      await register(insurer1);
    });

    it("updates the reserve proof", async function () {
      await insurerRegistry.connect(insurer1).updateReserveProof(1, newProof);
      const ins = await insurerRegistry.getInsurer(1);
      expect(ins.reserveProofHash).to.equal(newProof);
    });

    it("reverts on a non-existent insurer", async function () {
      await expect(insurerRegistry.connect(insurer1).updateReserveProof(999, newProof))
        .to.be.revertedWith("Insurer does not exist");
    });

    it("reverts when caller is not the operator", async function () {
      await expect(insurerRegistry.connect(insurer2).updateReserveProof(1, newProof))
        .to.be.revertedWith("Not operator");
    });

    it("reverts with a zero reserve proof", async function () {
      await expect(insurerRegistry.connect(insurer1).updateReserveProof(1, ethers.ZeroHash))
        .to.be.revertedWith("Reserve proof required");
    });
  });

  describe("updateTerms branches", function () {
    beforeEach(async function () {
      await register(insurer1);
    });

    it("reverts on a non-existent insurer", async function () {
      await expect(insurerRegistry.connect(insurer1).updateTerms(999, newTerms))
        .to.be.revertedWith("Insurer does not exist");
    });

    it("reverts with empty terms", async function () {
      await expect(insurerRegistry.connect(insurer1).updateTerms(1, "0x"))
        .to.be.revertedWith("Terms required");
    });
  });

  describe("increaseStake branches", function () {
    beforeEach(async function () {
      await register(insurer1);
    });

    it("increases the stake and notifies the token", async function () {
      const add = ethers.parseEther("5000");
      await insurerRegistry.connect(insurer1).increaseStake(1, add);
      expect((await insurerRegistry.getInsurer(1)).stake).to.equal(MIN_STAKE + add);
      expect(await vjToken.stakedBalanceOf(insurer1.address)).to.equal(MIN_STAKE + add);
    });

    it("reverts on a non-existent insurer", async function () {
      await expect(insurerRegistry.connect(insurer1).increaseStake(999, ethers.parseEther("1")))
        .to.be.revertedWith("Insurer does not exist");
    });

    it("reverts on a zero amount", async function () {
      await expect(insurerRegistry.connect(insurer1).increaseStake(1, 0))
        .to.be.revertedWith("Amount must be positive");
    });
  });

  describe("slashInsurer branches", function () {
    beforeEach(async function () {
      // insurer1 stakes well above MIN_STAKE so a partial slash keeps it active.
      await insurerRegistry.connect(insurer1).registerInsurer(
        ethers.parseEther("30000"), terms, reserveProof
      );
    });

    it("slashes without deactivating when stake stays above minimum", async function () {
      await expect(insurerRegistry.slashInsurer(1, ethers.parseEther("5000"), "minor"))
        .to.emit(insurerRegistry, "InsurerSlashed")
        .and.to.not.emit(insurerRegistry, "InsurerDeactivated");
      const ins = await insurerRegistry.getInsurer(1);
      expect(ins.active).to.be.true;
      expect(ins.stake).to.equal(ethers.parseEther("25000"));
      expect(await insurerRegistry.activeInsurerCount()).to.equal(1);
    });

    it("deactivates and removes from the active list when stake drops below minimum", async function () {
      await expect(insurerRegistry.slashInsurer(1, ethers.parseEther("25000"), "major"))
        .to.emit(insurerRegistry, "InsurerDeactivated")
        .withArgs(1);
      const ins = await insurerRegistry.getInsurer(1);
      expect(ins.active).to.be.false;
      expect(await insurerRegistry.activeInsurerCount()).to.equal(0);
    });

    it("burns the slashed tokens", async function () {
      const supplyBefore = await vjToken.totalSupply();
      await insurerRegistry.slashInsurer(1, ethers.parseEther("5000"), "burn-check");
      expect(await vjToken.totalSupply()).to.equal(supplyBefore - ethers.parseEther("5000"));
    });

    it("reverts on a non-existent insurer", async function () {
      await expect(insurerRegistry.slashInsurer(999, ethers.parseEther("1"), "x"))
        .to.be.revertedWith("Insurer does not exist");
    });

    it("reverts when the reason is empty", async function () {
      await expect(insurerRegistry.slashInsurer(1, ethers.parseEther("1"), ""))
        .to.be.revertedWith("Reason required");
    });

    it("does not re-remove an already-inactive insurer on a second slash", async function () {
      // Drop below minimum (deactivate), then slash again -> active branch is false.
      await insurerRegistry.slashInsurer(1, ethers.parseEther("25000"), "first");
      await expect(insurerRegistry.slashInsurer(1, ethers.parseEther("1000"), "second"))
        .to.emit(insurerRegistry, "InsurerSlashed")
        .and.to.not.emit(insurerRegistry, "InsurerDeactivated");
      expect(await insurerRegistry.activeInsurerCount()).to.equal(0);
    });

    it("removes the correct entry from the middle of the active list", async function () {
      // Register two more so the active list has [1,2,3]; slash #2 to exercise the swap-pop.
      await insurerRegistry.connect(insurer2).registerInsurer(
        ethers.parseEther("30000"), terms, reserveProof
      );
      await vjToken.mint(other.address, ethers.parseEther("200000"));
      await vjToken.connect(other).approve(await insurerRegistry.getAddress(), ethers.MaxUint256);
      await insurerRegistry.connect(other).registerInsurer(
        ethers.parseEther("30000"), terms, reserveProof
      );
      expect(await insurerRegistry.activeInsurerCount()).to.equal(3);

      await insurerRegistry.slashInsurer(2, ethers.parseEther("30000"), "deactivate-middle");
      expect(await insurerRegistry.activeInsurerCount()).to.equal(2);
      const remaining = (await insurerRegistry.listInsurers()).map((i) => Number(i.id));
      expect(remaining).to.not.include(2);
      expect(remaining).to.include(1);
      expect(remaining).to.include(3);
    });
  });

  describe("recordPolicy / recordClaim branches", function () {
    beforeEach(async function () {
      await register(insurer1);
      const GOVERNANCE_ROLE = await insurerRegistry.GOVERNANCE_ROLE();
      await insurerRegistry.grantRole(GOVERNANCE_ROLE, governor.address);
    });

    it("records a policy", async function () {
      await expect(insurerRegistry.connect(governor).recordPolicy(1))
        .to.emit(insurerRegistry, "PolicyRecorded")
        .withArgs(1);
      expect((await insurerRegistry.getInsurer(1)).policiesIssued).to.equal(1);
    });

    it("reverts recordPolicy on a non-existent insurer", async function () {
      await expect(insurerRegistry.connect(governor).recordPolicy(999))
        .to.be.revertedWith("Insurer does not exist");
    });

    it("reverts recordPolicy without GOVERNANCE_ROLE", async function () {
      await expect(insurerRegistry.connect(other).recordPolicy(1)).to.be.reverted;
    });

    it("records a claim", async function () {
      await expect(insurerRegistry.connect(governor).recordClaim(1, ethers.parseEther("100")))
        .to.emit(insurerRegistry, "ClaimRecorded")
        .withArgs(1, ethers.parseEther("100"));
      expect((await insurerRegistry.getInsurer(1)).claimsPaid).to.equal(ethers.parseEther("100"));
    });

    it("reverts recordClaim on a non-existent insurer", async function () {
      await expect(insurerRegistry.connect(governor).recordClaim(999, 1))
        .to.be.revertedWith("Insurer does not exist");
    });

    it("reverts recordClaim without GOVERNANCE_ROLE", async function () {
      await expect(insurerRegistry.connect(other).recordClaim(1, 1)).to.be.reverted;
    });
  });

  describe("view functions", function () {
    it("getInsurerByOperator returns 0 for unknown operator", async function () {
      expect(await insurerRegistry.getInsurerByOperator(other.address)).to.equal(0);
    });

    it("listInsurers returns an empty list before any registration", async function () {
      expect((await insurerRegistry.listInsurers()).length).to.equal(0);
    });
  });
});
