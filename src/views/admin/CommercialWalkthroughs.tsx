"use client";

// ─── Commercial walkthroughs — Partnerships Hub tab ────────────────────────
//
// Its own step in the flow, not a note field on a booking.
//
// A 1,800 sqft office suite is quotable from a desk. A 30,000 sqft warehouse
// is not: racking, dock areas, floor type, restroom count and existing
// condition swing the real cost far enough that guessing is expensive in both
// directions. So facilities at or above the threshold get a scheduled
// walkthrough, structured findings from whoever conducted it, and a FIRM price
// set by a human from what they saw.
//
// The formula is shown while pricing — as an anchor to argue with, never as
// the answer. Until a completed walkthrough with a firm price exists for a
// site, that site's bookings are blocked server-side in book-partner-job.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RiAddLine,
  RiBuilding2Line,
  RiCheckboxCircleFill,
  RiErrorWarningLine,
  RiLoader4Line,
  RiRefreshLine,
  RiSearch2Line,
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
import { useCommercialQuote } from "@/hooks/use-commercial-quote";
import { formatCents } from "@/lib/commercial-pricing";
import { cn } from "@/lib/utils";

interface WalkthroughRow {
  id: string;
  business_account_id: string;
  business_site_id: string;
  status: string;
  scheduled_for: string | null;
  conducted_on: string | null;
  conducted_by: string | null;
  facility_type_key: string | null;
  scope_level: string | null;
  sqft: number | null;
  condition_level: string | null;
  obstacles: string | null;
  special_equipment: string | null;
  restroom_count: number | null;
  breakroom_count: number | null;
  floor_types: string | null;
  security_complexity: string | null;
  notes: string | null;
  formula_price_cents: number | null;
  estimate_low_cents: number | null;
  estimate_high_cents: number | null;
  firm_price_cents: number | null;
  recommended_crew_size: number | null;
  created_at: string;
}

interface AccountOpt { id: string; business_name: string }
interface SiteOpt {
  id: string;
  business_account_id: string;
  nickname: string;
  sqft: number | null;
  facility_type_key: string | null;
  scope_level: string | null;
}

const STATUS_STYLE: Record<string, string> = {
  scheduled: "bg-amber-100 text-amber-700",
  completed: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-slate-100 text-slate-500",
};

const CONDITIONS = [
  { id: "good", label: "Good — maintained, no backlog" },
  { id: "average", label: "Average — normal wear" },
  { id: "poor", label: "Poor — visible backlog, extra first visit" },
  { id: "severe", label: "Severe — needs a restoration pass first" },
];

