"use client";

import { useAccount } from "wagmi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePoliciesByHolder, useGetPolicy } from "@/lib/contracts";
import { PolicyStatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { formatTokenAmount } from "@/lib/utils";

function PolicyRow({ policyId }: { policyId: bigint }) {
  const { data: policy, isLoading } = useGetPolicy(policyId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-between p-4 border-b">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-6 w-24" />
      </div>
    );
  }

  if (!policy) return null;

  const p = policy as {
    id: bigint;
    insurerId: bigint;
    policyholder: `0x${string}`;
    coverageAmount: bigint;
    premium: bigint;
    state: number;
    expiresAt: bigint;
  };

  const expiresAt = new Date(Number(p.expiresAt) * 1000);
  const isExpired = expiresAt < new Date();

  return (
    <div className="flex items-center justify-between p-4 border-b last:border-0">
      <div className="space-y-1">
        <div className="font-medium">Policy #{p.id.toString()}</div>
        <div className="text-sm text-muted-foreground">
          Coverage: {formatTokenAmount(p.coverageAmount)} ETH · Premium: {formatTokenAmount(p.premium)} ETH
        </div>
        <div className="text-xs text-muted-foreground">
          Expires: {expiresAt.toLocaleDateString()} {isExpired && "(Expired)"}
        </div>
      </div>
      <div className="flex items-center gap-4">
        <PolicyStatusBadge status={p.state} />
        <Button variant="outline" size="sm" asChild>
          <Link href={`/insurance/${p.id.toString()}`}>View</Link>
        </Button>
      </div>
    </div>
  );
}

export function PolicyList() {
  const { address } = useAccount();
  const { data: policyIds, isLoading } = usePoliciesByHolder(address);

  if (!address) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your Policies</CardTitle>
          <CardDescription>Connect your wallet to view policies</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your Policies</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  const ids = (policyIds as bigint[]) || [];

  if (ids.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your Policies</CardTitle>
          <CardDescription>You don&apos;t have any insurance policies</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Browse insurers to purchase coverage for your contracts.
          </p>
          <Button asChild>
            <Link href="/insurance?tab=insurers">Browse Insurers</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your Policies</CardTitle>
        <CardDescription>{ids.length} policy(ies) found</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {ids.map((id) => (
          <PolicyRow key={id.toString()} policyId={id} />
        ))}
      </CardContent>
    </Card>
  );
}
