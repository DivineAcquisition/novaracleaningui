"use client";

import {
  RiArrowLeftLine,
  RiArrowRightLine,
  RiCheckLine,
  RiCalendarLine,
  RiCheckboxCircleLine,
  RiCopperCoinLine,
  RiCopyrightLine,
  RiErrorWarningLine,
  RiHomeLine,
  RiLoader4Line,
  RiPhoneLine,
  RiSearchLine,
  RiShoppingBag3Line,
  RiSparklingLine,
  RiUserAddLine,
  RiUserLine,
} from "@remixicon/react";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { AddressAutocomplete } from "@/components/admin/AddressAutocomplete";
import { SEO } from "@/components/SEO";
import { cn } from "@/lib/utils";

// Pricing must mirror create-payment-intent + book-as-va (source of truth).
const HOME_SIZES = [
  { id: "0_999", label: "Under 1,000 sq ft", base: 27000 },
  { id: "1000_1500", label: "1,000–1,500 sq ft", base: 34200 },
  { id: "1501_2000", label: "1,501–2,000 sq ft", base: 43200 },
  { id: "2001_2500", label: "2,001–2,500 sq ft", base: 50400 },
  { id: "2501_3000", label: "2,501–3,000 sq ft", base: 61200 },
  { id: "3001_3500", label: "3,001–3,500 sq ft", base: 68400 },
  { id: "3501_4000", label: "3,501–4,000 sq ft", base: 79200 },
  { id: "4001_4500", label: "4,001–4,500 sq ft", base: 88200 },
  { id: "4501_5000", label: "4,501–5,000 sq ft", base: 97200 },
] as const;

const SERVICE_TYPES = [
  { id: "standard", label: "Standard Clean", mult: 1.0 },
  { id: "deep", label: "Deep Clean", mult: 1.5 },
  { id: "moveInOut", label: "Move-In / Move-Out", mult: 2.0 },
  { id: "combo", label: "Deep + Standard Combo", mult: 2.5 },
] as const;

const ADD_ONS = [
  { id: "fridge", label: "Inside Fridge", price: 3000 },
  { id: "oven", label: "Inside Oven", price: 3000 },
  { id: "windows", label: "Interior Windows", price: 4000 },
] as const;

const TIME_SLOTS = [
  "8:00 AM - 9:00 AM",
  "9:00 AM - 10:00 AM",
  "10:00 AM - 11:00 AM",
  "11:00 AM - 12:00 PM",
  "12:00 PM - 1:00 PM",
  "1:00 PM - 2:00 PM",
  "2:00 PM - 3:00 PM",
  "3:00 PM - 4:00 PM",
  "4:00 PM - 5:00 PM",
  "5:00 PM - 6:00 PM",
];

const INVOICE_MODES = [
  {
    id: "deposit_plus_remaining",
    label: "Deposit today + Remaining day-of",
    desc: "Two Stripe invoices. Most common.",
  },
  {
    id: "full_now",
    label: "Full payment now",
    desc: "Single invoice billed immediately.",
  },
  {
    id: "none",
    label: "No invoice — book only",
    desc: "VA will collect payment another way.",
  },
] as const;

