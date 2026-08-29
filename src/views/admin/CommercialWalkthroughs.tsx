"use client";

// ─── Walkthroughs — Partnerships Hub tab ───────────────────────────────────
//
// The pipeline between "a large site needs pricing" and "a firm, dispatchable
// rate exists":
//
//   Requested → Scheduled → Conducted → Firm Price Set
//                                \
//                                 `→ Excluded (routes out, never priced)
//
// Conducted-pending-price sorts first and stays first, because that is where
// deals stall: the visit happened, everyone assumes it is handled, and a large
// prospective account sits still for a fortnight.
//
// Findings are a form with required fields rather than a notes box. The price
// step shows the formula as an anchor and will not save a departure from it
// without a reason. Neither of those is politeness — the database enforces
// both, and this screen just explains them before they bite.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RiAddLine,
  RiAlarmWarningLine,
  RiBuilding2Line,
  RiCalendarCheckLine,
  RiCheckboxCircleFill,
  RiErrorWarningLine,
  RiLoader4Line,
  RiRefreshLine,
  RiRulerLine,
  RiSearch2Line,
  RiCameraLine,
} from "@remixicon/react";
import { format } from "date-fns";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { commercialEquipmentItems, commercialEquipmentLabel } from "@/lib/cleaner-supplies";
import { formatCents, type CommercialQuote } from "@/lib/commercial-pricing";
import { walkthroughStaffPath } from "@/lib/proposal-request";
import { cn } from "@/lib/utils";

const PHOTO_BUCKET = "cleaner-job-photos";

type Stage = "requested" | "scheduled" | "conducted" | "priced" | "excluded" | "cancelled";

interface PipelineRow {
  id: string;
  business_account_id: string;
  business_site_id: string;
  business_name: string | null;
  site_nickname: string | null;
  site_address: string | null;
  status: Stage;
  request_reason: string | null;
  requested_at: string;
  scheduled_at: string | null;
  conducted_on: string | null;
  conducted_by: string | null;
  priced_at: string | null;
  findings_complete: boolean;
  client_stated_sqft: number | null;
  confirmed_sqft: number | null;
  facility_type_key: string | null;
  scope_level: string | null;
  condition_level: string | null;
  recommended_crew_size: number | null;
  required_equipment: string[] | null;
  formula_price_cents: number | null;
  firm_price_cents: number | null;
  price_adjustment_reason: string | null;
  exclusion_code: string | null;
  exclusion_note: string | null;
  supersedes_walkthrough_id: string | null;
  photo_count: number;
  business_days_pending_price: number | null;
  stalled: boolean;
  adjustment_pct: number | null;
  stage_rank: number;
}

interface VarianceRow {
  site_id: string;
  business_name: string;
  site_nickname: string;
  samples: number;
  avg_projected_hours: number;
  avg_actual_hours: number;
  avg_variance_pct: number;
  avg_crew_recommended: number | null;
  avg_crew_used: number | null;
  rewalkthrough_suggested: boolean;
  walkthrough_id: string | null;
}

const STAGE_META: Record<Stage, { label: string; chip: string }> = {
  conducted: { label: "Pending price", chip: "bg-amber-100 text-amber-800" },
  scheduled: { label: "Scheduled", chip: "bg-blue-100 text-blue-700" },
  requested: { label: "Requested", chip: "bg-slate-100 text-slate-700" },
  excluded: { label: "Excluded", chip: "bg-rose-100 text-rose-700" },
  priced: { label: "Firm price set", chip: "bg-emerald-100 text-emerald-700" },
  cancelled: { label: "Cancelled", chip: "bg-slate-100 text-slate-400" },
};

const CONDITIONS = [
  { id: "good", label: "Good — maintained, no backlog" },
  { id: "average", label: "Average — normal wear" },
  { id: "poor", label: "Poor — visible backlog, heavier first visit" },
  { id: "severe", label: "Severe — needs a restoration pass first" },
];

const DENSITIES = [
  { id: "low", label: "Low — open floor, little to work around" },
  { id: "moderate", label: "Moderate — normal furniture/equipment" },
  { id: "high", label: "High — dense racking, shelving, or workstations" },
  { id: "severe", label: "Severe — access is the job" },
];

