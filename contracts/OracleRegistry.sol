// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./VJToken.sol";

/**
 * @title OracleRegistry
 * @dev Registry for trusted oracles that provide bounty recovery attestations
 */
contract OracleRegistry is AccessControl, ReentrancyGuard {
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");

    uint256 public constant MIN_STAKE = 5000 * 10**18; // 5,000 VJ tokens
    uint256 public constant QUORUM_THRESHOLD = 3; // 3-of-5 oracles for attestation
    uint256 public constant ATTESTATION_WINDOW = 7 days;

    struct OracleInfo {
        uint256 id;
        address operator;
        string metadata;
        uint256 stake;
        uint256 registeredAt;
        uint256 attestationsSubmitted;
        uint256 slashedAmount;
        bool active;
    }

    struct Attestation {
        uint256 oracleId;
        address oracle;
        bytes32 attestationHash;
        uint256 submittedAt;
    }

    VJToken public vjToken;

    mapping(uint256 => OracleInfo) private _oracles;
    mapping(address => uint256) private _operatorToOracle;
    uint256[] private _activeOracleIds;
    uint256 private _oracleCount;

    // bountyId => attestations
    mapping(uint256 => Attestation[]) private _bountyAttestations;
    // bountyId => oracleId => hasAttested
    mapping(uint256 => mapping(uint256 => bool)) private _hasAttested;

    // Events
    event OracleRegistered(uint256 indexed oracleId, address indexed operator, uint256 stake);
    event OracleMetadataUpdated(uint256 indexed oracleId, string metadata);
    event OracleSlashed(uint256 indexed oracleId, uint256 amount, string reason);
    event OracleDeactivated(uint256 indexed oracleId);
    event OracleReactivated(uint256 indexed oracleId);
    event AttestationSubmitted(uint256 indexed bountyId, uint256 indexed oracleId, bytes32 attestationHash);
    event QuorumReached(uint256 indexed bountyId, uint256 attestationCount);

    constructor(address defaultAdmin, address _vjToken) {
        require(_vjToken != address(0), "Invalid token address");

        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(GOVERNANCE_ROLE, defaultAdmin);

        vjToken = VJToken(_vjToken);
    }

    /**
     * @dev Register as an oracle
     * @param metadata Oracle metadata (IPFS hash or URL)
     * @param stake Amount to stake
     * @return oracleId The ID of the registered oracle
     */
    function registerOracle(
        string calldata metadata,
        uint256 stake
    ) external nonReentrant returns (uint256 oracleId) {
        require(stake >= MIN_STAKE, "Insufficient stake");
        require(bytes(metadata).length > 0, "Metadata required");
        require(_operatorToOracle[msg.sender] == 0, "Already registered");

        require(vjToken.transferFrom(msg.sender, address(this), stake), "Transfer failed");

        _oracleCount++;
        oracleId = _oracleCount;

        _oracles[oracleId] = OracleInfo({
            id: oracleId,
            operator: msg.sender,
            metadata: metadata,
            stake: stake,
            registeredAt: block.timestamp,
            attestationsSubmitted: 0,
            slashedAmount: 0,
            active: true
        });

        _operatorToOracle[msg.sender] = oracleId;
        _activeOracleIds.push(oracleId);

        vjToken.notifyStake(msg.sender, stake);

        emit OracleRegistered(oracleId, msg.sender, stake);
    }

    /**
     * @dev Update oracle metadata
     * @param oracleId ID of the oracle
     * @param metadata New metadata
     */
    function updateOracleMetadata(uint256 oracleId, string calldata metadata) external {
        OracleInfo storage oracle = _oracles[oracleId];
        require(oracle.id != 0, "Oracle does not exist");
        require(msg.sender == oracle.operator, "Not operator");
        require(bytes(metadata).length > 0, "Metadata required");

        oracle.metadata = metadata;

        emit OracleMetadataUpdated(oracleId, metadata);
    }

    /**
     * @dev Increase oracle stake
     * @param oracleId ID of the oracle
     * @param amount Additional stake
     */
    function increaseStake(uint256 oracleId, uint256 amount) external nonReentrant {
        OracleInfo storage oracle = _oracles[oracleId];
        require(oracle.id != 0, "Oracle does not exist");
        require(msg.sender == oracle.operator, "Not operator");
        require(amount > 0, "Amount must be positive");

        require(vjToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        oracle.stake += amount;
        vjToken.notifyStake(msg.sender, amount);
    }

    /**
     * @dev Slash an oracle's stake
     * @param oracleId ID of the oracle
     * @param amount Amount to slash
     * @param reason Reason for slashing
     */
    function slashOracle(
        uint256 oracleId,
        uint256 amount,
        string calldata reason
    ) external onlyRole(GOVERNANCE_ROLE) {
        OracleInfo storage oracle = _oracles[oracleId];
        require(oracle.id != 0, "Oracle does not exist");
        require(amount <= oracle.stake, "Amount exceeds stake");
        require(bytes(reason).length > 0, "Reason required");

        oracle.stake -= amount;
        oracle.slashedAmount += amount;

        // Deactivate if below minimum
        if (oracle.stake < MIN_STAKE && oracle.active) {
            oracle.active = false;
            _removeFromActiveList(oracleId);
            emit OracleDeactivated(oracleId);
        }

        // Burn slashed tokens
        vjToken.burn(amount);

        emit OracleSlashed(oracleId, amount, reason);
    }

    /**
     * @dev Deactivate an oracle (self or governance)
     * @param oracleId ID of the oracle
     */
    function deactivateOracle(uint256 oracleId) external {
        OracleInfo storage oracle = _oracles[oracleId];
        require(oracle.id != 0, "Oracle does not exist");
        require(
            msg.sender == oracle.operator || hasRole(GOVERNANCE_ROLE, msg.sender),
            "Not authorized"
        );
        require(oracle.active, "Already inactive");

        oracle.active = false;
        _removeFromActiveList(oracleId);

        emit OracleDeactivated(oracleId);
    }

    /**
     * @dev Reactivate an oracle (only if meets minimum stake)
     * @param oracleId ID of the oracle
     */
    function reactivateOracle(uint256 oracleId) external {
        OracleInfo storage oracle = _oracles[oracleId];
        require(oracle.id != 0, "Oracle does not exist");
        require(msg.sender == oracle.operator, "Not operator");
        require(!oracle.active, "Already active");
        require(oracle.stake >= MIN_STAKE, "Insufficient stake");

        oracle.active = true;
        _activeOracleIds.push(oracleId);

        emit OracleReactivated(oracleId);
    }

    /**
     * @dev Submit attestation for a bounty recovery
     * @param bountyId ID of the bounty
     * @param attestationHash Hash of the attestation data
     */
    function submitAttestation(uint256 bountyId, bytes32 attestationHash) external {
        uint256 oracleId = _operatorToOracle[msg.sender];
        require(oracleId != 0, "Not a registered oracle");

        OracleInfo storage oracle = _oracles[oracleId];
        require(oracle.active, "Oracle not active");
        require(!_hasAttested[bountyId][oracleId], "Already attested");
        require(attestationHash != bytes32(0), "Invalid attestation hash");

        _hasAttested[bountyId][oracleId] = true;
        oracle.attestationsSubmitted++;

        _bountyAttestations[bountyId].push(Attestation({
            oracleId: oracleId,
            oracle: msg.sender,
            attestationHash: attestationHash,
            submittedAt: block.timestamp
        }));

        emit AttestationSubmitted(bountyId, oracleId, attestationHash);

        // Check if quorum reached
        if (_bountyAttestations[bountyId].length == QUORUM_THRESHOLD) {
            emit QuorumReached(bountyId, QUORUM_THRESHOLD);
        }
    }

    /**
     * @dev Get oracle information
     * @param oracleId ID of the oracle
     * @return Oracle information
     */
    function getOracle(uint256 oracleId) external view returns (OracleInfo memory) {
        require(_oracles[oracleId].id != 0, "Oracle does not exist");
        return _oracles[oracleId];
    }

    /**
     * @dev Get oracle by operator address
     * @param operator Operator address
     * @return Oracle ID (0 if not found)
     */
    function getOracleByOperator(address operator) external view returns (uint256) {
        return _operatorToOracle[operator];
    }

    /**
     * @dev List all active oracles
     * @return Array of oracle information
     */
    function listActiveOracles() external view returns (OracleInfo[] memory) {
        OracleInfo[] memory result = new OracleInfo[](_activeOracleIds.length);
        for (uint256 i = 0; i < _activeOracleIds.length; i++) {
            result[i] = _oracles[_activeOracleIds[i]];
        }
        return result;
    }

    /**
     * @dev Get attestations for a bounty
     * @param bountyId ID of the bounty
     * @return Array of attestations
     */
    function getAttestations(uint256 bountyId) external view returns (Attestation[] memory) {
        return _bountyAttestations[bountyId];
    }

    /**
     * @dev Check if bounty has quorum (3-of-5 attestations)
     * @param bountyId ID of the bounty
     * @return Whether quorum is reached
     */
    function hasQuorum(uint256 bountyId) external view returns (bool) {
        return _bountyAttestations[bountyId].length >= QUORUM_THRESHOLD;
    }

    /**
     * @dev Get attestation count for a bounty
     * @param bountyId ID of the bounty
     * @return Number of attestations
     */
    function getAttestationCount(uint256 bountyId) external view returns (uint256) {
        return _bountyAttestations[bountyId].length;
    }

    /**
     * @dev Check if oracle has attested to a bounty
     * @param bountyId ID of the bounty
     * @param oracleId ID of the oracle
     * @return Whether oracle has attested
     */
    function hasOracleAttested(uint256 bountyId, uint256 oracleId) external view returns (bool) {
        return _hasAttested[bountyId][oracleId];
    }

    /**
     * @dev Get total number of oracles
     * @return Total oracle count
     */
    function totalOracles() external view returns (uint256) {
        return _oracleCount;
    }

    /**
     * @dev Get number of active oracles
     * @return Active oracle count
     */
    function activeOracleCount() external view returns (uint256) {
        return _activeOracleIds.length;
    }

    /**
     * @dev Remove oracle from active list
     */
    function _removeFromActiveList(uint256 oracleId) internal {
        for (uint256 i = 0; i < _activeOracleIds.length; i++) {
            if (_activeOracleIds[i] == oracleId) {
                _activeOracleIds[i] = _activeOracleIds[_activeOracleIds.length - 1];
                _activeOracleIds.pop();
                break;
            }
        }
    }
}
