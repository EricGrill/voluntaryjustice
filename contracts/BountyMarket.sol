// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "./VJToken.sol";
import "./DisputeResolution.sol";

/**
 * @title BountyMarket
 * @dev Manages recovery bounties for enforcement of rulings
 */
contract BountyMarket is AccessControl, ReentrancyGuard {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");

    uint256 public constant MIN_ORACLE_ATTESTATIONS = 3;
    uint256 public constant DISPUTE_PERIOD = 7 days;

    enum BountyStatus {
        Active,
        Claimed,
        Disputed,
        Paid,
        Expired,
        Cancelled
    }

    enum ProofType {
        OracleAttestation,
        LegacyCourtJudgment,
        DebtorConfirmation
    }

    struct Bounty {
        uint256 id;
        uint256 rulingId;
        address creditor;
        address debtor;
        uint256 restitutionAmount;
        uint256 bountyAmount;
        uint256 deadline;
        BountyStatus status;
        uint256 createdAt;
    }

    struct Claim {
        address hunter;
        ProofType proofType;
        bytes proof;
        uint256 claimedAt;
        uint256 oracleAttestations;
        bool disputed;
        uint256 disputeDeadline;
    }

    VJToken public vjToken;
    DisputeResolution public disputeResolution;

    mapping(uint256 => Bounty) private _bounties;
    mapping(uint256 => Claim) private _claims;
    mapping(uint256 => mapping(address => bool)) private _oracleAttested;
    uint256 private _bountyCount;

    address[] public registeredOracles;
    mapping(address => bool) public isOracle;

    // Events
    event BountyCreated(
        uint256 indexed bountyId,
        uint256 indexed rulingId,
        address creditor,
        uint256 bountyAmount,
        uint256 deadline
    );
    event BountyClaimed(uint256 indexed bountyId, address indexed hunter, ProofType proofType);
    event OracleAttested(uint256 indexed bountyId, address indexed oracle);
    event BountyDisputed(uint256 indexed bountyId, address indexed disputer);
    event BountyPaid(uint256 indexed bountyId, address indexed hunter, uint256 amount);
    event BountyCancelled(uint256 indexed bountyId);
    event BountyExpired(uint256 indexed bountyId);
    event OracleRegistered(address indexed oracle);
    event OracleRemoved(address indexed oracle);

    constructor(
        address defaultAdmin,
        address _vjToken,
        address _disputeResolution
    ) {
        require(_vjToken != address(0), "Invalid token address");
        require(_disputeResolution != address(0), "Invalid dispute resolution");

        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(GOVERNANCE_ROLE, defaultAdmin);

        vjToken = VJToken(_vjToken);
        disputeResolution = DisputeResolution(_disputeResolution);
    }

    /**
     * @dev Register an oracle for bounty verification
     * @param oracle Address of the oracle
     */
    function registerOracle(address oracle) external onlyRole(GOVERNANCE_ROLE) {
        require(oracle != address(0), "Invalid oracle address");
        require(!isOracle[oracle], "Already registered");

        isOracle[oracle] = true;
        registeredOracles.push(oracle);
        _grantRole(ORACLE_ROLE, oracle);

        emit OracleRegistered(oracle);
    }

    /**
     * @dev Remove an oracle
     * @param oracle Address of the oracle to remove
     */
    function removeOracle(address oracle) external onlyRole(GOVERNANCE_ROLE) {
        require(isOracle[oracle], "Not an oracle");

        isOracle[oracle] = false;
        _revokeRole(ORACLE_ROLE, oracle);

        // Remove from array
        for (uint256 i = 0; i < registeredOracles.length; i++) {
            if (registeredOracles[i] == oracle) {
                registeredOracles[i] = registeredOracles[registeredOracles.length - 1];
                registeredOracles.pop();
                break;
            }
        }

        emit OracleRemoved(oracle);
    }

    /**
     * @dev Create a bounty for recovering a ruling amount
     * @param rulingId ID of the ruling
     * @param bountyAmount Amount offered as bounty
     * @param deadline Deadline for claiming the bounty
     * @return bountyId The ID of the created bounty
     */
    function createBounty(
        uint256 rulingId,
        uint256 bountyAmount,
        uint256 deadline
    ) external nonReentrant returns (uint256 bountyId) {
        require(bountyAmount > 0, "Bounty amount required");
        require(deadline > block.timestamp, "Invalid deadline");

        // Get ruling info
        (address liable, uint256 restitutionAmount) = disputeResolution.getFinalRuling(rulingId);
        require(liable != address(0), "No liable party");
        require(restitutionAmount > 0, "No restitution amount");

        // Transfer bounty amount from creator
        require(vjToken.transferFrom(msg.sender, address(this), bountyAmount), "Transfer failed");

        _bountyCount++;
        bountyId = _bountyCount;

        // Determine creditor (non-liable party)
        DisputeResolution.DisputeView memory dispute = disputeResolution.getDispute(rulingId);
        address creditor = liable == dispute.claimant ? dispute.respondent : dispute.claimant;

        _bounties[bountyId] = Bounty({
            id: bountyId,
            rulingId: rulingId,
            creditor: creditor,
            debtor: liable,
            restitutionAmount: restitutionAmount,
            bountyAmount: bountyAmount,
            deadline: deadline,
            status: BountyStatus.Active,
            createdAt: block.timestamp
        });

        emit BountyCreated(bountyId, rulingId, creditor, bountyAmount, deadline);
    }

    /**
     * @dev Claim a bounty with proof of recovery
     * @param bountyId ID of the bounty
     * @param proofType Type of proof being submitted
     * @param proof The proof data
     */
    function claimBounty(
        uint256 bountyId,
        ProofType proofType,
        bytes calldata proof
    ) external {
        Bounty storage bounty = _bounties[bountyId];
        require(bounty.id != 0, "Bounty does not exist");
        require(bounty.status == BountyStatus.Active, "Bounty not active");
        require(block.timestamp <= bounty.deadline, "Bounty expired");
        require(proof.length > 0, "Proof required");

        _claims[bountyId] = Claim({
            hunter: msg.sender,
            proofType: proofType,
            proof: proof,
            claimedAt: block.timestamp,
            oracleAttestations: 0,
            disputed: false,
            disputeDeadline: block.timestamp + DISPUTE_PERIOD
        });

        bounty.status = BountyStatus.Claimed;

        emit BountyClaimed(bountyId, msg.sender, proofType);
    }

    /**
     * @dev Oracle attests to a bounty claim
     * @param bountyId ID of the bounty
     */
    function verifyOracleAttestation(uint256 bountyId) external onlyRole(ORACLE_ROLE) {
        Bounty storage bounty = _bounties[bountyId];
        require(bounty.id != 0, "Bounty does not exist");
        require(bounty.status == BountyStatus.Claimed, "Bounty not claimed");

        Claim storage claim = _claims[bountyId];
        require(claim.proofType == ProofType.OracleAttestation, "Wrong proof type");
        require(!_oracleAttested[bountyId][msg.sender], "Already attested");

        _oracleAttested[bountyId][msg.sender] = true;
        claim.oracleAttestations++;

        emit OracleAttested(bountyId, msg.sender);

        // Auto-pay if enough attestations and no dispute
        if (claim.oracleAttestations >= MIN_ORACLE_ATTESTATIONS && !claim.disputed) {
            _payBounty(bountyId);
        }
    }

    /**
     * @dev Verify legacy court judgment for bounty claim
     * @param bountyId ID of the bounty
     * @param judgmentHash Hash of the court judgment document
     */
    function verifyLegacyCourtJudgment(
        uint256 bountyId,
        bytes32 judgmentHash
    ) external onlyRole(GOVERNANCE_ROLE) {
        Bounty storage bounty = _bounties[bountyId];
        require(bounty.id != 0, "Bounty does not exist");
        require(bounty.status == BountyStatus.Claimed, "Bounty not claimed");

        Claim storage claim = _claims[bountyId];
        require(claim.proofType == ProofType.LegacyCourtJudgment, "Wrong proof type");
        require(judgmentHash != bytes32(0), "Invalid judgment hash");

        // Governance verifies the judgment - pay the bounty
        _payBounty(bountyId);
    }

    /**
     * @dev Verify debtor confirmation signature
     * @param bountyId ID of the bounty
     * @param signature Debtor's signature confirming recovery
     */
    function verifyDebtorConfirmation(
        uint256 bountyId,
        bytes calldata signature
    ) external {
        Bounty storage bounty = _bounties[bountyId];
        require(bounty.id != 0, "Bounty does not exist");
        require(bounty.status == BountyStatus.Claimed, "Bounty not claimed");

        Claim storage claim = _claims[bountyId];
        require(claim.proofType == ProofType.DebtorConfirmation, "Wrong proof type");

        // Verify debtor signed the confirmation
        bytes32 messageHash = keccak256(abi.encodePacked(
            "I confirm restitution of ",
            bounty.restitutionAmount,
            " for bounty ",
            bountyId
        ));
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();
        address signer = ethSignedHash.recover(signature);
        require(signer == bounty.debtor, "Invalid debtor signature");

        _payBounty(bountyId);
    }

    /**
     * @dev Dispute a bounty claim
     * @param bountyId ID of the bounty
     * @param evidence Evidence supporting the dispute
     */
    function disputeBountyClaim(uint256 bountyId, bytes calldata evidence) external {
        Bounty storage bounty = _bounties[bountyId];
        require(bounty.id != 0, "Bounty does not exist");
        require(bounty.status == BountyStatus.Claimed, "Bounty not claimed");
        require(
            msg.sender == bounty.creditor || msg.sender == bounty.debtor,
            "Not authorized to dispute"
        );

        Claim storage claim = _claims[bountyId];
        require(block.timestamp <= claim.disputeDeadline, "Dispute period ended");
        require(!claim.disputed, "Already disputed");
        require(evidence.length > 0, "Evidence required");

        claim.disputed = true;
        bounty.status = BountyStatus.Disputed;

        emit BountyDisputed(bountyId, msg.sender);
    }

    /**
     * @dev Resolve a disputed bounty (governance only)
     * @param bountyId ID of the bounty
     * @param payHunter Whether to pay the bounty hunter
     */
    function resolveDispute(uint256 bountyId, bool payHunter) external onlyRole(GOVERNANCE_ROLE) {
        Bounty storage bounty = _bounties[bountyId];
        require(bounty.id != 0, "Bounty does not exist");
        require(bounty.status == BountyStatus.Disputed, "Not disputed");

        if (payHunter) {
            _payBounty(bountyId);
        } else {
            // Return bounty to creditor
            bounty.status = BountyStatus.Cancelled;
            require(vjToken.transfer(bounty.creditor, bounty.bountyAmount), "Transfer failed");
            emit BountyCancelled(bountyId);
        }
    }

    /**
     * @dev Cancel an expired bounty
     * @param bountyId ID of the bounty
     */
    function cancelExpiredBounty(uint256 bountyId) external {
        Bounty storage bounty = _bounties[bountyId];
        require(bounty.id != 0, "Bounty does not exist");
        require(bounty.status == BountyStatus.Active, "Bounty not active");
        require(block.timestamp > bounty.deadline, "Bounty not expired");

        bounty.status = BountyStatus.Expired;

        // Return bounty amount to creditor
        require(vjToken.transfer(bounty.creditor, bounty.bountyAmount), "Transfer failed");

        emit BountyExpired(bountyId);
    }

    /**
     * @dev Internal function to pay bounty
     */
    function _payBounty(uint256 bountyId) internal nonReentrant {
        Bounty storage bounty = _bounties[bountyId];
        Claim storage claim = _claims[bountyId];

        bounty.status = BountyStatus.Paid;

        require(vjToken.transfer(claim.hunter, bounty.bountyAmount), "Transfer failed");

        emit BountyPaid(bountyId, claim.hunter, bounty.bountyAmount);
    }

    /**
     * @dev Get bounty information
     * @param bountyId ID of the bounty
     * @return Bounty information
     */
    function getBounty(uint256 bountyId) external view returns (Bounty memory) {
        require(_bounties[bountyId].id != 0, "Bounty does not exist");
        return _bounties[bountyId];
    }

    /**
     * @dev Get claim information
     * @param bountyId ID of the bounty
     * @return Claim information
     */
    function getClaim(uint256 bountyId) external view returns (Claim memory) {
        return _claims[bountyId];
    }

    /**
     * @dev Get total number of bounties
     * @return Total bounty count
     */
    function totalBounties() external view returns (uint256) {
        return _bountyCount;
    }

    /**
     * @dev Get number of registered oracles
     * @return Oracle count
     */
    function oracleCount() external view returns (uint256) {
        return registeredOracles.length;
    }
}
