// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title ReputationScoring
 * @dev Multi-dimensional reputation system for VoluntaryJustice participants
 * Tracks: compliance, dispute rate, payment history, and counterparty ratings
 */
contract ReputationScoring is AccessControl {
    bytes32 public constant AUTHORIZED_CONTRACT_ROLE = keccak256("AUTHORIZED_CONTRACT_ROLE");

    struct ReputationData {
        // Compliance: % of rulings complied with (0-100)
        uint256 totalRulings;
        uint256 compliedRulings;

        // Dispute rate: disputes filed against per contract (inverse scoring)
        uint256 totalContracts;
        uint256 disputesAgainst;

        // Payment history: timeliness of payments (0-100)
        uint256 totalPayments;
        uint256 onTimePayments; // paid within deadline
        uint256 totalDaysToSettle; // for average calculation

        // Counterparty ratings: peer ratings (0-100)
        uint256 totalRatings;
        uint256 sumRatings;
    }

    mapping(address => ReputationData) private _reputations;

    // Events
    event ComplianceRecorded(address indexed account, uint256 rulingId, bool complied);
    event DisputeRecorded(address indexed account, uint256 contractId);
    event ContractRecorded(address indexed account, uint256 contractId);
    event PaymentRecorded(address indexed account, uint256 amount, uint256 daysToSettle);
    event RatingSubmitted(address indexed from, address indexed to, uint8 score);

    constructor(address defaultAdmin) {
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
    }

    /**
     * @dev Record compliance with a ruling
     * @param account Address whose compliance is being recorded
     * @param rulingId ID of the ruling
     * @param complied Whether the party complied with the ruling
     */
    function updateCompliance(address account, uint256 rulingId, bool complied)
        external
        onlyRole(AUTHORIZED_CONTRACT_ROLE)
    {
        ReputationData storage rep = _reputations[account];
        rep.totalRulings++;
        if (complied) {
            rep.compliedRulings++;
        }

        emit ComplianceRecorded(account, rulingId, complied);
    }

    /**
     * @dev Record a dispute filed against an address
     * @param account Address the dispute is filed against
     * @param contractId ID of the contract in dispute
     */
    function recordDispute(address account, uint256 contractId)
        external
        onlyRole(AUTHORIZED_CONTRACT_ROLE)
    {
        _reputations[account].disputesAgainst++;

        emit DisputeRecorded(account, contractId);
    }

    /**
     * @dev Record a contract participation (for dispute rate calculation)
     * @param account Address participating in contract
     * @param contractId ID of the contract
     */
    function recordContract(address account, uint256 contractId)
        external
        onlyRole(AUTHORIZED_CONTRACT_ROLE)
    {
        _reputations[account].totalContracts++;

        emit ContractRecorded(account, contractId);
    }

    /**
     * @dev Record a payment and its timeliness
     * @param account Address making the payment
     * @param amount Payment amount (for weighting)
     * @param daysToSettle Days taken to settle (0 = immediate/on-time)
     */
    function recordPayment(address account, uint256 amount, uint256 daysToSettle)
        external
        onlyRole(AUTHORIZED_CONTRACT_ROLE)
    {
        ReputationData storage rep = _reputations[account];
        rep.totalPayments++;
        rep.totalDaysToSettle += daysToSettle;

        // Consider payment on-time if settled within 7 days
        if (daysToSettle <= 7) {
            rep.onTimePayments++;
        }

        emit PaymentRecorded(account, amount, daysToSettle);
    }

    /**
     * @dev Submit a rating for a counterparty
     * @param from Address submitting the rating
     * @param to Address being rated
     * @param score Rating score (0-100)
     */
    function submitRating(address from, address to, uint8 score)
        external
        onlyRole(AUTHORIZED_CONTRACT_ROLE)
    {
        require(score <= 100, "Score must be 0-100");
        require(from != to, "Cannot rate yourself");

        ReputationData storage rep = _reputations[to];
        rep.totalRatings++;
        rep.sumRatings += score;

        emit RatingSubmitted(from, to, score);
    }

    /**
     * @dev Get all four reputation scores for an address
     * @param account Address to query
     * @return compliance Compliance score (0-100)
     * @return disputeRate Dispute rate score (0-100, inverse - higher is better)
     * @return paymentHistory Payment history score (0-100)
     * @return counterpartyRating Counterparty rating score (0-100)
     */
    function getScores(address account)
        external
        view
        returns (uint8 compliance, uint8 disputeRate, uint8 paymentHistory, uint8 counterpartyRating)
    {
        ReputationData storage rep = _reputations[account];

        // Compliance score: % of rulings complied with
        if (rep.totalRulings > 0) {
            compliance = uint8((rep.compliedRulings * 100) / rep.totalRulings);
        } else {
            compliance = 100; // Default to perfect if no rulings
        }

        // Dispute rate score: inverse of disputes per contract
        // Formula: 100 - (disputes/contracts * 100), capped at 0
        if (rep.totalContracts > 0) {
            uint256 rate = (rep.disputesAgainst * 100) / rep.totalContracts;
            disputeRate = rate >= 100 ? 0 : uint8(100 - rate);
        } else {
            disputeRate = 100; // Default to perfect if no contracts
        }

        // Payment history: % of on-time payments
        if (rep.totalPayments > 0) {
            paymentHistory = uint8((rep.onTimePayments * 100) / rep.totalPayments);
        } else {
            paymentHistory = 100; // Default to perfect if no payments
        }

        // Counterparty rating: average of all ratings
        if (rep.totalRatings > 0) {
            counterpartyRating = uint8(rep.sumRatings / rep.totalRatings);
        } else {
            counterpartyRating = 50; // Default to neutral if no ratings
        }
    }

    /**
     * @dev Get raw reputation data for an address
     * @param account Address to query
     * @return totalRulings Total number of rulings
     * @return compliedRulings Number of rulings complied with
     * @return totalContracts Total contracts participated in
     * @return disputesAgainst Number of disputes filed against
     * @return totalPayments Total payments made
     * @return onTimePayments Number of on-time payments
     * @return totalRatings Number of ratings received
     * @return sumRatings Sum of all ratings
     */
    function getRawData(address account)
        external
        view
        returns (
            uint256 totalRulings,
            uint256 compliedRulings,
            uint256 totalContracts,
            uint256 disputesAgainst,
            uint256 totalPayments,
            uint256 onTimePayments,
            uint256 totalRatings,
            uint256 sumRatings
        )
    {
        ReputationData storage rep = _reputations[account];
        return (
            rep.totalRulings,
            rep.compliedRulings,
            rep.totalContracts,
            rep.disputesAgainst,
            rep.totalPayments,
            rep.onTimePayments,
            rep.totalRatings,
            rep.sumRatings
        );
    }

    /**
     * @dev Get average days to settle payments
     * @param account Address to query
     * @return Average days to settle, 0 if no payments
     */
    function getAverageDaysToSettle(address account) external view returns (uint256) {
        ReputationData storage rep = _reputations[account];
        if (rep.totalPayments == 0) return 0;
        return rep.totalDaysToSettle / rep.totalPayments;
    }
}
