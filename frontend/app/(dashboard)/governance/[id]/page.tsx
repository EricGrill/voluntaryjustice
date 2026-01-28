"use client";

import { useParams } from "next/navigation";
import { useAccount } from "wagmi";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AddressDisplay } from "@/components/ui/address-display";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import Link from "next/link";
import { ArrowLeft, ThumbsUp, ThumbsDown, MinusCircle } from "lucide-react";

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

// Mock proposal data
const mockProposal = {
  id: 1n,
  proposer: "0x1234567890123456789012345678901234567890" as `0x${string}`,
  description: `# Increase Staking Rewards

This proposal aims to increase the staking rewards for VJ token holders from 5% to 8% APY.

## Rationale

Current staking rewards are not competitive with other DeFi protocols. Increasing rewards will:
- Attract more stakers
- Increase token utility
- Strengthen protocol security

## Implementation

1. Update RewardsDistributor contract
2. Increase rewards pool allocation
3. Update documentation`,
  forVotes: 150000000000000000000000n, // 150k tokens
  againstVotes: 50000000000000000000000n, // 50k tokens
  abstainVotes: 10000000000000000000000n, // 10k tokens
  state: 1,
  startBlock: 1000000n,
  endBlock: 1050400n, // ~7 days at 12s blocks
  createdAt: 1706400000n,
};

export default function ProposalDetailPage() {
  const params = useParams();
  const proposalId = BigInt(params.id as string);
  const { address } = useAccount();

  // In production, this would fetch from contract/indexer
  const isLoading = false;
  const proposal = mockProposal;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!proposal) {
    return (
      <div className="space-y-6">
        <PageHeader title="Proposal Not Found" description="The requested proposal does not exist" />
        <Button asChild>
          <Link href="/governance">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Governance
          </Link>
        </Button>
      </div>
    );
  }

  const totalVotes = proposal.forVotes + proposal.againstVotes + proposal.abstainVotes;
  const forPercentage = totalVotes > 0n ? Number((proposal.forVotes * 100n) / totalVotes) : 0;
  const againstPercentage = totalVotes > 0n ? Number((proposal.againstVotes * 100n) / totalVotes) : 0;
  const abstainPercentage = totalVotes > 0n ? Number((proposal.abstainVotes * 100n) / totalVotes) : 0;

  const stateMap: ProposalState[] = ["pending", "active", "canceled", "defeated", "succeeded", "queued", "expired", "executed"];
  const stateKey = stateMap[proposal.state] || "pending";
  const stateConfig = proposalStateConfig[stateKey];

  const isActive = proposal.state === 1;

  // Extract title from description
  const lines = proposal.description.split("\n");
  const title = lines[0].replace(/^#\s*/, "").slice(0, 60);
  const body = lines.slice(1).join("\n").trim();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/governance">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <PageHeader
          title={title}
          description={`Proposal #${proposal.id.toString()}`}
        />
        <Badge variant={stateConfig.variant} className="ml-auto">
          {stateConfig.label}
        </Badge>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Description</CardTitle>
            <CardDescription>
              Proposed by <AddressDisplay address={proposal.proposer} showCopy={false} />
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">
              {body}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Voting Results</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-green-500 flex items-center gap-1">
                    <ThumbsUp className="h-3 w-3" /> For
                  </span>
                  <span>{forPercentage}%</span>
                </div>
                <Progress value={forPercentage} className="h-2" />
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-red-500 flex items-center gap-1">
                    <ThumbsDown className="h-3 w-3" /> Against
                  </span>
                  <span>{againstPercentage}%</span>
                </div>
                <Progress value={againstPercentage} className="h-2 [&>div]:bg-red-500" />
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <MinusCircle className="h-3 w-3" /> Abstain
                  </span>
                  <span>{abstainPercentage}%</span>
                </div>
                <Progress value={abstainPercentage} className="h-2 [&>div]:bg-gray-400" />
              </div>
            </CardContent>
          </Card>

          {isActive && address && (
            <Card>
              <CardHeader>
                <CardTitle>Cast Your Vote</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button className="w-full" variant="outline">
                  <ThumbsUp className="mr-2 h-4 w-4 text-green-500" />
                  Vote For
                </Button>
                <Button className="w-full" variant="outline">
                  <ThumbsDown className="mr-2 h-4 w-4 text-red-500" />
                  Vote Against
                </Button>
                <Button className="w-full" variant="outline">
                  <MinusCircle className="mr-2 h-4 w-4" />
                  Abstain
                </Button>
              </CardContent>
            </Card>
          )}

          {!address && (
            <Card>
              <CardHeader>
                <CardTitle>Connect Wallet</CardTitle>
                <CardDescription>Connect your wallet to vote on this proposal</CardDescription>
              </CardHeader>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
