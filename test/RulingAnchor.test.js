const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("RulingAnchor", function () {
  let rulingAnchor;
  let owner;
  let anchorAgent;
  let user;

  beforeEach(async function () {
    [owner, anchorAgent, user] = await ethers.getSigners();

    const RulingAnchor = await ethers.getContractFactory("RulingAnchor");
    rulingAnchor = await RulingAnchor.deploy(owner.address);
    await rulingAnchor.waitForDeployment();

    // Grant anchor role to anchorAgent
    const ANCHOR_ROLE = await rulingAnchor.ANCHOR_ROLE();
    await rulingAnchor.grantRole(ANCHOR_ROLE, anchorAgent.address);
  });

  describe("Deployment", function () {
    it("Should set correct admin", async function () {
      const DEFAULT_ADMIN_ROLE = await rulingAnchor.DEFAULT_ADMIN_ROLE();
      expect(await rulingAnchor.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
    });

    it("Should start with zero anchored", async function () {
      expect(await rulingAnchor.totalAnchored()).to.equal(0);
    });

    it("Should have ANCHOR_ROLE defined", async function () {
      const ANCHOR_ROLE = await rulingAnchor.ANCHOR_ROLE();
      expect(ANCHOR_ROLE).to.not.equal(ethers.ZeroHash);
    });
  });

  describe("Anchoring with Chain ID", function () {
    const disputeId = 1;
    const rulingHash = ethers.keccak256(ethers.toUtf8Bytes("ruling_data"));
    const l2ChainId = 42161; // Arbitrum

    it("Should anchor a ruling", async function () {
      await rulingAnchor.connect(anchorAgent)["anchorRuling(uint256,bytes32,uint256)"](
        disputeId, rulingHash, l2ChainId
      );

      expect(await rulingAnchor.totalAnchored()).to.equal(1);
    });

    it("Should emit RulingAnchored event", async function () {
      await expect(
        rulingAnchor.connect(anchorAgent)["anchorRuling(uint256,bytes32,uint256)"](
          disputeId, rulingHash, l2ChainId
        )
      )
        .to.emit(rulingAnchor, "RulingAnchored")
        .withArgs(disputeId, rulingHash, l2ChainId, anchorAgent.address);
    });

    it("Should store correct anchor info", async function () {
      await rulingAnchor.connect(anchorAgent)["anchorRuling(uint256,bytes32,uint256)"](
        disputeId, rulingHash, l2ChainId
      );

      const anchor = await rulingAnchor["getAnchor(uint256,uint256)"](disputeId, l2ChainId);
      expect(anchor.rulingHash).to.equal(rulingHash);
      expect(anchor.disputeId).to.equal(disputeId);
      expect(anchor.l2ChainId).to.equal(l2ChainId);
      expect(anchor.anchoredBy).to.equal(anchorAgent.address);
      expect(anchor.exists).to.be.true;
    });

    it("Should reject duplicate anchor", async function () {
      await rulingAnchor.connect(anchorAgent)["anchorRuling(uint256,bytes32,uint256)"](
        disputeId, rulingHash, l2ChainId
      );

      await expect(
        rulingAnchor.connect(anchorAgent)["anchorRuling(uint256,bytes32,uint256)"](
          disputeId, rulingHash, l2ChainId
        )
      ).to.be.revertedWith("Already anchored");
    });

    it("Should reject zero ruling hash", async function () {
      await expect(
        rulingAnchor.connect(anchorAgent)["anchorRuling(uint256,bytes32,uint256)"](
          disputeId, ethers.ZeroHash, l2ChainId
        )
      ).to.be.revertedWith("Invalid ruling hash");
    });

    it("Should reject zero chain ID", async function () {
      await expect(
        rulingAnchor.connect(anchorAgent)["anchorRuling(uint256,bytes32,uint256)"](
          disputeId, rulingHash, 0
        )
      ).to.be.revertedWith("Invalid chain ID");
    });

    it("Should reject anchoring from non-anchor role", async function () {
      await expect(
        rulingAnchor.connect(user)["anchorRuling(uint256,bytes32,uint256)"](
          disputeId, rulingHash, l2ChainId
        )
      ).to.be.reverted;
    });
  });

  describe("Anchoring for Current Chain", function () {
    const disputeId = 1;
    const rulingHash = ethers.keccak256(ethers.toUtf8Bytes("ruling_data"));

    it("Should anchor a ruling for current chain", async function () {
      await rulingAnchor.connect(anchorAgent)["anchorRuling(uint256,bytes32)"](
        disputeId, rulingHash
      );

      expect(await rulingAnchor.totalAnchored()).to.equal(1);
    });

    it("Should emit RulingAnchored event with block.chainid", async function () {
      const chainId = (await ethers.provider.getNetwork()).chainId;

      await expect(
        rulingAnchor.connect(anchorAgent)["anchorRuling(uint256,bytes32)"](
          disputeId, rulingHash
        )
      ).to.emit(rulingAnchor, "RulingAnchored");
    });
  });

  describe("Verification", function () {
    const disputeId = 1;
    const rulingHash = ethers.keccak256(ethers.toUtf8Bytes("ruling_data"));
    const l2ChainId = 42161;

    beforeEach(async function () {
      await rulingAnchor.connect(anchorAgent)["anchorRuling(uint256,bytes32,uint256)"](
        disputeId, rulingHash, l2ChainId
      );
    });

    it("Should verify valid anchor", async function () {
      const valid = await rulingAnchor["verifyAnchor(uint256,bytes32,uint256)"](
        disputeId, rulingHash, l2ChainId
      );
      expect(valid).to.be.true;
    });

    it("Should reject invalid ruling hash", async function () {
      const wrongHash = ethers.keccak256(ethers.toUtf8Bytes("wrong_data"));
      const valid = await rulingAnchor["verifyAnchor(uint256,bytes32,uint256)"](
        disputeId, wrongHash, l2ChainId
      );
      expect(valid).to.be.false;
    });

    it("Should return false for non-existent anchor", async function () {
      const valid = await rulingAnchor["verifyAnchor(uint256,bytes32,uint256)"](
        999, rulingHash, l2ChainId
      );
      expect(valid).to.be.false;
    });
  });

  describe("View Functions", function () {
    const disputeId1 = 1;
    const disputeId2 = 2;
    const rulingHash1 = ethers.keccak256(ethers.toUtf8Bytes("ruling_1"));
    const rulingHash2 = ethers.keccak256(ethers.toUtf8Bytes("ruling_2"));
    const l2ChainId = 42161;

    beforeEach(async function () {
      await rulingAnchor.connect(anchorAgent)["anchorRuling(uint256,bytes32,uint256)"](
        disputeId1, rulingHash1, l2ChainId
      );
      await rulingAnchor.connect(anchorAgent)["anchorRuling(uint256,bytes32,uint256)"](
        disputeId2, rulingHash2, l2ChainId
      );
    });

    it("Should get dispute by hash", async function () {
      const id = await rulingAnchor.getDisputeByHash(rulingHash1);
      expect(id).to.equal(disputeId1);
    });

    it("Should return zero for unknown hash", async function () {
      const unknownHash = ethers.keccak256(ethers.toUtf8Bytes("unknown"));
      const id = await rulingAnchor.getDisputeByHash(unknownHash);
      expect(id).to.equal(0);
    });

    it("Should check if dispute is anchored", async function () {
      expect(await rulingAnchor["isAnchored(uint256,uint256)"](disputeId1, l2ChainId)).to.be.true;
      expect(await rulingAnchor["isAnchored(uint256,uint256)"](999, l2ChainId)).to.be.false;
    });

    it("Should check if dispute is anchored anywhere", async function () {
      expect(await rulingAnchor["isAnchored(uint256)"](disputeId1)).to.be.true;
      expect(await rulingAnchor["isAnchored(uint256)"](999)).to.be.false;
    });

    it("Should get all anchored disputes", async function () {
      const disputes = await rulingAnchor.getAnchoredDisputes();
      expect(disputes.length).to.equal(2);
      expect(disputes[0]).to.equal(disputeId1);
      expect(disputes[1]).to.equal(disputeId2);
    });

    it("Should get anchored count", async function () {
      expect(await rulingAnchor.anchoredCount()).to.equal(2);
    });

    it("Should revert getAnchor for non-existent", async function () {
      await expect(
        rulingAnchor["getAnchor(uint256,uint256)"](999, l2ChainId)
      ).to.be.revertedWith("Anchor does not exist");
    });
  });

  describe("Multiple Chains", function () {
    const disputeId = 1;
    const rulingHash = ethers.keccak256(ethers.toUtf8Bytes("ruling_data"));
    const arbitrumChainId = 42161;
    const optimismChainId = 10;

    it("Should allow same dispute on different chains", async function () {
      await rulingAnchor.connect(anchorAgent)["anchorRuling(uint256,bytes32,uint256)"](
        disputeId, rulingHash, arbitrumChainId
      );
      await rulingAnchor.connect(anchorAgent)["anchorRuling(uint256,bytes32,uint256)"](
        disputeId, rulingHash, optimismChainId
      );

      expect(await rulingAnchor.totalAnchored()).to.equal(2);

      // Both should be retrievable
      const anchor1 = await rulingAnchor["getAnchor(uint256,uint256)"](disputeId, arbitrumChainId);
      const anchor2 = await rulingAnchor["getAnchor(uint256,uint256)"](disputeId, optimismChainId);

      expect(anchor1.l2ChainId).to.equal(arbitrumChainId);
      expect(anchor2.l2ChainId).to.equal(optimismChainId);
    });
  });
});
