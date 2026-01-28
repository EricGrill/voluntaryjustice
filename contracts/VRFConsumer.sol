// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title VRFConsumer
 * @dev Chainlink VRF v2.5 integration for secure randomness in jury selection
 */
contract VRFConsumer is VRFConsumerBaseV2Plus, AccessControl {
    bytes32 public constant REQUESTER_ROLE = keccak256("REQUESTER_ROLE");

    // VRF Configuration
    uint256 public subscriptionId;
    bytes32 public keyHash;
    uint32 public callbackGasLimit;
    uint16 public requestConfirmations;
    uint32 public numWords;

    // Request tracking
    struct RandomRequest {
        uint256 disputeId;
        bool fulfilled;
        uint256[] randomWords;
        uint256 requestedAt;
        uint256 fulfilledAt;
    }

    mapping(uint256 => RandomRequest) private _requests; // requestId => RandomRequest
    mapping(uint256 => uint256) private _disputeToRequest; // disputeId => requestId
    mapping(uint256 => bytes32) private _disputeSeeds; // disputeId => derived seed
    uint256[] private _requestIds;

    // Events
    event RandomnessRequested(uint256 indexed requestId, uint256 indexed disputeId);
    event RandomnessFulfilled(uint256 indexed requestId, uint256 indexed disputeId, uint256[] randomWords);
    event ConfigUpdated(uint256 subscriptionId, bytes32 keyHash, uint32 callbackGasLimit);

    constructor(
        address defaultAdmin,
        address vrfCoordinator,
        uint256 _subscriptionId,
        bytes32 _keyHash
    ) VRFConsumerBaseV2Plus(vrfCoordinator) {
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(REQUESTER_ROLE, defaultAdmin);

        subscriptionId = _subscriptionId;
        keyHash = _keyHash;
        callbackGasLimit = 100000;
        requestConfirmations = 3;
        numWords = 1;
    }

    /**
     * @dev Request randomness for a dispute (jury selection)
     * @param disputeId ID of the dispute needing random jury
     * @return requestId The VRF request ID
     */
    function requestRandomness(uint256 disputeId) external onlyRole(REQUESTER_ROLE) returns (uint256 requestId) {
        require(_disputeToRequest[disputeId] == 0, "Randomness already requested");

        requestId = s_vrfCoordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: keyHash,
                subId: subscriptionId,
                requestConfirmations: requestConfirmations,
                callbackGasLimit: callbackGasLimit,
                numWords: numWords,
                extraArgs: VRFV2PlusClient._argsToBytes(
                    VRFV2PlusClient.ExtraArgsV1({nativePayment: false})
                )
            })
        );

        _requests[requestId] = RandomRequest({
            disputeId: disputeId,
            fulfilled: false,
            randomWords: new uint256[](0),
            requestedAt: block.timestamp,
            fulfilledAt: 0
        });

        _disputeToRequest[disputeId] = requestId;
        _requestIds.push(requestId);

        emit RandomnessRequested(requestId, disputeId);
    }

    /**
     * @dev Callback function used by VRF Coordinator
     */
    function fulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) internal override {
        RandomRequest storage request = _requests[requestId];
        require(request.requestedAt != 0, "Request not found");
        require(!request.fulfilled, "Already fulfilled");

        request.fulfilled = true;
        request.randomWords = randomWords;
        request.fulfilledAt = block.timestamp;

        // Derive a deterministic seed from the random words
        bytes32 seed = keccak256(abi.encodePacked(randomWords));
        _disputeSeeds[request.disputeId] = seed;

        emit RandomnessFulfilled(requestId, request.disputeId, randomWords);
    }

    /**
     * @dev Get the verified random seed for a dispute
     * @param disputeId ID of the dispute
     * @return seed The random seed (bytes32)
     */
    function getRandomSeed(uint256 disputeId) external view returns (bytes32) {
        require(_disputeSeeds[disputeId] != bytes32(0), "Seed not available");
        return _disputeSeeds[disputeId];
    }

    /**
     * @dev Check if randomness is fulfilled for a dispute
     * @param disputeId ID of the dispute
     * @return Whether randomness is ready
     */
    function isRandomnessReady(uint256 disputeId) external view returns (bool) {
        uint256 requestId = _disputeToRequest[disputeId];
        if (requestId == 0) return false;
        return _requests[requestId].fulfilled;
    }

    /**
     * @dev Get request details
     * @param requestId The VRF request ID
     * @return Request information
     */
    function getRequest(uint256 requestId) external view returns (RandomRequest memory) {
        require(_requests[requestId].requestedAt != 0, "Request not found");
        return _requests[requestId];
    }

    /**
     * @dev Get request ID for a dispute
     * @param disputeId ID of the dispute
     * @return The request ID (0 if not requested)
     */
    function getRequestForDispute(uint256 disputeId) external view returns (uint256) {
        return _disputeToRequest[disputeId];
    }

    /**
     * @dev Update VRF configuration
     */
    function updateConfig(
        uint256 _subscriptionId,
        bytes32 _keyHash,
        uint32 _callbackGasLimit,
        uint16 _requestConfirmations,
        uint32 _numWords
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        subscriptionId = _subscriptionId;
        keyHash = _keyHash;
        callbackGasLimit = _callbackGasLimit;
        requestConfirmations = _requestConfirmations;
        numWords = _numWords;

        emit ConfigUpdated(_subscriptionId, _keyHash, _callbackGasLimit);
    }

    /**
     * @dev Get total number of requests
     */
    function totalRequests() external view returns (uint256) {
        return _requestIds.length;
    }
}
