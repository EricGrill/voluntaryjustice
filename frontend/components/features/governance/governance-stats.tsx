"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useVJBalance } from "@/lib/contracts";
import { useAccount } from "wagmi";
import { formatTokenAmount } from "@/lib/utils";
import { Vote, Users, FileText, Clock } from "lucide-react";

export function GovernanceStats() {
  const { address } = useAccount();
  const { data: balance, isLoading } = useVJBalance(address);

  const stats = [
    {
      title: "Your Voting Power",
      value: balance ? formatTokenAmount(balance as bigint) : "0",
      icon: Vote,
      description: "VJ tokens",
    },
    {
      title: "Active Proposals",
      value: "0",
      icon: FileText,
      description: "Open for voting",
    },
    {
      title: "Total Voters",
      value: "--",
      icon: Users,
      description: "Token holders",
    },
    {
      title: "Voting Period",
      value: "7 days",
      icon: Clock,
      description: "Per proposal",
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <Card key={stat.title}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
            <stat.icon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading && stat.title === "Your Voting Power" ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <>
                <div className="text-2xl font-bold">{stat.value}</div>
                <p className="text-xs text-muted-foreground">{stat.description}</p>
              </>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
