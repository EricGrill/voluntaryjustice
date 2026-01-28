"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AddressDisplay } from "@/components/ui/address-display";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

type ProposalState = "pending" | "active" | "canceled" | "defeated" | "succeeded" | "queued" | "expired" | "executed";

const proposalStateConfig: Record<ProposalState, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "Pending", variant: "outline" },
  active: { label: "Active", variant: "default" },
  canceled: { label: "Canceled", variant: "secondary" },
  defeated: { label: "Defeated", variant: "destructive" },
  succeeded: { label: "Succeeded", variant: "default" },
  queued: { label: "Queued", variant: "secondary" },
  expired: { label: "Expired", variant: "secondary" },
  executed: { label: "Executed", variant: "default" },
};

function ProposalStateBadge({ state }: { state: number }) {
  const stateMap: ProposalState[] = ["pending", "active", "canceled", "defeated", "succeeded", "queued", "expired", "executed"];
  const stateKey = stateMap[state] || "pending";
  const config = proposalStateConfig[stateKey];
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

interface Proposal {
  id: bigint;
  proposer: `0x${string}`;
  description: string;
  forVotes: bigint;
  againstVotes: bigint;
  abstainVotes: bigint;
  state: number;
  startBlock: bigint;
  endBlock: bigint;
}

function ProposalCard({ proposal }: { proposal: Proposal }) {
  const totalVotes = proposal.forVotes + proposal.againstVotes + proposal.abstainVotes;
  const forPercentage = totalVotes > 0n ? Number((proposal.forVotes * 100n) / totalVotes) : 0;
  const againstPercentage = totalVotes > 0n ? Number((proposal.againstVotes * 100n) / totalVotes) : 0;

  // Extract title from description (first line)
  const title = proposal.description.split("\n")[0].slice(0, 60) || "Untitled Proposal";

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg truncate">{title}</CardTitle>
          <ProposalStateBadge state={proposal.state} />
        </div>
        <CardDescription>
          Proposed by <AddressDisplay address={proposal.proposer} showCopy={false} />
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3 mb-4">
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-green-500">For</span>
              <span>{forPercentage}%</span>
            </div>
            <Progress value={forPercentage} className="h-2" />
          </div>
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-red-500">Against</span>
              <span>{againstPercentage}%</span>
            </div>
            <Progress value={againstPercentage} className="h-2 [&>div]:bg-red-500" />
          </div>
        </div>
        <Button className="w-full" variant="outline" asChild>
          <Link href={`/governance/${proposal.id.toString()}`}>View Proposal</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

// Mock data for now - would need to implement proposal indexing
const mockProposals: Proposal[] = [];

export function ProposalList() {
  // In production, this would query an indexer or the Governor contract events
  const isLoading = false;
  const proposals = mockProposals;

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-32" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-20 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (proposals.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No Proposals Found</CardTitle>
          <CardDescription>
            There are no active governance proposals. Create one to propose changes to the protocol.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/governance?action=create">Create Proposal</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {proposals.map((proposal) => (
        <ProposalCard key={proposal.id.toString()} proposal={proposal} />
      ))}
    </div>
  );
}
