"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useListInsurers } from "@/lib/contracts";
import { AddressDisplay } from "@/components/ui/address-display";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { formatTokenAmount } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

interface Insurer {
  id: bigint;
  owner: `0x${string}`;
  name: string;
  active: boolean;
  totalPolicies: bigint;
  totalCoverage: bigint;
  minPremiumRate: bigint;
}

function InsurerCard({ insurer }: { insurer: Insurer }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{insurer.name}</CardTitle>
          <Badge variant={insurer.active ? "default" : "secondary"}>
            {insurer.active ? "Active" : "Inactive"}
          </Badge>
        </div>
        <CardDescription>
          <AddressDisplay address={insurer.owner} showCopy={false} />
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 text-sm mb-4">
          <div>
            <div className="text-muted-foreground">Policies</div>
            <div className="font-medium">{insurer.totalPolicies.toString()}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Total Coverage</div>
            <div className="font-medium">{formatTokenAmount(insurer.totalCoverage)} ETH</div>
          </div>
          <div>
            <div className="text-muted-foreground">Min Premium Rate</div>
            <div className="font-medium">{(Number(insurer.minPremiumRate) / 100).toFixed(2)}%</div>
          </div>
        </div>
        <Button className="w-full" variant="outline" asChild>
          <Link href={`/insurance/insurer/${insurer.id.toString()}`}>View Details</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export function InsurerList() {
  const { data: insurers, isLoading } = useListInsurers();

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-20 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const insurerList = (insurers as Insurer[]) || [];

  if (insurerList.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No Insurers Found</CardTitle>
          <CardDescription>
            There are no registered insurers yet. Be the first to register!
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/insurance?action=register">Register as Insurer</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {insurerList.map((insurer) => (
        <InsurerCard key={insurer.id.toString()} insurer={insurer} />
      ))}
    </div>
  );
}
