// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./VJToken.sol";

/**
 * @title InsurerRegistry
 * @dev Registry of private insurers who can offer coverage
 */
contract InsurerRegistry is AccessControl, ReentrancyGuard {
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");

    uint256 public constant MIN_STAKE = 10000 * 10**18; // 10,000 VJ tokens
    uint256 public constant UNSTAKE_TIMELOCK = 14 days;

    struct InsurerInfo {
        uint256 id;
        address operator;
        uint256 stake;
        bytes terms;
        bytes32 reserveProofHash;
        uint256 registeredAt;
        uint256 policiesIssued;
        uint256 claimsPaid;
        uint256 slashedAmount;
        bool active;
        uint256 pendingUnstake;
        uint256 unstakeRequestTime;
    }

    VJToken public vjToken;

    mapping(uint256 => InsurerInfo) private _insurers;
    mapping(address => uint256) private _operatorToInsurer;
    uint256[] private _activeInsurerIds;
    uint256 private _insurerCount;

    // Events
    event InsurerRegistered(uint256 indexed insurerId, address indexed operator, uint256 stake);
    event InsurerTermsUpdated(uint256 indexed insurerId, bytes newTerms);
    event InsurerSlashed(uint256 indexed insurerId, uint256 amount, string reason);
    event InsurerDeactivated(uint256 indexed insurerId);
    event InsurerReactivated(uint256 indexed insurerId);
    event PolicyRecorded(uint256 indexed insurerId);
    event ClaimRecorded(uint256 indexed insurerId, uint256 amount);

    constructor(address defaultAdmin, address _vjToken) {
        require(_vjToken != address(0), "Invalid token address");

        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(GOVERNANCE_ROLE, defaultAdmin);

        vjToken = VJToken(_vjToken);
    }

    /**
     * @dev Register as an insurer
     * @param stake Amount to stake
     * @param terms Insurance terms (encoded)
     * @param reserveProof Proof of reserves (hash)
     * @return insurerId The ID of the registered insurer
     */
    function registerInsurer(
        uint256 stake,
        bytes calldata terms,
        bytes32 reserveProof
    ) external nonReentrant returns (uint256 insurerId) {
        require(stake >= MIN_STAKE, "Insufficient stake");
        require(terms.length > 0, "Terms required");
        require(reserveProof != bytes32(0), "Reserve proof required");
        require(_operatorToInsurer[msg.sender] == 0, "Already registered");

        require(vjToken.transferFrom(msg.sender, address(this), stake), "Transfer failed");

        _insurerCount++;
        insurerId = _insurerCount;

        _insurers[insurerId] = InsurerInfo({
            id: insurerId,
            operator: msg.sender,
            stake: stake,
            terms: terms,
            reserveProofHash: reserveProof,
            registeredAt: block.timestamp,
            policiesIssued: 0,
            claimsPaid: 0,
            slashedAmount: 0,
            active: true,
            pendingUnstake: 0,
            unstakeRequestTime: 0
        });

        _operatorToInsurer[msg.sender] = insurerId;
        _activeInsurerIds.push(insurerId);

        // Notify token of stake
        vjToken.notifyStake(msg.sender, stake);

        emit InsurerRegistered(insurerId, msg.sender, stake);
    }

    /**
     * @dev Update insurer terms
     * @param insurerId ID of the insurer
     * @param newTerms New terms (encoded)
     */
    function updateTerms(uint256 insurerId, bytes calldata newTerms) external {
        InsurerInfo storage insurer = _insurers[insurerId];
        require(insurer.id != 0, "Insurer does not exist");
        require(msg.sender == insurer.operator, "Not operator");
        require(newTerms.length > 0, "Terms required");

        insurer.terms = newTerms;

        emit InsurerTermsUpdated(insurerId, newTerms);
    }

    /**
     * @dev Update reserve proof
     * @param insurerId ID of the insurer
     * @param reserveProof New reserve proof hash
     */
    function updateReserveProof(uint256 insurerId, bytes32 reserveProof) external {
        InsurerInfo storage insurer = _insurers[insurerId];
        require(insurer.id != 0, "Insurer does not exist");
        require(msg.sender == insurer.operator, "Not operator");
        require(reserveProof != bytes32(0), "Reserve proof required");

        insurer.reserveProofHash = reserveProof;
    }

    /**
     * @dev Increase stake
     * @param insurerId ID of the insurer
     * @param amount Additional stake amount
     */
    function increaseStake(uint256 insurerId, uint256 amount) external nonReentrant {
        InsurerInfo storage insurer = _insurers[insurerId];
        require(insurer.id != 0, "Insurer does not exist");
        require(msg.sender == insurer.operator, "Not operator");
        require(amount > 0, "Amount must be positive");

        require(vjToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        insurer.stake += amount;
        vjToken.notifyStake(msg.sender, amount);
    }

    /**
     * @dev Slash an insurer's stake
     * @param insurerId ID of the insurer
     * @param amount Amount to slash
     * @param reason Reason for slashing
     */
    function slashInsurer(
        uint256 insurerId,
        uint256 amount,
        string calldata reason
    ) external onlyRole(GOVERNANCE_ROLE) {
        InsurerInfo storage insurer = _insurers[insurerId];
        require(insurer.id != 0, "Insurer does not exist");
        require(amount <= insurer.stake, "Amount exceeds stake");
        require(bytes(reason).length > 0, "Reason required");

        insurer.stake -= amount;
        insurer.slashedAmount += amount;

        // Deactivate if below minimum
        if (insurer.stake < MIN_STAKE && insurer.active) {
            insurer.active = false;
            _removeFromActiveList(insurerId);
            emit InsurerDeactivated(insurerId);
        }

        // Burn slashed tokens
        vjToken.burn(amount);

        emit InsurerSlashed(insurerId, amount, reason);
    }

    /**
     * @dev Record a policy issued by an insurer
     * @param insurerId ID of the insurer
     */
    function recordPolicy(uint256 insurerId) external onlyRole(GOVERNANCE_ROLE) {
        InsurerInfo storage insurer = _insurers[insurerId];
        require(insurer.id != 0, "Insurer does not exist");

        insurer.policiesIssued++;
        emit PolicyRecorded(insurerId);
    }

    /**
     * @dev Record a claim paid by an insurer
     * @param insurerId ID of the insurer
     * @param amount Amount paid
     */
    function recordClaim(uint256 insurerId, uint256 amount) external onlyRole(GOVERNANCE_ROLE) {
        InsurerInfo storage insurer = _insurers[insurerId];
        require(insurer.id != 0, "Insurer does not exist");

        insurer.claimsPaid += amount;
        emit ClaimRecorded(insurerId, amount);
    }

    /**
     * @dev Get insurer information
     * @param insurerId ID of the insurer
     * @return Insurer information
     */
    function getInsurer(uint256 insurerId) external view returns (InsurerInfo memory) {
        require(_insurers[insurerId].id != 0, "Insurer does not exist");
        return _insurers[insurerId];
    }

    /**
     * @dev Get insurer ID by operator address
     * @param operator Operator address
     * @return Insurer ID (0 if not found)
     */
    function getInsurerByOperator(address operator) external view returns (uint256) {
        return _operatorToInsurer[operator];
    }

    /**
     * @dev List all active insurers
     * @return Array of insurer information
     */
    function listInsurers() external view returns (InsurerInfo[] memory) {
        InsurerInfo[] memory result = new InsurerInfo[](_activeInsurerIds.length);
        for (uint256 i = 0; i < _activeInsurerIds.length; i++) {
            result[i] = _insurers[_activeInsurerIds[i]];
        }
        return result;
    }

    /**
     * @dev Get total number of insurers
     * @return Total insurer count
     */
    function totalInsurers() external view returns (uint256) {
        return _insurerCount;
    }

    /**
     * @dev Get number of active insurers
     * @return Active insurer count
     */
    function activeInsurerCount() external view returns (uint256) {
        return _activeInsurerIds.length;
    }

    /**
     * @dev Remove insurer from active list
     */
    function _removeFromActiveList(uint256 insurerId) internal {
        for (uint256 i = 0; i < _activeInsurerIds.length; i++) {
            if (_activeInsurerIds[i] == insurerId) {
                _activeInsurerIds[i] = _activeInsurerIds[_activeInsurerIds.length - 1];
                _activeInsurerIds.pop();
                break;
            }
        }
    }
}
