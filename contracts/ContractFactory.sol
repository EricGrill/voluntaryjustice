// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./ContractTemplateRegistry.sol";
import "./ReputationScoring.sol";

/**
 * @title ContractFactory
 * @dev Creates and manages contracts between parties using templates
 */
contract ContractFactory is AccessControl {
    bytes32 public constant SYSTEM_ROLE = keccak256("SYSTEM_ROLE");

    enum ContractState {
        Draft,
        PendingSignatures,
        Active,
        Disputed,
        Completed,
        Terminated
    }

    struct ContractInfo {
        uint256 id;
        uint256 templateId;
        bytes32 paramsHash; // Hash of contract parameters stored off-chain
        address[] parties;
        mapping(address => bool) signatures;
        uint256 signatureCount;
        address arbitrator;
        ContractState state;
        uint256 createdAt;
        uint256 activatedAt;
        uint256 escrowRequired;
    }

    struct ContractView {
        uint256 id;
        uint256 templateId;
        bytes32 paramsHash;
        address[] parties;
        address arbitrator;
        ContractState state;
        uint256 createdAt;
        uint256 activatedAt;
        uint256 escrowRequired;
        uint256 signatureCount;
    }

    ContractTemplateRegistry public templateRegistry;
    ReputationScoring public reputationScoring;

    mapping(uint256 => ContractInfo) private _contracts;
    mapping(address => uint256[]) private _partyContracts;
    uint256 private _contractCount;

    // Events
    event ContractCreated(
        uint256 indexed contractId,
        uint256 indexed templateId,
        address[] parties,
        address arbitrator
    );
    event ContractSigned(uint256 indexed contractId, address indexed signer);
    event ContractActivated(uint256 indexed contractId, uint256 timestamp);
    event ContractDisputed(uint256 indexed contractId);
    event ContractCompleted(uint256 indexed contractId);
    event ContractTerminated(uint256 indexed contractId, string reason);

    constructor(
        address defaultAdmin,
        address _templateRegistry,
        address _reputationScoring
    ) {
        require(_templateRegistry != address(0), "Invalid template registry");
        require(_reputationScoring != address(0), "Invalid reputation scoring");

        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(SYSTEM_ROLE, defaultAdmin);

        templateRegistry = ContractTemplateRegistry(_templateRegistry);
        reputationScoring = ReputationScoring(_reputationScoring);
    }

    /**
     * @dev Create a new contract from a template
     * @param templateId ID of the template to use
     * @param paramsHash Hash of the contract parameters (stored off-chain)
     * @param parties Array of party addresses
     * @param escrowRequired Amount of escrow required
     * @return contractId The ID of the created contract
     */
    function createContract(
        uint256 templateId,
        bytes32 paramsHash,
        address[] calldata parties,
        uint256 escrowRequired
    ) external returns (uint256 contractId) {
        require(parties.length >= 2, "Minimum 2 parties required");
        require(paramsHash != bytes32(0), "Params hash required");

        // Verify template exists and is active
        (bool exists, bool active) = templateRegistry.isTemplateActive(templateId);
        require(exists && active, "Template not active");

        // Get template for default arbitrator
        ContractTemplateRegistry.TemplateInfo memory template = templateRegistry.getTemplate(templateId);

        _contractCount++;
        contractId = _contractCount;

        ContractInfo storage newContract = _contracts[contractId];
        newContract.id = contractId;
        newContract.templateId = templateId;
        newContract.paramsHash = paramsHash;
        newContract.parties = parties;
        newContract.arbitrator = template.defaultArbitrator;
        newContract.state = ContractState.PendingSignatures;
        newContract.createdAt = block.timestamp;
        newContract.escrowRequired = escrowRequired;

        // Track contracts for each party and record participation
        for (uint256 i = 0; i < parties.length; i++) {
            require(parties[i] != address(0), "Invalid party address");
            _partyContracts[parties[i]].push(contractId);
            reputationScoring.recordContract(parties[i], contractId);
        }

        // Record template usage
        templateRegistry.recordUsage(templateId);

        emit ContractCreated(contractId, templateId, parties, template.defaultArbitrator);
    }

    /**
     * @dev Sign a contract
     * @param contractId ID of the contract to sign
     */
    function signContract(uint256 contractId) external {
        ContractInfo storage c = _contracts[contractId];
        require(c.id != 0, "Contract does not exist");
        require(c.state == ContractState.PendingSignatures, "Contract not pending signatures");
        require(_isParty(c, msg.sender), "Not a party to this contract");
        require(!c.signatures[msg.sender], "Already signed");

        c.signatures[msg.sender] = true;
        c.signatureCount++;

        emit ContractSigned(contractId, msg.sender);

        // If all parties have signed, activate the contract
        if (c.signatureCount == c.parties.length) {
            c.state = ContractState.Active;
            c.activatedAt = block.timestamp;
            emit ContractActivated(contractId, block.timestamp);
        }
    }

    /**
     * @dev Override the arbitrator for a contract (requires all parties to sign again)
     * @param contractId ID of the contract
     * @param newArbitrator Address of the new arbitrator
     */
    function setArbitrator(uint256 contractId, address newArbitrator) external {
        ContractInfo storage c = _contracts[contractId];
        require(c.id != 0, "Contract does not exist");
        require(c.state == ContractState.PendingSignatures, "Contract already active");
        require(_isParty(c, msg.sender), "Not a party to this contract");
        require(newArbitrator != address(0), "Invalid arbitrator");

        c.arbitrator = newArbitrator;

        // Reset signatures since terms changed
        for (uint256 i = 0; i < c.parties.length; i++) {
            c.signatures[c.parties[i]] = false;
        }
        c.signatureCount = 0;
    }

    /**
     * @dev Mark a contract as disputed
     * @param contractId ID of the contract
     */
    function markDisputed(uint256 contractId) external onlyRole(SYSTEM_ROLE) {
        ContractInfo storage c = _contracts[contractId];
        require(c.id != 0, "Contract does not exist");
        require(c.state == ContractState.Active, "Contract not active");

        c.state = ContractState.Disputed;

        emit ContractDisputed(contractId);
    }

    /**
     * @dev Mark a contract as completed
     * @param contractId ID of the contract
     */
    function markCompleted(uint256 contractId) external onlyRole(SYSTEM_ROLE) {
        ContractInfo storage c = _contracts[contractId];
        require(c.id != 0, "Contract does not exist");
        require(
            c.state == ContractState.Active || c.state == ContractState.Disputed,
            "Invalid state for completion"
        );

        c.state = ContractState.Completed;

        emit ContractCompleted(contractId);
    }

    /**
     * @dev Terminate a contract
     * @param contractId ID of the contract
     * @param reason Reason for termination
     */
    function terminateContract(uint256 contractId, string calldata reason) external {
        ContractInfo storage c = _contracts[contractId];
        require(c.id != 0, "Contract does not exist");
        require(
            c.state == ContractState.PendingSignatures ||
            c.state == ContractState.Active,
            "Cannot terminate in current state"
        );
        require(_isParty(c, msg.sender) || hasRole(SYSTEM_ROLE, msg.sender), "Not authorized");

        c.state = ContractState.Terminated;

        emit ContractTerminated(contractId, reason);
    }

    /**
     * @dev Get contract information
     * @param contractId ID of the contract
     * @return Contract view struct
     */
    function getContract(uint256 contractId) external view returns (ContractView memory) {
        ContractInfo storage c = _contracts[contractId];
        require(c.id != 0, "Contract does not exist");

        return ContractView({
            id: c.id,
            templateId: c.templateId,
            paramsHash: c.paramsHash,
            parties: c.parties,
            arbitrator: c.arbitrator,
            state: c.state,
            createdAt: c.createdAt,
            activatedAt: c.activatedAt,
            escrowRequired: c.escrowRequired,
            signatureCount: c.signatureCount
        });
    }

    /**
     * @dev Check if an address has signed a contract
     * @param contractId ID of the contract
     * @param signer Address to check
     * @return Whether the address has signed
     */
    function hasSigned(uint256 contractId, address signer) external view returns (bool) {
        return _contracts[contractId].signatures[signer];
    }

    /**
     * @dev Get contracts for a party
     * @param party Address of the party
     * @return Array of contract IDs
     */
    function getContractsByParty(address party) external view returns (uint256[] memory) {
        return _partyContracts[party];
    }

    /**
     * @dev Get total number of contracts
     * @return Total contract count
     */
    function totalContracts() external view returns (uint256) {
        return _contractCount;
    }

    /**
     * @dev Check if an address is a party to a contract
     * @param c Contract storage reference
     * @param addr Address to check
     * @return Whether the address is a party
     */
    function _isParty(ContractInfo storage c, address addr) private view returns (bool) {
        for (uint256 i = 0; i < c.parties.length; i++) {
            if (c.parties[i] == addr) {
                return true;
            }
        }
        return false;
    }

    /**
     * @dev Check if an address is a party to a contract (public view)
     * @param contractId Contract ID
     * @param addr Address to check
     * @return Whether the address is a party
     */
    function isParty(uint256 contractId, address addr) external view returns (bool) {
        ContractInfo storage c = _contracts[contractId];
        return _isParty(c, addr);
    }
}
