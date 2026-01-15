"use client";
export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import Link from "next/link";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, RefreshCcw, Save } from "lucide-react";
import { toast } from "sonner";

interface PricingConfig {
  id: string;
  tier: string;
  frequency: string;
  price_cents: number;
}

export default function PricingSettingsPage() {
  const [pricing, setPricing] = useState<PricingConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editedPrices, setEditedPrices] = useState<Record<string, number>>({});
  const [isSaving, setIsSaving] = useState(false);

  const fetchPricing = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("pricing_config")
        .select("*")
        .order("tier")
        .order("frequency");

      if (error) throw error;
      setPricing(data || []);
      
      // Initialize edited prices
      const prices: Record<string, number> = {};
      data?.forEach((p) => {
        prices[p.id] = p.price_cents;
      });
      setEditedPrices(prices);
    } catch (error) {
      console.error("Error fetching pricing:", error);
      toast.error("Failed to load pricing");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPricing();
  }, []);

  const handlePriceChange = (id: string, value: string) => {
    const cents = Math.round(parseFloat(value) * 100) || 0;
    setEditedPrices((prev) => ({ ...prev, [id]: cents }));
  };

  const savePricing = async () => {
    setIsSaving(true);
    try {
      const updates = Object.entries(editedPrices).map(([id, price_cents]) =>
        supabase
          .from("pricing_config")
          .update({ price_cents, updated_at: new Date().toISOString() })
          .eq("id", id)
      );

      await Promise.all(updates);
      toast.success("Pricing updated successfully");
      fetchPricing();
    } catch (error) {
      console.error("Error saving pricing:", error);
      toast.error("Failed to save pricing");
    } finally {
      setIsSaving(false);
    }
  };

  const formatCurrency = (cents: number) => {
    return (cents / 100).toFixed(2);
  };

  // Group pricing by tier
  const tiers = [...new Set(pricing.map((p) => p.tier))];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/portal/settings">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Pricing Configuration</h1>
          <p className="text-muted-foreground">
            Manage service pricing by home size and frequency
          </p>
        </div>
        <Button variant="outline" onClick={fetchPricing}>
          <RefreshCcw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
        <Button onClick={savePricing} disabled={isSaving}>
          <Save className="mr-2 h-4 w-4" />
          {isSaving ? "Saving..." : "Save Changes"}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : (
        tiers.map((tier) => {
          const tierPricing = pricing.filter((p) => p.tier === tier);
          return (
            <Card key={tier}>
              <CardHeader>
                <CardTitle className="capitalize">{tier.replace("_", " ")}</CardTitle>
                <CardDescription>
                  Pricing for {tier.replace("_", " ")} home size
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Frequency</TableHead>
                      <TableHead>Current Price</TableHead>
                      <TableHead>New Price</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tierPricing.map((config) => (
                      <TableRow key={config.id}>
                        <TableCell className="capitalize font-medium">
                          {config.frequency}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          ${formatCurrency(config.price_cents)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span>$</span>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              value={formatCurrency(editedPrices[config.id] || 0)}
                              onChange={(e) => handlePriceChange(config.id, e.target.value)}
                              className="w-32"
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