export default function CommercialWalkthroughs() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<WalkthroughRow[]>([]);
  const [accounts, setAccounts] = useState<AccountOpt[]>([]);
  const [sites, setSites] = useState<SiteOpt[]>([]);
  const [statusFilter, setStatusFilter] = useState("open");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Partial<WalkthroughRow> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [wRes, aRes, sRes] = await Promise.all([
        (supabase.from as any)("commercial_walkthroughs").select("*")
          .order("created_at", { ascending: false }).limit(300),
        (supabase.from as any)("business_accounts").select("id, business_name")
          .neq("status", "offboarded").order("business_name").limit(500),
        (supabase.from as any)("business_sites")
          .select("id, business_account_id, nickname, sqft, facility_type_key, scope_level")
          .eq("active", true).order("nickname").limit(1000),
      ]);
      if (wRes.error) throw wRes.error;
      setRows((wRes.data || []) as WalkthroughRow[]);
      setAccounts((aRes.data || []) as AccountOpt[]);
      setSites((sRes.data || []) as SiteOpt[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load walkthroughs");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const accountName = useMemo(
    () => new Map(accounts.map((a) => [a.id, a.business_name])),
    [accounts],
  );
  const siteName = useMemo(() => new Map(sites.map((s) => [s.id, s.nickname])), [sites]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (statusFilter === "open" && r.status !== "scheduled") return false;
    if (statusFilter !== "open" && statusFilter !== "all" && r.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const hay = `${accountName.get(r.business_account_id) || ""} ${siteName.get(r.business_site_id) || ""} ${r.conducted_by || ""}`;
      if (!hay.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [rows, statusFilter, search, accountName, siteName]);

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs text-slate-600">
        Facilities at or above the walkthrough threshold can&apos;t be firm-quoted from a desk. Schedule the visit here,
        record what was actually found, and set the price from those findings — the formula is shown as an anchor to
        price against. Until a site has a completed walkthrough with a firm price, its bookings are blocked.
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <RiSearch2Line className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input placeholder="Search account, site, or who conducted it…" value={search}
            onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Scheduled — not yet done</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RiRefreshLine className={cn("w-4 h-4", loading && "animate-spin")} />
        </Button>
        <Button size="sm" onClick={() => setEditing({ status: "scheduled" })}>
          <RiAddLine className="w-4 h-4 mr-1" /> Schedule walkthrough
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="p-10 text-center text-sm text-slate-500">
          Nothing here. Schedule a walkthrough for any site at or above the threshold before trying to book it.
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => (
            <button key={r.id} onClick={() => setEditing(r)}
              className="w-full text-left rounded-xl border border-slate-200 bg-white px-4 py-3 hover:border-violet-300 hover:shadow-sm transition-all">
              <div className="flex flex-wrap items-center gap-2">
                <RiBuilding2Line className="w-4 h-4 text-violet-600" />
                <span className="font-semibold text-slate-900">
                  {accountName.get(r.business_account_id) || "Account"} — {siteName.get(r.business_site_id) || "Site"}
                </span>
                <Badge className={cn("border-0", STATUS_STYLE[r.status] || "bg-slate-100")}>{r.status}</Badge>
                {r.sqft ? <span className="text-xs text-slate-500">{r.sqft.toLocaleString()} sqft</span> : null}
                {r.firm_price_cents ? (
                  <span className="text-xs font-semibold text-emerald-700">
                    Firm {formatCents(r.firm_price_cents)}
                  </span>
                ) : r.estimate_low_cents ? (
                  <span className="text-xs text-amber-700">
                    Est {formatCents(r.estimate_low_cents)}–{formatCents(r.estimate_high_cents || 0)}
                  </span>
                ) : null}
                <span className="text-xs text-slate-400 ml-auto">
                  {r.conducted_on
                    ? `conducted ${format(new Date(`${r.conducted_on}T12:00:00`), "MMM d, yyyy")}`
                    : r.scheduled_for
                      ? `scheduled ${format(new Date(`${r.scheduled_for}T12:00:00`), "MMM d, yyyy")}`
                      : ""}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {r.scope_level || "—"} scope · {r.condition_level || "condition not recorded"}
                {r.conducted_by ? ` · by ${r.conducted_by}` : ""}
                {r.restroom_count != null ? ` · ${r.restroom_count} restrooms` : ""}
              </p>
            </button>
          ))}
        </div>
      )}

      {editing && (
        <WalkthroughSheet
          walkthrough={editing}
          accounts={accounts}
          sites={sites}
          onClose={() => setEditing(null)}
          reload={load}
        />
      )}
    </div>
  );
}

