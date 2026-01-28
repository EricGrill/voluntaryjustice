// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./ContractFactory.sol";
import "./CourtRegistry.sol";
import "./ReputationScoring.sol";

/**
 * @title DisputeResolution
 * @dev Manages the dispute lifecycle from filing to ruling
 */
contract DisputeResolution is AccessControl {
    bytes32 public constant SYSTEM_ROLE = keccak256("SYSTEM_ROLE");

    enum DisputeState {
        Filed,
        Evidence,
        Ruling,
        Finalized
    }

    struct Ruling {
        address liable;
        uint256 restitutionAmount;
        bytes enforcementInstructions;
        bool exists;
    }

    struct DisputeInfo {
        uint256 id;
        uint256 contractId;
        address claimant;
        address respondent;
        string claim;
        bytes32[] evidenceHashes;
        uint256 courtId;
        DisputeState state;
        uint256 filedAt;
        uint256 evidenceDeadline;
        uint256 rulingDeadline;
        Ruling ruling;
    }

    struct DisputeView {
        uint256 id;
        uint256 contractId;
        address claimant;
        address respondent;
        string claim;
        bytes32[] evidenceHashes;
        uint256 courtId;
        DisputeState state;
        uint256 filedAt;
        uint256 evidenceDeadline;
        uint256 rulingDeadline;
        bool hasRuling;
        address liable;
        uint256 restitutionAmount;
    }

    uint256 public constant EVIDENCE_PERIOD = 7 days;
    uint256 public constant RULING_PERIOD = 14 days;

    ContractFactory public contractFactory;
    CourtRegistry public courtRegistry;
    ReputationScoring public reputationScoring;

    mapping(uint256 => DisputeInfo) private _disputes;
    mapping(uint256 => uint256[]) private _contractDisputes;
    mapping(address => uint256[]) private _partyDisputes;
    uint256 private _disputeCount;

    // Events
    event DisputeFiled(
        uint256 indexed disputeId,
        uint256 indexed contractId,
        address indexed claimant,
        address respondent
    );
    event EvidenceSubmitted(uint256 indexed disputeId, address indexed submitter, bytes32 evidenceHash);
    event EvidencePeriodEnded(uint256 indexed disputeId);
    event RulingSubmitted(
        uint256 indexed disputeId,
        address liable,
        uint256 restitutionAmount
    );
    event DisputeFinalized(uint256 indexed disputeId);

    constructor(
        address defaultAdmin,
        address _contractFactory,
        address _courtRegistry,
        address _reputationScoring
    ) {
        require(_contractFactory != address(0), "Invalid contract factory");
        require(_courtRegistry != address(0), "Invalid court registry");
        require(_reputationScoring != address(0), "Invalid reputation scoring");

        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(SYSTEM_ROLE, defaultAdmin);

        contractFactory = ContractFactory(_contractFactory);
        courtRegistry = CourtRegistry(_courtRegistry);
        reputationScoring = ReputationScoring(_reputationScoring);
    }

    /**
     * @dev File a new dispute
     * @param contractId ID of the contract in dispute
     * @param claim Description of the claim
     * @param evidenceHash Initial evidence hash
     * @return disputeId The ID of the filed dispute
     */
    function fileDispute(
        uint256 contractId,
        string calldata claim,
        bytes32 evidenceHash
    ) external returns (uint256 disputeId) {
        require(bytes(claim).length > 0, "Claim required");
        require(evidenceHash != bytes32(0), "Evidence hash required");

        // Verify caller is party to contract
        require(contractFactory.isParty(contractId, msg.sender), "Not a party to contract");

        // Get contract info
        ContractFactory.ContractView memory c = contractFactory.getContract(contractId);
        require(
            c.state == ContractFactory.ContractState.Active,
            "Contract not active"
        );

        // Determine respondent (the other party)
        address respondent;
        for (uint256 i = 0; i < c.parties.length; i++) {
            if (c.parties[i] != msg.sender) {
                respondent = c.parties[i];
                break;
            }
        }
        require(respondent != address(0), "No respondent found");

        // Get court ID from the contract's arbitrator
        uint256 courtId = courtRegistry.getCourtByOperator(c.arbitrator);
        require(courtId != 0, "Court not found");

        _disputeCount++;
        disputeId = _disputeCount;

        DisputeInfo storage dispute = _disputes[disputeId];
        dispute.id = disputeId;
        dispute.contractId = contractId;
        dispute.claimant = msg.sender;
        dispute.respondent = respondent;
        dispute.claim = claim;
        dispute.evidenceHashes.push(evidenceHash);
        dispute.courtId = courtId;
        dispute.state = DisputeState.Filed;
        dispute.filedAt = block.timestamp;
        dispute.evidenceDeadline = block.timestamp + EVIDENCE_PERIOD;
        dispute.rulingDeadline = block.timestamp + EVIDENCE_PERIOD + RULING_PERIOD;

        // Track disputes
        _contractDisputes[contractId].push(disputeId);
        _partyDisputes[msg.sender].push(disputeId);
        _partyDisputes[respondent].push(disputeId);

        // Mark contract as disputed
        contractFactory.markDisputed(contractId);

        // Record dispute against respondent in reputation
        reputationScoring.recordDispute(respondent, contractId);

        emit DisputeFiled(disputeId, contractId, msg.sender, respondent);
    }

    /**
     * @dev Submit additional evidence
     * @param disputeId ID of the dispute
     * @param evidenceHash Hash of the evidence
     */
    function submitEvidence(uint256 disputeId, bytes32 evidenceHash) external {
        DisputeInfo storage dispute = _disputes[disputeId];
        require(dispute.id != 0, "Dispute does not exist");
        require(
            dispute.state == DisputeState.Filed || dispute.state == DisputeState.Evidence,
            "Evidence period ended"
        );
        require(block.timestamp <= dispute.evidenceDeadline, "Evidence deadline passed");
        require(
            msg.sender == dispute.claimant || msg.sender == dispute.respondent,
            "Not a party to dispute"
        );
        require(evidenceHash != bytes32(0), "Evidence hash required");

        dispute.evidenceHashes.push(evidenceHash);

        if (dispute.state == DisputeState.Filed) {
            dispute.state = DisputeState.Evidence;
        }

        emit EvidenceSubmitted(disputeId, msg.sender, evidenceHash);
    }

    /**
     * @dev End evidence period (can be called by anyone after deadline)
     * @param disputeId ID of the dispute
     */
    function endEvidencePeriod(uint256 disputeId) external {
        DisputeInfo storage dispute = _disputes[disputeId];
        require(dispute.id != 0, "Dispute does not exist");
        require(
            dispute.state == DisputeState.Filed || dispute.state == DisputeState.Evidence,
            "Evidence period already ended"
        );
        require(block.timestamp > dispute.evidenceDeadline, "Evidence deadline not passed");

        dispute.state = DisputeState.Ruling;

        emit EvidencePeriodEnded(disputeId);
    }

    /**
     * @dev Submit ruling (only assigned court)
     * @param disputeId ID of the dispute
     * @param liable Address of the liable party
     * @param restitutionAmount Amount of restitution owed
     * @param enforcementInstructions Instructions for enforcement
     */
    function submitRuling(
        uint256 disputeId,
        address liable,
        uint256 restitutionAmount,
        bytes calldata enforcementInstructions
    ) external {
        DisputeInfo storage dispute = _disputes[disputeId];
        require(dispute.id != 0, "Dispute does not exist");
        require(dispute.state == DisputeState.Ruling, "Not in ruling state");
        require(block.timestamp <= dispute.rulingDeadline, "Ruling deadline passed");

        // Verify caller is the assigned court operator
        CourtRegistry.CourtInfo memory court = courtRegistry.getCourt(dispute.courtId);
        require(msg.sender == court.operator, "Not the assigned court");

        require(
            liable == dispute.claimant || liable == dispute.respondent || liable == address(0),
            "Liable party not in dispute"
        );

        dispute.ruling = Ruling({
            liable: liable,
            restitutionAmount: restitutionAmount,
            enforcementInstructions: enforcementInstructions,
            exists: true
        });

        emit RulingSubmitted(disputeId, liable, restitutionAmount);
    }

    /**
     * @dev Finalize dispute after ruling
     * @param disputeId ID of the dispute
     */
    function finalizeDispute(uint256 disputeId) external {
        DisputeInfo storage dispute = _disputes[disputeId];
        require(dispute.id != 0, "Dispute does not exist");
        require(dispute.state == DisputeState.Ruling, "Not in ruling state");
        require(dispute.ruling.exists, "No ruling submitted");

        dispute.state = DisputeState.Finalized;

        // Mark contract as completed
        contractFactory.markCompleted(dispute.contractId);

        emit DisputeFinalized(disputeId);
    }

    /**
     * @dev Record compliance with ruling
     * @param disputeId ID of the dispute
     * @param complied Whether the liable party complied
     */
    function recordCompliance(uint256 disputeId, bool complied) external onlyRole(SYSTEM_ROLE) {
        DisputeInfo storage dispute = _disputes[disputeId];
        require(dispute.id != 0, "Dispute does not exist");
        require(dispute.state == DisputeState.Finalized, "Dispute not finalized");
        require(dispute.ruling.liable != address(0), "No liable party");

        reputationScoring.updateCompliance(dispute.ruling.liable, disputeId, complied);
    }

    /**
     * @dev Get dispute information
     * @param disputeId ID of the dispute
     * @return Dispute view struct
     */
    function getDispute(uint256 disputeId) external view returns (DisputeView memory) {
        DisputeInfo storage dispute = _disputes[disputeId];
        require(dispute.id != 0, "Dispute does not exist");

        return DisputeView({
            id: dispute.id,
            contractId: dispute.contractId,
            claimant: dispute.claimant,
            respondent: dispute.respondent,
            claim: dispute.claim,
            evidenceHashes: dispute.evidenceHashes,
            courtId: dispute.courtId,
            state: dispute.state,
            filedAt: dispute.filedAt,
            evidenceDeadline: dispute.evidenceDeadline,
            rulingDeadline: dispute.rulingDeadline,
            hasRuling: dispute.ruling.exists,
            liable: dispute.ruling.liable,
            restitutionAmount: dispute.ruling.restitutionAmount
        });
    }

    /**
     * @dev Get enforcement instructions for a dispute
     * @param disputeId ID of the dispute
     * @return Enforcement instructions bytes
     */
    function getEnforcementInstructions(uint256 disputeId) external view returns (bytes memory) {
        require(_disputes[disputeId].ruling.exists, "No ruling");
        return _disputes[disputeId].ruling.enforcementInstructions;
    }

    /**
     * @dev Get disputes for a contract
     * @param contractId ID of the contract
     * @return Array of dispute IDs
     */
    function getDisputesByContract(uint256 contractId) external view returns (uint256[] memory) {
        return _contractDisputes[contractId];
    }

    /**
     * @dev Get disputes involving a party
     * @param party Address of the party
     * @return Array of dispute IDs
     */
    function getDisputesByParty(address party) external view returns (uint256[] memory) {
        return _partyDisputes[party];
    }

    /**
     * @dev Get total number of disputes
     * @return Total dispute count
     */
    function totalDisputes() external view returns (uint256) {
        return _disputeCount;
    }
}
