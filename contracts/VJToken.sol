// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title VJToken
 * @dev ERC-20 token for VoluntaryJustice DAO with staking hooks and governance-controlled minting
 */
contract VJToken is ERC20, ERC20Burnable, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant STAKING_ROLE = keccak256("STAKING_ROLE");

    // Staking hooks - track staked balances
    mapping(address => uint256) private _stakedBalances;

    // Events
    event Staked(address indexed account, uint256 amount);
    event Unstaked(address indexed account, uint256 amount);

    constructor(address defaultAdmin) ERC20("VoluntaryJustice", "VJ") {
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(MINTER_ROLE, defaultAdmin);
    }

    /**
     * @dev Mint new tokens. Only callable by addresses with MINTER_ROLE.
     * @param to Address to receive the tokens
     * @param amount Amount of tokens to mint
     */
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    /**
     * @dev Called by staking contracts to record staked tokens.
     * @param account Address staking tokens
     * @param amount Amount being staked
     */
    function notifyStake(address account, uint256 amount) external onlyRole(STAKING_ROLE) {
        require(balanceOf(account) >= _stakedBalances[account] + amount, "Insufficient unstaked balance");
        _stakedBalances[account] += amount;
        emit Staked(account, amount);
    }

    /**
     * @dev Called by staking contracts to record unstaked tokens.
     * @param account Address unstaking tokens
     * @param amount Amount being unstaked
     */
    function notifyUnstake(address account, uint256 amount) external onlyRole(STAKING_ROLE) {
        require(_stakedBalances[account] >= amount, "Insufficient staked balance");
        _stakedBalances[account] -= amount;
        emit Unstaked(account, amount);
    }

    /**
     * @dev Get the staked balance of an account.
     * @param account Address to query
     * @return The amount of tokens staked by the account
     */
    function stakedBalanceOf(address account) external view returns (uint256) {
        return _stakedBalances[account];
    }

    /**
     * @dev Get the unstaked (transferable) balance of an account.
     * @param account Address to query
     * @return The amount of tokens available for transfer
     */
    function unstakedBalanceOf(address account) external view returns (uint256) {
        return balanceOf(account) - _stakedBalances[account];
    }

    /**
     * @dev Override transfer to prevent transferring staked tokens.
     */
    function _update(address from, address to, uint256 value) internal virtual override {
        if (from != address(0)) {
            // Not a mint - check unstaked balance
            uint256 unstaked = balanceOf(from) - _stakedBalances[from];
            require(unstaked >= value, "Cannot transfer staked tokens");
        }
        super._update(from, to, value);
    }
}