interface LeadRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  zip_code: string | null;
  service_type: string | null;
  lead_score: string | null;
  status: string | null;
  source: string | null;
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function VaBooking() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const leadIdParam = searchParams.get("lead_id");

  // ─── Lead lookup ──────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [recentLeads, setRecentLeads] = useState<LeadRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [linkedLead, setLinkedLead] = useState<LeadRow | null>(null);

  useEffect(() => {
    const load = async () => {
      let query = supabase
        .from("leads")
        .select(
          "id, first_name, last_name, email, phone, zip_code, service_type, lead_score, status, source",
        )
        .order("created_at", { ascending: false })
        .limit(20);
      if (searchQuery.trim()) {
        const q = searchQuery.trim();
        const digits = q.replace(/[^0-9]/g, "");
        const filters: string[] = [];
        filters.push(`first_name.ilike.%${q}%`);
        filters.push(`last_name.ilike.%${q}%`);
        filters.push(`email.ilike.%${q}%`);
        if (digits) filters.push(`phone.ilike.%${digits}%`);
        query = supabase
          .from("leads")
          .select(
            "id, first_name, last_name, email, phone, zip_code, service_type, lead_score, status, source",
          )
          .or(filters.join(","))
          .order("created_at", { ascending: false })
          .limit(20);
      }
      setSearching(true);
      const { data, error } = await query;
      setSearching(false);
      if (!error && data) setRecentLeads(data as unknown as LeadRow[]);
    };
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // ─── Booking form state ───────────────────────────────────────────
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [homeSizeId, setHomeSizeId] = useState("1501_2000");
  const [serviceType, setServiceType] = useState<
    "standard" | "deep" | "moveInOut" | "combo"
  >("standard");
  const [addOns, setAddOns] = useState<string[]>([]);
  const [frequency, setFrequency] = useState("one-time");
  const [serviceDate, setServiceDate] = useState("");
  const [timeSlot, setTimeSlot] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [bathrooms, setBathrooms] = useState("");
  const [accessNotes, setAccessNotes] = useState("");
  const [teamNotes, setTeamNotes] = useState("");
  const [csrName, setCsrName] = useState("");
  const [invoiceMode, setInvoiceMode] = useState<
    "deposit_plus_remaining" | "full_now" | "none"
  >("deposit_plus_remaining");
  const [depositPercent, setDepositPercent] = useState("50");
  const [overrideTotal, setOverrideTotal] = useState("");
  const [sendConfirmationSms, setSendConfirmationSms] = useState(true);
  const [sendChecklistEmail, setSendChecklistEmail] = useState(true);

  // ─── Hydrate from lead if ?lead_id=… ─────────────────────────────
  useEffect(() => {
    if (!leadIdParam) return;
    (async () => {
      const { data } = await supabase
        .from("leads")
        .select(
          "id, first_name, last_name, email, phone, zip_code, service_type, lead_score, status, source, preferred_date, preferred_time, bedrooms, bathrooms, sqft, special_requests",
        )
        .eq("id", leadIdParam)
        .maybeSingle();
      if (data) {
        applyLead(data as unknown as LeadRow & {
          preferred_date?: string;
          preferred_time?: string;
          bedrooms?: number;
          bathrooms?: number;
          sqft?: number;
          special_requests?: string;
        });
      }
    })();
  }, [leadIdParam]);

  function applyLead(
    lead: LeadRow & {
      preferred_date?: string;
      preferred_time?: string;
      bedrooms?: number;
      bathrooms?: number;
      sqft?: number;
      special_requests?: string;
    },
  ) {
    setLinkedLead(lead);
    setFirstName(lead.first_name || "");
    setLastName(lead.last_name || "");
    setEmail(lead.email || "");
    setPhone(lead.phone || "");
    setZipCode(lead.zip_code || "");
    if (lead.service_type) setServiceType(lead.service_type as typeof serviceType);
    if (lead.preferred_date) setServiceDate(lead.preferred_date);
    if (lead.preferred_time) setTimeSlot(lead.preferred_time);
    if (lead.bedrooms) setBedrooms(String(lead.bedrooms));
    if (lead.bathrooms) setBathrooms(String(lead.bathrooms));
    if (lead.special_requests) setAccessNotes(lead.special_requests);
    toast.success(`Loaded lead — ${lead.first_name || "(no name)"}`);
  }

  // ─── Live pricing ─────────────────────────────────────────────────
  const pricing = useMemo(() => {
    const base = HOME_SIZES.find((h) => h.id === homeSizeId)?.base ?? 0;
    const mult = SERVICE_TYPES.find((s) => s.id === serviceType)?.mult ?? 1;
    const service = Math.round(base * mult);
    const addOnTotal = addOns.reduce(
      (sum, a) => sum + (ADD_ONS.find((x) => x.id === a)?.price ?? 0),
      0,
    );
    const computed = service + addOnTotal;
    const override = overrideTotal.trim()
      ? Math.round(parseFloat(overrideTotal) * 100)
      : null;
    const total = override !== null && override >= 0 ? override : computed;
    const pct = Math.max(0, Math.min(100, parseFloat(depositPercent) || 50)) / 100;
    const deposit = invoiceMode === "full_now"
      ? total
      : invoiceMode === "none"
      ? 0
      : Math.round(total * pct);
    return { base, service, addOnTotal, computed, total, deposit, remaining: total - deposit };
  }, [homeSizeId, serviceType, addOns, overrideTotal, depositPercent, invoiceMode]);

  // ─── Submit ───────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<any>(null);

  const canSubmit = firstName && email && phone && homeSizeId && serviceType &&
    serviceDate && timeSlot;

  const handleSubmit = async () => {
    if (!canSubmit) {
      toast.error("Fill out customer name, email, phone, home size, service type, date and time.");
      return;
    }
    setSubmitting(true);
    setResult(null);
    try {
      const payload: Record<string, unknown> = {
        leadId: linkedLead?.id || leadIdParam || undefined,
        firstName,
        lastName,
        email,
        phone,
        address,
        city,
        state,
        zipCode,
        homeSizeId,
        serviceType,
        addOns,
        frequency,
        serviceDate,
        timeSlot,
        bedrooms: bedrooms ? parseInt(bedrooms) : undefined,
        bathrooms: bathrooms ? parseFloat(bathrooms) : undefined,
        accessNotes,
        teamNotes,
        csrName,
        invoiceMode,
        depositPercent: parseFloat(depositPercent) / 100,
        sendConfirmationSms,
        sendChecklistEmail,
      };
      if (overrideTotal.trim()) {
        payload.priceOverride = {
          total: Math.round(parseFloat(overrideTotal) * 100),
        };
      }
      const { data, error } = await supabase.functions.invoke("book-as-va", {
        body: payload,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setResult(data);
      toast.success(`Booking created — ${data?.bookingNumber || data?.bookingId}`);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to book: ${m}`);
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Success screen ───────────────────────────────────────────────
  if (result?.success) {
    return (
      <div className="min-h-screen bg-background">
        <SEO title="Booking Created" noindex />
        <div className="container max-w-3xl mx-auto px-4 py-12">
          <Card className="border-0 shadow-xl overflow-hidden">
            <div className="h-1 w-full bg-emerald-500" />
            <CardHeader className="text-center pt-10">
              <div className="mx-auto w-16 h-16 rounded-2xl bg-emerald-100 flex items-center justify-center">
                <RiCheckboxCircleLine className="w-9 h-9 text-emerald-600" />
              </div>
              <CardTitle className="text-2xl mt-4">
                Booking {result.bookingNumber} created ✓
              </CardTitle>
              <CardDescription>
                Email, SMS, and Stripe invoices have been dispatched.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 pb-10">
              <div className="rounded-xl bg-muted/40 p-4 space-y-2 text-sm">
                <Row label="Customer" value={`${firstName} ${lastName}`.trim()} />
                <Row label="Service" value={`${SERVICE_TYPES.find((s) => s.id === serviceType)?.label} — ${HOME_SIZES.find((h) => h.id === homeSizeId)?.label}`} />
                <Row label="When" value={`${serviceDate} ${timeSlot}`} />
                <Row label="Total" value={formatMoney(result.totals.totalCents)} />
                <Row label="Deposit" value={formatMoney(result.totals.depositCents)} />
                <Row label="Remaining day-of" value={formatMoney(result.totals.remainingCents)} />
                {result.ghlContactId && (
                  <Row label="GHL contact" value={result.ghlContactId} mono />
                )}
                {result.ghlOpportunityId && (
                  <Row label="GHL opportunity" value={result.ghlOpportunityId} mono />
                )}
              </div>

              {result.depositInvoice && (
                <InvoiceCard
                  title="Deposit invoice (due today)"
                  amount={result.totals.depositCents}
                  invoiceId={result.depositInvoice.invoiceId}
                  url={result.depositInvoice.hostedInvoiceUrl}
                />
              )}
              {result.remainingInvoice && (
                <InvoiceCard
                  title="Remaining-balance invoice (due day-of)"
                  amount={result.totals.remainingCents}
                  invoiceId={result.remainingInvoice.invoiceId}
                  url={result.remainingInvoice.hostedInvoiceUrl}
                />
              )}
              {result.fullInvoice && (
                <InvoiceCard
                  title="Full-payment invoice"
                  amount={result.totals.totalCents}
                  invoiceId={result.fullInvoice.invoiceId}
                  url={result.fullInvoice.hostedInvoiceUrl}
                />
              )}

              {result.smsResult && (
                <div className="rounded-xl border border-border p-4 text-sm">
                  <p className="font-semibold mb-1">Confirmation SMS</p>
                  <p className="text-muted-foreground">
                    {result.smsResult.success
                      ? `Sent via GHL (msg ${result.smsResult.messageId || "—"})`
                      : `Failed: ${result.smsResult.error || JSON.stringify(result.smsResult)}`}
                  </p>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setResult(null);
                  }}
                >
                  Book another
                </Button>
                <Button
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                  onClick={() =>
                    router.push(`/admin/bookings?highlight=${result.bookingId}`)
                  }
                >
                  Open in Bookings
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <SEO title="VA Booking — Admin" noindex />
      <div className="border-b border-border/50 bg-background sticky top-0 z-10">
        <div className="container max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/admin/dashboard")}
            className="-ml-2 text-muted-foreground"
          >
            <RiArrowLeftLine className="w-4 h-4 mr-1.5" /> Dashboard
          </Button>
          <div className="flex items-center gap-2">
            <RiUserAddLine className="w-4 h-4 text-primary" />
            <h1 className="text-base font-semibold">Book a cleaning (VA)</h1>
          </div>
          <div className="w-[100px]" />
        </div>
      </div>

      <div className="container max-w-5xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT: form */}
        <div className="lg:col-span-2 space-y-5">
          {/* Lead lookup */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <RiSearchLine className="w-4 h-4 text-primary" />
                Look up an existing lead
              </CardTitle>
              <CardDescription>
                Pre-fills the form so you don't have to retype data the customer already gave us.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                placeholder="Search name, email or phone…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searching && (
                <Skeleton className="h-10 w-full" />
              )}
              <div className="max-h-56 overflow-y-auto rounded-md border divide-y">
                {recentLeads.length === 0 && !searching && (
                  <p className="text-xs text-muted-foreground p-3">No leads.</p>
                )}
                {recentLeads.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => applyLead(l)}
                    className={cn(
                      "w-full text-left p-3 hover:bg-muted/40 flex items-center justify-between",
                      linkedLead?.id === l.id && "bg-primary/5",
                    )}
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {l.first_name || ""} {l.last_name || ""}
                        {!l.first_name && !l.last_name && (
                          <span className="text-muted-foreground">(no name)</span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {l.phone || l.email || "—"} · {l.zip_code || "?"} ·{" "}
                        {l.source || "?"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {l.lead_score && (
                        <Badge variant="outline" className="text-[10px]">
                          {l.lead_score}
                        </Badge>
                      )}
                      {l.status && (
                        <Badge variant="secondary" className="text-[10px]">
                          {l.status}
                        </Badge>
                      )}
                    </div>
                  </button>
                ))}
              </div>
              {linkedLead && (
                <div className="rounded-md border border-primary/30 bg-primary/5 p-2 text-xs text-primary">
                  Linked to lead {linkedLead.id.slice(0, 8)} —{" "}
                  {linkedLead.source || "no source"}.
                </div>
              )}
            </CardContent>
          </Card>

          {/* Customer */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <RiUserLine className="w-4 h-4 text-primary" /> Customer
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>First name *</Label>
                  <Input
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Last name</Label>
                  <Input
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Email *</Label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Phone *</Label>
                  <Input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+1 301-555-0199"
                  />
                </div>
              </div>
              <AddressAutocomplete
                initialValue={address}
                onAddressSelect={(addr) => {
                  setAddress(addr.street);
                  setCity(addr.city);
                  setState(addr.state);
                  setZipCode(addr.zipCode);
                }}
              />
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>City</Label>
                  <Input value={city} onChange={(e) => setCity(e.target.value)} />
                </div>
                <div>
                  <Label>State</Label>
                  <Input
                    value={state}
                    onChange={(e) => setState(e.target.value.toUpperCase())}
                    maxLength={2}
                  />
                </div>
                <div>
                  <Label>ZIP</Label>
                  <Input
                    value={zipCode}
                    onChange={(e) => setZipCode(e.target.value)}
                    maxLength={5}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Service */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <RiShoppingBag3Line className="w-4 h-4 text-primary" /> Service
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Home size *</Label>
                  <Select value={homeSizeId} onValueChange={setHomeSizeId}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {HOME_SIZES.map((h) => (
                        <SelectItem key={h.id} value={h.id}>{h.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Service type *</Label>
                  <Select
                    value={serviceType}
                    onValueChange={(v) => setServiceType(v as typeof serviceType)}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SERVICE_TYPES.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="mb-2 block">Add-ons</Label>
                <div className="grid grid-cols-3 gap-2">
                  {ADD_ONS.map((a) => {
                    const checked = addOns.includes(a.id);
                    return (
                      <label
                        key={a.id}
                        className={cn(
                          "rounded-lg border p-2 text-sm cursor-pointer flex items-center justify-between",
                          checked
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/30",
                        )}
                      >
                        <span>
                          <span className="font-medium">{a.label}</span>
                          <span className="text-xs text-muted-foreground ml-2">
                            +{formatMoney(a.price)}
                          </span>
                        </span>
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) =>
                            setAddOns(v ? [...addOns, a.id] : addOns.filter((x) => x !== a.id))
                          }
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Bedrooms</Label>
                  <Input
                    value={bedrooms}
                    onChange={(e) => setBedrooms(e.target.value)}
                    inputMode="numeric"
                  />
                </div>
                <div>
                  <Label>Bathrooms</Label>
                  <Input
                    value={bathrooms}
                    onChange={(e) => setBathrooms(e.target.value)}
                    inputMode="decimal"
                  />
                </div>
                <div>
                  <Label>Frequency</Label>
                  <Select value={frequency} onValueChange={setFrequency}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="one-time">One-time</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="biweekly">Bi-weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Schedule */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <RiCalendarLine className="w-4 h-4 text-primary" /> Schedule
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Service date *</Label>
                  <Input
                    type="date"
                    value={serviceDate}
                    onChange={(e) => setServiceDate(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Time slot *</Label>
                  <Select value={timeSlot} onValueChange={setTimeSlot}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pick a window" />
                    </SelectTrigger>
                    <SelectContent>
                      {TIME_SLOTS.map((t) => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Access / parking notes (visible to cleaner)</Label>
                <Textarea
                  value={accessNotes}
                  onChange={(e) => setAccessNotes(e.target.value)}
                  placeholder="Gate code, parking instructions, pet info…"
                  rows={2}
                />
              </div>
              <div>
                <Label>Internal team notes (not shown to customer)</Label>
                <Textarea
                  value={teamNotes}
                  onChange={(e) => setTeamNotes(e.target.value)}
                  rows={2}
                />
              </div>
            </CardContent>
          </Card>

          {/* Payment + delivery */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <RiCopperCoinLine className="w-4 h-4 text-primary" /> Payment
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label>Invoice mode</Label>
                <RadioGroup
                  value={invoiceMode}
                  onValueChange={(v) => setInvoiceMode(v as typeof invoiceMode)}
                  className="space-y-2 mt-2"
                >
                  {INVOICE_MODES.map((m) => (
                    <label
                      key={m.id}
                      className={cn(
                        "flex items-start gap-3 p-3 rounded-lg border cursor-pointer",
                        invoiceMode === m.id
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/30",
                      )}
                    >
                      <RadioGroupItem value={m.id} className="mt-0.5" />
                      <div>
                        <p className="font-medium text-sm">{m.label}</p>
                        <p className="text-xs text-muted-foreground">{m.desc}</p>
                      </div>
                    </label>
                  ))}
                </RadioGroup>
              </div>
              {invoiceMode === "deposit_plus_remaining" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Deposit % of total</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={depositPercent}
                      onChange={(e) => setDepositPercent(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label>Override total ($)</Label>
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      value={overrideTotal}
                      onChange={(e) => setOverrideTotal(e.target.value)}
                      placeholder={(pricing.computed / 100).toFixed(2)}
                    />
                  </div>
                </div>
              )}
              <div>
                <Label>VA / booker name</Label>
                <Input
                  value={csrName}
                  onChange={(e) => setCsrName(e.target.value)}
                  placeholder="e.g. Anna VA"
                />
              </div>
              <div className="space-y-2 pt-1">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={sendConfirmationSms}
                    onCheckedChange={(v) => setSendConfirmationSms(v === true)}
                  />
                  Send confirmation SMS via GHL
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={sendChecklistEmail}
                    onCheckedChange={(v) => setSendChecklistEmail(v === true)}
                  />
                  Send Standard-Clean checklist email
                  {serviceType !== "standard" && (
                    <span className="text-muted-foreground text-xs">
                      (only fires for Standard)
                    </span>
                  )}
                </label>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* RIGHT: live quote + submit */}
        <div className="lg:col-span-1 space-y-5">
          <Card className="lg:sticky lg:top-20">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <RiSparklingLine className="w-4 h-4 text-primary" /> Live quote
              </CardTitle>
              <CardDescription>
                Updates as you change service options.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Row label="Base" value={formatMoney(pricing.base)} />
              <Row label={`${SERVICE_TYPES.find((s) => s.id === serviceType)?.label}`} value={formatMoney(pricing.service)} />
              {pricing.addOnTotal > 0 && (
                <Row label="Add-ons" value={formatMoney(pricing.addOnTotal)} />
              )}
              <Separator />
              <Row label="Total" value={formatMoney(pricing.total)} bold />
              <Row label="Deposit" value={formatMoney(pricing.deposit)} />
              <Row label="Remaining" value={formatMoney(pricing.remaining)} />

              <Button
                onClick={handleSubmit}
                disabled={!canSubmit || submitting}
                className="w-full bg-gradient-primary mt-4 h-11"
              >
                {submitting ? (
                  <>
                    <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" />{" "}
                    Booking…
                  </>
                ) : (
                  <>
                    Create booking <RiArrowRightLine className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
              {!canSubmit && (
                <p className="text-[11px] text-muted-foreground text-center">
                  Fill in customer name + email + phone + service date/time to enable.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  bold = false,
  mono = false,
}: {
  label: string;
  value: string;
  bold?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          bold && "font-semibold text-base",
          mono && "font-mono text-xs",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function InvoiceCard({
  title,
  amount,
  invoiceId,
  url,
}: {
  title: string;
  amount: number;
  invoiceId: string;
  url: string | null;
}) {
  const copy = (s: string) => {
    navigator.clipboard.writeText(s).then(() => toast.success("Copied"));
  };
  return (
    <div className="rounded-xl border border-border p-4 text-sm space-y-2">
      <div className="flex items-center justify-between">
        <p className="font-semibold">{title}</p>
        <Badge variant="secondary">{formatMoney(amount)}</Badge>
      </div>
      <p className="text-xs text-muted-foreground font-mono">{invoiceId}</p>
      {url && (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => copy(url)}
          >
            Copy link
          </Button>
          <Button
            size="sm"
            className="flex-1"
            onClick={() => window.open(url, "_blank", "noopener")}
          >
            Open
          </Button>
        </div>
      )}
    </div>
  );
}
