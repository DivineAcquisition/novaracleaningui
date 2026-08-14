"use client";

// Run Payroll — Stripe Connect payout of Extra Pay.
// Custom Payout Stripe transfers are paused (mark paid + notify instead).

import { useCallback, useEffect, useState } from "react";
import {
  RiLoader4Line, RiSendPlaneLine, RiRefreshLine, RiAlertLine, RiCheckboxCircleFill,
  RiBankCardLine,
} from "@remixicon/react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { usd } from "@/lib/payroll";
import { supabase } from "@/integrations/supabase/client";
import { type PayrollCleaner, cleanerName, syncStripeStatuses } from "./shared";

interface PendingItem {
  kind: "custom" | "extra";
  id: string;
  cleanerId: string;
  cleanerName: string;
  amountCents: number;
  bookingId: string | null;
  bookingLabel: string;
  serviceDate: string | null;
  note: string | null;
  extraLabel?: string;
}

interface CleanerRun {
  cleanerId: string;
  cleanerName: string;
  stripeAccountId: string | null;
  payoutsEnabled: boolean;
  connectReady: boolean;
  customCents: number;
  extraCents: number;
  totalCents: number;
  items: PendingItem[];
}

interface RunPreview {
  balance: { availableUsd: number; pendingUsd: number; error: string | null };
  totals: { customCents: number; extraCents: number; owedCents: number; cleaners: number };
  cleaners: CleanerRun[];
}

async function callApi<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not signed in");
  const res = await fetch("/api/payroll/custom", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const json = await res.json();
  if (!res.ok || json?.error) throw new Error(json?.error || `Request failed (${res.status})`);
  return json as T;
}

