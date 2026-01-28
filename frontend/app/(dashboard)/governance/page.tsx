import { PageHeader } from "@/components/layout/page-header";
import { ProposalList } from "@/components/features/governance/proposal-list";
import { GovernanceStats } from "@/components/features/governance/governance-stats";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import Link from "next/link";

export default function GovernancePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Governance"
        description="Participate in protocol governance"
        action={
          <Button asChild>
            <Link href="/governance?action=create">
              <Plus className="mr-2 h-4 w-4" />
              Create Proposal
            </Link>
          </Button>
        }
      />
      <GovernanceStats />
      <div>
        <h2 className="text-xl font-semibold mb-4">Active Proposals</h2>
        <ProposalList />
      </div>
    </div>
  );
}
