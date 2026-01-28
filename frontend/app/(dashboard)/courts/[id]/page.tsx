"use client";

import { useParams } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AddressDisplay } from "@/components/ui/address-display";
import { Button } from "@/components/ui/button";
import { formatTokenAmount } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { ArrowLeft, Scale, Users, Clock } from "lucide-react";

// Mock court data until we have proper contract reads
const mockCourt = {
  id: 1n,
  owner: "0x1234567890123456789012345678901234567890" as `0x${string}`,
  name: "General Arbitration Court",
  jurisdiction: "International",
  description: "A general-purpose arbitration court for contract disputes. We specialize in fair and efficient resolution of business disagreements.",
  active: true,
  totalCases: 42n,
  resolvedCases: 38n,
  minStake: 1000000000000000000n, // 1 ETH
  judges: [
    "0xaaaa567890123456789012345678901234567890",
    "0xbbbb567890123456789012345678901234567890",
    "0xcccc567890123456789012345678901234567890",
  ] as `0x${string}`[],
};

export default function CourtDetailPage() {
  const params = useParams();
  const courtId = BigInt(params.id as string);

  // In production, this would use useGetCourt(courtId)
  const isLoading = false;
  const court = mockCourt;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!court) {
    return (
      <div className="space-y-6">
        <PageHeader title="Court Not Found" description="The requested court does not exist" />
        <Button asChild>
          <Link href="/courts">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Courts
          </Link>
        </Button>
      </div>
    );
  }

  const resolutionRate = court.totalCases > 0n
    ? Number((court.resolvedCases * 100n) / court.totalCases)
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/courts">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <PageHeader
          title={court.name}
          description={court.jurisdiction}
        />
        <Badge variant={court.active ? "default" : "secondary"} className="ml-auto">
          {court.active ? "Active" : "Inactive"}
        </Badge>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Cases</CardTitle>
            <Scale className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{court.totalCases.toString()}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Resolution Rate</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{resolutionRate}%</div>
            <p className="text-xs text-muted-foreground">{court.resolvedCases.toString()} resolved</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Min Stake</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatTokenAmount(court.minStake)}</div>
            <p className="text-xs text-muted-foreground">VJ tokens</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>About</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">{court.description}</p>
            <div className="mt-4">
              <span className="text-sm text-muted-foreground">Owner: </span>
              <AddressDisplay address={court.owner} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Judges</CardTitle>
            <CardDescription>{court.judges.length} registered judges</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {court.judges.map((judge, i) => (
              <div key={judge} className="flex items-center justify-between p-2 bg-muted rounded">
                <span className="text-sm text-muted-foreground">Judge {i + 1}</span>
                <AddressDisplay address={judge} />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Select This Court</CardTitle>
          <CardDescription>Choose this court for dispute resolution in your contracts</CardDescription>
        </CardHeader>
        <CardContent>
          <Button>
            <Scale className="mr-2 h-4 w-4" />
            Use This Court
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
