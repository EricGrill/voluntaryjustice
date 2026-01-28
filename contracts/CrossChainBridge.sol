// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title CrossChainBridge
 * @dev L2↔Mainnet messaging for ruling anchoring and cross-chain verification
 * Supports multiple L2s (Arbitrum, Optimism, Base) with pluggable messengers
 */
contract CrossChainBridge is AccessControl, ReentrancyGuard {
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");

    // Chain IDs
    uint256 public constant ETHEREUM_MAINNET = 1;
    uint256 public constant ARBITRUM_ONE = 42161;
    uint256 public constant OPTIMISM = 10;
    uint256 public constant BASE = 8453;
    uint256 public constant SEPOLIA = 11155111;

    enum MessageStatus {
        Pending,
        Confirmed,
        Executed,
        Failed
    }

    struct ChainConfig {
        uint256 chainId;
        address bridgeContract;
        address messenger;
        bool active;
        uint256 confirmationBlocks;
    }

    struct CrossChainMessage {
        uint256 id;
        uint256 sourceChainId;
        uint256 destChainId;
        bytes32 rulingHash;
        uint256 disputeId;
        bytes32 messageHash;
        MessageStatus status;
        uint256 sentAt;
        uint256 confirmedAt;
        address sender;
    }

    mapping(uint256 => ChainConfig) private _chainConfigs;
    uint256[] private _supportedChains;

    mapping(uint256 => CrossChainMessage) private _messages;
    mapping(bytes32 => uint256) private _messageHashToId;
    mapping(uint256 => mapping(uint256 => uint256[])) private _disputeMessages; // sourceChain => disputeId => messageIds
    uint256 private _messageCount;

    // Pending messages awaiting confirmation
    mapping(bytes32 => bool) private _pendingMessages;

    // Events
    event ChainConfigured(uint256 indexed chainId, address bridgeContract, address messenger);
    event ChainDeactivated(uint256 indexed chainId);
    event MessageSent(uint256 indexed messageId, uint256 indexed sourceChainId, uint256 indexed destChainId, bytes32 rulingHash);
    event MessageReceived(uint256 indexed messageId, uint256 indexed sourceChainId, bytes32 rulingHash);
    event MessageConfirmed(uint256 indexed messageId);
    event MessageExecuted(uint256 indexed messageId);
    event MessageFailed(uint256 indexed messageId, string reason);

    constructor(address defaultAdmin) {
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(GOVERNANCE_ROLE, defaultAdmin);
        _grantRole(RELAYER_ROLE, defaultAdmin);
    }

    /**
     * @dev Configure a supported chain
     * @param chainId The chain ID
     * @param bridgeContract Address of the bridge contract on that chain
     * @param messenger Address of the native messenger (e.g., Arbitrum Inbox, OP CrossDomainMessenger)
     * @param confirmationBlocks Number of blocks to wait for confirmation
     */
    function configureChain(
        uint256 chainId,
        address bridgeContract,
        address messenger,
        uint256 confirmationBlocks
    ) external onlyRole(GOVERNANCE_ROLE) {
        require(chainId != 0, "Invalid chain ID");
        require(bridgeContract != address(0), "Invalid bridge contract");

        bool isNew = _chainConfigs[chainId].chainId == 0;

        _chainConfigs[chainId] = ChainConfig({
            chainId: chainId,
            bridgeContract: bridgeContract,
            messenger: messenger,
            active: true,
            confirmationBlocks: confirmationBlocks
        });

        if (isNew) {
            _supportedChains.push(chainId);
        }

        emit ChainConfigured(chainId, bridgeContract, messenger);
    }

    /**
     * @dev Deactivate a chain
     * @param chainId The chain ID to deactivate
     */
    function deactivateChain(uint256 chainId) external onlyRole(GOVERNANCE_ROLE) {
        require(_chainConfigs[chainId].chainId != 0, "Chain not configured");
        require(_chainConfigs[chainId].active, "Already inactive");

        _chainConfigs[chainId].active = false;

        emit ChainDeactivated(chainId);
    }

    /**
     * @dev Send a ruling to another chain (typically L2 → Mainnet)
     * @param rulingHash Hash of the ruling
     * @param disputeId ID of the dispute
     * @param destChainId Destination chain ID
     * @return messageId The message ID
     */
    function sendToChain(
        bytes32 rulingHash,
        uint256 disputeId,
        uint256 destChainId
    ) external nonReentrant returns (uint256 messageId) {
        require(rulingHash != bytes32(0), "Invalid ruling hash");
        require(_chainConfigs[destChainId].active, "Destination chain not active");

        _messageCount++;
        messageId = _messageCount;

        bytes32 messageHash = keccak256(abi.encodePacked(
            block.chainid,
            destChainId,
            rulingHash,
            disputeId,
            messageId,
            block.timestamp
        ));

        _messages[messageId] = CrossChainMessage({
            id: messageId,
            sourceChainId: block.chainid,
            destChainId: destChainId,
            rulingHash: rulingHash,
            disputeId: disputeId,
            messageHash: messageHash,
            status: MessageStatus.Pending,
            sentAt: block.timestamp,
            confirmedAt: 0,
            sender: msg.sender
        });

        _messageHashToId[messageHash] = messageId;
        _disputeMessages[block.chainid][disputeId].push(messageId);
        _pendingMessages[messageHash] = true;

        emit MessageSent(messageId, block.chainid, destChainId, rulingHash);
    }

    /**
     * @dev Convenience function to send to mainnet
     */
    function sendToMainnet(
        bytes32 rulingHash,
        uint256 disputeId
    ) external nonReentrant returns (uint256 messageId) {
        require(rulingHash != bytes32(0), "Invalid ruling hash");
        require(_chainConfigs[ETHEREUM_MAINNET].active, "Destination chain not active");

        _messageCount++;
        messageId = _messageCount;

        bytes32 messageHash = keccak256(abi.encodePacked(
            block.chainid,
            ETHEREUM_MAINNET,
            rulingHash,
            disputeId,
            messageId,
            block.timestamp
        ));

        _messages[messageId] = CrossChainMessage({
            id: messageId,
            sourceChainId: block.chainid,
            destChainId: ETHEREUM_MAINNET,
            rulingHash: rulingHash,
            disputeId: disputeId,
            messageHash: messageHash,
            status: MessageStatus.Pending,
            sentAt: block.timestamp,
            confirmedAt: 0,
            sender: msg.sender
        });

        _messageHashToId[messageHash] = messageId;
        _disputeMessages[block.chainid][disputeId].push(messageId);
        _pendingMessages[messageHash] = true;

        emit MessageSent(messageId, block.chainid, ETHEREUM_MAINNET, rulingHash);
    }

    /**
     * @dev Receive a message from another chain (called by relayer or native bridge)
     * @param rulingHash Hash of the ruling
     * @param disputeId ID of the dispute
     * @param sourceChainId Source chain ID
     * @param originalMessageHash Hash from source chain for verification
     */
    function receiveFromChain(
        bytes32 rulingHash,
        uint256 disputeId,
        uint256 sourceChainId,
        bytes32 originalMessageHash
    ) external onlyRole(RELAYER_ROLE) nonReentrant {
        require(rulingHash != bytes32(0), "Invalid ruling hash");
        require(_chainConfigs[sourceChainId].active, "Source chain not active");
        require(_messageHashToId[originalMessageHash] == 0, "Message already received");

        _messageCount++;
        uint256 messageId = _messageCount;

        _messages[messageId] = CrossChainMessage({
            id: messageId,
            sourceChainId: sourceChainId,
            destChainId: block.chainid,
            rulingHash: rulingHash,
            disputeId: disputeId,
            messageHash: originalMessageHash,
            status: MessageStatus.Confirmed,
            sentAt: 0, // Unknown from source
            confirmedAt: block.timestamp,
            sender: address(0) // Unknown from source
        });

        _messageHashToId[originalMessageHash] = messageId;
        _disputeMessages[sourceChainId][disputeId].push(messageId);

        emit MessageReceived(messageId, sourceChainId, rulingHash);
        emit MessageConfirmed(messageId);
    }

    /**
     * @dev Verify a cross-chain message
     * @param messageHash The message hash to verify
     * @param proof Proof data (format depends on bridge type)
     * @return Whether the message is valid
     */
    function verifyMessage(
        bytes32 messageHash,
        bytes calldata proof
    ) external view returns (bool) {
        uint256 messageId = _messageHashToId[messageHash];
        if (messageId == 0) return false;

        CrossChainMessage storage message = _messages[messageId];

        // Basic verification - message exists and is confirmed
        if (message.status != MessageStatus.Confirmed && message.status != MessageStatus.Executed) {
            return false;
        }

        // If proof is provided, verify it matches the message
        if (proof.length > 0) {
            bytes32 proofHash = keccak256(proof);
            // Simple proof verification - in production, would verify Merkle proof
            return proofHash != bytes32(0);
        }

        return true;
    }

    /**
     * @dev Mark a message as executed (after RulingAnchor processes it)
     * @param messageId The message ID
     */
    function markExecuted(uint256 messageId) external onlyRole(RELAYER_ROLE) {
        CrossChainMessage storage message = _messages[messageId];
        require(message.id != 0, "Message not found");
        require(message.status == MessageStatus.Confirmed, "Invalid status");

        message.status = MessageStatus.Executed;

        emit MessageExecuted(messageId);
    }

    /**
     * @dev Mark a message as failed
     * @param messageId The message ID
     * @param reason Failure reason
     */
    function markFailed(uint256 messageId, string calldata reason) external onlyRole(RELAYER_ROLE) {
        CrossChainMessage storage message = _messages[messageId];
        require(message.id != 0, "Message not found");
        require(message.status == MessageStatus.Pending || message.status == MessageStatus.Confirmed, "Invalid status");

        message.status = MessageStatus.Failed;

        emit MessageFailed(messageId, reason);
    }

    /**
     * @dev Get chain configuration
     * @param chainId The chain ID
     * @return Chain configuration
     */
    function getChainConfig(uint256 chainId) external view returns (ChainConfig memory) {
        require(_chainConfigs[chainId].chainId != 0, "Chain not configured");
        return _chainConfigs[chainId];
    }

    /**
     * @dev Check if a chain is supported and active
     * @param chainId The chain ID
     * @return Whether the chain is active
     */
    function isChainActive(uint256 chainId) external view returns (bool) {
        return _chainConfigs[chainId].active;
    }

    /**
     * @dev Get message details
     * @param messageId The message ID
     * @return Message information
     */
    function getMessage(uint256 messageId) external view returns (CrossChainMessage memory) {
        require(_messages[messageId].id != 0, "Message not found");
        return _messages[messageId];
    }

    /**
     * @dev Get message by hash
     * @param messageHash The message hash
     * @return Message information
     */
    function getMessageByHash(bytes32 messageHash) external view returns (CrossChainMessage memory) {
        uint256 messageId = _messageHashToId[messageHash];
        require(messageId != 0, "Message not found");
        return _messages[messageId];
    }

    /**
     * @dev Get messages for a dispute from a specific source chain
     * @param sourceChainId The source chain ID
     * @param disputeId The dispute ID
     * @return Array of message IDs
     */
    function getMessagesForDispute(uint256 sourceChainId, uint256 disputeId) external view returns (uint256[] memory) {
        return _disputeMessages[sourceChainId][disputeId];
    }

    /**
     * @dev List all supported chains
     * @return Array of chain IDs
     */
    function listSupportedChains() external view returns (uint256[] memory) {
        return _supportedChains;
    }

    /**
     * @dev Get total number of messages
     * @return Total message count
     */
    function totalMessages() external view returns (uint256) {
        return _messageCount;
    }
}
