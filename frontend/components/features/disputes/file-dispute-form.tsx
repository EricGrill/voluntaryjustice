"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const fileDisputeSchema = z.object({
  contractId: z.string().min(1, "Contract ID is required"),
  respondent: z.string().min(42, "Valid respondent address required").max(42),
  courtId: z.string().min(1, "Court ID is required"),
  claim: z.string().min(20, "Claim must be at least 20 characters"),
  restitutionAmount: z.string().min(1, "Restitution amount is required"),
});

type FileDisputeFormData = z.infer<typeof fileDisputeSchema>;

interface FileDisputeFormProps {
  contractId?: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function FileDisputeForm({ contractId, onSuccess, onCancel }: FileDisputeFormProps) {
  const { address } = useAccount();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FileDisputeFormData>({
    resolver: zodResolver(fileDisputeSchema),
    defaultValues: {
      contractId: contractId || "",
      respondent: "",
      courtId: "1",
      claim: "",
      restitutionAmount: "0",
    },
  });

  const onSubmit = async (_data: FileDisputeFormData) => {
    if (!address) {
      toast.error("Please connect your wallet");
      return;
    }

    setIsSubmitting(true);
    try {
      // TODO: In production, call the contract
      // const tx = await writeContract({
      //   address: ADDRESSES.disputeResolution,
      //   abi: disputeResolutionAbi,
      //   functionName: "fileDispute",
      //   args: [
      //     BigInt(_data.contractId),
      //     _data.respondent as `0x${string}`,
      //     BigInt(_data.courtId),
      //     _data.claim,
      //     parseEther(_data.restitutionAmount),
      //   ],
      // });

      toast.success("Dispute filed successfully!");
      onSuccess?.();
    } catch (error) {
      toast.error("Failed to file dispute");
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!address) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>File Dispute</CardTitle>
          <CardDescription>Connect your wallet to file a dispute</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>File Dispute</CardTitle>
        <CardDescription>File a dispute against another party</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="contractId">Contract ID</Label>
            <Input
              id="contractId"
              type="number"
              {...register("contractId")}
              placeholder="1"
              disabled={!!contractId}
            />
            {errors.contractId && (
              <p className="text-sm text-red-500">{errors.contractId.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="respondent">Respondent Address</Label>
            <Input
              id="respondent"
              {...register("respondent")}
              placeholder="0x..."
            />
            {errors.respondent && (
              <p className="text-sm text-red-500">{errors.respondent.message}</p>
            )}
            <p className="text-xs text-muted-foreground">
              The address of the party you are filing the dispute against
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="courtId">Court ID</Label>
            <Input
              id="courtId"
              type="number"
              {...register("courtId")}
              placeholder="1"
            />
            {errors.courtId && (
              <p className="text-sm text-red-500">{errors.courtId.message}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Select the court that will hear this dispute
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="restitutionAmount">Restitution Amount (ETH)</Label>
            <Input
              id="restitutionAmount"
              type="number"
              step="0.001"
              {...register("restitutionAmount")}
              placeholder="0.5"
            />
            {errors.restitutionAmount && (
              <p className="text-sm text-red-500">{errors.restitutionAmount.message}</p>
            )}
            <p className="text-xs text-muted-foreground">
              The amount you are seeking in damages
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="claim">Your Claim</Label>
            <textarea
              id="claim"
              className="flex min-h-[150px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              {...register("claim")}
              placeholder="Describe your claim in detail. Include relevant dates, events, and evidence..."
            />
            {errors.claim && (
              <p className="text-sm text-red-500">{errors.claim.message}</p>
            )}
          </div>

          <div className="flex gap-4">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Filing..." : "File Dispute"}
            </Button>
            {onCancel && (
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
