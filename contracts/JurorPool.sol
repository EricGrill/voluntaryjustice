// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./VJToken.sol";

/**
 * @title JurorPool
 * @dev Manages juror staking and random jury selection for appeals
 */
contract JurorPool is AccessControl, ReentrancyGuard {
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    bytes32 public constant DISPUTE_ROLE = keccak256("DISPUTE_ROLE");

    uint256 public constant UNSTAKE_TIMELOCK = 14 days;
    uint256 public constant MIN_STAKE = 100 * 10**18; // 100 VJ tokens
    uint256 public constant JURY_SIZE = 5;

    struct JurorInfo {
        uint256 stakedAmount;
        uint256 stakedAt;
        uint256 pendingUnstake;
        uint256 unstakeRequestTime;
        uint256 casesServed;
        uint256 slashedAmount;
        bool active;
    }

    VJToken public vjToken;

    mapping(address => JurorInfo) private _jurors;
    address[] private _activeJurors;
    mapping(address => uint256) private _jurorIndex; // index + 1 (0 means not in array)

    uint256 public totalStaked;
    uint256 public totalSlashed;

    // Events
    event JurorStaked(address indexed juror, uint256 amount);
    event UnstakeRequested(address indexed juror, uint256 amount, uint256 unlockTime);
    event UnstakeCompleted(address indexed juror, uint256 amount);
    event UnstakeCancelled(address indexed juror, uint256 amount);
    event JurorSlashed(address indexed juror, uint256 amount, string reason);
    event JuryDrawn(uint256 indexed disputeId, address[5] jury);

    constructor(address defaultAdmin, address _vjToken) {
        require(_vjToken != address(0), "Invalid token address");

        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(GOVERNANCE_ROLE, defaultAdmin);
        _grantRole(DISPUTE_ROLE, defaultAdmin);

        vjToken = VJToken(_vjToken);
    }

    /**
     * @dev Stake tokens to become a juror
     * @param amount Amount to stake
     */
    function stakeAsJuror(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be positive");

        JurorInfo storage juror = _jurors[msg.sender];

        // Transfer tokens
        require(vjToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        // Update stake info
        if (juror.stakedAmount == 0) {
            juror.stakedAt = block.timestamp;
        }
        juror.stakedAmount += amount;
        totalStaked += amount;

        // Activate juror if meets minimum stake
        if (juror.stakedAmount >= MIN_STAKE && !juror.active) {
            juror.active = true;
            _activeJurors.push(msg.sender);
            _jurorIndex[msg.sender] = _activeJurors.length; // index + 1
        }

        // Notify token of stake
        vjToken.notifyStake(msg.sender, amount);

        emit JurorStaked(msg.sender, amount);
    }

    /**
     * @dev Request to unstake tokens (subject to timelock)
     * @param amount Amount to unstake
     */
    function requestUnstake(uint256 amount) external {
        JurorInfo storage juror = _jurors[msg.sender];
        require(juror.stakedAmount > 0, "No stake found");
        require(amount > 0, "Amount must be positive");
        require(amount <= juror.stakedAmount, "Amount exceeds stake");
        require(juror.pendingUnstake == 0, "Pending unstake exists");

        juror.pendingUnstake = amount;
        juror.unstakeRequestTime = block.timestamp;

        // Deactivate if stake would fall below minimum
        if (juror.stakedAmount - amount < MIN_STAKE && juror.active) {
            _deactivateJuror(msg.sender);
        }

        emit UnstakeRequested(msg.sender, amount, block.timestamp + UNSTAKE_TIMELOCK);
    }

    /**
     * @dev Complete unstaking after timelock
     */
    function completeUnstake() external nonReentrant {
        JurorInfo storage juror = _jurors[msg.sender];
        require(juror.pendingUnstake > 0, "No pending unstake");
        require(
            block.timestamp >= juror.unstakeRequestTime + UNSTAKE_TIMELOCK,
            "Timelock not expired"
        );

        uint256 amount = juror.pendingUnstake;

        // Update stake info
        juror.stakedAmount -= amount;
        juror.pendingUnstake = 0;
        juror.unstakeRequestTime = 0;
        totalStaked -= amount;

        // Notify token of unstake
        vjToken.notifyUnstake(msg.sender, amount);

        // Transfer tokens back
        require(vjToken.transfer(msg.sender, amount), "Transfer failed");

        emit UnstakeCompleted(msg.sender, amount);
    }

    /**
     * @dev Cancel pending unstake request
     */
    function cancelUnstake() external {
        JurorInfo storage juror = _jurors[msg.sender];
        require(juror.pendingUnstake > 0, "No pending unstake");

        uint256 amount = juror.pendingUnstake;
        juror.pendingUnstake = 0;
        juror.unstakeRequestTime = 0;

        // Reactivate if stake meets minimum
        if (juror.stakedAmount >= MIN_STAKE && !juror.active) {
            juror.active = true;
            _activeJurors.push(msg.sender);
            _jurorIndex[msg.sender] = _activeJurors.length;
        }

        emit UnstakeCancelled(msg.sender, amount);
    }

    /**
     * @dev Draw a random jury for a dispute
     * @param disputeId ID of the dispute
     * @param seed Random seed for selection
     * @return jury Array of 5 juror addresses
     */
    function drawJury(uint256 disputeId, bytes32 seed) 
        external 
        onlyRole(DISPUTE_ROLE) 
        returns (address[5] memory jury) 
    {
        require(_activeJurors.length >= JURY_SIZE, "Insufficient jurors");

        // Create a working copy of active jurors for selection
        address[] memory candidates = new address[](_activeJurors.length);
        for (uint256 i = 0; i < _activeJurors.length; i++) {
            candidates[i] = _activeJurors[i];
        }

        uint256 remaining = candidates.length;

        for (uint256 i = 0; i < JURY_SIZE; i++) {
            // Generate pseudo-random index using seed, disputeId, and iteration
            uint256 randomIndex = uint256(
                keccak256(abi.encodePacked(seed, disputeId, i, block.timestamp, block.prevrandao))
            ) % remaining;

            jury[i] = candidates[randomIndex];
            _jurors[jury[i]].casesServed++;

            // Swap selected with last and reduce remaining
            candidates[randomIndex] = candidates[remaining - 1];
            remaining--;
        }

        emit JuryDrawn(disputeId, jury);
    }

    /**
     * @dev Slash a juror's stake
     * @param juror Address of juror to slash
     * @param amount Amount to slash
     * @param reason Reason for slashing
     */
    function slashJuror(
        address juror,
        uint256 amount,
        string calldata reason
    ) external onlyRole(GOVERNANCE_ROLE) {
        JurorInfo storage info = _jurors[juror];
        require(info.stakedAmount > 0, "Juror has no stake");
        require(amount <= info.stakedAmount, "Amount exceeds stake");
        require(bytes(reason).length > 0, "Reason required");

        info.stakedAmount -= amount;
        info.slashedAmount += amount;
        totalStaked -= amount;
        totalSlashed += amount;

        // Deactivate if stake falls below minimum
        if (info.stakedAmount < MIN_STAKE && info.active) {
            _deactivateJuror(juror);
        }

        // Burn slashed tokens
        vjToken.burn(amount);

        emit JurorSlashed(juror, amount, reason);
    }

    /**
     * @dev Get juror information
     * @param juror Address to query
     * @return stakedAmount Amount staked
     * @return stakedAt Timestamp when first staked
     * @return pendingUnstake Amount pending unstake
     * @return unstakeRequestTime Time of unstake request
     * @return casesServed Number of cases served
     * @return slashedAmount Total amount slashed
     * @return active Whether juror is active
     */
    function getJurorInfo(address juror) external view returns (
        uint256 stakedAmount,
        uint256 stakedAt,
        uint256 pendingUnstake,
        uint256 unstakeRequestTime,
        uint256 casesServed,
        uint256 slashedAmount,
        bool active
    ) {
        JurorInfo storage info = _jurors[juror];
        return (
            info.stakedAmount,
            info.stakedAt,
            info.pendingUnstake,
            info.unstakeRequestTime,
            info.casesServed,
            info.slashedAmount,
            info.active
        );
    }

    /**
     * @dev Get count of active jurors
     * @return Number of active jurors
     */
    function activeJurorCount() external view returns (uint256) {
        return _activeJurors.length;
    }

    /**
     * @dev Check if address is an active juror
     * @param addr Address to check
     * @return Whether address is active juror
     */
    function isActiveJuror(address addr) external view returns (bool) {
        return _jurors[addr].active;
    }

    /**
     * @dev Internal function to deactivate a juror
     */
    function _deactivateJuror(address juror) internal {
        JurorInfo storage info = _jurors[juror];
        if (!info.active) return;

        info.active = false;

        // Remove from active jurors array (swap and pop)
        uint256 index = _jurorIndex[juror];
        if (index > 0) {
            uint256 lastIndex = _activeJurors.length - 1;
            if (index - 1 != lastIndex) {
                address lastJuror = _activeJurors[lastIndex];
                _activeJurors[index - 1] = lastJuror;
                _jurorIndex[lastJuror] = index;
            }
            _activeJurors.pop();
            _jurorIndex[juror] = 0;
        }
    }
}
