"use client";

import { Suspense } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { PolicyList } from "@/components/features/insurance/policy-list";
import { InsurerList } from "@/components/features/insurance/insurer-list";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSearchParams } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";

function InsuranceContent() {
  const searchParams = useSearchParams();
  const defaultTab = searchParams.get("tab") || "policies";

  return (
    <Tabs defaultValue={defaultTab} className="space-y-4">
      <TabsList>
        <TabsTrigger value="policies">Your Policies</TabsTrigger>
        <TabsTrigger value="insurers">Browse Insurers</TabsTrigger>
      </TabsList>
      <TabsContent value="policies">
        <PolicyList />
      </TabsContent>
      <TabsContent value="insurers">
        <InsurerList />
      </TabsContent>
    </Tabs>
  );
}

export default function InsurancePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Insurance"
        description="Manage your insurance policies and browse insurers"
      />
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <InsuranceContent />
      </Suspense>
    </div>
  );
}
