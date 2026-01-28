// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/governance/Governor.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol";
import "./ExclusionRegistry.sol";

/**
 * @title VJGovernor
 * @dev DAO governance with constitutional constraints
 * Structurally prevents certain forbidden actions while allowing protocol upgrades
 */
contract VJGovernor is
    Governor,
    GovernorSettings,
    GovernorCountingSimple,
    GovernorVotes,
    GovernorVotesQuorumFraction,
    GovernorTimelockControl
{
    // Constitutional constraints - these function selectors are FORBIDDEN
    // The contract structurally prevents proposals targeting these
    bytes4 private constant FORBIDDEN_SELECTOR_1 = bytes4(keccak256("defineCrime(bytes)"));
    bytes4 private constant FORBIDDEN_SELECTOR_2 = bytes4(keccak256("overrideContract(uint256)"));
    bytes4 private constant FORBIDDEN_SELECTOR_3 = bytes4(keccak256("grantImmunity(address)"));
    bytes4 private constant FORBIDDEN_SELECTOR_4 = bytes4(keccak256("compelParticipation(address)"));

    ExclusionRegistry public exclusionRegistry;

    // Emergency pause state
    bool public paused;
    uint256 public pauseExpiry;
    uint256 public constant MAX_PAUSE_DURATION = 7 days;

    // Fee parameters
    uint256 public disputeFilingFee;
    uint256 public contractCreationFee;
    uint256 public insurancePolicyFee;

    // Events
    event ProtocolPaused(uint256 expiry);
    event ProtocolUnpaused();
    event FeeParametersUpdated(uint256 disputeFee, uint256 contractFee, uint256 insuranceFee);
    event ProposalBlocked(uint256 proposalId, string reason);

    error ForbiddenAction(bytes4 selector);
    error ProtocolIsPaused();
    error InvalidPauseDuration();
    error NotPaused();

    constructor(
        IVotes _token,
        TimelockController _timelock,
        address _exclusionRegistry
    )
        Governor("VJGovernor")
        GovernorSettings(
            1 days,      // voting delay
            7 days,      // voting period
            0            // proposal threshold (set via quorum)
        )
        GovernorVotes(_token)
        GovernorVotesQuorumFraction(10) // 10% quorum
        GovernorTimelockControl(_timelock)
    {
        require(_exclusionRegistry != address(0), "Invalid exclusion registry");
        exclusionRegistry = ExclusionRegistry(_exclusionRegistry);
    }

    /**
     * @dev Override propose to enforce constitutional constraints
     */
    function propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description
    ) public override(Governor) returns (uint256) {
        // Check each calldata for forbidden selectors
        for (uint256 i = 0; i < calldatas.length; i++) {
            if (calldatas[i].length >= 4) {
                bytes4 selector = bytes4(calldatas[i]);
                if (_isForbiddenSelector(selector)) {
                    revert ForbiddenAction(selector);
                }
            }
        }

        return super.propose(targets, values, calldatas, description);
    }

    /**
     * @dev Check if a function selector is forbidden
     */
    function _isForbiddenSelector(bytes4 selector) internal pure returns (bool) {
        return selector == FORBIDDEN_SELECTOR_1 ||
               selector == FORBIDDEN_SELECTOR_2 ||
               selector == FORBIDDEN_SELECTOR_3 ||
               selector == FORBIDDEN_SELECTOR_4;
    }

    /**
     * @dev Pause the protocol (emergency only, timebound)
     * Can only be called via governance proposal
     */
    function pauseProtocol(uint256 duration) external onlyGovernance {
        if (duration > MAX_PAUSE_DURATION) revert InvalidPauseDuration();

        paused = true;
        pauseExpiry = block.timestamp + duration;

        emit ProtocolPaused(pauseExpiry);
    }

    /**
     * @dev Unpause the protocol
     * Can be called by anyone after pause expires, or by governance anytime
     */
    function unpauseProtocol() external {
        if (!paused) revert NotPaused();

        // Anyone can unpause after expiry
        if (msg.sender != address(this) && block.timestamp < pauseExpiry) {
            revert ProtocolIsPaused();
        }

        paused = false;
        pauseExpiry = 0;

        emit ProtocolUnpaused();
    }

    /**
     * @dev Update fee parameters
     * Can only be called via governance proposal
     */
    function updateFeeParameters(
        uint256 _disputeFee,
        uint256 _contractFee,
        uint256 _insuranceFee
    ) external onlyGovernance {
        disputeFilingFee = _disputeFee;
        contractCreationFee = _contractFee;
        insurancePolicyFee = _insuranceFee;

        emit FeeParametersUpdated(_disputeFee, _contractFee, _insuranceFee);
    }

    /**
     * @dev Add address to exclusion registry
     * Can only be called via governance proposal
     */
    function addToExclusionRegistry(
        address account,
        bytes32 rulingHash,
        string calldata reason,
        uint256 totalAmount,
        uint256 unpaidAmount
    ) external onlyGovernance {
        exclusionRegistry.addToRegistry(account, rulingHash, reason, totalAmount, unpaidAmount);
    }

    /**
     * @dev Remove address from exclusion registry
     * Can only be called via governance proposal
     */
    function removeFromExclusionRegistry(
        address account,
        string calldata reason
    ) external onlyGovernance {
        exclusionRegistry.removeFromRegistry(account, reason);
    }

    /**
     * @dev Check if protocol is currently paused
     */
    function isPaused() external view returns (bool) {
        return paused && block.timestamp < pauseExpiry;
    }

    // Required overrides

    function votingDelay()
        public
        view
        override(Governor, GovernorSettings)
        returns (uint256)
    {
        return super.votingDelay();
    }

    function votingPeriod()
        public
        view
        override(Governor, GovernorSettings)
        returns (uint256)
    {
        return super.votingPeriod();
    }

    function quorum(uint256 blockNumber)
        public
        view
        override(Governor, GovernorVotesQuorumFraction)
        returns (uint256)
    {
        return super.quorum(blockNumber);
    }

    function state(uint256 proposalId)
        public
        view
        override(Governor, GovernorTimelockControl)
        returns (ProposalState)
    {
        return super.state(proposalId);
    }

    function proposalNeedsQueuing(uint256 proposalId)
        public
        view
        override(Governor, GovernorTimelockControl)
        returns (bool)
    {
        return super.proposalNeedsQueuing(proposalId);
    }

    function proposalThreshold()
        public
        view
        override(Governor, GovernorSettings)
        returns (uint256)
    {
        return super.proposalThreshold();
    }

    function _queueOperations(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) returns (uint48) {
        return super._queueOperations(proposalId, targets, values, calldatas, descriptionHash);
    }

    function _executeOperations(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) {
        super._executeOperations(proposalId, targets, values, calldatas, descriptionHash);
    }

    function _cancel(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) returns (uint256) {
        return super._cancel(targets, values, calldatas, descriptionHash);
    }

    function _executor()
        internal
        view
        override(Governor, GovernorTimelockControl)
        returns (address)
    {
        return super._executor();
    }
}
