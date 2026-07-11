"use client";

// ─── Partnerships Hub — recurring schedules (Commercial · Office · STR) ──────
//
// The partner analogue of the residential Recurring console: every active
// cadence across all three types in one list. Future visits generate a week
// ahead (partner-jobs-generate cron) carrying the same access, scope, locked
// pay, and preferred crew. Pause/resume/cancel here.

import { useCallback, useEffect, useState } from "react";
import {
  RiBuilding2Line,
  RiHomeSmile2Line,
  RiLoader4Line,
  RiPauseCircleLine,
  RiPlayCircleLine,
  RiRefreshLine,
  RiRepeatLine,
} from "@remixicon/react";
import { format } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface ScheduleRow {
  id: string;
  booking_type: string;
  business_account_id: string | null;
  business_site_id: string | null;
  property_id: string | null;
  cadence: string;
  preferred_window: string | null;
  hard_deadline: string | null;
  price_cents: number;
  cleaner_pay_pct: number;
  service_type: string;
  next_service_date: string | null;
  last_generated_date: string | null;
  active: boolean;
  created_at: string;
  // resolved labels
  label?: string;
}

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

export default function PartnerRecurringSchedules() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase.from as any)("partner_recurring_schedules")
        .select("*")
        .order("active", { ascending: false })
        .order("next_service_date", { ascending: true })
        .limit(300);
      if (error) throw error;
      const schedules = (data || []) as ScheduleRow[];

      // Resolve display labels (account/site or property).
      const acctIds = [...new Set(schedules.map((r) => r.business_account_id).filter(Boolean))] as string[];
      const siteIds = [...new Set(schedules.map((r) => r.business_site_id).filter(Boolean))] as string[];
      const propIds = [...new Set(schedules.map((r) => r.property_id).filter(Boolean))] as string[];
      const [acctRes, siteRes, propRes] = await Promise.all([
        acctIds.length ? (supabase.from as any)("business_accounts").select("id, business_name").in("id", acctIds) : { data: [] },
        siteIds.length ? (supabase.from as any)("business_sites").select("id, nickname").in("id", siteIds) : { data: [] },
        propIds.length ? (supabase.from as any)("properties").select("id, nickname, address").in("id", propIds) : { data: [] },
      ]);
      const acctName = new Map(((acctRes.data || []) as Array<{ id: string; business_name: string }>).map((a) => [a.id, a.business_name]));
      const siteName = new Map(((siteRes.data || []) as Array<{ id: string; nickname: string }>).map((s) => [s.id, s.nickname]));
      const propName = new Map(((propRes.data || []) as Array<{ id: string; nickname: string | null; address: string | null }>).map((p) => [p.id, p.nickname || p.address || p.id.slice(0, 8)]));

      setRows(schedules.map((r) => ({
        ...r,
        label: r.property_id
          ? String(propName.get(r.property_id) || "Property")
          : `${acctName.get(r.business_account_id || "") || "Account"}${r.business_site_id ? ` — ${siteName.get(r.business_site_id) || "site"}` : ""}`,
      })));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load schedules");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const toggle = async (row: ScheduleRow) => {
    setBusyId(row.id);
    try {
      const { error } = await (supabase.from as any)("partner_recurring_schedules")
        .update({ active: !row.active, updated_at: new Date().toISOString() })
        .eq("id", row.id);
      if (error) throw error;
      toast.success(row.active ? "Schedule paused" : "Schedule resumed");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusyId(null);
    }
  };

  const runNow = async () => {
    setBusyId("run");
    try {
      const { data, error } = await supabase.functions.invoke("partner-jobs-generate", { body: {} });
      if (error) throw error;
      toast.success(`Generator ran — ${(data as { generated?: number })?.generated ?? 0} booking(s) created.`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Generator failed");
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          Visits auto-generate 7 days ahead with the same access, scope, locked pay, and preferred crew (daily 9:00 UTC).
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void runNow()} disabled={busyId === "run"}>
            {busyId === "run" ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiRepeatLine className="w-4 h-4 mr-1.5" />}
            Generate now
          </Button>
          <Button variant="outline" size="sm" onClick={() => void load()}><RiRefreshLine className="w-4 h-4" /></Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <Card><CardContent className="p-10 text-center text-sm text-slate-500">
          No recurring schedules yet — check "Make this recurring" when booking a job.
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className={cn("rounded-xl border bg-white px-4 py-3", r.active ? "border-slate-200" : "border-slate-100 opacity-60")}>
              <div className="flex flex-wrap items-center gap-2">
                {r.booking_type === "str_turnover"
                  ? <RiHomeSmile2Line className="w-4 h-4 text-violet-600" />
                  : <RiBuilding2Line className="w-4 h-4 text-violet-600" />}
                <span className="font-semibold text-slate-900">{r.label}</span>
                <Badge variant="outline" className="capitalize">{r.booking_type.replace("_", " ")}</Badge>
                <Badge className="bg-violet-100 text-violet-700 border-0 capitalize">{r.cadence}</Badge>
                <Badge className={cn("border-0", r.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500")}>
                  {r.active ? "active" : "paused"}
                </Badge>
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-700">{money(r.price_cents)}</span>
                  <Button size="sm" variant="ghost" className="h-7" disabled={busyId === r.id} onClick={() => void toggle(r)}>
                    {busyId === r.id
                      ? <RiLoader4Line className="w-4 h-4 animate-spin" />
                      : r.active ? <RiPauseCircleLine className="w-4 h-4 text-amber-500" /> : <RiPlayCircleLine className="w-4 h-4 text-emerald-500" />}
                  </Button>
                </div>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Next: {r.next_service_date ? format(new Date(`${r.next_service_date}T12:00:00`), "EEE, MMM d") : "—"}
                {r.preferred_window ? ` · ${r.preferred_window}` : ""}
                {r.hard_deadline ? ` · ⏰ ${r.hard_deadline}` : ""}
                {" · crew "}{r.cleaner_pay_pct}%
                {r.last_generated_date ? ` · last generated ${format(new Date(`${r.last_generated_date}T12:00:00`), "MMM d")}` : ""}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