async function api(method: string, body?: unknown, query = ""): Promise<Record<string, any>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`/api/admin/walkthroughs${query}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out?.ok === false) throw new Error(out?.error || `Request failed (${res.status})`);
  return out;
}

export default function CommercialWalkthroughs() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<PipelineRow[]>([]);
  const [variance, setVariance] = useState<VarianceRow[]>([]);
  const [filter, setFilter] = useState("open");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pipeline, drift] = await Promise.all([
        api("GET"),
        api("GET", undefined, "?view=variance").catch(() => ({ sites: [] })),
      ]);
      setRows((pipeline.walkthroughs || []) as PipelineRow[]);
      setVariance((drift.sites || []) as VarianceRow[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load the walkthrough pipeline");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { requested: 0, scheduled: 0, conducted: 0, priced: 0, excluded: 0, stalled: 0 };
    for (const r of rows) {
      c[r.status] = (c[r.status] || 0) + 1;
      if (r.stalled) c.stalled += 1;
    }
    return c;
  }, [rows]);

  const drifting = useMemo(() => variance.filter((v) => v.rewalkthrough_suggested), [variance]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (filter === "open" && !["requested", "scheduled", "conducted"].includes(r.status)) return false;
    if (filter === "stalled" && !r.stalled) return false;
    if (!["open", "stalled", "all"].includes(filter) && r.status !== filter) return false;
    if (search) {
      const hay = `${r.business_name || ""} ${r.site_nickname || ""} ${r.conducted_by || ""}`;
      if (!hay.toLowerCase().includes(search.toLowerCase())) return false;
    }
    return true;
  }), [rows, filter, search]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <StageTile label="Requested" value={counts.requested} sub="not yet scheduled" tone="slate" />
        <StageTile label="Scheduled" value={counts.scheduled} sub="visit booked" tone="blue" />
        <StageTile
          label="Pending price" value={counts.conducted}
          sub={counts.stalled ? `${counts.stalled} stalled` : "findings captured"}
          tone={counts.stalled ? "rose" : "amber"}
        />
        <StageTile label="Priced" value={counts.priced} sub="sites bookable" tone="emerald" />
        <StageTile label="Excluded" value={counts.excluded} sub="routed out, not priced" tone="rose" />
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs text-slate-600">
        A site at or above the walkthrough threshold cannot reach a confirmed, dispatchable booking until its
        walkthrough reaches <strong>Firm Price Set</strong>. Findings are structured because the price has to be
        traceable to specific inputs, not an impression — and the confirmed square footage measured on site becomes the
        number of record, whatever the client estimated.
      </div>

      {drifting.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50/60 p-3 space-y-1.5">
          <p className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
            <RiAlarmWarningLine className="w-3.5 h-3.5" /> Sites no longer servicing the way they were priced
          </p>
          {drifting.map((v) => (
            <div key={v.site_id} className="flex flex-wrap items-center gap-2 text-xs text-amber-900">
              <span>
                <strong>{v.business_name} — {v.site_nickname}</strong>: {v.samples} visits averaging{" "}
                {v.avg_actual_hours}h against {v.avg_projected_hours}h projected ({v.avg_variance_pct}%)
                {v.avg_crew_used && v.avg_crew_recommended && v.avg_crew_used > v.avg_crew_recommended
                  ? `, crews of ${v.avg_crew_used} against ${v.avg_crew_recommended} recommended`
                  : ""}
              </span>
              <Button size="sm" variant="outline" className="h-6 text-[11px] ml-auto"
                onClick={async () => {
                  try {
                    await api("POST", {
                      action: "rewalk", siteId: v.site_id, reason: "performance_variance",
                      varianceTrigger: {
                        samples: v.samples, avg_variance_pct: v.avg_variance_pct,
                        avg_crew_used: v.avg_crew_used, avg_crew_recommended: v.avg_crew_recommended,
                      },
                    });
                    toast.success("Re-walkthrough opened — the prior walkthrough stays in history for comparison.");
                    await load();
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Could not open a re-walkthrough");
                  }
                }}>
                Re-walk this site
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <RiSearch2Line className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input placeholder="Search account, site, or conductor…" value={search}
            onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="open">In the pipeline</SelectItem>
            <SelectItem value="stalled">⚠ Stalled — no price</SelectItem>
            <SelectItem value="requested">Requested</SelectItem>
            <SelectItem value="scheduled">Scheduled</SelectItem>
            <SelectItem value="conducted">Pending price</SelectItem>
            <SelectItem value="priced">Firm price set</SelectItem>
            <SelectItem value="excluded">Excluded</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RiRefreshLine className={cn("w-4 h-4", loading && "animate-spin")} />
        </Button>
        <Button size="sm" onClick={() => setRequesting(true)}>
          <RiAddLine className="w-4 h-4 mr-1" /> Request walkthrough
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="p-10 text-center text-sm text-slate-500">
          Nothing here. Adding a site at or above the threshold opens a walkthrough automatically.
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => (
            <button key={r.id} onClick={() => setOpenId(r.id)}
              className={cn(
                "w-full text-left rounded-xl border bg-white px-4 py-3 transition-all hover:shadow-sm",
                r.stalled ? "border-rose-300 bg-rose-50/30"
                  : r.status === "conducted" ? "border-amber-200"
                  : r.status === "excluded" ? "border-rose-200 bg-rose-50/20"
                  : "border-slate-200 hover:border-violet-300",
              )}>
              <div className="flex flex-wrap items-center gap-2">
                <RiBuilding2Line className="w-4 h-4 text-violet-600" />
                <span className="font-semibold text-slate-900">
                  {r.business_name} — {r.site_nickname || "site"}
                </span>
                <Badge className={cn("border-0", STAGE_META[r.status]?.chip)}>
                  {STAGE_META[r.status]?.label || r.status}
                </Badge>
                {r.stalled && (
                  <Badge className="border-0 bg-rose-600 text-white">
                    STALLED · {r.business_days_pending_price}d no price
                  </Badge>
                )}
                {r.supersedes_walkthrough_id && (
                  <Badge variant="outline" className="text-[10px]">Re-walkthrough</Badge>
                )}
                {r.firm_price_cents ? (
                  <span className="text-xs font-semibold text-emerald-700">
                    {formatCents(r.firm_price_cents)}
                    {r.adjustment_pct ? ` (${r.adjustment_pct > 0 ? "+" : ""}${r.adjustment_pct}% vs anchor)` : ""}
                  </span>
                ) : null}
                <span className="text-xs text-slate-400 ml-auto">
                  {r.status === "scheduled" && r.scheduled_at
                    ? format(new Date(r.scheduled_at), "EEE MMM d, h:mm a")
                    : r.conducted_on
                      ? `conducted ${format(new Date(`${r.conducted_on}T12:00:00`), "MMM d")}`
                      : `requested ${format(new Date(r.requested_at), "MMM d")}`}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {r.confirmed_sqft
                  ? `${r.confirmed_sqft.toLocaleString()} sq ft confirmed${
                      r.client_stated_sqft && r.client_stated_sqft !== r.confirmed_sqft
                        ? ` (client said ${r.client_stated_sqft.toLocaleString()})` : ""}`
                  : r.client_stated_sqft ? `${r.client_stated_sqft.toLocaleString()} sq ft stated by client` : "size not captured"}
                {r.scope_level ? ` · ${r.scope_level} scope` : ""}
                {r.condition_level ? ` · ${r.condition_level} condition` : ""}
                {r.recommended_crew_size ? ` · crew of ${r.recommended_crew_size}` : ""}
                {r.photo_count ? ` · ${r.photo_count} photo${r.photo_count === 1 ? "" : "s"}` : ""}
                {r.conducted_by ? ` · ${r.conducted_by}` : ""}
              </p>
              {r.exclusion_note && (
                <p className="text-xs text-rose-700 mt-1">Excluded: {r.exclusion_note}</p>
              )}
            </button>
          ))}
        </div>
      )}

      {openId && <WalkthroughSheet id={openId} onClose={() => setOpenId(null)} reload={load} />}
      {requesting && <RequestSheet onClose={() => setRequesting(false)} reload={load} />}
    </div>
  );
}

function StageTile({ label, value, sub, tone }: {
  label: string; value: number; sub: string; tone: "slate" | "blue" | "amber" | "rose" | "emerald";
}) {
  const tones = {
    slate: "border-slate-200 bg-white text-slate-800",
    blue: "border-blue-200 bg-blue-50/60 text-blue-900",
    amber: "border-amber-200 bg-amber-50/60 text-amber-900",
    rose: "border-rose-200 bg-rose-50/60 text-rose-900",
    emerald: "border-emerald-200 bg-emerald-50/60 text-emerald-900",
  };
  return (
    <div className={cn("rounded-xl border p-3", tones[tone])}>
      <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-2xl font-bold leading-tight">{value}</p>
      <p className="text-[11px] opacity-70">{sub}</p>
    </div>
  );
}

// ─── Requesting one manually ───────────────────────────────────────────────

function RequestSheet({ onClose, reload }: { onClose: () => void; reload: () => Promise<void> }) {
  const [accounts, setAccounts] = useState<Array<{ id: string; business_name: string }>>([]);
  const [sites, setSites] = useState<Array<{ id: string; nickname: string; sqft: number | null; business_account_id: string }>>([]);
  const [accountId, setAccountId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [reason, setReason] = useState("manual");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const [a, s] = await Promise.all([
        (supabase.from as any)("business_accounts").select("id, business_name")
          .neq("status", "offboarded").order("business_name").limit(500),
        (supabase.from as any)("business_sites").select("id, nickname, sqft, business_account_id")
          .eq("active", true).order("nickname").limit(1000),
      ]);
      setAccounts(a.data || []);
      setSites(s.data || []);
    })();
  }, []);

  const accountSites = useMemo(
    () => sites.filter((s) => s.business_account_id === accountId),
    [sites, accountId],
  );

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Request a walkthrough</SheetTitle>
          <SheetDescription>
            Sites at or above the threshold get one automatically when they&apos;re added. Use this for a site whose
            condition or scope is being disputed, or for any site you want walked regardless of size.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-3">
          <div>
            <Label>Account *</Label>
            <Select value={accountId} onValueChange={(v) => { setAccountId(v); setSiteId(""); }}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Pick account…" /></SelectTrigger>
              <SelectContent>
                {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.business_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Site *</Label>
            <Select value={siteId} onValueChange={setSiteId} disabled={!accountId}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Pick site…" /></SelectTrigger>
              <SelectContent>
                {accountSites.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.nickname}{s.sqft ? ` · ${s.sqft.toLocaleString()} sqft` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Why</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Admin discretion</SelectItem>
                <SelectItem value="rate_dispute">Rate or scope disputed</SelectItem>
                <SelectItem value="condition_change">Condition materially changed</SelectItem>
                <SelectItem value="performance_variance">Chronic time or crew variance</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-lg border border-slate-200 p-3 space-y-2">
            <p className="text-xs font-bold text-slate-800">Who will provide access</p>
            <Input placeholder="Contact name" value={contactName} onChange={(e) => setContactName(e.target.value)} className="h-8 text-xs" />
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className="h-8 text-xs" />
              <Input placeholder="Email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className="h-8 text-xs" />
            </div>
          </div>
          <Button className="w-full" disabled={!siteId || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api("POST", {
                  action: "request", siteId, reason,
                  accessContactName: contactName, accessContactPhone: contactPhone, accessContactEmail: contactEmail,
                });
                toast.success("Walkthrough requested.");
                await reload();
                onClose();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Could not request a walkthrough");
              } finally {
                setBusy(false);
              }
            }}>
            {busy ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiAddLine className="w-4 h-4 mr-1.5" />}
            Request walkthrough
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── One walkthrough, through its stages ───────────────────────────────────

function WalkthroughSheet({ id, onClose, reload }: {
  id: string; onClose: () => void; reload: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [wt, setWt] = useState<Record<string, any> | null>(null);
  const [anchor, setAnchor] = useState<CommercialQuote | null>(null);
  const [history, setHistory] = useState<Array<Record<string, any>>>([]);
  const [exclusionCodes, setExclusionCodes] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    try {
      const out = await api("GET", undefined, `?id=${id}`);
      setWt(out.walkthrough as Record<string, any>);
      setAnchor((out.anchor as CommercialQuote) || null);
      setHistory((out.history || []) as Array<Record<string, any>>);
      setExclusionCodes((out.exclusionCodes || {}) as Record<string, string>);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load the walkthrough");
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => { void refresh(); }, [refresh]);

  const run = async (action: string, payload: Record<string, unknown>, success: string) => {
    setBusy(action);
    try {
      const out = await api("POST", { action, id, ...payload });
      toast.success(success);
      await refresh();
      await reload();
      return out;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
      return null;
    } finally {
      setBusy(null);
    }
  };

  if (loading || !wt) {
    return (
      <Sheet open onOpenChange={(o) => !o && onClose()}>
        <SheetContent className="w-full sm:max-w-2xl"><Skeleton className="h-40 w-full mt-8" /></SheetContent>
      </Sheet>
    );
  }

  const stage = String(wt.status) as Stage;

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <RiRulerLine className="w-5 h-5 text-violet-600" /> Walkthrough
            <Badge className={cn("border-0", STAGE_META[stage]?.chip)}>{STAGE_META[stage]?.label}</Badge>
          </SheetTitle>
          <SheetDescription>
            {wt.site_address || "No address recorded"}
            {wt.request_reason ? ` · opened as ${String(wt.request_reason).replace(/_/g, " ")}` : ""}
            {wt.supersedes_walkthrough_id ? " · re-walkthrough" : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <StageStrip stage={stage} />

          {wt.assignment_token ? (
            <a
              href={walkthroughStaffPath(String(wt.assignment_token))}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-violet-700 hover:underline"
            >
              Open onsite documentation
              <span className="text-[11px] font-normal text-slate-500">same token the walkthrough agent has — VA/admin can add to it</span>
            </a>
          ) : null}

          {stage === "excluded" ? (
            <div className="rounded-lg border-2 border-rose-300 bg-rose-50/60 p-3 space-y-1">
              <p className="text-sm font-bold text-rose-900 flex items-center gap-1.5">
                <RiErrorWarningLine className="w-4 h-4" />
                {exclusionCodes[String(wt.exclusion_code)] || wt.exclusion_code}
              </p>
              <p className="text-xs text-rose-800">{wt.exclusion_note}</p>
              <p className="text-[11px] text-rose-700">
                This is a stop, not a scope adjustment. The site is not serviceable and carries this reason; a QC issue
                was raised so it routes out the same way a cleaner&apos;s stop-and-report does.
              </p>
            </div>
          ) : null}

          {stage === "requested" && <ScheduleForm wt={wt} busy={busy} run={run} />}
          {stage === "scheduled" && (
            <>
              <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3 text-xs text-blue-900">
                <p className="font-semibold">
                  {wt.scheduled_at ? format(new Date(wt.scheduled_at), "EEEE d MMMM, h:mm a") : "Not scheduled"}
                  {wt.conducted_by ? ` · ${wt.conducted_by} conducting` : ""}
                </p>
                <p>
                  Access: {wt.access_contact_name || "no contact named"}
                  {wt.access_contact_phone ? ` · ${wt.access_contact_phone}` : ""}
                  {wt.client_access_confirmed ? " · confirmed" : " · NOT yet confirmed"}
                </p>
                <p className="text-[11px] text-blue-700 mt-1">
                  Both the conductor and the client contact are reminded ahead of the visit.
                </p>
              </div>
              <ConductForm wt={wt} busy={busy} run={run} exclusionCodes={exclusionCodes} />
            </>
          )}
          {(stage === "conducted" || stage === "priced") && (
            <>
              <FindingsSummary wt={wt} />
              <PriceForm wt={wt} anchor={anchor} busy={busy} run={run} stage={stage} />
              {stage === "conducted" && (
                <ExcludeForm busy={busy} run={run} exclusionCodes={exclusionCodes} />
              )}
            </>
          )}

          {history.length > 1 && (
            <div className="rounded-lg border border-slate-200 p-3 space-y-1">
              <p className="text-xs font-bold text-slate-800">This site&apos;s walkthrough history</p>
              {history.map((h) => (
                <p key={h.id} className={cn("text-[11px]", h.id === id ? "font-semibold text-slate-800" : "text-slate-500")}>
                  {format(new Date(h.requested_at), "MMM d, yyyy")} · {STAGE_META[h.status as Stage]?.label || h.status}
                  {h.sqft ? ` · ${Number(h.sqft).toLocaleString()} sq ft` : ""}
                  {h.firm_price_cents ? ` · ${formatCents(h.firm_price_cents)}` : ""}
                  {h.conducted_by ? ` · ${h.conducted_by}` : ""}
                  {h.exclusion_code ? ` · excluded (${h.exclusion_code.replace(/_/g, " ")})` : ""}
                </p>
              ))}
              <p className="text-[10px] text-slate-400">
                Prior walkthroughs are kept for comparison — a re-price is a change worth being able to explain.
              </p>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function StageStrip({ stage }: { stage: Stage }) {
  const order: Stage[] = ["requested", "scheduled", "conducted", "priced"];
  const idx = order.indexOf(stage);
  return (
    <div className="flex items-center gap-1">
      {order.map((st, i) => (
        <div key={st} className="flex items-center gap-1 flex-1">
          <div className={cn(
            "flex-1 rounded-full h-1.5",
            stage === "excluded" ? "bg-rose-300"
              : i <= idx ? "bg-violet-500" : "bg-slate-200",
          )} />
          <span className={cn(
            "text-[10px] whitespace-nowrap",
            i === idx ? "font-bold text-violet-700" : "text-slate-400",
          )}>
            {STAGE_META[st].label}
          </span>
        </div>
      ))}
    </div>
  );
}

function ScheduleForm({ wt, busy, run }: {
  wt: Record<string, any>;
  busy: string | null;
  run: (a: string, p: Record<string, unknown>, s: string) => Promise<Record<string, any> | null>;
}) {
  const [scheduledAt, setScheduledAt] = useState("");
  const [conductor, setConductor] = useState(wt.conducted_by || "");
  const [conductorPhone, setConductorPhone] = useState(wt.conductor_phone || "");
  const [contactName, setContactName] = useState(wt.access_contact_name || "");
  const [contactPhone, setContactPhone] = useState(wt.access_contact_phone || "");
  const [confirmed, setConfirmed] = useState(false);

  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-3 space-y-2">
      <p className="text-xs font-bold text-violet-900 flex items-center gap-1.5">
        <RiCalendarCheckLine className="w-3.5 h-3.5" /> Schedule the visit
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-[10px] text-slate-500">Date &amp; time *</Label>
          <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="h-8 text-xs mt-0.5" />
        </div>
        <div>
          <Label className="text-[10px] text-slate-500">Conducted by *</Label>
          <Input value={conductor} onChange={(e) => setConductor(e.target.value)} placeholder="Who is walking it" className="h-8 text-xs mt-0.5" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Input placeholder="Conductor phone" value={conductorPhone} onChange={(e) => setConductorPhone(e.target.value)} className="h-8 text-xs" />
        <Input placeholder="Client contact *" value={contactName} onChange={(e) => setContactName(e.target.value)} className="h-8 text-xs" />
        <Input placeholder="Contact phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className="h-8 text-xs" />
      </div>
      <label className="flex items-center gap-2 text-xs text-slate-700">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="rounded" />
        Client has confirmed access for this date
      </label>
      <p className="text-[10px] text-slate-500">
        Whoever conducts it is representing our pricing to the client. Both they and the client contact get a reminder
        ahead of the visit.
      </p>
      <Button size="sm" className="w-full h-8 text-xs" disabled={busy !== null || !scheduledAt || !conductor || !contactName}
        onClick={() => void run("schedule", {
          scheduledAt: new Date(scheduledAt).toISOString(),
          conductorName: conductor, conductorPhone,
          accessContactName: contactName, accessContactPhone: contactPhone,
          clientAccessConfirmed: confirmed,
        }, "Walkthrough scheduled.")}>
        {busy === "schedule" ? <RiLoader4Line className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
        Schedule
      </Button>
    </div>
  );
}

function ConductForm({ wt, busy, run, exclusionCodes }: {
  wt: Record<string, any>;
  busy: string | null;
  run: (a: string, p: Record<string, unknown>, s: string) => Promise<Record<string, any> | null>;
  exclusionCodes: Record<string, string>;
}) {
  const [f, setF] = useState<Record<string, any>>({
    confirmedSqft: wt.client_stated_sqft ? String(wt.client_stated_sqft) : "",
    facilityTypeKey: wt.facility_type_key || "",
    scopeLevel: wt.scope_level || "standard",
    conditionLevel: "",
    restroomCount: "", breakroomCount: "", floorCount: "",
    obstacleDensity: "", obstacles: "", floorTypes: "",
    badgeRequired: false, alarmCode: "", loadingDockNotes: "", afterHoursAccessNotes: "",
    securityContactName: "", securityContactPhone: "",
    serviceWindowStart: "", serviceWindowEnd: "", serviceWindowNotes: "",
    recommendedCrewSize: "", notes: "",
  });
  const [equipment, setEquipment] = useState<string[]>([]);
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [suggestion, setSuggestion] = useState<{ crewSize: number; rationale: string } | null>(null);
  const [showExclude, setShowExclude] = useState(false);

  const set = (k: string, v: unknown) => setF((prev) => ({ ...prev, [k]: v }));

  // Suggest the crew from confirmed square footage, depth, and the window
  // actually available, rather than asking someone to guess it on site.
  useEffect(() => {
    const sqft = Number(f.confirmedSqft);
    if (!sqft || !f.serviceWindowStart || !f.serviceWindowEnd) { setSuggestion(null); return; }
    const t = setTimeout(async () => {
      try {
        const out = await api("PUT", {
          confirmedSqft: sqft, scopeLevel: f.scopeLevel, facilityTypeKey: f.facilityTypeKey,
          serviceWindowStart: f.serviceWindowStart, serviceWindowEnd: f.serviceWindowEnd,
        });
        setSuggestion(out.crew || null);
        if (out.crew?.crewSize && !f.recommendedCrewSize) set("recommendedCrewSize", String(out.crew.crewSize));
      } catch { /* the field stays manual */ }
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.confirmedSqft, f.scopeLevel, f.facilityTypeKey, f.serviceWindowStart, f.serviceWindowEnd]);

  const uploadPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      const added: string[] = [];
      for (const file of Array.from(files).slice(0, 12)) {
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase().slice(0, 6);
        // Under walkthroughs/, not bookings/ — qc-retention-purge only sweeps
        // the latter, so these survive as the site's permanent baseline.
        const key = `walkthroughs/${wt.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(key, file, {
          cacheControl: "3600", contentType: file.type || "image/jpeg", upsert: false,
        });
        if (error) throw error;
        added.push(supabase.storage.from(PHOTO_BUCKET).getPublicUrl(key).data.publicUrl);
      }
      setPhotos((p) => [...p, ...added]);
      toast.success(`${added.length} photo${added.length === 1 ? "" : "s"} added.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Photo upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="rounded-lg border border-violet-200 p-3 space-y-3">
      <p className="text-xs font-bold text-violet-900">Findings — every field is required</p>
      <p className="text-[11px] text-slate-500">
        The price has to be traceable to specific inputs. A note saying it looked fine is not a walkthrough, and the
        record won&apos;t accept one.
      </p>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label className="text-[10px] text-slate-500">Confirmed sq ft *</Label>
          <Input type="number" value={f.confirmedSqft} onChange={(e) => set("confirmedSqft", e.target.value)} className="h-8 text-xs mt-0.5" />
          {wt.client_stated_sqft && Number(f.confirmedSqft) && Number(f.confirmedSqft) !== Number(wt.client_stated_sqft) && (
            <p className="text-[10px] text-amber-700 mt-0.5">
              Client said {Number(wt.client_stated_sqft).toLocaleString()} — yours is the number of record.
            </p>
          )}
        </div>
        <div>
          <Label className="text-[10px] text-slate-500">Facility type *</Label>
          <Select value={f.facilityTypeKey} onValueChange={(v) => set("facilityTypeKey", v)}>
            <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue placeholder="Confirm…" /></SelectTrigger>
            <SelectContent>
              {["office", "warehouse", "retail", "restaurant", "gym", "medical", "other"].map((k) => (
                <SelectItem key={k} value={k}>{k}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[10px] text-slate-500">Scope level *</Label>
          <Select value={f.scopeLevel} onValueChange={(v) => set("scopeLevel", v)}>
            <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="standard">Standard</SelectItem>
              <SelectItem value="detailed">Detailed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-[10px] text-slate-500">Condition *</Label>
          <Select value={f.conditionLevel} onValueChange={(v) => set("conditionLevel", v)}>
            <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue placeholder="Assess…" /></SelectTrigger>
            <SelectContent>
              {CONDITIONS.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[10px] text-slate-500">Obstacle density *</Label>
          <Select value={f.obstacleDensity} onValueChange={(v) => set("obstacleDensity", v)}>
            <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue placeholder="Assess…" /></SelectTrigger>
            <SelectContent>
              {DENSITIES.map((d) => <SelectItem key={d.id} value={d.id}>{d.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {[["restroomCount", "Restrooms *"], ["breakroomCount", "Breakrooms *"], ["floorCount", "Floors *"]].map(([k, label]) => (
          <div key={k}>
            <Label className="text-[10px] text-slate-500">{label}</Label>
            <Input type="number" min={0} value={f[k]} onChange={(e) => set(k, e.target.value)} className="h-8 text-xs mt-0.5" />
          </div>
        ))}
      </div>

      <div>
        <Label className="text-[10px] text-slate-500">Floor types *</Label>
        <Input value={f.floorTypes} onChange={(e) => set("floorTypes", e.target.value)}
          placeholder="Sealed concrete warehouse, VCT offices, tile restrooms" className="h-8 text-xs mt-0.5" />
      </div>
      <Textarea value={f.obstacles} onChange={(e) => set("obstacles", e.target.value)} rows={2} className="text-xs"
        placeholder="What actually costs labour beyond square footage — racking to 24ft, pallets staged in aisle 4, dense workstations…" />

      <div className="rounded-md border border-slate-200 p-2 space-y-2">
        <p className="text-[11px] font-semibold text-slate-700">Equipment this site needs</p>
        <div className="flex flex-wrap gap-1.5">
          {commercialEquipmentItems().map((item) => {
            const on = equipment.includes(item.id);
            return (
              <button key={item.id} type="button"
                onClick={() => setEquipment((p) => on ? p.filter((x) => x !== item.id) : [...p, item.id])}
                className={cn(
                  "px-2 py-1 rounded-full text-[11px] font-medium border",
                  on ? "bg-violet-600 text-white border-violet-600" : "bg-white text-slate-600 border-slate-200",
                )}>
                {item.label}
              </button>
            );
          })}
        </div>
        <p className="text-[10px] text-slate-400">
          Recorded on the site — dispatch puts contractors who have certified this equipment first when suggesting a crew.
        </p>
      </div>

      <div className="rounded-md border border-slate-200 p-2 space-y-2">
        <p className="text-[11px] font-semibold text-slate-700">Access &amp; security</p>
        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input type="checkbox" checked={f.badgeRequired} onChange={(e) => set("badgeRequired", e.target.checked)} className="rounded" />
          Badge or keycard required
        </label>
        <div className="grid grid-cols-3 gap-2">
          <Input placeholder="Alarm code" value={f.alarmCode} onChange={(e) => set("alarmCode", e.target.value)} className="h-8 text-xs font-mono" />
          <Input placeholder="Security contact" value={f.securityContactName} onChange={(e) => set("securityContactName", e.target.value)} className="h-8 text-xs" />
          <Input placeholder="Security phone" value={f.securityContactPhone} onChange={(e) => set("securityContactPhone", e.target.value)} className="h-8 text-xs" />
        </div>
        <Textarea placeholder="Loading dock procedure" value={f.loadingDockNotes} onChange={(e) => set("loadingDockNotes", e.target.value)} rows={2} className="text-xs" />
        <Textarea placeholder="After-hours building access" value={f.afterHoursAccessNotes} onChange={(e) => set("afterHoursAccessNotes", e.target.value)} rows={2} className="text-xs" />
        <p className="text-[10px] text-slate-400">
          These write through to the site, so the crew&apos;s portal shows them without anyone re-entering them per visit.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label className="text-[10px] text-slate-500">Window starts *</Label>
          <Input type="time" value={f.serviceWindowStart} onChange={(e) => set("serviceWindowStart", e.target.value)} className="h-8 text-xs mt-0.5" />
        </div>
        <div>
          <Label className="text-[10px] text-slate-500">Window ends *</Label>
          <Input type="time" value={f.serviceWindowEnd} onChange={(e) => set("serviceWindowEnd", e.target.value)} className="h-8 text-xs mt-0.5" />
        </div>
        <div>
          <Label className="text-[10px] text-slate-500">Crew size *</Label>
          <Input type="number" min={1} value={f.recommendedCrewSize} onChange={(e) => set("recommendedCrewSize", e.target.value)} className="h-8 text-xs mt-0.5" />
        </div>
      </div>
      {suggestion && (
        <p className="text-[11px] text-violet-700">Suggested: {suggestion.crewSize}. {suggestion.rationale}</p>
      )}
      <Input placeholder="Service window constraints (what hours the site is realistically available)"
        value={f.serviceWindowNotes} onChange={(e) => set("serviceWindowNotes", e.target.value)} className="h-8 text-xs" />

      <div className="rounded-md border border-dashed border-slate-300 p-2 space-y-1.5">
        <p className="text-[11px] font-semibold text-slate-700 flex items-center gap-1.5">
          <RiCameraLine className="w-3.5 h-3.5 text-violet-600" /> Condition photos * ({photos.length})
        </p>
        <input type="file" accept="image/*" multiple capture="environment"
          onChange={(e) => void uploadPhotos(e.target.files)}
          className="block w-full text-xs file:mr-2 file:rounded-md file:border-0 file:bg-violet-600 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-white" />
        {uploading && <p className="text-[11px] text-slate-500">Uploading…</p>}
        <p className="text-[10px] text-slate-400">
          Kept permanently on the site as the baseline for what &ldquo;clean&rdquo; looks like here, not discarded after
          pricing.
        </p>
      </div>

      <Textarea placeholder="Anything else worth recording" value={f.notes} onChange={(e) => set("notes", e.target.value)} rows={2} className="text-xs" />

      <Button size="sm" className="w-full h-8 text-xs" disabled={busy !== null}
        onClick={() => void run("conduct", { ...f, requiredEquipment: equipment, photos }, "Findings recorded — set the firm price next.")}>
        {busy === "conduct" ? <RiLoader4Line className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RiCheckboxCircleFill className="w-3.5 h-3.5 mr-1.5" />}
        Record findings
      </Button>

      <div className="border-t border-slate-200 pt-2">
        <Button size="sm" variant="ghost" className="h-7 text-[11px] text-rose-600 w-full"
          onClick={() => setShowExclude((v) => !v)}>
          {showExclude ? "Cancel" : "Found something we don't service?"}
        </Button>
        {showExclude && <ExcludeForm busy={busy} run={run} exclusionCodes={exclusionCodes} />}
      </div>
    </div>
  );
}

function FindingsSummary({ wt }: { wt: Record<string, any> }) {
  const rows: Array<[string, React.ReactNode]> = [
    ["Confirmed size", wt.sqft ? `${Number(wt.sqft).toLocaleString()} sq ft${
      wt.client_stated_sqft && Number(wt.client_stated_sqft) !== Number(wt.sqft)
        ? ` (client stated ${Number(wt.client_stated_sqft).toLocaleString()})` : ""}` : "—"],
    ["Facility / scope", `${wt.facility_type_key || "—"} · ${wt.scope_level || "—"}`],
    ["Condition", wt.condition_level || "—"],
    ["Counts", `${wt.restroom_count ?? "—"} restrooms · ${wt.breakroom_count ?? "—"} breakrooms · ${wt.floor_count ?? "—"} floors`],
    ["Obstacles", `${wt.obstacle_density || "—"}${wt.obstacles ? ` — ${wt.obstacles}` : ""}`],
    ["Floors", wt.floor_types || "—"],
    ["Service window", wt.service_window_start && wt.service_window_end
      ? `${String(wt.service_window_start).slice(0, 5)}–${String(wt.service_window_end).slice(0, 5)}${wt.service_window_notes ? ` · ${wt.service_window_notes}` : ""}`
      : "—"],
    ["Equipment", Array.isArray(wt.required_equipment) && wt.required_equipment.length
      ? wt.required_equipment.map((e: string) => commercialEquipmentLabel(e)).join(", ")
      : "nothing specialised"],
    ["Access", [
      wt.badge_required ? "badge required" : null,
      wt.alarm_code ? "alarm code on file" : null,
      wt.loading_dock_notes ? "dock procedure" : null,
      wt.after_hours_access_notes ? "after-hours access" : null,
    ].filter(Boolean).join(" · ") || "—"],
    ["Crew", wt.recommended_crew_size ? `${wt.recommended_crew_size} recommended` : "—"],
    ["Conducted", wt.conducted_on
      ? `${format(new Date(`${wt.conducted_on}T12:00:00`), "MMM d, yyyy")} by ${wt.conducted_by || "unknown"}`
      : "—"],
  ];
  const photos: string[] = Array.isArray(wt.photos) ? wt.photos : [];

  return (
    <div className="rounded-lg border border-slate-200 p-3 space-y-1">
      <p className="text-xs font-bold text-slate-800">Findings</p>
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-start justify-between gap-3 text-[11px] py-0.5 border-b border-slate-100 last:border-0">
          <span className="text-slate-500 shrink-0">{k}</span>
          <span className="text-slate-800 text-right">{v}</span>
        </div>
      ))}
      {photos.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-2">
          {photos.map((p) => (
            <a key={p} href={p} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p} alt="Site condition at walkthrough" className="w-16 h-16 object-cover rounded-md border border-slate-200" />
            </a>
          ))}
        </div>
      )}
      {wt.notes && <p className="text-[11px] text-slate-600 pt-1">{wt.notes}</p>}
    </div>
  );
}

function PriceForm({ wt, anchor, busy, run, stage }: {
  wt: Record<string, any>;
  anchor: CommercialQuote | null;
  busy: string | null;
  run: (a: string, p: Record<string, unknown>, s: string) => Promise<Record<string, any> | null>;
  stage: Stage;
}) {
  const anchorCents = anchor?.ok ? anchor.formulaCents : null;
  const [price, setPrice] = useState(
    wt.firm_price_cents ? (Number(wt.firm_price_cents) / 100).toFixed(2)
      : anchorCents ? (anchorCents / 100).toFixed(2) : "",
  );
  const [reason, setReason] = useState(wt.price_adjustment_reason || "");
  const cents = Math.round((parseFloat(price) || 0) * 100);
  const off = anchorCents != null && cents > 0 && cents !== anchorCents;
  const delta = anchorCents != null ? cents - anchorCents : 0;

  return (
    <div className={cn(
      "rounded-lg border-2 p-3 space-y-2",
      stage === "priced" ? "border-emerald-200 bg-emerald-50/40" : "border-violet-200 bg-violet-50/40",
    )}>
      <p className="text-xs font-bold text-violet-900">
        {stage === "priced" ? "Firm price" : "Set the firm price"}
      </p>

      {anchor?.ok && anchor.breakdown ? (
        <div className="rounded-md bg-white border border-slate-200 p-2 text-[11px] text-slate-600 space-y-0.5">
          <p className="font-semibold text-slate-800">Formula anchor {formatCents(anchor.formulaCents)}</p>
          <p>
            {anchor.breakdown.sqft.toLocaleString()} sq ft × ${(anchor.breakdown.base_rate_cents_per_sqft / 100).toFixed(2)}/sqft
            ({anchor.breakdown.facility_type_label}) × {anchor.breakdown.scope_multiplier.toFixed(2)} ({anchor.breakdown.scope_label})
            × {anchor.breakdown.size_tier_multiplier.toFixed(2)} ({anchor.breakdown.size_tier_label})
          </p>
          <p className="text-slate-500">
            A starting point from the confirmed findings, not the answer. Adjust it for what you actually saw.
          </p>
        </div>
      ) : (
        <p className="text-[11px] text-amber-700">
          The formula can&apos;t produce an anchor from these findings — price it from what was recorded.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-[10px] text-slate-500">Firm price ($) *</Label>
          <Input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} className="h-8 text-xs mt-0.5 bg-white" />
        </div>
        <div>
          <Label className="text-[10px] text-slate-500">Crew size</Label>
          <Input type="number" min={1} defaultValue={wt.recommended_crew_size || ""} disabled className="h-8 text-xs mt-0.5" />
        </div>
      </div>

      {off && (
        <div className="space-y-1">
          <Label className="text-[10px] text-amber-800">
            {delta > 0 ? "Above" : "Below"} the anchor by {formatCents(Math.abs(delta))} — why? *
          </Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="text-xs bg-white"
            placeholder="Racking density and 6 restrooms put real labour well above the open-floor assumption in the size tier." />
          <p className="text-[10px] text-slate-500">
            Logged on the record. This is what makes the rate defensible when someone asks about it in six months.
          </p>
        </div>
      )}

      <Button size="sm" className="w-full h-8 text-xs" disabled={busy !== null || cents <= 0 || (off && reason.trim().length < 10)}
        onClick={() => void run("set_price", { firmPriceCents: cents, adjustmentReason: reason },
          "Firm price set — the site is now eligible for booking, subject to the account's COI and agreement.")}>
        {busy === "set_price" ? <RiLoader4Line className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RiCheckboxCircleFill className="w-3.5 h-3.5 mr-1.5" />}
        {stage === "priced" ? "Update firm price" : "Set firm price"}
      </Button>

      {stage === "priced" && (
        <p className="text-[11px] text-emerald-800">
          Written to the site along with the confirmed square footage, scope, crew, access, window, and equipment. This
          is the rate that appears in Exhibit A and what a booking prices at.
        </p>
      )}
    </div>
  );
}

function ExcludeForm({ busy, run, exclusionCodes }: {
  busy: string | null;
  run: (a: string, p: Record<string, unknown>, s: string) => Promise<Record<string, any> | null>;
  exclusionCodes: Record<string, string>;
}) {
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  return (
    <div className="rounded-lg border border-rose-300 bg-rose-50/50 p-3 space-y-2 mt-2">
      <p className="text-xs font-bold text-rose-900">Condition outside our scope</p>
      <p className="text-[11px] text-rose-800">
        This stops the pipeline. No price is produced, the site is marked not serviceable with the reason, and it routes
        out through the same QC handling as a cleaner&apos;s stop-and-report. It is not a scope adjustment.
      </p>
      <Select value={code} onValueChange={setCode}>
        <SelectTrigger className="h-8 text-xs bg-white"><SelectValue placeholder="What was found…" /></SelectTrigger>
        <SelectContent>
          {Object.entries(exclusionCodes).map(([k, label]) => (
            <SelectItem key={k} value={k}>{label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="text-xs bg-white"
        placeholder="Roughly 60 sq ft of mold on porous drywall along the north wall, with a hidden-source odour." />
      <Button size="sm" variant="outline" className="w-full h-8 text-xs border-rose-400 text-rose-700"
        disabled={busy !== null || !code || note.trim().length < 10}
        onClick={() => void run("exclude", { exclusionCode: code, exclusionNote: note },
          "Recorded — pricing stopped and a QC issue raised.")}>
        {busy === "exclude" ? <RiLoader4Line className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RiErrorWarningLine className="w-3.5 h-3.5 mr-1.5" />}
        Stop — route this out
      </Button>
    </div>
  );
}
