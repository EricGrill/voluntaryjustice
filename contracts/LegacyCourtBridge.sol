// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title LegacyCourtBridge
 * @dev Bridge between traditional legal system judgments and on-chain enforcement
 */
contract LegacyCourtBridge is AccessControl, ReentrancyGuard {
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");

    uint256 public constant CHALLENGE_PERIOD = 7 days;

    enum JudgmentStatus {
        Pending,
        Verified,
        Challenged,
        Rejected,
        Finalized
    }

    struct Jurisdiction {
        uint256 id;
        string name;
        bytes32 verificationKey;
        bool active;
        uint256 submissionsProcessed;
    }

    struct JudgmentSubmission {
        uint256 id;
        uint256 bountyId;
        uint256 jurisdictionId;
        address submitter;
        bytes32 judgmentHash;
        bytes judgmentData;
        JudgmentStatus status;
        uint256 submittedAt;
        uint256 challengeDeadline;
        uint256 finalizedAt;
        string challengeReason;
    }

    mapping(uint256 => Jurisdiction) private _jurisdictions;
    mapping(bytes32 => uint256) private _jurisdictionByKey;
    uint256[] private _activeJurisdictionIds;
    uint256 private _jurisdictionCount;

    mapping(uint256 => JudgmentSubmission) private _submissions;
    mapping(uint256 => uint256[]) private _bountySubmissions;
    uint256 private _submissionCount;

    // Events
    event JurisdictionRegistered(uint256 indexed jurisdictionId, string name, bytes32 verificationKey);
    event JurisdictionDeactivated(uint256 indexed jurisdictionId);
    event JurisdictionReactivated(uint256 indexed jurisdictionId);
    event JudgmentSubmitted(uint256 indexed submissionId, uint256 indexed bountyId, uint256 indexed jurisdictionId);
    event JudgmentVerified(uint256 indexed submissionId);
    event JudgmentChallenged(uint256 indexed submissionId, string reason);
    event JudgmentRejected(uint256 indexed submissionId, string reason);
    event JudgmentFinalized(uint256 indexed submissionId);

    constructor(address defaultAdmin) {
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(GOVERNANCE_ROLE, defaultAdmin);
        _grantRole(VERIFIER_ROLE, defaultAdmin);
    }

    /**
     * @dev Register a new jurisdiction
     * @param name Jurisdiction name
     * @param verificationKey Key used to verify judgments from this jurisdiction
     * @return jurisdictionId ID of the registered jurisdiction
     */
    function registerJurisdiction(
        string calldata name,
        bytes32 verificationKey
    ) external onlyRole(GOVERNANCE_ROLE) returns (uint256 jurisdictionId) {
        require(bytes(name).length > 0, "Name required");
        require(verificationKey != bytes32(0), "Verification key required");
        require(_jurisdictionByKey[verificationKey] == 0, "Verification key already used");

        _jurisdictionCount++;
        jurisdictionId = _jurisdictionCount;

        _jurisdictions[jurisdictionId] = Jurisdiction({
            id: jurisdictionId,
            name: name,
            verificationKey: verificationKey,
            active: true,
            submissionsProcessed: 0
        });

        _jurisdictionByKey[verificationKey] = jurisdictionId;
        _activeJurisdictionIds.push(jurisdictionId);

        emit JurisdictionRegistered(jurisdictionId, name, verificationKey);
    }

    /**
     * @dev Deactivate a jurisdiction
     * @param jurisdictionId ID of the jurisdiction
     */
    function deactivateJurisdiction(uint256 jurisdictionId) external onlyRole(GOVERNANCE_ROLE) {
        Jurisdiction storage jurisdiction = _jurisdictions[jurisdictionId];
        require(jurisdiction.id != 0, "Jurisdiction does not exist");
        require(jurisdiction.active, "Already inactive");

        jurisdiction.active = false;
        _removeFromActiveList(jurisdictionId);

        emit JurisdictionDeactivated(jurisdictionId);
    }

    /**
     * @dev Reactivate a jurisdiction
     * @param jurisdictionId ID of the jurisdiction
     */
    function reactivateJurisdiction(uint256 jurisdictionId) external onlyRole(GOVERNANCE_ROLE) {
        Jurisdiction storage jurisdiction = _jurisdictions[jurisdictionId];
        require(jurisdiction.id != 0, "Jurisdiction does not exist");
        require(!jurisdiction.active, "Already active");

        jurisdiction.active = true;
        _activeJurisdictionIds.push(jurisdictionId);

        emit JurisdictionReactivated(jurisdictionId);
    }

    /**
     * @dev Submit a judgment from a traditional court
     * @param bountyId ID of the bounty this judgment relates to
     * @param judgmentData Encoded judgment data
     * @param jurisdictionId ID of the jurisdiction
     * @return submissionId ID of the submission
     */
    function submitJudgment(
        uint256 bountyId,
        bytes calldata judgmentData,
        uint256 jurisdictionId
    ) external returns (uint256 submissionId) {
        Jurisdiction storage jurisdiction = _jurisdictions[jurisdictionId];
        require(jurisdiction.id != 0, "Jurisdiction does not exist");
        require(jurisdiction.active, "Jurisdiction not active");
        require(judgmentData.length > 0, "Judgment data required");

        _submissionCount++;
        submissionId = _submissionCount;

        bytes32 judgmentHash = keccak256(judgmentData);

        _submissions[submissionId] = JudgmentSubmission({
            id: submissionId,
            bountyId: bountyId,
            jurisdictionId: jurisdictionId,
            submitter: msg.sender,
            judgmentHash: judgmentHash,
            judgmentData: judgmentData,
            status: JudgmentStatus.Pending,
            submittedAt: block.timestamp,
            challengeDeadline: 0,
            finalizedAt: 0,
            challengeReason: ""
        });

        _bountySubmissions[bountyId].push(submissionId);

        emit JudgmentSubmitted(submissionId, bountyId, jurisdictionId);
    }

    /**
     * @dev Verify a judgment submission
     * @param submissionId ID of the submission
     */
    function verifyJudgment(uint256 submissionId) external onlyRole(VERIFIER_ROLE) {
        JudgmentSubmission storage submission = _submissions[submissionId];
        require(submission.id != 0, "Submission does not exist");
        require(submission.status == JudgmentStatus.Pending, "Invalid status");

        submission.status = JudgmentStatus.Verified;
        submission.challengeDeadline = block.timestamp + CHALLENGE_PERIOD;

        Jurisdiction storage jurisdiction = _jurisdictions[submission.jurisdictionId];
        jurisdiction.submissionsProcessed++;

        emit JudgmentVerified(submissionId);
    }

    /**
     * @dev Challenge a verified judgment
     * @param submissionId ID of the submission
     * @param reason Reason for the challenge
     */
    function challengeJudgment(uint256 submissionId, string calldata reason) external {
        JudgmentSubmission storage submission = _submissions[submissionId];
        require(submission.id != 0, "Submission does not exist");
        require(submission.status == JudgmentStatus.Verified, "Not in verified status");
        require(block.timestamp <= submission.challengeDeadline, "Challenge period ended");
        require(bytes(reason).length > 0, "Reason required");

        submission.status = JudgmentStatus.Challenged;
        submission.challengeReason = reason;

        emit JudgmentChallenged(submissionId, reason);
    }

    /**
     * @dev Reject a challenged judgment
     * @param submissionId ID of the submission
     * @param reason Reason for rejection
     */
    function rejectJudgment(
        uint256 submissionId,
        string calldata reason
    ) external onlyRole(VERIFIER_ROLE) {
        JudgmentSubmission storage submission = _submissions[submissionId];
        require(submission.id != 0, "Submission does not exist");
        require(
            submission.status == JudgmentStatus.Pending ||
            submission.status == JudgmentStatus.Challenged,
            "Cannot reject"
        );
        require(bytes(reason).length > 0, "Reason required");

        submission.status = JudgmentStatus.Rejected;

        emit JudgmentRejected(submissionId, reason);
    }

    /**
     * @dev Finalize a verified judgment after challenge period
     * @param submissionId ID of the submission
     */
    function finalizeJudgment(uint256 submissionId) external {
        JudgmentSubmission storage submission = _submissions[submissionId];
        require(submission.id != 0, "Submission does not exist");
        require(submission.status == JudgmentStatus.Verified, "Not in verified status");
        require(block.timestamp > submission.challengeDeadline, "Challenge period not ended");

        submission.status = JudgmentStatus.Finalized;
        submission.finalizedAt = block.timestamp;

        emit JudgmentFinalized(submissionId);
    }

    /**
     * @dev Resolve a challenge in favor of the judgment
     * @param submissionId ID of the submission
     */
    function resolveChallenge(uint256 submissionId) external onlyRole(VERIFIER_ROLE) {
        JudgmentSubmission storage submission = _submissions[submissionId];
        require(submission.id != 0, "Submission does not exist");
        require(submission.status == JudgmentStatus.Challenged, "Not challenged");

        submission.status = JudgmentStatus.Verified;
        submission.challengeDeadline = block.timestamp + CHALLENGE_PERIOD;
        submission.challengeReason = "";

        emit JudgmentVerified(submissionId);
    }

    /**
     * @dev Get jurisdiction information
     * @param jurisdictionId ID of the jurisdiction
     * @return Jurisdiction information
     */
    function getJurisdiction(uint256 jurisdictionId) external view returns (Jurisdiction memory) {
        require(_jurisdictions[jurisdictionId].id != 0, "Jurisdiction does not exist");
        return _jurisdictions[jurisdictionId];
    }

    /**
     * @dev List all active jurisdictions
     * @return Array of jurisdiction information
     */
    function listActiveJurisdictions() external view returns (Jurisdiction[] memory) {
        Jurisdiction[] memory result = new Jurisdiction[](_activeJurisdictionIds.length);
        for (uint256 i = 0; i < _activeJurisdictionIds.length; i++) {
            result[i] = _jurisdictions[_activeJurisdictionIds[i]];
        }
        return result;
    }

    /**
     * @dev Get judgment submission information
     * @param submissionId ID of the submission
     * @return Judgment submission information
     */
    function getJudgment(uint256 submissionId) external view returns (JudgmentSubmission memory) {
        require(_submissions[submissionId].id != 0, "Submission does not exist");
        return _submissions[submissionId];
    }

    /**
     * @dev Get submissions for a bounty
     * @param bountyId ID of the bounty
     * @return Array of submission IDs
     */
    function getSubmissionsByBounty(uint256 bountyId) external view returns (uint256[] memory) {
        return _bountySubmissions[bountyId];
    }

    /**
     * @dev Check if a judgment is finalized
     * @param submissionId ID of the submission
     * @return Whether the judgment is finalized
     */
    function isJudgmentFinalized(uint256 submissionId) external view returns (bool) {
        return _submissions[submissionId].status == JudgmentStatus.Finalized;
    }

    /**
     * @dev Check if a bounty has a finalized judgment
     * @param bountyId ID of the bounty
     * @return Whether the bounty has a finalized judgment
     */
    function hasFinalizedJudgment(uint256 bountyId) external view returns (bool) {
        uint256[] storage submissions = _bountySubmissions[bountyId];
        for (uint256 i = 0; i < submissions.length; i++) {
            if (_submissions[submissions[i]].status == JudgmentStatus.Finalized) {
                return true;
            }
        }
        return false;
    }

    /**
     * @dev Get total number of jurisdictions
     * @return Total jurisdiction count
     */
    function totalJurisdictions() external view returns (uint256) {
        return _jurisdictionCount;
    }

    /**
     * @dev Get number of active jurisdictions
     * @return Active jurisdiction count
     */
    function activeJurisdictionCount() external view returns (uint256) {
        return _activeJurisdictionIds.length;
    }

    /**
     * @dev Get total number of submissions
     * @return Total submission count
     */
    function totalSubmissions() external view returns (uint256) {
        return _submissionCount;
    }

    /**
     * @dev Remove jurisdiction from active list
     */
    function _removeFromActiveList(uint256 jurisdictionId) internal {
        for (uint256 i = 0; i < _activeJurisdictionIds.length; i++) {
            if (_activeJurisdictionIds[i] == jurisdictionId) {
                _activeJurisdictionIds[i] = _activeJurisdictionIds[_activeJurisdictionIds.length - 1];
                _activeJurisdictionIds.pop();
                break;
            }
        }
    }
}