function WalkthroughSheet({
  walkthrough, accounts, sites, onClose, reload,
}: {
  walkthrough: Partial<WalkthroughRow>;
  accounts: AccountOpt[];
  sites: SiteOpt[];
  onClose: () => void;
  reload: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [accountId, setAccountId] = useState(walkthrough.business_account_id || "");
  const [siteId, setSiteId] = useState(walkthrough.business_site_id || "");
  const [status, setStatus] = useState(walkthrough.status || "scheduled");
  const [scheduledFor, setScheduledFor] = useState(walkthrough.scheduled_for || "");
  const [conductedOn, setConductedOn] = useState(walkthrough.conducted_on || "");
  const [conductedBy, setConductedBy] = useState(walkthrough.conducted_by || "");
  const [facilityTypeKey, setFacilityTypeKey] = useState(walkthrough.facility_type_key || "");
  const [scopeLevel, setScopeLevel] = useState(walkthrough.scope_level || "standard");
  const [sqftInput, setSqftInput] = useState(walkthrough.sqft != null ? String(walkthrough.sqft) : "");
  const [condition, setCondition] = useState(walkthrough.condition_level || "");
  const [obstacles, setObstacles] = useState(walkthrough.obstacles || "");
  const [equipment, setEquipment] = useState(walkthrough.special_equipment || "");
  const [restrooms, setRestrooms] = useState(walkthrough.restroom_count != null ? String(walkthrough.restroom_count) : "");
  const [breakrooms, setBreakrooms] = useState(walkthrough.breakroom_count != null ? String(walkthrough.breakroom_count) : "");
  const [floorTypes, setFloorTypes] = useState(walkthrough.floor_types || "");
  const [security, setSecurity] = useState(walkthrough.security_complexity || "");
  const [notes, setNotes] = useState(walkthrough.notes || "");
  const [firmPrice, setFirmPrice] = useState(
    walkthrough.firm_price_cents != null ? (walkthrough.firm_price_cents / 100).toFixed(2) : "",
  );

  const accountSites = useMemo(
    () => sites.filter((s) => s.business_account_id === accountId),
    [sites, accountId],
  );

  // Prefill from the site when a new walkthrough is being scheduled.
  useEffect(() => {
    const site = sites.find((s) => s.id === siteId);
    if (!site) return;
    if (!sqftInput && site.sqft != null) setSqftInput(String(site.sqft));
    if (!facilityTypeKey && site.facility_type_key) setFacilityTypeKey(site.facility_type_key);
    if (site.scope_level && scopeLevel === "standard") setScopeLevel(site.scope_level);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, sites]);

  const sqft = Math.max(0, Math.round(parseFloat(sqftInput) || 0));
  const { quote, config, loading: quoting } = useCommercialQuote({
    sqft,
    facilityTypeKey,
    scopeLevel,
    businessAccountId: accountId || null,
    businessSiteId: siteId || null,
    enabled: sqft > 0 && Boolean(facilityTypeKey),
  });

  const firmPriceCents = Math.round((parseFloat(firmPrice) || 0) * 100);
  const canComplete = Boolean(conductedOn) && firmPriceCents > 0;

  const save = async () => {
    if (!accountId || !siteId) { toast.error("Pick the account and the site."); return; }
    if (status === "completed" && !canComplete) {
      toast.error("A completed walkthrough needs the date it was conducted and a firm price — that's the whole point of the step.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        business_account_id: accountId,
        business_site_id: siteId,
        status,
        scheduled_for: scheduledFor || null,
        conducted_on: conductedOn || null,
        conducted_by: conductedBy || null,
        facility_type_key: facilityTypeKey || null,
        scope_level: scopeLevel || null,
        sqft: sqft > 0 ? sqft : null,
        condition_level: condition || null,
        obstacles: obstacles || null,
        special_equipment: equipment || null,
        restroom_count: restrooms ? Number(restrooms) : null,
        breakroom_count: breakrooms ? Number(breakrooms) : null,
        floor_types: floorTypes || null,
        security_complexity: security || null,
        notes: notes || null,
        formula_price_cents: quote?.ok ? quote.formulaCents : null,
        estimate_low_cents: quote?.ok ? quote.estimateLowCents : null,
        estimate_high_cents: quote?.ok ? quote.estimateHighCents : null,
        firm_price_cents: firmPriceCents > 0 ? firmPriceCents : null,
        recommended_crew_size: quote?.crew?.crewSize ?? null,
        updated_at: new Date().toISOString(),
      };
      const { error } = walkthrough.id
        ? await (supabase.from as any)("commercial_walkthroughs").update(payload).eq("id", walkthrough.id)
        : await (supabase.from as any)("commercial_walkthroughs").insert(payload);
      if (error) throw error;
      toast.success(
        status === "completed"
          ? "Walkthrough completed — this site can now be booked at the firm price."
          : "Walkthrough saved.",
      );
      await reload();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <RiBuilding2Line className="w-5 h-5 text-violet-600" />
            {walkthrough.id ? "Walkthrough" : "Schedule a walkthrough"}
          </SheetTitle>
          <SheetDescription>
            Capture what the building is actually like, then set the price from it. The formula stays visible as an
            anchor — it is not the answer at this size.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
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
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="scheduled">Scheduled</SelectItem>
                  <SelectItem value="completed" disabled={!canComplete}>
                    Completed{!canComplete ? " (needs date + firm price)" : ""}
                  </SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Scheduled for</Label>
              <Input type="date" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Conducted on</Label>
              <Input type="date" value={conductedOn} onChange={(e) => setConductedOn(e.target.value)} className="mt-1" />
            </div>
          </div>

          <div>
            <Label>Conducted by</Label>
            <Input value={conductedBy} onChange={(e) => setConductedBy(e.target.value)}
              placeholder="Who walked the building" className="mt-1" />
          </div>

          {/* Pricing inputs — same three the formula uses. */}
          <div className="rounded-lg border border-slate-200 p-3 space-y-3">
            <p className="text-xs font-bold text-slate-800">Facility &amp; scope</p>
            <div className="grid grid-cols-3 gap-2">
              <Select value={facilityTypeKey} onValueChange={setFacilityTypeKey}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Facility type" /></SelectTrigger>
                <SelectContent>
                  {(config?.facilityTypes || []).map((f) => (
                    <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={scopeLevel} onValueChange={setScopeLevel}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Scope level" /></SelectTrigger>
                <SelectContent>
                  {(config?.scopeLevels || []).map((s) => (
                    <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input type="number" min={0} step={100} value={sqftInput}
                onChange={(e) => setSqftInput(e.target.value)} placeholder="Sq ft" className="h-8 text-xs" />
            </div>
            {quoting ? (
              <p className="text-xs text-slate-500 flex items-center gap-1.5">
                <RiLoader4Line className="w-3.5 h-3.5 animate-spin" /> Pricing anchor…
              </p>
            ) : quote?.ok && quote.breakdown ? (
              <div className="rounded-md bg-slate-50 border border-slate-200 p-2 text-xs text-slate-600 space-y-0.5">
                <p>
                  <span className="font-semibold">Formula anchor {formatCents(quote.formulaCents)}</span>
                  {" · "}estimate {formatCents(quote.estimateLowCents)}–{formatCents(quote.estimateHighCents)}
                </p>
                <p className="text-slate-500">
                  {quote.breakdown.sqft.toLocaleString()} sq ft × ${(quote.breakdown.base_rate_cents_per_sqft / 100).toFixed(2)}/sqft
                  × {quote.breakdown.scope_multiplier.toFixed(2)} × {quote.breakdown.size_tier_multiplier.toFixed(2)}
                </p>
                {quote.crew && <p className="text-slate-500">Suggested crew: {quote.crew.crewSize}</p>}
              </div>
            ) : null}
          </div>

          {/* Findings — the variables that make a big facility unquotable. */}
          <div className="rounded-lg border border-slate-200 p-3 space-y-3">
            <p className="text-xs font-bold text-slate-800">What was actually found</p>
            <div>
              <Label className="text-xs">Existing condition</Label>
              <Select value={condition} onValueChange={setCondition}>
                <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue placeholder="Pick condition…" /></SelectTrigger>
                <SelectContent>
                  {CONDITIONS.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Restrooms</Label>
                <Input type="number" min={0} value={restrooms} onChange={(e) => setRestrooms(e.target.value)} className="mt-1 h-8 text-xs" />
              </div>
              <div>
                <Label className="text-xs">Breakrooms / kitchens</Label>
                <Input type="number" min={0} value={breakrooms} onChange={(e) => setBreakrooms(e.target.value)} className="mt-1 h-8 text-xs" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Floor types</Label>
              <Input value={floorTypes} onChange={(e) => setFloorTypes(e.target.value)}
                placeholder="Sealed concrete warehouse, VCT in offices, tile restrooms…" className="mt-1 h-8 text-xs" />
            </div>
            <div>
              <Label className="text-xs">Obstacles</Label>
              <Textarea value={obstacles} onChange={(e) => setObstacles(e.target.value)} rows={2} className="mt-1 text-xs"
                placeholder="Racking to 24ft, pallets staged in aisle 4, active line until 11pm…" />
            </div>
            <div>
              <Label className="text-xs">Special equipment needed</Label>
              <Textarea value={equipment} onChange={(e) => setEquipment(e.target.value)} rows={2} className="mt-1 text-xs"
                placeholder="Ride-on scrubber, lift for high dusting, wet-vac for dock…" />
            </div>
            <div>
              <Label className="text-xs">Security / access complexity</Label>
              <Textarea value={security} onChange={(e) => setSecurity(e.target.value)} rows={2} className="mt-1 text-xs"
                placeholder="Badge per crew member, guard escort after 10pm, dock door code rotates weekly…" />
            </div>
            <div>
              <Label className="text-xs">Notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="mt-1 text-xs" />
            </div>
          </div>

          {/* The number this whole step exists to produce. */}
          <div className="rounded-lg border-2 border-violet-200 bg-violet-50/50 p-3 space-y-2">
            <Label className="text-xs font-bold text-violet-900">Firm price from these findings ($) *</Label>
            <Input type="number" min={0} value={firmPrice} onChange={(e) => setFirmPrice(e.target.value)}
              className="bg-white" placeholder={quote?.ok ? (quote.formulaCents / 100).toFixed(2) : ""} />
            {quote?.ok && firmPriceCents > 0 && (
              <p className="text-[11px] text-slate-600">
                {firmPriceCents === quote.formulaCents
                  ? "Matches the formula anchor."
                  : `${firmPriceCents > quote.formulaCents ? "Above" : "Below"} the anchor by ${formatCents(Math.abs(firmPriceCents - quote.formulaCents))} — record why in the findings above.`}
              </p>
            )}
            <p className="text-[11px] text-violet-700 flex items-start gap-1">
              <RiErrorWarningLine className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              This is what bookings for this site will price at. Nothing at or above the threshold books without it.
            </p>
            <p className="text-[11px] text-slate-500">
              A walkthrough can be scheduled and conducted whatever the account&apos;s paperwork says — surveying a
              building doesn&apos;t need cover. Converting this price into a confirmed, dispatchable booking does: if
              the account&apos;s certificate of insurance has lapsed, the booking is refused until it&apos;s renewed.
            </p>
          </div>

          <Button className="w-full" onClick={() => void save()} disabled={saving}>
            {saving ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiCheckboxCircleFill className="w-4 h-4 mr-1.5" />}
            Save walkthrough
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
