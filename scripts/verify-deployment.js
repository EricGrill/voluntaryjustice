const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const network = hre.network.name;
  console.log(`\n🔍 Verifying VoluntaryJustice deployment on ${network}...\n`);

  // Load deployment
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  const deploymentPath = path.join(deploymentsDir, `${network}-latest.json`);

  if (!fs.existsSync(deploymentPath)) {
    console.error(`No deployment found for ${network}. Run deploy-full.js first.`);
    process.exit(1);
  }

  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const addresses = deployment.contracts;

  console.log(`Deployment from: ${deployment.timestamp}`);
  console.log(`Chain ID: ${deployment.chainId}`);
  console.log(`Deployer: ${deployment.deployer}\n`);

  let passed = 0;
  let failed = 0;

  // Helper to check contract
  async function checkContract(name, expectedAddress) {
    try {
      const code = await hre.ethers.provider.getCode(expectedAddress);
      if (code === "0x") {
        console.log(`  ❌ ${name}: No code at ${expectedAddress}`);
        failed++;
        return false;
      }
      console.log(`  ✓ ${name}: ${expectedAddress}`);
      passed++;
      return true;
    } catch (error) {
      console.log(`  ❌ ${name}: Error - ${error.message}`);
      failed++;
      return false;
    }
  }

  // Check all contracts
  console.log("Checking deployed contracts...\n");

  for (const [name, address] of Object.entries(addresses)) {
    await checkContract(name, address);
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`${"=".repeat(50)}\n`);

  // Additional checks
  console.log("Running additional checks...\n");

  // Check VJToken
  try {
    const vjToken = await hre.ethers.getContractAt("VJToken", addresses.VJToken);
    const totalSupply = await vjToken.totalSupply();
    console.log(`  VJToken total supply: ${hre.ethers.formatEther(totalSupply)} VJ`);

    const name = await vjToken.name();
    const symbol = await vjToken.symbol();
    console.log(`  VJToken: ${name} (${symbol})`);
  } catch (error) {
    console.log(`  ❌ VJToken check failed: ${error.message}`);
  }

  // Check ContractFactory
  try {
    const factory = await hre.ethers.getContractAt("ContractFactory", addresses.ContractFactory);
    const templateRegistry = await factory.templateRegistry();
    console.log(`  ContractFactory template registry: ${templateRegistry}`);
  } catch (error) {
    console.log(`  ❌ ContractFactory check failed: ${error.message}`);
  }

  // Check Governor
  try {
    const governor = await hre.ethers.getContractAt("VJGovernor", addresses.VJGovernor);
    const votingDelay = await governor.votingDelay();
    const votingPeriod = await governor.votingPeriod();
    console.log(`  Governor voting delay: ${votingDelay} blocks`);
    console.log(`  Governor voting period: ${votingPeriod} blocks`);
  } catch (error) {
    console.log(`  ❌ Governor check failed: ${error.message}`);
  }

  // Check Timelock
  try {
    const timelock = await hre.ethers.getContractAt("GovernorTimelock", addresses.GovernorTimelock);
    const minDelay = await timelock.getMinDelay();
    console.log(`  Timelock min delay: ${minDelay} seconds (${Number(minDelay) / 86400} days)`);
  } catch (error) {
    console.log(`  ❌ Timelock check failed: ${error.message}`);
  }

  console.log("\n✅ Verification complete\n");

  if (failed > 0) {
    console.log("⚠️  Some checks failed. Review the output above.");
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
