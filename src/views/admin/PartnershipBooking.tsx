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

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RiAlarmWarningLine,
  RiBuilding2Line,
  RiBuilding4Line,
  RiCalendarCheckLine,
  RiCheckboxCircleFill,
  RiHomeSmile2Line,
  RiKey2Line,
  RiLoader4Line,
  RiMoneyDollarCircleLine,
  RiRepeatLine,
  RiSearchLine,
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
interface SiteOpt { id: string; nickname: string; address: string | null; facility_type: string | null; sqft: number | null }
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

  // Pay + payment
  const [priceDollars, setPriceDollars] = useState("");
  const [payPct, setPayPct] = useState("35");
  const [numCleaners, setNumCleaners] = useState("1");
  const [paymentStatus, setPaymentStatus] = useState("invoice");

  // Crew
  const [cleaners, setCleaners] = useState<CleanerOpt[]>([]);
  const [selectedCleaners, setSelectedCleaners] = useState<string[]>([]);

  // Recurring
  const [recurring, setRecurring] = useState(false);
  const [cadence, setCadence] = useState<"weekly" | "biweekly" | "monthly">("weekly");

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ref: string; assigned: boolean } | null>(null);

  const isStr = type === "str_turnover";

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
        .select("id, nickname, address, facility_type, sqft")
        .eq("business_account_id", accountId).eq("active", true).order("created_at");
      setSites((data || []) as SiteOpt[]);
    })();
  }, [accountId]);

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

  // ── Gates ──────────────────────────────────────────────────────────────
  const priceCents = Math.round((parseFloat(priceDollars) || 0) * 100);
  const payoutCents = Math.floor((priceCents * (parseInt(payPct, 10) || 35)) / 100);
  const gates = {
    client: isStr ? Boolean(propertyId) : Boolean(accountId),
    when: Boolean(serviceDate) && (Boolean(hardDeadline) || Boolean(window_)),
    access: Boolean(accessMethod),
    scope: scopeNotes.trim().length > 0,
    pay: priceCents > 0,
  };
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
          priceCents,
          cleanerPayPct: parseInt(payPct, 10) || 35,
          numCleaners: parseInt(numCleaners, 10) || 1,
          paymentStatus,
          cleanerIds: selectedCleaners,
          recurring: recurring ? { cadence } : undefined,
        },
      });
      if (error) throw error;
      const d = data as { ok?: boolean; error?: string; ref?: string; assigned?: boolean };
      if (!d?.ok) throw new Error(d?.error || "Booking failed");
      setResult({ ref: d.ref || "", assigned: Boolean(d.assigned) });
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
  };

  if (result) {
    return (
      <Card className="max-w-xl mx-auto border-emerald-200">
        <CardContent className="p-8 text-center space-y-3">
          <RiCheckboxCircleFill className="w-12 h-12 text-emerald-500 mx-auto" />
          <h2 className="text-xl font-bold text-slate-900">{result.ref} booked</h2>
          <p className="text-sm text-slate-600">
            {result.assigned
              ? "Crew assigned — the job is live in their contractor portal with the deadline, access, scope, and locked pay."
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
                  <Label>Site {sites.length > 0 ? "*" : "(none on file — uses account address)"}</Label>
                  <Select value={siteId} onValueChange={setSiteId} disabled={sites.length === 0}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder={sites.length ? "Pick site…" : "No sites"} /></SelectTrigger>
                    <SelectContent>
                      {sites.map((st) => (
                        <SelectItem key={st.id} value={st.id}>{st.nickname}{st.sqft ? ` · ${st.sqft.toLocaleString()} sqft` : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                <Input type="number" min={0} value={priceDollars} onChange={(e) => setPriceDollars(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>Crew pay %</Label>
                <Input type="number" min={20} max={60} value={payPct} onChange={(e) => setPayPct(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label># cleaners</Label>
                <Input type="number" min={1} max={3} value={numCleaners} onChange={(e) => setNumCleaners(e.target.value)} className="mt-1" />
              </div>
              <div className="rounded-lg bg-violet-50 border border-violet-200 p-2 flex flex-col justify-center">
                <p className="text-[10px] font-semibold text-violet-600 uppercase">Crew earns</p>
                <p className="font-bold text-violet-900">${(payoutCents / 100).toFixed(2)}</p>
              </div>
            </div>
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
            <div className="flex flex-wrap gap-1.5">
              {cleaners.map((c) => {
                const on = selectedCleaners.includes(c.id);
                return (
                  <button key={c.id}
                    onClick={() => setSelectedCleaners((prev) => on ? prev.filter((x) => x !== c.id) : prev.length < 3 ? [...prev, c.id] : prev)}
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
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="biweekly">Bi-weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-slate-500">
                  Future visits auto-generate a week ahead with the same access, scope, pay, and preferred crew.
                </p>
              </div>
            )}
          </CardContent></Card>

          {/* ── Gates + submit ────────────────────────────────────────────── */}
          <div className="flex flex-wrap gap-1.5">
            {([["client", isStr ? "Property" : "Account"], ["when", "Date + deadline/window"], ["access", "Access"], ["scope", "Scope"], ["pay", "Price"]] as const).map(([k, label]) => (
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