export default function RunPayrollTab({ cleaners }: { cleaners: PayrollCleaner[] }) {
  const [preview, setPreview] = useState<RunPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPreview(await callApi<RunPreview>("run_preview"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load payroll");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const runSync = async () => {
    setSyncing(true);
    try {
      const ids = cleaners.map((c) => c.id);
      const res = await syncStripeStatuses(ids.length ? ids : undefined);
      toast.success(`Stripe Connect synced · ${res.readyCount} ready`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Stripe sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const pay = async (cleanerId?: string, amountCents?: number, name?: string) => {
    const owed = amountCents ?? preview?.totals.owedCents ?? 0;
    const available = preview?.balance.availableUsd ?? 0;
    const who = name || "all pending contractors";
    if (owed <= 0) { toast.info("Nothing owed."); return; }
    if (available < owed) {
      toast.error(`Insufficient Stripe balance: ${usd(available)} available, ${usd(owed)} needed.`);
      return;
    }
    if (!confirm(
      `Send ${usd(owed)} to ${who} via Stripe Connect?\n\nPlatform available: ${usd(available)}\n\nA confirmation email goes to you, the contractor, and is CC'd to contact@ and dispatch@.`,
    )) return;
    setBusyId(cleanerId || "__all__");
    try {
      const res = await callApi<{
        ok: boolean; halted?: boolean; error?: string | null; paidCount: number; failedCount: number;
      }>("execute_pending", cleanerId ? { cleanerId } : {});
      if (res.halted || res.error) {
        toast.error(res.error || "Payout halted");
      } else {
        toast.success(`Paid ${res.paidCount} transfer(s)${res.failedCount ? ` · ${res.failedCount} failed` : ""}`);
      }
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Payout failed");
    } finally {
      setBusyId(null);
    }
  };

  const runs = preview?.cleaners || [];
  const totals = preview?.totals;
  const balance = preview?.balance;
  const available = balance?.availableUsd ?? 0;

  return (
    <div className="space-y-5">
      <Card className="border-violet-200 bg-gradient-to-br from-violet-50 to-white">
        <CardContent className="p-4 space-y-2 text-sm text-slate-700">
          <p className="font-semibold text-violet-900">Stripe Connect payroll</p>
          <p className="text-slate-600">
            This pays <strong>exactly</strong> what you recorded in Extra Pay.
            Custom Payout Stripe transfers are paused — confirm and mark those paid on the Custom Payout tab.
            Extra Pay transfers only fire when the platform Stripe balance covers the total.
          </p>
        </CardContent>
      </Card>

      <Card className="border-slate-200">
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 min-w-[180px]">
            <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Stripe available</p>
            {loading ? (
              <Skeleton className="h-6 w-24 mt-1" />
            ) : (
              <p className={cn("text-lg font-bold tabular-nums", available > 0 ? "text-emerald-700" : "text-rose-700")}>
                {usd(available)}
              </p>
            )}
            {balance?.error ? <p className="text-[10px] text-rose-600 mt-0.5">{balance.error}</p> : null}
          </div>
          {totals && totals.owedCents > 0 && (
            <Button
              onClick={() => void pay()}
              disabled={busyId !== null || available < totals.owedCents}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {busyId === "__all__" ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiSendPlaneLine className="w-4 h-4 mr-1.5" />}
              Pay all owed ({usd(totals.owedCents)})
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => void runSync()} disabled={syncing || busyId !== null}>
            <RiBankCardLine className={cn("w-4 h-4 mr-1.5", syncing && "animate-spin")} />
            Refresh Connect
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading} className="ml-auto">
            <RiRefreshLine className={cn("w-4 h-4", loading && "animate-spin")} />
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Cleaners owed" value={String(totals?.cleaners ?? 0)} />
        <Tile label="Custom Payout" value={usd(totals?.customCents ?? 0)} />
        <Tile label="Extra Pay" value={usd(totals?.extraCents ?? 0)} />
        <Tile label="Owed" value={usd(totals?.owedCents ?? 0)} highlight />
      </div>

      {loading ? (
        <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>
      ) : runs.length === 0 ? (
        <Card className="border-slate-200">
          <CardContent className="py-10 text-center text-sm text-slate-500">
            Nothing pending Extra Pay. Custom Payout is confirm + notify, then Mark paid — Stripe for those is paused.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {runs.map((r) => (
            <Card key={r.cleanerId} className="border-slate-200">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">{r.cleanerName || cleanerName(cleaners.find((c) => c.id === r.cleanerId))}</CardTitle>
                  {r.connectReady ? (
                    <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">
                      <RiCheckboxCircleFill className="w-3 h-3 mr-1" /> Connect ready
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] bg-rose-50 text-rose-700 border-rose-200">
                      <RiAlertLine className="w-3 h-3 mr-1" /> No Stripe Connect
                    </Badge>
                  )}
                </div>
                <CardDescription className="text-xs">
                  {r.items.length} line{r.items.length === 1 ? "" : "s"} · Custom {usd(r.customCents)} · Extra {usd(r.extraCents)}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <ul className="text-xs text-slate-600 space-y-1">
                  {r.items.map((item) => (
                    <li key={`${item.kind}-${item.id}-${item.cleanerId}`} className="flex items-center justify-between gap-2">
                      <span className="truncate">
                        <Badge variant="outline" className="text-[9px] mr-1.5 capitalize">{item.kind === "extra" ? "extra" : "custom"}</Badge>
                        {item.bookingLabel}
                        {item.extraLabel ? ` · ${item.extraLabel}` : ""}
                        {item.note ? ` — ${item.note}` : ""}
                      </span>
                      <span className="tabular-nums font-semibold shrink-0">{usd(item.amountCents)}</span>
                    </li>
                  ))}
                </ul>
                <div className="grid grid-cols-3 gap-3">
                  <Mini label="Custom" value={usd(r.customCents)} tone="slate" />
                  <Mini label="Extra" value={usd(r.extraCents)} tone="slate" />
                  <Mini label="Total" value={usd(r.totalCents)} tone="amber" />
                </div>
                <Button
                  size="sm"
                  disabled={busyId !== null || r.totalCents <= 0 || !r.connectReady || available < r.totalCents}
                  onClick={() => void pay(r.cleanerId, r.totalCents, r.cleanerName)}
                  className="bg-violet-600 hover:bg-violet-700 text-white"
                >
                  {busyId === r.cleanerId ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiSendPlaneLine className="w-4 h-4 mr-1.5" />}
                  Pay {usd(r.totalCents)}
                </Button>
                {!r.connectReady ? (
                  <p className="text-[11px] text-rose-600">Contractor must finish Stripe Connect onboarding before we can transfer.</p>
                ) : available < r.totalCents ? (
                  <p className="text-[11px] text-amber-700">Not enough platform Stripe balance for this cleaner yet.</p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="text-[11px] text-slate-400">
        Each transfer is an exact-amount Stripe Connect payment with an idempotency key.
        Confirmation emails go to you and the contractor, CC contact@novaracleaning.com and dispatch@novaracleaning.com.
      </p>
    </div>
  );
}

function Tile({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <Card className={cn("border", highlight ? "border-violet-200 bg-violet-50" : "border-slate-200")}>
      <CardContent className="p-4">
        <p className={cn("text-[11px] uppercase tracking-wider font-semibold", highlight ? "text-violet-700/80" : "text-slate-500")}>{label}</p>
        <p className={cn("text-lg font-bold mt-0.5", highlight ? "text-violet-700" : "text-slate-800")}>{value}</p>
      </CardContent>
    </Card>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone: "amber" | "emerald" | "slate" }) {
  const t = { amber: "text-amber-700", emerald: "text-violet-700", slate: "text-slate-700" }[tone];
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">{label}</p>
      <p className={cn("text-sm font-bold", t)}>{value}</p>
    </div>
  );
}
