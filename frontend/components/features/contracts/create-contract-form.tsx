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
import { Plus, Trash2 } from "lucide-react";

const createContractSchema = z.object({
  templateId: z.string().min(1, "Template ID is required"),
  escrowAmount: z.string().min(1, "Escrow amount is required"),
  terms: z.string().min(10, "Terms must be at least 10 characters"),
});

type CreateContractFormData = z.infer<typeof createContractSchema>;

interface CreateContractFormProps {
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function CreateContractForm({ onSuccess, onCancel }: CreateContractFormProps) {
  const { address } = useAccount();
  const [parties, setParties] = useState<string[]>([""]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateContractFormData>({
    resolver: zodResolver(createContractSchema),
    defaultValues: {
      templateId: "1",
      escrowAmount: "0.1",
      terms: "",
    },
  });

  const addParty = () => {
    if (parties.length < 10) {
      setParties([...parties, ""]);
    }
  };

  const removeParty = (index: number) => {
    if (parties.length > 1) {
      setParties(parties.filter((_, i) => i !== index));
    }
  };

  const updateParty = (index: number, value: string) => {
    const newParties = [...parties];
    newParties[index] = value;
    setParties(newParties);
  };

  const onSubmit = async (_data: CreateContractFormData) => {
    if (!address) {
      toast.error("Please connect your wallet");
      return;
    }

    const validParties = parties.filter((p) => p.length === 42 && p.startsWith("0x"));
    if (validParties.length === 0) {
      toast.error("Please add at least one valid party address");
      return;
    }

    setIsSubmitting(true);
    try {
      // TODO: In production, call the contract
      // const tx = await writeContract({
      //   address: ADDRESSES.contractManager,
      //   abi: contractManagerAbi,
      //   functionName: "createContract",
      //   args: [BigInt(_data.templateId), validParties, parseEther(_data.escrowAmount), _data.terms],
      // });

      toast.success("Contract created successfully!");
      onSuccess?.();
    } catch (error) {
      toast.error("Failed to create contract");
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!address) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Create Contract</CardTitle>
          <CardDescription>Connect your wallet to create a contract</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create Contract</CardTitle>
        <CardDescription>Create a new contract with other parties</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="templateId">Template ID</Label>
            <Input
              id="templateId"
              type="number"
              {...register("templateId")}
              placeholder="1"
            />
            {errors.templateId && (
              <p className="text-sm text-red-500">{errors.templateId.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Contract Parties</Label>
            <div className="space-y-2">
              {parties.map((party, index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    placeholder="0x..."
                    value={party}
                    onChange={(e) => updateParty(index, e.target.value)}
                  />
                  {parties.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeParty(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={addParty}>
              <Plus className="mr-2 h-4 w-4" />
              Add Party
            </Button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="escrowAmount">Escrow Amount (ETH)</Label>
            <Input
              id="escrowAmount"
              type="number"
              step="0.001"
              {...register("escrowAmount")}
              placeholder="0.1"
            />
            {errors.escrowAmount && (
              <p className="text-sm text-red-500">{errors.escrowAmount.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="terms">Contract Terms</Label>
            <textarea
              id="terms"
              className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              {...register("terms")}
              placeholder="Enter the contract terms and conditions..."
            />
            {errors.terms && (
              <p className="text-sm text-red-500">{errors.terms.message}</p>
            )}
          </div>

          <div className="flex gap-4">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Creating..." : "Create Contract"}
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
