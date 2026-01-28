// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./VJToken.sol";
import "./DisputeResolution.sol";

/**
 * @title BaselineInsurancePool
 * @dev Community insurance pool providing baseline coverage for all participants
 */
contract BaselineInsurancePool is AccessControl, ReentrancyGuard {
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    bytes32 public constant CLAIMS_ROLE = keccak256("CLAIMS_ROLE");

    uint256 public constant MIN_RESERVE_RATIO = 2000; // 20% in basis points
    uint256 public constant MAX_COVERAGE_RATIO = 5000; // 50% of pool per claim

    enum ClaimStatus {
        Filed,
        Approved,
        Rejected,
        Paid
    }

    struct CoverageInfo {
        uint256 totalContribution;
        uint256 coverageLimit;
        uint256 claimsPaid;
        bool active;
    }

    struct Claim {
        uint256 id;
        address claimant;
        uint256 rulingId;
        uint256 amount;
        ClaimStatus status;
        uint256 filedAt;
        uint256 processedAt;
    }

    VJToken public vjToken;
    DisputeResolution public disputeResolution;

    mapping(address => CoverageInfo) private _coverage;
    mapping(uint256 => Claim) private _claims;
    uint256 private _claimCount;

    uint256 public totalReserves;
    uint256 public totalObligations;
    uint256 public totalClaimsPaid;

    // Events
    event Deposited(address indexed depositor, uint256 amount);
    event Withdrawn(address indexed depositor, uint256 amount);
    event ClaimFiled(uint256 indexed claimId, address indexed claimant, uint256 rulingId);
    event ClaimProcessed(uint256 indexed claimId, ClaimStatus status, uint256 amount);

    constructor(
        address defaultAdmin,
        address _vjToken,
        address _disputeResolution
    ) {
        require(_vjToken != address(0), "Invalid token address");
        require(_disputeResolution != address(0), "Invalid dispute resolution");

        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(GOVERNANCE_ROLE, defaultAdmin);
        _grantRole(CLAIMS_ROLE, defaultAdmin);

        vjToken = VJToken(_vjToken);
        disputeResolution = DisputeResolution(_disputeResolution);
    }

    /**
     * @dev Deposit tokens to the insurance pool
     * @param amount Amount to deposit
     */
    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be positive");

        require(vjToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        CoverageInfo storage coverage = _coverage[msg.sender];
        coverage.totalContribution += amount;
        coverage.coverageLimit = coverage.totalContribution * 10; // 10x coverage
        coverage.active = true;

        totalReserves += amount;
        // Note: totalObligations tracks pending claims, not coverage limits

        emit Deposited(msg.sender, amount);
    }

    /**
     * @dev Withdraw tokens from the pool (subject to reserve requirements)
     * @param amount Amount to withdraw
     */
    function withdraw(uint256 amount) external nonReentrant {
        CoverageInfo storage coverage = _coverage[msg.sender];
        require(coverage.totalContribution >= amount, "Insufficient contribution");

        // Check reserve ratio after withdrawal (ensures enough for pending claims)
        uint256 newReserves = totalReserves - amount;
        if (totalObligations > 0) {
            require(
                newReserves * 10000 >= totalObligations * MIN_RESERVE_RATIO,
                "Would breach reserve ratio"
            );
        }

        coverage.totalContribution -= amount;
        coverage.coverageLimit = coverage.totalContribution * 10;
        if (coverage.totalContribution == 0) {
            coverage.active = false;
        }

        totalReserves -= amount;

        require(vjToken.transfer(msg.sender, amount), "Transfer failed");

        emit Withdrawn(msg.sender, amount);
    }

    /**
     * @dev File a claim based on a ruling
     * @param rulingId ID of the finalized ruling
     */
    function fileClaim(uint256 rulingId) external {
        CoverageInfo storage coverage = _coverage[msg.sender];
        require(coverage.active, "No active coverage");

        // Verify ruling exists and claimant is the winning party
        DisputeResolution.DisputeView memory dispute = disputeResolution.getDispute(rulingId);
        require(dispute.state == DisputeResolution.DisputeState.Finalized, "Dispute not finalized");
        require(dispute.hasRuling, "No ruling");
        require(
            msg.sender == dispute.claimant || msg.sender == dispute.respondent,
            "Not a party to dispute"
        );
        require(dispute.liable != msg.sender, "Claimant is liable party");

        _claimCount++;
        uint256 claimId = _claimCount;

        // Calculate claim amount (limited by coverage and pool)
        uint256 maxClaim = totalReserves * MAX_COVERAGE_RATIO / 10000;
        uint256 claimAmount = dispute.restitutionAmount;
        if (claimAmount > coverage.coverageLimit - coverage.claimsPaid) {
            claimAmount = coverage.coverageLimit - coverage.claimsPaid;
        }
        if (claimAmount > maxClaim) {
            claimAmount = maxClaim;
        }

        _claims[claimId] = Claim({
            id: claimId,
            claimant: msg.sender,
            rulingId: rulingId,
            amount: claimAmount,
            status: ClaimStatus.Filed,
            filedAt: block.timestamp,
            processedAt: 0
        });

        // Track as pending obligation
        totalObligations += claimAmount;

        emit ClaimFiled(claimId, msg.sender, rulingId);
    }

    /**
     * @dev Process a filed claim
     * @param claimId ID of the claim to process
     * @param approve Whether to approve the claim
     */
    function processClaim(uint256 claimId, bool approve) external onlyRole(CLAIMS_ROLE) nonReentrant {
        Claim storage claim = _claims[claimId];
        require(claim.id != 0, "Claim does not exist");
        require(claim.status == ClaimStatus.Filed, "Claim already processed");

        claim.processedAt = block.timestamp;

        // Remove from pending obligations
        totalObligations -= claim.amount;

        if (approve) {
            claim.status = ClaimStatus.Approved;

            // Update coverage
            CoverageInfo storage coverage = _coverage[claim.claimant];
            coverage.claimsPaid += claim.amount;

            totalReserves -= claim.amount;
            totalClaimsPaid += claim.amount;

            // Transfer payout
            require(vjToken.transfer(claim.claimant, claim.amount), "Transfer failed");

            claim.status = ClaimStatus.Paid;

            emit ClaimProcessed(claimId, ClaimStatus.Paid, claim.amount);
        } else {
            claim.status = ClaimStatus.Rejected;
            emit ClaimProcessed(claimId, ClaimStatus.Rejected, 0);
        }
    }

    /**
     * @dev Get coverage information for an address
     * @param account Address to query
     * @return Coverage information
     */
    function getCoverage(address account) external view returns (CoverageInfo memory) {
        return _coverage[account];
    }

    /**
     * @dev Get claim information
     * @param claimId ID of the claim
     * @return Claim information
     */
    function getClaim(uint256 claimId) external view returns (Claim memory) {
        require(_claims[claimId].id != 0, "Claim does not exist");
        return _claims[claimId];
    }

    /**
     * @dev Get pool health metrics
     * @return reserves Current reserves
     * @return obligations Total obligations
     * @return ratio Reserve ratio in basis points
     */
    function getPoolHealth() external view returns (
        uint256 reserves,
        uint256 obligations,
        uint256 ratio
    ) {
        reserves = totalReserves;
        obligations = totalObligations;
        ratio = obligations > 0 ? (reserves * 10000) / obligations : 10000;
    }
}
