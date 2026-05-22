"use client";

// ─── /admin/sales-tracker ──────────────────────────────────────────────
//
// Per-VA sales tracker powered by the va_sales_v1 view. One row per VA.
// Each row shows leads handled, bookings closed, revenue generated, and
// a conversion rate, with on-shift / active status from va_assignments.

import { useEffect, useMemo, useState } from "react";
import {
  RiArrowRightLine,
  RiCheckLine,
  RiFireLine,
  RiLineChartLine,
  RiLoader4Line,
  RiMoneyDollarCircleLine,
  RiPhoneLine,
  RiRefreshLine,
  RiSearchLine,
  RiTeamLine,
  RiTrophyLine,
  RiUserStarLine,
} from "@remixicon/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface VaRow {
  va_name: string;
  va_user_id: string | null;
  is_active: boolean | null;
  on_shift: boolean | null;
  total_bookings: number;
  bookings_confirmed: number;
  bookings_completed: number;
  bookings_cancelled: number;
  revenue_cents_gross: number;
  revenue_cents_completed: number;
  deposits_collected_cents: number;
  leads_assigned: number;
  leads_hot: number;
  leads_converted: number;
  leads_lost: number;
  conversion_rate_pct: number | null;
  last_booking_at: string | null;
  last_lead_assigned_at: string | null;
}

const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

const formatDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
};

