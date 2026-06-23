"use client";

// ─── /admin/csr — Novara Internal Booking (v3, 2026-05-26) ─────────────
//
// Premium SaaS-feel booking workspace for the internal team. Rebuilt
// after v2 looked busted — this version:
//
//   * drops the `container max-w-6xl` wrapper that double-padded against
//     AdminLayout and gives the page proper breathing room
//   * uses numbered section indicators (1 / 2 / 3 / 4 / 5) so the form
//     reads like a guided checkout, not a wall of cards
//   * replaces the Service Type Select with 4 visual radio cards that
//     show price + multiplier at a glance
//   * ships its own violet-themed compact schedule picker (the
//     customer-flow SchedulePicker is purple-themed and breaks the
//     admin visual rhythm when embedded)
//   * lead lookup is collapsed by default — no noise on mount
//   * uses the canonical pricing-system constants, sends lat/lng,
//     supports promo + wallet credit, and wires all the property-
//     details fields the customer flow asks for
//   * sticky right rail with the live quote in a brand-gradient card,
//     premium CTA, and an inline "still needed" requirements list.

import {
  RiArrowRightLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiCalendarLine,
  RiCheckLine,
  RiCheckboxCircleLine,
  RiCloseLine,
  RiHome4Line,
  RiInformationLine,
  RiLoader4Line,
  RiMoneyDollarCircleLine,
  RiPriceTag3Line,
  RiSaveLine,
  RiSearchLine,
  RiSparklingLine,
  RiToolsLine,
  RiUserLine,
  RiUserSearchLine,
  RiWalletLine,
  RiTimeLine,
  RiSunFoggyLine,
  RiSunLine,
  RiMoonLine,
} from "@remixicon/react";
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
  getDay,
  isBefore,
  isSameDay,
  isSameMonth,
  isWeekend,
  startOfDay,
  startOfMonth,
} from "date-fns";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAvailability } from "@/hooks/use-availability";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DeepCleanPrompt, type DeepCleanChoice } from "@/components/booking/DeepCleanPrompt";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { buildSignedAgreementBase64 } from "@/lib/service-agreement";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { AddressAutocomplete } from "@/components/admin/AddressAutocomplete";
import { SEO } from "@/components/SEO";
import { cn } from "@/lib/utils";
import {
  ADD_ONS as ADD_ON_DEFS,
  HOME_SIZE_RANGES,
  MEMBERSHIP_PRICES,
  SERVICE_TIER_PRICING,
  calculatePrice,
  getServicePrice,
} from "@/lib/pricing-system";

// ─── Types & constants ─────────────────────────────────────────────────

type ServiceType = "standard" | "deep" | "moveInOut" | "combo";
type InvoiceMode =
  | "deposit_plus_remaining"
  | "deposit_plus_preauth"
  | "full_now"
  | "none";

const SERVICE_TYPE_OPTIONS: {
  id: ServiceType;
  label: string;
  subline: string;
  multiplier: number;
}[] = [
  {
    id: "standard",
    label: "Standard Clean",
    subline: "Regular upkeep",
    multiplier: SERVICE_TIER_PRICING.standard.multiplier,
  },
  {
    id: "deep",
    label: "Deep Clean",
    subline: "First-time / refresh",
    multiplier: SERVICE_TIER_PRICING.deep.multiplier,
  },
  {
    id: "moveInOut",
    label: "Move-In / Out",
    subline: "Empty home, deep",
    multiplier: SERVICE_TIER_PRICING.moveInOut.multiplier,
  },
  {
    id: "combo",
    label: "Deep + Standard",
    subline: "Deep + follow-up",
    multiplier: SERVICE_TIER_PRICING.combo.multiplier,
  },
];

