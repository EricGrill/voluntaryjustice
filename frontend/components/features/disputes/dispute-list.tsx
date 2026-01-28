"use client";

import { useAccount } from "wagmi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useDisputesByParty, useGetDispute } from "@/lib/contracts";
import { DisputeStatusBadge } from "@/components/ui/status-badge";
import { AddressDisplay } from "@/components/ui/address-display";
import { Button } from "@/components/ui/button";
import Link from "next/link";

function DisputeRow({ disputeId }: { disputeId: bigint }) {
  const { data: dispute, isLoading } = useGetDispute(disputeId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-between p-4 border-b">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-6 w-24" />
      </div>
    );
  }

  if (!dispute) return null;

  const d = dispute as {
    id: bigint;
    contractId: bigint;
    claimant: `0x${string}`;
    respondent: `0x${string}`;
    state: number;
    claim: string;
    restitutionAmount: bigint;
  };

  return (
    <div className="flex items-center justify-between p-4 border-b last:border-0">
      <div className="space-y-1">
        <div className="font-medium">Dispute #{d.id.toString()}</div>
        <div className="text-sm text-muted-foreground">
          Contract #{d.contractId.toString()} · {d.claim.slice(0, 50)}...
        </div>
        <div className="text-xs text-muted-foreground">
          <AddressDisplay address={d.claimant} showCopy={false} /> vs{" "}
          <AddressDisplay address={d.respondent} showCopy={false} />
        </div>
      </div>
      <div className="flex items-center gap-4">
        <DisputeStatusBadge status={d.state} />
        <Button variant="outline" size="sm" asChild>
          <Link href={`/disputes/${d.id.toString()}`}>View</Link>
        </Button>
      </div>
    </div>
  );
}

export function DisputeList() {
  const { address } = useAccount();
  const { data: disputeIds, isLoading } = useDisputesByParty(address);

  if (!address) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your Disputes</CardTitle>
          <CardDescription>Connect your wallet to view disputes</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your Disputes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  const ids = (disputeIds as bigint[]) || [];

  if (ids.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your Disputes</CardTitle>
          <CardDescription>You don&apos;t have any disputes</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Disputes are filed when there&apos;s a disagreement on a contract.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your Disputes</CardTitle>
        <CardDescription>{ids.length} dispute(s) found</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {ids.map((id) => (
          <DisputeRow key={id.toString()} disputeId={id} />
        ))}
      </CardContent>
    </Card>
  );
}
