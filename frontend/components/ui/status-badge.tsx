import { Badge } from "@/components/ui/badge";

type ContractStatus = "draft" | "pending" | "active" | "disputed" | "completed" | "terminated";
type DisputeStatus = "filed" | "evidence" | "ruling" | "finalized" | "appealed";
type PolicyStatus = "active" | "expired" | "cancelled" | "claim_filed" | "claim_paid";

const contractStatusConfig: Record<ContractStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  draft: { label: "Draft", variant: "secondary" },
  pending: { label: "Pending Signatures", variant: "outline" },
  active: { label: "Active", variant: "default" },
  disputed: { label: "Disputed", variant: "destructive" },
  completed: { label: "Completed", variant: "secondary" },
  terminated: { label: "Terminated", variant: "destructive" },
};

const disputeStatusConfig: Record<DisputeStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  filed: { label: "Filed", variant: "outline" },
  evidence: { label: "Evidence Period", variant: "secondary" },
  ruling: { label: "Awaiting Ruling", variant: "default" },
  finalized: { label: "Finalized", variant: "secondary" },
  appealed: { label: "Appealed", variant: "destructive" },
};

const policyStatusConfig: Record<PolicyStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  active: { label: "Active", variant: "default" },
  expired: { label: "Expired", variant: "secondary" },
  cancelled: { label: "Cancelled", variant: "outline" },
  claim_filed: { label: "Claim Filed", variant: "destructive" },
  claim_paid: { label: "Claim Paid", variant: "secondary" },
};

export function ContractStatusBadge({ status }: { status: number }) {
  const statusMap: ContractStatus[] = ["draft", "pending", "active", "disputed", "completed", "terminated"];
  const statusKey = statusMap[status] || "draft";
  const config = contractStatusConfig[statusKey];
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

export function DisputeStatusBadge({ status }: { status: number }) {
  const statusMap: DisputeStatus[] = ["filed", "evidence", "ruling", "finalized", "appealed"];
  const statusKey = statusMap[status] || "filed";
  const config = disputeStatusConfig[statusKey];
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

export function PolicyStatusBadge({ status }: { status: number }) {
  const statusMap: PolicyStatus[] = ["active", "expired", "cancelled", "claim_filed", "claim_paid"];
  const statusKey = statusMap[status] || "active";
  const config = policyStatusConfig[statusKey];
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
