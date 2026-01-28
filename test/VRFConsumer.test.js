const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * VRFConsumer Tests
 *
 * Note: These tests use a mock VRF Coordinator for testing purposes.
 * In production, the contract integrates with Chainlink VRF v2.5.
 */
describe("VRFConsumer", function () {
  let vrfConsumer;
  let mockCoordinator;
  let owner;
  let requester;
  let user;

  const SUBSCRIPTION_ID = 1;
  const KEY_HASH = ethers.keccak256(ethers.toUtf8Bytes("test-key-hash"));

  beforeEach(async function () {
    [owner, requester, user] = await ethers.getSigners();

    // Deploy mock VRF Coordinator
    const MockVRFCoordinator = await ethers.getContractFactory("MockVRFCoordinator");
    mockCoordinator = await MockVRFCoordinator.deploy();
    await mockCoordinator.waitForDeployment();

    // Deploy VRFConsumer
    const VRFConsumer = await ethers.getContractFactory("VRFConsumer");
    vrfConsumer = await VRFConsumer.deploy(
      owner.address,
      await mockCoordinator.getAddress(),
      SUBSCRIPTION_ID,
      KEY_HASH
    );
    await vrfConsumer.waitForDeployment();

    // Grant REQUESTER_ROLE
    const REQUESTER_ROLE = await vrfConsumer.REQUESTER_ROLE();
    await vrfConsumer.grantRole(REQUESTER_ROLE, requester.address);
  });

  describe("Deployment", function () {
    it("Should set correct subscription ID", async function () {
      expect(await vrfConsumer.subscriptionId()).to.equal(SUBSCRIPTION_ID);
    });

    it("Should set correct key hash", async function () {
      expect(await vrfConsumer.keyHash()).to.equal(KEY_HASH);
    });

    it("Should set correct callback gas limit", async function () {
      expect(await vrfConsumer.callbackGasLimit()).to.equal(100000);
    });

    it("Should start with zero requests", async function () {
      expect(await vrfConsumer.totalRequests()).to.equal(0);
    });
  });

  describe("Randomness Requests", function () {
    it("Should request randomness", async function () {
      const disputeId = 1;

      await expect(vrfConsumer.connect(requester).requestRandomness(disputeId))
        .to.emit(vrfConsumer, "RandomnessRequested");

      expect(await vrfConsumer.totalRequests()).to.equal(1);
    });

    it("Should track request for dispute", async function () {
      const disputeId = 1;
      await vrfConsumer.connect(requester).requestRandomness(disputeId);

      const requestId = await vrfConsumer.getRequestForDispute(disputeId);
      expect(requestId).to.be.gt(0);
    });

    it("Should reject duplicate request for same dispute", async function () {
      const disputeId = 1;
      await vrfConsumer.connect(requester).requestRandomness(disputeId);

      await expect(
        vrfConsumer.connect(requester).requestRandomness(disputeId)
      ).to.be.revertedWith("Randomness already requested");
    });

    it("Should reject request from non-requester", async function () {
      await expect(
        vrfConsumer.connect(user).requestRandomness(1)
      ).to.be.reverted;
    });
  });

  describe("Randomness Fulfillment", function () {
    it("Should report randomness not ready before fulfillment", async function () {
      const disputeId = 1;
      await vrfConsumer.connect(requester).requestRandomness(disputeId);

      expect(await vrfConsumer.isRandomnessReady(disputeId)).to.be.false;
    });

    it("Should fulfill randomness via coordinator", async function () {
      const disputeId = 1;
      await vrfConsumer.connect(requester).requestRandomness(disputeId);

      const requestId = await vrfConsumer.getRequestForDispute(disputeId);

      // Fulfill via mock coordinator
      await mockCoordinator.fulfillRandomWords(
        requestId,
        await vrfConsumer.getAddress()
      );

      expect(await vrfConsumer.isRandomnessReady(disputeId)).to.be.true;
    });

    it("Should generate deterministic seed after fulfillment", async function () {
      const disputeId = 1;
      await vrfConsumer.connect(requester).requestRandomness(disputeId);

      const requestId = await vrfConsumer.getRequestForDispute(disputeId);
      await mockCoordinator.fulfillRandomWords(
        requestId,
        await vrfConsumer.getAddress()
      );

      const seed = await vrfConsumer.getRandomSeed(disputeId);
      expect(seed).to.not.equal(ethers.ZeroHash);
    });

    it("Should reject seed request before fulfillment", async function () {
      const disputeId = 1;
      await vrfConsumer.connect(requester).requestRandomness(disputeId);

      await expect(
        vrfConsumer.getRandomSeed(disputeId)
      ).to.be.revertedWith("Seed not available");
    });
  });

  describe("Request Details", function () {
    it("Should return request details", async function () {
      const disputeId = 1;
      await vrfConsumer.connect(requester).requestRandomness(disputeId);

      const requestId = await vrfConsumer.getRequestForDispute(disputeId);
      const request = await vrfConsumer.getRequest(requestId);

      expect(request.disputeId).to.equal(disputeId);
      expect(request.fulfilled).to.be.false;
      expect(request.requestedAt).to.be.gt(0);
    });

    it("Should revert for non-existent request", async function () {
      await expect(
        vrfConsumer.getRequest(999)
      ).to.be.revertedWith("Request not found");
    });
  });

  describe("Configuration Updates", function () {
    it("Should update configuration", async function () {
      const newSubscriptionId = 2;
      const newKeyHash = ethers.keccak256(ethers.toUtf8Bytes("new-key-hash"));
      const newCallbackGasLimit = 200000;
      const newConfirmations = 5;
      const newNumWords = 2;

      await expect(
        vrfConsumer.updateConfig(
          newSubscriptionId,
          newKeyHash,
          newCallbackGasLimit,
          newConfirmations,
          newNumWords
        )
      ).to.emit(vrfConsumer, "ConfigUpdated");

      expect(await vrfConsumer.subscriptionId()).to.equal(newSubscriptionId);
      expect(await vrfConsumer.keyHash()).to.equal(newKeyHash);
      expect(await vrfConsumer.callbackGasLimit()).to.equal(newCallbackGasLimit);
    });

    it("Should reject config update from non-admin", async function () {
      await expect(
        vrfConsumer.connect(user).updateConfig(2, KEY_HASH, 200000, 5, 2)
      ).to.be.reverted;
    });
  });
});

/**
 * Mock VRF Coordinator for testing
 */
const MockVRFCoordinatorABI = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

interface IVRFConsumer {
    function rawFulfillRandomWords(uint256 requestId, uint256[] memory randomWords) external;
}

contract MockVRFCoordinator {
    uint256 private _requestCounter;

    function requestRandomWords(
        bytes32,
        uint256,
        uint16,
        uint32,
        uint32
    ) external returns (uint256 requestId) {
        _requestCounter++;
        return _requestCounter;
    }

    function fulfillRandomWords(uint256 requestId, address consumer) external {
        uint256[] memory randomWords = new uint256[](1);
        randomWords[0] = uint256(keccak256(abi.encodePacked(requestId, block.timestamp)));

        IVRFConsumer(consumer).rawFulfillRandomWords(requestId, randomWords);
    }
}
`;
