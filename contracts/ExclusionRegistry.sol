// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title ExclusionRegistry
 * @dev Maintains permanent exclusion records for parties who fail to comply with rulings
 * Designed for mainnet deployment for maximum permanence and visibility
 */
contract ExclusionRegistry is AccessControl {
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");

    struct ExclusionInfo {
        bool excluded;
        bytes32 rulingHash;
        string reason;
        uint256 excludedAt;
        uint256 totalRulingAmount;
        uint256 unpaidAmount;
    }

    mapping(address => ExclusionInfo) private _exclusions;
    address[] private _excludedAddresses;
    mapping(address => uint256) private _excludedIndex; // index + 1 (0 means not in array)

    uint256 public totalExcluded;

    // Events
    event AddressExcluded(
        address indexed excluded,
        bytes32 indexed rulingHash,
        string reason,
        uint256 unpaidAmount
    );
    event AddressReinstated(address indexed reinstated, string reason);
    event ExclusionUpdated(address indexed excluded, uint256 newUnpaidAmount);

    constructor(address defaultAdmin) {
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(GOVERNANCE_ROLE, defaultAdmin);
    }

    /**
     * @dev Add an address to the exclusion registry
     * @param addr Address to exclude
     * @param rulingHash Hash of the ruling that led to exclusion
     * @param reason Human-readable reason for exclusion
     * @param totalAmount Total ruling amount
     * @param unpaidAmount Amount still unpaid
     */
    function addToRegistry(
        address addr,
        bytes32 rulingHash,
        string calldata reason,
        uint256 totalAmount,
        uint256 unpaidAmount
    ) external onlyRole(GOVERNANCE_ROLE) {
        require(addr != address(0), "Invalid address");
        require(rulingHash != bytes32(0), "Ruling hash required");
        require(bytes(reason).length > 0, "Reason required");
        require(!_exclusions[addr].excluded, "Already excluded");

        _exclusions[addr] = ExclusionInfo({
            excluded: true,
            rulingHash: rulingHash,
            reason: reason,
            excludedAt: block.timestamp,
            totalRulingAmount: totalAmount,
            unpaidAmount: unpaidAmount
        });

        _excludedAddresses.push(addr);
        _excludedIndex[addr] = _excludedAddresses.length;
        totalExcluded++;

        emit AddressExcluded(addr, rulingHash, reason, unpaidAmount);
    }

    /**
     * @dev Remove an address from the exclusion registry (requires DAO vote)
     * @param addr Address to reinstate
     * @param reason Reason for reinstatement
     */
    function removeFromRegistry(
        address addr,
        string calldata reason
    ) external onlyRole(GOVERNANCE_ROLE) {
        require(_exclusions[addr].excluded, "Not excluded");
        require(bytes(reason).length > 0, "Reason required");

        _exclusions[addr].excluded = false;

        // Remove from array
        uint256 index = _excludedIndex[addr];
        if (index > 0) {
            uint256 lastIndex = _excludedAddresses.length - 1;
            if (index - 1 != lastIndex) {
                address lastAddr = _excludedAddresses[lastIndex];
                _excludedAddresses[index - 1] = lastAddr;
                _excludedIndex[lastAddr] = index;
            }
            _excludedAddresses.pop();
            _excludedIndex[addr] = 0;
        }
        totalExcluded--;

        emit AddressReinstated(addr, reason);
    }

    /**
     * @dev Update unpaid amount for an excluded address
     * @param addr Address to update
     * @param newUnpaidAmount New unpaid amount
     */
    function updateUnpaidAmount(
        address addr,
        uint256 newUnpaidAmount
    ) external onlyRole(GOVERNANCE_ROLE) {
        require(_exclusions[addr].excluded, "Not excluded");

        _exclusions[addr].unpaidAmount = newUnpaidAmount;

        emit ExclusionUpdated(addr, newUnpaidAmount);
    }

    /**
     * @dev Check if an address is excluded
     * @param addr Address to check
     * @return Whether address is excluded
     */
    function isExcluded(address addr) external view returns (bool) {
        return _exclusions[addr].excluded;
    }

    /**
     * @dev Get exclusion record for an address
     * @param addr Address to query
     * @return Exclusion information
     */
    function getExclusionRecord(address addr) external view returns (ExclusionInfo memory) {
        return _exclusions[addr];
    }

    /**
     * @dev Get all excluded addresses
     * @return Array of excluded addresses
     */
    function getExcludedAddresses() external view returns (address[] memory) {
        return _excludedAddresses;
    }

    /**
     * @dev Get count of excluded addresses
     * @return Number of excluded addresses
     */
    function excludedCount() external view returns (uint256) {
        return _excludedAddresses.length;
    }
}
