"use client";

// ─── Crew-size pay rates (admin configuration) ───────────────────────────────
//
// The rate a cleaner earns depends on their tier AND how many cleaners performed
// the job. Two cleaners don't halve a job's time — roughly 60% of solo time each
// — so a flat rate quietly pays crew members 15–17% less per hour than a solo
// cleaner for the same work. The crew column exists to close that gap.
//
// Editing a rate here changes FUTURE calculations everywhere immediately, because
// the pay engine reads this table at calculation time. Pay already locked onto a
// completed job is untouched.
//
// Brackets are data, not code: splitting "2+" into "2" and "3+" is an insert
// here, with no deploy.

import { RiAddLine, RiDeleteBin6Line, RiInformationLine, RiLoader4Line } from "@remixicon/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface Rate {
  id: string;
  min_crew_size: number;
  max_crew_size: number | null;
  pay_tier: string;
  rate_percent: number;
  note: string | null;
}

function bracketLabel(min: number, max: number | null): string {
  if (max === null) return min === 1 ? "1 or more" : `${min}+`;
  if (min === max) return min === 1 ? "Solo (1)" : `${min}`;
  return `${min}–${max}`;
}

const tierName = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

async function authedFetch(path: string, init?: RequestInit) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not signed in");
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      ...(init?.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export default function CrewPayRatesCard() {
  const [rates, setRates] = useState<Rate[] | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [newBracket, setNewBracket] = useState({ min: "3", max: "", tier: "foundation", rate: "" });

  const load = useCallback(async () => {
    try {
      const d = await authedFetch("/api/admin/crew-pay-rates");
      setRates(d.rates as Rate[]);
    } catch (e) {
      toast.error("Couldn't load pay rates", {
        description: e instanceof Error ? e.message : String(e),
      });
      setRates([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Group by bracket so the table reads the way the policy is written:
  // one column per crew size, one row per tier.
  const { brackets, tiers, byKey } = useMemo(() => {
    const rs = rates || [];
    const bMap = new Map<string, { min: number; max: number | null }>();
    const tSet = new Set<string>();
    const map = new Map<string, Rate>();
    for (const r of rs) {
      const key = `${r.min_crew_size}:${r.max_crew_size ?? "inf"}`;
      bMap.set(key, { min: r.min_crew_size, max: r.max_crew_size });
      tSet.add(r.pay_tier);
      map.set(`${key}|${r.pay_tier}`, r);
    }
    const order = ["foundation", "proven", "elite"];
    return {
      brackets: [...bMap.entries()].sort((a, b) => a[1].min - b[1].min),
      tiers: [...tSet].sort((a, b) => {
        const ia = order.indexOf(a), ib = order.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      }),
      byKey: map,
    };
  }, [rates]);

  const save = async (rate: Rate, value: string) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      toast.error("A rate has to be between 0 and 100 percent.");
      return;
    }
    if (n === Number(rate.rate_percent)) return;
    setSavingId(rate.id);
    try {
      await authedFetch("/api/admin/crew-pay-rates", {
        method: "PUT",
        body: JSON.stringify({ id: rate.id, ratePercent: n }),
      });
      toast.success(
        `${tierName(rate.pay_tier)} · ${bracketLabel(rate.min_crew_size, rate.max_crew_size)} set to ${n}%`,
        { description: "Applies to future calculations. Pay already locked on completed jobs is unchanged." },
      );
      await load();
    } catch (e) {
      toast.error("Couldn't save that rate", {
        description: e instanceof Error ? e.message : String(e),
        duration: 12_000,
      });
    } finally {
      setSavingId(null);
      setDraft((d) => {
        const next = { ...d };
        delete next[rate.id];
        return next;
      });
    }
  };

  const addBracket = async () => {
    setAdding(true);
    try {
      await authedFetch("/api/admin/crew-pay-rates", {
        method: "POST",
        body: JSON.stringify({
          minCrewSize: Number(newBracket.min),
          maxCrewSize: newBracket.max === "" ? null : Number(newBracket.max),
          payTier: newBracket.tier,
          ratePercent: Number(newBracket.rate),
        }),
      });
      toast.success("Bracket added");
      setNewBracket({ min: "3", max: "", tier: "foundation", rate: "" });
      await load();
    } catch (e) {
      toast.error("Couldn't add that bracket", {
        description: e instanceof Error ? e.message : String(e),
        duration: 15_000,
      });
    } finally {
      setAdding(false);
    }
  };

  const remove = async (rate: Rate) => {
    if (
      !confirm(
        `Remove the ${tierName(rate.pay_tier)} rate for a crew of ${bracketLabel(rate.min_crew_size, rate.max_crew_size)}?`,
      )
    ) return;
    try {
      await authedFetch(`/api/admin/crew-pay-rates?id=${rate.id}`, { method: "DELETE" });
      toast.success("Bracket removed");
      await load();
    } catch (e) {
      toast.error("Couldn't remove that bracket", {
        description: e instanceof Error ? e.message : String(e),
        duration: 15_000,
      });
    }
  };

  if (rates === null) {
    return (
      <Card className="border-slate-200">
        <CardContent className="py-4 space-y-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-slate-200">
      <CardContent className="py-4 space-y-4">
        <div>
          <p className="text-sm font-semibold text-slate-900">Crew-size pay rates</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Suggested crew rates for Custom Payout. Confirming a payout records the amount you type and notifies the cleaner — it does not send Stripe yet.
            Two cleaners don&apos;t halve a job&apos;s time, so a crew earns a higher rate to keep hourly pay fair.
          </p>
        </div>

        <div className="flex items-start gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2">
          <RiInformationLine className="mt-0.5 h-4 w-4 shrink-0 text-violet-700" />
          <p className="text-[11px] leading-relaxed text-violet-900">
            The percentage is the share of the job paid to the <strong>whole crew</strong>, then
            divided between them — it is never paid per person. Each cleaner earns their own
            tier&apos;s rate for that crew size, divided by the crew size, so a mixed crew costs
            somewhere between an all-Foundation and an all-Elite one.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left">
                <th className="pb-2 pr-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Tier
                </th>
                {brackets.map(([key, b]) => (
                  <th
                    key={key}
                    className="pb-2 pr-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500"
                  >
                    {bracketLabel(b.min, b.max)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tiers.map((tier) => (
                <tr key={tier} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 pr-3 font-medium text-slate-900">{tierName(tier)}</td>
                  {brackets.map(([key]) => {
                    const rate = byKey.get(`${key}|${tier}`);
                    if (!rate) {
                      return (
                        <td key={key} className="py-2 pr-3 text-xs text-slate-400">
                          not set
                        </td>
                      );
                    }
                    const value = draft[rate.id] ?? String(Number(rate.rate_percent));
                    return (
                      <td key={key} className="py-2 pr-3">
                        <div className="flex items-center gap-1">
                          <Input
                            value={value}
                            inputMode="decimal"
                            disabled={savingId === rate.id}
                            onChange={(e) =>
                              setDraft((d) => ({ ...d, [rate.id]: e.target.value }))}
                            onBlur={() => void save(rate, value)}
                            className={cn("h-8 w-16 tabular-nums", savingId === rate.id && "opacity-60")}
                          />
                          <span className="text-xs text-slate-500">%</span>
                          {savingId === rate.id ? (
                            <RiLoader4Line className="h-3.5 w-3.5 animate-spin text-slate-400" />
                          ) : null}
                          <button
                            type="button"
                            title="Remove this bracket"
                            onClick={() => void remove(rate)}
                            className="ml-0.5 text-slate-300 hover:text-rose-600"
                          >
                            <RiDeleteBin6Line className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Adding a bracket is data, not a deploy. To introduce a distinct 3+
            rate, narrow the existing 2+ bracket to 2 first — the database
            refuses overlapping brackets because an ambiguous rate is a dispute. */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-medium text-slate-700">Add a crew-size bracket</p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <div>
              <Label className="text-[10px] text-slate-500">Min crew</Label>
              <Input
                value={newBracket.min}
                onChange={(e) => setNewBracket((b) => ({ ...b, min: e.target.value }))}
                className="h-8 w-16"
                inputMode="numeric"
              />
            </div>
            <div>
              <Label className="text-[10px] text-slate-500">Max (blank = and up)</Label>
              <Input
                value={newBracket.max}
                onChange={(e) => setNewBracket((b) => ({ ...b, max: e.target.value }))}
                className="h-8 w-24"
                inputMode="numeric"
                placeholder="—"
              />
            </div>
            <div>
              <Label className="text-[10px] text-slate-500">Tier</Label>
              <select
                value={newBracket.tier}
                onChange={(e) => setNewBracket((b) => ({ ...b, tier: e.target.value }))}
                className="h-8 rounded-md border border-slate-200 bg-white px-2 text-sm"
              >
                {(tiers.length ? tiers : ["foundation", "proven", "elite"]).map((t) => (
                  <option key={t} value={t}>{tierName(t)}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-[10px] text-slate-500">Rate %</Label>
              <Input
                value={newBracket.rate}
                onChange={(e) => setNewBracket((b) => ({ ...b, rate: e.target.value }))}
                className="h-8 w-16"
                inputMode="decimal"
              />
            </div>
            <Button size="sm" disabled={adding || !newBracket.rate} onClick={() => void addBracket()}>
              {adding ? (
                <RiLoader4Line className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RiAddLine className="mr-1 h-3.5 w-3.5" />
              )}
              Add
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            To add a distinct 3+ rate, first change the existing “2 or more” bracket&apos;s max to
            2, then add brackets starting at 3. Overlapping brackets are rejected — two rates
            could otherwise apply to the same crew size.
          </p>
        </div>

        <p className="text-[11px] text-slate-500">
          Changes apply to future calculations everywhere. Pay already locked on a completed job
          keeps the rate and crew size it was calculated with.
        </p>
      </CardContent>
    </Card>
  );
}
