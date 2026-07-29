"use client";

// ─── /admin/commercial — Commercial / Office / Partnership booking ───────
//
// A dedicated internal workspace for non-residential work: commercial
// accounts, office cleaning, and partnership relationships (property
// managers, realtors, Airbnb hosts). Unlike the residential funnel,
// commercial pricing is bespoke — the VA enters a negotiated quote — and
// every booking can be tied to a reusable business account with its own
// rate, billing terms, and recurring cadence.

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  RiBuilding2Line,
  RiBriefcaseLine,
  RiHandHeartLine,
  RiSearchLine,
  RiLoader4Line,
  RiCheckboxCircleLine,
  RiRepeatLine,
  RiArrowRightLine,
} from "@remixicon/react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { SEO } from "@/components/SEO";

type AccountType = "commercial" | "office" | "partnership";

const ACCOUNT_TYPES: { id: AccountType; label: string; sub: string; icon: typeof RiBuilding2Line }[] = [
  { id: "commercial", label: "Commercial", sub: "Retail, medical, gym, restaurant…", icon: RiBuilding2Line },
  { id: "office", label: "Office", sub: "Corporate & coworking spaces", icon: RiBriefcaseLine },
  { id: "partnership", label: "Partnership", sub: "Property mgmt, realtors, Airbnb", icon: RiHandHeartLine },
];

const FACILITY_TYPES = [
  "Office", "Retail", "Medical / Dental", "Restaurant / Food", "Gym / Fitness",
  "Salon / Spa", "School / Daycare", "Warehouse / Industrial", "Church / Worship",
  "Property — unit turnover", "Airbnb / Short-term rental", "Other",
];

const FREQUENCIES = [
  { id: "one-time", label: "One-time" },
  { id: "weekly", label: "Weekly" },
  { id: "biweekly", label: "Bi-weekly" },
  { id: "monthly", label: "Monthly" },
  { id: "quarterly", label: "Quarterly" },
  { id: "custom", label: "Custom cadence" },
];

const BILLING_TERMS = [
  { id: "on_receipt", label: "Due on receipt" },
  { id: "net_15", label: "Net 15" },
  { id: "net_30", label: "Net 30" },
  { id: "none", label: "No invoice (handled off-platform)" },
];

const TIME_WINDOWS = [
  "8:00 AM - 12:00 PM",
  "12:00 PM - 4:00 PM",
  "4:00 PM - 8:00 PM",
  "After hours / overnight",
];

