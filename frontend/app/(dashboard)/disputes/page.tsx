import { PageHeader } from "@/components/layout/page-header";
import { DisputeList } from "@/components/features/disputes/dispute-list";

export default function DisputesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Disputes"
        description="View and manage dispute resolutions"
      />
      <DisputeList />
    </div>
  );
}
