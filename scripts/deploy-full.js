const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

// Deployment parameters
const PARAMS = {
  votingDelay: 1,
  votingPeriod: 50400,
  proposalThreshold: 0,
  quorumPercentage: 4,
};

async function main() {
  const network = hre.network.name;
  console.log(`\n🚀 Deploying VoluntaryJustice to ${network}...\n`);

  const [deployer] = await hre.ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance: ${hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address))} ETH\n`);

  const deployedAddresses = {};

  async function deploy(name, ...args) {
    console.log(`Deploying ${name}...`);
    const Contract = await hre.ethers.getContractFactory(name);
    const contract = await Contract.deploy(...args);
    await contract.waitForDeployment();
    const address = await contract.getAddress();
    deployedAddresses[name] = address;
    console.log(`  ✓ ${name}: ${address}`);
    return contract;
  }

  // ============================================
  // PHASE 1: Core Infrastructure
  // ============================================
  console.log("\n📦 Phase 1: Core Infrastructure\n");

  const vjToken = await deploy("VJToken", deployer.address);
  const identityRegistry = await deploy("IdentityRegistry", deployer.address);
  const reputationScoring = await deploy("ReputationScoring", deployer.address);

  // ============================================
  // PHASE 2: Contract System
  // ============================================
  console.log("\n📦 Phase 2: Contract System\n");

  const templateRegistry = await deploy("ContractTemplateRegistry", deployer.address);
  const escrowVault = await deploy("EscrowVault", deployer.address);
  const contractFactory = await deploy(
    "ContractFactory",
    deployer.address,
    await templateRegistry.getAddress(),
    await escrowVault.getAddress()
  );

  // ============================================
  // PHASE 3: Court System
  // ============================================
  console.log("\n📦 Phase 3: Court System\n");

  const courtRegistry = await deploy("CourtRegistry", deployer.address, await vjToken.getAddress());
  const jurorPool = await deploy("JurorPool", deployer.address, await vjToken.getAddress());
  const stakingRewards = await deploy("StakingRewards", deployer.address, await vjToken.getAddress());

  // DisputeResolution: admin, contractFactory, courtRegistry, reputationScoring, vjToken
  const disputeResolution = await deploy(
    "DisputeResolution",
    deployer.address,
    await contractFactory.getAddress(),
    await courtRegistry.getAddress(),
    await reputationScoring.getAddress(),
    await vjToken.getAddress()
  );

  // ============================================
  // PHASE 4: Insurance
  // ============================================
  console.log("\n📦 Phase 4: Insurance\n");

  // BaselineInsurancePool: admin, vjToken, disputeResolution
  const baselinePool = await deploy(
    "BaselineInsurancePool",
    deployer.address,
    await vjToken.getAddress(),
    await disputeResolution.getAddress()
  );

  const insurerRegistry = await deploy("InsurerRegistry", deployer.address, await vjToken.getAddress());

  // InsurancePolicy: admin, vjToken, insurerRegistry, disputeResolution
  const insurancePolicy = await deploy(
    "InsurancePolicy",
    deployer.address,
    await vjToken.getAddress(),
    await insurerRegistry.getAddress(),
    await disputeResolution.getAddress()
  );

  // ============================================
  // PHASE 5: Enforcement & Exclusion
  // ============================================
  console.log("\n📦 Phase 5: Enforcement & Exclusion\n");

  const exclusionRegistry = await deploy("ExclusionRegistry", deployer.address);

  // EnforcementEngine: admin, disputeResolution, escrowVault, reputationScoring, insurancePool
  const enforcementEngine = await deploy(
    "EnforcementEngine",
    deployer.address,
    await disputeResolution.getAddress(),
    await escrowVault.getAddress(),
    await reputationScoring.getAddress(),
    await baselinePool.getAddress()
  );

  // BountyMarket: admin, vjToken, disputeResolution
  const bountyMarket = await deploy(
    "BountyMarket",
    deployer.address,
    await vjToken.getAddress(),
    await disputeResolution.getAddress()
  );

  // ============================================
  // PHASE 6: Governance
  // ============================================
  console.log("\n📦 Phase 6: Governance\n");

  // Deploy TimelockController from OpenZeppelin
  console.log("Deploying TimelockController...");
  const TimelockController = await hre.ethers.getContractFactory("@openzeppelin/contracts/governance/TimelockController.sol:TimelockController");
  const timelock = await TimelockController.deploy(
    2 * 24 * 60 * 60, // 2 day delay
    [], // proposers (governor will be added)
    [], // executors (governor will be added)
    deployer.address // admin
  );
  await timelock.waitForDeployment();
  deployedAddresses["TimelockController"] = await timelock.getAddress();
  console.log(`  ✓ TimelockController: ${await timelock.getAddress()}`);

  // VJGovernor: token, timelock, exclusionRegistry
  const governor = await deploy(
    "VJGovernor",
    await vjToken.getAddress(),
    await timelock.getAddress(),
    await exclusionRegistry.getAddress()
  );

  // Configure timelock roles for governor
  const PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
  const EXECUTOR_ROLE = await timelock.EXECUTOR_ROLE();
  await timelock.grantRole(PROPOSER_ROLE, await governor.getAddress());
  await timelock.grantRole(EXECUTOR_ROLE, await governor.getAddress());
  console.log("  ✓ Governor roles configured on Timelock");

  // ============================================
  // PHASE 7: Oracle & Bridges
  // ============================================
  console.log("\n📦 Phase 7: Oracle & Bridges\n");

  const oracleRegistry = await deploy("OracleRegistry", deployer.address, await vjToken.getAddress());
  const legacyBridge = await deploy("LegacyCourtBridge", deployer.address);
  const rulingAnchor = await deploy("RulingAnchor", deployer.address);
  const crossChainBridge = await deploy("CrossChainBridge", deployer.address);

  // VRF (mock for local)
  if (network === "hardhat" || network === "localhost") {
    const mockVRF = await deploy("MockVRFCoordinator");
    await deploy(
      "VRFConsumer",
      deployer.address,
      await mockVRF.getAddress(),
      1, // subscriptionId
      "0x0000000000000000000000000000000000000000000000000000000000000000" // keyHash
    );
  }

  // ============================================
  // POST-DEPLOYMENT CONFIGURATION
  // ============================================
  console.log("\n⚙️  Post-Deployment Configuration\n");

  // Grant roles
  const SYSTEM_ROLE = await disputeResolution.SYSTEM_ROLE();
  await disputeResolution.grantRole(SYSTEM_ROLE, await enforcementEngine.getAddress());
  console.log("  ✓ EnforcementEngine linked to DisputeResolution");

  const CONTRACT_FACTORY_ROLE = await escrowVault.CONTRACT_FACTORY_ROLE();
  const ENFORCEMENT_ROLE = await escrowVault.ENFORCEMENT_ROLE();
  await escrowVault.grantRole(CONTRACT_FACTORY_ROLE, await contractFactory.getAddress());
  await escrowVault.grantRole(ENFORCEMENT_ROLE, await enforcementEngine.getAddress());
  console.log("  ✓ EscrowVault roles configured");

  // Link JurorPool to DisputeResolution
  await disputeResolution.setJurorPool(await jurorPool.getAddress());
  console.log("  ✓ JurorPool linked to DisputeResolution");

  // Create default template
  const TEMPLATE_ADMIN_ROLE = await templateRegistry.TEMPLATE_ADMIN_ROLE();
  await templateRegistry.grantRole(TEMPLATE_ADMIN_ROLE, deployer.address);
  await templateRegistry.registerTemplate(
    hre.ethers.keccak256(hre.ethers.toUtf8Bytes("Standard Agreement")),
    "Standard two-party agreement with escrow",
    deployer.address, // default arbitrator
    0 // TemplateCategory.General
  );
  console.log("  ✓ Default template created");

  // Mint tokens
  const MINTER_ROLE = await vjToken.MINTER_ROLE();
  await vjToken.grantRole(MINTER_ROLE, deployer.address);
  await vjToken.mint(deployer.address, hre.ethers.parseEther("100000000"));
  console.log("  ✓ 100M VJ tokens minted");

  // ============================================
  // SAVE DEPLOYMENT
  // ============================================
  console.log("\n💾 Saving deployment...\n");

  const chainId = (await hre.ethers.provider.getNetwork()).chainId;
  const deployment = {
    network,
    chainId: chainId.toString(),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: deployedAddresses,
  };

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  fs.writeFileSync(
    path.join(deploymentsDir, `${network}-${Date.now()}.json`),
    JSON.stringify(deployment, null, 2)
  );
  fs.writeFileSync(
    path.join(deploymentsDir, `${network}-latest.json`),
    JSON.stringify(deployment, null, 2)
  );
  console.log(`Saved to deployments/${network}-latest.json`);

  // ============================================
  // SUMMARY
  // ============================================
  console.log("\n" + "=".repeat(60));
  console.log("🎉 DEPLOYMENT COMPLETE");
  console.log("=".repeat(60));
  console.log(`\nNetwork: ${network} (Chain ID: ${chainId})`);
  console.log(`Contracts: ${Object.keys(deployedAddresses).length}`);
  console.log(`\nKey Addresses:`);
  console.log(`  VJToken:           ${deployedAddresses.VJToken}`);
  console.log(`  ContractFactory:   ${deployedAddresses.ContractFactory}`);
  console.log(`  DisputeResolution: ${deployedAddresses.DisputeResolution}`);
  console.log(`  VJGovernor:        ${deployedAddresses.VJGovernor}`);
  console.log(`  InsurancePolicy:   ${deployedAddresses.InsurancePolicy}`);

  return deployedAddresses;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
