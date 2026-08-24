"use client";

// ─── Commercial hub — Overview ─────────────────────────────────────────────
//
// Commercial-first: deal pipeline, contracted monthly value, intake, and the
// gaps that actually block dispatch. STR is a compact strip, not a co-equal
// identity of this console.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RiArrowRightLine,
  RiBuilding2Line,
  RiBuilding4Line,
  RiErrorWarningLine,
  RiHomeSmile2Line,
  RiLineChartLine,
  RiMailSendLine,
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
import { commercialProposalApi } from "@/lib/commercial-proposal-api";
import {
  STAGE_LABELS,
  commercialTab,
  money as moneyFmt,
  type PipelineStage,
} from "@/lib/commercial-proposal";

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
interface AttentionItem {
  label: string;
  detail: string;
  severity: "high" | "medium";
  href?: string;
}
interface Deal {
  account_id: string;
  business_name: string;
  stage: PipelineStage;
  email: string | null;
  total_per_visit_cents: number | null;
}

const money = (c: number) => moneyFmt(c).replace(/\.00$/, "");

const PIPELINE_SPOTLIGHT: PipelineStage[] = [
  "changes_requested",
  "billing_pending",
  "proposal_sent",
  "firm_price_ready",
];

export default function PartnershipsOverview() {
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [attention, setAttention] = useState<AttentionItem[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const monthStart = new Date();
      monthStart.setDate(1);
      const monthStartIso = monthStart.toISOString().slice(0, 10);

      const [acctRes, hostsRes, turnRes, leadsRes, propsRes, sitesRes, coiRes, pipe] = await Promise.all([
        (supabase.from as any)("business_accounts").select("id, account_type, status, business_name, default_rate_cents, agreement_signed_at, stripe_customer_id, billing_configured_at, coi_sent_at, coi_expires_at, last_activity_at").limit(1000),
        (supabase.from as any)("hosts").select("id, status, name, email").limit(1000),
        (supabase.from as any)("turnover_requests").select("id, status, price, requested_date").gte("requested_date", monthStartIso).limit(2000),
        (supabase.from as any)("leads").select("id, first_name, last_name, email, phone, status, lead_score, service_type, property_type, notes, created_at")
          .eq("source", "commercial_intake").order("created_at", { ascending: false }).limit(100),
        (supabase.from as any)("properties").select("id, nickname, turnover_price, host_id").limit(1000),
        (supabase.from as any)("business_sites").select("id, business_account_id").eq("active", true).limit(2000),
        (supabase.from as any)("commercial_coi_status_v1")
          .select("account_id, coi_status, days_remaining, blocked, active_override, documents_in_review").limit(1000),
        commercialProposalApi("GET", undefined, "?view=pipeline").catch(() => ({ deals: [] })),
      ]);

      const accounts = (acctRes.data || []) as Array<Record<string, any>>;
      const hosts = (hostsRes.data || []) as Array<Record<string, any>>;
      const turns = (turnRes.data || []) as Array<Record<string, any>>;
      const props = (propsRes.data || []) as Array<Record<string, any>>;
      const leadRows = (leadsRes.data || []) as LeadRow[];
      const dealRows = ((pipe as { deals?: Deal[] }).deals || []) as Deal[];
      setDeals(dealRows);

      const siteCountByAccount = new Map<string, number>();
      for (const st of (sitesRes.data || []) as Array<Record<string, any>>) {
        const key = String(st.business_account_id);
        siteCountByAccount.set(key, (siteCountByAccount.get(key) || 0) + 1);
      }
      const coiByAccount = new Map<string, Record<string, any>>(
        ((coiRes.data || []) as Array<Record<string, any>>).map((c) => [String(c.account_id), c]),
      );

      const activeAccts = accounts.filter((a) => a.status === "active");
      const doneTurns = turns.filter((t) => ["completed", "assigned", "confirmed", "scheduled", "pending"].includes(String(t.status || "")));
      const m: Metrics = {
        commercialActive: activeAccts.filter((a) => a.account_type !== "office").length,
        commercialMonthlyCents: activeAccts.reduce((s, a) => s + (Number(a.default_rate_cents) || 0), 0),
        officeActive: activeAccts.filter((a) => a.account_type === "office").length,
        strHostsActive: hosts.filter((h) => String(h.status || "active") === "active").length,
        strTurnoversThisMonth: doneTurns.length,
        strRevenueThisMonthCents: doneTurns.reduce((s, t) => s + Math.round((Number(t.price) || 0) * 100), 0),
        prospects: accounts.filter((a) => a.status === "prospect").length,
      };
      setMetrics(m);
      setLeads(leadRows);

      const items: AttentionItem[] = [];
      for (const d of dealRows) {
        if (d.stage === "changes_requested") {
          items.push({
            label: `${d.business_name} — client asked for changes`,
            detail: "Commercial · rebuild and resend from Send Proposal",
            severity: "high",
            href: commercialTab("send", { account: d.account_id }),
          });
        } else if (d.stage === "billing_pending") {
          items.push({
            label: `${d.business_name} — signed, billing not configured`,
            detail: "Commercial · nothing dispatches until billing is set",
            severity: "high",
            href: commercialTab("pipeline"),
          });
        } else if (d.stage === "coi_blocked") {
          items.push({
            label: `${d.business_name} — blocked on certificate`,
            detail: "Commercial · signed and billable, COI isn't current",
            severity: "high",
            href: commercialTab("compliance"),
          });
        } else if (d.stage === "proposal_expired") {
          items.push({
            label: `${d.business_name} — proposal expired`,
            detail: "Commercial · send a fresh version",
            severity: "medium",
            href: commercialTab("send", { account: d.account_id }),
          });
        } else if (d.stage === "firm_price_ready") {
          items.push({
            label: `${d.business_name} — firm price ready, no proposal out`,
            detail: "Commercial · send the proposal",
            severity: "medium",
            href: commercialTab("send", { account: d.account_id }),
          });
        }
      }
      for (const a of accounts) {
        if (a.status === "offboarded") continue;
        if (["onboarding", "active"].includes(String(a.status))) {
          const coi = coiByAccount.get(String(a.id));
          const sitesUnder = siteCountByAccount.get(String(a.id)) || 0;
          const scope = sitesUnder > 1
            ? ` · blocks all ${sitesUnder} sites`
            : sitesUnder === 1 ? " · blocks its site" : "";
          if (coi?.blocked && coi.coi_status === "expired") {
            items.push({ label: `${a.business_name} — COI expired ${Math.abs(Number(coi.days_remaining))}d ago`, detail: `Commercial · booking and dispatch blocked${scope}`, severity: "high", href: commercialTab("compliance") });
          } else if (coi?.blocked) {
            items.push({ label: `${a.business_name} — no current COI on file`, detail: `Commercial · booking and dispatch blocked${scope}`, severity: "high", href: commercialTab("compliance") });
          } else if (coi?.active_override) {
            items.push({ label: `${a.business_name} — running on a COI override`, detail: "Commercial · temporary exception — chase the certificate", severity: "medium", href: commercialTab("compliance") });
          } else if (coi?.coi_status === "expiring_soon") {
            items.push({ label: `${a.business_name} — COI expires in ${coi.days_remaining}d`, detail: `Commercial · renew before it lapses${scope}`, severity: "medium", href: commercialTab("compliance") });
          }
          if (Number(coi?.documents_in_review) > 0) {
            items.push({ label: `${a.business_name} — ${coi?.documents_in_review} COI upload(s) awaiting review`, detail: "Commercial · no readable expiry date, so it isn't counting as cover", severity: "medium", href: commercialTab("compliance") });
          }
        }
      }
      const pendingPricing = props.filter((p) => p.turnover_price == null);
      if (pendingPricing.length > 0) {
        items.push({ label: `${pendingPricing.length} STR propert${pendingPricing.length === 1 ? "y" : "ies"} pending pricing`, detail: "STR · set rates under the STR tab", severity: "high", href: commercialTab("str") });
      }
      const newLeads = leadRows.filter((l) => l.status === "new");
      if (newLeads.length > 0) {
        items.push({ label: `${newLeads.length} intake lead${newLeads.length === 1 ? "" : "s"} awaiting first contact`, detail: "Pipeline · respond within one business day", severity: "high" });
      }
      const seen = new Set<string>();
      setAttention(items.filter((i) => {
        if (seen.has(i.label)) return false;
        seen.add(i.label);
        return true;
      }).slice(0, 20));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load overview");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const stageCounts = useMemo(() => {
    const out: Partial<Record<PipelineStage, number>> = {};
    for (const d of deals) out[d.stage] = (out[d.stage] || 0) + 1;
    return out;
  }, [deals]);

  if (loading || !metrics) {
    return <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>;
  }

  const readyToSend = stageCounts.firm_price_ready || 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">
          {readyToSend > 0
            ? `${readyToSend} account${readyToSend === 1 ? "" : "s"} have a firm price and no proposal out.`
            : "No accounts sitting on a firm price without a proposal."}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RiRefreshLine className="w-4 h-4 mr-1.5" /> Refresh
          </Button>
          <Button size="sm" asChild className="bg-violet-600 hover:bg-violet-700">
            <a href={commercialTab("send")}>
              <RiMailSendLine className="w-4 h-4 mr-1.5" />
              Send a proposal
            </a>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {PIPELINE_SPOTLIGHT.map((stage) => (
          <a key={stage} href={commercialTab(stage === "firm_price_ready" ? "send" : "pipeline")}>
            <Card className="h-full transition hover:shadow-sm">
              <CardContent className="p-4">
                <p className="text-2xl font-bold text-slate-900">{stageCounts[stage] || 0}</p>
                <p className="text-xs text-slate-500 mt-1">{STAGE_LABELS[stage]}</p>
              </CardContent>
            </Card>
          </a>
        ))}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card><CardContent className="p-4">
          <p className="text-xs font-medium text-slate-500 flex items-center gap-1"><RiBuilding2Line className="w-3.5 h-3.5" /> Commercial</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{metrics.commercialActive}</p>
          <p className="text-[11px] text-slate-500 mt-1">active accounts · {money(metrics.commercialMonthlyCents)}/mo contracted</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs font-medium text-slate-500 flex items-center gap-1"><RiBuilding4Line className="w-3.5 h-3.5" /> Office</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{metrics.officeActive}</p>
          <p className="text-[11px] text-slate-500 mt-1">active office accounts</p>
        </CardContent></Card>
        <Card className="border-violet-300 bg-violet-50/50"><CardContent className="p-4">
          <p className="text-xs font-medium text-violet-700 flex items-center gap-1"><RiLineChartLine className="w-3.5 h-3.5" /> Contracted</p>
          <p className="text-2xl font-bold text-violet-900 mt-1">{money(metrics.commercialMonthlyCents)}</p>
          <p className="text-[11px] text-violet-600 mt-1">{metrics.prospects} prospects in the commercial pipeline</p>
        </CardContent></Card>
        <a href={commercialTab("str")}>
          <Card className="h-full transition hover:shadow-sm">
            <CardContent className="p-4">
              <p className="text-xs font-medium text-slate-500 flex items-center gap-1"><RiHomeSmile2Line className="w-3.5 h-3.5" /> STR / Airbnb</p>
              <p className="text-2xl font-bold text-slate-900 mt-1">{metrics.strHostsActive}</p>
              <p className="text-[11px] text-slate-500 mt-1">{metrics.strTurnoversThisMonth} turnovers · {money(metrics.strRevenueThisMonthCents)} this month</p>
            </CardContent>
          </Card>
        </a>
      </div>

      <section>
        <h2 className="font-bold text-slate-900 flex items-center gap-1.5 mb-2">
          <RiErrorWarningLine className="w-4 h-4 text-amber-500" /> Needs attention
        </h2>
        {attention.length === 0 ? (
          <Card><CardContent className="p-6 text-center text-sm text-slate-500">All clear — no gaps across the commercial pipeline.</CardContent></Card>
        ) : (
          <div className="space-y-1.5">
            {attention.map((i, idx) => {
              const inner = (
                <div className={cn(
                  "rounded-lg border px-3 py-2 text-sm flex items-center gap-2",
                  i.severity === "high" ? "border-rose-200 bg-rose-50/60" : "border-amber-200 bg-amber-50/60",
                )}>
                  <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", i.severity === "high" ? "bg-rose-500" : "bg-amber-500")} />
                  <span className="font-medium text-slate-800">{i.label}</span>
                  <span className="text-xs text-slate-500 ml-auto flex items-center gap-1">
                    {i.detail}
                    {i.href && <RiArrowRightLine className="w-3.5 h-3.5" />}
                  </span>
                </div>
              );
              return i.href ? <a key={idx} href={i.href} className="block">{inner}</a> : <div key={idx}>{inner}</div>;
            })}
          </div>
        )}
      </section>

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
                  {l.lead_score === "hot" && <Badge className="bg-rose-100 text-rose-700 border-0">priority</Badge>}
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
