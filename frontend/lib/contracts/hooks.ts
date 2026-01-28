"use client";

import { useReadContract, useWriteContract, useChainId } from "wagmi";
import { getContractAddress } from "./addresses";
import {
  VJTokenAbi,
  ContractFactoryAbi,
  DisputeResolutionAbi,
  InsurancePolicyAbi,
  InsurerRegistryAbi,
  CourtRegistryAbi,
  ReputationScoringAbi,
  EscrowVaultAbi,
} from "./abis";

// VJ Token Hooks
export function useVJBalance(address?: `0x${string}`) {
  const chainId = useChainId();
  return useReadContract({
    address: getContractAddress(chainId, "VJToken"),
    abi: VJTokenAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
}

export function useVJTotalSupply() {
  const chainId = useChainId();
  return useReadContract({
    address: getContractAddress(chainId, "VJToken"),
    abi: VJTokenAbi,
    functionName: "totalSupply",
  });
}

// Contract Factory Hooks
export function useContractsByParty(address?: `0x${string}`) {
  const chainId = useChainId();
  return useReadContract({
    address: getContractAddress(chainId, "ContractFactory"),
    abi: ContractFactoryAbi,
    functionName: "getContractsByParty",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
}

export function useGetContract(contractId: bigint) {
  const chainId = useChainId();
  return useReadContract({
    address: getContractAddress(chainId, "ContractFactory"),
    abi: ContractFactoryAbi,
    functionName: "getContract",
    args: [contractId],
    query: { enabled: contractId > 0n },
  });
}

export function useTotalContracts() {
  const chainId = useChainId();
  return useReadContract({
    address: getContractAddress(chainId, "ContractFactory"),
    abi: ContractFactoryAbi,
    functionName: "totalContracts",
  });
}

// Dispute Resolution Hooks
export function useDisputesByParty(address?: `0x${string}`) {
  const chainId = useChainId();
  return useReadContract({
    address: getContractAddress(chainId, "DisputeResolution"),
    abi: DisputeResolutionAbi,
    functionName: "getDisputesByParty",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
}

export function useGetDispute(disputeId: bigint) {
  const chainId = useChainId();
  return useReadContract({
    address: getContractAddress(chainId, "DisputeResolution"),
    abi: DisputeResolutionAbi,
    functionName: "getDispute",
    args: [disputeId],
    query: { enabled: disputeId > 0n },
  });
}

export function useTotalDisputes() {
  const chainId = useChainId();
  return useReadContract({
    address: getContractAddress(chainId, "DisputeResolution"),
    abi: DisputeResolutionAbi,
    functionName: "totalDisputes",
  });
}

// Insurance Hooks
export function usePoliciesByHolder(address?: `0x${string}`) {
  const chainId = useChainId();
  return useReadContract({
    address: getContractAddress(chainId, "InsurancePolicy"),
    abi: InsurancePolicyAbi,
    functionName: "getPoliciesByHolder",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
}

export function useGetPolicy(policyId: bigint) {
  const chainId = useChainId();
  return useReadContract({
    address: getContractAddress(chainId, "InsurancePolicy"),
    abi: InsurancePolicyAbi,
    functionName: "getPolicy",
    args: [policyId],
    query: { enabled: policyId > 0n },
  });
}

export function useListInsurers() {
  const chainId = useChainId();
  return useReadContract({
    address: getContractAddress(chainId, "InsurerRegistry"),
    abi: InsurerRegistryAbi,
    functionName: "listInsurers",
  });
}

// Court Registry Hooks
export function useListCourts() {
  const chainId = useChainId();
  return useReadContract({
    address: getContractAddress(chainId, "CourtRegistry"),
    abi: CourtRegistryAbi,
    functionName: "listCourts",
  });
}

export function useGetCourt(courtId: bigint) {
  const chainId = useChainId();
  return useReadContract({
    address: getContractAddress(chainId, "CourtRegistry"),
    abi: CourtRegistryAbi,
    functionName: "getCourt",
    args: [courtId],
    query: { enabled: courtId > 0n },
  });
}

// Reputation Hooks
export function useGetScores(address?: `0x${string}`) {
  const chainId = useChainId();
  return useReadContract({
    address: getContractAddress(chainId, "ReputationScoring"),
    abi: ReputationScoringAbi,
    functionName: "getScores",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
}

// Escrow Hooks
export function useEscrowBalance(contractId: bigint) {
  const chainId = useChainId();
  return useReadContract({
    address: getContractAddress(chainId, "EscrowVault"),
    abi: EscrowVaultAbi,
    functionName: "getBalance",
    args: [contractId],
    query: { enabled: contractId > 0n },
  });
}

// Write Hooks
export function useContractWrite() {
  return useWriteContract();
}
