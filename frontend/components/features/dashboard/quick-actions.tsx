"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, AlertTriangle, Shield } from "lucide-react";
import Link from "next/link";

export function QuickActions() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick Actions</CardTitle>
        <CardDescription>Common tasks you can perform</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-4">
        <Button asChild>
          <Link href="/contracts?action=create">
            <Plus className="mr-2 h-4 w-4" />
            Create Contract
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/disputes?action=file">
            <AlertTriangle className="mr-2 h-4 w-4" />
            File Dispute
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/insurance?action=purchase">
            <Shield className="mr-2 h-4 w-4" />
            Buy Insurance
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