interface BusinessAccount {
  id: string;
  account_type: AccountType;
  business_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  facility_type: string | null;
  square_footage: number | null;
  default_rate_cents: number | null;
  recurring_frequency: string | null;
  billing_terms: string | null;
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const isValidEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
const digits = (s: string) => s.replace(/\D/g, "");

export default function CommercialBooking() {
  const { user } = useAuth();

  const [accountType, setAccountType] = useState<AccountType>("commercial");
  const [accountMode, setAccountMode] = useState<"new" | "existing">("new");

  // Account search / selection
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<BusinessAccount[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<BusinessAccount | null>(null);

  // Account fields (new or editing)
  const [businessName, setBusinessName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [stateVal, setStateVal] = useState("");
  const [zipCode, setZipCode] = useState("");

  // Service scope
  const [facilityType, setFacilityType] = useState("");
  const [squareFootage, setSquareFootage] = useState("");
  const [scopeNotes, setScopeNotes] = useState("");
  const [frequency, setFrequency] = useState("one-time");
  const [quoteDollars, setQuoteDollars] = useState("");
  const [billingTerms, setBillingTerms] = useState("on_receipt");

  // Schedule
  const [serviceDate, setServiceDate] = useState("");
  const [timeWindow, setTimeWindow] = useState(TIME_WINDOWS[0]);
  const [accessNotes, setAccessNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ bookingId: string; accountId: string } | null>(null);

  const isRecurring = frequency !== "one-time";
  const quoteCents = Math.round((parseFloat(quoteDollars) || 0) * 100);

  // ── Search existing accounts ──────────────────────────────────────────
  useEffect(() => {
    if (accountMode !== "existing") return;
    setSearching(true);
    const t = setTimeout(async () => {
      const q = search.trim();
      let query = (supabase.from as any)("business_accounts")
        .select("*")
        .eq("account_type", accountType)
        .order("created_at", { ascending: false })
        .limit(15);
      if (q) {
        query = (supabase.from as any)("business_accounts")
          .select("*")
          .eq("account_type", accountType)
          .or(`business_name.ilike.%${q}%,email.ilike.%${q}%,contact_name.ilike.%${q}%`)
          .limit(15);
      }
      const { data } = await query;
      setSearching(false);
      setResults((data as BusinessAccount[]) || []);
    }, 250);
    return () => clearTimeout(t);
  }, [search, accountMode, accountType]);

  const applyAccount = (a: BusinessAccount) => {
    setSelectedAccount(a);
    setBusinessName(a.business_name || "");
    setContactName(a.contact_name || "");
    setEmail(a.email || "");
    setPhone(a.phone || "");
    setAddress(a.address || "");
    setCity(a.city || "");
    setStateVal(a.state || "");
    setZipCode(a.zip_code || "");
    setFacilityType(a.facility_type || "");
    setSquareFootage(a.square_footage ? String(a.square_footage) : "");
    if (a.recurring_frequency) setFrequency(a.recurring_frequency);
    if (a.billing_terms) setBillingTerms(a.billing_terms);
    if (a.default_rate_cents) setQuoteDollars((a.default_rate_cents / 100).toFixed(2));
  };

  const requirements = useMemo(() => {
    const r: string[] = [];
    if (!businessName.trim()) r.push("Business name");
    if (!isValidEmail(email)) r.push("Valid billing email");
    if (digits(phone).length < 10) r.push("Phone");
    if (!address.trim() || !city.trim() || !stateVal.trim() || digits(zipCode).length < 5) r.push("Service address");
    if (!serviceDate) r.push("Service date");
    if (billingTerms !== "none" && quoteCents < 100) r.push("Quote amount");
    return r;
  }, [businessName, email, phone, address, city, stateVal, zipCode, serviceDate, billingTerms, quoteCents]);

  const canSubmit = requirements.length === 0;

  const handleSubmit = async () => {
    if (!canSubmit) {
      toast.error("Complete the required fields first.");
      return;
    }
    setSubmitting(true);
    setResult(null);
    try {
      const nameParts = contactName.trim().split(/\s+/);
      const firstName = nameParts[0] || businessName.trim();
      const lastName = nameParts.slice(1).join(" ") || "(business)";
      const phoneDigits = digits(phone);
      const sqft = squareFootage ? parseInt(squareFootage, 10) : null;

      // 1. Resolve the business account (create new or reuse selected).
      let accountId = selectedAccount?.id || null;
      const accountPayload = {
        account_type: accountType,
        business_name: businessName.trim(),
        contact_name: contactName.trim() || null,
        email: email.trim().toLowerCase(),
        phone: phoneDigits,
        address: address.trim(),
        city: city.trim(),
        state: stateVal.trim().toUpperCase(),
        zip_code: zipCode.trim(),
        facility_type: facilityType || null,
        square_footage: sqft,
        billing_terms: billingTerms,
        default_rate_cents: quoteCents || null,
        recurring_frequency: isRecurring ? frequency : null,
        status: "active",
      };

      if (accountId) {
        await (supabase.from as any)("business_accounts").update(accountPayload).eq("id", accountId);
      } else {
        const { data: acct, error: acctErr } = await (supabase.from as any)("business_accounts")
          .insert({ ...accountPayload, created_by: user?.id || null })
          .select("id")
          .single();
        if (acctErr) throw acctErr;
        accountId = acct.id;
      }

      // 2. Create the booking tied to that account.
      const depositCents = billingTerms === "none" ? 0 : quoteCents;
      const bookingRow = {
        booking_type: accountType,
        business_account_id: accountId,
        business_name: businessName.trim(),
        facility_type: facilityType || null,
        square_footage: sqft,
        custom_quote_cents: quoteCents || null,
        is_recurring: isRecurring,
        recurring_frequency: isRecurring ? frequency : null,
        email: email.trim().toLowerCase(),
        first_name: firstName,
        last_name: lastName,
        phone: phoneDigits,
        address: address.trim(),
        city: city.trim(),
        state: stateVal.trim().toUpperCase(),
        zip_code: zipCode.trim(),
        home_size_id: "commercial",
        service_type: "commercial",
        service_date: serviceDate,
        time_slot: timeWindow,
        arrival_window: timeWindow,
        base_price_cents: quoteCents,
        deposit_cents: depositCents,
        total_estimate_cents: quoteCents,
        status: billingTerms === "none" ? "confirmed" : "pending_payment",
        access_notes: accessNotes.trim() || null,
        team_notes: `${accountType.toUpperCase()} booking · ${facilityType || "facility"} · ${sqft ? sqft + " sqft · " : ""}${frequency}${scopeNotes ? " · " + scopeNotes : ""}`.slice(0, 500),
        booking_channel: "admin_commercial",
      };

      const { data: booking, error: bookingErr } = await (supabase.from as any)("bookings")
        .insert(bookingRow)
        .select("id")
        .single();
      if (bookingErr) throw bookingErr;

      // 3. Best-effort GHL sync so the B2B job lands in the pipeline too.
      try {
        await supabase.functions.invoke("sync-to-ghl", {
          body: {
            kind: "booking",
            payload: {
              firstName, lastName, email: email.trim().toLowerCase(), phone: phoneDigits,
              address: address.trim(), city: city.trim(), state: stateVal.trim().toUpperCase(), zipCode: zipCode.trim(),
              bookingId: booking.id, serviceType: "commercial",
              cleaningType: `${accountType} · ${facilityType || "facility"}`,
              serviceDate, timeSlot: timeWindow,
              frequency: isRecurring ? "recurring" : "one-time",
              quotedPriceCents: quoteCents, totalCents: quoteCents, depositPaid: false,
              customerSource: "Internal — Commercial", market: stateVal.trim().toUpperCase(),
              businessName: businessName.trim(),
              // Account type and cadence are both custom fields; the tags say
              // who this contact is and which partner account type they hold.
              // Anything outside the vocabulary in _shared/ghl-tags.ts is
              // dropped server-side, so inventing one here does nothing.
              tags: ["customer", `account-${accountType}`],
            },
          },
        });
      } catch (e) {
        console.warn("[CommercialBooking] GHL sync failed (non-blocking)", e);
      }

      setResult({ bookingId: booking.id, accountId: accountId as string });
      toast.success(`${ACCOUNT_TYPES.find((t) => t.id === accountType)?.label} booking created.`);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      toast.error(`Could not create booking: ${m}`);
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setResult(null);
    setSelectedAccount(null);
    setBusinessName(""); setContactName(""); setEmail(""); setPhone("");
    setAddress(""); setCity(""); setStateVal(""); setZipCode("");
    setFacilityType(""); setSquareFootage(""); setScopeNotes("");
    setFrequency("one-time"); setQuoteDollars(""); setBillingTerms("on_receipt");
    setServiceDate(""); setTimeWindow(TIME_WINDOWS[0]); setAccessNotes("");
  };

  if (result) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        <SEO title="Commercial Booking Created" noindex />
        <Card className="border-emerald-200 shadow-lg">
          <CardContent className="py-10 text-center space-y-4">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-emerald-100 flex items-center justify-center">
              <RiCheckboxCircleLine className="w-8 h-8 text-emerald-600" />
            </div>
            <h2 className="text-2xl font-bold">Booking created</h2>
            <p className="text-sm text-muted-foreground">
              {ACCOUNT_TYPES.find((t) => t.id === accountType)?.label} job for{" "}
              <span className="font-semibold text-foreground">{businessName}</span> is in.
              {isRecurring && ` Recurring ${frequency} — the account is saved for future bookings.`}
            </p>
            <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground font-mono">
              Booking {result.bookingId.slice(0, 8)} · Account {result.accountId.slice(0, 8)}
            </div>
            <div className="flex gap-3 justify-center pt-2">
              <Button onClick={resetForm} className="bg-gradient-primary">Create another</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <SEO title="Commercial Booking" noindex />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Commercial &amp; Partnership Booking</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Book offices, commercial facilities, and partnership accounts with custom pricing and recurring contracts.
        </p>
      </div>

      {/* Account type */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {ACCOUNT_TYPES.map((t) => {
          const Icon = t.icon;
          const active = accountType === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => { setAccountType(t.id); setSelectedAccount(null); }}
              className={cn(
                "rounded-xl border-2 p-4 text-left transition-all",
                active ? "border-primary bg-primary/5 shadow-sm" : "border-border hover:border-primary/30",
              )}
            >
              <Icon className={cn("w-6 h-6 mb-2", active ? "text-primary" : "text-muted-foreground")} />
              <p className="font-semibold text-sm">{t.label}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{t.sub}</p>
            </button>
          );
        })}
      </div>

      {/* Account */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            Account
            <div className="flex gap-1 text-xs">
              <button
                type="button"
                onClick={() => { setAccountMode("new"); setSelectedAccount(null); }}
                className={cn("px-2.5 py-1 rounded-md", accountMode === "new" ? "bg-primary text-white" : "bg-muted text-muted-foreground")}
              >New</button>
              <button
                type="button"
                onClick={() => setAccountMode("existing")}
                className={cn("px-2.5 py-1 rounded-md", accountMode === "existing" ? "bg-primary text-white" : "bg-muted text-muted-foreground")}
              >Existing</button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {accountMode === "existing" && (
            <div className="space-y-2">
              <div className="relative">
                <RiSearchLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by business name, contact, or email" className="pl-9" />
              </div>
              {searching && <p className="text-xs text-muted-foreground">Searching…</p>}
              <div className="space-y-1.5 max-h-56 overflow-auto">
                {results.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => applyAccount(a)}
                    className={cn(
                      "w-full text-left rounded-lg border p-2.5 text-sm hover:border-primary/40 transition-colors",
                      selectedAccount?.id === a.id ? "border-primary bg-primary/5" : "border-border",
                    )}
                  >
                    <span className="font-medium">{a.business_name}</span>
                    <span className="text-muted-foreground"> · {a.city || ""}{a.state ? `, ${a.state}` : ""}</span>
                    {a.default_rate_cents ? <span className="text-emerald-600 ml-1">{usd(a.default_rate_cents)}</span> : null}
                  </button>
                ))}
                {!searching && results.length === 0 && (
                  <p className="text-xs text-muted-foreground">No matching accounts. Switch to “New” to create one.</p>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Business name *"><Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Acme Dental Group" /></Field>
            <Field label="Primary contact"><Input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Jane Doe" /></Field>
            <Field label="Billing email *"><Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ap@acme.com" /></Field>
            <Field label="Phone *"><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(301) 555-0100" /></Field>
          </div>
          <Field label="Service address *"><Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="123 Commerce Blvd, Suite 200" /></Field>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="City *"><Input value={city} onChange={(e) => setCity(e.target.value)} /></Field>
            <Field label="State *"><Input value={stateVal} onChange={(e) => setStateVal(e.target.value.toUpperCase())} maxLength={2} placeholder="MD" /></Field>
            <Field label="ZIP *"><Input value={zipCode} onChange={(e) => setZipCode(e.target.value)} maxLength={5} placeholder="21044" /></Field>
          </div>
        </CardContent>
      </Card>

      {/* Scope & pricing */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Scope &amp; pricing</CardTitle>
          <CardDescription>Commercial pricing is custom — enter the negotiated quote.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Facility type">
              <Select value={facilityType} onValueChange={setFacilityType}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>{FACILITY_TYPES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Square footage"><Input value={squareFootage} onChange={(e) => setSquareFootage(e.target.value)} inputMode="numeric" placeholder="5000" /></Field>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Frequency">
              <Select value={frequency} onValueChange={setFrequency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{FREQUENCIES.map((f) => <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label={isRecurring ? "Rate per visit ($) *" : "Quote total ($) *"}>
              <Input value={quoteDollars} onChange={(e) => setQuoteDollars(e.target.value)} inputMode="decimal" placeholder="450.00" />
            </Field>
          </div>
          {isRecurring && (
            <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 p-2.5 text-xs text-primary">
              <RiRepeatLine className="w-4 h-4" />
              Recurring {frequency} contract — the account &amp; rate are saved for future visits.
            </div>
          )}
          <Field label="Scope / checklist notes">
            <Textarea value={scopeNotes} onChange={(e) => setScopeNotes(e.target.value)} rows={2} placeholder="Restrooms, breakroom, floors, trash, glass…" />
          </Field>
          <Field label="Billing terms">
            <Select value={billingTerms} onValueChange={setBillingTerms}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{BILLING_TERMS.map((b) => <SelectItem key={b.id} value={b.id}>{b.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
        </CardContent>
      </Card>

      {/* Schedule */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Schedule</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="First service date *"><Input type="date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} /></Field>
            <Field label="Arrival window">
              <Select value={timeWindow} onValueChange={setTimeWindow}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TIME_WINDOWS.map((w) => <SelectItem key={w} value={w}>{w}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Access notes"><Textarea value={accessNotes} onChange={(e) => setAccessNotes(e.target.value)} rows={2} placeholder="Suite #, lockbox, alarm code, dock entrance, point of contact on-site…" /></Field>
        </CardContent>
      </Card>

      {/* Submit */}
      <Card className="border-primary/20">
        <CardContent className="py-5 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <p className="text-sm text-muted-foreground">{isRecurring ? `Recurring · ${frequency}` : "One-time"}</p>
              <p className="text-2xl font-bold text-primary">{quoteCents > 0 ? usd(quoteCents) : "—"}{isRecurring ? " / visit" : ""}</p>
            </div>
            {requirements.length > 0 && (
              <div className="text-left sm:text-right text-xs text-amber-600 sm:max-w-[55%]">
                Still needed: {requirements.join(" · ")}
              </div>
            )}
          </div>
          <Button onClick={handleSubmit} disabled={!canSubmit || submitting} className="w-full h-12 bg-gradient-primary">
            {submitting ? <><RiLoader4Line className="w-4 h-4 mr-2 animate-spin" /> Creating…</> : <>Create {ACCOUNT_TYPES.find((t) => t.id === accountType)?.label} booking <RiArrowRightLine className="w-4 h-4 ml-2" /></>}
          </Button>
          {selectedAccount && <p className="text-[11px] text-center text-muted-foreground">Using saved account · its rate &amp; terms will be updated to match this booking.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</Label>
      {children}
    </div>
  );
}
