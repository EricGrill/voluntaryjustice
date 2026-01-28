"use client";

import { useParams } from "next/navigation";
import { useGetContract } from "@/lib/contracts";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ContractStatusBadge } from "@/components/ui/status-badge";
import { AddressDisplay } from "@/components/ui/address-display";
import { Button } from "@/components/ui/button";
import { formatTokenAmount } from "@/lib/utils";
import Link from "next/link";
import { ArrowLeft, AlertTriangle, Check } from "lucide-react";

export default function ContractDetailPage() {
  const params = useParams();
  const contractId = BigInt(params.id as string);
  const { data: contract, isLoading } = useGetContract(contractId);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="space-y-6">
        <PageHeader title="Contract Not Found" description="The requested contract does not exist" />
        <Button asChild>
          <Link href="/contracts">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Contracts
          </Link>
        </Button>
      </div>
    );
  }

  const c = contract as {
    id: bigint;
    templateId: bigint;
    state: number;
    parties: `0x${string}`[];
    escrowRequired: bigint;
    terms: string;
    createdAt: bigint;
  };

  const createdAt = new Date(Number(c.createdAt) * 1000);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/contracts">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <PageHeader
          title={`Contract #${c.id.toString()}`}
          description={`Created ${createdAt.toLocaleDateString()}`}
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Contract Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status</span>
              <ContractStatusBadge status={c.state} />
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Template ID</span>
              <span className="font-medium">#{c.templateId.toString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Escrow Required</span>
              <span className="font-medium">{formatTokenAmount(c.escrowRequired)} ETH</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Parties</CardTitle>
            <CardDescription>{c.parties.length} parties in this contract</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {c.parties.map((party, i) => (
              <div key={party} className="flex items-center justify-between p-2 bg-muted rounded">
                <span className="text-sm text-muted-foreground">Party {i + 1}</span>
                <AddressDisplay address={party} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Terms</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="bg-muted p-4 rounded-lg whitespace-pre-wrap font-mono text-sm">
              {c.terms || "No terms specified"}
            </div>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Actions</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-4">
            {c.state === 0 && (
              <Button>
                <Check className="mr-2 h-4 w-4" />
                Sign Contract
              </Button>
            )}
            {c.state === 2 && (
              <Button variant="destructive">
                <AlertTriangle className="mr-2 h-4 w-4" />
                File Dispute
              </Button>
            )}
            {c.state === 2 && (
              <Button variant="outline">
                <Check className="mr-2 h-4 w-4" />
                Mark Complete
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
