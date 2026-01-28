"use client";

import { useAccount } from "wagmi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useContractsByParty, useGetContract } from "@/lib/contracts";
import { ContractStatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { formatTokenAmount } from "@/lib/utils";

function ContractRow({ contractId }: { contractId: bigint }) {
  const { data: contract, isLoading } = useGetContract(contractId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-between p-4 border-b">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-6 w-24" />
      </div>
    );
  }

  if (!contract) return null;

  const c = contract as {
    id: bigint;
    templateId: bigint;
    state: number;
    parties: `0x${string}`[];
    escrowRequired: bigint;
  };

  return (
    <div className="flex items-center justify-between p-4 border-b last:border-0">
      <div className="space-y-1">
        <div className="font-medium">Contract #{c.id.toString()}</div>
        <div className="text-sm text-muted-foreground">
          {c.parties.length} parties · Escrow: {formatTokenAmount(c.escrowRequired)} ETH
        </div>
      </div>
      <div className="flex items-center gap-4">
        <ContractStatusBadge status={c.state} />
        <Button variant="outline" size="sm" asChild>
          <Link href={`/contracts/${c.id.toString()}`}>View</Link>
        </Button>
      </div>
    </div>
  );
}

export function ContractList() {
  const { address } = useAccount();
  const { data: contractIds, isLoading } = useContractsByParty(address);

  if (!address) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your Contracts</CardTitle>
          <CardDescription>Connect your wallet to view contracts</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your Contracts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  const ids = (contractIds as bigint[]) || [];

  if (ids.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your Contracts</CardTitle>
          <CardDescription>You don&apos;t have any contracts yet</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/contracts?action=create">Create Your First Contract</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your Contracts</CardTitle>
        <CardDescription>{ids.length} contract(s) found</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {ids.map((id) => (
          <ContractRow key={id.toString()} contractId={id} />
        ))}
      </CardContent>
    </Card>
  );
}
