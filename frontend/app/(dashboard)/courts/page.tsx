import { PageHeader } from "@/components/layout/page-header";
import { CourtList } from "@/components/features/courts/court-list";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import Link from "next/link";

export default function CourtsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Courts"
        description="Browse available courts for dispute resolution"
        action={
          <Button asChild>
            <Link href="/courts?action=register">
              <Plus className="mr-2 h-4 w-4" />
              Register Court
            </Link>
          </Button>
        }
      />
      <CourtList />
    </div>
  );
}
