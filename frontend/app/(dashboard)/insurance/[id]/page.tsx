"use client";

import { useParams } from "next/navigation";
import { useGetPolicy } from "@/lib/contracts";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PolicyStatusBadge } from "@/components/ui/status-badge";
import { AddressDisplay } from "@/components/ui/address-display";
import { Button } from "@/components/ui/button";
import { formatTokenAmount } from "@/lib/utils";
import Link from "next/link";
import { ArrowLeft, AlertTriangle, RefreshCw } from "lucide-react";

export default function PolicyDetailPage() {
  const params = useParams();
  const policyId = BigInt(params.id as string);
  const { data: policy, isLoading } = useGetPolicy(policyId);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!policy) {
    return (
      <div className="space-y-6">
        <PageHeader title="Policy Not Found" description="The requested policy does not exist" />
        <Button asChild>
          <Link href="/insurance">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Insurance
          </Link>
        </Button>
      </div>
    );
  }

  const p = policy as {
    id: bigint;
    insurerId: bigint;
    policyholder: `0x${string}`;
    coverageAmount: bigint;
    premium: bigint;
    state: number;
    expiresAt: bigint;
    contractId: bigint;
    createdAt: bigint;
  };

  const createdAt = new Date(Number(p.createdAt) * 1000);
  const expiresAt = new Date(Number(p.expiresAt) * 1000);
  const isExpired = expiresAt < new Date();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/insurance">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <PageHeader
          title={`Policy #${p.id.toString()}`}
          description={`Created ${createdAt.toLocaleDateString()}`}
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Policy Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status</span>
              <PolicyStatusBadge status={p.state} />
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Insurer</span>
              <Link href={`/insurance/insurer/${p.insurerId.toString()}`} className="font-medium text-primary hover:underline">
                #{p.insurerId.toString()}
              </Link>
            </div>
            {p.contractId > 0n && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Covered Contract</span>
                <Link href={`/contracts/${p.contractId.toString()}`} className="font-medium text-primary hover:underline">
                  #{p.contractId.toString()}
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Coverage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Coverage Amount</span>
              <span className="font-medium">{formatTokenAmount(p.coverageAmount)} ETH</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Premium Paid</span>
              <span className="font-medium">{formatTokenAmount(p.premium)} ETH</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Expires</span>
              <span className={`font-medium ${isExpired ? "text-red-500" : ""}`}>
                {expiresAt.toLocaleDateString()}
                {isExpired && " (Expired)"}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Policyholder</CardTitle>
          </CardHeader>
          <CardContent>
            <AddressDisplay address={p.policyholder} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Actions</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-4">
            {p.state === 0 && !isExpired && (
              <Button variant="destructive">
                <AlertTriangle className="mr-2 h-4 w-4" />
                File Claim
              </Button>
            )}
            {p.state === 0 && isExpired && (
              <Button>
                <RefreshCw className="mr-2 h-4 w-4" />
                Renew Policy
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
