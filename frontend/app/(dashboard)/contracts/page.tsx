import { PageHeader } from "@/components/layout/page-header";
import { ContractList } from "@/components/features/contracts/contract-list";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import Link from "next/link";

export default function ContractsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Contracts"
        description="Manage your contracts and agreements"
        action={
          <Button asChild>
            <Link href="/contracts?action=create">
              <Plus className="mr-2 h-4 w-4" />
              Create Contract
            </Link>
          </Button>
        }
      />
      <ContractList />
    </div>
  );
}
