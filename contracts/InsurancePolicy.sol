// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./VJToken.sol";
import "./InsurerRegistry.sol";
import "./DisputeResolution.sol";

/**
 * @title InsurancePolicy
 * @dev Manages individual insurance policies between users and insurers
 */
contract InsurancePolicy is AccessControl, ReentrancyGuard {
    bytes32 public constant CLAIMS_ROLE = keccak256("CLAIMS_ROLE");

    enum PolicyStatus {
        Active,
        Expired,
        Cancelled,
        ClaimFiled,
        ClaimPaid
    }

    struct PolicyInfo {
        uint256 id;
        uint256 insurerId;
        address policyholder;
        uint256 coverage;
        uint256 premium;
        uint256 startTime;
        uint256 endTime;
        PolicyStatus status;
        uint256 claimAmount;
    }

    VJToken public vjToken;
    InsurerRegistry public insurerRegistry;
    DisputeResolution public disputeResolution;

    mapping(uint256 => PolicyInfo) private _policies;
    mapping(address => uint256[]) private _holderPolicies;
    mapping(uint256 => uint256[]) private _insurerPolicies;
    uint256 private _policyCount;

    // Events
    event PolicyPurchased(
        uint256 indexed policyId,
        uint256 indexed insurerId,
        address indexed policyholder,
        uint256 coverage,
        uint256 duration
    );
    event PolicyRenewed(uint256 indexed policyId, uint256 newEndTime);
    event PolicyCancelled(uint256 indexed policyId);
    event ClaimFiled(uint256 indexed policyId, uint256 rulingId);
    event ClaimPaid(uint256 indexed policyId, uint256 amount);

    constructor(
        address defaultAdmin,
        address _vjToken,
        address _insurerRegistry,
        address _disputeResolution
    ) {
        require(_vjToken != address(0), "Invalid token address");
        require(_insurerRegistry != address(0), "Invalid insurer registry");
        require(_disputeResolution != address(0), "Invalid dispute resolution");

        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(CLAIMS_ROLE, defaultAdmin);

        vjToken = VJToken(_vjToken);
        insurerRegistry = InsurerRegistry(_insurerRegistry);
        disputeResolution = DisputeResolution(_disputeResolution);
    }

    /**
     * @dev Purchase an insurance policy
     * @param insurerId ID of the insurer
     * @param coverage Desired coverage amount
     * @param duration Policy duration in seconds
     * @return policyId The ID of the purchased policy
     */
    function purchasePolicy(
        uint256 insurerId,
        uint256 coverage,
        uint256 duration
    ) external nonReentrant returns (uint256 policyId) {
        require(coverage > 0, "Coverage must be positive");
        require(duration > 0, "Duration must be positive");

        InsurerRegistry.InsurerInfo memory insurer = insurerRegistry.getInsurer(insurerId);
        require(insurer.active, "Insurer not active");

        // Calculate premium (simplified: 1% of coverage per month)
        uint256 premium = (coverage * duration) / (30 days * 100);
        require(premium > 0, "Premium too low");

        require(vjToken.transferFrom(msg.sender, insurer.operator, premium), "Premium transfer failed");

        _policyCount++;
        policyId = _policyCount;

        _policies[policyId] = PolicyInfo({
            id: policyId,
            insurerId: insurerId,
            policyholder: msg.sender,
            coverage: coverage,
            premium: premium,
            startTime: block.timestamp,
            endTime: block.timestamp + duration,
            status: PolicyStatus.Active,
            claimAmount: 0
        });

        _holderPolicies[msg.sender].push(policyId);
        _insurerPolicies[insurerId].push(policyId);

        // Record policy in registry
        insurerRegistry.recordPolicy(insurerId);

        emit PolicyPurchased(policyId, insurerId, msg.sender, coverage, duration);
    }

    /**
     * @dev Renew an existing policy
     * @param policyId ID of the policy to renew
     */
    function renewPolicy(uint256 policyId) external nonReentrant {
        PolicyInfo storage policy = _policies[policyId];
        require(policy.id != 0, "Policy does not exist");
        require(msg.sender == policy.policyholder, "Not policyholder");
        require(
            policy.status == PolicyStatus.Active || policy.status == PolicyStatus.Expired,
            "Cannot renew policy"
        );

        InsurerRegistry.InsurerInfo memory insurer = insurerRegistry.getInsurer(policy.insurerId);
        require(insurer.active, "Insurer not active");

        // Calculate renewal duration (same as original)
        uint256 duration = policy.endTime - policy.startTime;
        uint256 premium = (policy.coverage * duration) / (30 days * 100);

        require(vjToken.transferFrom(msg.sender, insurer.operator, premium), "Premium transfer failed");

        policy.endTime = block.timestamp + duration;
        policy.status = PolicyStatus.Active;
        policy.premium += premium;

        emit PolicyRenewed(policyId, policy.endTime);
    }

    /**
     * @dev Cancel a policy
     * @param policyId ID of the policy to cancel
     */
    function cancelPolicy(uint256 policyId) external {
        PolicyInfo storage policy = _policies[policyId];
        require(policy.id != 0, "Policy does not exist");
        require(msg.sender == policy.policyholder, "Not policyholder");
        require(policy.status == PolicyStatus.Active, "Policy not active");

        policy.status = PolicyStatus.Cancelled;

        emit PolicyCancelled(policyId);
    }

    /**
     * @dev File a claim on a policy
     * @param policyId ID of the policy
     * @param rulingId ID of the ruling supporting the claim
     */
    function fileClaim(uint256 policyId, uint256 rulingId) external {
        PolicyInfo storage policy = _policies[policyId];
        require(policy.id != 0, "Policy does not exist");
        require(msg.sender == policy.policyholder, "Not policyholder");
        require(policy.status == PolicyStatus.Active, "Policy not active");
        require(block.timestamp <= policy.endTime, "Policy expired");

        // Verify ruling
        DisputeResolution.DisputeView memory dispute = disputeResolution.getDispute(rulingId);
        require(dispute.state == DisputeResolution.DisputeState.Finalized, "Dispute not finalized");
        require(dispute.hasRuling, "No ruling");
        require(dispute.liable != msg.sender, "Claimant is liable party");

        policy.status = PolicyStatus.ClaimFiled;
        policy.claimAmount = dispute.restitutionAmount > policy.coverage 
            ? policy.coverage 
            : dispute.restitutionAmount;

        emit ClaimFiled(policyId, rulingId);
    }

    /**
     * @dev Process and pay a claim
     * @param policyId ID of the policy with filed claim
     */
    function processClaim(uint256 policyId) external onlyRole(CLAIMS_ROLE) nonReentrant {
        PolicyInfo storage policy = _policies[policyId];
        require(policy.id != 0, "Policy does not exist");
        require(policy.status == PolicyStatus.ClaimFiled, "No claim filed");

        InsurerRegistry.InsurerInfo memory insurer = insurerRegistry.getInsurer(policy.insurerId);

        // Transfer claim amount from insurer to policyholder
        require(
            vjToken.transferFrom(insurer.operator, policy.policyholder, policy.claimAmount),
            "Claim transfer failed"
        );

        policy.status = PolicyStatus.ClaimPaid;

        // Record claim in registry
        insurerRegistry.recordClaim(policy.insurerId, policy.claimAmount);

        emit ClaimPaid(policyId, policy.claimAmount);
    }

    /**
     * @dev Get policy information
     * @param policyId ID of the policy
     * @return Policy information
     */
    function getPolicy(uint256 policyId) external view returns (PolicyInfo memory) {
        require(_policies[policyId].id != 0, "Policy does not exist");
        return _policies[policyId];
    }

    /**
     * @dev Get policies for a policyholder
     * @param holder Address of the policyholder
     * @return Array of policy IDs
     */
    function getPoliciesByHolder(address holder) external view returns (uint256[] memory) {
        return _holderPolicies[holder];
    }

    /**
     * @dev Get policies for an insurer
     * @param insurerId ID of the insurer
     * @return Array of policy IDs
     */
    function getPoliciesByInsurer(uint256 insurerId) external view returns (uint256[] memory) {
        return _insurerPolicies[insurerId];
    }

    /**
     * @dev Check if a policy is currently valid
     * @param policyId ID of the policy
     * @return Whether policy is valid
     */
    function isPolicyValid(uint256 policyId) external view returns (bool) {
        PolicyInfo storage policy = _policies[policyId];
        return policy.status == PolicyStatus.Active && block.timestamp <= policy.endTime;
    }

    /**
     * @dev Get total number of policies
     * @return Total policy count
     */
    function totalPolicies() external view returns (uint256) {
        return _policyCount;
    }
}
