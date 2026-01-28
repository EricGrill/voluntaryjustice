// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

interface IVRFConsumer {
    function rawFulfillRandomWords(uint256 requestId, uint256[] memory randomWords) external;
}

/**
 * @title MockVRFCoordinator
 * @dev Mock Chainlink VRF Coordinator for testing purposes
 */
contract MockVRFCoordinator {
    uint256 private _requestCounter;

    struct Request {
        address consumer;
        uint32 numWords;
        bool fulfilled;
    }

    mapping(uint256 => Request) private _requests;

    event RandomWordsRequested(uint256 indexed requestId, address indexed consumer);
    event RandomWordsFulfilled(uint256 indexed requestId);

    /**
     * @dev Mock implementation of requestRandomWords (VRF v2.5 interface)
     */
    function requestRandomWords(
        VRFV2PlusClient.RandomWordsRequest calldata req
    ) external returns (uint256 requestId) {
        _requestCounter++;
        requestId = _requestCounter;

        _requests[requestId] = Request({
            consumer: msg.sender,
            numWords: req.numWords,
            fulfilled: false
        });

        emit RandomWordsRequested(requestId, msg.sender);
    }

    /**
     * @dev Fulfill random words for testing
     */
    function fulfillRandomWords(uint256 requestId, address consumer) external {
        Request storage request = _requests[requestId];
        require(!request.fulfilled, "Already fulfilled");

        uint32 numWords = request.numWords > 0 ? request.numWords : 1;
        uint256[] memory randomWords = new uint256[](numWords);

        for (uint32 i = 0; i < numWords; i++) {
            randomWords[i] = uint256(keccak256(abi.encodePacked(requestId, block.timestamp, i)));
        }

        request.fulfilled = true;

        IVRFConsumer(consumer).rawFulfillRandomWords(requestId, randomWords);

        emit RandomWordsFulfilled(requestId);
    }

    /**
     * @dev Get request details
     */
    function getRequest(uint256 requestId) external view returns (address consumer, uint32 numWords, bool fulfilled) {
        Request storage request = _requests[requestId];
        return (request.consumer, request.numWords, request.fulfilled);
    }

    /**
     * @dev Get total requests
     */
    function totalRequests() external view returns (uint256) {
        return _requestCounter;
    }
}
