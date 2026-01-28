// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title IdentityRegistry
 * @dev Manages decentralized identities for VoluntaryJustice participants
 */
contract IdentityRegistry is AccessControl {
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");

    struct IdentityProfile {
        bool registered;
        uint256 registrationTime;
        bytes sybilProof;
        mapping(string => ExternalIdentity) externalIdentities;
        string[] linkedIdentityTypes;
    }

    struct ExternalIdentity {
        bool linked;
        bytes proof;
        uint256 linkTime;
    }

    struct IdentityView {
        bool registered;
        uint256 registrationTime;
        bytes sybilProof;
        string[] linkedIdentityTypes;
    }

    mapping(address => IdentityProfile) private _identities;
    address[] private _registeredAddresses;

    // Events
    event IdentityRegistered(address indexed account, uint256 timestamp);
    event ExternalIdentityLinked(address indexed account, string identityType, uint256 timestamp);
    event ExternalIdentityUnlinked(address indexed account, string identityType);

    constructor(address defaultAdmin) {
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(VERIFIER_ROLE, defaultAdmin);
    }

    /**
     * @dev Register a new identity with sybil resistance proof
     * @param sybilProof Proof of unique personhood (e.g., Gitcoin Passport, Worldcoin)
     */
    function registerIdentity(bytes calldata sybilProof) external {
        require(!_identities[msg.sender].registered, "Identity already registered");
        require(sybilProof.length > 0, "Sybil proof required");

        IdentityProfile storage identity = _identities[msg.sender];
        identity.registered = true;
        identity.registrationTime = block.timestamp;
        identity.sybilProof = sybilProof;

        _registeredAddresses.push(msg.sender);

        emit IdentityRegistered(msg.sender, block.timestamp);
    }

    /**
     * @dev Link an external identity (ENS, EAS, etc.)
     * @param identityType Type of identity being linked (e.g., "ENS", "EAS")
     * @param proof Proof of the external identity link
     */
    function linkExternalIdentity(string calldata identityType, bytes calldata proof) external {
        require(_identities[msg.sender].registered, "Identity not registered");
        require(bytes(identityType).length > 0, "Identity type required");
        require(proof.length > 0, "Proof required");

        IdentityProfile storage identity = _identities[msg.sender];

        if (!identity.externalIdentities[identityType].linked) {
            identity.linkedIdentityTypes.push(identityType);
        }

        identity.externalIdentities[identityType] = ExternalIdentity({
            linked: true,
            proof: proof,
            linkTime: block.timestamp
        });

        emit ExternalIdentityLinked(msg.sender, identityType, block.timestamp);
    }

    /**
     * @dev Unlink an external identity
     * @param identityType Type of identity to unlink
     */
    function unlinkExternalIdentity(string calldata identityType) external {
        require(_identities[msg.sender].registered, "Identity not registered");
        require(_identities[msg.sender].externalIdentities[identityType].linked, "Identity not linked");

        _identities[msg.sender].externalIdentities[identityType].linked = false;

        emit ExternalIdentityUnlinked(msg.sender, identityType);
    }

    /**
     * @dev Get identity information for an address
     * @param account Address to query
     * @return Identity profile view
     */
    function getIdentity(address account) external view returns (IdentityView memory) {
        IdentityProfile storage identity = _identities[account];

        return IdentityView({
            registered: identity.registered,
            registrationTime: identity.registrationTime,
            sybilProof: identity.sybilProof,
            linkedIdentityTypes: identity.linkedIdentityTypes
        });
    }

    /**
     * @dev Get external identity details
     * @param account Address to query
     * @param identityType Type of external identity
     * @return linked Whether the identity is linked
     * @return proof The proof data
     * @return linkTime When the identity was linked
     */
    function getExternalIdentity(address account, string calldata identityType)
        external
        view
        returns (bool linked, bytes memory proof, uint256 linkTime)
    {
        ExternalIdentity storage extId = _identities[account].externalIdentities[identityType];
        return (extId.linked, extId.proof, extId.linkTime);
    }

    /**
     * @dev Check if an address is registered
     * @param account Address to check
     * @return True if registered
     */
    function isRegistered(address account) external view returns (bool) {
        return _identities[account].registered;
    }

    /**
     * @dev Get total number of registered identities
     * @return Count of registered identities
     */
    function totalRegistered() external view returns (uint256) {
        return _registeredAddresses.length;
    }

    /**
     * @dev Get registered address by index
     * @param index Index in the registered addresses array
     * @return The address at that index
     */
    function getRegisteredAddress(uint256 index) external view returns (address) {
        require(index < _registeredAddresses.length, "Index out of bounds");
        return _registeredAddresses[index];
    }
}
