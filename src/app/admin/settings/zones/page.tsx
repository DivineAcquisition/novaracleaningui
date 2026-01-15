"use client";
export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback } from "react";
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
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Search, RefreshCcw, Plus } from "lucide-react";
import { toast } from "sonner";

interface ServiceZone {
  id: string;
  zip_code: string;
  city: string;
  state: string;
  county: string | null;
  tier: string;
  tier_label: string;
  is_active: boolean;
  pricing_multiplier: number | null;
}

export default function ServiceZonesPage() {
  const [zones, setZones] = useState<ServiceZone[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [tierFilter, setTierFilter] = useState("all");

  const fetchZones = useCallback(async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from("service_coverage_zones")
        .select("*");

      if (searchQuery) {
        query = query.or(
          `zip_code.ilike.%${searchQuery}%,city.ilike.%${searchQuery}%`
        );
      }

      if (tierFilter !== "all") {
        query = query.eq("tier", tierFilter);
      }

      const { data, error } = await query.order("city").limit(100);

      if (error) throw error;
      setZones(data || []);
    } catch (error) {
      console.error("Error fetching zones:", error);
      toast.error("Failed to load service zones");
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, tierFilter]);

  useEffect(() => {
    fetchZones();
  }, [fetchZones]);

  const toggleZoneActive = async (id: string, isActive: boolean) => {
    try {
      const { error } = await supabase
        .from("service_coverage_zones")
        .update({ is_active: !isActive, updated_at: new Date().toISOString() })
        .eq("id", id);

      if (error) throw error;

      toast.success(`Zone ${isActive ? "deactivated" : "activated"}`);
      fetchZones();
    } catch (error) {
      console.error("Error toggling zone:", error);
      toast.error("Failed to update zone");
    }
  };

  const activeZones = zones.filter((z) => z.is_active).length;
  const tiers = [...new Set(zones.map((z) => z.tier))];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/portal/settings">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Service Zones</h1>
          <p className="text-muted-foreground">
            Manage service coverage areas
          </p>
        </div>
        <Button variant="outline" onClick={fetchZones}>
          <RefreshCcw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Zones
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{zones.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active Zones
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{activeZones}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Inactive Zones
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-muted-foreground">
              {zones.length - activeZones}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by ZIP code or city..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={tierFilter} onValueChange={setTierFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Tier" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Tiers</SelectItem>
                {tiers.map((tier) => (
                  <SelectItem key={tier} value={tier}>
                    {tier}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Zones Table */}
      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(10)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : zones.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No service zones found
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ZIP Code</TableHead>
                  <TableHead>City</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Multiplier</TableHead>
                  <TableHead>Active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {zones.map((zone) => (
                  <TableRow key={zone.id}>
                    <TableCell className="font-mono">{zone.zip_code}</TableCell>
                    <TableCell>{zone.city}</TableCell>
                    <TableCell>{zone.state}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{zone.tier_label}</Badge>
                    </TableCell>
                    <TableCell>
                      {zone.pricing_multiplier
                        ? `${zone.pricing_multiplier}x`
                        : "1x"}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={zone.is_active}
                        onCheckedChange={() =>
                          toggleZoneActive(zone.id, zone.is_active)
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
