"use client";

import { useParams } from "next/navigation";
import { useGetDispute } from "@/lib/contracts";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DisputeStatusBadge } from "@/components/ui/status-badge";
import { AddressDisplay } from "@/components/ui/address-display";
import { Button } from "@/components/ui/button";
import { formatTokenAmount } from "@/lib/utils";
import Link from "next/link";
import { ArrowLeft, FileText, Gavel } from "lucide-react";

export default function DisputeDetailPage() {
  const params = useParams();
  const disputeId = BigInt(params.id as string);
  const { data: dispute, isLoading } = useGetDispute(disputeId);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!dispute) {
    return (
      <div className="space-y-6">
        <PageHeader title="Dispute Not Found" description="The requested dispute does not exist" />
        <Button asChild>
          <Link href="/disputes">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Disputes
          </Link>
        </Button>
      </div>
    );
  }

  const d = dispute as {
    id: bigint;
    contractId: bigint;
    claimant: `0x${string}`;
    respondent: `0x${string}`;
    courtId: bigint;
    state: number;
    claim: string;
    response: string;
    restitutionAmount: bigint;
    filedAt: bigint;
  };

  const filedAt = new Date(Number(d.filedAt) * 1000);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/disputes">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <PageHeader
          title={`Dispute #${d.id.toString()}`}
          description={`Filed ${filedAt.toLocaleDateString()}`}
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Dispute Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status</span>
              <DisputeStatusBadge status={d.state} />
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Contract</span>
              <Link href={`/contracts/${d.contractId.toString()}`} className="font-medium text-primary hover:underline">
                #{d.contractId.toString()}
              </Link>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Court</span>
              <Link href={`/courts/${d.courtId.toString()}`} className="font-medium text-primary hover:underline">
                #{d.courtId.toString()}
              </Link>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Restitution Claimed</span>
              <span className="font-medium">{formatTokenAmount(d.restitutionAmount)} ETH</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Parties</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="text-sm text-muted-foreground mb-1">Claimant</div>
              <AddressDisplay address={d.claimant} />
            </div>
            <div>
              <div className="text-sm text-muted-foreground mb-1">Respondent</div>
              <AddressDisplay address={d.respondent} />
            </div>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Claim</CardTitle>
            <CardDescription>Statement from the claimant</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="bg-muted p-4 rounded-lg whitespace-pre-wrap">
              {d.claim || "No claim statement provided"}
            </div>
          </CardContent>
        </Card>

        {d.response && (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>Response</CardTitle>
              <CardDescription>Statement from the respondent</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="bg-muted p-4 rounded-lg whitespace-pre-wrap">
                {d.response}
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Actions</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-4">
            {d.state === 0 && (
              <Button>
                <FileText className="mr-2 h-4 w-4" />
                Submit Response
              </Button>
            )}
            {d.state === 1 && (
              <Button>
                <FileText className="mr-2 h-4 w-4" />
                Submit Evidence
              </Button>
            )}
            {d.state === 3 && (
              <Button variant="outline">
                <Gavel className="mr-2 h-4 w-4" />
                Appeal Ruling
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
