const { ethers } = require("hardhat");

/**
 * Deploy all VoluntaryJustice contracts to testnet (Sepolia)
 *
 * Usage: npx hardhat run scripts/deploy-testnet.js --network sepolia
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));

  const deployedContracts = {};

  // ============================================
  // Phase 1: Core Contracts
  // ============================================
  console.log("\n--- Phase 1: Core Contracts ---\n");

  // 1. VJToken
  console.log("Deploying VJToken...");
  const VJToken = await ethers.getContractFactory("VJToken");
  const vjToken = await VJToken.deploy(deployer.address);
  await vjToken.waitForDeployment();
  deployedContracts.VJToken = await vjToken.getAddress();
  console.log("VJToken deployed to:", deployedContracts.VJToken);

  // 2. IdentityRegistry
  console.log("Deploying IdentityRegistry...");
  const IdentityRegistry = await ethers.getContractFactory("IdentityRegistry");
  const identityRegistry = await IdentityRegistry.deploy(deployer.address);
  await identityRegistry.waitForDeployment();
  deployedContracts.IdentityRegistry = await identityRegistry.getAddress();
  console.log("IdentityRegistry deployed to:", deployedContracts.IdentityRegistry);

  // 3. ReputationScoring
  console.log("Deploying ReputationScoring...");
  const ReputationScoring = await ethers.getContractFactory("ReputationScoring");
  const reputationScoring = await ReputationScoring.deploy(deployer.address);
  await reputationScoring.waitForDeployment();
  deployedContracts.ReputationScoring = await reputationScoring.getAddress();
  console.log("ReputationScoring deployed to:", deployedContracts.ReputationScoring);

  // 4. ContractTemplateRegistry
  console.log("Deploying ContractTemplateRegistry...");
  const ContractTemplateRegistry = await ethers.getContractFactory("ContractTemplateRegistry");
  const templateRegistry = await ContractTemplateRegistry.deploy(deployer.address);
  await templateRegistry.waitForDeployment();
  deployedContracts.ContractTemplateRegistry = await templateRegistry.getAddress();
  console.log("ContractTemplateRegistry deployed to:", deployedContracts.ContractTemplateRegistry);

  // 5. ContractFactory
  console.log("Deploying ContractFactory...");
  const ContractFactory = await ethers.getContractFactory("ContractFactory");
  const contractFactory = await ContractFactory.deploy(
    deployer.address,
    deployedContracts.ContractTemplateRegistry,
    deployedContracts.ReputationScoring
  );
  await contractFactory.waitForDeployment();
  deployedContracts.ContractFactory = await contractFactory.getAddress();
  console.log("ContractFactory deployed to:", deployedContracts.ContractFactory);

  // 6. CourtRegistry
  console.log("Deploying CourtRegistry...");
  const CourtRegistry = await ethers.getContractFactory("CourtRegistry");
  const courtRegistry = await CourtRegistry.deploy(deployer.address, deployedContracts.VJToken);
  await courtRegistry.waitForDeployment();
  deployedContracts.CourtRegistry = await courtRegistry.getAddress();
  console.log("CourtRegistry deployed to:", deployedContracts.CourtRegistry);

  // 7. EscrowVault
  console.log("Deploying EscrowVault...");
  const EscrowVault = await ethers.getContractFactory("EscrowVault");
  const escrowVault = await EscrowVault.deploy(deployer.address);
  await escrowVault.waitForDeployment();
  deployedContracts.EscrowVault = await escrowVault.getAddress();
  console.log("EscrowVault deployed to:", deployedContracts.EscrowVault);

  // 8. DisputeResolution
  console.log("Deploying DisputeResolution...");
  const DisputeResolution = await ethers.getContractFactory("DisputeResolution");
  const disputeResolution = await DisputeResolution.deploy(
    deployer.address,
    deployedContracts.ContractFactory,
    deployedContracts.CourtRegistry,
    deployedContracts.ReputationScoring
  );
  await disputeResolution.waitForDeployment();
  deployedContracts.DisputeResolution = await disputeResolution.getAddress();
  console.log("DisputeResolution deployed to:", deployedContracts.DisputeResolution);

  // 9. StakingRewards
  console.log("Deploying StakingRewards...");
  const StakingRewards = await ethers.getContractFactory("StakingRewards");
  const stakingRewards = await StakingRewards.deploy(deployer.address, deployedContracts.VJToken);
  await stakingRewards.waitForDeployment();
  deployedContracts.StakingRewards = await stakingRewards.getAddress();
  console.log("StakingRewards deployed to:", deployedContracts.StakingRewards);

  // ============================================
  // Phase 2: Insurance & Appeals
  // ============================================
  console.log("\n--- Phase 2: Insurance & Appeals ---\n");

  // 10. JurorPool
  console.log("Deploying JurorPool...");
  const JurorPool = await ethers.getContractFactory("JurorPool");
  const jurorPool = await JurorPool.deploy(deployer.address, deployedContracts.VJToken);
  await jurorPool.waitForDeployment();
  deployedContracts.JurorPool = await jurorPool.getAddress();
  console.log("JurorPool deployed to:", deployedContracts.JurorPool);

  // 11. BaselineInsurancePool
  console.log("Deploying BaselineInsurancePool...");
  const BaselineInsurancePool = await ethers.getContractFactory("BaselineInsurancePool");
  const insurancePool = await BaselineInsurancePool.deploy(
    deployer.address,
    deployedContracts.VJToken,
    deployedContracts.DisputeResolution
  );
  await insurancePool.waitForDeployment();
  deployedContracts.BaselineInsurancePool = await insurancePool.getAddress();
  console.log("BaselineInsurancePool deployed to:", deployedContracts.BaselineInsurancePool);

  // 12. InsurerRegistry
  console.log("Deploying InsurerRegistry...");
  const InsurerRegistry = await ethers.getContractFactory("InsurerRegistry");
  const insurerRegistry = await InsurerRegistry.deploy(deployer.address, deployedContracts.VJToken);
  await insurerRegistry.waitForDeployment();
  deployedContracts.InsurerRegistry = await insurerRegistry.getAddress();
  console.log("InsurerRegistry deployed to:", deployedContracts.InsurerRegistry);

  // 13. InsurancePolicy
  console.log("Deploying InsurancePolicy...");
  const InsurancePolicy = await ethers.getContractFactory("InsurancePolicy");
  const insurancePolicy = await InsurancePolicy.deploy(
    deployer.address,
    deployedContracts.VJToken,
    deployedContracts.InsurerRegistry
  );
  await insurancePolicy.waitForDeployment();
  deployedContracts.InsurancePolicy = await insurancePolicy.getAddress();
  console.log("InsurancePolicy deployed to:", deployedContracts.InsurancePolicy);

  // 14. EnforcementEngine
  console.log("Deploying EnforcementEngine...");
  const EnforcementEngine = await ethers.getContractFactory("EnforcementEngine");
  const enforcementEngine = await EnforcementEngine.deploy(
    deployer.address,
    deployedContracts.DisputeResolution,
    deployedContracts.EscrowVault
  );
  await enforcementEngine.waitForDeployment();
  deployedContracts.EnforcementEngine = await enforcementEngine.getAddress();
  console.log("EnforcementEngine deployed to:", deployedContracts.EnforcementEngine);

  // ============================================
  // Phase 3: Enforcement & Exclusion
  // ============================================
  console.log("\n--- Phase 3: Enforcement & Exclusion ---\n");

  // 15. ExclusionRegistry
  console.log("Deploying ExclusionRegistry...");
  const ExclusionRegistry = await ethers.getContractFactory("ExclusionRegistry");
  const exclusionRegistry = await ExclusionRegistry.deploy(deployer.address);
  await exclusionRegistry.waitForDeployment();
  deployedContracts.ExclusionRegistry = await exclusionRegistry.getAddress();
  console.log("ExclusionRegistry deployed to:", deployedContracts.ExclusionRegistry);

  // 16. BountyMarket
  console.log("Deploying BountyMarket...");
  const BountyMarket = await ethers.getContractFactory("BountyMarket");
  const bountyMarket = await BountyMarket.deploy(
    deployer.address,
    deployedContracts.VJToken,
    deployedContracts.DisputeResolution
  );
  await bountyMarket.waitForDeployment();
  deployedContracts.BountyMarket = await bountyMarket.getAddress();
  console.log("BountyMarket deployed to:", deployedContracts.BountyMarket);

  // ============================================
  // Phase 4: Governance & Anchoring
  // ============================================
  console.log("\n--- Phase 4: Governance & Anchoring ---\n");

  // 17. RulingAnchor
  console.log("Deploying RulingAnchor...");
  const RulingAnchor = await ethers.getContractFactory("RulingAnchor");
  const rulingAnchor = await RulingAnchor.deploy(deployer.address);
  await rulingAnchor.waitForDeployment();
  deployedContracts.RulingAnchor = await rulingAnchor.getAddress();
  console.log("RulingAnchor deployed to:", deployedContracts.RulingAnchor);

  // 18. VJGovernor (requires TimelockController)
  console.log("Deploying TimelockController...");
  const TimelockController = await ethers.getContractFactory("@openzeppelin/contracts/governance/TimelockController.sol:TimelockController");
  const timelock = await TimelockController.deploy(
    172800, // 48 hours
    [deployer.address], // proposers (will add governor later)
    [deployer.address], // executors
    deployer.address // admin
  );
  await timelock.waitForDeployment();
  deployedContracts.TimelockController = await timelock.getAddress();
  console.log("TimelockController deployed to:", deployedContracts.TimelockController);

  console.log("Deploying VJGovernor...");
  const VJGovernor = await ethers.getContractFactory("VJGovernor");
  const vjGovernor = await VJGovernor.deploy(
    deployedContracts.VJToken,
    deployedContracts.TimelockController,
    deployedContracts.ExclusionRegistry
  );
  await vjGovernor.waitForDeployment();
  deployedContracts.VJGovernor = await vjGovernor.getAddress();
  console.log("VJGovernor deployed to:", deployedContracts.VJGovernor);

  // ============================================
  // Phase 5: Oracle & Legacy Integration
  // ============================================
  console.log("\n--- Phase 5: Oracle & Legacy Integration ---\n");

  // 19. OracleRegistry
  console.log("Deploying OracleRegistry...");
  const OracleRegistry = await ethers.getContractFactory("OracleRegistry");
  const oracleRegistry = await OracleRegistry.deploy(deployer.address, deployedContracts.VJToken);
  await oracleRegistry.waitForDeployment();
  deployedContracts.OracleRegistry = await oracleRegistry.getAddress();
  console.log("OracleRegistry deployed to:", deployedContracts.OracleRegistry);

  // 20. LegacyCourtBridge
  console.log("Deploying LegacyCourtBridge...");
  const LegacyCourtBridge = await ethers.getContractFactory("LegacyCourtBridge");
  const legacyCourtBridge = await LegacyCourtBridge.deploy(deployer.address);
  await legacyCourtBridge.waitForDeployment();
  deployedContracts.LegacyCourtBridge = await legacyCourtBridge.getAddress();
  console.log("LegacyCourtBridge deployed to:", deployedContracts.LegacyCourtBridge);

  // ============================================
  // Phase 6: Production Readiness
  // ============================================
  console.log("\n--- Phase 6: Production Readiness ---\n");

  // 21. CrossChainBridge
  console.log("Deploying CrossChainBridge...");
  const CrossChainBridge = await ethers.getContractFactory("CrossChainBridge");
  const crossChainBridge = await CrossChainBridge.deploy(deployer.address);
  await crossChainBridge.waitForDeployment();
  deployedContracts.CrossChainBridge = await crossChainBridge.getAddress();
  console.log("CrossChainBridge deployed to:", deployedContracts.CrossChainBridge);

  // Note: VRFConsumer requires Chainlink VRF Coordinator address
  // For testnet, use Sepolia VRF Coordinator
  const SEPOLIA_VRF_COORDINATOR = "0x8103B0A8A00be2DDC778e6e7eaa21791Cd364625";
  const SEPOLIA_KEY_HASH = "0x474e34a077df58807dbe9c96d3c009b23b3c6d0cce433e59bbf5b34f823bc56c";
  const SEPOLIA_SUBSCRIPTION_ID = 0; // User needs to create subscription

  console.log("Deploying VRFConsumer...");
  console.log("Note: VRFConsumer requires Chainlink VRF subscription. Set subscription ID after deployment.");
  const VRFConsumer = await ethers.getContractFactory("VRFConsumer");
  const vrfConsumer = await VRFConsumer.deploy(
    deployer.address,
    SEPOLIA_VRF_COORDINATOR,
    SEPOLIA_SUBSCRIPTION_ID,
    SEPOLIA_KEY_HASH
  );
  await vrfConsumer.waitForDeployment();
  deployedContracts.VRFConsumer = await vrfConsumer.getAddress();
  console.log("VRFConsumer deployed to:", deployedContracts.VRFConsumer);

  // ============================================
  // Role Setup
  // ============================================
  console.log("\n--- Setting up roles ---\n");

  // Grant STAKING_ROLE to staking contracts
  const STAKING_ROLE = await vjToken.STAKING_ROLE();
  await vjToken.grantRole(STAKING_ROLE, deployedContracts.StakingRewards);
  await vjToken.grantRole(STAKING_ROLE, deployedContracts.CourtRegistry);
  await vjToken.grantRole(STAKING_ROLE, deployedContracts.JurorPool);
  await vjToken.grantRole(STAKING_ROLE, deployedContracts.InsurerRegistry);
  await vjToken.grantRole(STAKING_ROLE, deployedContracts.OracleRegistry);
  console.log("STAKING_ROLE granted to staking contracts");

  // Grant roles to ContractFactory
  const FACTORY_ROLE = await escrowVault.FACTORY_ROLE();
  await escrowVault.grantRole(FACTORY_ROLE, deployedContracts.ContractFactory);
  console.log("FACTORY_ROLE granted to ContractFactory");

  // Grant ENFORCEMENT_ROLE to EnforcementEngine
  const ENFORCEMENT_ROLE = await escrowVault.ENFORCEMENT_ROLE();
  await escrowVault.grantRole(ENFORCEMENT_ROLE, deployedContracts.EnforcementEngine);
  console.log("ENFORCEMENT_ROLE granted to EnforcementEngine");

  // Grant SYSTEM_ROLE to relevant contracts
  const SYSTEM_ROLE = await reputationScoring.SYSTEM_ROLE();
  await reputationScoring.grantRole(SYSTEM_ROLE, deployedContracts.ContractFactory);
  await reputationScoring.grantRole(SYSTEM_ROLE, deployedContracts.DisputeResolution);
  console.log("SYSTEM_ROLE granted to ContractFactory and DisputeResolution");

  // Grant DISPUTE_ROLE to JurorPool
  const DISPUTE_ROLE = await jurorPool.DISPUTE_ROLE();
  await jurorPool.grantRole(DISPUTE_ROLE, deployedContracts.DisputeResolution);
  console.log("DISPUTE_ROLE granted to DisputeResolution");

  // Grant REQUESTER_ROLE to JurorPool for VRF
  const REQUESTER_ROLE = await vrfConsumer.REQUESTER_ROLE();
  await vrfConsumer.grantRole(REQUESTER_ROLE, deployedContracts.JurorPool);
  console.log("REQUESTER_ROLE granted to JurorPool");

  // ============================================
  // Summary
  // ============================================
  console.log("\n========================================");
  console.log("Deployment Complete!");
  console.log("========================================\n");
  console.log("Deployed Contracts:");
  console.log(JSON.stringify(deployedContracts, null, 2));

  // Save deployment addresses
  const fs = require("fs");
  const deploymentPath = `./deployments/sepolia-${Date.now()}.json`;
  fs.mkdirSync("./deployments", { recursive: true });
  fs.writeFileSync(deploymentPath, JSON.stringify(deployedContracts, null, 2));
  console.log(`\nDeployment addresses saved to: ${deploymentPath}`);

  console.log("\n--- Post-Deployment Steps ---");
  console.log("1. Create Chainlink VRF subscription and fund it");
  console.log("2. Update VRFConsumer with subscription ID");
  console.log("3. Add VRFConsumer as consumer to VRF subscription");
  console.log("4. Verify contracts on Etherscan");
  console.log("5. Transfer admin roles if needed");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
