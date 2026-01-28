// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title RulingAnchor
 * @dev Mainnet anchoring of final rulings for permanence and cross-L2 verification
 */
contract RulingAnchor is AccessControl {
    bytes32 public constant ANCHOR_ROLE = keccak256("ANCHOR_ROLE");

    struct AnchorInfo {
        bytes32 rulingHash;
        uint256 disputeId;
        uint256 anchoredAt;
        address anchoredBy;
        uint256 l2ChainId;
        bool exists;
    }

    // disputeId => chainId => AnchorInfo
    mapping(uint256 => mapping(uint256 => AnchorInfo)) private _anchors;

    // rulingHash => disputeId (for reverse lookup)
    mapping(bytes32 => uint256) private _hashToDispute;

    // Track all anchored dispute IDs
    uint256[] private _anchoredDisputes;
    mapping(uint256 => bool) private _isAnchored;

    uint256 public totalAnchored;

    // Events
    event RulingAnchored(
        uint256 indexed disputeId,
        bytes32 indexed rulingHash,
        uint256 indexed l2ChainId,
        address anchoredBy
    );
    event AnchorVerified(uint256 indexed disputeId, bytes32 rulingHash, bool valid);

    constructor(address defaultAdmin) {
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(ANCHOR_ROLE, defaultAdmin);
    }

    /**
     * @dev Anchor a ruling from L2 to mainnet
     * @param disputeId ID of the dispute on L2
     * @param rulingHash Hash of the complete ruling data
     * @param l2ChainId Chain ID of the L2 where dispute was resolved
     */
    function anchorRuling(
        uint256 disputeId,
        bytes32 rulingHash,
        uint256 l2ChainId
    ) external onlyRole(ANCHOR_ROLE) {
        require(rulingHash != bytes32(0), "Invalid ruling hash");
        require(l2ChainId != 0, "Invalid chain ID");
        require(!_anchors[disputeId][l2ChainId].exists, "Already anchored");

        _anchors[disputeId][l2ChainId] = AnchorInfo({
            rulingHash: rulingHash,
            disputeId: disputeId,
            anchoredAt: block.timestamp,
            anchoredBy: msg.sender,
            l2ChainId: l2ChainId,
            exists: true
        });

        _hashToDispute[rulingHash] = disputeId;

        if (!_isAnchored[disputeId]) {
            _anchoredDisputes.push(disputeId);
            _isAnchored[disputeId] = true;
        }

        totalAnchored++;

        emit RulingAnchored(disputeId, rulingHash, l2ChainId, msg.sender);
    }

    /**
     * @dev Anchor a ruling for the current chain (L1 disputes)
     * @param disputeId ID of the dispute
     * @param rulingHash Hash of the complete ruling data
     */
    function anchorRuling(
        uint256 disputeId,
        bytes32 rulingHash
    ) external onlyRole(ANCHOR_ROLE) {
        require(rulingHash != bytes32(0), "Invalid ruling hash");
        require(!_anchors[disputeId][block.chainid].exists, "Already anchored");

        _anchors[disputeId][block.chainid] = AnchorInfo({
            rulingHash: rulingHash,
            disputeId: disputeId,
            anchoredAt: block.timestamp,
            anchoredBy: msg.sender,
            l2ChainId: block.chainid,
            exists: true
        });

        _hashToDispute[rulingHash] = disputeId;

        if (!_isAnchored[disputeId]) {
            _anchoredDisputes.push(disputeId);
            _isAnchored[disputeId] = true;
        }

        totalAnchored++;

        emit RulingAnchored(disputeId, rulingHash, block.chainid, msg.sender);
    }

    /**
     * @dev Verify an anchor matches the expected ruling hash
     * @param disputeId ID of the dispute
     * @param rulingHash Expected ruling hash
     * @param l2ChainId Chain ID to verify against
     * @return valid Whether the anchor is valid and matches
     */
    function verifyAnchor(
        uint256 disputeId,
        bytes32 rulingHash,
        uint256 l2ChainId
    ) external view returns (bool valid) {
        AnchorInfo storage anchor = _anchors[disputeId][l2ChainId];

        if (!anchor.exists) {
            return false;
        }

        valid = anchor.rulingHash == rulingHash;
    }

    /**
     * @dev Verify an anchor for current chain
     * @param disputeId ID of the dispute
     * @param rulingHash Expected ruling hash
     * @return valid Whether the anchor is valid and matches
     */
    function verifyAnchor(
        uint256 disputeId,
        bytes32 rulingHash
    ) external view returns (bool valid) {
        AnchorInfo storage anchor = _anchors[disputeId][block.chainid];

        if (!anchor.exists) {
            return false;
        }

        valid = anchor.rulingHash == rulingHash;
    }

    /**
     * @dev Get anchor information for a dispute
     * @param disputeId ID of the dispute
     * @param l2ChainId Chain ID
     * @return Anchor information
     */
    function getAnchor(
        uint256 disputeId,
        uint256 l2ChainId
    ) external view returns (AnchorInfo memory) {
        require(_anchors[disputeId][l2ChainId].exists, "Anchor does not exist");
        return _anchors[disputeId][l2ChainId];
    }

    /**
     * @dev Get anchor information for current chain
     * @param disputeId ID of the dispute
     * @return Anchor information
     */
    function getAnchor(uint256 disputeId) external view returns (AnchorInfo memory) {
        require(_anchors[disputeId][block.chainid].exists, "Anchor does not exist");
        return _anchors[disputeId][block.chainid];
    }

    /**
     * @dev Get dispute ID by ruling hash
     * @param rulingHash Hash of the ruling
     * @return disputeId The dispute ID (0 if not found)
     */
    function getDisputeByHash(bytes32 rulingHash) external view returns (uint256) {
        return _hashToDispute[rulingHash];
    }

    /**
     * @dev Check if a dispute has been anchored
     * @param disputeId ID of the dispute
     * @param l2ChainId Chain ID
     * @return Whether the dispute is anchored
     */
    function isAnchored(uint256 disputeId, uint256 l2ChainId) external view returns (bool) {
        return _anchors[disputeId][l2ChainId].exists;
    }

    /**
     * @dev Check if a dispute has been anchored on any chain
     * @param disputeId ID of the dispute
     * @return Whether the dispute is anchored anywhere
     */
    function isAnchored(uint256 disputeId) external view returns (bool) {
        return _isAnchored[disputeId];
    }

    /**
     * @dev Get all anchored dispute IDs
     * @return Array of dispute IDs
     */
    function getAnchoredDisputes() external view returns (uint256[] memory) {
        return _anchoredDisputes;
    }

    /**
     * @dev Get count of anchored disputes
     * @return Count
     */
    function anchoredCount() external view returns (uint256) {
        return _anchoredDisputes.length;
    }
}
