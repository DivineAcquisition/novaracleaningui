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
  RiRepeatLine,
  RiFlashlightLine,
  RiChat3Line,
  RiMailLine,
  RiFileList3Line,
  RiCalendarScheduleLine,
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
import { sendCustomerChecklist, sendMembershipAgreement } from "@/lib/membership-admin";
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
import { PartnerOnboardingLinkDialog } from "@/components/admin/PartnerOnboardingLinkDialog";
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

type ServiceType = "standard" | "deep" | "moveInOut" | "combo" | "focused";
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
    id: "focused",
    label: "Focused / Single-Area",
    subline: "Per-area flat rates · pay in full",
    multiplier: SERVICE_TIER_PRICING.focused.multiplier,
  },
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

// The lookup searches leads AND existing customers. They are two different
// tables — a returning customer is in `customers`, not `leads`, and there are
// far more of them — so a search that only hit `leads` found nobody the admin
// was actually looking for. A customer also carries a full service address we
// can prefill, which a lead does not.
type SearchKind = "customer" | "lead";
interface SearchResult {
  kind: SearchKind;
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  zip_code: string | null;
  // Customers only.
  address: string | null;
  city: string | null;
  state: string | null;
  lat: number | null;
  lng: number | null;
  // Leads only.
  service_type: string | null;
  lead_score: string | null;
  status: string | null;
  source: string | null;
}

interface Cleaner {
  id: string;
  first_name: string | null;
  last_name: string | null;
}

type BookingType = "one-time" | "recurring";
type Cadence = "weekly" | "biweekly" | "monthly";

// Recurring plans map 1:1 to Glow memberships. A recurring plan is always a
// STANDARD clean — Deep, Move-In/Out and the Deep+Standard combo are one-time
// only — so the recurring picker offers these membership frequencies instead
// of service tiers.
const MEMBERSHIP_CADENCE_OPTIONS: { id: Cadence; label: string; subline: string }[] = [
  { id: "weekly", label: "Glow Weekly", subline: "4 cleans / mo · every 7 days" },
  { id: "biweekly", label: "Glow Bi-Weekly", subline: "2 cleans / mo · every 14 days" },
  { id: "monthly", label: "Glow Monthly", subline: "1 clean / mo · same day" },
];

const CADENCE_PLAN_LABEL: Record<Cadence, string> = {
  weekly: "Glow Weekly",
  biweekly: "Glow Bi-Weekly",
  monthly: "Glow Monthly",
};

