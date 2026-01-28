"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, Scale, Shield, Coins } from "lucide-react";
import { useAccount } from "wagmi";
import { useVJBalance, useContractsByParty, useDisputesByParty, usePoliciesByHolder } from "@/lib/contracts";
import { formatTokenAmount } from "@/lib/utils";

export function StatsCards() {
  const { address } = useAccount();
  const { data: vjBalance, isLoading: balanceLoading } = useVJBalance(address);
  const { data: contracts, isLoading: contractsLoading } = useContractsByParty(address);
  const { data: disputes, isLoading: disputesLoading } = useDisputesByParty(address);
  const { data: policies, isLoading: policiesLoading } = usePoliciesByHolder(address);

  const stats = [
    {
      name: "VJ Balance",
      value: vjBalance ? formatTokenAmount(vjBalance as bigint) : "0",
      icon: Coins,
      loading: balanceLoading,
    },
    {
      name: "Active Contracts",
      value: contracts ? (contracts as bigint[]).length.toString() : "0",
      icon: FileText,
      loading: contractsLoading,
    },
    {
      name: "Open Disputes",
      value: disputes ? (disputes as bigint[]).length.toString() : "0",
      icon: Scale,
      loading: disputesLoading,
    },
    {
      name: "Insurance Policies",
      value: policies ? (policies as bigint[]).length.toString() : "0",
      icon: Shield,
      loading: policiesLoading,
    },
  ];

  if (!address) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.name}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.name}</CardTitle>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-muted-foreground">--</div>
              <p className="text-xs text-muted-foreground">Connect wallet to view</p>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <Card key={stat.name}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{stat.name}</CardTitle>
            <stat.icon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {stat.loading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold">{stat.value}</div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
