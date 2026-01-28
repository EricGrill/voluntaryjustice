const { ethers } = require("hardhat");

/**
 * Deploy VoluntaryJustice contracts to L2 (Arbitrum, Optimism, Base)
 *
 * Usage:
 *   npx hardhat run scripts/deploy-l2.js --network arbitrum
 *   npx hardhat run scripts/deploy-l2.js --network optimism
 *   npx hardhat run scripts/deploy-l2.js --network base
 */

// VRF Coordinators and Key Hashes for different L2s
const VRF_CONFIG = {
  // Arbitrum One
  42161: {
    coordinator: "0x41034678D6C633D8a95c75e1138A360a28bA15d1",
    keyHash: "0x72d2b016bb5b62912afea355ebf33b91319f828738b111b723b78696b9847b63"
  },
  // Arbitrum Sepolia
  421614: {
    coordinator: "0x50d47e4142598E3411aA864e08a44284e471AC6f",
    keyHash: "0x027f94ff1465b3525f9fc03e9ff7d6d2c0953482246dd6ae07570c45d6631414"
  },
  // Optimism
  10: {
    coordinator: "0x0000000000000000000000000000000000000000", // Not yet available
    keyHash: "0x0000000000000000000000000000000000000000000000000000000000000000"
  },
  // Base
  8453: {
    coordinator: "0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634",
    keyHash: "0xdc883a9d8bf86b7e4f8f59dc3a7c98a6e3b8f981c1c6c7e0e2cb7c8c7c8c7c8c"
  },
  // Base Sepolia
  84532: {
    coordinator: "0x7a1BaC17Ccc5b313516C5E16fb24f7659aA5ebed",
    keyHash: "0x4b09e658ed251bcafeebbc69400383d49f344ace09b9576fe248bb02c003fe9f"
  }
};

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  console.log("\n========================================");
  console.log("   L2 DEPLOYMENT");
  console.log("========================================\n");
  console.log("Network:", network.name, "(Chain ID:", chainId, ")");
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

  const vrfConfig = VRF_CONFIG[chainId];
  if (!vrfConfig) {
    console.log("\n WARNING: No VRF configuration for this chain. VRFConsumer will not work.");
  }

  const deployedContracts = {};

  // Helper function
  async function deploy(name, ...args) {
    console.log(`Deploying ${name}...`);
    const Factory = await ethers.getContractFactory(name);
    const contract = await Factory.deploy(...args);
    await contract.waitForDeployment();
    const address = await contract.getAddress();
    deployedContracts[name] = address;
    console.log(`  ${name}: ${address}`);
    return contract;
  }

  // ============================================
  // Core Contracts (L2 optimized)
  // ============================================
  console.log("\n--- Deploying Core Contracts ---\n");

  const vjToken = await deploy("VJToken", deployer.address);
  await deploy("IdentityRegistry", deployer.address);
  const reputationScoring = await deploy("ReputationScoring", deployer.address);
  await deploy("ContractTemplateRegistry", deployer.address);

  await deploy("ContractFactory",
    deployer.address,
    deployedContracts.ContractTemplateRegistry,
    deployedContracts.ReputationScoring
  );

  await deploy("CourtRegistry", deployer.address, deployedContracts.VJToken);

  const escrowVault = await deploy("EscrowVault", deployer.address);

  await deploy("DisputeResolution",
    deployer.address,
    deployedContracts.ContractFactory,
    deployedContracts.CourtRegistry,
    deployedContracts.ReputationScoring
  );

  await deploy("StakingRewards", deployer.address, deployedContracts.VJToken);

  // ============================================
  // Insurance & Appeals
  // ============================================
  console.log("\n--- Deploying Insurance & Appeals ---\n");

  const jurorPool = await deploy("JurorPool", deployer.address, deployedContracts.VJToken);

  await deploy("BaselineInsurancePool",
    deployer.address,
    deployedContracts.VJToken,
    deployedContracts.DisputeResolution
  );

  await deploy("InsurerRegistry", deployer.address, deployedContracts.VJToken);

  await deploy("InsurancePolicy",
    deployer.address,
    deployedContracts.VJToken,
    deployedContracts.InsurerRegistry
  );

  await deploy("EnforcementEngine",
    deployer.address,
    deployedContracts.DisputeResolution,
    deployedContracts.EscrowVault
  );

  // ============================================
  // Enforcement & Exclusion
  // ============================================
  console.log("\n--- Deploying Enforcement & Exclusion ---\n");

  await deploy("ExclusionRegistry", deployer.address);
  await deploy("BountyMarket",
    deployer.address,
    deployedContracts.VJToken,
    deployedContracts.DisputeResolution
  );

  // ============================================
  // Governance & Anchoring
  // ============================================
  console.log("\n--- Deploying Governance & Anchoring ---\n");

  await deploy("RulingAnchor", deployer.address);

  const TimelockController = await ethers.getContractFactory("@openzeppelin/contracts/governance/TimelockController.sol:TimelockController");
  const timelock = await TimelockController.deploy(
    172800, // 48 hours
    [deployer.address],
    [deployer.address],
    deployer.address
  );
  await timelock.waitForDeployment();
  deployedContracts.TimelockController = await timelock.getAddress();
  console.log(`  TimelockController: ${deployedContracts.TimelockController}`);

  await deploy("VJGovernor",
    deployedContracts.VJToken,
    deployedContracts.TimelockController,
    deployedContracts.ExclusionRegistry
  );

  // ============================================
  // Oracle & Legacy Integration
  // ============================================
  console.log("\n--- Deploying Oracle & Legacy Integration ---\n");

  await deploy("OracleRegistry", deployer.address, deployedContracts.VJToken);
  await deploy("LegacyCourtBridge", deployer.address);

  // ============================================
  // Production Readiness
  // ============================================
  console.log("\n--- Deploying Production Contracts ---\n");

  await deploy("CrossChainBridge", deployer.address);

  // VRFConsumer (if VRF available on this chain)
  let vrfConsumer;
  if (vrfConfig && vrfConfig.coordinator !== "0x0000000000000000000000000000000000000000") {
    const VRFConsumer = await ethers.getContractFactory("VRFConsumer");
    vrfConsumer = await VRFConsumer.deploy(
      deployer.address,
      vrfConfig.coordinator,
      0, // Subscription ID - set later
      vrfConfig.keyHash
    );
    await vrfConsumer.waitForDeployment();
    deployedContracts.VRFConsumer = await vrfConsumer.getAddress();
    console.log(`  VRFConsumer: ${deployedContracts.VRFConsumer}`);
  } else {
    console.log("  VRFConsumer: SKIPPED (no VRF on this chain)");
  }

  // ============================================
  // Role Setup
  // ============================================
  console.log("\n--- Setting up roles ---\n");

  const STAKING_ROLE = await vjToken.STAKING_ROLE();
  await vjToken.grantRole(STAKING_ROLE, deployedContracts.StakingRewards);
  await vjToken.grantRole(STAKING_ROLE, deployedContracts.CourtRegistry);
  await vjToken.grantRole(STAKING_ROLE, deployedContracts.JurorPool);
  await vjToken.grantRole(STAKING_ROLE, deployedContracts.InsurerRegistry);
  await vjToken.grantRole(STAKING_ROLE, deployedContracts.OracleRegistry);
  console.log("STAKING_ROLE granted");

  const FACTORY_ROLE = await escrowVault.FACTORY_ROLE();
  await escrowVault.grantRole(FACTORY_ROLE, deployedContracts.ContractFactory);
  console.log("FACTORY_ROLE granted");

  const ENFORCEMENT_ROLE = await escrowVault.ENFORCEMENT_ROLE();
  await escrowVault.grantRole(ENFORCEMENT_ROLE, deployedContracts.EnforcementEngine);
  console.log("ENFORCEMENT_ROLE granted");

  const SYSTEM_ROLE = await reputationScoring.SYSTEM_ROLE();
  await reputationScoring.grantRole(SYSTEM_ROLE, deployedContracts.ContractFactory);
  await reputationScoring.grantRole(SYSTEM_ROLE, deployedContracts.DisputeResolution);
  console.log("SYSTEM_ROLE granted");

  const DISPUTE_ROLE = await jurorPool.DISPUTE_ROLE();
  await jurorPool.grantRole(DISPUTE_ROLE, deployedContracts.DisputeResolution);
  console.log("DISPUTE_ROLE granted");

  if (vrfConsumer) {
    const REQUESTER_ROLE = await vrfConsumer.REQUESTER_ROLE();
    await vrfConsumer.grantRole(REQUESTER_ROLE, deployedContracts.JurorPool);
    console.log("REQUESTER_ROLE granted");
  }

  // ============================================
  // Summary
  // ============================================
  console.log("\n========================================");
  console.log("   L2 DEPLOYMENT COMPLETE");
  console.log("========================================\n");

  console.log("Chain ID:", chainId);
  console.log("Deployed Contracts:");
  console.log(JSON.stringify(deployedContracts, null, 2));

  // Save deployment
  const fs = require("fs");
  const networkName = network.name || `chain-${chainId}`;
  const timestamp = Date.now();
  const deploymentPath = `./deployments/${networkName}-${timestamp}.json`;

  fs.mkdirSync("./deployments", { recursive: true });
  fs.writeFileSync(deploymentPath, JSON.stringify({
    network: networkName,
    chainId: chainId,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: deployedContracts
  }, null, 2));

  console.log(`\nDeployment saved to: ${deploymentPath}`);

  console.log("\n--- Post-Deployment Steps ---");
  console.log("1. Configure CrossChainBridge with mainnet contract address");
  console.log("2. Set up VRF subscription (if applicable)");
  console.log("3. Verify contracts on block explorer");
  console.log("4. Transfer admin roles to multisig");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
