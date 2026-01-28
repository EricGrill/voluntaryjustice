const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("OracleRegistry", function () {
  let oracleRegistry;
  let vjToken;
  let owner;
  let oracle1;
  let oracle2;
  let oracle3;
  let user;

  const MIN_STAKE = ethers.parseEther("5000");
  const QUORUM_THRESHOLD = 3;

  beforeEach(async function () {
    [owner, oracle1, oracle2, oracle3, user] = await ethers.getSigners();

    // Deploy VJToken
    const VJToken = await ethers.getContractFactory("VJToken");
    vjToken = await VJToken.deploy(owner.address);
    await vjToken.waitForDeployment();

    // Deploy OracleRegistry
    const OracleRegistry = await ethers.getContractFactory("OracleRegistry");
    oracleRegistry = await OracleRegistry.deploy(owner.address, await vjToken.getAddress());
    await oracleRegistry.waitForDeployment();

    // Setup staking role
    const STAKING_ROLE = await vjToken.STAKING_ROLE();
    await vjToken.grantRole(STAKING_ROLE, await oracleRegistry.getAddress());

    // Mint tokens to oracles
    await vjToken.mint(oracle1.address, ethers.parseEther("50000"));
    await vjToken.mint(oracle2.address, ethers.parseEther("50000"));
    await vjToken.mint(oracle3.address, ethers.parseEther("50000"));

    // Approve registry
    await vjToken.connect(oracle1).approve(await oracleRegistry.getAddress(), ethers.MaxUint256);
    await vjToken.connect(oracle2).approve(await oracleRegistry.getAddress(), ethers.MaxUint256);
    await vjToken.connect(oracle3).approve(await oracleRegistry.getAddress(), ethers.MaxUint256);
  });

  describe("Deployment", function () {
    it("Should set correct VJ token", async function () {
      expect(await oracleRegistry.vjToken()).to.equal(await vjToken.getAddress());
    });

    it("Should start with zero oracles", async function () {
      expect(await oracleRegistry.totalOracles()).to.equal(0);
      expect(await oracleRegistry.activeOracleCount()).to.equal(0);
    });

    it("Should have correct MIN_STAKE", async function () {
      expect(await oracleRegistry.MIN_STAKE()).to.equal(MIN_STAKE);
    });

    it("Should have correct QUORUM_THRESHOLD", async function () {
      expect(await oracleRegistry.QUORUM_THRESHOLD()).to.equal(QUORUM_THRESHOLD);
    });
  });

  describe("Oracle Registration", function () {
    it("Should register an oracle", async function () {
      await oracleRegistry.connect(oracle1).registerOracle("ipfs://oracle1", MIN_STAKE);

      expect(await oracleRegistry.totalOracles()).to.equal(1);
      expect(await oracleRegistry.activeOracleCount()).to.equal(1);
    });

    it("Should emit OracleRegistered event", async function () {
      await expect(oracleRegistry.connect(oracle1).registerOracle("ipfs://oracle1", MIN_STAKE))
        .to.emit(oracleRegistry, "OracleRegistered")
        .withArgs(1, oracle1.address, MIN_STAKE);
    });

    it("Should store correct oracle info", async function () {
      await oracleRegistry.connect(oracle1).registerOracle("ipfs://oracle1", MIN_STAKE);

      const oracle = await oracleRegistry.getOracle(1);
      expect(oracle.id).to.equal(1);
      expect(oracle.operator).to.equal(oracle1.address);
      expect(oracle.metadata).to.equal("ipfs://oracle1");
      expect(oracle.stake).to.equal(MIN_STAKE);
      expect(oracle.active).to.be.true;
    });

    it("Should reject stake below minimum", async function () {
      await expect(
        oracleRegistry.connect(oracle1).registerOracle("ipfs://oracle1", MIN_STAKE - 1n)
      ).to.be.revertedWith("Insufficient stake");
    });

    it("Should reject empty metadata", async function () {
      await expect(
        oracleRegistry.connect(oracle1).registerOracle("", MIN_STAKE)
      ).to.be.revertedWith("Metadata required");
    });

    it("Should reject duplicate registration", async function () {
      await oracleRegistry.connect(oracle1).registerOracle("ipfs://oracle1", MIN_STAKE);

      await expect(
        oracleRegistry.connect(oracle1).registerOracle("ipfs://oracle1", MIN_STAKE)
      ).to.be.revertedWith("Already registered");
    });
  });

  describe("Oracle Metadata Update", function () {
    beforeEach(async function () {
      await oracleRegistry.connect(oracle1).registerOracle("ipfs://oracle1", MIN_STAKE);
    });

    it("Should update metadata", async function () {
      await oracleRegistry.connect(oracle1).updateOracleMetadata(1, "ipfs://oracle1-v2");

      const oracle = await oracleRegistry.getOracle(1);
      expect(oracle.metadata).to.equal("ipfs://oracle1-v2");
    });

    it("Should emit OracleMetadataUpdated event", async function () {
      await expect(oracleRegistry.connect(oracle1).updateOracleMetadata(1, "ipfs://oracle1-v2"))
        .to.emit(oracleRegistry, "OracleMetadataUpdated")
        .withArgs(1, "ipfs://oracle1-v2");
    });

    it("Should reject update from non-operator", async function () {
      await expect(
        oracleRegistry.connect(oracle2).updateOracleMetadata(1, "ipfs://oracle1-v2")
      ).to.be.revertedWith("Not operator");
    });
  });

  describe("Stake Management", function () {
    beforeEach(async function () {
      await oracleRegistry.connect(oracle1).registerOracle("ipfs://oracle1", MIN_STAKE);
    });

    it("Should increase stake", async function () {
      const additionalStake = ethers.parseEther("1000");
      await oracleRegistry.connect(oracle1).increaseStake(1, additionalStake);

      const oracle = await oracleRegistry.getOracle(1);
      expect(oracle.stake).to.equal(MIN_STAKE + additionalStake);
    });

    it("Should reject increase from non-operator", async function () {
      await expect(
        oracleRegistry.connect(oracle2).increaseStake(1, ethers.parseEther("1000"))
      ).to.be.revertedWith("Not operator");
    });
  });

  describe("Slashing", function () {
    beforeEach(async function () {
      await oracleRegistry.connect(oracle1).registerOracle("ipfs://oracle1", MIN_STAKE);
    });

    it("Should slash oracle stake", async function () {
      const slashAmount = ethers.parseEther("1000");
      await oracleRegistry.slashOracle(1, slashAmount, "False attestation");

      const oracle = await oracleRegistry.getOracle(1);
      expect(oracle.stake).to.equal(MIN_STAKE - slashAmount);
      expect(oracle.slashedAmount).to.equal(slashAmount);
    });

    it("Should emit OracleSlashed event", async function () {
      const slashAmount = ethers.parseEther("1000");
      await expect(oracleRegistry.slashOracle(1, slashAmount, "False attestation"))
        .to.emit(oracleRegistry, "OracleSlashed")
        .withArgs(1, slashAmount, "False attestation");
    });

    it("Should deactivate oracle if stake falls below minimum", async function () {
      const slashAmount = ethers.parseEther("2000"); // Leaves 3000, below 5000 minimum
      await oracleRegistry.slashOracle(1, slashAmount, "False attestation");

      const oracle = await oracleRegistry.getOracle(1);
      expect(oracle.active).to.be.false;
      expect(await oracleRegistry.activeOracleCount()).to.equal(0);
    });

    it("Should reject slashing from non-governance", async function () {
      await expect(
        oracleRegistry.connect(oracle1).slashOracle(1, ethers.parseEther("1000"), "Test")
      ).to.be.reverted;
    });
  });

  describe("Oracle Deactivation", function () {
    beforeEach(async function () {
      await oracleRegistry.connect(oracle1).registerOracle("ipfs://oracle1", MIN_STAKE);
    });

    it("Should allow self-deactivation", async function () {
      await oracleRegistry.connect(oracle1).deactivateOracle(1);

      const oracle = await oracleRegistry.getOracle(1);
      expect(oracle.active).to.be.false;
    });

    it("Should allow governance deactivation", async function () {
      await oracleRegistry.deactivateOracle(1);

      const oracle = await oracleRegistry.getOracle(1);
      expect(oracle.active).to.be.false;
    });

    it("Should allow reactivation", async function () {
      await oracleRegistry.connect(oracle1).deactivateOracle(1);
      await oracleRegistry.connect(oracle1).reactivateOracle(1);

      const oracle = await oracleRegistry.getOracle(1);
      expect(oracle.active).to.be.true;
    });

    it("Should emit OracleDeactivated event", async function () {
      await expect(oracleRegistry.connect(oracle1).deactivateOracle(1))
        .to.emit(oracleRegistry, "OracleDeactivated")
        .withArgs(1);
    });
  });

  describe("Attestations", function () {
    const bountyId = 1;
    const attestationHash = ethers.keccak256(ethers.toUtf8Bytes("recovery_proof"));

    beforeEach(async function () {
      await oracleRegistry.connect(oracle1).registerOracle("ipfs://oracle1", MIN_STAKE);
      await oracleRegistry.connect(oracle2).registerOracle("ipfs://oracle2", MIN_STAKE);
      await oracleRegistry.connect(oracle3).registerOracle("ipfs://oracle3", MIN_STAKE);
    });

    it("Should submit attestation", async function () {
      await oracleRegistry.connect(oracle1).submitAttestation(bountyId, attestationHash);

      expect(await oracleRegistry.getAttestationCount(bountyId)).to.equal(1);
    });

    it("Should emit AttestationSubmitted event", async function () {
      await expect(oracleRegistry.connect(oracle1).submitAttestation(bountyId, attestationHash))
        .to.emit(oracleRegistry, "AttestationSubmitted")
        .withArgs(bountyId, 1, attestationHash);
    });

    it("Should track oracle has attested", async function () {
      await oracleRegistry.connect(oracle1).submitAttestation(bountyId, attestationHash);

      expect(await oracleRegistry.hasOracleAttested(bountyId, 1)).to.be.true;
      expect(await oracleRegistry.hasOracleAttested(bountyId, 2)).to.be.false;
    });

    it("Should reject duplicate attestation", async function () {
      await oracleRegistry.connect(oracle1).submitAttestation(bountyId, attestationHash);

      await expect(
        oracleRegistry.connect(oracle1).submitAttestation(bountyId, attestationHash)
      ).to.be.revertedWith("Already attested");
    });

    it("Should reject attestation from non-oracle", async function () {
      await expect(
        oracleRegistry.connect(user).submitAttestation(bountyId, attestationHash)
      ).to.be.revertedWith("Not a registered oracle");
    });

    it("Should reject attestation from inactive oracle", async function () {
      await oracleRegistry.connect(oracle1).deactivateOracle(1);

      await expect(
        oracleRegistry.connect(oracle1).submitAttestation(bountyId, attestationHash)
      ).to.be.revertedWith("Oracle not active");
    });

    it("Should not have quorum with 2 attestations", async function () {
      await oracleRegistry.connect(oracle1).submitAttestation(bountyId, attestationHash);
      await oracleRegistry.connect(oracle2).submitAttestation(bountyId, attestationHash);

      expect(await oracleRegistry.hasQuorum(bountyId)).to.be.false;
    });

    it("Should have quorum with 3 attestations", async function () {
      await oracleRegistry.connect(oracle1).submitAttestation(bountyId, attestationHash);
      await oracleRegistry.connect(oracle2).submitAttestation(bountyId, attestationHash);
      await oracleRegistry.connect(oracle3).submitAttestation(bountyId, attestationHash);

      expect(await oracleRegistry.hasQuorum(bountyId)).to.be.true;
    });

    it("Should emit QuorumReached event", async function () {
      await oracleRegistry.connect(oracle1).submitAttestation(bountyId, attestationHash);
      await oracleRegistry.connect(oracle2).submitAttestation(bountyId, attestationHash);

      await expect(oracleRegistry.connect(oracle3).submitAttestation(bountyId, attestationHash))
        .to.emit(oracleRegistry, "QuorumReached")
        .withArgs(bountyId, 3);
    });

    it("Should get attestations", async function () {
      await oracleRegistry.connect(oracle1).submitAttestation(bountyId, attestationHash);
      await oracleRegistry.connect(oracle2).submitAttestation(bountyId, attestationHash);

      const attestations = await oracleRegistry.getAttestations(bountyId);
      expect(attestations.length).to.equal(2);
      expect(attestations[0].oracleId).to.equal(1);
      expect(attestations[1].oracleId).to.equal(2);
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      await oracleRegistry.connect(oracle1).registerOracle("ipfs://oracle1", MIN_STAKE);
      await oracleRegistry.connect(oracle2).registerOracle("ipfs://oracle2", MIN_STAKE);
    });

    it("Should get oracle by operator", async function () {
      expect(await oracleRegistry.getOracleByOperator(oracle1.address)).to.equal(1);
      expect(await oracleRegistry.getOracleByOperator(oracle2.address)).to.equal(2);
    });

    it("Should return zero for non-registered operator", async function () {
      expect(await oracleRegistry.getOracleByOperator(user.address)).to.equal(0);
    });

    it("Should list active oracles", async function () {
      const oracles = await oracleRegistry.listActiveOracles();
      expect(oracles.length).to.equal(2);
    });

    it("Should revert getOracle for non-existent", async function () {
      await expect(oracleRegistry.getOracle(999))
        .to.be.revertedWith("Oracle does not exist");
    });
  });
});
