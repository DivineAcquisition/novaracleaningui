"use client";

import {
  RiArrowRightLine,
  RiCalendarLine,
  RiCheckboxCircleLine,
  RiHome4Line,
  RiInformationLine,
  RiLoader4Line,
  RiMoneyDollarCircleLine,
  RiPriceTag3Line,
  RiSearchLine,
  RiSparklingLine,
  RiToolsLine,
  RiUserLine,
  RiWalletLine,
} from "@remixicon/react";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";

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
import { SchedulePicker } from "@/components/booking/SchedulePicker";
import { SEO } from "@/components/SEO";
import { cn } from "@/lib/utils";
import {
  HOME_SIZE_RANGES,
  SERVICE_TIER_PRICING,
  ADD_ONS as ADD_ON_DEFS,
  getServicePrice,
  calculatePrice,
} from "@/lib/pricing-system";

// ─── Types & constants ───────────────────────────────────────────────

type ServiceType = "standard" | "deep" | "moveInOut" | "combo";

type InvoiceMode = "deposit_plus_remaining" | "full_now" | "none";

const SERVICE_TYPE_OPTIONS: { id: ServiceType; label: string }[] = [
  { id: "standard", label: SERVICE_TIER_PRICING.standard.label },
  { id: "deep", label: SERVICE_TIER_PRICING.deep.label },
  { id: "moveInOut", label: SERVICE_TIER_PRICING.moveInOut.label },
  { id: "combo", label: SERVICE_TIER_PRICING.combo.label },
];

const ADD_ON_LIST = (Object.keys(ADD_ON_DEFS) as Array<keyof typeof ADD_ON_DEFS>).map(
  (id) => ({
    id,
    label: ADD_ON_DEFS[id].label,
    priceCents: ADD_ON_DEFS[id].price * 100,
  }),
);

const INVOICE_MODES: { id: InvoiceMode; label: string; desc: string }[] = [
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
    desc: "Booker will collect payment another way.",
  },
];

const DWELLING_TYPES = [
  { value: "house", label: "House" },
  { value: "apartment", label: "Apartment" },
  { value: "condo", label: "Condo" },
  { value: "townhome", label: "Townhome" },
  { value: "other", label: "Other" },
];

const PETS_OPTIONS = [
  { value: "none", label: "None" },
  { value: "cats", label: "Cats" },
  { value: "dogs", label: "Dogs" },
  { value: "both", label: "Both" },
];

const FLOORING_OPTIONS = [
  { value: "hardwood", label: "Hardwood" },
  { value: "tile", label: "Tile" },
  { value: "carpet", label: "Carpet" },
  { value: "lvp", label: "LVP" },
  { value: "mixed", label: "Mixed" },
];

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

type LeadHydration = LeadRow & {
  preferred_date?: string;
  preferred_time?: string;
  bedrooms?: number;
  bathrooms?: number;
  sqft?: number;
  special_requests?: string;
};

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

// ─── Page ────────────────────────────────────────────────────────────

