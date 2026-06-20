const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("VJGovernor", function () {
  let vjGovernor;
  let vjToken;
  let timelock;
  let exclusionRegistry;
  let owner;
  let voter1;
  let voter2;
  let user;

  const VOTING_DELAY = 1 * 24 * 60 * 60; // 1 day
  const VOTING_PERIOD = 7 * 24 * 60 * 60; // 7 days
  const MIN_DELAY = 48 * 60 * 60; // 48 hours timelock

  beforeEach(async function () {
    [owner, voter1, voter2, user] = await ethers.getSigners();

    // Deploy VJToken
    const VJToken = await ethers.getContractFactory("VJToken");
    vjToken = await VJToken.deploy(owner.address);
    await vjToken.waitForDeployment();

    // Deploy ExclusionRegistry
    const ExclusionRegistry = await ethers.getContractFactory("ExclusionRegistry");
    exclusionRegistry = await ExclusionRegistry.deploy(owner.address);
    await exclusionRegistry.waitForDeployment();

    // Deploy TimelockController
    const TimelockController = await ethers.getContractFactory("@openzeppelin/contracts/governance/TimelockController.sol:TimelockController");
    timelock = await TimelockController.deploy(
      MIN_DELAY,
      [], // proposers - will be set after governor deploy
      [], // executors - will be set after governor deploy
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

    // Setup roles on timelock
    const PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
    const EXECUTOR_ROLE = await timelock.EXECUTOR_ROLE();
    const CANCELLER_ROLE = await timelock.CANCELLER_ROLE();

    await timelock.grantRole(PROPOSER_ROLE, await vjGovernor.getAddress());
    await timelock.grantRole(EXECUTOR_ROLE, await vjGovernor.getAddress());
    await timelock.grantRole(CANCELLER_ROLE, await vjGovernor.getAddress());

    // Setup exclusion registry
    const GOVERNANCE_ROLE = await exclusionRegistry.GOVERNANCE_ROLE();
    await exclusionRegistry.grantRole(GOVERNANCE_ROLE, await vjGovernor.getAddress());

    // Mint and delegate tokens for voting
    await vjToken.mint(voter1.address, ethers.parseEther("10000"));
    await vjToken.mint(voter2.address, ethers.parseEther("10000"));

    // Delegates must self-delegate to activate voting power
    await vjToken.connect(voter1).delegate(voter1.address);
    await vjToken.connect(voter2).delegate(voter2.address);
  });

  describe("Deployment", function () {
    it("Should set correct token", async function () {
      expect(await vjGovernor.token()).to.equal(await vjToken.getAddress());
    });

    it("Should set correct exclusion registry", async function () {
      expect(await vjGovernor.exclusionRegistry()).to.equal(await exclusionRegistry.getAddress());
    });

    it("Should have correct voting delay", async function () {
      expect(await vjGovernor.votingDelay()).to.equal(VOTING_DELAY);
    });

    it("Should have correct voting period", async function () {
      expect(await vjGovernor.votingPeriod()).to.equal(VOTING_PERIOD);
    });

    it("Should have 10% quorum", async function () {
      expect(await vjGovernor.quorumNumerator()).to.equal(10);
    });
  });

  describe("Pause Functionality", function () {
    it("Should start unpaused", async function () {
      expect(await vjGovernor.isPaused()).to.be.false;
    });

    it("Should have max pause duration of 7 days", async function () {
      expect(await vjGovernor.MAX_PAUSE_DURATION()).to.equal(7 * 24 * 60 * 60);
    });
  });

  describe("Fee Parameters", function () {
    it("Should start with zero fees", async function () {
      expect(await vjGovernor.disputeFilingFee()).to.equal(0);
      expect(await vjGovernor.contractCreationFee()).to.equal(0);
      expect(await vjGovernor.insurancePolicyFee()).to.equal(0);
    });
  });

  describe("Constitutional Constraints", function () {
    it("Should reject proposal with forbidden defineCrime selector", async function () {
      const forbiddenCalldata = ethers.id("defineCrime(bytes)").slice(0, 10) + "0".repeat(56);

      await expect(
        vjGovernor.connect(voter1).propose(
          [user.address],
          [0],
          [forbiddenCalldata],
          "Forbidden proposal"
        )
      ).to.be.revertedWithCustomError(vjGovernor, "ForbiddenAction");
    });

    it("Should reject proposal with forbidden overrideContract selector", async function () {
      const forbiddenCalldata = ethers.id("overrideContract(uint256)").slice(0, 10) + "0".repeat(56);

      await expect(
        vjGovernor.connect(voter1).propose(
          [user.address],
          [0],
          [forbiddenCalldata],
          "Forbidden proposal"
        )
      ).to.be.revertedWithCustomError(vjGovernor, "ForbiddenAction");
    });

    it("Should reject proposal with forbidden grantImmunity selector", async function () {
      const forbiddenCalldata = ethers.id("grantImmunity(address)").slice(0, 10) + "0".repeat(56);

      await expect(
        vjGovernor.connect(voter1).propose(
          [user.address],
          [0],
          [forbiddenCalldata],
          "Forbidden proposal"
        )
      ).to.be.revertedWithCustomError(vjGovernor, "ForbiddenAction");
    });

    it("Should reject proposal with forbidden compelParticipation selector", async function () {
      const forbiddenCalldata = ethers.id("compelParticipation(address)").slice(0, 10) + "0".repeat(56);

      await expect(
        vjGovernor.connect(voter1).propose(
          [user.address],
          [0],
          [forbiddenCalldata],
          "Forbidden proposal"
        )
      ).to.be.revertedWithCustomError(vjGovernor, "ForbiddenAction");
    });

    it("Should allow proposal with allowed selector", async function () {
      // This should not revert - just testing the proposal creation
      const calldata = vjGovernor.interface.encodeFunctionData("updateFeeParameters", [100, 200, 300]);

      // Need to mine a block after delegation for voting power
      await time.increase(1);

      const tx = await vjGovernor.connect(voter1).propose(
        [await vjGovernor.getAddress()],
        [0],
        [calldata],
        "Update fees"
      );

      const receipt = await tx.wait();
      expect(receipt.status).to.equal(1);
    });
  });

  describe("Proposal Creation", function () {
    it("Should allow creating a valid proposal", async function () {
      const calldata = vjGovernor.interface.encodeFunctionData("updateFeeParameters", [
        ethers.parseEther("0.01"),
        ethers.parseEther("0.005"),
        ethers.parseEther("0.001")
      ]);

      await time.increase(1);

      const tx = await vjGovernor.connect(voter1).propose(
        [await vjGovernor.getAddress()],
        [0],
        [calldata],
        "Update protocol fees"
      );

      const receipt = await tx.wait();
      const event = receipt.logs.find(log => {
        try {
          return vjGovernor.interface.parseLog(log)?.name === "ProposalCreated";
        } catch {
          return false;
        }
      });

      expect(event).to.not.be.undefined;
    });
  });

  describe("Proposal edge cases", function () {
    it("Should allow a proposal whose calldata is shorter than 4 bytes", async function () {
      // Exercises the `calldatas[i].length >= 4` false branch in propose()
      await time.increase(1);
      const tx = await vjGovernor.connect(voter1).propose(
        [user.address],
        [0],
        ["0x"],
        "Empty-calldata proposal"
      );
      const receipt = await tx.wait();
      expect(receipt.status).to.equal(1);
    });

    it("Should let the proposer cancel a pending proposal", async function () {
      await time.increase(1);
      const targets = [await vjGovernor.getAddress()];
      const values = [0];
      const calldatas = [vjGovernor.interface.encodeFunctionData("updateFeeParameters", [1, 2, 3])];
      const description = "Cancellable proposal";

      const tx = await vjGovernor.connect(voter1).propose(targets, values, calldatas, description);
      const proposalId = (await tx.wait()).logs.find(
        log => log.fragment && log.fragment.name === "ProposalCreated"
      ).args[0];

      // Pending (0) -> cancel by proposer
      expect(await vjGovernor.state(proposalId)).to.equal(0);
      await vjGovernor.connect(voter1).cancel(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));

      // Canceled (2)
      expect(await vjGovernor.state(proposalId)).to.equal(2);
    });
  });

  describe("ExclusionRegistry Integration", function () {
    it("Should have exclusion registry reference", async function () {
      expect(await vjGovernor.exclusionRegistry()).to.equal(await exclusionRegistry.getAddress());
    });
  });

  describe("Timelock Integration", function () {
    it("Should use timelock for execution", async function () {
      // Check that proposals need queuing
      // Create a proposal first
      const calldata = vjGovernor.interface.encodeFunctionData("updateFeeParameters", [100, 200, 300]);
      await time.increase(1);

      const tx = await vjGovernor.connect(voter1).propose(
        [await vjGovernor.getAddress()],
        [0],
        [calldata],
        "Test proposal"
      );

      const receipt = await tx.wait();
      const event = receipt.logs.find(log => {
        try {
          return vjGovernor.interface.parseLog(log)?.name === "ProposalCreated";
        } catch {
          return false;
        }
      });

      const parsedEvent = vjGovernor.interface.parseLog(event);
      const proposalId = parsedEvent.args[0];

      // Proposals should need queuing
      expect(await vjGovernor.proposalNeedsQueuing(proposalId)).to.be.true;
    });
  });
});

describe("VJGovernor Constitutional Constraints", function () {
  it("Should define forbidden selectors", async function () {
    const FORBIDDEN_1 = ethers.id("defineCrime(bytes)").slice(0, 10);
    const FORBIDDEN_2 = ethers.id("overrideContract(uint256)").slice(0, 10);
    const FORBIDDEN_3 = ethers.id("grantImmunity(address)").slice(0, 10);
    const FORBIDDEN_4 = ethers.id("compelParticipation(address)").slice(0, 10);

    expect(FORBIDDEN_1).to.have.length(10);
    expect(FORBIDDEN_2).to.have.length(10);
    expect(FORBIDDEN_3).to.have.length(10);
    expect(FORBIDDEN_4).to.have.length(10);
  });
});