const MEMBERSHIP_PLAN_RAIL_LABEL: Record<string, string> = {
  weekly: "Glow Weekly",
  biweekly: "Glow Bi-Weekly",
  monthly: "Glow Monthly",
};

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
    label: "Deposit today + remaining invoiced day-of",
    desc: "Customer pays the deposit invoice today; a second invoice for the remaining balance is auto-sent the morning of service.",
  },
  {
    id: "deposit_plus_preauth",
    label: "Deposit today + auto-charge on completion (pre-auth hold)",
    desc: "Customer pays the deposit AND saves a card on a hosted Stripe page. We place a pre-auth on the remaining balance a few days before service and capture it when admin clicks 'Mark Completed'. Best for repeat customers and gift bookings.",
  },
  {
    id: "full_now",
    label: "Full payment now",
    desc: "Single invoice billed immediately.",
  },
  {
    id: "none",
    label: "No invoice — book only",
    desc: "Booker collects payment another way (cash, off-platform).",
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

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

const TIME_SLOTS = [
  { id: "8:00 AM - 9:00 AM", label: "8 AM", period: "morning" as const },
  { id: "9:00 AM - 10:00 AM", label: "9 AM", period: "morning" as const },
  { id: "10:00 AM - 11:00 AM", label: "10 AM", period: "morning" as const },
  { id: "11:00 AM - 12:00 PM", label: "11 AM", period: "morning" as const },
  { id: "12:00 PM - 1:00 PM", label: "12 PM", period: "afternoon" as const },
  { id: "1:00 PM - 2:00 PM", label: "1 PM", period: "afternoon" as const },
  { id: "2:00 PM - 3:00 PM", label: "2 PM", period: "afternoon" as const },
  { id: "3:00 PM - 4:00 PM", label: "3 PM", period: "afternoon" as const },
  { id: "4:00 PM - 5:00 PM", label: "4 PM", period: "evening" as const },
  { id: "5:00 PM - 6:00 PM", label: "5 PM", period: "evening" as const },
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

const fmtMoney = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const digitsOnly = (s: string) => s.replace(/\D/g, "");
const isValidEmail = (s: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

// ─── Page ──────────────────────────────────────────────────────────────

export default function VaBooking() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const leadIdParam = searchParams.get("lead_id");

  // Lead lookup (collapsed by default)
  const [leadLookupOpen, setLeadLookupOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [leadResults, setLeadResults] = useState<LeadRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [linkedLead, setLinkedLead] = useState<LeadRow | null>(null);

  useEffect(() => {
    if (!leadLookupOpen) {
      setLeadResults([]);
      return;
    }
    const q = searchQuery.trim();
    setSearching(true);
    const t = setTimeout(async () => {
      const baseSelect =
        "id, first_name, last_name, email, phone, zip_code, service_type, lead_score, status, source";
      let query = supabase
        .from("leads")
        .select(baseSelect)
        .order("created_at", { ascending: false })
        .limit(15);
      if (q) {
        const digits = digitsOnly(q);
        const filters = [
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
          .limit(15);
      }
      const { data, error } = await query;
      setSearching(false);
      if (!error && data) setLeadResults(data as unknown as LeadRow[]);
    }, 200);
    return () => clearTimeout(t);
  }, [searchQuery, leadLookupOpen]);

  // Customer
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

  // Service
  const [homeSizeId, setHomeSizeId] = useState("1501_2000");
  const [serviceType, setServiceType] = useState<ServiceType>("standard");
  const [addOns, setAddOns] = useState<string[]>([]);
  const [frequency, setFrequency] = useState("one-time");
  const [deepClean, setDeepClean] = useState<DeepCleanChoice>({ deepCleanedBefore: "", includeDeepClean: true });
  const [bedrooms, setBedrooms] = useState("");
  const [bathrooms, setBathrooms] = useState("");

  // Property
  const [propertyOpen, setPropertyOpen] = useState(false);
  const [dwellingType, setDwellingType] = useState<string>("");
  const [pets, setPets] = useState<string>("none");
  const [flooring, setFlooring] = useState<string[]>([]);
  const [parkingNotes, setParkingNotes] = useState("");
  const [suppliesProvidedBy, setSuppliesProvidedBy] = useState<
    "customer" | "novara"
  >("novara");
  const [comboFollowUpDate, setComboFollowUpDate] = useState("");

  // Schedule
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [selectedTime, setSelectedTime] = useState<string | undefined>(undefined);
  const [accessNotes, setAccessNotes] = useState("");
  const [teamNotes, setTeamNotes] = useState("");

  // Payment
  const [csrName, setCsrName] = useState("");
  const [vaAgreedOnPhone, setVaAgreedOnPhone] = useState(false);
  const [invoiceMode, setInvoiceMode] = useState<InvoiceMode>(
    "deposit_plus_remaining",
  );
  const [depositPercent, setDepositPercent] = useState("50");
  const [overrideTotal, setOverrideTotal] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [sendConfirmationSms, setSendConfirmationSms] = useState(true);
  const [sendChecklistEmail, setSendChecklistEmail] = useState(true);

  // Quote saving
  const [savingQuote, setSavingQuote] = useState(false);
  const [savedQuoteId, setSavedQuoteId] = useState<string | null>(null);

  // Wallet credit
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
    setLeadLookupOpen(false);
    toast.success(`Loaded lead — ${lead.first_name || "(no name)"}`);
  }

  // Live pricing
  //
  // For a recurring frequency this is a MEMBERSHIP, so the headline "total"
  // is the monthly subscription rate (from MEMBERSHIP_PRICES, varies by home
  // size) — NOT the one-time clean total. An override total replaces that
  // monthly rate, and the deposit (when a deposit invoice mode is selected)
  // is a one-time first-clean charge collected on the same Stripe signup.
  const pricing = useMemo(() => {
    const calc = calculatePrice(
      homeSizeId,
      serviceType,
      addOns,
      "none",
      false,
      false,
      0,
    );
    const serviceCents = Math.round((calc.basePrice + calc.serviceAddition) * 100);
    const addOnsCents = Math.round(calc.addOnsTotal * 100);
    const subtotalCents = Math.round(calc.subtotal * 100);
    const oneTimeComputedCents = Math.round(calc.total * 100);

    const isRecurring = frequency !== "one-time";
    const membershipPlan = frequency as "weekly" | "biweekly" | "monthly";
    const membershipMonthlyCents = isRecurring
      ? Math.round((MEMBERSHIP_PRICES[homeSizeId]?.[membershipPlan] ?? 0) * 100)
      : 0;

    // Baseline the override compares against: the membership monthly rate
    // for recurring, otherwise the one-time clean total.
    const computedCents = isRecurring ? membershipMonthlyCents : oneTimeComputedCents;

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
      serviceCents,
      addOnsCents,
      subtotalCents,
      computedCents,
      totalCents,
      depositCents,
      remainingCents,
      isRecurring,
      membershipMonthlyCents,
    };
  }, [homeSizeId, serviceType, addOns, overrideTotal, depositPercent, invoiceMode, frequency]);

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
    if (!selectedDate) list.push("Service date");
    if (!selectedTime) list.push("Time slot");
    if (!vaAgreedOnPhone) list.push("Confirm client agreed (phone)");
    return list;
  }, [firstName, email, phoneDigits, zipDigits, selectedDate, selectedTime, vaAgreedOnPhone]);

  const canSubmit = requirements.length === 0;

  // ─── Recurring membership signup ────────────────────────────────────
  // When the VA selects a recurring frequency, this is a MEMBERSHIP, not
  // a one-time booking. We generate a hosted Stripe subscription Checkout
  // link (same path the public /membership flow uses) for the VA to send
  // to the customer. Once the customer completes it, the stripe-webhook
  // provisions their credits and auto-books the first clean on the exact
  // date the VA picked — so we deliberately do NOT create a duplicate
  // booking or invoice here.
  const handleMembershipSubscribe = async () => {
    if (!canSubmit) {
      toast.error("Fill out all required fields before submitting.");
      return;
    }
    setSubmitting(true);
    setResult(null);
    try {
      const planMap: Record<string, string> = {
        weekly: "weekly",
        biweekly: "biweekly",
        monthly: "monthly",
      };
      const membershipPlan = planMap[frequency];
      if (!membershipPlan) {
        throw new Error(`Unsupported recurring frequency: ${frequency}`);
      }
      const serviceDate = selectedDate ? format(selectedDate, "yyyy-MM-dd") : undefined;
      const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
      const preferredDayOfWeek = selectedDate ? days[selectedDate.getDay()] : undefined;

      // Admin price override + deposit posture. The override replaces the
      // monthly recurring membership rate in the Stripe subscription; the
      // deposit (when a deposit invoice mode is selected) is added as a
      // one-time first-clean charge on the same hosted Checkout so it's
      // collected during the membership signup. Both were previously
      // dropped on the recurring path, so neither reached Stripe.
      const overrideCents = overrideTotal.trim()
        ? Math.round(parseFloat(overrideTotal) * 100)
        : null;
      const wantsDeposit =
        invoiceMode === "deposit_plus_remaining" ||
        invoiceMode === "deposit_plus_preauth";
      const priceOverride: { total?: number; deposit?: number } = {};
      if (overrideCents !== null && overrideCents >= 0) {
        priceOverride.total = overrideCents;
      }
      if (wantsDeposit && pricing.depositCents > 0) {
        priceOverride.deposit = pricing.depositCents;
      }
      const depositPercentFraction =
        Math.max(0, Math.min(100, parseFloat(depositPercent) || 50)) / 100;

      const { data, error } = await supabase.functions.invoke("create-checkout", {
        body: {
          mode: "subscription",
          membershipPlan,
          homeSizeId,
          email: email.trim().toLowerCase(),
          firstName: firstName.trim() || undefined,
          lastName: lastName.trim() || undefined,
          phone: phone || undefined,
          address: address || undefined,
          city: city || undefined,
          state: state || undefined,
          zipCode: zipCode || undefined,
          preferredDayOfWeek,
          preferredTimeWindow: selectedTime || undefined,
          firstServiceDate: serviceDate,
          firstTimeSlot: selectedTime || undefined,
          includeDeepClean: deepClean.includeDeepClean,
          deepCleanedBefore: deepClean.deepCleanedBefore,
          priceOverride: Object.keys(priceOverride).length ? priceOverride : undefined,
          invoiceMode,
          depositPercent: depositPercentFraction,
          csrName: csrName.trim() || undefined,
          promoCode: promoCode.trim().toLowerCase() || undefined,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (!data?.url) throw new Error("No subscription checkout URL returned");

      const notify = (data?.notify || {}) as { sms?: boolean; email?: boolean };
      setResult({
        membershipCheckout: true,
        url: data.url,
        sessionId: data.sessionId,
        membershipPlan,
        monthlyEstimateCents: pricing.totalCents,
        depositCents: priceOverride.deposit ?? 0,
        overrideApplied: priceOverride.total != null,
        notifySms: !!notify.sms,
        notifyEmail: !!notify.email,
      });
      const channels = [notify.sms ? "text" : null, notify.email ? "email" : null].filter(Boolean);
      toast.success(
        channels.length
          ? `Membership link sent to the customer by ${channels.join(" & ")}.`
          : "Subscription link ready — send it to the customer to start their membership.",
      );
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to create subscription link: ${m}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    if (frequency !== "one-time") {
      await handleMembershipSubscribe();
      return;
    }
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

      // One-Time Service Agreement — verbally agreed over the phone. The
      // customer always receives their mapped copy by email.
      try {
        const fullName = `${firstName.trim()} ${lastName.trim()}`.trim() || email.trim();
        const pdfBase64 = await buildSignedAgreementBase64({
          name: fullName,
          email: email.trim().toLowerCase(),
          serviceType,
          serviceDate,
          totalCents: typeof data?.totalCents === "number" ? data.totalCents : (overrideTotal.trim() ? Math.round(parseFloat(overrideTotal) * 100) : undefined),
          depositCents: typeof data?.depositCents === "number" ? data.depositCents : undefined,
          balanceCents: typeof data?.balanceCents === "number" ? data.balanceCents : undefined,
          verbalNote: `Verbally agreed over the phone — recorded by ${csrName.trim() || "Novara VA"} on ${new Date().toLocaleString()}`,
        });
        await supabase.functions.invoke("store-service-agreement", {
          body: {
            bookingId: data?.bookingId,
            email: email.trim().toLowerCase(),
            name: fullName,
            serviceType,
            source: "va_phone",
            agreed: { terms: true, disclaimer: true, refund: true, serviceAgreement: true },
            pdfBase64,
          },
        });
      } catch (agErr) {
        console.error("[VaBooking] agreement store failed", agErr);
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to book: ${m}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveQuote = async () => {
    if (!firstName.trim() || !email.trim() || !homeSizeId || !serviceType) {
      toast.error("Customer name, email, home size, and service type are required to save a quote.");
      return;
    }
    setSavingQuote(true);
    setSavedQuoteId(null);
    try {
      const serviceDate = selectedDate ? format(selectedDate, "yyyy-MM-dd") : undefined;
      const { data, error } = await (supabase as any)
        .from("va_quotes")
        .insert({
          csr_name: csrName.trim() || null,
          lead_id: linkedLead?.id || leadIdParam || null,
          first_name: firstName.trim(),
          last_name: lastName.trim() || null,
          email: email.trim().toLowerCase(),
          phone: phone || null,
          address: address || null,
          city: city || null,
          state: state || null,
          zip_code: zipCode || null,
          home_size_id: homeSizeId,
          service_type: serviceType,
          add_ons: addOns,
          frequency,
          service_date: serviceDate || null,
          time_slot: selectedTime || null,
          base_price_cents: pricing.serviceCents,
          total_estimate_cents: pricing.totalCents,
          notes: null,
          team_notes: teamNotes || null,
          access_notes: accessNotes || null,
          bedrooms: bedrooms ? parseInt(bedrooms) : null,
          bathrooms: bathrooms ? parseFloat(bathrooms) : null,
          dwelling_type: dwellingType || null,
          pets: pets || null,
          status: "draft",
        })
        .select("id")
        .single();
      if (error) throw error;
      setSavedQuoteId(data.id);
      toast.success("Quote saved — you can retrieve it later from this form.");
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to save quote: ${m}`);
    } finally {
      setSavingQuote(false);
    }
  };

  // ─── Membership subscription link screen ────────────────────────────
  if (result?.membershipCheckout) {
    const planLabel = result.membershipPlan
      ? `Glow ${result.membershipPlan.charAt(0).toUpperCase()}${result.membershipPlan.slice(1)}`
      : "Membership";
    const subUrl: string = result.url;
    return (
      <div className="max-w-2xl mx-auto">
        <SEO title="Novara Internal Booking" noindex />
        <Card className="border border-slate-200 shadow-[0_4px_24px_-12px_rgba(15,23,42,0.12)] rounded-2xl overflow-hidden">
          <div className="h-1.5 w-full bg-gradient-to-r from-violet-500 via-violet-400 to-teal-400" />
          <CardHeader className="text-center pt-10">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-violet-50 flex items-center justify-center ring-1 ring-violet-200">
              <RiSparklingLine className="w-7 h-7 text-violet-600" />
            </div>
            <Badge className="mx-auto mt-3 bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-50 font-medium">
              Membership subscription link ready
            </Badge>
            <CardTitle className="font-jakarta text-2xl mt-3 text-slate-900 tracking-tight">
              {planLabel} — {`${firstName} ${lastName}`.trim() || email}
            </CardTitle>
            <CardDescription className="mt-1">
              {result.notifySms || result.notifyEmail ? (
                <>We sent the secure signup link to the customer by{" "}
                  {[result.notifySms ? "text" : null, result.notifyEmail ? "email" : null].filter(Boolean).join(" & ")}.
                  Their first clean auto-books once they subscribe. You can resend below if needed.</>
              ) : (
                <>Send this secure link to the customer to start their recurring
                  membership. Their first clean auto-books once they subscribe.</>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 pb-8">
            <div className="rounded-xl bg-slate-50 p-4 space-y-3 text-sm border border-slate-100">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-white border border-slate-200 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">
                    Monthly {result.overrideApplied ? "(custom)" : ""}
                  </p>
                  <p className="text-sm font-bold text-slate-900 tabular-nums">
                    {fmtMoney(result.monthlyEstimateCents || 0)}/mo
                  </p>
                </div>
                <div className="rounded-lg bg-white border border-slate-200 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">
                    Deposit at signup
                  </p>
                  <p className="text-sm font-bold text-slate-900 tabular-nums">
                    {result.depositCents > 0 ? fmtMoney(result.depositCents) : "—"}
                  </p>
                </div>
              </div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 pt-1">
                Subscription checkout link
              </p>
              <div className="flex items-center gap-2">
                <Input value={subUrl} readOnly className="font-mono text-xs bg-white" />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(subUrl);
                    toast.success("Link copied");
                  }}
                >
                  Copy
                </Button>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <a href={subUrl} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="outline">
                    Open link
                    <RiArrowRightLine className="w-3.5 h-3.5 ml-1.5" />
                  </Button>
                </a>
              </div>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              {result.depositCents > 0 ? (
                <>
                  The customer enters their card on Stripe's hosted page. Their
                  first invoice charges the{" "}
                  <strong>{fmtMoney(result.depositCents)} first-clean deposit</strong>
                  {" "}plus the {fmtMoney(result.monthlyEstimateCents || 0)} monthly
                  membership. Once subscribed, Novara provisions their monthly
                  credits and books the first clean on{" "}
                  {selectedDate ? format(selectedDate, "MMM d, yyyy") : "their preferred day"}
                  {selectedTime ? ` (${selectedTime})` : ""}.
                </>
              ) : (
                <>
                  We don't charge anything here — the customer enters their card
                  on Stripe's hosted page. Once subscribed, Novara provisions
                  their monthly credits and books the first clean on{" "}
                  {selectedDate ? format(selectedDate, "MMM d, yyyy") : "their preferred day"}
                  {selectedTime ? ` (${selectedTime})` : ""}.
                </>
              )}
            </p>
            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setResult(null)}
              >
                Back to form
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Success screen ─────────────────────────────────────────────────
  if (result?.success) {
    const homeSizeLabel =
      HOME_SIZE_RANGES.find((h) => h.id === homeSizeId)?.label || homeSizeId;
    const serviceLabel =
      SERVICE_TYPE_OPTIONS.find((s) => s.id === serviceType)?.label || serviceType;
    const serviceDate = selectedDate ? format(selectedDate, "MMM d, yyyy") : "";
    return (
      <div className="max-w-2xl mx-auto">
        <SEO title="Novara Internal Booking" noindex />
        <Card className="border border-slate-200 shadow-[0_4px_24px_-12px_rgba(15,23,42,0.12)] rounded-2xl overflow-hidden">
          <div className="h-1.5 w-full bg-gradient-to-r from-violet-500 via-violet-400 to-teal-400" />
          <CardHeader className="text-center pt-10">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-violet-50 flex items-center justify-center ring-1 ring-violet-200">
              <RiCheckboxCircleLine className="w-7 h-7 text-violet-600" />
            </div>
            <Badge className="mx-auto mt-3 bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-50 font-medium">
              Internal booking created
            </Badge>
            <CardTitle className="font-jakarta text-2xl mt-3 text-slate-900 tracking-tight">
              Booking #{result.bookingNumber} confirmed
            </CardTitle>
            <CardDescription className="mt-1">
              Email, SMS, and Stripe invoices have been dispatched.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 pb-8">
            <div className="rounded-xl bg-slate-50 p-5 space-y-2 text-sm border border-slate-100">
              <SummaryRow label="Customer" value={`${firstName} ${lastName}`.trim()} />
              <SummaryRow label="Service" value={`${serviceLabel} — ${homeSizeLabel}`} />
              <SummaryRow label="When" value={`${serviceDate} ${selectedTime || ""}`} />
              <Separator className="my-2" />
              <SummaryRow
                label="Total"
                value={fmtMoney(result.totals?.totalCents ?? pricing.totalCents)}
                bold
              />
              <SummaryRow
                label="Deposit"
                value={fmtMoney(
                  result.totals?.depositCents ?? pricing.depositCents,
                )}
              />
              <SummaryRow
                label="Remaining day-of"
                value={fmtMoney(
                  result.totals?.remainingCents ?? pricing.remainingCents,
                )}
              />
            </div>

            {result.depositInvoice && (
              <InvoiceCard
                title="Deposit invoice (due today)"
                amount={result.totals?.depositCents ?? pricing.depositCents}
                invoiceId={result.depositInvoice.invoiceId}
                url={result.depositInvoice.hostedInvoiceUrl}
              />
            )}
            {result.preauthSession && (
              <InvoiceCard
                title="Deposit + saved card (Stripe Checkout)"
                amount={result.totals?.depositCents ?? pricing.depositCents}
                invoiceId={result.preauthSession.id}
                url={result.preauthSession.url}
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
            <p className="text-[11px] text-slate-500 leading-relaxed">
              {result.remainingInvoice
                ? "Remaining-balance invoice was sent immediately (legacy mode)."
                : "Remaining balance is auto-handled per your selected mode — invoice mailed the morning of service (deposit + remaining), or pre-auth captured on Mark Completed (deposit + pre-auth)."}
            </p>

            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setResult(null)}
              >
                Book another
              </Button>
              <Button
                className="flex-1 bg-violet-600 hover:bg-violet-700 text-white"
                onClick={() =>
                  router.push(`/admin/bookings?highlight=${result.bookingId}`)
                }
              >
                Open in Bookings
                <RiArrowRightLine className="w-4 h-4 ml-1.5" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Form ───────────────────────────────────────────────────────────
  return (
    <div className="max-w-[1240px] mx-auto">
      <SEO title="Novara Internal Booking" noindex />

      {/* Page header — SaaS eyebrow + title + actions */}
      <header className="mb-7">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[10px] font-bold tracking-[0.12em] uppercase text-violet-700/80 bg-violet-50 border border-violet-200/70 rounded-full px-2 py-0.5">
            Workspace · Internal
          </span>
          {linkedLead && (
            <Badge className="bg-slate-100 text-slate-700 border-0 hover:bg-slate-100 text-[10px]">
              Lead linked · {linkedLead.id.slice(0, 8)}
            </Badge>
          )}
        </div>
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="font-jakarta text-[28px] leading-tight font-bold tracking-tight text-slate-900">
              Novara Internal Booking
            </h1>
            <p className="text-sm text-slate-500 mt-1 max-w-2xl">
              Build a booking on behalf of a customer — quote, schedule, dispatch,
              and bill in a single flow.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLeadLookupOpen((v) => !v)}
            className="border-slate-200 bg-white"
          >
            <RiUserSearchLine className="w-4 h-4 mr-1.5" />
            {leadLookupOpen ? "Close lead search" : "Search existing lead"}
          </Button>
        </div>
      </header>

      {/* Optional inline lead lookup */}
      {leadLookupOpen && (
        <Card className="mb-6 border border-slate-200 rounded-2xl shadow-sm">
          <CardContent className="p-4 space-y-3">
            <div className="relative">
              <RiSearchLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search by name, email, or phone…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 bg-slate-50 border-slate-200 focus-visible:bg-white"
                autoFocus
              />
            </div>
            <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 max-h-72 overflow-y-auto">
              {searching && <Skeleton className="h-10 w-full m-2" />}
              {!searching && leadResults.length === 0 && (
                <p className="text-xs text-slate-500 p-3">
                  No leads found. Start typing or press × to close.
                </p>
              )}
              {leadResults.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => applyLead(l as LeadHydration)}
                  className={cn(
                    "w-full text-left p-3 hover:bg-slate-50 flex items-center justify-between transition-colors",
                    linkedLead?.id === l.id && "bg-violet-50/60",
                  )}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">
                      {l.first_name || ""} {l.last_name || ""}
                      {!l.first_name && !l.last_name && (
                        <span className="text-slate-400">(no name)</span>
                      )}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                      {l.phone || l.email || "—"} · {l.zip_code || "?"} ·{" "}
                      {l.source || "—"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
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
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* LEFT — form */}
        <div className="xl:col-span-8 space-y-5">
          {/* 1 — Customer */}
          <FormSection
            number={1}
            title="Customer"
            description="Who is this booking for?"
            icon={<RiUserLine className="w-4 h-4" />}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="First name" required>
                <Input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Anthony"
                />
              </Field>
              <Field label="Last name">
                <Input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Sannie"
                />
              </Field>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field
                label="Email"
                required
                rightHint={
                  walletCreditCents > 0
                    ? `${fmtMoney(walletCreditCents)} wallet credit`
                    : undefined
                }
              >
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="customer@email.com"
                />
              </Field>
              <Field label="Phone" required>
                <Input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 301-555-0199"
                />
              </Field>
            </div>
            <div className="relative overflow-visible">
            <AddressAutocomplete
              key="va-service-address"
              label="Service address *"
              placeholder="Start typing the customer's address…"
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
            </div>
            <div className="grid grid-cols-12 gap-4">
              <div className="col-span-12 md:col-span-6">
                <Field label="City">
                  <Input value={city} onChange={(e) => setCity(e.target.value)} />
                </Field>
              </div>
              <div className="col-span-6 md:col-span-3">
                <Field label="State">
                  <Input
                    value={state}
                    onChange={(e) => setState(e.target.value.toUpperCase())}
                    maxLength={2}
                    placeholder="MD"
                  />
                </Field>
              </div>
              <div className="col-span-6 md:col-span-3">
                <Field label="ZIP" required>
                  <Input
                    value={zipCode}
                    onChange={(e) => setZipCode(e.target.value)}
                    maxLength={5}
                    placeholder="21201"
                  />
                </Field>
              </div>
            </div>
          </FormSection>

          {/* 2 — Service */}
          <FormSection
            number={2}
            title="Service"
            description="Type, size, and add-ons. Pricing updates in the rail."
            icon={<RiToolsLine className="w-4 h-4" />}
          >
            <Field label="Home size">
              <Select value={homeSizeId} onValueChange={setHomeSizeId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOME_SIZE_RANGES.filter((h) => h.standardPrice > 0).map((h) => (
                    <SelectItem key={h.id} value={h.id}>
                      <div className="flex w-full items-center justify-between gap-6">
                        <span>{h.label}</span>
                        <span className="text-slate-500 text-xs tabular-nums">
                          from ${h.standardPrice}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <div className="space-y-2">
              <Label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                Service type
              </Label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {SERVICE_TYPE_OPTIONS.map((opt) => {
                  const active = serviceType === opt.id;
                  const previewCents =
                    getServicePrice(homeSizeId, opt.id, "B") * 100;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setServiceType(opt.id)}
                      className={cn(
                        "group relative text-left rounded-xl border p-3 transition-all",
                        active
                          ? "border-violet-500 bg-violet-50 shadow-[0_0_0_3px_rgba(16,163,74,0.12)]"
                          : "border-slate-200 bg-white hover:border-violet-300 hover:bg-slate-50",
                      )}
                    >
                      {active && (
                        <span className="absolute top-2 right-2 w-4 h-4 rounded-full bg-violet-600 text-white inline-flex items-center justify-center">
                          <RiCheckLine className="w-2.5 h-2.5" />
                        </span>
                      )}
                      <p
                        className={cn(
                          "text-sm font-semibold leading-tight",
                          active ? "text-violet-900" : "text-slate-900",
                        )}
                      >
                        {opt.label}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {opt.subline}
                      </p>
                      <p
                        className={cn(
                          "text-sm font-bold tabular-nums mt-2",
                          active ? "text-violet-700" : "text-slate-700",
                        )}
                      >
                        {fmtMoney(previewCents)}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                Add-ons
              </Label>
              <div className="flex flex-wrap gap-2">
                {ADD_ON_LIST.map((a) => {
                  const checked = addOns.includes(a.id);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() =>
                        setAddOns(
                          checked
                            ? addOns.filter((x) => x !== a.id)
                            : [...addOns, a.id],
                        )
                      }
                      className={cn(
                        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors",
                        checked
                          ? "border-violet-500 bg-violet-50 text-violet-900"
                          : "border-slate-200 bg-white text-slate-700 hover:border-violet-300",
                      )}
                    >
                      <span
                        className={cn(
                          "w-4 h-4 rounded-full inline-flex items-center justify-center border",
                          checked
                            ? "bg-violet-600 border-violet-600 text-white"
                            : "border-slate-300",
                        )}
                      >
                        {checked && <RiCheckLine className="w-2.5 h-2.5" />}
                      </span>
                      <span className="font-medium">{a.label}</span>
                      <span className="text-xs text-slate-500 tabular-nums">
                        +{fmtMoney(a.priceCents)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <Field label="Bedrooms">
                <Input
                  value={bedrooms}
                  onChange={(e) => setBedrooms(e.target.value)}
                  inputMode="numeric"
                  placeholder="3"
                />
              </Field>
              <Field label="Bathrooms">
                <Input
                  value={bathrooms}
                  onChange={(e) => setBathrooms(e.target.value)}
                  inputMode="decimal"
                  placeholder="2.5"
                />
              </Field>
              <Field label="Frequency">
                <Select value={frequency} onValueChange={setFrequency}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="one-time">One-time</SelectItem>
                    <SelectItem value="weekly">Weekly · Membership</SelectItem>
                    <SelectItem value="biweekly">Bi-weekly · Membership</SelectItem>
                    <SelectItem value="monthly">Monthly · Membership</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>

            {/* Property details — collapsible */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/40">
              <button
                type="button"
                onClick={() => setPropertyOpen((v) => !v)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-50 rounded-xl"
              >
                <div className="flex items-center gap-2">
                  <RiHome4Line className="w-4 h-4 text-slate-500" />
                  <span className="text-sm font-medium text-slate-700">
                    Property details — dwelling, pets, flooring, supplies
                  </span>
                  <span className="text-[10px] text-slate-500 bg-white border border-slate-200 rounded-full px-1.5 py-0.5">
                    optional
                  </span>
                </div>
                <RiArrowRightLine
                  className={cn(
                    "w-4 h-4 text-slate-400 transition-transform",
                    propertyOpen && "rotate-90",
                  )}
                />
              </button>
              {propertyOpen && (
                <div className="px-4 pb-4 pt-1 space-y-4 border-t border-slate-200">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Field label="Dwelling type">
                      <Select value={dwellingType} onValueChange={setDwellingType}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select…" />
                        </SelectTrigger>
                        <SelectContent>
                          {DWELLING_TYPES.map((d) => (
                            <SelectItem key={d.value} value={d.value}>
                              {d.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Pets">
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
                    </Field>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                      Flooring
                    </Label>
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
                                ? "bg-violet-600 border-violet-600 text-white"
                                : "bg-white border-slate-200 text-slate-700 hover:border-violet-300",
                            )}
                          >
                            {f.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <Field label="Parking notes">
                    <Input
                      value={parkingNotes}
                      onChange={(e) => setParkingNotes(e.target.value)}
                      placeholder="Driveway, street, garage code…"
                    />
                  </Field>
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                      Supplies provided by
                    </Label>
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
                            "flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-sm transition-colors",
                            suppliesProvidedBy === opt.id
                              ? "border-violet-500 bg-violet-50"
                              : "border-slate-200 bg-white hover:border-violet-300",
                          )}
                        >
                          <RadioGroupItem value={opt.id} />
                          <span className="font-medium text-slate-900">
                            {opt.label}
                          </span>
                        </label>
                      ))}
                    </RadioGroup>
                  </div>
                  {serviceType === "combo" && (
                    <Field
                      label="Combo follow-up date"
                      hint="Standard Clean follow-up — typically 1–14 days after the Deep Clean."
                    >
                      <Input
                        type="date"
                        value={comboFollowUpDate}
                        onChange={(e) => setComboFollowUpDate(e.target.value)}
                      />
                    </Field>
                  )}
                </div>
              )}
            </div>
          </FormSection>

          {/* 3 — Schedule (custom violet-themed inline picker) */}
          <FormSection
            number={3}
            title="Schedule"
            description="Pick a date and time slot — same availability customers see."
            icon={<RiCalendarLine className="w-4 h-4" />}
          >
            <InlineSchedulePicker
              selectedDate={selectedDate}
              selectedTime={selectedTime}
              onDateSelect={(d) => {
                setSelectedDate(d);
                setSelectedTime(undefined);
              }}
              onTimeSelect={(slot) => setSelectedTime(slot)}
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <Field
                label="Access / parking notes"
                hint="Shown to the cleaner."
              >
                <Textarea
                  value={accessNotes}
                  onChange={(e) => setAccessNotes(e.target.value)}
                  placeholder="Gate code, parking, pet info…"
                  rows={3}
                />
              </Field>
              <Field label="Internal team notes" hint="Hidden from customer.">
                <Textarea
                  value={teamNotes}
                  onChange={(e) => setTeamNotes(e.target.value)}
                  rows={3}
                />
              </Field>
            </div>
          </FormSection>

          {/* 4 — Payment */}
          <FormSection
            number={4}
            title="Payment"
            description="Invoice posture, promo, and comm preferences."
            icon={<RiMoneyDollarCircleLine className="w-4 h-4" />}
          >
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                Invoice mode
              </Label>
              <RadioGroup
                value={invoiceMode}
                onValueChange={(v) => setInvoiceMode(v as InvoiceMode)}
                className="grid grid-cols-1 md:grid-cols-3 gap-2"
              >
                {INVOICE_MODES.map((m) => (
                  <label
                    key={m.id}
                    className={cn(
                      "flex items-start gap-2.5 px-3 py-3 rounded-xl border cursor-pointer transition-colors",
                      invoiceMode === m.id
                        ? "border-violet-500 bg-violet-50"
                        : "border-slate-200 bg-white hover:border-violet-300",
                    )}
                  >
                    <RadioGroupItem value={m.id} className="mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-slate-900 leading-tight">
                        {m.label}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                        {m.desc}
                      </p>
                    </div>
                  </label>
                ))}
              </RadioGroup>
            </div>

            {frequency !== "one-time" ? (
              // Recurring membership: the override sets the MONTHLY
              // subscription price (always available), and a deposit invoice
              // mode adds a one-time first-clean deposit to the first invoice.
              <div className="grid grid-cols-2 gap-4">
                <Field
                  label="Override monthly ($)"
                  hint="Replaces the catalog membership rate on the Stripe subscription."
                >
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    value={overrideTotal}
                    onChange={(e) => setOverrideTotal(e.target.value)}
                    placeholder={(pricing.computedCents / 100).toFixed(2)}
                  />
                </Field>
                {(invoiceMode === "deposit_plus_remaining" ||
                  invoiceMode === "deposit_plus_preauth") && (
                  <Field
                    label="Deposit % of monthly"
                    hint="One-time first-clean deposit charged at signup."
                  >
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={depositPercent}
                      onChange={(e) => setDepositPercent(e.target.value)}
                    />
                  </Field>
                )}
                <div className="col-span-2 rounded-xl bg-violet-50 border border-violet-200 px-3 py-2 text-xs text-violet-900 leading-relaxed">
                  {invoiceMode === "deposit_plus_remaining" ||
                  invoiceMode === "deposit_plus_preauth"
                    ? "The override sets the monthly subscription price on Stripe, and the deposit is added as a one-time charge on the customer's first invoice."
                    : "The override sets the monthly subscription price on Stripe. Pick a deposit invoice mode above to also collect a one-time first-clean deposit at signup."}
                </div>
              </div>
            ) : (
              (invoiceMode === "deposit_plus_remaining" ||
                invoiceMode === "deposit_plus_preauth") && (
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Deposit % of total">
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={depositPercent}
                      onChange={(e) => setDepositPercent(e.target.value)}
                    />
                  </Field>
                  <Field label="Override total ($)">
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      value={overrideTotal}
                      onChange={(e) => setOverrideTotal(e.target.value)}
                      placeholder={(pricing.computedCents / 100).toFixed(2)}
                    />
                  </Field>
                  {invoiceMode === "deposit_plus_preauth" && (
                    <div className="col-span-2 rounded-xl bg-violet-50 border border-violet-200 px-3 py-2 text-xs text-violet-900 leading-relaxed">
                      A hosted Stripe Checkout link will be sent to the customer
                      that collects the deposit AND saves their card off-session.
                      A pre-auth hold for the remaining balance is placed a few
                      days before service (existing prepare-completion-hold
                      cron) and captured automatically when admin marks the
                      booking complete.
                    </div>
                  )}
                </div>
              )
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field
                label={
                  <span className="flex items-center gap-1.5">
                    <RiPriceTag3Line className="w-3.5 h-3.5 text-violet-600" />
                    Promo code
                  </span>
                }
              >
                <Input
                  value={promoCode}
                  onChange={(e) =>
                    setPromoCode(e.target.value.trim().toLowerCase())
                  }
                  placeholder="welcome10"
                />
              </Field>
              <Field label="Booker / VA name">
                <Input
                  value={csrName}
                  onChange={(e) => setCsrName(e.target.value)}
                  placeholder="Anna VA"
                />
              </Field>
            </div>

            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Notifications
              </p>
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <Checkbox
                  checked={sendConfirmationSms}
                  onCheckedChange={(v) => setSendConfirmationSms(v === true)}
                />
                Send confirmation SMS via GHL
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <Checkbox
                  checked={sendChecklistEmail}
                  onCheckedChange={(v) => setSendChecklistEmail(v === true)}
                />
                Send {
                  serviceType === "deep" ? "Deep Clean"
                  : serviceType === "moveInOut" ? "Move In/Out"
                  : serviceType === "combo" ? "Combo Clean"
                  : "Standard Clean"
                } checklist email
              </label>
            </div>
          </FormSection>
        </div>

        {/* RIGHT — sticky quote rail */}
        <aside className="xl:col-span-4">
          <div className="xl:sticky xl:top-6 space-y-4">
            <Card className="border border-slate-200 rounded-2xl overflow-hidden shadow-[0_4px_24px_-12px_rgba(15,23,42,0.12)]">
              <div className="relative bg-gradient-to-br from-violet-600 via-violet-500 to-teal-500 px-5 py-5 text-white">
                <div className="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-full blur-2xl -translate-y-8 translate-x-8" />
                <div className="relative flex items-center gap-2">
                  <RiSparklingLine className="w-4 h-4" />
                  <p className="font-jakarta font-bold text-sm tracking-tight">
                    Live quote
                  </p>
                </div>
                <p className="relative text-[11px] text-white/85 mt-0.5">
                  Updates as you adjust the booking.
                </p>
              </div>
              <CardContent className="space-y-2.5 pt-5 pb-5">
                {pricing.isRecurring ? (
                  <SummaryRow
                    label={`${MEMBERSHIP_PLAN_RAIL_LABEL[frequency] || "Membership"} · ${HOME_SIZE_RANGES.find((h) => h.id === homeSizeId)?.label?.replace(" sq ft", "") || ""}`}
                    value={`${fmtMoney(pricing.membershipMonthlyCents)}/mo`}
                  />
                ) : (
                  <SummaryRow
                    label={`${SERVICE_TYPE_OPTIONS.find((s) => s.id === serviceType)?.label} · ${HOME_SIZE_RANGES.find((h) => h.id === homeSizeId)?.label?.replace(" sq ft", "") || ""}`}
                    value={fmtMoney(pricing.serviceCents)}
                  />
                )}
                {!pricing.isRecurring && pricing.addOnsCents > 0 && (
                  <SummaryRow
                    label={`Add-ons (${addOns.length})`}
                    value={`+${fmtMoney(pricing.addOnsCents)}`}
                  />
                )}
                <Separator className="my-1.5" />
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-wider text-slate-500 font-semibold">
                    {pricing.isRecurring ? "Monthly" : "Total"}
                  </span>
                  <span className="font-jakarta text-2xl font-bold text-slate-900 tabular-nums">
                    {fmtMoney(pricing.totalCents)}
                    {pricing.isRecurring && (
                      <span className="text-sm font-semibold text-slate-500">/mo</span>
                    )}
                  </span>
                </div>
                {pricing.isRecurring ? (
                  <div className="grid grid-cols-1 gap-2 pt-1">
                    <div className="rounded-lg bg-slate-50 border border-slate-200 px-2.5 py-1.5">
                      <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">
                        Deposit at signup
                      </p>
                      <p className="text-sm font-bold text-slate-900 tabular-nums">
                        {pricing.depositCents > 0
                          ? `${fmtMoney(pricing.depositCents)} (one-time, first clean)`
                          : "None — recurring only"}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div className="rounded-lg bg-slate-50 border border-slate-200 px-2.5 py-1.5">
                      <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">
                        Deposit
                      </p>
                      <p className="text-sm font-bold text-slate-900 tabular-nums">
                        {fmtMoney(pricing.depositCents)}
                      </p>
                    </div>
                    <div className="rounded-lg bg-slate-50 border border-slate-200 px-2.5 py-1.5">
                      <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">
                        Day-of
                      </p>
                      <p className="text-sm font-bold text-slate-900 tabular-nums">
                        {fmtMoney(pricing.remainingCents)}
                      </p>
                    </div>
                  </div>
                )}

                {walletCreditCents > 0 && (
                  <div className="rounded-lg bg-violet-50 border border-violet-200 px-3 py-2 text-xs text-violet-800 flex items-center gap-1.5 mt-2">
                    <RiWalletLine className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {fmtMoney(walletCreditCents)} wallet credit applied
                      automatically at checkout.
                    </span>
                  </div>
                )}

                <label className="flex items-start gap-2.5 text-sm cursor-pointer rounded-lg border border-primary/20 bg-primary/[0.03] p-3 mt-3">
                  <Checkbox checked={vaAgreedOnPhone} onCheckedChange={(v) => setVaAgreedOnPhone(v === true)} className="mt-0.5" />
                  <span>I confirm the client <strong>verbally agreed</strong> to the Terms of Service, Disclaimer, Refund Policy &amp; One-Time Service Agreement over the phone. A signed copy will be emailed to them with their details.</span>
                </label>

                {frequency !== "one-time" && (
                  <div className="rounded-lg border border-violet-200 bg-violet-50 p-2.5 text-[11px] text-violet-900 mt-3 flex items-start gap-1.5">
                    <RiSparklingLine className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>
                      Recurring frequency selected — this creates a{" "}
                      <strong>{frequency} membership</strong>. We'll generate a
                      Stripe subscription link to send the customer instead of a
                      one-time invoice. Their first clean auto-books once they
                      subscribe.
                    </span>
                  </div>
                )}

                {frequency !== "one-time" && (
                  <div className="mt-3">
                    <DeepCleanPrompt value={deepClean} onChange={setDeepClean} priceDollars={75} />
                  </div>
                )}

                <Button
                  onClick={handleSubmit}
                  disabled={!canSubmit || submitting}
                  variant="default"
                  size="lg"
                  className="w-full mt-3"
                >
                  {submitting ? (
                    <>
                      <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" />
                      {frequency !== "one-time" ? "Creating link…" : "Creating booking…"}
                    </>
                  ) : (
                    <>
                      {frequency !== "one-time" ? "Create membership link" : "Create booking"}
                      <RiArrowRightLine className="w-4 h-4 ml-2" />
                    </>
                  )}
                </Button>

                <Button
                  onClick={handleSaveQuote}
                  disabled={savingQuote || !firstName.trim() || !email.trim()}
                  variant="outline"
                  size="sm"
                  className="w-full mt-2 text-slate-600"
                >
                  {savingQuote ? (
                    <>
                      <RiLoader4Line className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                      Saving quote…
                    </>
                  ) : (
                    <>
                      <RiSaveLine className="w-3.5 h-3.5 mr-1.5" />
                      Save as quote
                    </>
                  )}
                </Button>
                {savedQuoteId && (
                  <p className="text-[11px] text-emerald-700 text-center mt-1">
                    Quote saved · ID: {savedQuoteId.slice(0, 8)}…
                  </p>
                )}

                {!canSubmit && requirements.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-900 mt-1">
                    <div className="flex items-center gap-1.5 mb-1 font-semibold">
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

            <Card className="border border-slate-200 rounded-2xl shadow-sm">
              <CardContent className="p-4 text-[11px] text-slate-500 space-y-1.5">
                <p className="flex items-center gap-1.5">
                  <RiInformationLine className="w-3.5 h-3.5 text-slate-400" />
                  <span className="font-medium text-slate-700">
                    Internal-only
                  </span>
                </p>
                <p className="leading-relaxed">
                  This form bypasses the customer-facing checkout. Stripe
                  invoices are sent based on the invoice mode you select above.
                </p>
              </CardContent>
            </Card>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ─── Inline schedule picker (violet-themed, admin-compact) ────────────

function InlineSchedulePicker({
  selectedDate,
  selectedTime,
  onDateSelect,
  onTimeSelect,
}: {
  selectedDate: Date | undefined;
  selectedTime: string | undefined;
  onDateSelect: (d: Date) => void;
  onTimeSelect: (slot: string) => void;
}) {
  const minDate = addDays(new Date(), 3);
  const endDate = addDays(new Date(), 60);
  const [currentMonth, setCurrentMonth] = useState(startOfMonth(minDate));
  const { availability, loading } = useAvailability(minDate, endDate);

  const availabilityByDate = useMemo(() => {
    const map: Record<string, Record<string, { available: boolean; capacity: number; booked: number }>> = {};
    availability.forEach((slot) => {
      if (!map[slot.service_date]) map[slot.service_date] = {};
      map[slot.service_date][slot.time_slot] = {
        available: slot.is_available ?? slot.current_bookings < slot.max_capacity,
        capacity: slot.max_capacity,
        booked: slot.current_bookings,
      };
    });
    return map;
  }, [availability]);

  const selectedDateStr = selectedDate ? format(selectedDate, "yyyy-MM-dd") : null;
  const slotsForDate = selectedDateStr ? availabilityByDate[selectedDateStr] || {} : {};

  const isDateDisabled = (d: Date) =>
    isWeekend(d) || isBefore(startOfDay(d), startOfDay(minDate));

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
    const pad = getDay(monthStart);
    return [...Array(pad).fill(null), ...days];
  }, [currentMonth]);

  const periods = [
    { id: "morning", label: "Morning", icon: RiSunLine, color: "text-amber-500" },
    { id: "afternoon", label: "Afternoon", icon: RiSunFoggyLine, color: "text-orange-500" },
    { id: "evening", label: "Evening", icon: RiMoonLine, color: "text-indigo-500" },
  ] as const;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-200">
        {/* Calendar */}
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] uppercase tracking-wider text-slate-500 font-bold">
              Pick a date
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => {
                  const prev = addMonths(currentMonth, -1);
                  if (!isBefore(endOfMonth(prev), minDate)) setCurrentMonth(prev);
                }}
                disabled={isBefore(endOfMonth(addMonths(currentMonth, -1)), minDate)}
              >
                <RiArrowLeftSLine className="h-4 w-4" />
              </Button>
              <span className="text-xs font-semibold text-slate-700 min-w-[100px] text-center">
                {format(currentMonth, "MMMM yyyy")}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => {
                  const next = addMonths(currentMonth, 1);
                  if (isBefore(startOfMonth(next), endDate)) setCurrentMonth(next);
                }}
                disabled={!isBefore(startOfMonth(addMonths(currentMonth, 1)), endDate)}
              >
                <RiArrowRightSLine className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {WEEKDAYS.map((d, i) => (
              <div
                key={i}
                className="text-center text-[10px] font-bold text-slate-400 py-1"
              >
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((day, idx) => {
              if (!day) return <div key={`pad-${idx}`} className="aspect-square" />;
              const disabled = isDateDisabled(day);
              const isSel = selectedDate && isSameDay(day, selectedDate);
              const isToday = isSameDay(day, new Date());
              const inMonth = isSameMonth(day, currentMonth);
              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  onClick={() => !disabled && onDateSelect(day)}
                  disabled={disabled}
                  className={cn(
                    "aspect-square rounded-lg text-xs font-medium transition-all relative flex items-center justify-center",
                    disabled && "text-slate-300 cursor-not-allowed",
                    !disabled && !isSel && "text-slate-700 hover:bg-violet-50 hover:text-violet-900",
                    isSel && "bg-violet-600 text-white shadow-[0_2px_8px_-2px_rgba(16,163,74,0.5)]",
                    !inMonth && !isSel && "text-slate-300",
                    isToday && !isSel && "ring-1 ring-violet-300",
                  )}
                >
                  {format(day, "d")}
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-slate-400 mt-2 pl-1">
            Weekends greyed out · 3-day lead required
          </p>
        </div>

        {/* Time slots */}
        <div className="p-4">
          <p className="text-[11px] uppercase tracking-wider text-slate-500 font-bold mb-3">
            {selectedDate
              ? `Time on ${format(selectedDate, "EEE, MMM d")}`
              : "Pick a time"}
          </p>
          {!selectedDate ? (
            <div className="flex flex-col items-center justify-center py-10 text-slate-400">
              <RiTimeLine className="w-8 h-8 mb-2 opacity-50" />
              <p className="text-xs">Select a date first</p>
            </div>
          ) : loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="space-y-1.5">
                  <Skeleton className="h-3 w-20" />
                  <div className="grid grid-cols-4 gap-1.5">
                    {[1, 2, 3, 4].map((j) => (
                      <Skeleton key={j} className="h-8 rounded-md" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {periods.map(({ id, label, icon: Icon, color }) => {
                const slots = TIME_SLOTS.filter((s) => s.period === id);
                return (
                  <div key={id} className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                      <Icon className={cn("w-3.5 h-3.5", color)} />
                      {label}
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {slots.map((slot) => {
                        const av = slotsForDate[slot.id];
                        const available =
                          av === undefined ? true : av.available;
                        const isSel = selectedTime === slot.id;
                        return (
                          <button
                            key={slot.id}
                            type="button"
                            onClick={() => available && onTimeSelect(slot.id)}
                            disabled={!available}
                            className={cn(
                              "h-8 rounded-md text-xs font-semibold transition-all tabular-nums",
                              isSel
                                ? "bg-violet-600 text-white shadow-[0_2px_4px_-1px_rgba(16,163,74,0.45)]"
                                : available
                                  ? "bg-slate-50 text-slate-700 hover:bg-violet-50 hover:text-violet-900 border border-slate-200"
                                  : "bg-slate-100 text-slate-400 line-through cursor-not-allowed border border-slate-100",
                            )}
                          >
                            {slot.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Form section + helpers ────────────────────────────────────────────

function FormSection({
  number,
  title,
  description,
  icon,
  children,
}: {
  number: number;
  title: string;
  description?: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="border border-slate-200 rounded-2xl shadow-[0_1px_2px_0_rgba(15,23,42,0.04)]">
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <span className="relative shrink-0 w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-violet-700 text-white inline-flex items-center justify-center font-jakarta font-bold text-sm shadow-[0_2px_8px_-2px_rgba(16,163,74,0.45)]">
            {number}
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex items-center gap-1.5">
              <span className="text-violet-700">{icon}</span>
              <CardTitle className="font-jakarta text-base font-bold text-slate-900 tracking-tight">
                {title}
              </CardTitle>
            </div>
            {description && (
              <CardDescription className="text-xs text-slate-500 mt-0.5">
                {description}
              </CardDescription>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-1">{children}</CardContent>
    </Card>
  );
}

function Field({
  label,
  children,
  required = false,
  hint,
  rightHint,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  required?: boolean;
  hint?: string;
  rightHint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-semibold text-slate-700">
          {label}
          {required && <span className="text-violet-600 ml-0.5">*</span>}
        </Label>
        {rightHint && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-1.5 py-0.5">
            <RiWalletLine className="w-3 h-3" />
            {rightHint}
          </span>
        )}
      </div>
      {children}
      {hint && <p className="text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

function SummaryRow({
  label,
  value,
  bold = false,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-500 truncate max-w-[60%]">{label}</span>
      <span
        className={cn(
          "tabular-nums",
          bold && "font-semibold text-slate-900",
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
    <div className="rounded-xl border border-slate-200 p-4 text-sm space-y-2 bg-white">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-slate-900">{title}</p>
        <Badge variant="secondary">{fmtMoney(amount)}</Badge>
      </div>
      <p className="text-xs text-slate-500 font-mono break-all">{invoiceId}</p>
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
            className="flex-1 bg-violet-600 hover:bg-violet-700 text-white"
            onClick={() => window.open(url, "_blank", "noopener")}
          >
            Open
          </Button>
        </div>
      )}
    </div>
  );
}
