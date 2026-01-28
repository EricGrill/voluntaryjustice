"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useListCourts } from "@/lib/contracts";
import { AddressDisplay } from "@/components/ui/address-display";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { formatTokenAmount } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

interface Court {
  id: bigint;
  owner: `0x${string}`;
  name: string;
  jurisdiction: string;
  active: boolean;
  totalCases: bigint;
  resolvedCases: bigint;
  minStake: bigint;
}

function CourtCard({ court }: { court: Court }) {
  const resolutionRate = court.totalCases > 0n
    ? Number((court.resolvedCases * 100n) / court.totalCases)
    : 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{court.name}</CardTitle>
          <Badge variant={court.active ? "default" : "secondary"}>
            {court.active ? "Active" : "Inactive"}
          </Badge>
        </div>
        <CardDescription>
          {court.jurisdiction} · <AddressDisplay address={court.owner} showCopy={false} />
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 text-sm mb-4">
          <div>
            <div className="text-muted-foreground">Total Cases</div>
            <div className="font-medium">{court.totalCases.toString()}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Resolved</div>
            <div className="font-medium">{court.resolvedCases.toString()}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Resolution Rate</div>
            <div className="font-medium">{resolutionRate}%</div>
          </div>
          <div>
            <div className="text-muted-foreground">Min Stake</div>
            <div className="font-medium">{formatTokenAmount(court.minStake)} VJ</div>
          </div>
        </div>
        <Button className="w-full" variant="outline" asChild>
          <Link href={`/courts/${court.id.toString()}`}>View Court</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export function CourtList() {
  const { data: courts, isLoading } = useListCourts();

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
              <Skeleton className="h-24 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const courtList = (courts as Court[]) || [];

  if (courtList.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No Courts Found</CardTitle>
          <CardDescription>
            There are no registered courts yet. Register your court to provide dispute resolution services.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/courts?action=register">Register Court</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {courtList.map((court) => (
        <CourtCard key={court.id.toString()} court={court} />
      ))}
    </div>
  );
}
