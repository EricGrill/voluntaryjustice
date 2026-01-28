// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./VJToken.sol";

/**
 * @title StakingRewards
 * @dev Manages staking for courts, jurors, and insurers with reward distribution
 */
contract StakingRewards is AccessControl, ReentrancyGuard {
    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");

    uint256 public constant UNSTAKE_TIMELOCK = 14 days;

    enum StakeRole {
        Court,
        Juror,
        Insurer
    }

    struct StakeInfo {
        uint256 amount;
        StakeRole role;
        uint256 stakedAt;
        uint256 pendingUnstake;
        uint256 unstakeRequestTime;
        uint256 rewardDebt;
    }

    struct RolePool {
        uint256 totalStaked;
        uint256 accRewardPerShare;
        uint256 lastRewardTime;
    }

    VJToken public vjToken;

    mapping(address => StakeInfo) private _stakes;
    mapping(StakeRole => RolePool) private _pools;
    mapping(StakeRole => uint256) public roleWeights; // Basis points (10000 = 100%)

    uint256 public totalRewardsDistributed;
    uint256 public pendingRewards;

    // Events
    event Staked(address indexed account, uint256 amount, StakeRole role);
    event UnstakeRequested(address indexed account, uint256 amount, uint256 unlockTime);
    event UnstakeCompleted(address indexed account, uint256 amount);
    event UnstakeCancelled(address indexed account, uint256 amount);
    event RewardsClaimed(address indexed account, uint256 amount);
    event RewardsDistributed(uint256 amount);
    event RoleWeightUpdated(StakeRole role, uint256 weight);

    constructor(address defaultAdmin, address _vjToken) {
        require(_vjToken != address(0), "Invalid token address");

        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(DISTRIBUTOR_ROLE, defaultAdmin);

        vjToken = VJToken(_vjToken);

        // Default weights: Court 50%, Juror 30%, Insurer 20%
        roleWeights[StakeRole.Court] = 5000;
        roleWeights[StakeRole.Juror] = 3000;
        roleWeights[StakeRole.Insurer] = 2000;
    }

    /**
     * @dev Stake tokens for a specific role
     * @param amount Amount to stake
     * @param role Role to stake for
     */
    function stake(uint256 amount, StakeRole role) external nonReentrant {
        require(amount > 0, "Amount must be positive");

        StakeInfo storage stakeInfo = _stakes[msg.sender];

        // If already staking, must be same role
        if (stakeInfo.amount > 0) {
            require(stakeInfo.role == role, "Already staking for different role");
            // Claim any pending rewards first
            _claimRewards(msg.sender);
        }

        // Transfer tokens
        require(vjToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        // Notify token of stake
        vjToken.notifyStake(msg.sender, amount);

        // Update stake info
        if (stakeInfo.amount == 0) {
            stakeInfo.role = role;
            stakeInfo.stakedAt = block.timestamp;
        }
        stakeInfo.amount += amount;

        // Update pool
        RolePool storage pool = _pools[role];
        pool.totalStaked += amount;

        // Set reward debt
        stakeInfo.rewardDebt = (stakeInfo.amount * pool.accRewardPerShare) / 1e18;

        emit Staked(msg.sender, amount, role);
    }

    /**
     * @dev Request to unstake tokens (subject to timelock)
     * @param amount Amount to unstake
     */
    function requestUnstake(uint256 amount) external {
        StakeInfo storage stakeInfo = _stakes[msg.sender];
        require(stakeInfo.amount > 0, "No stake found");
        require(amount > 0, "Amount must be positive");
        require(amount <= stakeInfo.amount, "Amount exceeds stake");
        require(stakeInfo.pendingUnstake == 0, "Pending unstake exists");

        // Claim rewards before unstaking
        _claimRewards(msg.sender);

        stakeInfo.pendingUnstake = amount;
        stakeInfo.unstakeRequestTime = block.timestamp;

        emit UnstakeRequested(msg.sender, amount, block.timestamp + UNSTAKE_TIMELOCK);
    }

    /**
     * @dev Complete unstaking after timelock
     */
    function completeUnstake() external nonReentrant {
        StakeInfo storage stakeInfo = _stakes[msg.sender];
        require(stakeInfo.pendingUnstake > 0, "No pending unstake");
        require(
            block.timestamp >= stakeInfo.unstakeRequestTime + UNSTAKE_TIMELOCK,
            "Timelock not expired"
        );

        uint256 amount = stakeInfo.pendingUnstake;
        StakeRole role = stakeInfo.role;

        // Update stake info
        stakeInfo.amount -= amount;
        stakeInfo.pendingUnstake = 0;
        stakeInfo.unstakeRequestTime = 0;

        // Update pool
        _pools[role].totalStaked -= amount;

        // Update reward debt
        stakeInfo.rewardDebt = (stakeInfo.amount * _pools[role].accRewardPerShare) / 1e18;

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
        StakeInfo storage stakeInfo = _stakes[msg.sender];
        require(stakeInfo.pendingUnstake > 0, "No pending unstake");

        uint256 amount = stakeInfo.pendingUnstake;
        stakeInfo.pendingUnstake = 0;
        stakeInfo.unstakeRequestTime = 0;

        emit UnstakeCancelled(msg.sender, amount);
    }

    /**
     * @dev Claim pending rewards
     */
    function claimRewards() external nonReentrant {
        _claimRewards(msg.sender);
    }

    /**
     * @dev Distribute rewards to stakers (called when fees collected)
     * @param amount Amount of rewards to distribute
     */
    function distributeRewards(uint256 amount) external onlyRole(DISTRIBUTOR_ROLE) {
        require(amount > 0, "Amount must be positive");

        // Transfer rewards from caller
        require(vjToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        uint256 totalWeight = roleWeights[StakeRole.Court] +
            roleWeights[StakeRole.Juror] +
            roleWeights[StakeRole.Insurer];

        // Distribute to each pool based on weights
        for (uint8 i = 0; i < 3; i++) {
            StakeRole role = StakeRole(i);
            RolePool storage pool = _pools[role];

            if (pool.totalStaked > 0) {
                uint256 roleReward = (amount * roleWeights[role]) / totalWeight;
                pool.accRewardPerShare += (roleReward * 1e18) / pool.totalStaked;
            }
        }

        totalRewardsDistributed += amount;

        emit RewardsDistributed(amount);
    }

    /**
     * @dev Update role weight (admin only)
     * @param role Role to update
     * @param weight New weight in basis points
     */
    function setRoleWeight(StakeRole role, uint256 weight) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(weight <= 10000, "Weight exceeds maximum");
        roleWeights[role] = weight;
        emit RoleWeightUpdated(role, weight);
    }

    /**
     * @dev Get stake information for an address
     * @param account Address to query
     * @return amount Staked amount
     * @return role Stake role
     * @return stakedAt Timestamp when staked
     * @return pendingUnstake Amount pending unstake
     * @return unstakeRequestTime Time of unstake request
     * @return pending Pending reward amount
     */
    function getStakeInfo(address account) external view returns (
        uint256 amount,
        StakeRole role,
        uint256 stakedAt,
        uint256 pendingUnstake,
        uint256 unstakeRequestTime,
        uint256 pending
    ) {
        StakeInfo storage stakeInfo = _stakes[account];
        return (
            stakeInfo.amount,
            stakeInfo.role,
            stakeInfo.stakedAt,
            stakeInfo.pendingUnstake,
            stakeInfo.unstakeRequestTime,
            _pendingReward(account)
        );
    }

    /**
     * @dev Get pool information for a role
     * @param role Role to query
     * @return totalStaked Total staked in pool
     * @return accRewardPerShare Accumulated reward per share
     */
    function getPoolInfo(StakeRole role) external view returns (
        uint256 totalStaked,
        uint256 accRewardPerShare
    ) {
        RolePool storage pool = _pools[role];
        return (pool.totalStaked, pool.accRewardPerShare);
    }

    /**
     * @dev Calculate pending rewards for an account
     * @param account Address to query
     * @return Pending reward amount
     */
    function pendingReward(address account) external view returns (uint256) {
        return _pendingReward(account);
    }

    /**
     * @dev Internal function to calculate pending rewards
     */
    function _pendingReward(address account) internal view returns (uint256) {
        StakeInfo storage stakeInfo = _stakes[account];
        if (stakeInfo.amount == 0) return 0;

        RolePool storage pool = _pools[stakeInfo.role];
        uint256 accReward = (stakeInfo.amount * pool.accRewardPerShare) / 1e18;

        if (accReward <= stakeInfo.rewardDebt) return 0;
        return accReward - stakeInfo.rewardDebt;
    }

    /**
     * @dev Internal function to claim rewards
     */
    function _claimRewards(address account) internal {
        uint256 reward = _pendingReward(account);
        if (reward > 0) {
            StakeInfo storage stakeInfo = _stakes[account];
            RolePool storage pool = _pools[stakeInfo.role];

            stakeInfo.rewardDebt = (stakeInfo.amount * pool.accRewardPerShare) / 1e18;

            require(vjToken.transfer(account, reward), "Transfer failed");

            emit RewardsClaimed(account, reward);
        }
    }
}
