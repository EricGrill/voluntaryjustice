const { ethers } = require("hardhat");
const readline = require("readline");

/**
 * Deploy all VoluntaryJustice contracts to Ethereum Mainnet
 *
 * SAFETY: This script includes multiple confirmation prompts
 *
 * Usage: npx hardhat run scripts/deploy-mainnet.js --network mainnet
 */

const MAINNET_VRF_COORDINATOR = "0x271682DEB8C4E0901D1a1550aD2e64D568E69909";
const MAINNET_KEY_HASH = "0x8af398995b04c28e9951adb9721ef74c74f93e6a478f39e7e0777be13527e7ef";

async function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function confirmDeployment(deployer) {
  console.log("\n========================================");
  console.log("   MAINNET DEPLOYMENT - FINAL CHECK");
  console.log("========================================\n");

  const balance = await ethers.provider.getBalance(deployer.address);
  const network = await ethers.provider.getNetwork();

  console.log("Network:", network.name, "(Chain ID:", network.chainId.toString(), ")");
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");

  if (network.chainId !== 1n) {
    console.log("\n WARNING: Not on Ethereum Mainnet!");
    const proceed = await prompt("Continue anyway? (yes/no): ");
    if (proceed.toLowerCase() !== "yes") {
      console.log("Deployment cancelled.");
      process.exit(0);
    }
  }

  if (balance < ethers.parseEther("0.5")) {
    console.log("\n WARNING: Low balance. Deployment may fail due to insufficient gas.");
  }

  console.log("\n This will deploy 22 contracts to MAINNET.");
  console.log(" Estimated gas cost: ~0.3-0.5 ETH");

  const confirm = await prompt("\nType 'DEPLOY TO MAINNET' to confirm: ");
  if (confirm !== "DEPLOY TO MAINNET") {
    console.log("Deployment cancelled.");
    process.exit(0);
  }

  console.log("\nStarting deployment...\n");
}