export default function VaBooking() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const leadIdParam = searchParams.get("lead_id");

  // Lead lookup
  const [searchQuery, setSearchQuery] = useState("");
  const [recentLeads, setRecentLeads] = useState<LeadRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [linkedLead, setLinkedLead] = useState<LeadRow | null>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      const baseSelect =
        "id, first_name, last_name, email, phone, zip_code, service_type, lead_score, status, source";
      let query = supabase
        .from("leads")
        .select(baseSelect)
        .order("created_at", { ascending: false })
        .limit(20);
      const q = searchQuery.trim();
      if (q) {
        const digits = digitsOnly(q);
        const filters: string[] = [
          `first_name.ilike.%${q}%`,
          `last_name.ilike.%${q}%`,
          `email.ilike.%${q}%`,
        ];
        if (digits) filters.push(`phone.ilike.%${digits}%`);
        query = supabase
          .from("leads")
          .select(baseSelect)
          .or(filters.join(","))
          .order("created_at", { ascending: false })
          .limit(20);
      }
      setSearching(true);
      const { data, error } = await query;
      setSearching(false);
      if (!error && data) setRecentLeads(data as unknown as LeadRow[]);
    }, 200);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Customer fields
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [addressLat, setAddressLat] = useState<number | null>(null);
  const [addressLng, setAddressLng] = useState<number | null>(null);
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zipCode, setZipCode] = useState("");

  // Service fields
  const [homeSizeId, setHomeSizeId] = useState("1501_2000");
  const [serviceType, setServiceType] = useState<ServiceType>("standard");
  const [addOns, setAddOns] = useState<string[]>([]);
  const [frequency, setFrequency] = useState("one-time");
  const [bedrooms, setBedrooms] = useState("");
  const [bathrooms, setBathrooms] = useState("");

  // Schedule fields
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [selectedTime, setSelectedTime] = useState<string | undefined>(undefined);
  const [accessNotes, setAccessNotes] = useState("");
  const [teamNotes, setTeamNotes] = useState("");

  // Property details
  const [dwellingType, setDwellingType] = useState<string>("");
  const [pets, setPets] = useState<string>("none");
  const [flooring, setFlooring] = useState<string[]>([]);
  const [parkingNotes, setParkingNotes] = useState("");
  const [suppliesProvidedBy, setSuppliesProvidedBy] = useState<"customer" | "novara">(
    "novara",
  );
  const [comboFollowUpDate, setComboFollowUpDate] = useState("");

  // Payment fields
  const [csrName, setCsrName] = useState("");
  const [invoiceMode, setInvoiceMode] = useState<InvoiceMode>(
    "deposit_plus_remaining",
  );
  const [depositPercent, setDepositPercent] = useState("50");
  const [overrideTotal, setOverrideTotal] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [sendConfirmationSms, setSendConfirmationSms] = useState(true);
  const [sendChecklistEmail, setSendChecklistEmail] = useState(true);

  // Wallet credit lookup
  const [walletCreditCents, setWalletCreditCents] = useState(0);
  useEffect(() => {
    const trimmed = email.trim().toLowerCase();
    if (!isValidEmail(trimmed)) {
      setWalletCreditCents(0);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data: cust } = await supabase
          .from("customers")
          .select("id")
          .eq("email", trimmed)
          .maybeSingle();
        if (cancelled || !cust?.id) {
          if (!cancelled) setWalletCreditCents(0);
          return;
        }
        const { data: bal } = await (supabase.rpc as any)(
          "get_customer_credit_balance",
          { _customer_id: cust.id },
        );
        if (cancelled) return;
        const cents = Number(
          (bal as { balance_cents?: number } | null)?.balance_cents || 0,
        );
        setWalletCreditCents(cents);
      } catch {
        if (!cancelled) setWalletCreditCents(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [email]);

  // Hydrate from ?lead_id=…
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
      if (data) applyLead(data as unknown as LeadHydration);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadIdParam]);

  function applyLead(lead: LeadHydration) {
    setLinkedLead(lead);
    setFirstName(lead.first_name || "");
    setLastName(lead.last_name || "");
    setEmail(lead.email || "");
    setPhone(lead.phone || "");
    setZipCode(lead.zip_code || "");
    if (lead.service_type) {
      const st = lead.service_type as ServiceType;
      if (["standard", "deep", "moveInOut", "combo"].includes(st)) {
        setServiceType(st);
      }
    }
    if (lead.preferred_date) {
      const d = new Date(`${lead.preferred_date}T12:00:00`);
      if (!Number.isNaN(d.getTime())) setSelectedDate(d);
    }
    if (lead.preferred_time) setSelectedTime(lead.preferred_time);
    if (lead.bedrooms) setBedrooms(String(lead.bedrooms));
    if (lead.bathrooms) setBathrooms(String(lead.bathrooms));
    if (lead.special_requests) setAccessNotes(lead.special_requests);
    toast.success(`Loaded lead — ${lead.first_name || "(no name)"}`);
  }

  // Live pricing — driven by pricing-system.ts (Zone B, no membership)
  const pricing = useMemo(() => {
    const calc = calculatePrice(homeSizeId, serviceType, addOns, "none", false, false, 0);
    const baseCents = Math.round(calc.basePrice * 100);
    const serviceCents = Math.round((calc.basePrice + calc.serviceAddition) * 100);
    const addOnsCents = Math.round(calc.addOnsTotal * 100);
    const subtotalCents = Math.round(calc.subtotal * 100);
    const newCustomerDiscountCents = Math.round(calc.newCustomerDiscount * 100);
    const computedCents = Math.round(calc.total * 100);

    const overrideCents = overrideTotal.trim()
      ? Math.round(parseFloat(overrideTotal) * 100)
      : null;
    const totalCents =
      overrideCents !== null && overrideCents >= 0 ? overrideCents : computedCents;

    const pct =
      Math.max(0, Math.min(100, parseFloat(depositPercent) || 50)) / 100;
    const depositCents =
      invoiceMode === "full_now"
        ? totalCents
        : invoiceMode === "none"
          ? 0
          : Math.round(totalCents * pct);
    const remainingCents = totalCents - depositCents;

    return {
      baseCents,
      serviceCents,
      addOnsCents,
      subtotalCents,
      newCustomerDiscountCents,
      computedCents,
      totalCents,
      depositCents,
      remainingCents,
    };
  }, [homeSizeId, serviceType, addOns, overrideTotal, depositPercent, invoiceMode]);

  const previewServicePriceCents = useMemo(
    () => getServicePrice(homeSizeId, serviceType, "B") * 100,
    [homeSizeId, serviceType],
  );

  // Submit
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<any>(null);

  const phoneDigits = digitsOnly(phone);
  const zipDigits = digitsOnly(zipCode);

  const requirements = useMemo(() => {
    const list: string[] = [];
    if (!firstName.trim()) list.push("First name");
    if (!isValidEmail(email)) list.push("Valid email");
    if (phoneDigits.length < 10) list.push("Phone (10+ digits)");
    if (zipDigits.length !== 5) list.push("ZIP (5 digits)");
    if (!homeSizeId) list.push("Home size");
    if (!serviceType) list.push("Service type");
    if (!selectedDate) list.push("Service date");
    if (!selectedTime) list.push("Time slot");
    return list;
  }, [
    firstName,
    email,
    phoneDigits,
    zipDigits,
    homeSizeId,
    serviceType,
    selectedDate,
    selectedTime,
  ]);

  const canSubmit = requirements.length === 0;

  const handleSubmit = async () => {
    if (!canSubmit) {
      toast.error("Fill out all required fields before submitting.");
      return;
    }
    setSubmitting(true);
    setResult(null);
    try {
      const serviceDate = selectedDate ? format(selectedDate, "yyyy-MM-dd") : "";
      const payload: Record<string, unknown> = {
        leadId: linkedLead?.id || leadIdParam || undefined,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim().toLowerCase(),
        phone,
        address,
        addressLat: addressLat ?? undefined,
        addressLng: addressLng ?? undefined,
        city,
        state,
        zipCode,
        homeSizeId,
        serviceType,
        addOns,
        frequency,
        serviceDate,
        timeSlot: selectedTime,
        bedrooms: bedrooms ? parseInt(bedrooms) : undefined,
        bathrooms: bathrooms ? parseFloat(bathrooms) : undefined,
        accessNotes,
        teamNotes,
        csrName,
        invoiceMode,
        depositPercent: parseFloat(depositPercent) / 100,
        promoCode: promoCode.trim().toLowerCase() || undefined,
        propertyDetails: {
          dwellingType: dwellingType || undefined,
          pets,
          flooring,
          parkingNotes,
          suppliesProvidedBy,
          comboFollowUpDate:
            serviceType === "combo" && comboFollowUpDate
              ? comboFollowUpDate
              : undefined,
        },
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
      toast.success(
        `Booking created — ${data?.bookingNumber || data?.bookingId}`,
      );
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to book: ${m}`);
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Success screen ───────────────────────────────────────────────
  if (result?.success) {
    const homeSizeLabel =
      HOME_SIZE_RANGES.find((h) => h.id === homeSizeId)?.label || homeSizeId;
    const serviceLabel =
      SERVICE_TYPE_OPTIONS.find((s) => s.id === serviceType)?.label || serviceType;
    const serviceDate = selectedDate ? format(selectedDate, "yyyy-MM-dd") : "";
    return (
      <div className="min-h-full">
        <SEO title="Novara Internal Booking" noindex />
        <div className="container max-w-3xl mx-auto px-4 py-10">
          <Card className="border border-slate-200 shadow-sm rounded-2xl overflow-hidden">
            <div className="h-1 w-full bg-gradient-to-r from-emerald-500 via-emerald-400 to-emerald-500" />
            <CardHeader className="text-center pt-10">
              <div className="mx-auto w-16 h-16 rounded-2xl bg-emerald-100 flex items-center justify-center">
                <RiCheckboxCircleLine className="w-9 h-9 text-emerald-600" />
              </div>
              <Badge className="mx-auto mt-4 bg-emerald-100 text-emerald-700 border-0 hover:bg-emerald-100">
                Internal booking created
              </Badge>
              <CardTitle className="font-jakarta text-2xl mt-3 text-slate-900">
                Booking {result.bookingNumber} confirmed
              </CardTitle>
              <CardDescription>
                Email, SMS, and Stripe invoices have been dispatched.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 pb-10">
              <div className="rounded-xl bg-slate-50 p-4 space-y-2 text-sm border border-slate-100">
                <Row label="Customer" value={`${firstName} ${lastName}`.trim()} />
                <Row
                  label="Service"
                  value={`${serviceLabel} — ${homeSizeLabel}`}
                />
                <Row label="When" value={`${serviceDate} ${selectedTime || ""}`} />
                <Row
                  label="Total"
                  value={formatMoney(result.totals?.totalCents ?? pricing.totalCents)}
                />
                <Row
                  label="Deposit"
                  value={formatMoney(
                    result.totals?.depositCents ?? pricing.depositCents,
                  )}
                />
                <Row
                  label="Remaining day-of"
                  value={formatMoney(
                    result.totals?.remainingCents ?? pricing.remainingCents,
                  )}
                />
                {result.ghlContactId && (
                  <Row label="GHL contact" value={result.ghlContactId} mono />
                )}
                {result.ghlOpportunityId && (
                  <Row
                    label="GHL opportunity"
                    value={result.ghlOpportunityId}
                    mono
                  />
                )}
              </div>

              {result.depositInvoice && (
                <InvoiceCard
                  title="Deposit invoice (due today)"
                  amount={result.totals?.depositCents ?? pricing.depositCents}
                  invoiceId={result.depositInvoice.invoiceId}
                  url={result.depositInvoice.hostedInvoiceUrl}
                />
              )}
              {result.remainingInvoice && (
                <InvoiceCard
                  title="Remaining-balance invoice (due day-of)"
                  amount={result.totals?.remainingCents ?? pricing.remainingCents}
                  invoiceId={result.remainingInvoice.invoiceId}
                  url={result.remainingInvoice.hostedInvoiceUrl}
                />
              )}
              {result.fullInvoice && (
                <InvoiceCard
                  title="Full-payment invoice"
                  amount={result.totals?.totalCents ?? pricing.totalCents}
                  invoiceId={result.fullInvoice.invoiceId}
                  url={result.fullInvoice.hostedInvoiceUrl}
                />
              )}

              {result.smsResult && (
                <div className="rounded-xl border border-slate-200 p-4 text-sm">
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
                  onClick={() => setResult(null)}
                >
                  Book another
                </Button>
                <Button
                  className="flex-1"
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

  // ─── Form ─────────────────────────────────────────────────────────
  return (
    <div className="min-h-full pb-24">
      <SEO title="Novara Internal Booking" noindex />

      <div className="container max-w-6xl mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="font-jakarta text-2xl md:text-3xl font-bold tracking-tight text-slate-900">
            Novara Internal Booking
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Premium booking workspace for the Novara internal team — quote,
            schedule, and dispatch in a single flow.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* LEFT: form */}
          <div className="lg:col-span-2 space-y-5">
            {/* Lead lookup */}
            <SectionCard
              title="Look up an existing lead"
              description="Pre-fills the form so you don't have to retype data the customer already gave us."
              icon={<RiSearchLine className="w-4 h-4" />}
            >
              <Input
                placeholder="Search name, email or phone…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searching && <Skeleton className="h-10 w-full" />}
              <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
                {recentLeads.length === 0 && !searching && (
                  <p className="text-xs text-slate-500 p-3">No leads.</p>
                )}
                {recentLeads.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => applyLead(l as LeadHydration)}
                    className={cn(
                      "w-full text-left p-3 hover:bg-slate-50 flex items-center justify-between transition-colors",
                      linkedLead?.id === l.id && "bg-emerald-50/60",
                    )}
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-900">
                        {l.first_name || ""} {l.last_name || ""}
                        {!l.first_name && !l.last_name && (
                          <span className="text-slate-400">(no name)</span>
                        )}
                      </p>
                      <p className="text-xs text-slate-500">
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
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">
                  Linked to lead {linkedLead.id.slice(0, 8)} —{" "}
                  {linkedLead.source || "no source"}.
                </div>
              )}
            </SectionCard>

            {/* Customer */}
            <SectionCard
              title="Customer"
              icon={<RiUserLine className="w-4 h-4" />}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>First name *</Label>
                  <Input
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Last name</Label>
                  <Input
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Email *</Label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  {walletCreditCents > 0 && (
                    <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-medium">
                      <RiWalletLine className="w-3.5 h-3.5" />
                      {formatMoney(walletCreditCents)} wallet credit available —
                      applied automatically
                    </div>
                  )}
                </div>
                <div className="space-y-1.5">
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
                  setAddressLat(typeof addr.lat === "number" ? addr.lat : null);
                  setAddressLng(typeof addr.lng === "number" ? addr.lng : null);
                }}
              />
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>City</Label>
                  <Input value={city} onChange={(e) => setCity(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>State</Label>
                  <Input
                    value={state}
                    onChange={(e) => setState(e.target.value.toUpperCase())}
                    maxLength={2}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>ZIP *</Label>
                  <Input
                    value={zipCode}
                    onChange={(e) => setZipCode(e.target.value)}
                    maxLength={5}
                  />
                </div>
              </div>
            </SectionCard>

            {/* Service */}
            <SectionCard
              title="Service"
              icon={<RiToolsLine className="w-4 h-4" />}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Home size *</Label>
                  <Select value={homeSizeId} onValueChange={setHomeSizeId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {HOME_SIZE_RANGES.filter((h) => h.standardPrice > 0).map(
                        (h) => (
                          <SelectItem key={h.id} value={h.id}>
                            {h.label} — ${h.standardPrice}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Service type *</Label>
                  <Select
                    value={serviceType}
                    onValueChange={(v) => setServiceType(v as ServiceType)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SERVICE_TYPE_OPTIONS.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-slate-500 pt-0.5">
                    Quoted at{" "}
                    <span className="font-medium text-slate-700">
                      {formatMoney(previewServicePriceCents)}
                    </span>{" "}
                    for the selected home size.
                  </p>
                </div>
              </div>

              <div>
                <Label className="mb-2 block">Add-ons</Label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  {ADD_ON_LIST.map((a) => {
                    const checked = addOns.includes(a.id);
                    return (
                      <label
                        key={a.id}
                        className={cn(
                          "rounded-xl border p-3 text-sm cursor-pointer flex items-center justify-between transition-colors",
                          checked
                            ? "border-emerald-500 bg-emerald-50"
                            : "border-slate-200 hover:border-emerald-300",
                        )}
                      >
                        <span>
                          <span className="font-medium text-slate-900">
                            {a.label}
                          </span>
                          <span className="text-xs text-slate-500 ml-2">
                            +{formatMoney(a.priceCents)}
                          </span>
                        </span>
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) =>
                            setAddOns(
                              v
                                ? [...addOns, a.id]
                                : addOns.filter((x) => x !== a.id),
                            )
                          }
                        />
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>Bedrooms</Label>
                  <Input
                    value={bedrooms}
                    onChange={(e) => setBedrooms(e.target.value)}
                    inputMode="numeric"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Bathrooms</Label>
                  <Input
                    value={bathrooms}
                    onChange={(e) => setBathrooms(e.target.value)}
                    inputMode="decimal"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Frequency</Label>
                  <Select value={frequency} onValueChange={setFrequency}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="one-time">One-time</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="biweekly">Bi-weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </SectionCard>

            {/* Schedule — uses the customer flow SchedulePicker */}
            <SectionCard
              title="Schedule"
              description="Real-time availability — same calendar customers see."
              icon={<RiCalendarLine className="w-4 h-4" />}
              bodyClassName="p-0"
            >
              <div className="-mx-6 -mb-6">
                <SchedulePicker
                  selectedDate={selectedDate}
                  selectedTime={selectedTime}
                  onDateSelect={(d) => {
                    setSelectedDate(d);
                    setSelectedTime(undefined);
                  }}
                  onTimeSelect={(_d, slot) => setSelectedTime(slot)}
                />
              </div>
              <div className="px-6 pb-6 pt-4 space-y-3">
                <div className="space-y-1.5">
                  <Label>Access / parking notes (visible to cleaner)</Label>
                  <Textarea
                    value={accessNotes}
                    onChange={(e) => setAccessNotes(e.target.value)}
                    placeholder="Gate code, parking instructions, pet info…"
                    rows={2}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Internal team notes (not shown to customer)</Label>
                  <Textarea
                    value={teamNotes}
                    onChange={(e) => setTeamNotes(e.target.value)}
                    rows={2}
                  />
                </div>
              </div>
            </SectionCard>

            {/* Property details */}
            <SectionCard
              title="Property details"
              description="Optional — helps the cleaning team prep the right kit."
              icon={<RiHome4Line className="w-4 h-4" />}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Dwelling type</Label>
                  <Select value={dwellingType} onValueChange={setDwellingType}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select dwelling type" />
                    </SelectTrigger>
                    <SelectContent>
                      {DWELLING_TYPES.map((d) => (
                        <SelectItem key={d.value} value={d.value}>
                          {d.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Pets</Label>
                  <Select value={pets} onValueChange={setPets}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PETS_OPTIONS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Flooring types</Label>
                <div className="flex flex-wrap gap-2">
                  {FLOORING_OPTIONS.map((f) => {
                    const checked = flooring.includes(f.value);
                    return (
                      <button
                        key={f.value}
                        type="button"
                        onClick={() =>
                          setFlooring(
                            checked
                              ? flooring.filter((x) => x !== f.value)
                              : [...flooring, f.value],
                          )
                        }
                        className={cn(
                          "px-3 py-1.5 rounded-full border text-xs font-medium transition-colors",
                          checked
                            ? "bg-emerald-600 border-emerald-600 text-white"
                            : "bg-white border-slate-200 text-slate-700 hover:border-emerald-300",
                        )}
                      >
                        {f.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Parking notes</Label>
                <Input
                  value={parkingNotes}
                  onChange={(e) => setParkingNotes(e.target.value)}
                  placeholder="Driveway, street, garage code, etc."
                />
              </div>

              <div className="space-y-2">
                <Label>Supplies provided by</Label>
                <RadioGroup
                  value={suppliesProvidedBy}
                  onValueChange={(v) =>
                    setSuppliesProvidedBy(v as "customer" | "novara")
                  }
                  className="grid grid-cols-2 gap-2"
                >
                  {[
                    { id: "novara", label: "Novara" },
                    { id: "customer", label: "Customer" },
                  ].map((opt) => (
                    <label
                      key={opt.id}
                      className={cn(
                        "flex items-center gap-2 p-3 rounded-xl border cursor-pointer text-sm transition-colors",
                        suppliesProvidedBy === opt.id
                          ? "border-emerald-500 bg-emerald-50"
                          : "border-slate-200 hover:border-emerald-300",
                      )}
                    >
                      <RadioGroupItem value={opt.id} />
                      <span className="font-medium text-slate-900">{opt.label}</span>
                    </label>
                  ))}
                </RadioGroup>
              </div>

              {serviceType === "combo" && (
                <div className="space-y-1.5">
                  <Label>Combo follow-up date</Label>
                  <Input
                    type="date"
                    value={comboFollowUpDate}
                    onChange={(e) => setComboFollowUpDate(e.target.value)}
                  />
                  <p className="text-[11px] text-slate-500">
                    Standard Clean follow-up — typically 1–14 days after the
                    Deep Clean.
                  </p>
                </div>
              )}
            </SectionCard>

            {/* Payment */}
            <SectionCard
              title="Payment"
              icon={<RiMoneyDollarCircleLine className="w-4 h-4" />}
            >
              <div>
                <Label>Invoice mode</Label>
                <RadioGroup
                  value={invoiceMode}
                  onValueChange={(v) => setInvoiceMode(v as InvoiceMode)}
                  className="space-y-2 mt-2"
                >
                  {INVOICE_MODES.map((m) => (
                    <label
                      key={m.id}
                      className={cn(
                        "flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors",
                        invoiceMode === m.id
                          ? "border-emerald-500 bg-emerald-50"
                          : "border-slate-200 hover:border-emerald-300",
                      )}
                    >
                      <RadioGroupItem value={m.id} className="mt-0.5" />
                      <div>
                        <p className="font-medium text-sm text-slate-900">
                          {m.label}
                        </p>
                        <p className="text-xs text-slate-500">{m.desc}</p>
                      </div>
                    </label>
                  ))}
                </RadioGroup>
              </div>

              {invoiceMode === "deposit_plus_remaining" && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Deposit % of total</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={depositPercent}
                      onChange={(e) => setDepositPercent(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Override total ($)</Label>
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      value={overrideTotal}
                      onChange={(e) => setOverrideTotal(e.target.value)}
                      placeholder={(pricing.computedCents / 100).toFixed(2)}
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5">
                    <RiPriceTag3Line className="w-3.5 h-3.5 text-emerald-600" />
                    Promo code
                  </Label>
                  <Input
                    value={promoCode}
                    onChange={(e) =>
                      setPromoCode(e.target.value.trim().toLowerCase())
                    }
                    placeholder="e.g. welcome10"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Booker / VA name</Label>
                  <Input
                    value={csrName}
                    onChange={(e) => setCsrName(e.target.value)}
                    placeholder="e.g. Anna VA"
                  />
                </div>
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
                    <span className="text-slate-400 text-xs">
                      (only fires for Standard)
                    </span>
                  )}
                </label>
              </div>
            </SectionCard>
          </div>

          {/* RIGHT: live quote */}
          <div className="lg:col-span-1">
            <div className="lg:sticky lg:top-6 space-y-4">
              <Card className="border border-slate-200 shadow-sm rounded-2xl overflow-hidden">
                <div className="bg-gradient-to-r from-emerald-500 via-emerald-400 to-teal-400 px-5 py-4 text-white">
                  <div className="flex items-center gap-2">
                    <RiSparklingLine className="w-4 h-4" />
                    <p className="font-jakarta font-semibold text-sm tracking-wide">
                      Live quote
                    </p>
                  </div>
                  <p className="text-[11px] text-white/85 mt-0.5">
                    Updates as you change service options.
                  </p>
                </div>
                <CardContent className="space-y-3 pt-5">
                  <Row
                    label={`Base — ${HOME_SIZE_RANGES.find((h) => h.id === homeSizeId)?.label || homeSizeId}`}
                    value={formatMoney(pricing.baseCents)}
                  />
                  <Row
                    label={
                      SERVICE_TYPE_OPTIONS.find((s) => s.id === serviceType)
                        ?.label || serviceType
                    }
                    value={formatMoney(pricing.serviceCents)}
                  />
                  {pricing.addOnsCents > 0 && (
                    <Row
                      label="Add-ons"
                      value={`+${formatMoney(pricing.addOnsCents)}`}
                    />
                  )}
                  {pricing.newCustomerDiscountCents > 0 && (
                    <Row
                      label="New-customer 50% promo"
                      value={`−${formatMoney(pricing.newCustomerDiscountCents)}`}
                      tone="positive"
                    />
                  )}
                  <Separator />
                  <Row
                    label="Total"
                    value={formatMoney(pricing.totalCents)}
                    bold
                  />
                  <Row
                    label="Deposit"
                    value={formatMoney(pricing.depositCents)}
                  />
                  <Row
                    label="Remaining"
                    value={formatMoney(pricing.remainingCents)}
                  />
                  {walletCreditCents > 0 && (
                    <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2 text-xs text-emerald-800 flex items-center gap-1.5">
                      <RiWalletLine className="w-3.5 h-3.5" />
                      {formatMoney(walletCreditCents)} wallet credit will be
                      applied automatically.
                    </div>
                  )}

                  <Button
                    onClick={handleSubmit}
                    disabled={!canSubmit || submitting}
                    variant="default"
                    className="w-full mt-2 h-11"
                  >
                    {submitting ? (
                      <>
                        <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" />
                        Booking…
                      </>
                    ) : (
                      <>
                        Create booking
                        <RiArrowRightLine className="w-4 h-4 ml-2" />
                      </>
                    )}
                  </Button>

                  {!canSubmit && requirements.length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900">
                      <div className="flex items-center gap-1.5 mb-1 font-medium">
                        <RiInformationLine className="w-3.5 h-3.5" />
                        Still needed
                      </div>
                      <ul className="list-disc list-inside space-y-0.5">
                        {requirements.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers / shared bits ────────────────────────────────────────────

function SectionCard({
  title,
  description,
  icon,
  children,
  bodyClassName,
}: {
  title: string;
  description?: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  bodyClassName?: string;
}) {
  return (
    <Card className="border border-slate-200 shadow-sm rounded-2xl overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2.5">
          <span className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-700 inline-flex items-center justify-center">
            {icon}
          </span>
          <CardTitle className="font-jakarta text-base font-semibold text-slate-900">
            {title}
          </CardTitle>
        </div>
        {description && (
          <CardDescription className="pl-[2.375rem] text-xs text-slate-500">
            {description}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className={cn("space-y-3", bodyClassName)}>
        {children}
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  value,
  bold = false,
  mono = false,
  tone,
}: {
  label: string;
  value: string;
  bold?: boolean;
  mono?: boolean;
  tone?: "positive";
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span
        className={cn(
          bold && "font-semibold text-base text-slate-900",
          mono && "font-mono text-xs",
          tone === "positive" && "text-emerald-700 font-medium",
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
    <div className="rounded-xl border border-slate-200 p-4 text-sm space-y-2">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-slate-900">{title}</p>
        <Badge variant="secondary">{formatMoney(amount)}</Badge>
      </div>
      <p className="text-xs text-slate-500 font-mono">{invoiceId}</p>
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
