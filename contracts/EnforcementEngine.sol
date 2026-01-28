// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./DisputeResolution.sol";
import "./EscrowVault.sol";
import "./ReputationScoring.sol";
import "./BaselineInsurancePool.sol";

/**
 * @title EnforcementEngine
 * @dev Executes rulings and manages enforcement actions
 */
contract EnforcementEngine is AccessControl, ReentrancyGuard {
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");

    enum EnforcementStatus {
        Pending,
        InProgress,
        Completed,
        Failed,
        Appealed
    }

    struct EnforcementAction {
        uint256 id;
        uint256 disputeId;
        address liable;
        address beneficiary;
        uint256 restitutionAmount;
        uint256 amountCollected;
        EnforcementStatus status;
        uint256 createdAt;
        uint256 completedAt;
        bool insuranceClaimed;
    }

    DisputeResolution public disputeResolution;
    EscrowVault public escrowVault;
    ReputationScoring public reputationScoring;
    BaselineInsurancePool public insurancePool;

    mapping(uint256 => EnforcementAction) private _actions;
    mapping(uint256 => uint256) private _disputeToAction;
    uint256 private _actionCount;

    // Events
    event EnforcementCreated(uint256 indexed actionId, uint256 indexed disputeId);
    event EnforcementProgress(uint256 indexed actionId, uint256 amountCollected);
    event EnforcementCompleted(uint256 indexed actionId);
    event EnforcementFailed(uint256 indexed actionId, string reason);
    event InsuranceClaimTriggered(uint256 indexed actionId);
    event EnforcementAppealed(uint256 indexed actionId);

    constructor(
        address defaultAdmin,
        address _disputeResolution,
        address _escrowVault,
        address _reputationScoring,
        address _insurancePool
    ) {
        require(_disputeResolution != address(0), "Invalid dispute resolution");
        require(_escrowVault != address(0), "Invalid escrow vault");
        require(_reputationScoring != address(0), "Invalid reputation scoring");
        require(_insurancePool != address(0), "Invalid insurance pool");

        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(EXECUTOR_ROLE, defaultAdmin);

        disputeResolution = DisputeResolution(_disputeResolution);
        escrowVault = EscrowVault(_escrowVault);
        reputationScoring = ReputationScoring(_reputationScoring);
        insurancePool = BaselineInsurancePool(_insurancePool);
    }

    /**
     * @dev Create enforcement action from finalized dispute
     * @param disputeId ID of the finalized dispute
     * @return actionId The ID of the created action
     */
    function createEnforcement(uint256 disputeId) external returns (uint256 actionId) {
        require(_disputeToAction[disputeId] == 0, "Enforcement already exists");

        DisputeResolution.DisputeView memory dispute = disputeResolution.getDispute(disputeId);
        require(dispute.state == DisputeResolution.DisputeState.Finalized, "Dispute not finalized");
        require(dispute.hasRuling, "No ruling");
        require(dispute.liable != address(0), "No liable party");

        _actionCount++;
        actionId = _actionCount;

        // Determine beneficiary (the non-liable party)
        address beneficiary = dispute.liable == dispute.claimant 
            ? dispute.respondent 
            : dispute.claimant;

        _actions[actionId] = EnforcementAction({
            id: actionId,
            disputeId: disputeId,
            liable: dispute.liable,
            beneficiary: beneficiary,
            restitutionAmount: dispute.restitutionAmount,
            amountCollected: 0,
            status: EnforcementStatus.Pending,
            createdAt: block.timestamp,
            completedAt: 0,
            insuranceClaimed: false
        });

        _disputeToAction[disputeId] = actionId;

        emit EnforcementCreated(actionId, disputeId);
    }

    /**
     * @dev Execute enforcement by releasing escrow
     * @param actionId ID of the enforcement action
     */
    function executeFromEscrow(uint256 actionId) external onlyRole(EXECUTOR_ROLE) nonReentrant {
        EnforcementAction storage action = _actions[actionId];
        require(action.id != 0, "Action does not exist");
        require(
            action.status == EnforcementStatus.Pending || action.status == EnforcementStatus.InProgress,
            "Cannot execute"
        );

        DisputeResolution.DisputeView memory dispute = disputeResolution.getDispute(action.disputeId);
        uint256 escrowBalance = escrowVault.getBalance(dispute.contractId);

        if (escrowBalance > 0) {
            uint256 releaseAmount = escrowBalance > action.restitutionAmount - action.amountCollected
                ? action.restitutionAmount - action.amountCollected
                : escrowBalance;

            escrowVault.release(dispute.contractId, action.beneficiary, releaseAmount);
            action.amountCollected += releaseAmount;
            action.status = EnforcementStatus.InProgress;

            emit EnforcementProgress(actionId, action.amountCollected);
        }

        // Check if fully collected
        if (action.amountCollected >= action.restitutionAmount) {
            _completeEnforcement(actionId);
        }
    }

    /**
     * @dev Record voluntary payment from liable party
     * @param actionId ID of the enforcement action
     * @param amount Amount paid
     */
    function recordPayment(uint256 actionId, uint256 amount) external onlyRole(EXECUTOR_ROLE) {
        EnforcementAction storage action = _actions[actionId];
        require(action.id != 0, "Action does not exist");
        require(
            action.status == EnforcementStatus.Pending || action.status == EnforcementStatus.InProgress,
            "Cannot record payment"
        );

        action.amountCollected += amount;
        action.status = EnforcementStatus.InProgress;

        // Record compliance
        disputeResolution.recordCompliance(action.disputeId, true);

        emit EnforcementProgress(actionId, action.amountCollected);

        if (action.amountCollected >= action.restitutionAmount) {
            _completeEnforcement(actionId);
        }
    }

    /**
     * @dev Trigger insurance claim when enforcement fails
     * @param actionId ID of the enforcement action
     */
    function triggerInsuranceClaim(uint256 actionId) external onlyRole(EXECUTOR_ROLE) {
        EnforcementAction storage action = _actions[actionId];
        require(action.id != 0, "Action does not exist");
        require(!action.insuranceClaimed, "Insurance already claimed");
        require(
            action.status == EnforcementStatus.InProgress || action.status == EnforcementStatus.Failed,
            "Invalid status for insurance"
        );

        action.insuranceClaimed = true;

        // Record non-compliance
        disputeResolution.recordCompliance(action.disputeId, false);

        emit InsuranceClaimTriggered(actionId);
    }

    /**
     * @dev Mark enforcement as appealed
     * @param actionId ID of the enforcement action
     */
    function markAppealed(uint256 actionId) external onlyRole(EXECUTOR_ROLE) {
        EnforcementAction storage action = _actions[actionId];
        require(action.id != 0, "Action does not exist");
        require(
            action.status == EnforcementStatus.Pending || action.status == EnforcementStatus.InProgress,
            "Cannot appeal"
        );

        action.status = EnforcementStatus.Appealed;

        emit EnforcementAppealed(actionId);
    }

    /**
     * @dev Mark enforcement as failed
     * @param actionId ID of the enforcement action
     * @param reason Reason for failure
     */
    function markFailed(uint256 actionId, string calldata reason) external onlyRole(EXECUTOR_ROLE) {
        EnforcementAction storage action = _actions[actionId];
        require(action.id != 0, "Action does not exist");
        require(action.status != EnforcementStatus.Completed, "Already completed");

        action.status = EnforcementStatus.Failed;

        // Record non-compliance
        disputeResolution.recordCompliance(action.disputeId, false);

        emit EnforcementFailed(actionId, reason);
    }

    /**
     * @dev Get enforcement action information
     * @param actionId ID of the action
     * @return Enforcement action information
     */
    function getAction(uint256 actionId) external view returns (EnforcementAction memory) {
        require(_actions[actionId].id != 0, "Action does not exist");
        return _actions[actionId];
    }

    /**
     * @dev Get enforcement action for a dispute
     * @param disputeId ID of the dispute
     * @return actionId Enforcement action ID (0 if none)
     */
    function getActionByDispute(uint256 disputeId) external view returns (uint256) {
        return _disputeToAction[disputeId];
    }

    /**
     * @dev Get total number of enforcement actions
     * @return Total action count
     */
    function totalActions() external view returns (uint256) {
        return _actionCount;
    }

    /**
     * @dev Internal function to complete enforcement
     */
    function _completeEnforcement(uint256 actionId) internal {
        EnforcementAction storage action = _actions[actionId];
        action.status = EnforcementStatus.Completed;
        action.completedAt = block.timestamp;

        emit EnforcementCompleted(actionId);
    }
}
