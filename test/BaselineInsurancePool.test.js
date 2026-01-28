const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("BaselineInsurancePool", function () {
  let insurancePool;
  let disputeResolution;
  let contractFactory;
  let templateRegistry;
  let courtRegistry;
  let reputationScoring;
  let vjToken;
  let owner;
  let claimsProcessor;
  let depositor1;
  let depositor2;
  let party1;
  let party2;
  let courtOperator;

  const EVIDENCE_PERIOD = 7 * 24 * 60 * 60;
  const depositAmount = ethers.parseEther("1000");

  beforeEach(async function () {
    [owner, claimsProcessor, depositor1, depositor2, party1, party2, courtOperator] = await ethers.getSigners();

    // Deploy all dependencies
    const VJToken = await ethers.getContractFactory("VJToken");
    vjToken = await VJToken.deploy(owner.address);
    await vjToken.waitForDeployment();

    const ReputationScoring = await ethers.getContractFactory("ReputationScoring");
    reputationScoring = await ReputationScoring.deploy(owner.address);
    await reputationScoring.waitForDeployment();

    const ContractTemplateRegistry = await ethers.getContractFactory("ContractTemplateRegistry");
    templateRegistry = await ContractTemplateRegistry.deploy(owner.address);
    await templateRegistry.waitForDeployment();

    const ContractFactory = await ethers.getContractFactory("ContractFactory");
    contractFactory = await ContractFactory.deploy(
      owner.address,
      await templateRegistry.getAddress(),
      await reputationScoring.getAddress()
    );
    await contractFactory.waitForDeployment();

    const CourtRegistry = await ethers.getContractFactory("CourtRegistry");
    courtRegistry = await CourtRegistry.deploy(owner.address, await vjToken.getAddress());
    await courtRegistry.waitForDeployment();

    const DisputeResolution = await ethers.getContractFactory("DisputeResolution");
    disputeResolution = await DisputeResolution.deploy(
      owner.address,
      await contractFactory.getAddress(),
      await courtRegistry.getAddress(),
      await reputationScoring.getAddress(),
      await vjToken.getAddress()
    );
    await disputeResolution.waitForDeployment();

    // Deploy BaselineInsurancePool
    const BaselineInsurancePool = await ethers.getContractFactory("BaselineInsurancePool");
    insurancePool = await BaselineInsurancePool.deploy(
      owner.address,
      await vjToken.getAddress(),
      await disputeResolution.getAddress()
    );
    await insurancePool.waitForDeployment();

    // Setup roles
    const AUTHORIZED_CONTRACT_ROLE = await reputationScoring.AUTHORIZED_CONTRACT_ROLE();
    await reputationScoring.grantRole(AUTHORIZED_CONTRACT_ROLE, await contractFactory.getAddress());
    await reputationScoring.grantRole(AUTHORIZED_CONTRACT_ROLE, await disputeResolution.getAddress());

    const SYSTEM_ROLE = await contractFactory.SYSTEM_ROLE();
    await contractFactory.grantRole(SYSTEM_ROLE, await disputeResolution.getAddress());

    const CLAIMS_ROLE = await insurancePool.CLAIMS_ROLE();
    await insurancePool.grantRole(CLAIMS_ROLE, claimsProcessor.address);

    // Mint tokens
    await vjToken.mint(depositor1.address, ethers.parseEther("10000"));
    await vjToken.mint(depositor2.address, ethers.parseEther("10000"));
    await vjToken.mint(party1.address, ethers.parseEther("10000"));
    await vjToken.mint(courtOperator.address, ethers.parseEther("10000"));

    // Approve insurance pool
    await vjToken.connect(depositor1).approve(await insurancePool.getAddress(), ethers.MaxUint256);
    await vjToken.connect(depositor2).approve(await insurancePool.getAddress(), ethers.MaxUint256);

    // Setup court
    await vjToken.connect(courtOperator).approve(await courtRegistry.getAddress(), ethers.MaxUint256);
    await courtRegistry.connect(courtOperator).registerCourt(
      "ipfs://QmCourt",
      ethers.parseEther("1000"),
      ethers.keccak256(ethers.toUtf8Bytes("ruleset"))
    );

    // Register template
    await templateRegistry.registerTemplate(
      ethers.keccak256(ethers.toUtf8Bytes("template")),
      "ipfs://QmTemplate",
      courtOperator.address,
      0
    );
  });

  describe("Deployment", function () {
    it("Should set correct VJ token", async function () {
      expect(await insurancePool.vjToken()).to.equal(await vjToken.getAddress());
    });

    it("Should set correct dispute resolution", async function () {
      expect(await insurancePool.disputeResolution()).to.equal(await disputeResolution.getAddress());
    });

    it("Should start with zero reserves", async function () {
      expect(await insurancePool.totalReserves()).to.equal(0);
    });
  });

  describe("Deposits", function () {
    it("Should accept deposit", async function () {
      await insurancePool.connect(depositor1).deposit(depositAmount);

      expect(await insurancePool.totalReserves()).to.equal(depositAmount);
    });

    it("Should emit Deposited event", async function () {
      await expect(insurancePool.connect(depositor1).deposit(depositAmount))
        .to.emit(insurancePool, "Deposited")
        .withArgs(depositor1.address, depositAmount);
    });

    it("Should update coverage info", async function () {
      await insurancePool.connect(depositor1).deposit(depositAmount);

      const coverage = await insurancePool.getCoverage(depositor1.address);
      expect(coverage.totalContribution).to.equal(depositAmount);
      expect(coverage.coverageLimit).to.equal(depositAmount * 10n); // 10x coverage
      expect(coverage.active).to.be.true;
    });

    it("Should reject zero deposit", async function () {
      await expect(
        insurancePool.connect(depositor1).deposit(0)
      ).to.be.revertedWith("Amount must be positive");
    });
  });

  describe("Withdrawals", function () {
    beforeEach(async function () {
      await insurancePool.connect(depositor1).deposit(depositAmount);
    });

    it("Should allow withdrawal", async function () {
      const balanceBefore = await vjToken.balanceOf(depositor1.address);
      await insurancePool.connect(depositor1).withdraw(depositAmount / 2n);
      const balanceAfter = await vjToken.balanceOf(depositor1.address);

      expect(balanceAfter - balanceBefore).to.equal(depositAmount / 2n);
    });

    it("Should emit Withdrawn event", async function () {
      await expect(insurancePool.connect(depositor1).withdraw(depositAmount / 2n))
        .to.emit(insurancePool, "Withdrawn")
        .withArgs(depositor1.address, depositAmount / 2n);
    });

    it("Should update coverage info on withdrawal", async function () {
      await insurancePool.connect(depositor1).withdraw(depositAmount / 2n);

      const coverage = await insurancePool.getCoverage(depositor1.address);
      expect(coverage.totalContribution).to.equal(depositAmount / 2n);
    });

    it("Should deactivate coverage on full withdrawal", async function () {
      await insurancePool.connect(depositor1).withdraw(depositAmount);

      const coverage = await insurancePool.getCoverage(depositor1.address);
      expect(coverage.active).to.be.false;
    });

    it("Should reject withdrawal exceeding contribution", async function () {
      await expect(
        insurancePool.connect(depositor1).withdraw(depositAmount * 2n)
      ).to.be.revertedWith("Insufficient contribution");
    });
  });

  describe("Pool Health", function () {
    it("Should report correct pool health", async function () {
      await insurancePool.connect(depositor1).deposit(depositAmount);

      const [reserves, obligations, ratio] = await insurancePool.getPoolHealth();
      expect(reserves).to.equal(depositAmount);
      // Obligations only track pending claims, not coverage limits
      expect(obligations).to.equal(0);
      expect(ratio).to.equal(10000); // 100% when no pending claims
    });

    it("Should start with 100% ratio when no obligations", async function () {
      const [, , ratio] = await insurancePool.getPoolHealth();
      expect(ratio).to.equal(10000); // 100% in basis points
    });
  });

  describe("View Functions", function () {
    it("Should return empty coverage for non-depositor", async function () {
      const coverage = await insurancePool.getCoverage(depositor1.address);
      expect(coverage.totalContribution).to.equal(0);
      expect(coverage.active).to.be.false;
    });

    it("Should reject getClaim for non-existent claim", async function () {
      await expect(insurancePool.getClaim(999))
        .to.be.revertedWith("Claim does not exist");
    });
  });

  describe("Claims - Filing", function () {
    it("Should reject claim without active coverage", async function () {
      await expect(
        insurancePool.connect(depositor1).fileClaim(1)
      ).to.be.revertedWith("No active coverage");
    });
  });

  describe("Claims - Processing", function () {
    beforeEach(async function () {
      await insurancePool.connect(depositor1).deposit(depositAmount);
    });

    it("Should reject processing non-existent claim", async function () {
      await expect(
        insurancePool.connect(claimsProcessor).processClaim(999, true)
      ).to.be.revertedWith("Claim does not exist");
    });

    it("Should require CLAIMS_ROLE for processing", async function () {
      // depositor1 doesn't have CLAIMS_ROLE
      await expect(
        insurancePool.connect(depositor1).processClaim(1, true)
      ).to.be.reverted;
    });
  });

  describe("Reserve Ratio with Pending Claims", function () {
    beforeEach(async function () {
      // depositor1 and depositor2 both deposit
      await insurancePool.connect(depositor1).deposit(depositAmount);
      await insurancePool.connect(depositor2).deposit(depositAmount);
    });

    it("Should allow full withdrawal when no pending claims", async function () {
      // Can withdraw full amount when no obligations
      await insurancePool.connect(depositor1).withdraw(depositAmount);

      const coverage = await insurancePool.getCoverage(depositor1.address);
      expect(coverage.totalContribution).to.equal(0);
    });

    it("Should track multiple depositors correctly", async function () {
      const [reserves, , ] = await insurancePool.getPoolHealth();
      expect(reserves).to.equal(depositAmount * 2n);

      const coverage1 = await insurancePool.getCoverage(depositor1.address);
      const coverage2 = await insurancePool.getCoverage(depositor2.address);
      expect(coverage1.totalContribution).to.equal(depositAmount);
      expect(coverage2.totalContribution).to.equal(depositAmount);
    });
  });

  describe("Multiple Deposits", function () {
    it("Should accumulate deposits correctly", async function () {
      await insurancePool.connect(depositor1).deposit(depositAmount);
      await insurancePool.connect(depositor1).deposit(depositAmount);

      const coverage = await insurancePool.getCoverage(depositor1.address);
      expect(coverage.totalContribution).to.equal(depositAmount * 2n);
      expect(coverage.coverageLimit).to.equal(depositAmount * 20n); // 10x of total
    });

    it("Should track total reserves across depositors", async function () {
      await insurancePool.connect(depositor1).deposit(depositAmount);
      await insurancePool.connect(depositor2).deposit(depositAmount * 2n);

      expect(await insurancePool.totalReserves()).to.equal(depositAmount * 3n);
    });
  });

  describe("Constants", function () {
    it("Should have correct MIN_RESERVE_RATIO", async function () {
      expect(await insurancePool.MIN_RESERVE_RATIO()).to.equal(2000);
    });

    it("Should have correct MAX_COVERAGE_RATIO", async function () {
      expect(await insurancePool.MAX_COVERAGE_RATIO()).to.equal(5000);
    });
  });

  describe("Role Management", function () {
    it("Should have GOVERNANCE_ROLE defined", async function () {
      const role = await insurancePool.GOVERNANCE_ROLE();
      expect(role).to.not.equal(ethers.ZeroHash);
    });

    it("Should have CLAIMS_ROLE defined", async function () {
      const role = await insurancePool.CLAIMS_ROLE();
      expect(role).to.not.equal(ethers.ZeroHash);
    });

    it("Should allow admin to grant CLAIMS_ROLE", async function () {
      const CLAIMS_ROLE = await insurancePool.CLAIMS_ROLE();
      await insurancePool.grantRole(CLAIMS_ROLE, depositor2.address);
      expect(await insurancePool.hasRole(CLAIMS_ROLE, depositor2.address)).to.be.true;
    });
  });
});
