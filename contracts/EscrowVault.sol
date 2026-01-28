// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title EscrowVault
 * @dev Holds escrow funds for contracts and releases them based on rulings
 */
contract EscrowVault is AccessControl, ReentrancyGuard {
    bytes32 public constant ENFORCEMENT_ROLE = keccak256("ENFORCEMENT_ROLE");
    bytes32 public constant CONTRACT_FACTORY_ROLE = keccak256("CONTRACT_FACTORY_ROLE");

    struct EscrowInfo {
        uint256 totalDeposited;
        mapping(address => uint256) deposits;
        bool locked;
    }

    mapping(uint256 => EscrowInfo) private _escrows;

    // Events
    event Deposited(uint256 indexed contractId, address indexed depositor, uint256 amount);
    event Released(uint256 indexed contractId, address indexed recipient, uint256 amount);
    event Refunded(uint256 indexed contractId, address indexed recipient, uint256 amount);
    event EscrowLocked(uint256 indexed contractId);
    event EscrowUnlocked(uint256 indexed contractId);

    constructor(address defaultAdmin) {
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
    }

    /**
     * @dev Deposit funds into escrow for a contract
     * @param contractId ID of the contract
     */
    function deposit(uint256 contractId) external payable nonReentrant {
        require(msg.value > 0, "Amount must be positive");
        require(!_escrows[contractId].locked, "Escrow is locked");

        _escrows[contractId].deposits[msg.sender] += msg.value;
        _escrows[contractId].totalDeposited += msg.value;

        emit Deposited(contractId, msg.sender, msg.value);
    }

    /**
     * @dev Deposit funds on behalf of another address
     * @param contractId ID of the contract
     * @param depositor Address to credit the deposit to
     */
    function depositFor(uint256 contractId, address depositor) external payable nonReentrant {
        require(msg.value > 0, "Amount must be positive");
        require(depositor != address(0), "Invalid depositor");
        require(!_escrows[contractId].locked, "Escrow is locked");

        _escrows[contractId].deposits[depositor] += msg.value;
        _escrows[contractId].totalDeposited += msg.value;

        emit Deposited(contractId, depositor, msg.value);
    }

    /**
     * @dev Lock escrow to prevent further deposits (called when contract becomes active)
     * @param contractId ID of the contract
     */
    function lockEscrow(uint256 contractId) external onlyRole(CONTRACT_FACTORY_ROLE) {
        require(!_escrows[contractId].locked, "Already locked");
        _escrows[contractId].locked = true;
        emit EscrowLocked(contractId);
    }

    /**
     * @dev Unlock escrow (for edge cases, requires admin)
     * @param contractId ID of the contract
     */
    function unlockEscrow(uint256 contractId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_escrows[contractId].locked, "Not locked");
        _escrows[contractId].locked = false;
        emit EscrowUnlocked(contractId);
    }

    /**
     * @dev Release escrow funds to a recipient (enforcement)
     * @param contractId ID of the contract
     * @param recipient Address to receive the funds
     * @param amount Amount to release
     */
    function release(uint256 contractId, address recipient, uint256 amount)
        external
        nonReentrant
        onlyRole(ENFORCEMENT_ROLE)
    {
        require(recipient != address(0), "Invalid recipient");
        require(amount > 0, "Amount must be positive");
        require(_escrows[contractId].totalDeposited >= amount, "Insufficient escrow balance");

        _escrows[contractId].totalDeposited -= amount;

        (bool success, ) = recipient.call{value: amount}("");
        require(success, "Transfer failed");

        emit Released(contractId, recipient, amount);
    }

    /**
     * @dev Release specific depositor's funds to recipient
     * @param contractId ID of the contract
     * @param from Address whose deposit to use
     * @param recipient Address to receive the funds
     * @param amount Amount to release
     */
    function releaseFrom(uint256 contractId, address from, address recipient, uint256 amount)
        external
        nonReentrant
        onlyRole(ENFORCEMENT_ROLE)
    {
        require(recipient != address(0), "Invalid recipient");
        require(amount > 0, "Amount must be positive");
        require(_escrows[contractId].deposits[from] >= amount, "Insufficient depositor balance");

        _escrows[contractId].deposits[from] -= amount;
        _escrows[contractId].totalDeposited -= amount;

        (bool success, ) = recipient.call{value: amount}("");
        require(success, "Transfer failed");

        emit Released(contractId, recipient, amount);
    }

    /**
     * @dev Refund escrow to a depositor (contract cancellation)
     * @param contractId ID of the contract
     * @param depositor Address to refund
     */
    function refund(uint256 contractId, address depositor)
        external
        nonReentrant
        onlyRole(CONTRACT_FACTORY_ROLE)
    {
        uint256 amount = _escrows[contractId].deposits[depositor];
        require(amount > 0, "No deposit to refund");

        _escrows[contractId].deposits[depositor] = 0;
        _escrows[contractId].totalDeposited -= amount;

        (bool success, ) = depositor.call{value: amount}("");
        require(success, "Transfer failed");

        emit Refunded(contractId, depositor, amount);
    }

    /**
     * @dev Refund partial amount to depositor
     * @param contractId ID of the contract
     * @param depositor Address to refund
     * @param amount Amount to refund
     */
    function refundPartial(uint256 contractId, address depositor, uint256 amount)
        external
        nonReentrant
        onlyRole(CONTRACT_FACTORY_ROLE)
    {
        require(amount > 0, "Amount must be positive");
        require(_escrows[contractId].deposits[depositor] >= amount, "Insufficient deposit");

        _escrows[contractId].deposits[depositor] -= amount;
        _escrows[contractId].totalDeposited -= amount;

        (bool success, ) = depositor.call{value: amount}("");
        require(success, "Transfer failed");

        emit Refunded(contractId, depositor, amount);
    }

    /**
     * @dev Get total escrow balance for a contract
     * @param contractId ID of the contract
     * @return Total balance in escrow
     */
    function getBalance(uint256 contractId) external view returns (uint256) {
        return _escrows[contractId].totalDeposited;
    }

    /**
     * @dev Get a specific depositor's balance for a contract
     * @param contractId ID of the contract
     * @param depositor Address of the depositor
     * @return Depositor's balance
     */
    function getDepositorBalance(uint256 contractId, address depositor) external view returns (uint256) {
        return _escrows[contractId].deposits[depositor];
    }

    /**
     * @dev Check if escrow is locked
     * @param contractId ID of the contract
     * @return Whether the escrow is locked
     */
    function isLocked(uint256 contractId) external view returns (bool) {
        return _escrows[contractId].locked;
    }
}
