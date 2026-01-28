import { Address } from "viem";

type ContractAddresses = {
  VJToken: Address;
  IdentityRegistry: Address;
  ReputationScoring: Address;
  ContractTemplateRegistry: Address;
  ContractFactory: Address;
  CourtRegistry: Address;
  DisputeResolution: Address;
  EscrowVault: Address;
  StakingRewards: Address;
  JurorPool: Address;
  BaselineInsurancePool: Address;
  InsurerRegistry: Address;
  InsurancePolicy: Address;
  EnforcementEngine: Address;
  ExclusionRegistry: Address;
  BountyMarket: Address;
  VJGovernor: Address;
  RulingAnchor: Address;
  OracleRegistry: Address;
  LegacyCourtBridge: Address;
};

// Hardhat local addresses (will be set after deployment)
const hardhatAddresses: ContractAddresses = {
  VJToken: "0x0000000000000000000000000000000000000000",
  IdentityRegistry: "0x0000000000000000000000000000000000000000",
  ReputationScoring: "0x0000000000000000000000000000000000000000",
  ContractTemplateRegistry: "0x0000000000000000000000000000000000000000",
  ContractFactory: "0x0000000000000000000000000000000000000000",
  CourtRegistry: "0x0000000000000000000000000000000000000000",
  DisputeResolution: "0x0000000000000000000000000000000000000000",
  EscrowVault: "0x0000000000000000000000000000000000000000",
  StakingRewards: "0x0000000000000000000000000000000000000000",
  JurorPool: "0x0000000000000000000000000000000000000000",
  BaselineInsurancePool: "0x0000000000000000000000000000000000000000",
  InsurerRegistry: "0x0000000000000000000000000000000000000000",
  InsurancePolicy: "0x0000000000000000000000000000000000000000",
  EnforcementEngine: "0x0000000000000000000000000000000000000000",
  ExclusionRegistry: "0x0000000000000000000000000000000000000000",
  BountyMarket: "0x0000000000000000000000000000000000000000",
  VJGovernor: "0x0000000000000000000000000000000000000000",
  RulingAnchor: "0x0000000000000000000000000000000000000000",
  OracleRegistry: "0x0000000000000000000000000000000000000000",
  LegacyCourtBridge: "0x0000000000000000000000000000000000000000",
};

// Sepolia testnet addresses (will be set after deployment)
const sepoliaAddresses: ContractAddresses = {
  ...hardhatAddresses, // Copy structure, update after deployment
};

// Mainnet addresses (will be set after deployment)
const mainnetAddresses: ContractAddresses = {
  ...hardhatAddresses, // Copy structure, update after deployment
};

export const contractAddresses: Record<number, ContractAddresses> = {
  31337: hardhatAddresses, // Hardhat
  11155111: sepoliaAddresses, // Sepolia
  1: mainnetAddresses, // Mainnet
};

export function getContractAddress(
  chainId: number,
  contractName: keyof ContractAddresses
): Address {
  const addresses = contractAddresses[chainId];
  if (!addresses) {
    throw new Error(`No addresses configured for chain ${chainId}`);
  }
  return addresses[contractName];
}
