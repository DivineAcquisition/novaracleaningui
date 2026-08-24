"use client";

// ─── Partnerships Hub — internal booking (Commercial · Office · STR) ─────────
//
// One structured flow, mirroring the residential internal booking: pick the
// type, pick the client/location, then capture the shared spine —
// who / when (+ hard deadline) / where + ACCESS / scope / crew / locked pay /
// special instructions / payment status. Type-specific vitals appear only for
// that type. The booking is the single source of truth: the assigned
// cleaner's portal reflects it immediately, with pay locked at booking.
//
// Hard gates (also enforced server-side in book-partner-job):
//   access method + scope + (deadline or window) — no exceptions.
//
// Commercial and office add the ones that only matter at this size:
//   • the job belongs to a SITE under the account, never a loose address
//   • the account's paperwork is current — signed agreement + live COI, and a
//     gap on the account blocks every site under it
//   • the price comes from facility type × scope level × size tier, and at or
//     above the walkthrough threshold it comes from a walkthrough instead
//   • the crew is sized to the scope and the hours actually available

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RiAlarmWarningLine,
  RiBuilding2Line,
  RiBuilding4Line,
  RiCalendarCheckLine,
  RiCheckboxCircleFill,
  RiErrorWarningLine,
  RiHomeSmile2Line,
  RiKey2Line,
  RiLoader4Line,
  RiMoneyDollarCircleLine,
  RiRepeatLine,
  RiRulerLine,
  RiSearchLine,
  RiShieldCheckLine,
  RiTeamLine,
} from "@remixicon/react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCommercialQuote } from "@/hooks/use-commercial-quote";
import { formatCents, windowHoursBetween } from "@/lib/commercial-pricing";
import { cn } from "@/lib/utils";

type BookingType = "commercial" | "office" | "str_turnover";

const TYPES: Array<{ id: BookingType; label: string; sub: string; icon: typeof RiBuilding2Line }> = [
  { id: "commercial", label: "Commercial", sub: "Account + site · service window · scope", icon: RiBuilding2Line },
  { id: "office", label: "Office", sub: "Commercial + after-hours/security rules", icon: RiBuilding4Line },
  { id: "str_turnover", label: "STR / Airbnb turnover", sub: "Property · checkout → next check-in", icon: RiHomeSmile2Line },
];

const ACCESS_METHODS = ["Lockbox", "Smart lock", "Key under mat / hidden", "On-site contact meets crew", "Building check-in / badge", "Door code", "Other (see notes)"];
const PAYMENT_STATUSES = [
  { id: "paid", label: "Paid — nothing to collect" },
  { id: "card_on_file", label: "Card on file — charge after service" },
  { id: "invoice", label: "Invoice — billed per agreement" },
  { id: "unpaid", label: "Unpaid — needs payment before dispatch" },
];
const WINDOWS = ["8:00 AM - 12:00 PM", "10:00 AM - 2:00 PM", "12:00 PM - 4:00 PM", "After 6 PM", "After close of business", "Overnight", "Anytime"];

interface AccountOpt { id: string; business_name: string; account_type: string; status: string; email: string | null; facility_type: string | null }
interface SiteOpt {
  id: string;
  nickname: string;
  address: string | null;
  facility_type: string | null;
  facility_type_key: string | null;
  scope_level: string | null;
  sqft: number | null;
  service_window_start: string | null;
  service_window_end: string | null;
  access_method: string | null;
  access_instructions: string | null;
  scope_notes: string | null;
  badge_required: boolean | null;
  security_contact_name: string | null;
  loading_dock_notes: string | null;
}
interface PropertyOpt { id: string; nickname: string | null; address: string | null; turnover_price: number | null; host_id: string; host_name?: string }
interface CleanerOpt { id: string; first_name: string | null; last_name: string | null; pay_percentage: number | null }

