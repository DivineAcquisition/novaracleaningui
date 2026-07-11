"use client";

// ─── Partnerships Hub — unified Overview tab ─────────────────────────────────
//
// One view across all three lines of business (Commercial / Office / STR):
//   • Revenue & pipeline, computed live from Supabase (no Airtable rate
//     limits): active commercial accounts + monthly contract value, active
//     STR hosts + turnovers/revenue this month, office subset, portfolio total.
//   • Intake pipeline: typed leads from commercial.novaracleaning.com by
//     type + status.
//   • Needs attention across every type: unsigned agreements, missing
//     payment, COI gaps, pending pricing, idle accounts, unworked leads.

import { useCallback, useEffect, useState } from "react";
import {
  RiBuilding2Line,
  RiBuilding4Line,
  RiErrorWarningLine,
  RiHomeSmile2Line,
  RiLineChartLine,
  RiRefreshLine,
  RiUserAddLine,
} from "@remixicon/react";
import { format } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface Metrics {
  commercialActive: number;
  commercialMonthlyCents: number;
  officeActive: number;
  strHostsActive: number;
  strTurnoversThisMonth: number;
  strRevenueThisMonthCents: number;
  prospects: number;
}
interface LeadRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  lead_score: string | null;
  service_type: string | null;
  property_type: string | null;
  notes: string | null;
  created_at: string;
}
interface AttentionItem { label: string; detail: string; severity: "high" | "medium" }

