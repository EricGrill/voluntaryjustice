const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * Integration Test: Governance Proposal Flow
 *
 * Tests the DAO governance from proposal creation through execution.
 */
describe("Integration: Governance Proposal Flow", function () {
  this.timeout(120000); // 2 minute timeout for governance tests
  let vjToken;
  let exclusionRegistry;
  let vjGovernor;
  let timelock;

  let owner;
  let proposer;
  let voter1;
  let voter2;
  let voter3;
  let excluded;

  const VOTE_AMOUNT = ethers.parseEther("100000"); // 100k tokens for voting

  beforeEach(async function () {
    [owner, proposer, voter1, voter2, voter3, excluded] = await ethers.getSigners();

    // Deploy VJToken
    const VJToken = await ethers.getContractFactory("VJToken");
    vjToken = await VJToken.deploy(owner.address);
    await vjToken.waitForDeployment();

    // Deploy ExclusionRegistry
    const ExclusionRegistry = await ethers.getContractFactory("ExclusionRegistry");
    exclusionRegistry = await ExclusionRegistry.deploy(owner.address);
    await exclusionRegistry.waitForDeployment();

    // Deploy TimelockController
    const TimelockController = await ethers.getContractFactory(
      "@openzeppelin/contracts/governance/TimelockController.sol:TimelockController"
    );
    timelock = await TimelockController.deploy(
      172800, // 48 hours (in seconds)
      [], // proposers - will add governor
      [], // executors - will add governor
      owner.address // admin
    );
    await timelock.waitForDeployment();

    // Deploy VJGovernor
    const VJGovernor = await ethers.getContractFactory("VJGovernor");
    vjGovernor = await VJGovernor.deploy(
      await vjToken.getAddress(),
      await timelock.getAddress(),
      await exclusionRegistry.getAddress()
    );
    await vjGovernor.waitForDeployment();

    // Setup timelock roles for governor
    const PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
    const EXECUTOR_ROLE = await timelock.EXECUTOR_ROLE();
    const CANCELLER_ROLE = await timelock.CANCELLER_ROLE();

    await timelock.grantRole(PROPOSER_ROLE, await vjGovernor.getAddress());
    await timelock.grantRole(EXECUTOR_ROLE, await vjGovernor.getAddress());
    await timelock.grantRole(CANCELLER_ROLE, await vjGovernor.getAddress());

    // Grant GOVERNANCE_ROLE to timelock for exclusion registry
    const GOVERNANCE_ROLE = await exclusionRegistry.GOVERNANCE_ROLE();
    await exclusionRegistry.grantRole(GOVERNANCE_ROLE, await timelock.getAddress());

    // Mint and delegate tokens for voting
    await vjToken.mint(proposer.address, VOTE_AMOUNT);
    await vjToken.mint(voter1.address, VOTE_AMOUNT);
    await vjToken.mint(voter2.address, VOTE_AMOUNT);
    await vjToken.mint(voter3.address, VOTE_AMOUNT);

    // Delegate voting power
    await vjToken.connect(proposer).delegate(proposer.address);
    await vjToken.connect(voter1).delegate(voter1.address);
    await vjToken.connect(voter2).delegate(voter2.address);
    await vjToken.connect(voter3).delegate(voter3.address);

    // Mine blocks to register delegation and allow voting
    for (let i = 0; i < 10; i++) {
      await ethers.provider.send("evm_mine");
    }
  });

  describe("Proposal Creation", function () {
    it("Should create a valid proposal", async function () {
      const targets = [await exclusionRegistry.getAddress()];
      const values = [0];
      const calldatas = [
        exclusionRegistry.interface.encodeFunctionData("addToRegistry", [
          excluded.address,
          ethers.keccak256(ethers.toUtf8Bytes("ruling-hash")),
          "Non-compliance with ruling",
          ethers.parseEther("1000"),
          ethers.parseEther("1000")
        ])
      ];
      const description = "Add bad actor to exclusion registry";

      const tx = await vjGovernor.connect(proposer).propose(
        targets,
        values,
        calldatas,
        description
      );
      const receipt = await tx.wait();

      const event = receipt.logs.find(
        log => log.fragment && log.fragment.name === "ProposalCreated"
      );
      expect(event).to.not.be.undefined;
    });

    it("Should allow proposal from any token holder (no threshold)", async function () {
      // With 0 proposal threshold, any holder can propose
      const [, , , , , , smallHolder] = await ethers.getSigners();
      await vjToken.mint(smallHolder.address, ethers.parseEther("100")); // 100 tokens
      await vjToken.connect(smallHolder).delegate(smallHolder.address);
      await ethers.provider.send("evm_mine");

      const targets = [await exclusionRegistry.getAddress()];
      const values = [0];
      const calldatas = [
        exclusionRegistry.interface.encodeFunctionData("addToRegistry", [
          excluded.address,
          ethers.keccak256(ethers.toUtf8Bytes("ruling-hash")),
          "Test",
          ethers.parseEther("1000"),
          ethers.parseEther("1000")
        ])
      ];

      // With 0 threshold, this should succeed
      const tx = await vjGovernor.connect(smallHolder).propose(targets, values, calldatas, "Test proposal");
      const receipt = await tx.wait();
      expect(receipt.status).to.equal(1);
    });
  });

  describe("Constitutional Constraints", function () {
    it("Should reject forbidden defineCrime selector", async function () {
      // Calculate actual forbidden selector: keccak256("defineCrime(bytes)")
      const forbiddenSelector = ethers.id("defineCrime(bytes)").slice(0, 10); // First 4 bytes
      const targets = [await vjGovernor.getAddress()];
      const values = [0];
      // Create proper calldata with selector + encoded bytes parameter
      const calldatas = [forbiddenSelector + ethers.AbiCoder.defaultAbiCoder().encode(["bytes"], ["0x"]).slice(2)];

      // Should revert with custom error ForbiddenAction
      await expect(
        vjGovernor.connect(proposer).propose(
          targets,
          values,
          calldatas,
          "Forbidden proposal"
        )
      ).to.be.revertedWithCustomError(vjGovernor, "ForbiddenAction");
    });
  });

  describe("Voting", function () {
    let proposalId;

    beforeEach(async function () {
      const targets = [await exclusionRegistry.getAddress()];
      const values = [0];
      const calldatas = [
        exclusionRegistry.interface.encodeFunctionData("addToRegistry", [
          excluded.address,
          ethers.keccak256(ethers.toUtf8Bytes("ruling-hash")),
          "Non-compliance with ruling",
          ethers.parseEther("1000"),
          ethers.parseEther("1000")
        ])
      ];

      const tx = await vjGovernor.connect(proposer).propose(
        targets,
        values,
        calldatas,
        "Add bad actor to exclusion registry"
      );
      const receipt = await tx.wait();

      const event = receipt.logs.find(
        log => log.fragment && log.fragment.name === "ProposalCreated"
      );
      proposalId = event.args[0];

      // Mine blocks to pass voting delay (votingDelay returns blocks, not seconds)
      // VJGovernor uses 1 day voting delay which is ~7200 blocks (assuming 12s blocks)
      // For testing, we'll mine enough blocks
      const votingDelay = await vjGovernor.votingDelay();
      for (let i = 0; i <= Number(votingDelay); i++) {
        await ethers.provider.send("evm_mine");
      }
    });

    it("Should allow voting on proposal", async function () {
      // Vote for (1 = For)
      await vjGovernor.connect(voter1).castVote(proposalId, 1);

      const hasVoted = await vjGovernor.hasVoted(proposalId, voter1.address);
      expect(hasVoted).to.be.true;
    });

    it("Should track vote counts", async function () {
      await vjGovernor.connect(voter1).castVote(proposalId, 1); // For
      await vjGovernor.connect(voter2).castVote(proposalId, 1); // For
      await vjGovernor.connect(voter3).castVote(proposalId, 0); // Against

      const [againstVotes, forVotes, abstainVotes] = await vjGovernor.proposalVotes(proposalId);

      expect(forVotes).to.equal(VOTE_AMOUNT * 2n);
      expect(againstVotes).to.equal(VOTE_AMOUNT);
      expect(abstainVotes).to.equal(0);
    });
  });

  // VJToken uses the default block-number clock, so votingDelay (86400) and
  // votingPeriod (604800) are measured in BLOCKS. We advance them instantly with
  // the `hardhat_mine` RPC instead of mining one block at a time.
  async function mineBlocks(count) {
    const n = BigInt(count) + 1n;
    await ethers.provider.send("hardhat_mine", ["0x" + n.toString(16)]);
  }

  describe("Full Proposal Lifecycle", function () {
    it("Should execute proposal after voting period", async function () {
      const targets = [await exclusionRegistry.getAddress()];
      const values = [0];
      const calldatas = [
        exclusionRegistry.interface.encodeFunctionData("addToRegistry", [
          excluded.address,
          ethers.keccak256(ethers.toUtf8Bytes("ruling-hash")),
          "Non-compliance with ruling",
          ethers.parseEther("1000"),
          ethers.parseEther("1000")
        ])
      ];
      const description = "Add bad actor to exclusion registry";
      const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes(description));

      // Create proposal
      const tx = await vjGovernor.connect(proposer).propose(
        targets,
        values,
        calldatas,
        description
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(
        log => log.fragment && log.fragment.name === "ProposalCreated"
      );
      const proposalId = event.args[0];

      // Advance past voting delay
      await mineBlocks(await vjGovernor.votingDelay());

      // Vote
      await vjGovernor.connect(proposer).castVote(proposalId, 1);
      await vjGovernor.connect(voter1).castVote(proposalId, 1);
      await vjGovernor.connect(voter2).castVote(proposalId, 1);
      await vjGovernor.connect(voter3).castVote(proposalId, 1);

      // Advance past voting period
      await mineBlocks(await vjGovernor.votingPeriod());

      // Succeeded (4) before queueing
      expect(await vjGovernor.state(proposalId)).to.equal(4);

      // Queue proposal
      await vjGovernor.queue(targets, values, calldatas, descriptionHash);

      // Queued (5)
      expect(await vjGovernor.state(proposalId)).to.equal(5);

      // Fast forward past timelock (48 hours)
      await ethers.provider.send("evm_increaseTime", [48 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine");

      // Execute
      await vjGovernor.execute(targets, values, calldatas, descriptionHash);

      // Executed (7) and the action took effect
      expect(await vjGovernor.state(proposalId)).to.equal(7);
      expect(await exclusionRegistry.isExcluded(excluded.address)).to.be.true;
    });
  });

  describe("Proposal States", function () {
    it("Should track proposal state transitions", async function () {
      const targets = [await exclusionRegistry.getAddress()];
      const values = [0];
      const calldatas = [
        exclusionRegistry.interface.encodeFunctionData("addToRegistry", [
          excluded.address,
          ethers.keccak256(ethers.toUtf8Bytes("ruling-hash")),
          "Test",
          ethers.parseEther("1000"),
          ethers.parseEther("1000")
        ])
      ];

      // Create proposal
      const tx = await vjGovernor.connect(proposer).propose(
        targets,
        values,
        calldatas,
        "Test proposal"
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(
        log => log.fragment && log.fragment.name === "ProposalCreated"
      );
      const proposalId = event.args[0];

      // State: Pending (0)
      expect(await vjGovernor.state(proposalId)).to.equal(0);

      // Advance past voting delay
      await mineBlocks(await vjGovernor.votingDelay());

      // State: Active (1)
      expect(await vjGovernor.state(proposalId)).to.equal(1);

      // Vote
      await vjGovernor.connect(proposer).castVote(proposalId, 1);
      await vjGovernor.connect(voter1).castVote(proposalId, 1);
      await vjGovernor.connect(voter2).castVote(proposalId, 1);

      // Advance past voting period
      await mineBlocks(await vjGovernor.votingPeriod());

      // State: Succeeded (4)
      expect(await vjGovernor.state(proposalId)).to.equal(4);
    });

    it("Should mark a proposal Defeated when quorum is not met", async function () {
      const targets = [await exclusionRegistry.getAddress()];
      const values = [0];
      const calldatas = [
        exclusionRegistry.interface.encodeFunctionData("addToRegistry", [
          excluded.address,
          ethers.keccak256(ethers.toUtf8Bytes("ruling-hash")),
          "Test",
          ethers.parseEther("1000"),
          ethers.parseEther("1000")
        ])
      ];

      const tx = await vjGovernor.connect(proposer).propose(
        targets, values, calldatas, "Lonely against proposal"
      );
      const receipt = await tx.wait();
      const proposalId = receipt.logs.find(
        log => log.fragment && log.fragment.name === "ProposalCreated"
      ).args[0];

      await mineBlocks(await vjGovernor.votingDelay());

      // Single Against vote — well below 10% quorum of total supply
      await vjGovernor.connect(voter1).castVote(proposalId, 0);

      await mineBlocks(await vjGovernor.votingPeriod());

      // State: Defeated (3)
      expect(await vjGovernor.state(proposalId)).to.equal(3);
    });
  });

  describe("Governance-Only Actions (via Timelock)", function () {
    // Helper: run a proposal that targets the governor itself and execute it.
    async function runGovernorProposal(calldata, description) {
      const targets = [await vjGovernor.getAddress()];
      const values = [0];
      const calldatas = [calldata];
      const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes(description));

      const tx = await vjGovernor.connect(proposer).propose(targets, values, calldatas, description);
      const receipt = await tx.wait();
      const proposalId = receipt.logs.find(
        log => log.fragment && log.fragment.name === "ProposalCreated"
      ).args[0];

      await mineBlocks(await vjGovernor.votingDelay());
      await vjGovernor.connect(proposer).castVote(proposalId, 1);
      await vjGovernor.connect(voter1).castVote(proposalId, 1);
      await vjGovernor.connect(voter2).castVote(proposalId, 1);
      await vjGovernor.connect(voter3).castVote(proposalId, 1);
      await mineBlocks(await vjGovernor.votingPeriod());

      await vjGovernor.queue(targets, values, calldatas, descriptionHash);
      await ethers.provider.send("evm_increaseTime", [48 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine");
      await vjGovernor.execute(targets, values, calldatas, descriptionHash);
    }

    it("Should update fee parameters through governance", async function () {
      const calldata = vjGovernor.interface.encodeFunctionData("updateFeeParameters", [
        ethers.parseEther("0.01"),
        ethers.parseEther("0.005"),
        ethers.parseEther("0.001")
      ]);
      await runGovernorProposal(calldata, "Update fees");

      expect(await vjGovernor.disputeFilingFee()).to.equal(ethers.parseEther("0.01"));
      expect(await vjGovernor.contractCreationFee()).to.equal(ethers.parseEther("0.005"));
      expect(await vjGovernor.insurancePolicyFee()).to.equal(ethers.parseEther("0.001"));
    });

    it("Should pause and report paused state through governance", async function () {
      const calldata = vjGovernor.interface.encodeFunctionData("pauseProtocol", [3 * 24 * 60 * 60]);
      await runGovernorProposal(calldata, "Pause protocol");

      expect(await vjGovernor.paused()).to.be.true;
      expect(await vjGovernor.isPaused()).to.be.true;
    });

    it("Should reject onlyGovernance calls made directly", async function () {
      await expect(
        vjGovernor.connect(proposer).updateFeeParameters(1, 2, 3)
      ).to.be.revertedWithCustomError(vjGovernor, "GovernorOnlyExecutor");

      await expect(
        vjGovernor.connect(proposer).pauseProtocol(1000)
      ).to.be.revertedWithCustomError(vjGovernor, "GovernorOnlyExecutor");

      await expect(
        vjGovernor.connect(proposer).addToExclusionRegistry(
          excluded.address, ethers.ZeroHash, "x", 1, 1
        )
      ).to.be.revertedWithCustomError(vjGovernor, "GovernorOnlyExecutor");

      await expect(
        vjGovernor.connect(proposer).removeFromExclusionRegistry(excluded.address, "x")
      ).to.be.revertedWithCustomError(vjGovernor, "GovernorOnlyExecutor");
    });

    it("Should add to and remove from the exclusion registry through governance", async function () {
      // Governor needs GOVERNANCE_ROLE on the registry to call it on its own behalf
      const GOVERNANCE_ROLE = await exclusionRegistry.GOVERNANCE_ROLE();
      await exclusionRegistry.grantRole(GOVERNANCE_ROLE, await vjGovernor.getAddress());

      const rulingHash = ethers.keccak256(ethers.toUtf8Bytes("ruling"));
      const addCalldata = vjGovernor.interface.encodeFunctionData("addToExclusionRegistry", [
        excluded.address, rulingHash, "Non-compliance", ethers.parseEther("1000"), ethers.parseEther("1000")
      ]);
      await runGovernorProposal(addCalldata, "Exclude account");
      expect(await exclusionRegistry.isExcluded(excluded.address)).to.be.true;

      const removeCalldata = vjGovernor.interface.encodeFunctionData("removeFromExclusionRegistry", [
        excluded.address, "Debt settled"
      ]);
      await runGovernorProposal(removeCalldata, "Re-include account");
      expect(await exclusionRegistry.isExcluded(excluded.address)).to.be.false;
    });
  });

  describe("Pause / Unpause edge cases", function () {
    it("Should revert unpause when not paused", async function () {
      await expect(
        vjGovernor.connect(proposer).unpauseProtocol()
      ).to.be.revertedWithCustomError(vjGovernor, "NotPaused");
    });

    it("Should allow anyone to unpause only after expiry", async function () {
      // Pause for 1 day via governance
      const pauseCalldata = vjGovernor.interface.encodeFunctionData("pauseProtocol", [24 * 60 * 60]);
      const targets = [await vjGovernor.getAddress()];
      const values = [0];
      const calldatas = [pauseCalldata];
      const description = "Pause for a day";
      const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes(description));

      const tx = await vjGovernor.connect(proposer).propose(targets, values, calldatas, description);
      const proposalId = (await tx.wait()).logs.find(
        log => log.fragment && log.fragment.name === "ProposalCreated"
      ).args[0];

      await ethers.provider.send("hardhat_mine", ["0x" + (BigInt(await vjGovernor.votingDelay()) + 1n).toString(16)]);
      await vjGovernor.connect(proposer).castVote(proposalId, 1);
      await vjGovernor.connect(voter1).castVote(proposalId, 1);
      await vjGovernor.connect(voter2).castVote(proposalId, 1);
      await vjGovernor.connect(voter3).castVote(proposalId, 1);
      await ethers.provider.send("hardhat_mine", ["0x" + (BigInt(await vjGovernor.votingPeriod()) + 1n).toString(16)]);

      await vjGovernor.queue(targets, values, calldatas, descriptionHash);
      await ethers.provider.send("evm_increaseTime", [48 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine");
      await vjGovernor.execute(targets, values, calldatas, descriptionHash);

      expect(await vjGovernor.isPaused()).to.be.true;

      // Before expiry, a non-governance caller cannot unpause
      await expect(
        vjGovernor.connect(voter1).unpauseProtocol()
      ).to.be.revertedWithCustomError(vjGovernor, "ProtocolIsPaused");

      // After expiry, anyone can unpause
      await ethers.provider.send("evm_increaseTime", [24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine");
      await vjGovernor.connect(voter1).unpauseProtocol();

      expect(await vjGovernor.paused()).to.be.false;
      expect(await vjGovernor.isPaused()).to.be.false;
    });
  });

  describe("Quorum", function () {
    it("Should have quorum configured", async function () {
      // Check quorum numerator is set (10%)
      const quorumNumerator = await vjGovernor.quorumNumerator();
      expect(quorumNumerator).to.equal(10);
    });
  });
});