const fmtMoney = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const digitsOnly = (s: string) => s.replace(/\D/g, "");
const isValidEmail = (s: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

/** Cadence-aware upcoming dates from a start date (yyyy-MM-dd). */
function previewRecurringDates(start: string, cadence: Cadence, count = 4): string[] {
  if (!start) return [];
  const out: string[] = [];
  let d = new Date(`${start}T12:00:00`);
  if (Number.isNaN(d.getTime())) return [];
  for (let i = 0; i < count; i++) {
    out.push(d.toISOString().slice(0, 10));
    const n = new Date(d);
    if (cadence === "weekly") n.setDate(n.getDate() + 7);
    else if (cadence === "monthly") n.setMonth(n.getMonth() + 1);
    else n.setDate(n.getDate() + 14);
    d = n;
  }
  return out;
}

// ─── Page ──────────────────────────────────────────────────────────────

export default function VaBooking() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const leadIdParam = searchParams.get("lead_id");
  const quoteIdParam = searchParams.get("quoteId");

  // Customer / lead lookup (collapsed by default)
  const [leadLookupOpen, setLeadLookupOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  // Only a real lead links back to leads/va_quotes (both FK-bound to leads.id).
  // A selected customer is tracked separately so its id never lands in a lead
  // column.
  const [linkedLead, setLinkedLead] = useState<LeadRow | null>(null);
  const [linkedCustomerId, setLinkedCustomerId] = useState<string | null>(null);
  // Bumped whenever a selection prefills the address, so AddressAutocomplete
  // (which reads its initial value only on mount) remounts and shows it.
  const [prefillKey, setPrefillKey] = useState(0);

  useEffect(() => {
    if (!leadLookupOpen) {
      setSearchResults([]);
      setSearchError(null);
      return;
    }
    const q = searchQuery.trim();
    setSearching(true);
    setSearchError(null);
    const t = setTimeout(async () => {
      const digits = digitsOnly(q);

      const leadCols =
        "id, first_name, last_name, email, phone, zip_code, service_type, lead_score, status, source, created_at";
      const customerCols =
        "id, first_name, last_name, email, phone, zip, address, city, state, lat, lng, lifecycle_stage, membership_status, last_booking_at, created_at";

      const applyNameFilters = <T,>(qb: T): T => {
        if (!q) return qb;
        const filters = [
          `first_name.ilike.%${q}%`,
          `last_name.ilike.%${q}%`,
          `email.ilike.%${q}%`,
        ];
        if (digits) filters.push(`phone.ilike.%${digits}%`);
        // deno-lint-ignore no-explicit-any
        return (qb as any).or(filters.join(","));
      };

      const customerQuery = applyNameFilters(
        supabase.from("customers").select(customerCols),
      )
        .order("last_booking_at", { ascending: false, nullsFirst: false })
        .limit(15);
      const leadQuery = applyNameFilters(
        supabase.from("leads").select(leadCols),
      )
        .order("created_at", { ascending: false })
        .limit(15);

      const [customersRes, leadsRes] = await Promise.all([customerQuery, leadQuery]);
      setSearching(false);

      // Surface a real failure rather than rendering an empty list that reads
      // as "no such customer" — the old silent-fail is what made this look
      // broken.
      if (customersRes.error && leadsRes.error) {
        setSearchResults([]);
        setSearchError(customersRes.error.message || leadsRes.error.message || "Search failed.");
        return;
      }

      const results: SearchResult[] = [];
      const seenEmails = new Set<string>();

      // Customers first: they carry an address and are the returning-customer
      // case this lookup exists for.
      for (const c of (customersRes.data || []) as unknown as Record<string, unknown>[]) {
        const email = c.email ? String(c.email).toLowerCase() : null;
        if (email) seenEmails.add(email);
        results.push({
          kind: "customer",
          id: String(c.id),
          first_name: (c.first_name as string) ?? null,
          last_name: (c.last_name as string) ?? null,
          email: (c.email as string) ?? null,
          phone: (c.phone as string) ?? null,
          zip_code: (c.zip as string) ?? null,
          address: (c.address as string) ?? null,
          city: (c.city as string) ?? null,
          state: (c.state as string) ?? null,
          lat: c.lat != null ? Number(c.lat) : null,
          lng: c.lng != null ? Number(c.lng) : null,
          service_type: null,
          lead_score: null,
          status: (c.membership_status as string) || (c.lifecycle_stage as string) || null,
          source: "customer",
        });
      }

      // Leads that aren't already represented by a customer with the same email.
      for (const l of (leadsRes.data || []) as unknown as Record<string, unknown>[]) {
        const email = l.email ? String(l.email).toLowerCase() : null;
        if (email && seenEmails.has(email)) continue;
        if (email) seenEmails.add(email);
        results.push({
          kind: "lead",
          id: String(l.id),
          first_name: (l.first_name as string) ?? null,
          last_name: (l.last_name as string) ?? null,
          email: (l.email as string) ?? null,
          phone: (l.phone as string) ?? null,
          zip_code: (l.zip_code as string) ?? null,
          address: null,
          city: null,
          state: null,
          lat: null,
          lng: null,
          service_type: (l.service_type as string) ?? null,
          lead_score: (l.lead_score as string) ?? null,
          status: (l.status as string) ?? null,
          source: (l.source as string) ?? null,
        });
      }

      setSearchResults(results.slice(0, 20));
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

  // Booking type — one-time vs recurring (the two flows share every component
  // below; only the submit path and a few rail/controls differ).
  const [bookingType, setBookingType] = useState<BookingType>(
    searchParams.get("type") === "recurring" ? "recurring" : "one-time",
  );
  const [cadence, setCadence] = useState<Cadence>(
    ((): Cadence => {
      const c = searchParams.get("cadence");
      return c === "weekly" || c === "biweekly" || c === "monthly" ? c : "biweekly";
    })(),
  );
  const isRecurring = bookingType === "recurring";
  // Legacy alias kept so the shared pricing/agreement code reads one value.
  const frequency = isRecurring ? cadence : "one-time";

  // Service
  const [homeSizeId, setHomeSizeId] = useState("1501_2000");
  const [serviceType, setServiceType] = useState<ServiceType>("standard");
  // Focused cleans are always paid in full at booking.
  useEffect(() => {
    if (serviceType === "focused") setInvoiceMode("full_now");
  }, [serviceType]);
  const [addOns, setAddOns] = useState<string[]>([]);
  const [deepClean, setDeepClean] = useState<DeepCleanChoice>({ deepCleanedBefore: "", includeDeepClean: true });
  const [bedrooms, setBedrooms] = useState("");
  const [bathrooms, setBathrooms] = useState("");

  // Recurring engine controls (mirror the standalone recurring create form,
  // but wired into the premium internal-booking UI). Selecting Recurring
  // creates a customer_recurring_schedules row — the engine that auto-books
  // every cycle — plus the optional membership / billing artifacts.
  const [cleaners, setCleaners] = useState<Cleaner[]>([]);
  const [preferredCleanerId, setPreferredCleanerId] = useState("auto");
  const [usesCredit, setUsesCredit] = useState(false);
  const [overridePerClean, setOverridePerClean] = useState("");
  const [generateFirstClean, setGenerateFirstClean] = useState(true);
  const [textManageLink, setTextManageLink] = useState(true);
  const [sendAgreement, setSendAgreement] = useState(true);
  const [createGlowLink, setCreateGlowLink] = useState(false);
  const [monthlyGlowOverride, setMonthlyGlowOverride] = useState("");

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

  // Prefill from Quotes → "Open in Internal Booking"
  useEffect(() => {
    if (!quoteIdParam) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await (supabase as any)
          .from("va_quotes")
          .select("*")
          .eq("id", quoteIdParam)
          .maybeSingle();
        if (cancelled || error || !data) {
          if (!cancelled && error) toast.error("Could not load quote");
          return;
        }
        setSavedQuoteId(data.id);
        setFirstName(data.first_name || "");
        setLastName(data.last_name || "");
        setEmail(data.email || "");
        setPhone(data.phone || "");
        setAddress(data.address || "");
        setCity(data.city || "");
        setState(data.state || "");
        setZipCode(data.zip_code || "");
        if (data.home_size_id) setHomeSizeId(data.home_size_id);
        if (data.service_type) setServiceType(data.service_type as ServiceType);
        if (Array.isArray(data.add_ons)) setAddOns(data.add_ons);
        if (data.frequency && data.frequency !== "one-time") {
          setBookingType("recurring");
          if (["weekly", "biweekly", "monthly"].includes(data.frequency)) {
            setCadence(data.frequency as Cadence);
          }
        }
        if (data.service_date) {
          try {
            setSelectedDate(new Date(`${data.service_date}T12:00:00`));
          } catch {
            /* ignore */
          }
        }
        if (data.time_slot) setSelectedTime(data.time_slot);
        if (data.team_notes) setTeamNotes(data.team_notes);
        if (data.access_notes) setAccessNotes(data.access_notes);
        if (data.bedrooms != null) setBedrooms(String(data.bedrooms));
        if (data.bathrooms != null) setBathrooms(String(data.bathrooms));
        if (data.dwelling_type) setDwellingType(data.dwelling_type);
        if (data.pets) setPets(data.pets);
        if (data.csr_name) setCsrName(data.csr_name);
        if (data.total_estimate_cents != null) {
          setOverrideTotal((data.total_estimate_cents / 100).toFixed(2));
        }
        toast.success("Quote loaded into the booking form");
      } catch (err: unknown) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : "Could not load quote");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [quoteIdParam]);

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
        // Email-based balance so admin-granted credit shows during VA booking
        // as long as the email matches the credited customer.
        const { data: bal } = await (supabase.rpc as any)(
          "get_customer_credit_balance_by_email",
          { _email: trimmed },
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

  // Active cleaners for the recurring "preferred cleaner" picker.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await (supabase.from as any)("cleaners")
        .select("id, first_name, last_name")
        .eq("status", "active")
        .order("first_name");
      if (!cancelled && Array.isArray(data)) setCleaners(data as Cleaner[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Prefill from a deep link (e.g. Recurring hub → "Set up schedule").
  useEffect(() => {
    const pf = {
      email: searchParams.get("email"),
      first_name: searchParams.get("first_name"),
      last_name: searchParams.get("last_name"),
      phone: searchParams.get("phone"),
      uses_credit: searchParams.get("uses_credit"),
    };
    if (pf.email) setEmail(pf.email);
    if (pf.first_name) setFirstName(pf.first_name);
    if (pf.last_name) setLastName(pf.last_name);
    if (pf.phone) setPhone(pf.phone);
    if (pf.uses_credit === "1" || pf.uses_credit === "true") setUsesCredit(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Prefill the form from a lookup result. A customer brings a full service
  // address; a lead brings its service type. Only a lead sets linkedLead, so a
  // customer's id can never be written into the leads-bound leadId/lead_id.
  function applyResult(r: SearchResult) {
    setFirstName(r.first_name || "");
    setLastName(r.last_name || "");
    setEmail(r.email || "");
    setPhone(r.phone || "");
    setZipCode(r.zip_code || "");

    if (r.kind === "customer") {
      setLinkedLead(null);
      setLinkedCustomerId(r.id);
      setAddress(r.address || "");
      setCity(r.city || "");
      setState(r.state || "");
      setAddressLat(r.lat);
      setAddressLng(r.lng);
      if (r.address) setPrefillKey((k) => k + 1);
    } else {
      setLinkedCustomerId(null);
      setLinkedLead({
        id: r.id,
        first_name: r.first_name,
        last_name: r.last_name,
        email: r.email,
        phone: r.phone,
        zip_code: r.zip_code,
        service_type: r.service_type,
        lead_score: r.lead_score,
        status: r.status,
        source: r.source,
      });
      if (r.service_type) {
        const st = r.service_type as ServiceType;
        if (["standard", "deep", "moveInOut", "combo"].includes(st)) {
          setServiceType(st);
        }
      }
    }

    setLeadLookupOpen(false);
    const name = `${r.first_name || ""} ${r.last_name || ""}`.trim() || "(no name)";
    toast.success(
      r.kind === "customer" ? `Loaded customer — ${name}` : `Loaded lead — ${name}`,
    );
  }

  function applyLead(lead: LeadHydration) {
    setLinkedLead(lead);
    setLinkedCustomerId(null);
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
    // One-time clean math (list price for the rail line item + final discounted
    // total). `membershipPlan: "none"` keeps the acquisition discount in play.
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

    // Recurring per-clean math. When the clean is covered by a membership
    // credit we drop the deposit and honor the credit coverage; otherwise the
    // customer pays the per-clean rate each visit.
    const perCleanCalc = calculatePrice(
      homeSizeId,
      "standard", // recurring plans are always standard cleans
      addOns,
      "none",
      usesCredit,
      false,
      0,
    );
    const perCleanCatalogCents = Math.round(perCleanCalc.total * 100);
    const overridePerCleanCents = overridePerClean.trim()
      ? Math.round(parseFloat(overridePerClean) * 100)
      : null;
    const perCleanCents =
      overridePerCleanCents !== null && overridePerCleanCents >= 0
        ? overridePerCleanCents
        : perCleanCatalogCents;

    // Monthly Glow (membership subscription) catalog + override — only used
    // when the VA also generates a Stripe subscription link.
    const monthlyGlowCatalogCents = Math.round(
      (MEMBERSHIP_PRICES[homeSizeId]?.[cadence] ?? 0) * 100,
    );
    const monthlyGlowOverrideCents = monthlyGlowOverride.trim()
      ? Math.round(parseFloat(monthlyGlowOverride) * 100)
      : null;
    const monthlyGlowCents =
      monthlyGlowOverrideCents !== null && monthlyGlowOverrideCents >= 100
        ? monthlyGlowOverrideCents
        : monthlyGlowCatalogCents;

    // One-time deposit posture.
    const overrideCents = overrideTotal.trim()
      ? Math.round(parseFloat(overrideTotal) * 100)
      : null;
    const totalCents =
      overrideCents !== null && overrideCents >= 0 ? overrideCents : oneTimeComputedCents;
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
      // one-time
      serviceCents,
      addOnsCents,
      subtotalCents,
      computedCents: oneTimeComputedCents,
      totalCents,
      depositCents,
      remainingCents,
      // recurring
      isRecurring,
      perCleanCatalogCents,
      perCleanCents,
      monthlyGlowCatalogCents,
      monthlyGlowCents,
      overrideApplied: overridePerCleanCents !== null && overridePerCleanCents >= 0,
    };
  }, [
    homeSizeId,
    serviceType,
    addOns,
    overrideTotal,
    depositPercent,
    invoiceMode,
    isRecurring,
    cadence,
    usesCredit,
    overridePerClean,
    monthlyGlowOverride,
  ]);

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
    if (!selectedDate) list.push(isRecurring ? "First service date" : "Service date");
    if (!selectedTime) list.push(isRecurring ? "Preferred time window" : "Time slot");
    // The verbal-agreement attestation is a one-time compliance artifact.
    // Recurring plans send the membership agreement for e-sign instead.
    if (!isRecurring && !vaAgreedOnPhone) list.push("Confirm client agreed (phone)");
    return list;
  }, [firstName, email, phoneDigits, zipDigits, selectedDate, selectedTime, vaAgreedOnPhone, isRecurring]);

  const canSubmit = requirements.length === 0;

  // ─── Recurring plan creation ────────────────────────────────────────
  // Selecting Recurring creates a `customer_recurring_schedules` row — the
  // engine that auto-books a confirmed clean every cycle and assigns the
  // preferred/previous cleaner. On top of that we optionally: generate +
  // assign the first clean immediately, email/text the cleaning checklist,
  // create a Stripe subscription (Glow membership) link, email the DocuSeal
  // membership agreement (agree → pay), and text the customer their
  // self-service manage link. This is the same set of controls the standalone
  // Recurring hub had — now wired into the premium internal-booking UI.
  const handleRecurringCreate = async () => {
    if (!canSubmit) {
      toast.error("Fill out all required fields before submitting.");
      return;
    }
    setSubmitting(true);
    setResult(null);
    try {
      const firstServiceDate = selectedDate ? format(selectedDate, "yyyy-MM-dd") : "";
      if (!firstServiceDate) throw new Error("Pick a first service date.");
      const membershipPlan = cadence; // weekly | biweekly | monthly
      const overrideNote =
        overridePerClean.trim() && pricing.perCleanCents >= 0
          ? `Admin price override $${(pricing.perCleanCents / 100).toFixed(2)}/clean`
          : null;

      // 1) The recurring schedule (the engine). Stamp membership_plan when the
      // clean is credit-covered or a Glow subscription is being created so the
      // hub badges it correctly.
      const { data: created, error: insErr } = await (supabase.from as any)(
        "customer_recurring_schedules",
      )
        .insert({
          email: email.trim().toLowerCase(),
          first_name: firstName.trim() || null,
          last_name: lastName.trim() || null,
          phone: phone || null,
          address: address || null,
          city: city || null,
          state: state || null,
          zip_code: zipCode || null,
          home_size_id: homeSizeId,
          service_type: "standard", // recurring plans are always standard cleans
          add_ons: addOns,
          cadence,
          preferred_time_slot: selectedTime || null,
          preferred_cleaner_id: preferredCleanerId === "auto" ? null : preferredCleanerId,
          price_cents: pricing.perCleanCents,
          uses_credit: usesCredit,
          membership_plan: usesCredit || createGlowLink ? membershipPlan : null,
          next_service_date: firstServiceDate,
          active: true,
          notes: [teamNotes.trim() || null, overrideNote].filter(Boolean).join(" · ") || null,
        })
        .select("id")
        .single();
      if (insErr) throw insErr;
      const scheduleId = created?.id as string | undefined;

      // 2) Generate + assign the first clean now (best-effort).
      let firstCleanStatus: string | null = null;
      if (scheduleId && generateFirstClean) {
        try {
          const { data, error } = await supabase.functions.invoke(
            "customer-recurring-generate",
            { body: { scheduleId, force: true } },
          );
          if (error) throw error;
          if ((data as any)?.error) throw new Error((data as any).error);
          firstCleanStatus = (data as any)?.results?.[0]?.status || "done";
        } catch (e) {
          firstCleanStatus = "error";
          toast.warning(
            `Plan saved, but first-clean generation failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }

      // 3) Cleaning checklist (email + optional SMS).
      let checklistSent = false;
      if (sendChecklistEmail) {
        try {
          await sendCustomerChecklist({
            email: email.trim().toLowerCase(),
            phone: phone || undefined,
            firstName: firstName.trim() || undefined,
            serviceType: "standard",
            sendEmail: true,
            sendSms: Boolean(phone),
          });
          checklistSent = true;
        } catch (e) {
          toast.warning(`Checklist send failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      // 4) Glow subscription payment link (agree → pay). Held until the
      // membership agreement is signed.
      let paymentUrl: string | undefined;
      if (createGlowLink) {
        try {
          const priceOverride: { total?: number } = {};
          if (
            monthlyGlowOverride.trim() &&
            pricing.monthlyGlowCents >= 100
          ) {
            priceOverride.total = pricing.monthlyGlowCents;
          }
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
              firstServiceDate,
              firstTimeSlot: selectedTime || undefined,
              includeDeepClean: deepClean.includeDeepClean,
              deepCleanedBefore: deepClean.deepCleanedBefore,
              priceOverride: Object.keys(priceOverride).length ? priceOverride : undefined,
              csrName: csrName.trim() || undefined,
              notifyCustomer: false,
              sendChecklistEmail: false,
            },
          });
          if (error) throw error;
          if ((data as any)?.error) throw new Error((data as any).error);
          paymentUrl = (data as any)?.url;
        } catch (e) {
          toast.warning(`Glow payment link failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      // 5) Sign-then-pay. When a Glow subscription link exists, hand the
      // customer a hosted membership-pay page (same pattern as the one-time
      // /pay page): they review + e-sign the Membership / Recurring Service
      // Agreement inline, and only then is the Stripe subscription pay link
      // revealed. We store the pay token + held URL on the schedule and text/
      // email the link. Without a pay link we fall back to the DocuSeal
      // agreement (agree → pay by released link).
      let agreementSent = false;
      let signingUrl: string | null = null;
      let hostedPayUrl: string | null = null;
      if (createGlowLink && paymentUrl && scheduleId) {
        try {
          const payToken = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
          const { error: tokErr } = await (supabase.from as any)("customer_recurring_schedules")
            .update({ pay_token: payToken, pay_url: paymentUrl, updated_at: new Date().toISOString() })
            .eq("id", scheduleId);
          if (tokErr) throw tokErr;
          hostedPayUrl = `https://try.novaracleaning.com/membership-pay/${payToken}`;

          // Email the sign-then-pay link.
          try {
            await supabase.functions.invoke("send-membership-email", {
              body: {
                type: "checkout_link",
                email: email.trim().toLowerCase(),
                data: {
                  name: firstName.trim() || "there",
                  plan: CADENCE_PLAN_LABEL[cadence],
                  url: hostedPayUrl,
                  monthlyAmount: pricing.monthlyGlowCents,
                  depositAmount: 0,
                  firstServiceDate,
                },
              },
            });
          } catch (e) {
            console.error("[VaBooking] membership-pay email failed", e);
          }

          // Text the sign-then-pay link.
          if (phone) {
            try {
              await supabase.functions.invoke("send-ghl-sms", {
                body: {
                  phone,
                  type: "confirmation",
                  message:
                    `Hi ${firstName.trim() || "there"}! Review, sign & activate your Novara ` +
                    `${CADENCE_PLAN_LABEL[cadence]} membership here: ${hostedPayUrl}`,
                },
              });
            } catch (e) {
              console.error("[VaBooking] membership-pay SMS failed", e);
            }
          }
          agreementSent = true; // the hosted page captures the signed agreement
        } catch (e) {
          toast.warning(`Sign-and-pay link failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      if (!hostedPayUrl && sendAgreement) {
        try {
          const ag = await sendMembershipAgreement({
            email: email.trim().toLowerCase(),
            name: `${firstName.trim()} ${lastName.trim()}`.trim() || undefined,
            phone: phone || undefined,
            plan: CADENCE_PLAN_LABEL[cadence],
            serviceAddress:
              [address, city, state, zipCode].filter(Boolean).join(", ") || undefined,
            firstServiceDate,
            membershipRateCents: createGlowLink ? pricing.monthlyGlowCents : undefined,
            oneTimeRateCents: pricing.perCleanCents,
            initialDeepClean: deepClean.includeDeepClean ? "Yes" : "No",
            homeSizeId,
            scheduleId,
            paymentUrl,
            holdPayment: Boolean(paymentUrl),
            sendEmail: true,
          });
          agreementSent = true;
          signingUrl = ag.signingUrl || null;
        } catch (e) {
          toast.warning(`Agreement send failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      // 6) Text the customer their self-service manage link.
      let manageLinkTexted = false;
      if (scheduleId && textManageLink && phone) {
        try {
          const { data, error } = await supabase.functions.invoke(
            "send-recurring-manage-link",
            { body: { scheduleId, context: "created" } },
          );
          if (error) throw error;
          if ((data as any)?.error) throw new Error((data as any).error);
          manageLinkTexted = true;
        } catch (e) {
          toast.warning(`Manage-link SMS failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      setResult({
        recurringCreated: true,
        scheduleId,
        cadence,
        perCleanCents: pricing.perCleanCents,
        usesCredit,
        firstServiceDate,
        firstCleanStatus,
        checklistSent,
        paymentUrl,
        hostedPayUrl,
        agreementSent,
        signingUrl,
        manageLinkTexted,
        createGlowLink,
        monthlyGlowCents: pricing.monthlyGlowCents,
      });
      toast.success("Recurring plan created.");
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to create recurring plan: ${m}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    if (isRecurring) {
      await handleRecurringCreate();
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

      // One-Time Service Agreement.
      //
      // deposit_plus_preauth: SKIP the verbal record entirely — the customer
      // signs the agreement themselves on the pay page (try.…/pay/<token>)
      // BEFORE payment unlocks, and only then do they get their copy. A
      // verbal row here would (a) email them an agreement they haven't seen
      // and (b) used to make the pay page think legal was already done.
      //
      // Other invoice modes have no pay page, so the verbal record (customer
      // receives their mapped copy by email) is still the right artifact.
      if (invoiceMode !== "deposit_plus_preauth") {
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
      toast.success("Quote saved — find it anytime under Quotes.");
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to save quote: ${m}`);
    } finally {
      setSavingQuote(false);
    }
  };

  // ─── Recurring plan created screen ──────────────────────────────────
  if (result?.recurringCreated) {
    const planLabel = CADENCE_PLAN_LABEL[result.cadence as Cadence] || "Recurring plan";
    const hostedUrl: string | undefined = result.hostedPayUrl;
    const payUrl: string | undefined = hostedUrl || result.paymentUrl;
    const upcoming = previewRecurringDates(result.firstServiceDate, result.cadence as Cadence, 4);
    const firstCleanBooked =
      result.firstCleanStatus === "created" || result.firstCleanStatus === "existing";
    return (
      <div className="max-w-2xl mx-auto">
        <SEO title="Novara Internal Booking" noindex />
        <Card className="border border-slate-200 shadow-[0_4px_24px_-12px_rgba(15,23,42,0.12)] rounded-2xl overflow-hidden">
          <div className="h-1.5 w-full bg-gradient-to-r from-violet-500 via-violet-400 to-teal-400" />
          <CardHeader className="text-center pt-10">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-violet-50 flex items-center justify-center ring-1 ring-violet-200">
              <RiRepeatLine className="w-7 h-7 text-violet-600" />
            </div>
            <Badge className="mx-auto mt-3 bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-50 font-medium">
              Recurring plan created
            </Badge>
            <CardTitle className="font-jakarta text-2xl mt-3 text-slate-900 tracking-tight">
              {planLabel} — {`${firstName} ${lastName}`.trim() || email}
            </CardTitle>
            <CardDescription className="mt-1">
              The recurring engine will auto-book a confirmed clean each cycle and
              assign the preferred/previous cleaner.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 pb-8">
            <div className="rounded-xl bg-slate-50 p-4 space-y-3 text-sm border border-slate-100">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-white border border-slate-200 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">
                    Per clean {result.usesCredit ? "(credit)" : ""}
                  </p>
                  <p className="text-sm font-bold text-slate-900 tabular-nums">
                    {fmtMoney(result.perCleanCents || 0)}
                  </p>
                </div>
                <div className="rounded-lg bg-white border border-slate-200 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">
                    {result.createGlowLink ? "Glow monthly" : "First clean"}
                  </p>
                  <p className="text-sm font-bold text-slate-900 tabular-nums">
                    {result.createGlowLink
                      ? `${fmtMoney(result.monthlyGlowCents || 0)}/mo`
                      : firstCleanBooked
                        ? "Booked"
                        : "Scheduled"}
                  </p>
                </div>
              </div>
              {upcoming.length > 0 && (
                <div className="rounded-lg bg-violet-50 border border-violet-100 px-3 py-2 text-xs text-violet-900">
                  <span className="font-semibold">Upcoming ({result.cadence}):</span>{" "}
                  {upcoming
                    .map((d) => format(new Date(`${d}T12:00:00`), "EEE MMM d"))
                    .join("  →  ")}{" "}
                  …
                </div>
              )}
              <ul className="space-y-1.5 pt-1">
                <ResultLine ok={firstCleanBooked || !result.firstCleanStatus}
                  label={
                    result.firstCleanStatus
                      ? firstCleanBooked
                        ? "First clean booked & cleaner assigned"
                        : `First clean: ${result.firstCleanStatus}`
                      : "First clean generation skipped"
                  } />
                <ResultLine ok={result.checklistSent} label="Cleaning checklist sent" muted={!result.checklistSent} />
                <ResultLine
                  ok={result.agreementSent}
                  label={result.hostedPayUrl ? "Sign-and-pay link sent (email/SMS)" : "Membership agreement emailed"}
                  muted={!result.agreementSent}
                />
                <ResultLine ok={result.manageLinkTexted} label="Manage link texted to customer" muted={!result.manageLinkTexted} />
              </ul>
            </div>

            {payUrl && (
              <div className="rounded-xl bg-slate-50 p-4 space-y-2 text-sm border border-slate-100">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {hostedUrl
                    ? "Sign-and-pay link (customer signs, then pays)"
                    : `Glow subscription payment link ${result.agreementSent ? "(released after they sign)" : ""}`}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Input value={payUrl} readOnly className="font-mono text-xs bg-white min-w-0 flex-1" />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      void navigator.clipboard.writeText(payUrl);
                      toast.success("Link copied");
                    }}
                  >
                    Copy
                  </Button>
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setResult(null)}
              >
                Create another
              </Button>
              <Button
                className="flex-1 bg-violet-600 hover:bg-violet-700 text-white"
                onClick={() => router.push("/admin/recurring")}
              >
                Open Recurring hub
                <RiArrowRightLine className="w-4 h-4 ml-1.5" />
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
          {linkedCustomerId && (
            <Badge className="bg-slate-100 text-slate-700 border-0 hover:bg-slate-100 text-[10px]">
              Existing customer · {linkedCustomerId.slice(0, 8)}
            </Badge>
          )}
        </div>
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1 className="font-jakarta text-[28px] leading-tight font-bold tracking-tight text-slate-900">
              Novara Internal Booking
            </h1>
            <p className="text-sm text-slate-500 mt-1 max-w-2xl">
              {isRecurring
                ? "Set up a recurring plan on behalf of a customer — the engine auto-books every cycle and assigns the preferred cleaner."
                : "Build a booking on behalf of a customer — quote, schedule, dispatch, and bill in a single flow."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
            <PartnerOnboardingLinkDialog
              name={`${firstName} ${lastName}`.trim()}
              email={email}
              phone={phone}
              className="border-slate-200 bg-white"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLeadLookupOpen((v) => !v)}
              className="border-slate-200 bg-white"
            >
              <RiUserSearchLine className="w-4 h-4 mr-1.5" />
              {leadLookupOpen ? "Close search" : "Search existing customer or lead"}
            </Button>
          </div>
        </div>
      </header>

      {/* Booking type — one-time vs recurring. Both flows reuse every section
          below; only the submit path and a few controls differ. */}
      <div className="mb-6">
        <div className="inline-flex w-full sm:w-auto rounded-2xl border border-slate-200 bg-slate-50 p-1 shadow-[0_1px_2px_0_rgba(15,23,42,0.04)]">
          {[
            { id: "one-time" as BookingType, label: "One-time clean", icon: RiSparklingLine, sub: "Single booking + invoice" },
            { id: "recurring" as BookingType, label: "Recurring plan", icon: RiRepeatLine, sub: "Auto-books every cycle" },
          ].map((opt) => {
            const activeTab = bookingType === opt.id;
            const Icon = opt.icon;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  setBookingType(opt.id);
                  // Recurring plans are always standard cleans.
                  if (opt.id === "recurring") setServiceType("standard");
                  setResult(null);
                }}
                className={cn(
                  "flex-1 sm:flex-none flex items-center gap-2.5 rounded-xl px-4 py-2.5 text-left transition-all",
                  activeTab
                    ? "bg-white shadow-[0_2px_8px_-2px_rgba(15,23,42,0.15)] ring-1 ring-slate-200"
                    : "hover:bg-white/60",
                )}
              >
                <span
                  className={cn(
                    "w-8 h-8 rounded-lg inline-flex items-center justify-center shrink-0",
                    activeTab ? "bg-violet-600 text-white" : "bg-slate-200 text-slate-500",
                  )}
                >
                  <Icon className="w-4 h-4" />
                </span>
                <span className="min-w-0">
                  <span
                    className={cn(
                      "block text-sm font-semibold leading-tight",
                      activeTab ? "text-slate-900" : "text-slate-600",
                    )}
                  >
                    {opt.label}
                  </span>
                  <span className="block text-[11px] text-slate-400 leading-tight">
                    {opt.sub}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

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
              {!searching && searchError && (
                <p className="text-xs text-rose-700 p-3">
                  Couldn&apos;t search: {searchError}
                </p>
              )}
              {!searching && !searchError && searchResults.length === 0 && (
                <p className="text-xs text-slate-500 p-3">
                  No customers or leads found. Try a name, email, or phone — or press × to close.
                </p>
              )}
              {searchResults.map((r) => {
                const isLinked =
                  r.kind === "customer"
                    ? linkedCustomerId === r.id
                    : linkedLead?.id === r.id;
                return (
                  <button
                    key={`${r.kind}:${r.id}`}
                    type="button"
                    onClick={() => applyResult(r)}
                    className={cn(
                      "w-full text-left p-3 hover:bg-slate-50 flex items-center justify-between transition-colors",
                      isLinked && "bg-violet-50/60",
                    )}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">
                        {r.first_name || ""} {r.last_name || ""}
                        {!r.first_name && !r.last_name && (
                          <span className="text-slate-400">(no name)</span>
                        )}
                      </p>
                      <p className="text-xs text-slate-500 truncate">
                        {r.phone || r.email || "—"}
                        {r.kind === "customer" && r.city
                          ? ` · ${r.city}${r.state ? `, ${r.state}` : ""}`
                          : ` · ${r.zip_code || "?"}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge
                        variant={r.kind === "customer" ? "default" : "outline"}
                        className="text-[10px] capitalize"
                      >
                        {r.kind}
                      </Badge>
                      {r.lead_score && (
                        <Badge variant="outline" className="text-[10px]">
                          {r.lead_score}
                        </Badge>
                      )}
                      {r.status && (
                        <Badge variant="secondary" className="text-[10px] capitalize">
                          {r.status.replaceAll("_", " ")}
                        </Badge>
                      )}
                    </div>
                  </button>
                );
              })}
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
              key={`va-service-address-${prefillKey}`}
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

            {/* One-time: pick the service tier. Recurring: pick the membership
                frequency — a recurring plan is always a STANDARD clean, so Deep,
                Move-In/Out, and the Deep+Standard combo aren't offered here. */}
            {!isRecurring ? (
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  Service type
                </Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
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
            ) : (
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  Membership frequency
                </Label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {MEMBERSHIP_CADENCE_OPTIONS.map((opt) => {
                    const active = cadence === opt.id;
                    const monthly = MEMBERSHIP_PRICES[homeSizeId]?.[opt.id];
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setCadence(opt.id)}
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
                          {monthly ? `$${monthly}/mo` : "Custom"}
                        </p>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-slate-500">
                  Recurring plans are standard cleans. Need a first-visit deep clean?
                  Add it in the summary (initial deep clean).
                </p>
              </div>
            )}

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

            <div className={cn("grid grid-cols-1 gap-4", isRecurring ? "sm:grid-cols-2" : "sm:grid-cols-3")}>
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
              {!isRecurring && (
                <Field label="Frequency">
                  <div className="h-10 flex items-center px-3 rounded-md border border-slate-200 bg-slate-50 text-sm text-slate-500">
                    One-time · switch to Recurring above
                  </div>
                </Field>
              )}
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
            title={isRecurring ? "First clean & cadence" : "Schedule"}
            description={
              isRecurring
                ? "Pick the first service date + preferred time window — every following clean repeats on the chosen cadence."
                : "Pick a date and time slot — same availability customers see."
            }
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

          {/* 4 — Payment / Billing */}
          <FormSection
            number={4}
            title={isRecurring ? "Billing & cleaner" : "Payment"}
            description={
              isRecurring
                ? "Per-clean rate, membership billing, and who cleans each visit."
                : "Invoice posture, promo, and comm preferences."
            }
            icon={<RiMoneyDollarCircleLine className="w-4 h-4" />}
          >
            {!isRecurring && (
              <>
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

                {(invoiceMode === "deposit_plus_remaining" ||
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
                )}
              </>
            )}

            {isRecurring && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field
                    label="Price / clean override ($)"
                    hint={`Catalog ${fmtMoney(pricing.perCleanCatalogCents)}. Blank = catalog.`}
                  >
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      value={overridePerClean}
                      onChange={(e) => setOverridePerClean(e.target.value)}
                      placeholder={(pricing.perCleanCatalogCents / 100).toFixed(2)}
                    />
                  </Field>
                  <Field label="Preferred cleaner" hint="Auto = the customer's previous cleaner.">
                    <Select value={preferredCleanerId} onValueChange={setPreferredCleanerId}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Auto (previous cleaner)</SelectItem>
                        {cleaners.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {`${c.first_name || ""} ${c.last_name || ""}`.trim() || "Cleaner"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>

                <label className="flex items-start gap-2.5 text-sm cursor-pointer rounded-xl border border-slate-200 bg-white p-3">
                  <Checkbox checked={usesCredit} onCheckedChange={(v) => setUsesCredit(v === true)} className="mt-0.5" />
                  <span>
                    <span className="font-medium text-slate-900">Covered by membership credit</span>
                    <span className="block text-[11px] text-slate-500 mt-0.5">
                      Each generated clean is billed against the customer's Glow credit
                      (no per-clean invoice). Leave off for pay-per-clean.
                    </span>
                  </span>
                </label>

                <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-3 space-y-2.5">
                  <label className="flex items-start gap-2.5 text-sm cursor-pointer">
                    <Checkbox checked={createGlowLink} onCheckedChange={(v) => setCreateGlowLink(v === true)} className="mt-0.5" />
                    <span>
                      <span className="font-medium text-violet-900">Create Glow subscription link (agree → pay)</span>
                      <span className="block text-[11px] text-violet-800/80 mt-0.5">
                        Generates a hosted Stripe subscription. Held until the customer
                        signs the membership agreement.
                      </span>
                    </span>
                  </label>
                  {createGlowLink && (
                    <Field
                      label="Monthly Glow override ($)"
                      hint={`Catalog ${fmtMoney(pricing.monthlyGlowCatalogCents)}/mo. Blank = catalog.`}
                    >
                      <Input
                        type="number"
                        min={1}
                        step={1}
                        value={monthlyGlowOverride}
                        onChange={(e) => setMonthlyGlowOverride(e.target.value)}
                        placeholder={(pricing.monthlyGlowCatalogCents / 100).toFixed(0)}
                        className="bg-white"
                      />
                    </Field>
                  )}
                </div>
              </>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {!isRecurring && (
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
              )}
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
                {isRecurring ? "On create" : "Notifications"}
              </p>
              {isRecurring ? (
                <>
                  <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <Checkbox
                      checked={generateFirstClean}
                      onCheckedChange={(v) => setGenerateFirstClean(v === true)}
                    />
                    Book &amp; assign the first clean now
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <Checkbox
                      checked={textManageLink}
                      onCheckedChange={(v) => setTextManageLink(v === true)}
                    />
                    Text customer their self-service manage link
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <Checkbox
                      checked={sendChecklistEmail}
                      onCheckedChange={(v) => setSendChecklistEmail(v === true)}
                    />
                    Send cleaning checklist (email/SMS)
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <Checkbox
                      checked={sendAgreement}
                      onCheckedChange={(v) => setSendAgreement(v === true)}
                    />
                    Send membership agreement (DocuSeal)
                  </label>
                </>
              ) : (
                <>
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
                </>
              )}
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
                    label={`${CADENCE_PLAN_LABEL[cadence]} · ${HOME_SIZE_RANGES.find((h) => h.id === homeSizeId)?.label?.replace(" sq ft", "") || ""}`}
                    value={`${fmtMoney(pricing.perCleanCents)}/clean`}
                  />
                ) : (
                  <SummaryRow
                    label={`${SERVICE_TYPE_OPTIONS.find((s) => s.id === serviceType)?.label} · ${HOME_SIZE_RANGES.find((h) => h.id === homeSizeId)?.label?.replace(" sq ft", "") || ""}`}
                    value={fmtMoney(pricing.serviceCents)}
                  />
                )}
                {pricing.addOnsCents > 0 && (
                  <SummaryRow
                    label={`Add-ons (${addOns.length})${pricing.isRecurring ? " · each visit" : ""}`}
                    value={pricing.isRecurring ? "included" : `+${fmtMoney(pricing.addOnsCents)}`}
                  />
                )}
                <Separator className="my-1.5" />
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-wider text-slate-500 font-semibold">
                    {pricing.isRecurring ? "Per clean" : "Total"}
                  </span>
                  <span className="font-jakarta text-2xl font-bold text-slate-900 tabular-nums">
                    {fmtMoney(pricing.isRecurring ? pricing.perCleanCents : pricing.totalCents)}
                    {pricing.isRecurring && (
                      <span className="text-sm font-semibold text-slate-500">/clean</span>
                    )}
                  </span>
                </div>
                {pricing.isRecurring ? (
                  <div className="space-y-2 pt-1">
                    {selectedDate && (
                      <div className="rounded-lg bg-violet-50 border border-violet-100 px-2.5 py-2 text-[11px] text-violet-900">
                        <p className="font-semibold uppercase tracking-wide text-[10px] text-violet-700 mb-0.5 flex items-center gap-1">
                          <RiCalendarScheduleLine className="w-3 h-3" /> Schedule preview
                        </p>
                        {previewRecurringDates(format(selectedDate, "yyyy-MM-dd"), cadence, 4)
                          .map((d) => format(new Date(`${d}T12:00:00`), "MMM d"))
                          .join("  →  ")}{" "}
                        …
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg bg-slate-50 border border-slate-200 px-2.5 py-1.5">
                        <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">
                          Billing
                        </p>
                        <p className="text-sm font-bold text-slate-900">
                          {usesCredit ? "Membership credit" : "Pay per clean"}
                        </p>
                      </div>
                      <div className="rounded-lg bg-slate-50 border border-slate-200 px-2.5 py-1.5">
                        <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">
                          Glow monthly
                        </p>
                        <p className="text-sm font-bold text-slate-900 tabular-nums">
                          {createGlowLink ? `${fmtMoney(pricing.monthlyGlowCents)}/mo` : "—"}
                        </p>
                      </div>
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

                {!pricing.isRecurring && walletCreditCents > 0 && (
                  <div className="rounded-lg bg-violet-50 border border-violet-200 px-3 py-2 text-xs text-violet-800 flex items-center gap-1.5 mt-2">
                    <RiWalletLine className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {fmtMoney(walletCreditCents)} wallet credit applied
                      automatically at checkout.
                    </span>
                  </div>
                )}

                {!isRecurring && (
                  <label className="flex items-start gap-2.5 text-sm cursor-pointer rounded-lg border border-primary/20 bg-primary/[0.03] p-3 mt-3">
                    <Checkbox checked={vaAgreedOnPhone} onCheckedChange={(v) => setVaAgreedOnPhone(v === true)} className="mt-0.5" />
                    <span>
                      I confirm the client <strong>verbally agreed</strong> to the Terms of Service, Disclaimer, Refund Policy
                      {" & One-Time Service Agreement"}{" "}
                      over the phone.{" "}
                      {invoiceMode === "deposit_plus_preauth"
                        ? "They'll review, check each policy, and e-sign on their payment link before the deposit — their copy is delivered after signing."
                        : "A signed copy will be emailed to them with their details."}
                    </span>
                  </label>
                )}

                {isRecurring && (
                  <div className="rounded-lg border border-violet-200 bg-violet-50 p-2.5 text-[11px] text-violet-900 mt-3 flex items-start gap-1.5">
                    <RiRepeatLine className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>
                      Creates a <strong>{cadence} recurring plan</strong>. The engine
                      auto-books a confirmed clean each cycle and assigns the
                      preferred/previous cleaner. The membership agreement is emailed
                      for e-sign.
                    </span>
                  </div>
                )}

                {isRecurring && (
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
                      {isRecurring ? "Creating plan…" : "Creating booking…"}
                    </>
                  ) : (
                    <>
                      {isRecurring ? "Create recurring plan" : "Create booking"}
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
                  {isRecurring
                    ? "Creating a plan saves a recurring schedule — the engine auto-books each cycle. Optional actions (first clean, checklist, agreement, Glow link, manage-link SMS) run on create."
                    : "This form bypasses the customer-facing checkout. Stripe invoices are sent based on the invoice mode you select above."}
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
  // Internal booking can pick ANY upcoming date — the standard 3-day lead is
  // no longer a hard block, just a "short notice" highlight so the booker
  // knows the date is inside the normal lead window.
  const today = startOfDay(new Date());
  const minDate = today;
  const recommendedDate = addDays(today, 3);
  const endDate = addDays(new Date(), 60);
  const [currentMonth, setCurrentMonth] = useState(startOfMonth(today));
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

  // Only past dates are blocked — weekends and short-notice dates are allowed.
  const isDateDisabled = (d: Date) => isBefore(startOfDay(d), today);
  // Selectable, but inside the standard 3-day lead window → flag it.
  const isShortNotice = (d: Date) =>
    !isDateDisabled(d) && isBefore(startOfDay(d), recommendedDate);

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
              const short = isShortNotice(day);
              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  onClick={() => !disabled && onDateSelect(day)}
                  disabled={disabled}
                  title={short ? "Short notice — under the standard 3-day lead time" : undefined}
                  className={cn(
                    "aspect-square rounded-lg text-xs font-medium transition-all relative flex items-center justify-center",
                    disabled && "text-slate-300 cursor-not-allowed",
                    !disabled && !isSel && !short && "text-slate-700 hover:bg-violet-50 hover:text-violet-900",
                    !disabled && !isSel && short && "text-amber-900 bg-amber-50 ring-1 ring-amber-300 hover:bg-amber-100",
                    isSel && "bg-violet-600 text-white shadow-[0_2px_8px_-2px_rgba(16,163,74,0.5)]",
                    !inMonth && !isSel && !short && "text-slate-300",
                    isToday && !isSel && !short && "ring-1 ring-violet-300",
                  )}
                >
                  {format(day, "d")}
                  {short && !isSel && (
                    <span aria-hidden className="absolute bottom-1 h-1 w-1 rounded-full bg-amber-400" />
                  )}
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-slate-400 mt-2 pl-1">
            Any upcoming date can be booked ·{" "}
            <span className="text-amber-600 font-semibold">amber = short notice</span>{" "}
            (under the standard 3-day lead)
          </p>
          {selectedDate && isShortNotice(selectedDate) && (
            <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5">
              <RiInformationLine className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
              <p className="text-[10px] leading-tight text-amber-800">
                <span className="font-semibold">Short notice.</span> This date is inside the
                standard 3-day lead time — confirm a crew can cover it before booking.
              </p>
            </div>
          )}
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

function ResultLine({
  ok,
  label,
  muted = false,
}: {
  ok: boolean;
  label: string;
  muted?: boolean;
}) {
  return (
    <li className="flex items-center gap-2 text-xs">
      {ok ? (
        <RiCheckboxCircleLine className="w-4 h-4 text-emerald-500 shrink-0" />
      ) : (
        <RiInformationLine className={cn("w-4 h-4 shrink-0", muted ? "text-slate-300" : "text-slate-400")} />
      )}
      <span className={cn(muted ? "text-slate-400" : "text-slate-600")}>{label}</span>
    </li>
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
