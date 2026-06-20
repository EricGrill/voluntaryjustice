const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * Coverage-focused suite for CrossChainBridge — targets the uncovered
 * revert/require branches and both sides of important conditionals
 * (reconfigure existing chain, verifyMessage proof branches, status guards).
 */
describe("CrossChainBridge — Coverage", function () {
  let bridge;
  let owner, relayer, governance, user, other;

  const ETHEREUM_MAINNET = 1;
  const ARBITRUM_ONE = 42161;
  const OPTIMISM = 10;

  const rulingHash = ethers.keccak256(ethers.toUtf8Bytes("ruling-data"));
  const disputeId = 7;

  beforeEach(async function () {
    [owner, relayer, governance, user, other] = await ethers.getSigners();

    const CrossChainBridge = await ethers.getContractFactory("CrossChainBridge");
    bridge = await CrossChainBridge.deploy(owner.address);

    const RELAYER_ROLE = await bridge.RELAYER_ROLE();
    const GOVERNANCE_ROLE = await bridge.GOVERNANCE_ROLE();
    await bridge.grantRole(RELAYER_ROLE, relayer.address);
    await bridge.grantRole(GOVERNANCE_ROLE, governance.address);
  });

  describe("configureChain", function () {
    it("Should reject configuration from non-governance", async function () {
      await expect(
        bridge.connect(user).configureChain(ETHEREUM_MAINNET, user.address, user.address, 12)
      ).to.be.reverted;
    });

    it("Should reconfigure an existing chain without re-adding to the supported list", async function () {
      await bridge.configureChain(ARBITRUM_ONE, user.address, user.address, 5);
      // Reconfigure (isNew == false path)
      await bridge.configureChain(ARBITRUM_ONE, other.address, other.address, 9);

      const chains = await bridge.listSupportedChains();
      expect(chains.length).to.equal(1);

      const config = await bridge.getChainConfig(ARBITRUM_ONE);
      expect(config.bridgeContract).to.equal(other.address);
      expect(config.confirmationBlocks).to.equal(9);
      expect(config.active).to.be.true;
    });
  });

  describe("deactivateChain", function () {
    it("Should reject deactivating an unconfigured chain", async function () {
      await expect(bridge.deactivateChain(OPTIMISM))
        .to.be.revertedWith("Chain not configured");
    });

    it("Should reject deactivating an already-inactive chain", async function () {
      await bridge.configureChain(OPTIMISM, user.address, user.address, 0);
      await bridge.deactivateChain(OPTIMISM);
      await expect(bridge.deactivateChain(OPTIMISM))
        .to.be.revertedWith("Already inactive");
    });

    it("Should reject deactivation from non-governance", async function () {
      await bridge.configureChain(OPTIMISM, user.address, user.address, 0);
      await expect(bridge.connect(user).deactivateChain(OPTIMISM)).to.be.reverted;
    });
  });

  describe("sendToChain / sendToMainnet error branches", function () {
    it("sendToChain rejects an unconfigured destination chain", async function () {
      await expect(bridge.sendToChain(rulingHash, disputeId, OPTIMISM))
        .to.be.revertedWith("Destination chain not active");
    });

    it("sendToMainnet rejects a zero ruling hash", async function () {
      await expect(bridge.sendToMainnet(ethers.ZeroHash, disputeId))
        .to.be.revertedWith("Invalid ruling hash");
    });

    it("sendToMainnet rejects when mainnet is not configured/active", async function () {
      await expect(bridge.sendToMainnet(rulingHash, disputeId))
        .to.be.revertedWith("Destination chain not active");
    });

    it("sendToMainnet succeeds and records the message", async function () {
      await bridge.configureChain(ETHEREUM_MAINNET, user.address, user.address, 12);
      await expect(bridge.sendToMainnet(rulingHash, disputeId))
        .to.emit(bridge, "MessageSent");

      expect(await bridge.totalMessages()).to.equal(1);
      const msg = await bridge.getMessage(1);
      expect(msg.destChainId).to.equal(ETHEREUM_MAINNET);
      expect(msg.disputeId).to.equal(disputeId);
      expect(msg.status).to.equal(0); // Pending
    });

    it("sendToChain records dispute message mapping", async function () {
      await bridge.configureChain(ARBITRUM_ONE, user.address, user.address, 0);
      await bridge.sendToChain(rulingHash, disputeId, ARBITRUM_ONE);

      // source chain is block.chainid (hardhat = 31337)
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const ids = await bridge.getMessagesForDispute(chainId, disputeId);
      expect(ids.length).to.equal(1);
    });
  });

  describe("receiveFromChain error branches", function () {
    beforeEach(async function () {
      await bridge.configureChain(ARBITRUM_ONE, user.address, user.address, 0);
    });

    it("rejects zero ruling hash", async function () {
      const messageHash = ethers.keccak256(ethers.toUtf8Bytes("m1"));
      await expect(
        bridge.connect(relayer).receiveFromChain(ethers.ZeroHash, disputeId, ARBITRUM_ONE, messageHash)
      ).to.be.revertedWith("Invalid ruling hash");
    });

    it("rejects inactive source chain", async function () {
      await bridge.deactivateChain(ARBITRUM_ONE);
      const messageHash = ethers.keccak256(ethers.toUtf8Bytes("m1"));
      await expect(
        bridge.connect(relayer).receiveFromChain(rulingHash, disputeId, ARBITRUM_ONE, messageHash)
      ).to.be.revertedWith("Source chain not active");
    });
  });

  describe("verifyMessage branches", function () {
    const messageHash = ethers.keccak256(ethers.toUtf8Bytes("orig-message"));

    beforeEach(async function () {
      await bridge.configureChain(ARBITRUM_ONE, user.address, user.address, 0);
    });

    it("returns false for an unknown message hash", async function () {
      const unknown = ethers.keccak256(ethers.toUtf8Bytes("nope"));
      expect(await bridge.verifyMessage(unknown, "0x")).to.be.false;
    });

    it("returns false for a non-confirmed (pending) message", async function () {
      // sendToChain produces a Pending message
      await bridge.sendToChain(rulingHash, disputeId, ARBITRUM_ONE);
      const sent = await bridge.getMessage(1);
      expect(await bridge.verifyMessage(sent.messageHash, "0x")).to.be.false;
    });

    it("returns true for a confirmed message with no proof", async function () {
      await bridge.connect(relayer).receiveFromChain(rulingHash, disputeId, ARBITRUM_ONE, messageHash);
      expect(await bridge.verifyMessage(messageHash, "0x")).to.be.true;
    });

    it("returns true for a confirmed message with a non-empty proof", async function () {
      await bridge.connect(relayer).receiveFromChain(rulingHash, disputeId, ARBITRUM_ONE, messageHash);
      const proof = ethers.toUtf8Bytes("merkle-proof");
      expect(await bridge.verifyMessage(messageHash, proof)).to.be.true;
    });

    it("returns true for an executed message", async function () {
      await bridge.connect(relayer).receiveFromChain(rulingHash, disputeId, ARBITRUM_ONE, messageHash);
      await bridge.connect(relayer).markExecuted(1);
      expect(await bridge.verifyMessage(messageHash, "0x")).to.be.true;
    });
  });

  describe("markExecuted / markFailed status guards", function () {
    const messageHash = ethers.keccak256(ethers.toUtf8Bytes("orig-message"));

    beforeEach(async function () {
      await bridge.configureChain(ARBITRUM_ONE, user.address, user.address, 0);
    });

    it("markExecuted rejects a non-existent message", async function () {
      await expect(bridge.connect(relayer).markExecuted(999))
        .to.be.revertedWith("Message not found");
    });

    it("markExecuted rejects a non-confirmed (pending) message", async function () {
      await bridge.sendToChain(rulingHash, disputeId, ARBITRUM_ONE);
      await expect(bridge.connect(relayer).markExecuted(1))
        .to.be.revertedWith("Invalid status");
    });

    it("markExecuted rejects a non-relayer caller", async function () {
      await bridge.connect(relayer).receiveFromChain(rulingHash, disputeId, ARBITRUM_ONE, messageHash);
      await expect(bridge.connect(user).markExecuted(1)).to.be.reverted;
    });

    it("markFailed rejects a non-existent message", async function () {
      await expect(bridge.connect(relayer).markFailed(999, "boom"))
        .to.be.revertedWith("Message not found");
    });

    it("markFailed succeeds on a Pending message", async function () {
      await bridge.sendToChain(rulingHash, disputeId, ARBITRUM_ONE);
      await expect(bridge.connect(relayer).markFailed(1, "boom"))
        .to.emit(bridge, "MessageFailed");
      expect((await bridge.getMessage(1)).status).to.equal(3); // Failed
    });

    it("markFailed succeeds on a Confirmed message", async function () {
      await bridge.connect(relayer).receiveFromChain(rulingHash, disputeId, ARBITRUM_ONE, messageHash);
      await bridge.connect(relayer).markFailed(1, "boom");
      expect((await bridge.getMessage(1)).status).to.equal(3); // Failed
    });

    it("markFailed rejects a message already in Executed status", async function () {
      await bridge.connect(relayer).receiveFromChain(rulingHash, disputeId, ARBITRUM_ONE, messageHash);
      await bridge.connect(relayer).markExecuted(1);
      await expect(bridge.connect(relayer).markFailed(1, "boom"))
        .to.be.revertedWith("Invalid status");
    });
  });

  describe("view helpers", function () {
    it("getMessageByHash reverts for an unknown hash", async function () {
      const unknown = ethers.keccak256(ethers.toUtf8Bytes("ghost"));
      await expect(bridge.getMessageByHash(unknown))
        .to.be.revertedWith("Message not found");
    });

    it("isChainActive returns false for an unconfigured chain", async function () {
      expect(await bridge.isChainActive(OPTIMISM)).to.be.false;
    });
  });
});
