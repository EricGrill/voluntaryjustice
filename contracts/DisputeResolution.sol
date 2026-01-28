// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./ContractFactory.sol";
import "./CourtRegistry.sol";
import "./ReputationScoring.sol";
import "./VJToken.sol";

/**
 * @title DisputeResolution
 * @dev Manages the dispute lifecycle from filing to ruling, including appeals
 */
contract DisputeResolution is AccessControl, ReentrancyGuard {
    bytes32 public constant SYSTEM_ROLE = keccak256("SYSTEM_ROLE");
    bytes32 public constant JUROR_POOL_ROLE = keccak256("JUROR_POOL_ROLE");

    enum DisputeState {
        Filed,
        Evidence,
        Ruling,
        Finalized,
        Appealed,
        JuryDeliberation,
        JuryVoting,
        AppealFinalized
    }

    struct Ruling {
        address liable;
        uint256 restitutionAmount;
        bytes enforcementInstructions;
        bool exists;
    }

    struct Appeal {
        bool exists;
        address appellant;
        uint256 stake;
        uint256 appealedAt;
        address[5] jury;
        mapping(address => bytes32) voteCommitments;
        mapping(address => bytes32) revealedVotes;
        uint256 votesRevealed;
        uint256 votingDeadline;
        Ruling appealRuling;
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
        uint256 appealDeadline;
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
    uint256 public constant APPEAL_PERIOD = 7 days;
    uint256 public constant JURY_VOTING_PERIOD = 5 days;
    uint256 public constant MIN_APPEAL_STAKE = 500 * 10**18; // 500 VJ tokens

    ContractFactory public contractFactory;
    CourtRegistry public courtRegistry;
    ReputationScoring public reputationScoring;
    VJToken public vjToken;
    address public jurorPool;

    mapping(uint256 => DisputeInfo) private _disputes;
    mapping(uint256 => Appeal) private _appeals;
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
    event AppealFiled(uint256 indexed disputeId, address indexed appellant, uint256 stake);
    event JuryAssigned(uint256 indexed disputeId, address[5] jury);
    event JuryVoteCommitted(uint256 indexed disputeId, address indexed juror);
    event JuryVoteRevealed(uint256 indexed disputeId, address indexed juror);
    event AppealRulingSubmitted(uint256 indexed disputeId, address liable);
    event AppealFinalized(uint256 indexed disputeId);

    constructor(
        address defaultAdmin,
        address _contractFactory,
        address _courtRegistry,
        address _reputationScoring,
        address _vjToken
    ) {
        require(_contractFactory != address(0), "Invalid contract factory");
        require(_courtRegistry != address(0), "Invalid court registry");
        require(_reputationScoring != address(0), "Invalid reputation scoring");
        require(_vjToken != address(0), "Invalid token address");

        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(SYSTEM_ROLE, defaultAdmin);

        contractFactory = ContractFactory(_contractFactory);
        courtRegistry = CourtRegistry(_courtRegistry);
        reputationScoring = ReputationScoring(_reputationScoring);
        vjToken = VJToken(_vjToken);
    }

    /**
     * @dev Set the juror pool address
     * @param _jurorPool Address of the juror pool contract
     */
    function setJurorPool(address _jurorPool) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_jurorPool != address(0), "Invalid juror pool");
        jurorPool = _jurorPool;
        _grantRole(JUROR_POOL_ROLE, _jurorPool);
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
     * @dev Finalize dispute after ruling (sets appeal deadline)
     * @param disputeId ID of the dispute
     */
    function finalizeDispute(uint256 disputeId) external {
        DisputeInfo storage dispute = _disputes[disputeId];
        require(dispute.id != 0, "Dispute does not exist");
        require(dispute.state == DisputeState.Ruling, "Not in ruling state");
        require(dispute.ruling.exists, "No ruling submitted");

        dispute.state = DisputeState.Finalized;
        dispute.appealDeadline = block.timestamp + APPEAL_PERIOD;

        emit DisputeFinalized(disputeId);
    }

    /**
     * @dev Finalize dispute permanently (after appeal deadline or appeal resolution)
     * @param disputeId ID of the dispute
     */
    function finalizeDisputePermanently(uint256 disputeId) external {
        DisputeInfo storage dispute = _disputes[disputeId];
        require(dispute.id != 0, "Dispute does not exist");
        require(
            dispute.state == DisputeState.Finalized || dispute.state == DisputeState.AppealFinalized,
            "Invalid state"
        );

        if (dispute.state == DisputeState.Finalized) {
            require(block.timestamp > dispute.appealDeadline, "Appeal period not ended");
        }

        // Mark contract as completed
        contractFactory.markCompleted(dispute.contractId);
    }

    /**
     * @dev File an appeal against a ruling
     * @param disputeId ID of the dispute
     * @param stake Amount to stake for appeal
     */
    function appeal(uint256 disputeId, uint256 stake) external nonReentrant {
        DisputeInfo storage dispute = _disputes[disputeId];
        require(dispute.id != 0, "Dispute does not exist");
        require(dispute.state == DisputeState.Finalized, "Dispute not finalized");
        require(block.timestamp <= dispute.appealDeadline, "Appeal deadline passed");
        require(stake >= MIN_APPEAL_STAKE, "Insufficient appeal stake");
        require(
            msg.sender == dispute.claimant || msg.sender == dispute.respondent,
            "Not a party to dispute"
        );

        Appeal storage appealInfo = _appeals[disputeId];
        require(!appealInfo.exists, "Appeal already filed");

        // Transfer stake
        require(vjToken.transferFrom(msg.sender, address(this), stake), "Stake transfer failed");

        appealInfo.exists = true;
        appealInfo.appellant = msg.sender;
        appealInfo.stake = stake;
        appealInfo.appealedAt = block.timestamp;

        dispute.state = DisputeState.Appealed;

        emit AppealFiled(disputeId, msg.sender, stake);
    }

    /**
     * @dev Assign jury to an appeal (called by JurorPool)
     * @param disputeId ID of the dispute
     * @param jury Array of 5 juror addresses
     */
    function assignJury(uint256 disputeId, address[5] calldata jury) external onlyRole(JUROR_POOL_ROLE) {
        DisputeInfo storage dispute = _disputes[disputeId];
        require(dispute.id != 0, "Dispute does not exist");
        require(dispute.state == DisputeState.Appealed, "Not in appealed state");

        Appeal storage appealInfo = _appeals[disputeId];
        appealInfo.jury = jury;
        appealInfo.votingDeadline = block.timestamp + JURY_VOTING_PERIOD;

        dispute.state = DisputeState.JuryDeliberation;

        emit JuryAssigned(disputeId, jury);
    }

    /**
     * @dev Submit encrypted jury vote commitment
     * @param disputeId ID of the dispute
     * @param voteCommitment Hash of vote + salt
     */
    function submitJuryVote(uint256 disputeId, bytes32 voteCommitment) external {
        DisputeInfo storage dispute = _disputes[disputeId];
        require(dispute.id != 0, "Dispute does not exist");
        require(
            dispute.state == DisputeState.JuryDeliberation || dispute.state == DisputeState.JuryVoting,
            "Not in voting state"
        );

        Appeal storage appealInfo = _appeals[disputeId];
        require(block.timestamp <= appealInfo.votingDeadline, "Voting deadline passed");
        require(_isJuror(appealInfo, msg.sender), "Not a juror");
        require(appealInfo.voteCommitments[msg.sender] == bytes32(0), "Already voted");

        appealInfo.voteCommitments[msg.sender] = voteCommitment;

        if (dispute.state == DisputeState.JuryDeliberation) {
            dispute.state = DisputeState.JuryVoting;
        }

        emit JuryVoteCommitted(disputeId, msg.sender);
    }

    /**
     * @dev Reveal jury vote
     * @param disputeId ID of the dispute
     * @param vote The vote (keccak256 of "claimant" or "respondent" or "none")
     * @param salt The salt used in commitment
     */
    function revealJuryVote(uint256 disputeId, bytes32 vote, bytes32 salt) external {
        DisputeInfo storage dispute = _disputes[disputeId];
        require(dispute.id != 0, "Dispute does not exist");
        require(dispute.state == DisputeState.JuryVoting, "Not in voting state");

        Appeal storage appealInfo = _appeals[disputeId];
        require(_isJuror(appealInfo, msg.sender), "Not a juror");
        require(appealInfo.voteCommitments[msg.sender] != bytes32(0), "No vote committed");
        require(appealInfo.revealedVotes[msg.sender] == bytes32(0), "Already revealed");

        // Verify commitment
        bytes32 commitment = keccak256(abi.encodePacked(vote, salt));
        require(commitment == appealInfo.voteCommitments[msg.sender], "Invalid vote reveal");

        appealInfo.revealedVotes[msg.sender] = vote;
        appealInfo.votesRevealed++;

        emit JuryVoteRevealed(disputeId, msg.sender);
    }

    /**
     * @dev Finalize appeal based on jury votes
     * @param disputeId ID of the dispute
     */
    function finalizeAppeal(uint256 disputeId) external {
        DisputeInfo storage dispute = _disputes[disputeId];
        require(dispute.id != 0, "Dispute does not exist");
        require(dispute.state == DisputeState.JuryVoting, "Not in voting state");

        Appeal storage appealInfo = _appeals[disputeId];
        require(
            appealInfo.votesRevealed >= 3 || block.timestamp > appealInfo.votingDeadline,
            "Voting not complete"
        );

        // Tally votes
        bytes32 claimantVote = keccak256(abi.encodePacked("claimant"));
        bytes32 respondentVote = keccak256(abi.encodePacked("respondent"));

        uint256 claimantVotes;
        uint256 respondentVotes;

        for (uint256 i = 0; i < 5; i++) {
            bytes32 vote = appealInfo.revealedVotes[appealInfo.jury[i]];
            if (vote == claimantVote) {
                claimantVotes++;
            } else if (vote == respondentVote) {
                respondentVotes++;
            }
        }

        // Determine outcome
        address newLiable;
        if (claimantVotes > respondentVotes) {
            newLiable = dispute.respondent; // Claimant wins, respondent liable
        } else if (respondentVotes > claimantVotes) {
            newLiable = dispute.claimant; // Respondent wins, claimant liable
        } else {
            newLiable = dispute.ruling.liable; // Tie, original ruling stands
        }

        appealInfo.appealRuling = Ruling({
            liable: newLiable,
            restitutionAmount: dispute.ruling.restitutionAmount,
            enforcementInstructions: dispute.ruling.enforcementInstructions,
            exists: true
        });

        dispute.state = DisputeState.AppealFinalized;

        // Return stake to appellant if they won
        if (newLiable != appealInfo.appellant && newLiable != address(0)) {
            vjToken.transfer(appealInfo.appellant, appealInfo.stake);
        }

        emit AppealFinalized(disputeId);
    }

    /**
     * @dev Check if address is a juror for an appeal
     */
    function _isJuror(Appeal storage appealInfo, address addr) internal view returns (bool) {
        for (uint256 i = 0; i < 5; i++) {
            if (appealInfo.jury[i] == addr) return true;
        }
        return false;
    }

    /**
     * @dev Get appeal information
     * @param disputeId ID of the dispute
     * @return appellant The appellant address
     * @return stake The appeal stake
     * @return appealedAt Timestamp of appeal
     * @return jury The jury addresses
     * @return votesRevealed Number of votes revealed
     * @return votingDeadline Deadline for voting
     */
    function getAppeal(uint256 disputeId) external view returns (
        address appellant,
        uint256 stake,
        uint256 appealedAt,
        address[5] memory jury,
        uint256 votesRevealed,
        uint256 votingDeadline
    ) {
        Appeal storage appealInfo = _appeals[disputeId];
        require(appealInfo.exists, "No appeal");
        return (
            appealInfo.appellant,
            appealInfo.stake,
            appealInfo.appealedAt,
            appealInfo.jury,
            appealInfo.votesRevealed,
            appealInfo.votingDeadline
        );
    }

    /**
     * @dev Check if dispute has an appeal
     * @param disputeId ID of the dispute
     * @return Whether appeal exists
     */
    function hasAppeal(uint256 disputeId) external view returns (bool) {
        return _appeals[disputeId].exists;
    }

    /**
     * @dev Get final ruling (considering appeal if exists)
     * @param disputeId ID of the dispute
     * @return liable The liable party
     * @return restitutionAmount The restitution amount
     */
    function getFinalRuling(uint256 disputeId) external view returns (address liable, uint256 restitutionAmount) {
        DisputeInfo storage dispute = _disputes[disputeId];
        require(dispute.id != 0, "Dispute does not exist");

        Appeal storage appealInfo = _appeals[disputeId];
        if (appealInfo.appealRuling.exists) {
            return (appealInfo.appealRuling.liable, appealInfo.appealRuling.restitutionAmount);
        }
        return (dispute.ruling.liable, dispute.ruling.restitutionAmount);
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