async function main() {
  const [deployer] = await ethers.getSigners();

  // Safety confirmation
  await confirmDeployment(deployer);

  const deployedContracts = {};
  const gasUsed = {};

  async function deployWithGasTracking(name, factory, ...args) {
    console.log(`Deploying ${name}...`);
    const contract = await factory.deploy(...args);
    await contract.waitForDeployment();

    const receipt = await contract.deploymentTransaction().wait();
    gasUsed[name] = receipt.gasUsed.toString();

    const address = await contract.getAddress();
    deployedContracts[name] = address;
    console.log(`  ${name}: ${address} (gas: ${receipt.gasUsed})`);

    return contract;
  }

  // ============================================
  // Phase 1: Core Contracts
  // ============================================
  console.log("\n--- Phase 1: Core Contracts ---\n");

  const VJToken = await ethers.getContractFactory("VJToken");
  const vjToken = await deployWithGasTracking("VJToken", VJToken, deployer.address);

  const IdentityRegistry = await ethers.getContractFactory("IdentityRegistry");
  await deployWithGasTracking("IdentityRegistry", IdentityRegistry, deployer.address);

  const ReputationScoring = await ethers.getContractFactory("ReputationScoring");
  const reputationScoring = await deployWithGasTracking("ReputationScoring", ReputationScoring, deployer.address);

  const ContractTemplateRegistry = await ethers.getContractFactory("ContractTemplateRegistry");
  await deployWithGasTracking("ContractTemplateRegistry", ContractTemplateRegistry, deployer.address);

  const ContractFactory = await ethers.getContractFactory("ContractFactory");
  const contractFactory = await deployWithGasTracking(
    "ContractFactory",
    ContractFactory,
    deployer.address,
    deployedContracts.ContractTemplateRegistry,
    deployedContracts.ReputationScoring
  );

  const CourtRegistry = await ethers.getContractFactory("CourtRegistry");
  await deployWithGasTracking("CourtRegistry", CourtRegistry, deployer.address, deployedContracts.VJToken);

  const EscrowVault = await ethers.getContractFactory("EscrowVault");
  const escrowVault = await deployWithGasTracking("EscrowVault", EscrowVault, deployer.address);

  const DisputeResolution = await ethers.getContractFactory("DisputeResolution");
  const disputeResolution = await deployWithGasTracking(
    "DisputeResolution",
    DisputeResolution,
    deployer.address,
    deployedContracts.ContractFactory,
    deployedContracts.CourtRegistry,
    deployedContracts.ReputationScoring
  );

  const StakingRewards = await ethers.getContractFactory("StakingRewards");
  await deployWithGasTracking("StakingRewards", StakingRewards, deployer.address, deployedContracts.VJToken);

  // ============================================
  // Phase 2: Insurance & Appeals
  // ============================================
  console.log("\n--- Phase 2: Insurance & Appeals ---\n");

  const JurorPool = await ethers.getContractFactory("JurorPool");
  const jurorPool = await deployWithGasTracking("JurorPool", JurorPool, deployer.address, deployedContracts.VJToken);

  const BaselineInsurancePool = await ethers.getContractFactory("BaselineInsurancePool");
  await deployWithGasTracking(
    "BaselineInsurancePool",
    BaselineInsurancePool,
    deployer.address,
    deployedContracts.VJToken,
    deployedContracts.DisputeResolution
  );

  const InsurerRegistry = await ethers.getContractFactory("InsurerRegistry");
  await deployWithGasTracking("InsurerRegistry", InsurerRegistry, deployer.address, deployedContracts.VJToken);

  const InsurancePolicy = await ethers.getContractFactory("InsurancePolicy");
  await deployWithGasTracking(
    "InsurancePolicy",
    InsurancePolicy,
    deployer.address,
    deployedContracts.VJToken,
    deployedContracts.InsurerRegistry
  );

  const EnforcementEngine = await ethers.getContractFactory("EnforcementEngine");
  await deployWithGasTracking(
    "EnforcementEngine",
    EnforcementEngine,
    deployer.address,
    deployedContracts.DisputeResolution,
    deployedContracts.EscrowVault
  );

  // ============================================
  // Phase 3: Enforcement & Exclusion
  // ============================================
  console.log("\n--- Phase 3: Enforcement & Exclusion ---\n");

  const ExclusionRegistry = await ethers.getContractFactory("ExclusionRegistry");
  await deployWithGasTracking("ExclusionRegistry", ExclusionRegistry, deployer.address);

  const BountyMarket = await ethers.getContractFactory("BountyMarket");
  await deployWithGasTracking(
    "BountyMarket",
    BountyMarket,
    deployer.address,
    deployedContracts.VJToken,
    deployedContracts.DisputeResolution
  );

  // ============================================
  // Phase 4: Governance & Anchoring
  // ============================================
  console.log("\n--- Phase 4: Governance & Anchoring ---\n");

  const RulingAnchor = await ethers.getContractFactory("RulingAnchor");
  await deployWithGasTracking("RulingAnchor", RulingAnchor, deployer.address);

  const TimelockController = await ethers.getContractFactory("@openzeppelin/contracts/governance/TimelockController.sol:TimelockController");
  await deployWithGasTracking(
    "TimelockController",
    TimelockController,
    172800, // 48 hours
    [deployer.address],
    [deployer.address],
    deployer.address
  );

  const VJGovernor = await ethers.getContractFactory("VJGovernor");
  await deployWithGasTracking(
    "VJGovernor",
    VJGovernor,
    deployedContracts.VJToken,
    deployedContracts.TimelockController,
    deployedContracts.ExclusionRegistry
  );

  // ============================================
  // Phase 5: Oracle & Legacy Integration
  // ============================================
  console.log("\n--- Phase 5: Oracle & Legacy Integration ---\n");

  const OracleRegistry = await ethers.getContractFactory("OracleRegistry");
  await deployWithGasTracking("OracleRegistry", OracleRegistry, deployer.address, deployedContracts.VJToken);

  const LegacyCourtBridge = await ethers.getContractFactory("LegacyCourtBridge");
  await deployWithGasTracking("LegacyCourtBridge", LegacyCourtBridge, deployer.address);

  // ============================================
  // Phase 6: Production Readiness
  // ============================================
  console.log("\n--- Phase 6: Production Readiness ---\n");

  const CrossChainBridge = await ethers.getContractFactory("CrossChainBridge");
  await deployWithGasTracking("CrossChainBridge", CrossChainBridge, deployer.address);

  // VRFConsumer - subscription ID 0 initially, must be updated
  const VRFConsumer = await ethers.getContractFactory("VRFConsumer");
  const vrfConsumer = await deployWithGasTracking(
    "VRFConsumer",
    VRFConsumer,
    deployer.address,
    MAINNET_VRF_COORDINATOR,
    0, // Subscription ID - must be set after creating subscription
    MAINNET_KEY_HASH
  );

  // ============================================
  // Role Setup
  // ============================================
  console.log("\n--- Setting up roles ---\n");

  const roleSetupTx = [];

  // Grant STAKING_ROLE
  const STAKING_ROLE = await vjToken.STAKING_ROLE();
  roleSetupTx.push(vjToken.grantRole(STAKING_ROLE, deployedContracts.StakingRewards));
  roleSetupTx.push(vjToken.grantRole(STAKING_ROLE, deployedContracts.CourtRegistry));
  roleSetupTx.push(vjToken.grantRole(STAKING_ROLE, deployedContracts.JurorPool));
  roleSetupTx.push(vjToken.grantRole(STAKING_ROLE, deployedContracts.InsurerRegistry));
  roleSetupTx.push(vjToken.grantRole(STAKING_ROLE, deployedContracts.OracleRegistry));

  // Grant FACTORY_ROLE
  const FACTORY_ROLE = await escrowVault.FACTORY_ROLE();
  roleSetupTx.push(escrowVault.grantRole(FACTORY_ROLE, deployedContracts.ContractFactory));

  // Grant ENFORCEMENT_ROLE
  const ENFORCEMENT_ROLE = await escrowVault.ENFORCEMENT_ROLE();
  roleSetupTx.push(escrowVault.grantRole(ENFORCEMENT_ROLE, deployedContracts.EnforcementEngine));

  // Grant SYSTEM_ROLE
  const SYSTEM_ROLE = await reputationScoring.SYSTEM_ROLE();
  roleSetupTx.push(reputationScoring.grantRole(SYSTEM_ROLE, deployedContracts.ContractFactory));
  roleSetupTx.push(reputationScoring.grantRole(SYSTEM_ROLE, deployedContracts.DisputeResolution));

  // Grant DISPUTE_ROLE
  const DISPUTE_ROLE = await jurorPool.DISPUTE_ROLE();
  roleSetupTx.push(jurorPool.grantRole(DISPUTE_ROLE, deployedContracts.DisputeResolution));

  // Grant REQUESTER_ROLE
  const REQUESTER_ROLE = await vrfConsumer.REQUESTER_ROLE();
  roleSetupTx.push(vrfConsumer.grantRole(REQUESTER_ROLE, deployedContracts.JurorPool));

  // Wait for all role transactions
  await Promise.all(roleSetupTx.map(tx => tx.then(t => t.wait())));
  console.log("All roles configured successfully");

  // ============================================
  // Summary
  // ============================================
  const totalGas = Object.values(gasUsed).reduce((a, b) => BigInt(a) + BigInt(b), 0n);

  console.log("\n========================================");
  console.log("   MAINNET DEPLOYMENT COMPLETE");
  console.log("========================================\n");

  console.log("Deployed Contracts:");
  console.log(JSON.stringify(deployedContracts, null, 2));

  console.log("\nGas Usage:");
  console.log(JSON.stringify(gasUsed, null, 2));
  console.log("\nTotal Gas Used:", totalGas.toString());

  // Save deployment
  const fs = require("fs");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const deploymentData = {
    network: "mainnet",
    chainId: 1,
    deployer: deployer.address,
    timestamp: timestamp,
    contracts: deployedContracts,
    gasUsed: gasUsed,
    totalGas: totalGas.toString()
  };

  const deploymentPath = `./deployments/mainnet-${timestamp}.json`;
  fs.mkdirSync("./deployments", { recursive: true });
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentData, null, 2));
  console.log(`\nDeployment saved to: ${deploymentPath}`);

  console.log("\n--- CRITICAL POST-DEPLOYMENT STEPS ---");
  console.log("1. Verify all contracts on Etherscan");
  console.log("2. Create Chainlink VRF subscription at vrf.chain.link");
  console.log("3. Fund VRF subscription with LINK");
  console.log("4. Update VRFConsumer subscription ID");
  console.log("5. Add VRFConsumer address as consumer");
  console.log("6. Transfer admin roles to multisig");
  console.log("7. Update TimelockController roles for Governor");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
