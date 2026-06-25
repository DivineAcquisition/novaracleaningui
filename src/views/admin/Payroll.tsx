"use client";

// ─── /admin/payroll ────────────────────────────────────────────────────
//
// Per-cleaner payroll snapshot powered by the cleaner_payroll_v1 view.
// One row per cleaner. Each row exposes:
//   * jobs completed (and in-progress)
//   * dollars paid / processing / owed / failed (with the relevant
//     payouts ledger entries reachable on click)
//   * Stripe Connect status (badge: green = payouts_enabled, amber =
//     account exists but no payouts, gray = no account)
//   * "Pay now" button — releases the owed balance for that cleaner via
//     process-payout for every unpaid completed booking
//
// The trigger bookings_auto_payout_on_completion fires process-payout
// automatically on every booking → completed transition, so this page
// is normally just a status read-out. The "Pay now" button is the
// manual retry / safety net for cleaners whose first payout failed.

import { useEffect, useMemo, useState } from "react";
import {
  RiBankCardLine,
  RiCheckboxCircleFill,
  RiCloseCircleLine,
  RiErrorWarningLine,
  RiLoader4Line,
  RiMoneyDollarCircleLine,
  RiRefreshLine,
  RiSearchLine,
  RiTimeLine,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import JobsTab from "@/components/admin/payroll/JobsTab";
import RunPayrollTab from "@/components/admin/payroll/RunPayrollTab";
import AutoPayrollTab from "@/components/admin/payroll/AutoPayrollTab";
import RunsTab from "@/components/admin/payroll/RunsTab";
import CleanerDetailTab from "@/components/admin/payroll/CleanerDetailTab";
import { loadActiveCleaners, type PayrollCleaner } from "@/components/admin/payroll/shared";

interface PayrollRow {
  cleaner_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  cleaner_status: string | null;
  pay_tier: string | null;
  pay_percentage: number | null;
  stripe_account_id: string | null;
  payouts_enabled: boolean | null;
  average_rating: number | null;
  completed_bookings: number | null;
  jobs_completed: number;
  jobs_in_progress: number;
  paid_cents: number;
  processing_cents: number;
  owed_cents: number;
  failed_cents: number;
  last_paid_at: string | null;
  oldest_unpaid_completed_at: string | null;
}

const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
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

// ─── Tabbed Payroll shell ──────────────────────────────────────────────
// The manual payroll module (Jobs / Run Payroll / Runs / Cleaner Detail)
// lives entirely here, alongside the original Stripe-Connect overview.
export default function AdminPayroll() {
  const [cleaners, setCleaners] = useState<PayrollCleaner[]>([]);

  useEffect(() => {
    loadActiveCleaners()
      .then(setCleaners)
      .catch((err) => toast.error(err instanceof Error ? err.message : "Failed to load cleaners"));
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-jakarta text-2xl font-bold text-slate-900 tracking-tight">Payroll</h1>
        <p className="text-sm text-slate-500 mt-1">
          Enter completed jobs, build weekly runs, and pay 1099 cleaners via Stripe Connect.
        </p>
      </div>
      <Tabs defaultValue="jobs" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="jobs">Jobs</TabsTrigger>
          <TabsTrigger value="auto">Auto Payroll</TabsTrigger>
          <TabsTrigger value="run">Run Payroll</TabsTrigger>
          <TabsTrigger value="runs">Payroll Runs</TabsTrigger>
          <TabsTrigger value="cleaner">Cleaner Detail</TabsTrigger>
          <TabsTrigger value="overview">Connect Overview</TabsTrigger>
        </TabsList>
        <TabsContent value="jobs"><JobsTab cleaners={cleaners} /></TabsContent>
        <TabsContent value="auto"><AutoPayrollTab cleaners={cleaners} /></TabsContent>
        <TabsContent value="run"><RunPayrollTab cleaners={cleaners} /></TabsContent>
        <TabsContent value="runs"><RunsTab cleaners={cleaners} /></TabsContent>
        <TabsContent value="cleaner"><CleanerDetailTab cleaners={cleaners} /></TabsContent>
        <TabsContent value="overview"><PayrollOverview /></TabsContent>
      </Tabs>
    </div>
  );
}

function PayrollOverview() {
  const [rows, setRows] = useState<PayrollRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [payingId, setPayingId] = useState<string | null>(null);
  const [stripeLoginId, setStripeLoginId] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("cleaner_payroll_v1" as never)
        .select("*")
        .order("owed_cents", { ascending: false })
        .order("paid_cents", { ascending: false });
      if (error) throw error;
      setRows((data || []) as unknown as PayrollRow[]);
    } catch (err) {
      console.error("[Payroll] load error", err);
      toast.error("Couldn't load payroll", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const needle = search.trim().toLowerCase();
    return rows.filter((r) =>
      [r.first_name, r.last_name, r.email, r.phone]
        .filter(Boolean)
        .map((v) => String(v).toLowerCase())
        .some((v) => v.includes(needle)),
    );
  }, [rows, search]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => ({
        owed: acc.owed + (r.owed_cents || 0),
        processing: acc.processing + (r.processing_cents || 0),
        paid: acc.paid + (r.paid_cents || 0),
        failed: acc.failed + (r.failed_cents || 0),
      }),
      { owed: 0, processing: 0, paid: 0, failed: 0 },
    );
  }, [rows]);

  const openStripeExpress = async (row: PayrollRow) => {
    if (!row.stripe_account_id) {
      toast.error("Cleaner has not started Stripe Connect onboarding");
      return;
    }
    setStripeLoginId(row.cleaner_id);
    try {
      const { data, error } = await supabase.functions.invoke("create-stripe-login-link", {
        body: { stripe_account_id: row.stripe_account_id },
      });
      if (error) throw error;
      const url = (data as { url?: string })?.url;
      if (!url) throw new Error("No Stripe URL returned");
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open Stripe dashboard");
    } finally {
      setStripeLoginId(null);
    }
  };

  const handlePayNow = async (row: PayrollRow) => {
    if (!row.stripe_account_id) {
      toast.error("Cleaner has no Stripe Connect account");
      return;
    }
    if (!row.payouts_enabled) {
      toast.error("Payouts not enabled on this Stripe account");
      return;
    }
    if (!row.owed_cents) {
      toast.info("Nothing owed — already paid out");
      return;
    }
    if (
      !confirm(
        `Release ${usd(row.owed_cents)} to ${row.first_name || ""} ${row.last_name || ""}?\n\nThis covers ${row.jobs_completed} completed job(s) and will create a Stripe Transfer to their Connect account.`,
      )
    ) {
      return;
    }
    setPayingId(row.cleaner_id);
    try {
      // Fetch all of this cleaner's completed bookings that don't already
      // have a successful or in-flight payout.
      const { data: bookings, error } = await supabase
        .from("bookings")
        .select("id, payout_status, completed_at, cleaner_payout_cents")
        .eq("cleaner_id", row.cleaner_id)
        .eq("status", "completed")
        .neq("payout_status", "completed")
        .neq("payout_status", "processing")
        .order("completed_at", { ascending: true });
      if (error) throw error;

      if (!bookings || bookings.length === 0) {
        toast.info("No outstanding completed bookings");
        return;
      }

      let okCount = 0;
      let failCount = 0;
      let totalCents = 0;
      for (const b of bookings) {
        const { data, error: invokeErr } = await supabase.functions.invoke(
          "process-payout",
          { body: { bookingId: b.id, source: "admin_payroll_pay_now" } },
        );
        if (invokeErr || (data && (data as any).error)) {
          failCount++;
        } else if ((data as any).success) {
          okCount++;
          totalCents += (data as any).amount_cents || 0;
        } else if ((data as any).skipped) {
          // already paid in another tab — count as ok
          okCount++;
        }
      }

      toast.success(
        `Payouts dispatched · ${okCount}/${bookings.length} succeeded ($${(totalCents / 100).toFixed(2)})${failCount ? ` · ${failCount} failed` : ""}`,
      );
      await load();
    } catch (err) {
      console.error("[Payroll] pay-now error", err);
      toast.error("Pay now failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setPayingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="font-jakarta text-2xl font-bold text-slate-900 tracking-tight">Payroll</h1>
          <p className="text-sm text-slate-500 mt-1">
            Pay cleaners through Stripe Connect. Each cleaner needs an Express account with
            payouts enabled before &quot;Pay now&quot; can transfer their share.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RiRefreshLine className={cn("w-4 h-4 mr-1.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <Card className="border-violet-200 bg-gradient-to-br from-violet-50 to-white">
        <CardContent className="p-4 space-y-2 text-sm text-slate-700">
          <p className="font-semibold text-violet-900">How cleaner payouts work (Stripe Connect)</p>
          <ol className="list-decimal list-inside space-y-1 text-slate-600">
            <li>
              Cleaners onboard at{" "}
              <a
                className="text-violet-700 underline"
                href="https://contractor.novaracleaning.com/cleaner/onboarding"
                target="_blank"
                rel="noreferrer"
              >
                contractor onboarding
              </a>{" "}
              — this creates their Connect Express account.
            </li>
            <li>
              When a booking is marked complete,{" "}
              <code className="text-[11px] px-1 py-0.5 rounded bg-slate-100">process-payout</code>{" "}
              transfers their revenue share to that account.
            </li>
            <li>
              Use <strong>Pay now</strong> below to retry failed transfers or release owed balances in bulk.
            </li>
            <li>
              Open a cleaner&apos;s Stripe Express dashboard from the row badge when connected (admin view).
            </li>
          </ol>
          <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
            Multi-cleaner jobs: payroll currently pays the <strong>lead cleaner</strong> on the booking row.
            Support teammates on the same job may need a manual adjustment until split payouts ship.
          </p>
        </CardContent>
      </Card>

      {/* Totals tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile
          label="Owed (unpaid)"
          value={usd(totals.owed)}
          tone="amber"
          icon={RiMoneyDollarCircleLine}
          hint="Completed jobs without a successful Stripe transfer"
        />
        <KpiTile
          label="In progress"
          value={usd(totals.processing)}
          tone="sky"
          icon={RiTimeLine}
          hint="Stripe transfer created, not yet settled"
        />
        <KpiTile
          label="Paid (all-time)"
          value={usd(totals.paid)}
          tone="emerald"
          icon={RiCheckboxCircleFill}
          hint="Total Stripe transfers completed"
        />
        <KpiTile
          label="Failed"
          value={usd(totals.failed)}
          tone="rose"
          icon={RiErrorWarningLine}
          hint="Last transfer attempt failed — click Pay now to retry"
        />
      </div>

      <Card className="border-slate-200">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Cleaners ({rows.length})</CardTitle>
              <CardDescription className="text-xs">
                Sorted by largest unpaid balance first.
              </CardDescription>
            </div>
            <div className="relative w-64">
              <RiSearchLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search cleaners…"
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
              <Skeleton className="h-12 w-full" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              No cleaners match this filter.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[28%]">Cleaner</TableHead>
                    <TableHead className="text-right">Jobs</TableHead>
                    <TableHead className="text-right">Owed</TableHead>
                    <TableHead className="text-right">Processing</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Last paid</TableHead>
                    <TableHead className="text-center">Stripe</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow key={r.cleaner_id} className="hover:bg-slate-50/60">
                      <TableCell>
                        <div className="space-y-0.5">
                          <p className="font-medium text-slate-900 text-sm">
                            {(r.first_name || "").trim()} {(r.last_name || "").trim()}
                          </p>
                          <p className="text-[11px] text-slate-500 truncate max-w-[220px]">
                            {r.email}
                            {r.pay_tier ? ` · ${r.pay_tier}` : ""}
                            {r.pay_percentage ? ` · ${r.pay_percentage}% revenue share` : ""}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        <span className="font-semibold">{r.jobs_completed}</span>
                        {r.jobs_in_progress ? (
                          <span className="text-[11px] text-slate-500 ml-1">
                            (+{r.jobs_in_progress} live)
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={cn(
                            "text-sm font-semibold",
                            r.owed_cents > 0 ? "text-amber-700" : "text-slate-400",
                          )}
                        >
                          {usd(r.owed_cents)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-sm text-slate-600">
                        {r.processing_cents > 0 ? usd(r.processing_cents) : "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm text-violet-700 font-medium">
                        {usd(r.paid_cents)}
                      </TableCell>
                      <TableCell className="text-right text-xs text-slate-500">
                        {formatDate(r.last_paid_at)}
                      </TableCell>
                      <TableCell className="text-center">
                        <button
                          type="button"
                          disabled={!r.stripe_account_id || stripeLoginId === r.cleaner_id}
                          onClick={() => void openStripeExpress(r)}
                          className="inline-flex disabled:opacity-60"
                          title={r.stripe_account_id ? "Open Stripe Express dashboard" : undefined}
                        >
                          <StripeBadge
                            accountId={r.stripe_account_id}
                            payoutsEnabled={r.payouts_enabled}
                          />
                        </button>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1 items-end">
                          <Button
                            size="sm"
                            variant={r.owed_cents > 0 ? "default" : "outline"}
                            disabled={
                              payingId === r.cleaner_id ||
                              r.owed_cents <= 0 ||
                              !r.stripe_account_id ||
                              !r.payouts_enabled
                            }
                            onClick={() => handlePayNow(r)}
                            className={cn(
                              "h-8 text-xs whitespace-nowrap",
                              r.owed_cents > 0 &&
                                "bg-gradient-to-br from-violet-500 to-violet-700 text-white",
                            )}
                          >
                            {payingId === r.cleaner_id ? (
                              <>
                                <RiLoader4Line className="w-3.5 h-3.5 mr-1 animate-spin" />
                                Paying…
                              </>
                            ) : (
                              <>
                                <RiBankCardLine className="w-3.5 h-3.5 mr-1" />
                                Pay now
                              </>
                            )}
                          </Button>
                          {!r.stripe_account_id ? (
                            <span className="text-[10px] text-slate-400">Needs Connect</span>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-[11px] text-slate-400">
        Payouts auto-fire on booking completion via the
        <code className="mx-1 px-1 py-0.5 rounded bg-slate-100 text-[10px]">bookings_auto_payout_on_completion</code>
        trigger → <code className="mx-1 px-1 py-0.5 rounded bg-slate-100 text-[10px]">process-payout</code>
        edge function. "Pay now" is the manual retry / safety net.
      </p>
    </div>
  );
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
  tone: "amber" | "emerald" | "sky" | "rose";
  icon: typeof RiMoneyDollarCircleLine;
  hint?: string;
}) {
  const tones: Record<string, { bg: string; text: string; icon: string }> = {
    amber: {
      bg: "border-amber-200 bg-amber-50",
      text: "text-amber-900",
      icon: "bg-amber-100 text-amber-700",
    },
    emerald: {
      bg: "border-violet-200 bg-violet-50",
      text: "text-violet-900",
      icon: "bg-violet-100 text-violet-700",
    },
    sky: {
      bg: "border-sky-200 bg-sky-50",
      text: "text-sky-900",
      icon: "bg-sky-100 text-sky-700",
    },
    rose: {
      bg: "border-rose-200 bg-rose-50",
      text: "text-rose-900",
      icon: "bg-rose-100 text-rose-700",
    },
  };
  const t = tones[tone];
  return (
    <Card className={cn("border", t.bg)}>
      <CardContent className="p-4 flex items-start gap-3">
        <span className={cn("w-9 h-9 rounded-lg flex items-center justify-center", t.icon)}>
          <Icon className="w-4 h-4" />
        </span>
        <div className="flex-1 min-w-0">
          <p className={cn("text-[11px] font-semibold uppercase tracking-wider opacity-80", t.text)}>
            {label}
          </p>
          <p className={cn("text-lg font-bold mt-0.5", t.text)}>{value}</p>
          {hint && <p className={cn("text-[10px] mt-1 opacity-70", t.text)}>{hint}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function StripeBadge({
  accountId,
  payoutsEnabled,
}: {
  accountId: string | null;
  payoutsEnabled: boolean | null;
}) {
  if (!accountId) {
    return (
      <Badge variant="outline" className="bg-slate-100 text-slate-600 border-slate-200">
        <RiCloseCircleLine className="w-3 h-3 mr-1" />
        Not connected
      </Badge>
    );
  }
  if (!payoutsEnabled) {
    return (
      <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200">
        <RiTimeLine className="w-3 h-3 mr-1" />
        Pending
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="bg-violet-50 text-violet-800 border-violet-200">
      <RiCheckboxCircleFill className="w-3 h-3 mr-1" />
      Connected
    </Badge>
  );
}
