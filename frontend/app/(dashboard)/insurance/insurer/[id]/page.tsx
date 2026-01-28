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
import { ArrowLeft, Shield, DollarSign, FileText } from "lucide-react";

// Mock insurer data
const mockInsurer = {
  id: 1n,
  owner: "0x1234567890123456789012345678901234567890" as `0x${string}`,
  name: "SecureVault Insurance",
  description: "Premier decentralized insurance provider specializing in smart contract coverage. We offer competitive rates and fast claim processing.",
  active: true,
  totalPolicies: 156n,
  totalCoverage: 5000000000000000000000n, // 5000 ETH
  totalPremiums: 250000000000000000000n, // 250 ETH
  minPremiumRate: 200n, // 2%
  maxCoveragePerPolicy: 100000000000000000000n, // 100 ETH
  supportedContractTypes: ["Service", "Escrow", "Milestone"],
};

export default function InsurerDetailPage() {
  const params = useParams();
  const insurerId = BigInt(params.id as string);

  // In production, this would fetch from contract
  const isLoading = false;
  const insurer = mockInsurer;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!insurer) {
    return (
      <div className="space-y-6">
        <PageHeader title="Insurer Not Found" description="The requested insurer does not exist" />
        <Button asChild>
          <Link href="/insurance?tab=insurers">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Insurers
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/insurance?tab=insurers">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <PageHeader
          title={insurer.name}
          description={`Insurer #${insurer.id.toString()}`}
        />
        <Badge variant={insurer.active ? "default" : "secondary"} className="ml-auto">
          {insurer.active ? "Active" : "Inactive"}
        </Badge>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Policies</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{insurer.totalPolicies.toString()}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Coverage</CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatTokenAmount(insurer.totalCoverage)}</div>
            <p className="text-xs text-muted-foreground">ETH insured</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Premiums Collected</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatTokenAmount(insurer.totalPremiums)}</div>
            <p className="text-xs text-muted-foreground">ETH</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>About</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">{insurer.description}</p>
            <div>
              <span className="text-sm text-muted-foreground">Owner: </span>
              <AddressDisplay address={insurer.owner} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Coverage Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Min Premium Rate</span>
              <span className="font-medium">{(Number(insurer.minPremiumRate) / 100).toFixed(2)}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Max Coverage/Policy</span>
              <span className="font-medium">{formatTokenAmount(insurer.maxCoveragePerPolicy)} ETH</span>
            </div>
            <div>
              <span className="text-muted-foreground">Supported Contract Types</span>
              <div className="flex flex-wrap gap-2 mt-2">
                {insurer.supportedContractTypes.map((type) => (
                  <Badge key={type} variant="secondary">{type}</Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Purchase Coverage</CardTitle>
          <CardDescription>Get insurance coverage for your contracts</CardDescription>
        </CardHeader>
        <CardContent>
          <Button>
            <Shield className="mr-2 h-4 w-4" />
            Get Quote
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
