"use client";
export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, RefreshCcw, Plus, Tag } from "lucide-react";
import { toast } from "sonner";

interface PromoCode {
  id: string;
  code: string;
  type: "amount" | "percent";
  value: number;
  active: boolean;
  expires_at: string | null;
  max_total_uses: number | null;
  max_uses_per_customer: number | null;
  total_uses: number | null;
  applies_to: string | null;
  created_at: string;
}

export default function PromoCodesPage() {
  const [promos, setPromos] = useState<PromoCode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  
  // New promo form state
  const [newCode, setNewCode] = useState("");
  const [newType, setNewType] = useState<"amount" | "percent">("percent");
  const [newValue, setNewValue] = useState("");
  const [newMaxUses, setNewMaxUses] = useState("");

  const fetchPromos = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("promo_codes")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setPromos(data || []);
    } catch (error) {
      console.error("Error fetching promos:", error);
      toast.error("Failed to load promo codes");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPromos();
  }, []);

  const createPromo = async () => {
    if (!newCode || !newValue) {
      toast.error("Please fill in all required fields");
      return;
    }

    setIsCreating(true);
    try {
      const { error } = await supabase.from("promo_codes").insert({
        code: newCode.toUpperCase(),
        type: newType,
        value: parseFloat(newValue),
        max_total_uses: newMaxUses ? parseInt(newMaxUses) : null,
        active: true,
      });

      if (error) throw error;

      toast.success("Promo code created");
      setDialogOpen(false);
      setNewCode("");
      setNewValue("");
      setNewMaxUses("");
      fetchPromos();
    } catch (error) {
      console.error("Error creating promo:", error);
      toast.error("Failed to create promo code");
    } finally {
      setIsCreating(false);
    }
  };

  const togglePromoActive = async (id: string, active: boolean) => {
    try {
      const { error } = await supabase
        .from("promo_codes")
        .update({ active: !active })
        .eq("id", id);

      if (error) throw error;

      toast.success(`Promo ${active ? "deactivated" : "activated"}`);
      fetchPromos();
    } catch (error) {
      console.error("Error toggling promo:", error);
      toast.error("Failed to update promo");
    }
  };

  const formatValue = (type: string, value: number) => {
    if (type === "percent") {
      return `${value}% off`;
    }
    return `$${(value / 100).toFixed(2)} off`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/portal/settings">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Promo Codes</h1>
          <p className="text-muted-foreground">
            Create and manage promotional discount codes
          </p>
        </div>
        <Button variant="outline" onClick={fetchPromos}>
          <RefreshCcw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Create Promo
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Promo Code</DialogTitle>
              <DialogDescription>
                Create a new promotional discount code
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Code</Label>
                <Input
                  placeholder="SAVE20"
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select value={newType} onValueChange={(v: "amount" | "percent") => setNewType(v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percent">Percentage</SelectItem>
                      <SelectItem value="amount">Fixed Amount</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{newType === "percent" ? "Percentage" : "Amount (cents)"}</Label>
                  <Input
                    type="number"
                    placeholder={newType === "percent" ? "20" : "1000"}
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Max Total Uses (optional)</Label>
                <Input
                  type="number"
                  placeholder="100"
                  value={newMaxUses}
                  onChange={(e) => setNewMaxUses(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={createPromo} disabled={isCreating}>
                {isCreating ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Promos Table */}
      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : promos.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No promo codes yet. Create your first one!
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Discount</TableHead>
                  <TableHead>Uses</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {promos.map((promo) => (
                  <TableRow key={promo.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Tag className="h-4 w-4 text-muted-foreground" />
                        <code className="font-mono font-medium">{promo.code}</code>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {formatValue(promo.type, promo.value)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {promo.total_uses || 0}
                      {promo.max_total_uses && ` / ${promo.max_total_uses}`}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {promo.expires_at
                        ? format(parseISO(promo.expires_at), "MMM d, yyyy")
                        : "Never"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {format(parseISO(promo.created_at), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={promo.active}
                        onCheckedChange={() =>
                          togglePromoActive(promo.id, promo.active)
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