export default function PartnershipBooking() {
  const [type, setType] = useState<BookingType | null>(null);

  // Client / location
  const [accounts, setAccounts] = useState<AccountOpt[]>([]);
  const [accountId, setAccountId] = useState("");
  const [sites, setSites] = useState<SiteOpt[]>([]);
  const [siteId, setSiteId] = useState("");
  const [properties, setProperties] = useState<PropertyOpt[]>([]);
  const [propertyId, setPropertyId] = useState("");
  const [clientSearch, setClientSearch] = useState("");

  // When
  const [serviceDate, setServiceDate] = useState("");
  const [window_, setWindow] = useState("");
  const [hardDeadline, setHardDeadline] = useState("");
  const [checkoutTime, setCheckoutTime] = useState("");

  // Access
  const [accessMethod, setAccessMethod] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [accessNotes, setAccessNotes] = useState("");

  // Scope
  const [scopeNotes, setScopeNotes] = useState("");
  const [specialInstructions, setSpecialInstructions] = useState("");

  // Type-specific
  const [linenNotes, setLinenNotes] = useState("");
  const [restockNotes, setRestockNotes] = useState("");
  const [stagingNotes, setStagingNotes] = useState("");
  const [securityNotes, setSecurityNotes] = useState("");
  const [officeNotes, setOfficeNotes] = useState("");
  const [coiRequired, setCoiRequired] = useState(false);

  // Facility & scope (commercial / office) — the three pricing inputs
  const [facilityTypeKey, setFacilityTypeKey] = useState("");
  const [scopeLevel, setScopeLevel] = useState("standard");
  const [sqftInput, setSqftInput] = useState("");
  const [windowStart, setWindowStart] = useState("");
  const [windowEnd, setWindowEnd] = useState("");

  // Pay + payment
  const [priceDollars, setPriceDollars] = useState("");
  const [priceTouched, setPriceTouched] = useState(false);
  const [payPct, setPayPct] = useState("35");
  const [numCleaners, setNumCleaners] = useState("1");
  const [crewTouched, setCrewTouched] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState("invoice");

  // Crew
  const [cleaners, setCleaners] = useState<CleanerOpt[]>([]);
  const [selectedCleaners, setSelectedCleaners] = useState<string[]>([]);

  // Recurring
  const [recurring, setRecurring] = useState(false);
  const [cadence, setCadence] = useState<"daily" | "weekly" | "biweekly" | "monthly">("weekly");

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ref: string; assigned: boolean; crewSize: number; priceCents: number; priceSource: string | null } | null>(null);

  const isStr = type === "str_turnover";
  const isCommercial = type === "commercial" || type === "office";

  // ── Load pickers ───────────────────────────────────────────────────────
  useEffect(() => {
    void (async () => {
      const [acctRes, cleanRes] = await Promise.all([
        (supabase.from as any)("business_accounts")
          .select("id, business_name, account_type, status, email, facility_type")
          .neq("status", "offboarded").order("business_name").limit(500),
        (supabase.from as any)("cleaners")
          .select("id, first_name, last_name, pay_percentage")
          .eq("status", "active").eq("approved", true).order("last_name").limit(200),
      ]);
      setAccounts((acctRes.data || []) as AccountOpt[]);
      setCleaners((cleanRes.data || []) as CleanerOpt[]);
    })();
  }, []);

  useEffect(() => {
    if (!accountId) { setSites([]); setSiteId(""); return; }
    void (async () => {
      const { data } = await (supabase.from as any)("business_sites")
        .select(
          "id, nickname, address, facility_type, facility_type_key, scope_level, sqft, " +
            "service_window_start, service_window_end, access_method, access_instructions, " +
            "scope_notes, badge_required, security_contact_name, loading_dock_notes",
        )
        .eq("business_account_id", accountId).eq("active", true).order("created_at");
      const rows = (data || []) as SiteOpt[];
      setSites(rows);
      // One site is not a choice. Pick it so the account-level data the site
      // already carries flows in without a redundant click.
      if (rows.length === 1) setSiteId(rows[0].id);
    })();
  }, [accountId]);

  // A second booking against an existing site must not re-enter anything the
  // site already knows: square footage, facility type, scope depth, the
  // service window, how the crew gets in, what's in scope.
  const selectedSite = useMemo(() => sites.find((s) => s.id === siteId) || null, [sites, siteId]);
  useEffect(() => {
    if (!selectedSite) return;
    if (selectedSite.sqft != null) setSqftInput(String(selectedSite.sqft));
    if (selectedSite.facility_type_key) setFacilityTypeKey(selectedSite.facility_type_key);
    if (selectedSite.scope_level) setScopeLevel(selectedSite.scope_level);
    if (selectedSite.service_window_start) setWindowStart(String(selectedSite.service_window_start).slice(0, 5));
    if (selectedSite.service_window_end) setWindowEnd(String(selectedSite.service_window_end).slice(0, 5));
    setAccessMethod((prev) => prev || selectedSite.access_method || "");
    setAccessNotes((prev) => prev || selectedSite.access_instructions || "");
    setScopeNotes((prev) => prev || selectedSite.scope_notes || "");
  }, [selectedSite]);

  useEffect(() => {
    if (!isStr) return;
    void (async () => {
      const { data: props } = await (supabase.from as any)("properties")
        .select("id, nickname, address, turnover_price, host_id").order("nickname").limit(500);
      const hostIds = [...new Set(((props || []) as PropertyOpt[]).map((p) => p.host_id))];
      const { data: hosts } = hostIds.length
        ? await (supabase.from as any)("hosts").select("id, name").in("id", hostIds)
        : { data: [] };
      const hostName = new Map(((hosts || []) as Array<{ id: string; name: string }>).map((h) => [h.id, h.name]));
      setProperties(((props || []) as PropertyOpt[]).map((p) => ({ ...p, host_name: hostName.get(p.host_id) || "" })));
    })();
  }, [isStr]);

  // Prefill price from the STR property's set rate (admin can override).
  useEffect(() => {
    if (!isStr || !propertyId) return;
    const p = properties.find((x) => x.id === propertyId);
    if (p?.turnover_price != null && !priceDollars) setPriceDollars(String(p.turnover_price));
  }, [propertyId, isStr, properties, priceDollars]);

  const filteredAccounts = useMemo(() => {
    const base = accounts.filter((a) => (type === "office" ? true : true));
    if (!clientSearch) return base;
    const q = clientSearch.toLowerCase();
    return base.filter((a) => `${a.business_name} ${a.email}`.toLowerCase().includes(q));
  }, [accounts, clientSearch, type]);

  const filteredProperties = useMemo(() => {
    if (!clientSearch) return properties;
    const q = clientSearch.toLowerCase();
    return properties.filter((p) => `${p.nickname} ${p.host_name} ${p.address}`.toLowerCase().includes(q));
  }, [properties, clientSearch]);

  // ── Live commercial quote ──────────────────────────────────────────────
  const sqft = Math.max(0, Math.round(parseFloat(sqftInput) || 0));
  const windowHours = windowHoursBetween(windowStart, windowEnd);
  const commercialQuote = useCommercialQuote({
    sqft,
    facilityTypeKey,
    scopeLevel,
    windowHours,
    businessAccountId: accountId || null,
    businessSiteId: siteId || null,
    enabled: isCommercial && sqft > 0 && Boolean(facilityTypeKey),
  });
  const quote = commercialQuote.quote;
  const compliance = commercialQuote.compliance;
  const walkthrough = commercialQuote.walkthrough;
  const config = commercialQuote.config;
  const needsWalkthrough = Boolean(isCommercial && quote?.requiresWalkthrough);
  const walkthroughReady = Boolean(
    walkthrough && walkthrough.status === "completed" && walkthrough.firm_price_cents,
  );
  const recommendedCrew = quote?.crew?.crewSize ?? null;

  // The formula's number fills the price box below the threshold; above it,
  // the walkthrough's firm price does. Either stops the moment an admin types
  // their own number — a negotiated price is a deliberate act, not a default.
  useEffect(() => {
    if (!isCommercial || priceTouched) return;
    const auto = needsWalkthrough
      ? (walkthroughReady ? Number(walkthrough?.firm_price_cents) : 0)
      : (quote?.ok ? quote.formulaCents : 0);
    if (auto > 0) setPriceDollars((auto / 100).toFixed(2));
  }, [isCommercial, priceTouched, needsWalkthrough, walkthroughReady, walkthrough, quote]);

  useEffect(() => {
    if (!isCommercial || crewTouched || !recommendedCrew) return;
    setNumCleaners(String(recommendedCrew));
  }, [isCommercial, crewTouched, recommendedCrew]);

  // ── Gates ──────────────────────────────────────────────────────────────
  const priceCents = Math.round((parseFloat(priceDollars) || 0) * 100);
  const payoutCents = Math.floor((priceCents * (parseInt(payPct, 10) || 35)) / 100);
  const gates = {
    client: isStr
      ? Boolean(propertyId)
      // A commercial booking belongs to a site, not to an account with an
      // address on it.
      : Boolean(accountId) && (!isCommercial || Boolean(siteId)),
    when: Boolean(serviceDate) && (Boolean(hardDeadline) || Boolean(window_)),
    access: Boolean(accessMethod),
    scope: scopeNotes.trim().length > 0 && (!isCommercial || (sqft > 0 && Boolean(facilityTypeKey) && Boolean(scopeLevel))),
    pay: priceCents > 0,
    ...(isCommercial
      ? {
        compliance: compliance ? compliance.ok : true,
        walkthrough: !needsWalkthrough || walkthroughReady,
      }
      : {}),
  } as Record<string, boolean>;
  const complete = Object.values(gates).every(Boolean);

  const submit = async () => {
    if (!complete || !type) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("book-partner-job", {
        body: {
          bookingType: type,
          businessAccountId: accountId || undefined,
          businessSiteId: siteId || undefined,
          propertyId: propertyId || undefined,
          serviceDate,
          arrivalWindow: window_ || undefined,
          hardDeadline: hardDeadline || undefined,
          strCheckoutTime: checkoutTime || undefined,
          accessMethod,
          accessCode: accessCode || undefined,
          accessNotes: accessNotes || undefined,
          serviceType: isStr ? "turnover" : "commercial",
          scopeNotes,
          specialInstructions: specialInstructions || undefined,
          linenNotes: linenNotes || undefined,
          restockNotes: restockNotes || undefined,
          stagingNotes: stagingNotes || undefined,
          securityNotes: securityNotes || undefined,
          officeNotes: officeNotes || undefined,
          coiRequired,
          facilityTypeKey: isCommercial ? facilityTypeKey : undefined,
          scopeLevel: isCommercial ? scopeLevel : undefined,
          squareFootage: isCommercial && sqft > 0 ? sqft : undefined,
          serviceWindowStart: isCommercial && windowStart ? windowStart : undefined,
          serviceWindowEnd: isCommercial && windowEnd ? windowEnd : undefined,
          walkthroughId: needsWalkthrough && walkthrough?.id ? walkthrough.id : undefined,
          priceCents,
          cleanerPayPct: parseInt(payPct, 10) || 35,
          numCleaners: parseInt(numCleaners, 10) || 1,
          paymentStatus,
          cleanerIds: selectedCleaners,
          recurring: recurring ? { cadence } : undefined,
        },
      });
      if (error) throw error;
      const d = data as {
        ok?: boolean; error?: string; ref?: string; assigned?: boolean;
        crewSize?: number; priceCents?: number; priceSource?: string | null; warnings?: string[];
      };
      if (!d?.ok) throw new Error(d?.error || "Booking failed");
      setResult({
        ref: d.ref || "",
        assigned: Boolean(d.assigned),
        crewSize: Number(d.crewSize) || 1,
        priceCents: Number(d.priceCents) || priceCents,
        priceSource: d.priceSource || null,
      });
      for (const w of d.warnings || []) toast.warning(w);
      toast.success(`${d.ref} booked${d.assigned ? " — crew assigned, their portal is live" : " — routed to dispatch"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Booking failed");
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setResult(null); setType(null); setAccountId(""); setSiteId(""); setPropertyId("");
    setServiceDate(""); setWindow(""); setHardDeadline(""); setCheckoutTime("");
    setAccessMethod(""); setAccessCode(""); setAccessNotes(""); setScopeNotes("");
    setSpecialInstructions(""); setLinenNotes(""); setRestockNotes(""); setStagingNotes("");
    setSecurityNotes(""); setOfficeNotes(""); setCoiRequired(false); setPriceDollars("");
    setPayPct("35"); setNumCleaners("1"); setPaymentStatus("invoice");
    setSelectedCleaners([]); setRecurring(false);
    setFacilityTypeKey(""); setScopeLevel("standard"); setSqftInput("");
    setWindowStart(""); setWindowEnd(""); setPriceTouched(false); setCrewTouched(false);
  };

  if (result) {
    return (
      <Card className="max-w-xl mx-auto border-emerald-200">
        <CardContent className="p-8 text-center space-y-3">
          <RiCheckboxCircleFill className="w-12 h-12 text-emerald-500 mx-auto" />
          <h2 className="text-xl font-bold text-slate-900">{result.ref} booked</h2>
          <p className="text-sm text-slate-600">
            {formatCents(result.priceCents)}
            {result.priceSource ? ` · priced from the ${result.priceSource === "formula" ? "rate formula" : result.priceSource === "walkthrough" ? "walkthrough findings" : "negotiated override"}` : ""}
            {result.crewSize > 1 ? ` · crew of ${result.crewSize}` : ""}
          </p>
          <p className="text-sm text-slate-600">
            {result.assigned
              ? "Crew assigned — the job is live in their contractor portal with the facility type, scope checklist, access and security details, the service window, and each member's locked pay."
              : "No crew pre-assigned — the job is in the Dispatch console awaiting assignment."}
          </p>
          <Button onClick={reset}>Book another</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4 max-w-3xl">
      {/* ── 1. Type ─────────────────────────────────────────────────────── */}
      <div className="grid sm:grid-cols-3 gap-2">
        {TYPES.map((t) => (
          <button key={t.id} onClick={() => { setType(t.id); setClientSearch(""); }}
            className={cn(
              "text-left rounded-xl border-2 bg-white p-4 transition-all",
              type === t.id ? "border-violet-500 shadow-sm" : "border-slate-200 hover:border-violet-300",
            )}>
            <t.icon className={cn("w-5 h-5 mb-1.5", type === t.id ? "text-violet-600" : "text-slate-400")} />
            <p className="font-bold text-sm text-slate-900">{t.label}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">{t.sub}</p>
          </button>
        ))}
      </div>

      {type && (
        <>
          {/* ── 2. Client / location ──────────────────────────────────────── */}
          <Card><CardContent className="p-4 space-y-3">
            <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
              <RiSearchLine className="w-4 h-4 text-violet-600" /> {isStr ? "Property" : "Account & site"}
            </p>
            <Input placeholder={isStr ? "Search property / host…" : "Search business…"} value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} />
            {!isStr ? (
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <Label>Account *</Label>
                  <Select value={accountId} onValueChange={(v) => { setAccountId(v); setSiteId(""); }}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Pick account…" /></SelectTrigger>
                    <SelectContent>
                      {filteredAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.business_name} ({a.account_type} · {a.status})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Site *</Label>
                  <Select value={siteId} onValueChange={setSiteId} disabled={sites.length === 0}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder={sites.length ? "Pick site…" : "No sites on this account"} /></SelectTrigger>
                    <SelectContent>
                      {sites.map((st) => (
                        <SelectItem key={st.id} value={st.id}>{st.nickname}{st.sqft ? ` · ${st.sqft.toLocaleString()} sqft` : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {accountId && sites.length === 0 && (
                    <p className="text-[11px] text-rose-600 mt-1">
                      No active site on this account. Add one under Accounts first — a commercial job belongs to a
                      site so its address, access, and square footage live in one place.
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div>
                <Label>Property *</Label>
                <Select value={propertyId} onValueChange={setPropertyId}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Pick property…" /></SelectTrigger>
                  <SelectContent>
                    {filteredProperties.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.nickname || p.address || p.id.slice(0, 8)}{p.host_name ? ` — ${p.host_name}` : ""}{p.turnover_price != null ? ` · $${p.turnover_price}` : " · no rate set"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Account-level compliance. The gap is on the ACCOUNT, so it
                blocks every site under it — surfacing it here means a VA
                learns about an expired COI while the client is still on the
                phone, not at submit. */}
            {isCommercial && accountId && compliance && (
              <div className={cn(
                "rounded-lg border p-3 text-xs space-y-1",
                compliance.ok
                  ? compliance.warnings.length
                    ? "border-amber-300 bg-amber-50/60"
                    : "border-emerald-200 bg-emerald-50/60"
                  : "border-rose-300 bg-rose-50/60",
              )}>
                <p className={cn(
                  "font-bold flex items-center gap-1.5",
                  compliance.ok ? (compliance.warnings.length ? "text-amber-800" : "text-emerald-800") : "text-rose-800",
                )}>
                  {compliance.ok ? <RiShieldCheckLine className="w-4 h-4" /> : <RiErrorWarningLine className="w-4 h-4" />}
                  {compliance.ok ? "Account cleared to book" : "Account blocked — nothing can be booked or dispatched"}
                </p>
                {compliance.blockers.map((b) => (
                  <p key={b} className="text-rose-700">✗ {b}</p>
                ))}
                {compliance.warnings.map((w) => (
                  <p key={w} className="text-amber-700">⚠ {w}</p>
                ))}
                {!compliance.ok && (
                  <p className="text-rose-600">
                    This applies to every site under the account, not just this one.{" "}
                    <a href="/admin/partner?tab=compliance" className="font-semibold underline">
                      Upload a current certificate in Compliance
                    </a>{" "}
                    and the block lifts immediately — no separate unblock step.
                  </p>
                )}
                {compliance.ok && compliance.coi_expires_at && (
                  <p className="text-slate-500">COI current through {String(compliance.coi_expires_at).slice(0, 10)}.</p>
                )}
              </div>
            )}
          </CardContent></Card>

          {/* ── 3. When + deadline ────────────────────────────────────────── */}
          <Card><CardContent className="p-4 space-y-3">
            <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
              <RiCalendarCheckLine className="w-4 h-4 text-violet-600" /> When
            </p>
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <Label>Service date *</Label>
                <Input type="date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>Arrival window</Label>
                <Select value={window_} onValueChange={setWindow}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Pick window…" /></SelectTrigger>
                  <SelectContent>{WINDOWS.map((w) => <SelectItem key={w} value={w}>{w}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {isStr ? (
                <div>
                  <Label>Guest checkout</Label>
                  <Input placeholder="11:00 AM" value={checkoutTime} onChange={(e) => setCheckoutTime(e.target.value)} className="mt-1" />
                </div>
              ) : <div />}
            </div>
            <div className={cn("rounded-lg border-2 p-3", hardDeadline ? "border-emerald-300 bg-emerald-50/50" : "border-rose-300 bg-rose-50/50")}>
              <Label className="flex items-center gap-1.5 font-bold">
                <RiAlarmWarningLine className="w-4 h-4 text-rose-500" />
                {isStr ? "Next check-in (HARD deadline) *" : "Must finish by (hard stop)"}
              </Label>
              <Input
                placeholder={isStr ? "e.g. 4:00 PM today — guests arriving" : "e.g. 6:00 AM before staff arrive"}
                value={hardDeadline} onChange={(e) => setHardDeadline(e.target.value)} className="mt-1.5 bg-white" />
              <p className="text-[11px] text-slate-500 mt-1">
                {isStr ? "The most time-critical field — the whole turnover races this." : "Leave blank only if the window alone is enough."}
              </p>
            </div>
          </CardContent></Card>

          {/* ── 4. Access (gated) ─────────────────────────────────────────── */}
          <Card className={cn(!gates.access && "border-rose-200")}><CardContent className="p-4 space-y-3">
            <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
              <RiKey2Line className="w-4 h-4 text-violet-600" /> Access — non-negotiable
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label>Access method *</Label>
                <Select value={accessMethod} onValueChange={setAccessMethod}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="How does the crew get in?" /></SelectTrigger>
                  <SelectContent>{ACCESS_METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Code (lockbox / door / alarm)</Label>
                <Input placeholder="e.g. 4482#" value={accessCode} onChange={(e) => setAccessCode(e.target.value)} className="mt-1" />
              </div>
            </div>
            <div>
              <Label>Parking / entry / unit notes</Label>
              <Textarea placeholder="Park in rear lot, suite 210 second floor, badge in at front desk…" value={accessNotes} onChange={(e) => setAccessNotes(e.target.value)} rows={2} className="mt-1" />
            </div>
            <p className="text-[11px] text-slate-400">Access codes unlock in the cleaner's portal 48h before the visit — never earlier.</p>
          </CardContent></Card>

          {/* ── 4b. Facility, scope level, size — the three price inputs ──── */}
          {isCommercial && (
            <Card className={cn(!gates.scope && "border-rose-200")}><CardContent className="p-4 space-y-3">
              <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                <RiRulerLine className="w-4 h-4 text-violet-600" /> Facility &amp; scope
                <span className="text-xs font-normal text-slate-400">— what the price is built from</span>
              </p>
              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <Label>Facility type *</Label>
                  <Select value={facilityTypeKey} onValueChange={setFacilityTypeKey}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Pick facility…" /></SelectTrigger>
                    <SelectContent>
                      {(config?.facilityTypes || []).map((f) => (
                        <SelectItem key={f.key} value={f.key}>
                          {f.label} · ${(Number(f.base_rate_cents_per_sqft) / 100).toFixed(2)}/sqft
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Sets the base rate — a restaurant kitchen costs multiples of warehouse floor per square foot.
                  </p>
                </div>
                <div>
                  <Label>Scope level *</Label>
                  <Select value={scopeLevel} onValueChange={setScopeLevel}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Pick depth…" /></SelectTrigger>
                    <SelectContent>
                      {(config?.scopeLevels || []).map((s) => (
                        <SelectItem key={s.key} value={s.key}>{s.label} · ×{Number(s.multiplier).toFixed(2)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-slate-400 mt-1">
                    {config?.scopeLevels.find((s) => s.key === scopeLevel)?.summary ||
                      "Light · Standard · Detailed — each level is the one before it plus more."}
                  </p>
                </div>
                <div>
                  <Label>Square footage *</Label>
                  <Input type="number" min={0} step={100} value={sqftInput}
                    onChange={(e) => setSqftInput(e.target.value)} className="mt-1"
                    placeholder="e.g. 1800" />
                  {quote?.breakdown && (
                    <p className="text-[11px] text-slate-400 mt-1">
                      {quote.breakdown.size_tier_label} · ×{quote.breakdown.size_tier_multiplier.toFixed(2)} — bigger
                      facilities cost less per foot.
                    </p>
                  )}
                </div>
              </div>

              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <Label>Service window starts</Label>
                  <Input type="time" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} className="mt-1" />
                </div>
                <div>
                  <Label>Service window ends</Label>
                  <Input type="time" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} className="mt-1" />
                </div>
                <div className="rounded-lg bg-slate-50 border border-slate-200 p-2 flex flex-col justify-center">
                  <p className="text-[10px] font-semibold text-slate-500 uppercase">Window</p>
                  <p className="font-bold text-slate-800">
                    {windowHours ? `${windowHours}h on site` : "Not set"}
                  </p>
                  <p className="text-[10px] text-slate-400">Overnight windows wrap past midnight.</p>
                </div>
              </div>

              {/* The quote. The formula's number is always shown — above the
                  threshold as an anchor, below it as the price. */}
              {commercialQuote.loading && (
                <p className="text-xs text-slate-500 flex items-center gap-1.5">
                  <RiLoader4Line className="w-3.5 h-3.5 animate-spin" /> Pricing…
                </p>
              )}
              {commercialQuote.error && (
                <p className="text-xs text-rose-600">{commercialQuote.error}</p>
              )}
              {quote && !quote.ok && quote.error && (
                <p className="text-xs text-amber-700">{quote.error}</p>
              )}
              {quote?.ok && quote.breakdown && (
                <div className={cn(
                  "rounded-lg border p-3 space-y-1.5",
                  needsWalkthrough ? "border-amber-300 bg-amber-50/60" : "border-violet-200 bg-violet-50/60",
                )}>
                  <p className="text-xs text-slate-600">
                    {quote.breakdown.sqft.toLocaleString()} sq ft × ${(quote.breakdown.base_rate_cents_per_sqft / 100).toFixed(2)}/sqft
                    ({quote.breakdown.facility_type_label}) × {quote.breakdown.scope_multiplier.toFixed(2)} ({quote.breakdown.scope_label})
                    × {quote.breakdown.size_tier_multiplier.toFixed(2)} ({quote.breakdown.size_tier_label})
                  </p>
                  {needsWalkthrough ? (
                    <>
                      <p className="text-lg font-bold text-amber-900">
                        Estimate {formatCents(quote.estimateLowCents)} – {formatCents(quote.estimateHighCents)}
                      </p>
                      <p className="text-xs text-amber-800">
                        At or above {quote.walkthroughThresholdSqft.toLocaleString()} sq ft this is a range, not a quote.
                        Racking, dock areas, floor type, restroom count, and existing condition swing a facility this
                        size too far to price from a desk. Formula anchor: {formatCents(quote.formulaCents)}.
                      </p>
                      {walkthroughReady ? (
                        <p className="text-xs font-semibold text-emerald-800">
                          ✓ Walkthrough {walkthrough?.conducted_on ? `on ${walkthrough.conducted_on}` : ""}
                          {walkthrough?.conducted_by ? ` by ${walkthrough.conducted_by}` : ""} — firm price{" "}
                          {formatCents(Number(walkthrough?.firm_price_cents || 0))}.
                        </p>
                      ) : (
                        <p className="text-xs font-semibold text-rose-700">
                          ✗ No completed walkthrough for this site. Schedule one under the Walkthroughs tab and set the
                          firm price from its findings — this booking can't be confirmed until then.
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-lg font-bold text-violet-900">
                      {formatCents(quote.formulaCents)}{" "}
                      <span className="text-xs font-normal text-violet-700">quotable now — no walkthrough needed</span>
                    </p>
                  )}
                  {quote.crew && (
                    <p className="text-xs text-slate-600">
                      <span className="font-semibold">Recommended crew: {quote.crew.crewSize}</span> — {quote.crew.rationale}
                    </p>
                  )}
                  {commercialQuote.photoZones.length > 0 && (
                    <p className="text-[11px] text-slate-500">
                      Documented by zone: {commercialQuote.photoZones.join(", ")} — before and after for each.
                    </p>
                  )}
                </div>
              )}
            </CardContent></Card>
          )}

          {/* ── 5. Scope + type-specific vitals ───────────────────────────── */}
          <Card className={cn(!gates.scope && "border-rose-200")}><CardContent className="p-4 space-y-3">
            <p className="text-sm font-bold text-slate-800">Scope — what's included *</p>
            <Textarea
              placeholder={isStr
                ? "Full guest-ready turnover: all rooms, bathrooms, kitchen, floors; strip & remake beds; final staging…"
                : "Areas in scope, restrooms count, floors, trash/recycling, deep tasks and their cadence…"}
              value={scopeNotes} onChange={(e) => setScopeNotes(e.target.value)} rows={3} />
            {isStr && (
              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <Label>Linen / laundry</Label>
                  <Textarea placeholder="Host provides in hall closet…" value={linenNotes} onChange={(e) => setLinenNotes(e.target.value)} rows={2} className="mt-1" />
                </div>
                <div>
                  <Label>Restock</Label>
                  <Textarea placeholder="TP ×4, paper towels, soap — under kitchen sink…" value={restockNotes} onChange={(e) => setRestockNotes(e.target.value)} rows={2} className="mt-1" />
                </div>
                <div>
                  <Label>Staging</Label>
                  <Textarea placeholder="Towel folds, welcome card on counter…" value={stagingNotes} onChange={(e) => setStagingNotes(e.target.value)} rows={2} className="mt-1" />
                </div>
              </div>
            )}
            {!isStr && (
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <Label>Security / alarm / lock-up</Label>
                  <Textarea placeholder="Alarm code 2210, set on exit; notify property mgr on arrival…" value={securityNotes} onChange={(e) => setSecurityNotes(e.target.value)} rows={2} className="mt-1" />
                </div>
                {type === "office" && (
                  <div>
                    <Label>Office rules</Label>
                    <Textarea placeholder="Clear-desk policy: don't touch papers; no electronics; freight elevator after 6pm…" value={officeNotes} onChange={(e) => setOfficeNotes(e.target.value)} rows={2} className="mt-1" />
                  </div>
                )}
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={coiRequired} onChange={(e) => setCoiRequired(e.target.checked)} className="rounded" />
                  This site requires COI on file
                </label>
              </div>
            )}
            <div>
              <Label>Special instructions (pets, fragile areas, quirks)</Label>
              <Textarea value={specialInstructions} onChange={(e) => setSpecialInstructions(e.target.value)} rows={2} className="mt-1" />
            </div>
          </CardContent></Card>

          {/* ── 6. Pay (locked) + payment status ──────────────────────────── */}
          <Card><CardContent className="p-4 space-y-3">
            <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
              <RiMoneyDollarCircleLine className="w-4 h-4 text-violet-600" /> Pay — locked at booking
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <Label>Job price ($) *</Label>
                <Input type="number" min={0} value={priceDollars}
                  onChange={(e) => { setPriceDollars(e.target.value); setPriceTouched(true); }}
                  className="mt-1" />
              </div>
              <div>
                <Label>Crew pay %</Label>
                <Input type="number" min={20} max={60} value={payPct} onChange={(e) => setPayPct(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label># cleaners</Label>
                <Input type="number" min={1} max={isCommercial ? 12 : 3} value={numCleaners}
                  onChange={(e) => { setNumCleaners(e.target.value); setCrewTouched(true); }}
                  className="mt-1" />
              </div>
              <div className="rounded-lg bg-violet-50 border border-violet-200 p-2 flex flex-col justify-center">
                <p className="text-[10px] font-semibold text-violet-600 uppercase">
                  Crew pool{Number(numCleaners) > 1 ? ` ÷ ${numCleaners}` : ""}
                </p>
                <p className="font-bold text-violet-900">${(payoutCents / 100).toFixed(2)}</p>
                {Number(numCleaners) > 1 && (
                  <p className="text-[10px] text-violet-700">
                    ≈ ${(payoutCents / 100 / Number(numCleaners)).toFixed(2)} each
                  </p>
                )}
              </div>
            </div>
            {isCommercial && priceTouched && quote?.ok && priceCents !== quote.formulaCents && !walkthroughReady && (
              <p className="text-[11px] text-amber-700">
                Negotiated price — recorded as an override against the {formatCents(quote.formulaCents)} formula anchor.
              </p>
            )}
            {isCommercial && Number(numCleaners) >= 3 && (
              <p className="text-[11px] text-slate-500">
                Crews of 3–4 and 5+ have their own pay brackets — the pool grows with crew size so per-person hourly
                holds as coordination overhead does.
              </p>
            )}
            <div>
              <Label>Payment status</Label>
              <Select value={paymentStatus} onValueChange={setPaymentStatus}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{PAYMENT_STATUSES.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}</SelectContent>
              </Select>
              {paymentStatus === "unpaid" && (
                <p className="text-[11px] text-amber-600 mt-1">Unpaid jobs won't dispatch until payment clears (existing gate).</p>
              )}
            </div>
          </CardContent></Card>

          {/* ── 7. Crew ───────────────────────────────────────────────────── */}
          <Card><CardContent className="p-4 space-y-3">
            <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
              <RiTeamLine className="w-4 h-4 text-violet-600" /> Crew
              <span className="text-xs font-normal text-slate-400">— assign now, or leave empty to route to Dispatch</span>
            </p>
            {isCommercial && recommendedCrew != null && (
              <p className={cn(
                "text-xs",
                selectedCleaners.length > 0 && selectedCleaners.length < recommendedCrew ? "text-amber-700" : "text-slate-500",
              )}>
                {selectedCleaners.length} of {recommendedCrew} recommended selected
                {quote?.crew?.windowTooShort ? " — the window is too short for this scope at any crew size." : ""}
              </p>
            )}
            <div className="flex flex-wrap gap-1.5">
              {cleaners.map((c) => {
                const on = selectedCleaners.includes(c.id);
                const cap = isCommercial ? 12 : 3;
                return (
                  <button key={c.id}
                    onClick={() => setSelectedCleaners((prev) => on ? prev.filter((x) => x !== c.id) : prev.length < cap ? [...prev, c.id] : prev)}
                    className={cn(
                      "px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors",
                      on ? "bg-violet-600 text-white border-violet-600" : "bg-white text-slate-600 border-slate-200 hover:border-violet-300",
                    )}>
                    {c.first_name} {c.last_name}
                  </button>
                );
              })}
            </div>
          </CardContent></Card>

          {/* ── 8. Recurring ──────────────────────────────────────────────── */}
          <Card><CardContent className="p-4 space-y-3">
            <label className="flex items-center gap-2 text-sm font-bold text-slate-800">
              <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} className="rounded" />
              <RiRepeatLine className="w-4 h-4 text-violet-600" /> Make this recurring
            </label>
            {recurring && (
              <div className="flex items-center gap-3">
                <Select value={cadence} onValueChange={(v) => setCadence(v as typeof cadence)}>
                  <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {isCommercial && <SelectItem value="daily">Daily</SelectItem>}
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="biweekly">Bi-weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-slate-500">
                  Future visits auto-generate a week ahead with the same facility, scope level, access, pay, and
                  preferred crew — through the same gates as this one.
                </p>
              </div>
            )}
          </CardContent></Card>

          {/* ── Gates + submit ────────────────────────────────────────────── */}
          <div className="flex flex-wrap gap-1.5">
            {([
              ["client", isStr ? "Property" : "Account + site"],
              ["when", "Date + deadline/window"],
              ["access", "Access"],
              ["scope", isCommercial ? "Facility + scope" : "Scope"],
              ["pay", "Price"],
              ...(isCommercial
                ? ([["compliance", "COI + agreement"], ["walkthrough", needsWalkthrough ? "Walkthrough" : "No walkthrough needed"]] as Array<[string, string]>)
                : []),
            ] as Array<[string, string]>).map(([k, label]) => (
              <Badge key={k} className={cn("border-0", gates[k] ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700")}>
                {gates[k] ? "✓" : "✗"} {label}
              </Badge>
            ))}
          </div>
          <Button className="w-full h-12 text-base" disabled={!complete || submitting} onClick={() => void submit()}>
            {submitting ? <RiLoader4Line className="w-5 h-5 mr-2 animate-spin" /> : <RiCheckboxCircleFill className="w-5 h-5 mr-2" />}
            {complete ? "Book job — portal updates immediately" : "Complete the gates above to book"}
          </Button>
        </>
      )}
    </div>
  );
}