const money = (c: number) => `$${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export default function PartnershipsOverview() {
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [attention, setAttention] = useState<AttentionItem[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const monthStart = new Date();
      monthStart.setDate(1);
      const monthStartIso = monthStart.toISOString().slice(0, 10);

      const [acctRes, hostsRes, turnRes, leadsRes, propsRes] = await Promise.all([
        (supabase.from as any)("business_accounts").select("id, account_type, status, business_name, default_rate_cents, agreement_signed_at, stripe_customer_id, coi_sent_at, last_activity_at").limit(1000),
        (supabase.from as any)("hosts").select("id, status, name, email").limit(1000),
        (supabase.from as any)("turnover_requests").select("id, status, price, requested_date").gte("requested_date", monthStartIso).limit(2000),
        (supabase.from as any)("leads").select("id, first_name, last_name, email, phone, status, lead_score, service_type, property_type, notes, created_at")
          .eq("source", "commercial_intake").order("created_at", { ascending: false }).limit(100),
        (supabase.from as any)("properties").select("id, nickname, turnover_price, host_id").limit(1000),
      ]);

      const accounts = (acctRes.data || []) as Array<Record<string, any>>;
      const hosts = (hostsRes.data || []) as Array<Record<string, any>>;
      const turns = (turnRes.data || []) as Array<Record<string, any>>;
      const props = (propsRes.data || []) as Array<Record<string, any>>;
      const leadRows = (leadsRes.data || []) as LeadRow[];

      const activeAccts = accounts.filter((a) => a.status === "active");
      const doneTurns = turns.filter((t) => ["completed", "assigned", "confirmed", "scheduled", "pending"].includes(String(t.status || "")));
      const m: Metrics = {
        commercialActive: activeAccts.length,
        commercialMonthlyCents: activeAccts.reduce((s, a) => s + (Number(a.default_rate_cents) || 0), 0),
        officeActive: activeAccts.filter((a) => a.account_type === "office").length,
        strHostsActive: hosts.filter((h) => String(h.status || "active") === "active").length,
        strTurnoversThisMonth: doneTurns.length,
        strRevenueThisMonthCents: doneTurns.reduce((s, t) => s + Math.round((Number(t.price) || 0) * 100), 0),
        prospects: accounts.filter((a) => a.status === "prospect").length,
      };
      setMetrics(m);
      setLeads(leadRows);

      // ── Needs attention across all three types ──────────────────────
      const items: AttentionItem[] = [];
      for (const a of accounts) {
        if (a.status === "offboarded") continue;
        if (["onboarding", "active"].includes(String(a.status))) {
          if (!a.agreement_signed_at) items.push({ label: `${a.business_name} — agreement unsigned`, detail: "Commercial · chase signature", severity: "high" });
          if (!a.stripe_customer_id) items.push({ label: `${a.business_name} — no payment on file`, detail: "Commercial · chase payment setup", severity: "high" });
          if (a.status === "active" && !a.coi_sent_at) items.push({ label: `${a.business_name} — COI not sent`, detail: "Commercial · send certificate of insurance", severity: "medium" });
        }
        if (a.last_activity_at && Date.now() - new Date(a.last_activity_at).getTime() > 30 * 86400_000 && a.status === "active") {
          items.push({ label: `${a.business_name} — idle 30+ days`, detail: "Commercial · churn watch", severity: "medium" });
        }
      }
      const pendingPricing = props.filter((p) => p.turnover_price == null);
      if (pendingPricing.length > 0) {
        items.push({ label: `${pendingPricing.length} STR propert${pendingPricing.length === 1 ? "y" : "ies"} pending pricing`, detail: "STR · set rates in Host Accounts", severity: "high" });
      }
      const newLeads = leadRows.filter((l) => l.status === "new");
      if (newLeads.length > 0) {
        items.push({ label: `${newLeads.length} intake lead${newLeads.length === 1 ? "" : "s"} awaiting first contact`, detail: "Pipeline · respond within one business day", severity: "high" });
      }
      setAttention(items.slice(0, 20));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load overview");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (loading || !metrics) {
    return <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>;
  }

  const portfolioCents = metrics.commercialMonthlyCents + metrics.strRevenueThisMonthCents;

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => void load()}>
          <RiRefreshLine className="w-4 h-4 mr-1.5" /> Refresh
        </Button>
      </div>

      {/* ─── Revenue per line of business (live) ─────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card><CardContent className="p-4">
          <p className="text-xs font-medium text-slate-500 flex items-center gap-1"><RiBuilding2Line className="w-3.5 h-3.5" /> Commercial</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{metrics.commercialActive}</p>
          <p className="text-[11px] text-slate-500 mt-1">active accounts · {money(metrics.commercialMonthlyCents)}/mo contracted</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs font-medium text-slate-500 flex items-center gap-1"><RiBuilding4Line className="w-3.5 h-3.5" /> Office subset</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{metrics.officeActive}</p>
          <p className="text-[11px] text-slate-500 mt-1">active office accounts</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs font-medium text-slate-500 flex items-center gap-1"><RiHomeSmile2Line className="w-3.5 h-3.5" /> STR / Airbnb</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{metrics.strHostsActive}</p>
          <p className="text-[11px] text-slate-500 mt-1">{metrics.strTurnoversThisMonth} turnovers · {money(metrics.strRevenueThisMonthCents)} this month</p>
        </CardContent></Card>
        <Card className="border-violet-300 bg-violet-50/50"><CardContent className="p-4">
          <p className="text-xs font-medium text-violet-700 flex items-center gap-1"><RiLineChartLine className="w-3.5 h-3.5" /> Portfolio</p>
          <p className="text-2xl font-bold text-violet-900 mt-1">{money(portfolioCents)}</p>
          <p className="text-[11px] text-violet-600 mt-1">recurring commercial + STR this month · {metrics.prospects} prospects in pipeline</p>
        </CardContent></Card>
      </div>

      {/* ─── Needs attention ─────────────────────────────────────────── */}
      <section>
        <h2 className="font-bold text-slate-900 flex items-center gap-1.5 mb-2">
          <RiErrorWarningLine className="w-4 h-4 text-amber-500" /> Needs attention
        </h2>
        {attention.length === 0 ? (
          <Card><CardContent className="p-6 text-center text-sm text-slate-500">All clear — no gaps across the portfolio.</CardContent></Card>
        ) : (
          <div className="space-y-1.5">
            {attention.map((i, idx) => (
              <div key={idx} className={cn(
                "rounded-lg border px-3 py-2 text-sm flex items-center gap-2",
                i.severity === "high" ? "border-rose-200 bg-rose-50/60" : "border-amber-200 bg-amber-50/60",
              )}>
                <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", i.severity === "high" ? "bg-rose-500" : "bg-amber-500")} />
                <span className="font-medium text-slate-800">{i.label}</span>
                <span className="text-xs text-slate-500 ml-auto">{i.detail}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ─── Intake pipeline ─────────────────────────────────────────── */}
      <section>
        <h2 className="font-bold text-slate-900 flex items-center gap-1.5 mb-2">
          <RiUserAddLine className="w-4 h-4 text-violet-600" /> Intake pipeline
          <span className="text-xs font-normal text-slate-400">— commercial.novaracleaning.com submissions</span>
        </h2>
        {leads.length === 0 ? (
          <Card><CardContent className="p-6 text-center text-sm text-slate-500">
            No intake leads yet. Prospects who apply at commercial.novaracleaning.com appear here instantly.
          </CardContent></Card>
        ) : (
          <div className="space-y-2">
            {leads.slice(0, 15).map((l) => (
              <div key={l.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-900">{l.first_name} {l.last_name}</span>
                  <Badge variant="outline" className="capitalize">
                    {l.service_type === "str_turnover" ? "STR / Airbnb" : l.property_type === "office" ? "Office" : "Commercial"}
                  </Badge>
                  {l.lead_score === "hot" && <Badge className="bg-rose-100 text-rose-700 border-0">🔥 priority</Badge>}
                  <Badge className={cn("border-0", l.status === "new" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600")}>{l.status}</Badge>
                  <span className="text-xs text-slate-400 ml-auto">{format(new Date(l.created_at), "MMM d, h:mm a")}</span>
                </div>
                <p className="text-xs text-slate-500 mt-1">{l.email} · {l.phone}</p>
                {l.notes && <p className="text-xs text-slate-400 mt-1 whitespace-pre-line line-clamp-3">{l.notes}</p>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
