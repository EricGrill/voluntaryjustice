import { PageHeader } from "@/components/layout/page-header";
import { StatsCards } from "@/components/features/dashboard/stats-cards";
import { QuickActions } from "@/components/features/dashboard/quick-actions";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Overview of your VoluntaryJustice activity"
      />
      <StatsCards />
      <QuickActions />
    </div>
  );
}