export default function AdminSalesTracker() {
  const [rows, setRows] = useState<VaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("va_sales_v1" as never)
        .select("*")
        .order("revenue_cents_gross", { ascending: false })
        .order("bookings_confirmed", { ascending: false });
      if (error) throw error;
      setRows((data || []) as unknown as VaRow[]);
    } catch (err) {
      console.error("[SalesTracker] load error", err);
      toast.error("Couldn't load VA sales data", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const needle = search.trim().toLowerCase();
    return rows.filter((r) => r.va_name.toLowerCase().includes(needle));
  }, [rows, search]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => ({
        leadsAssigned: acc.leadsAssigned + (r.leads_assigned || 0),
        leadsConverted: acc.leadsConverted + (r.leads_converted || 0),
        bookingsConfirmed: acc.bookingsConfirmed + (r.bookings_confirmed || 0),
        revenue: acc.revenue + (r.revenue_cents_gross || 0),
      }),
      { leadsAssigned: 0, leadsConverted: 0, bookingsConfirmed: 0, revenue: 0 },
    );
  }, [rows]);

  const teamConversion =
    totals.leadsAssigned > 0
      ? ((totals.bookingsConfirmed / totals.leadsAssigned) * 100).toFixed(1)
      : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Sales tracker</h1>
          <p className="text-sm text-slate-500 mt-1">
            Per-VA performance. Leads handled (via lead-intake round-robin),
            bookings closed (via CSR form / book-as-va), and revenue.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RiRefreshLine
            className={cn("w-4 h-4 mr-1.5", loading && "animate-spin")}
          />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile
          label="Active VAs"
          value={`${rows.filter((r) => r.is_active).length} / ${rows.length}`}
          tone="emerald"
          icon={RiTeamLine}
          hint={`${rows.filter((r) => r.on_shift).length} currently on shift`}
        />
        <KpiTile
          label="Leads → bookings"
          value={
            teamConversion ? `${teamConversion}%` : "—"
          }
          tone="sky"
          icon={RiLineChartLine}
          hint={`${totals.bookingsConfirmed.toLocaleString()} confirmed / ${totals.leadsAssigned.toLocaleString()} leads`}
        />
        <KpiTile
          label="Revenue (gross)"
          value={usd(totals.revenue)}
          tone="amber"
          icon={RiMoneyDollarCircleLine}
          hint="Across all confirmed + completed bookings"
        />
        <KpiTile
          label="Closed bookings"
          value={totals.bookingsConfirmed.toLocaleString()}
          tone="violet"
          icon={RiTrophyLine}
          hint={`${totals.leadsConverted.toLocaleString()} converted leads`}
        />
      </div>

      <Card className="border-slate-200">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">
                Sales agents ({rows.length})
              </CardTitle>
              <CardDescription className="text-xs">
                Sorted by gross revenue generated, highest first.
              </CardDescription>
            </div>
            <div className="relative w-56">
              <RiSearchLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search VAs…"
                className="pl-10 h-9 bg-white border-slate-200"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              No VA activity recorded yet. Once VAs handle leads via
              lead-intake or submit bookings via the CSR form, they'll
              appear here automatically.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[24%]">VA</TableHead>
                    <TableHead className="text-right">Leads</TableHead>
                    <TableHead className="text-right">Hot</TableHead>
                    <TableHead className="text-right">Bookings</TableHead>
                    <TableHead className="text-right">Conv %</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Last activity</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => {
                    const lastActivity = mostRecent(
                      r.last_booking_at,
                      r.last_lead_assigned_at,
                    );
                    return (
                      <TableRow key={r.va_name} className="hover:bg-slate-50/60">
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <span className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-100 to-emerald-200 text-emerald-700 flex items-center justify-center text-xs font-bold">
                              {(r.va_name || "?")
                                .split(" ")
                                .filter(Boolean)
                                .slice(0, 2)
                                .map((s) => s[0]?.toUpperCase())
                                .join("")}
                            </span>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-slate-900 truncate">
                                {r.va_name}
                              </p>
                              <p className="text-[11px] text-slate-500">
                                {r.bookings_completed} completed ·{" "}
                                {r.bookings_cancelled} cancelled
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {r.leads_assigned.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {r.leads_hot > 0 ? (
                            <Badge
                              variant="outline"
                              className="bg-rose-50 text-rose-700 border-rose-200"
                            >
                              <RiFireLine className="w-3 h-3 mr-1" />
                              {r.leads_hot}
                            </Badge>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium">
                          {r.bookings_confirmed.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {r.conversion_rate_pct != null ? (
                            <span
                              className={cn(
                                "font-semibold",
                                r.conversion_rate_pct >= 25
                                  ? "text-emerald-700"
                                  : r.conversion_rate_pct >= 10
                                    ? "text-amber-700"
                                    : "text-slate-600",
                              )}
                            >
                              {r.conversion_rate_pct}%
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-sm font-semibold text-slate-900">
                          {usd(r.revenue_cents_gross)}
                        </TableCell>
                        <TableCell className="text-right text-xs text-slate-500">
                          {formatDate(lastActivity)}
                        </TableCell>
                        <TableCell className="text-center">
                          <VaBadge
                            isActive={r.is_active}
                            onShift={r.on_shift}
                            registered={!!r.va_user_id}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-[11px] text-slate-400">
        VA attribution uses{" "}
        <code className="mx-1 px-1 py-0.5 rounded bg-slate-100 text-[10px]">
          bookings.sdr_rep_name
        </code>{" "}
        (CSR form / VA bookings) +{" "}
        <code className="mx-1 px-1 py-0.5 rounded bg-slate-100 text-[10px]">
          leads.assigned_va_user_id
        </code>{" "}
        (lead-intake round-robin). Add or rotate VAs in the
        <code className="mx-1 px-1 py-0.5 rounded bg-slate-100 text-[10px]">
          va_assignments
        </code>{" "}
        table.
      </p>
    </div>
  );
}

function mostRecent(...isos: (string | null | undefined)[]): string | null {
  const valid = isos.filter(Boolean).map((s) => new Date(s as string).getTime());
  if (!valid.length) return null;
  return new Date(Math.max(...valid)).toISOString();
}

function KpiTile({
  label,
  value,
  tone,
  icon: Icon,
  hint,
}: {
  label: string;
  value: string;
  tone: "amber" | "emerald" | "sky" | "violet";
  icon: typeof RiTeamLine;
  hint?: string;
}) {
  const tones: Record<string, { bg: string; text: string; icon: string }> = {
    amber: {
      bg: "border-amber-200 bg-amber-50",
      text: "text-amber-900",
      icon: "bg-amber-100 text-amber-700",
    },
    emerald: {
      bg: "border-emerald-200 bg-emerald-50",
      text: "text-emerald-900",
      icon: "bg-emerald-100 text-emerald-700",
    },
    sky: {
      bg: "border-sky-200 bg-sky-50",
      text: "text-sky-900",
      icon: "bg-sky-100 text-sky-700",
    },
    violet: {
      bg: "border-violet-200 bg-violet-50",
      text: "text-violet-900",
      icon: "bg-violet-100 text-violet-700",
    },
  };
  const t = tones[tone];
  return (
    <Card className={cn("border", t.bg)}>
      <CardContent className="p-4 flex items-start gap-3">
        <span
          className={cn(
            "w-9 h-9 rounded-lg flex items-center justify-center",
            t.icon,
          )}
        >
          <Icon className="w-4 h-4" />
        </span>
        <div className="flex-1 min-w-0">
          <p
            className={cn(
              "text-[11px] font-semibold uppercase tracking-wider opacity-80",
              t.text,
            )}
          >
            {label}
          </p>
          <p className={cn("text-lg font-bold mt-0.5", t.text)}>{value}</p>
          {hint && (
            <p className={cn("text-[10px] mt-1 opacity-70", t.text)}>{hint}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function VaBadge({
  isActive,
  onShift,
  registered,
}: {
  isActive: boolean | null;
  onShift: boolean | null;
  registered: boolean;
}) {
  if (!registered) {
    return (
      <Badge
        variant="outline"
        className="bg-slate-100 text-slate-600 border-slate-200"
      >
        Anonymous
      </Badge>
    );
  }
  if (!isActive) {
    return (
      <Badge
        variant="outline"
        className="bg-rose-50 text-rose-700 border-rose-200"
      >
        Inactive
      </Badge>
    );
  }
  if (onShift) {
    return (
      <Badge
        variant="outline"
        className="bg-emerald-50 text-emerald-800 border-emerald-200"
      >
        <RiCheckLine className="w-3 h-3 mr-1" />
        On shift
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="bg-sky-50 text-sky-800 border-sky-200"
    >
      Off shift
    </Badge>
  );
}
