// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./VJToken.sol";

/**
 * @title CourtRegistry
 * @dev Registry for arbitration courts that stake VJ tokens to participate
 */
contract CourtRegistry is AccessControl, ReentrancyGuard {
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");

    uint256 public constant UNSTAKE_TIMELOCK = 14 days;
    uint256 public constant MIN_STAKE = 1000 * 10**18; // 1000 VJ minimum

    struct CourtInfo {
        uint256 id;
        address operator;
        string metadata; // IPFS hash with court details
        bytes32 rulesetHash;
        uint256 stakedAmount;
        uint256 pendingUnstake;
        uint256 unstakeRequestTime;
        bool active;
        uint256 registeredAt;
        uint256 totalCases;
        uint256 casesWon; // Rulings upheld on appeal
    }

    VJToken public vjToken;

    mapping(uint256 => CourtInfo) private _courts;
    mapping(address => uint256) private _operatorToCourt;
    uint256 private _courtCount;
    uint256[] private _activeCourtIds;

    // Events
    event CourtRegistered(uint256 indexed courtId, address indexed operator, uint256 stake);
    event CourtStakeIncreased(uint256 indexed courtId, uint256 amount, uint256 newTotal);
    event CourtUnstakeRequested(uint256 indexed courtId, uint256 amount, uint256 unlockTime);
    event CourtUnstakeCompleted(uint256 indexed courtId, uint256 amount);
    event CourtSlashed(uint256 indexed courtId, uint256 amount, string reason);
    event CourtDeactivated(uint256 indexed courtId);
    event CourtReactivated(uint256 indexed courtId);
    event CourtMetadataUpdated(uint256 indexed courtId, string metadata);
    event CaseRecorded(uint256 indexed courtId, bool upheld);

    constructor(address defaultAdmin, address _vjToken) {
        require(_vjToken != address(0), "Invalid token address");

        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(GOVERNANCE_ROLE, defaultAdmin);

        vjToken = VJToken(_vjToken);
    }

    /**
     * @dev Register a new court
     * @param metadata IPFS hash with court details
     * @param stake Initial stake amount
     * @param rulesetHash Hash of the ruleset the court follows
     * @return courtId The ID of the registered court
     */
    function registerCourt(
        string calldata metadata,
        uint256 stake,
        bytes32 rulesetHash
    ) external nonReentrant returns (uint256 courtId) {
        require(bytes(metadata).length > 0, "Metadata required");
        require(stake >= MIN_STAKE, "Insufficient stake");
        require(rulesetHash != bytes32(0), "Ruleset hash required");
        require(_operatorToCourt[msg.sender] == 0, "Already registered as court");

        // Transfer stake from operator
        require(vjToken.transferFrom(msg.sender, address(this), stake), "Stake transfer failed");

        _courtCount++;
        courtId = _courtCount;

        _courts[courtId] = CourtInfo({
            id: courtId,
            operator: msg.sender,
            metadata: metadata,
            rulesetHash: rulesetHash,
            stakedAmount: stake,
            pendingUnstake: 0,
            unstakeRequestTime: 0,
            active: true,
            registeredAt: block.timestamp,
            totalCases: 0,
            casesWon: 0
        });

        _operatorToCourt[msg.sender] = courtId;
        _activeCourtIds.push(courtId);

        emit CourtRegistered(courtId, msg.sender, stake);
    }

    /**
     * @dev Increase stake for a court
     * @param courtId ID of the court
     * @param amount Amount to add to stake
     */
    function increaseStake(uint256 courtId, uint256 amount) external nonReentrant {
        CourtInfo storage court = _courts[courtId];
        require(court.id != 0, "Court does not exist");
        require(court.operator == msg.sender, "Not court operator");
        require(amount > 0, "Amount must be positive");

        require(vjToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        court.stakedAmount += amount;

        emit CourtStakeIncreased(courtId, amount, court.stakedAmount);
    }

    /**
     * @dev Request to unstake tokens (subject to timelock)
     * @param courtId ID of the court
     * @param amount Amount to unstake
     */
    function requestUnstake(uint256 courtId, uint256 amount) external {
        CourtInfo storage court = _courts[courtId];
        require(court.id != 0, "Court does not exist");
        require(court.operator == msg.sender, "Not court operator");
        require(amount > 0, "Amount must be positive");
        require(court.pendingUnstake == 0, "Pending unstake exists");

        uint256 remainingStake = court.stakedAmount - amount;
        require(remainingStake >= MIN_STAKE || remainingStake == 0, "Would leave insufficient stake");

        court.pendingUnstake = amount;
        court.unstakeRequestTime = block.timestamp;

        // If unstaking all, deactivate the court
        if (remainingStake == 0) {
            court.active = false;
            _removeFromActiveList(courtId);
            emit CourtDeactivated(courtId);
        }

        emit CourtUnstakeRequested(courtId, amount, block.timestamp + UNSTAKE_TIMELOCK);
    }

    /**
     * @dev Complete unstaking after timelock
     * @param courtId ID of the court
     */
    function completeUnstake(uint256 courtId) external nonReentrant {
        CourtInfo storage court = _courts[courtId];
        require(court.id != 0, "Court does not exist");
        require(court.operator == msg.sender, "Not court operator");
        require(court.pendingUnstake > 0, "No pending unstake");
        require(
            block.timestamp >= court.unstakeRequestTime + UNSTAKE_TIMELOCK,
            "Timelock not expired"
        );

        uint256 amount = court.pendingUnstake;
        court.stakedAmount -= amount;
        court.pendingUnstake = 0;
        court.unstakeRequestTime = 0;

        require(vjToken.transfer(msg.sender, amount), "Transfer failed");

        emit CourtUnstakeCompleted(courtId, amount);
    }

    /**
     * @dev Cancel pending unstake request
     * @param courtId ID of the court
     */
    function cancelUnstake(uint256 courtId) external {
        CourtInfo storage court = _courts[courtId];
        require(court.id != 0, "Court does not exist");
        require(court.operator == msg.sender, "Not court operator");
        require(court.pendingUnstake > 0, "No pending unstake");

        // If court was deactivated due to full unstake, reactivate
        if (!court.active && court.stakedAmount >= MIN_STAKE) {
            court.active = true;
            _activeCourtIds.push(courtId);
            emit CourtReactivated(courtId);
        }

        court.pendingUnstake = 0;
        court.unstakeRequestTime = 0;
    }

    /**
     * @dev Slash a court's stake (governance only)
     * @param courtId ID of the court
     * @param amount Amount to slash
     * @param reason Reason for slashing
     */
    function slashCourt(uint256 courtId, uint256 amount, string calldata reason)
        external
        onlyRole(GOVERNANCE_ROLE)
    {
        CourtInfo storage court = _courts[courtId];
        require(court.id != 0, "Court does not exist");
        require(amount > 0, "Amount must be positive");
        require(amount <= court.stakedAmount, "Amount exceeds stake");

        court.stakedAmount -= amount;

        // Burn slashed tokens
        vjToken.burn(amount);

        // Deactivate if below minimum stake
        if (court.active && court.stakedAmount < MIN_STAKE) {
            court.active = false;
            _removeFromActiveList(courtId);
            emit CourtDeactivated(courtId);
        }

        emit CourtSlashed(courtId, amount, reason);
    }

    /**
     * @dev Record a case outcome for a court
     * @param courtId ID of the court
     * @param upheld Whether the ruling was upheld on appeal
     */
    function recordCase(uint256 courtId, bool upheld) external onlyRole(GOVERNANCE_ROLE) {
        CourtInfo storage court = _courts[courtId];
        require(court.id != 0, "Court does not exist");

        court.totalCases++;
        if (upheld) {
            court.casesWon++;
        }

        emit CaseRecorded(courtId, upheld);
    }

    /**
     * @dev Update court metadata
     * @param courtId ID of the court
     * @param metadata New metadata IPFS hash
     */
    function updateMetadata(uint256 courtId, string calldata metadata) external {
        CourtInfo storage court = _courts[courtId];
        require(court.id != 0, "Court does not exist");
        require(court.operator == msg.sender, "Not court operator");
        require(bytes(metadata).length > 0, "Metadata required");

        court.metadata = metadata;

        emit CourtMetadataUpdated(courtId, metadata);
    }

    /**
     * @dev Get court information
     * @param courtId ID of the court
     * @return Court information
     */
    function getCourt(uint256 courtId) external view returns (CourtInfo memory) {
        require(_courts[courtId].id != 0, "Court does not exist");
        return _courts[courtId];
    }

    /**
     * @dev Get court ID by operator address
     * @param operator Operator address
     * @return Court ID (0 if not registered)
     */
    function getCourtByOperator(address operator) external view returns (uint256) {
        return _operatorToCourt[operator];
    }

    /**
     * @dev List all active courts
     * @return Array of active court information
     */
    function listCourts() external view returns (CourtInfo[] memory) {
        CourtInfo[] memory courts = new CourtInfo[](_activeCourtIds.length);

        for (uint256 i = 0; i < _activeCourtIds.length; i++) {
            courts[i] = _courts[_activeCourtIds[i]];
        }

        return courts;
    }

    /**
     * @dev Get total number of courts (including inactive)
     * @return Total court count
     */
    function totalCourts() external view returns (uint256) {
        return _courtCount;
    }

    /**
     * @dev Get number of active courts
     * @return Active court count
     */
    function activeCourtCount() external view returns (uint256) {
        return _activeCourtIds.length;
    }

    /**
     * @dev Check if a court is active
     * @param courtId ID of the court
     * @return Whether the court is active
     */
    function isActive(uint256 courtId) external view returns (bool) {
        return _courts[courtId].active;
    }

    /**
     * @dev Remove court from active list (internal)
     */
    function _removeFromActiveList(uint256 courtId) private {
        for (uint256 i = 0; i < _activeCourtIds.length; i++) {
            if (_activeCourtIds[i] == courtId) {
                _activeCourtIds[i] = _activeCourtIds[_activeCourtIds.length - 1];
                _activeCourtIds.pop();
                break;
            }
        }
    }
}
