const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CrossChainBridge", function () {
  let crossChainBridge;
  let owner;
  let relayer;
  let user;

  const ETHEREUM_MAINNET = 1;
  const ARBITRUM_ONE = 42161;
  const OPTIMISM = 10;

  beforeEach(async function () {
    [owner, relayer, user] = await ethers.getSigners();

    const CrossChainBridge = await ethers.getContractFactory("CrossChainBridge");
    crossChainBridge = await CrossChainBridge.deploy(owner.address);
    await crossChainBridge.waitForDeployment();

    // Grant RELAYER_ROLE
    const RELAYER_ROLE = await crossChainBridge.RELAYER_ROLE();
    await crossChainBridge.grantRole(RELAYER_ROLE, relayer.address);
  });

  describe("Deployment", function () {
    it("Should set correct admin", async function () {
      const DEFAULT_ADMIN_ROLE = await crossChainBridge.DEFAULT_ADMIN_ROLE();
      expect(await crossChainBridge.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
    });

    it("Should start with zero messages", async function () {
      expect(await crossChainBridge.totalMessages()).to.equal(0);
    });

    it("Should have correct chain ID constants", async function () {
      expect(await crossChainBridge.ETHEREUM_MAINNET()).to.equal(ETHEREUM_MAINNET);
      expect(await crossChainBridge.ARBITRUM_ONE()).to.equal(ARBITRUM_ONE);
      expect(await crossChainBridge.OPTIMISM()).to.equal(OPTIMISM);
    });
  });

  describe("Chain Configuration", function () {
    it("Should configure a chain", async function () {
      await expect(
        crossChainBridge.configureChain(
          ETHEREUM_MAINNET,
          user.address, // bridge contract
          user.address, // messenger
          12 // confirmation blocks
        )
      ).to.emit(crossChainBridge, "ChainConfigured");

      const config = await crossChainBridge.getChainConfig(ETHEREUM_MAINNET);
      expect(config.chainId).to.equal(ETHEREUM_MAINNET);
      expect(config.bridgeContract).to.equal(user.address);
      expect(config.active).to.be.true;
    });

    it("Should reject zero chain ID", async function () {
      await expect(
        crossChainBridge.configureChain(0, user.address, user.address, 12)
      ).to.be.revertedWith("Invalid chain ID");
    });

    it("Should reject zero bridge contract", async function () {
      await expect(
        crossChainBridge.configureChain(ETHEREUM_MAINNET, ethers.ZeroAddress, user.address, 12)
      ).to.be.revertedWith("Invalid bridge contract");
    });

    it("Should deactivate a chain", async function () {
      await crossChainBridge.configureChain(ETHEREUM_MAINNET, user.address, user.address, 12);

      await expect(crossChainBridge.deactivateChain(ETHEREUM_MAINNET))
        .to.emit(crossChainBridge, "ChainDeactivated")
        .withArgs(ETHEREUM_MAINNET);

      expect(await crossChainBridge.isChainActive(ETHEREUM_MAINNET)).to.be.false;
    });

    it("Should list supported chains", async function () {
      await crossChainBridge.configureChain(ETHEREUM_MAINNET, user.address, user.address, 12);
      await crossChainBridge.configureChain(ARBITRUM_ONE, user.address, user.address, 0);

      const chains = await crossChainBridge.listSupportedChains();
      expect(chains.length).to.equal(2);
      expect(chains).to.include(BigInt(ETHEREUM_MAINNET));
      expect(chains).to.include(BigInt(ARBITRUM_ONE));
    });
  });

  describe("Sending Messages", function () {
    const rulingHash = ethers.keccak256(ethers.toUtf8Bytes("ruling-data"));
    const disputeId = 1;

    beforeEach(async function () {
      await crossChainBridge.configureChain(ETHEREUM_MAINNET, user.address, user.address, 12);
    });

    it("Should send message to configured chain", async function () {
      await expect(
        crossChainBridge.sendToChain(rulingHash, disputeId, ETHEREUM_MAINNET)
      ).to.emit(crossChainBridge, "MessageSent");

      expect(await crossChainBridge.totalMessages()).to.equal(1);
    });

    it("Should reject sending to inactive chain", async function () {
      await crossChainBridge.deactivateChain(ETHEREUM_MAINNET);

      await expect(
        crossChainBridge.sendToChain(rulingHash, disputeId, ETHEREUM_MAINNET)
      ).to.be.revertedWith("Destination chain not active");
    });

    it("Should reject invalid ruling hash", async function () {
      await expect(
        crossChainBridge.sendToChain(ethers.ZeroHash, disputeId, ETHEREUM_MAINNET)
      ).to.be.revertedWith("Invalid ruling hash");
    });

    it("Should use sendToMainnet convenience function", async function () {
      await expect(
        crossChainBridge.sendToMainnet(rulingHash, disputeId)
      ).to.emit(crossChainBridge, "MessageSent");
    });
  });

  describe("Receiving Messages", function () {
    const rulingHash = ethers.keccak256(ethers.toUtf8Bytes("ruling-data"));
    const disputeId = 1;
    const sourceChainId = ARBITRUM_ONE;

    beforeEach(async function () {
      await crossChainBridge.configureChain(sourceChainId, user.address, user.address, 0);
    });

    it("Should receive message from configured chain", async function () {
      const messageHash = ethers.keccak256(ethers.toUtf8Bytes("original-message"));

      await expect(
        crossChainBridge.connect(relayer).receiveFromChain(
          rulingHash,
          disputeId,
          sourceChainId,
          messageHash
        )
      ).to.emit(crossChainBridge, "MessageReceived");
    });

    it("Should reject duplicate message", async function () {
      const messageHash = ethers.keccak256(ethers.toUtf8Bytes("original-message"));

      await crossChainBridge.connect(relayer).receiveFromChain(
        rulingHash,
        disputeId,
        sourceChainId,
        messageHash
      );

      await expect(
        crossChainBridge.connect(relayer).receiveFromChain(
          rulingHash,
          disputeId,
          sourceChainId,
          messageHash
        )
      ).to.be.revertedWith("Message already received");
    });

    it("Should reject from non-relayer", async function () {
      const messageHash = ethers.keccak256(ethers.toUtf8Bytes("original-message"));

      await expect(
        crossChainBridge.connect(user).receiveFromChain(
          rulingHash,
          disputeId,
          sourceChainId,
          messageHash
        )
      ).to.be.reverted;
    });
  });

  describe("Message Verification", function () {
    const rulingHash = ethers.keccak256(ethers.toUtf8Bytes("ruling-data"));
    const disputeId = 1;

    beforeEach(async function () {
      await crossChainBridge.configureChain(ARBITRUM_ONE, user.address, user.address, 0);
    });

    it("Should verify confirmed message", async function () {
      const messageHash = ethers.keccak256(ethers.toUtf8Bytes("original-message"));

      await crossChainBridge.connect(relayer).receiveFromChain(
        rulingHash,
        disputeId,
        ARBITRUM_ONE,
        messageHash
      );

      expect(await crossChainBridge.verifyMessage(messageHash, "0x")).to.be.true;
    });

    it("Should return false for unknown message", async function () {
      const unknownHash = ethers.keccak256(ethers.toUtf8Bytes("unknown"));
      expect(await crossChainBridge.verifyMessage(unknownHash, "0x")).to.be.false;
    });
  });

  describe("Message Status Management", function () {
    const rulingHash = ethers.keccak256(ethers.toUtf8Bytes("ruling-data"));
    const disputeId = 1;
    let messageId;

    beforeEach(async function () {
      await crossChainBridge.configureChain(ARBITRUM_ONE, user.address, user.address, 0);

      const messageHash = ethers.keccak256(ethers.toUtf8Bytes("original-message"));
      await crossChainBridge.connect(relayer).receiveFromChain(
        rulingHash,
        disputeId,
        ARBITRUM_ONE,
        messageHash
      );
      messageId = 1;
    });

    it("Should mark message as executed", async function () {
      await expect(crossChainBridge.connect(relayer).markExecuted(messageId))
        .to.emit(crossChainBridge, "MessageExecuted")
        .withArgs(messageId);

      const message = await crossChainBridge.getMessage(messageId);
      expect(message.status).to.equal(2); // Executed
    });

    it("Should mark message as failed", async function () {
      await expect(
        crossChainBridge.connect(relayer).markFailed(messageId, "Execution failed")
      ).to.emit(crossChainBridge, "MessageFailed");

      const message = await crossChainBridge.getMessage(messageId);
      expect(message.status).to.equal(3); // Failed
    });
  });

  describe("View Functions", function () {
    it("Should get message details", async function () {
      await crossChainBridge.configureChain(ARBITRUM_ONE, user.address, user.address, 0);

      const rulingHash = ethers.keccak256(ethers.toUtf8Bytes("ruling-data"));
      const disputeId = 1;
      const messageHash = ethers.keccak256(ethers.toUtf8Bytes("original-message"));

      await crossChainBridge.connect(relayer).receiveFromChain(
        rulingHash,
        disputeId,
        ARBITRUM_ONE,
        messageHash
      );

      const message = await crossChainBridge.getMessage(1);
      expect(message.rulingHash).to.equal(rulingHash);
      expect(message.disputeId).to.equal(disputeId);
      expect(message.sourceChainId).to.equal(ARBITRUM_ONE);
    });

    it("Should get message by hash", async function () {
      await crossChainBridge.configureChain(ARBITRUM_ONE, user.address, user.address, 0);

      const rulingHash = ethers.keccak256(ethers.toUtf8Bytes("ruling-data"));
      const messageHash = ethers.keccak256(ethers.toUtf8Bytes("original-message"));

      await crossChainBridge.connect(relayer).receiveFromChain(
        rulingHash,
        1,
        ARBITRUM_ONE,
        messageHash
      );

      const message = await crossChainBridge.getMessageByHash(messageHash);
      expect(message.rulingHash).to.equal(rulingHash);
    });

    it("Should get messages for dispute", async function () {
      await crossChainBridge.configureChain(ARBITRUM_ONE, user.address, user.address, 0);

      const disputeId = 1;
      const messageHash = ethers.keccak256(ethers.toUtf8Bytes("msg-1"));

      await crossChainBridge.connect(relayer).receiveFromChain(
        ethers.keccak256(ethers.toUtf8Bytes("ruling-1")),
        disputeId,
        ARBITRUM_ONE,
        messageHash
      );

      const messages = await crossChainBridge.getMessagesForDispute(ARBITRUM_ONE, disputeId);
      expect(messages.length).to.equal(1);
    });

    it("Should revert getMessage for non-existent", async function () {
      await expect(crossChainBridge.getMessage(999))
        .to.be.revertedWith("Message not found");
    });

    it("Should revert getChainConfig for non-configured", async function () {
      await expect(crossChainBridge.getChainConfig(999))
        .to.be.revertedWith("Chain not configured");
    });
  });
});
