"use client";

// ─── /admin/bookings — Admin booking control center ───────────────────
//
// Mirrors the customer flow but admin-driven: list every booking, filter
// by date/status/service type, and cancel / reschedule / refund / mark
// completed from a side sheet. VAs can do everything a customer can do
// in the customer portal, plus the admin-only refund-and-cancel and
// hard cancel-without-refund.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  RiCalendarCheckLine,
  RiCalendarEventLine,
  RiCloseCircleLine,
  RiFilterLine,
  RiLoader4Line,
  RiRefreshLine,
  RiSearch2Line,
  RiMoneyDollarCircleLine,
  RiUserSmileLine,
  RiArrowGoBackLine,
  RiCheckLine,
  RiArrowRightLine,
  RiInformationLine,
  RiEdit2Line,
  RiDeleteBin6Line,
  RiCameraLine,
  RiImageAddLine,
  RiUploadCloud2Line,
  RiTimeLine,
  RiPriceTag3Line,
  RiListCheck2,
  RiArrowRightSLine,
  RiSubtractLine,
  RiUserStarLine,
  RiLoginCircleLine,
} from "@remixicon/react";
import { useAdminRole } from "@/hooks/use-admin-role";
import imageCompression from "browser-image-compression";
import { format } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MediaThumb } from "@/components/job-media/MediaThumb";
import { isVideoFile, videoTooLargeMessage } from "@/lib/job-media";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { RescheduleDialog } from "@/components/booking/RescheduleDialog";
import { DelayBookingDialog } from "@/components/booking/DelayBookingDialog";
import { ScopeAdjustmentDialog } from "@/components/booking/ScopeAdjustmentDialog";
import { isJobStillActive, isScopeAdjustable } from "@/lib/scope-adjustment";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {
  ADD_ONS,
  type AddOnId,
  calculatePrice,
  SERVICE_TIER_PRICING,
  HOME_SIZE_RANGES,
} from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { edgeResult } from "@/lib/edge-invoke";

/** Live contractor checklist progress, as attached by admin-list-bookings. */
interface ChecklistSummary {
  token: string | null;
  service_type: string | null;
  total_items: number | null;
  completed_items: number | null;
  progress_pct: number | null;
  started_at: string | null;
  completed_at: string | null;
  last_activity_at: string | null;
  last_activity_by: string | null;
}

interface BookingRow {
  id: string;
  booking_number: number | null;
  status: string | null;
  service_type: string | null;
  home_size_id: string | null;
  service_date: string | null;
  time_slot: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  total_estimate_cents: number | null;
  deposit_cents: number | null;
  final_charge_cents: number | null;
  payment_intent_id: string | null;
  cleaner_id: string | null;
  job_id: string | null;
  num_cleaners_assigned: number | null;
  estimated_duration_hours: number | null;
  created_at: string;
  uses_credit: boolean | null;
  cancel_reason: string | null;
  service_duration?: number | null;
  add_ons?: string[] | null;
  membership_plan?: string | null;
  hosted_invoice_url?: string | null;
  /** When true, skip post-job feedback / review SMS + email for this booking. */
  suppress_review_request?: boolean | null;
  // ─── Property details ──────────────────────────────────────────────────
  // What the crew is walking into. `sqft` is only set when a customer typed an
  // exact number; most bookings carry the size as `home_size_id` (a range), so
  // read both.
  sqft?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  dwelling_type?: string | null;
  pets?: string | null;
  flooring_type?: string | null;
  access_notes?: string | null;
  frequency?: string | null;
  checklist?: ChecklistSummary | null;
  check_in_time?: string | null;
}

interface ScopeAdjustmentRow {
  id: string;
  reason_codes: string[];
  original_price_cents: number;
  adjusted_price_cents: number;
  delta_cents: number;
  adjusted_service_type: string | null;
  evidence_missing: boolean;
  evidence_photo_count: number;
  amount_overridden: boolean;
  customer_message: string | null;
  message_channels: string[] | null;
  applied_at: string;
  applied_by_name: string | null;
  status: string;
  qc_issue_id: string | null;
  payout_supplement_cents: number | null;
}

const STATUS_COLORS: Record<string, string> = {
  pending_payment: "bg-amber-100 text-amber-900 border-amber-200",
  pending_details: "bg-amber-100 text-amber-900 border-amber-200",
  confirmed: "bg-violet-100 text-violet-900 border-violet-200",
  assigned: "bg-indigo-100 text-indigo-900 border-indigo-200",
  in_progress: "bg-blue-100 text-blue-900 border-blue-200",
  pending_review: "bg-amber-100 text-amber-900 border-amber-300",
  completed: "bg-blue-100 text-blue-900 border-blue-200",
  cancelled: "bg-slate-100 text-slate-700 border-slate-200",
};

const STATUS_LABELS: Record<string, string> = {
  pending_payment: "Pending",
  pending_review: "Cleaner done · review",
};

const STATUS_OPTIONS = [
  "all",
  "confirmed",
  "assigned",
  "pending_review",
  "completed",
  "cancelled",
  "pending_payment",
  "pending_details",
] as const;

const fmtMoney = (cents: number | null | undefined) =>
  cents == null ? "—" : `$${(cents / 100).toFixed(2)}`;

// ─── Property details ──────────────────────────────────────────────────────
//
// Size arrives two ways and almost always the second: `sqft` is only populated
// when someone typed an exact figure, while `home_size_id` is the priced range
// every booking carries. Prefer the exact number, fall back to the range, and
// never render a bare tier id like "1501_2000" at somebody.

/** Short size label for dense rows — "1,850 sq ft" or "1,501 – 2,000 sq ft". */
function homeSizeLabel(booking: {
  sqft?: number | null;
  home_size_id?: string | null;
}): string | null {
  if (booking.sqft && booking.sqft > 0) return `${booking.sqft.toLocaleString()} sq ft`;
  const id = booking.home_size_id;
  if (!id) return null;
  return HOME_SIZE_RANGES.find((h) => h.id === id)?.label ?? id.replaceAll("_", "–");
}

/** "3 bd · 2.5 ba" — omits either half rather than showing a zero. */
function bedBathLabel(booking: {
  bedrooms?: number | null;
  bathrooms?: number | null;
}): string | null {
  const parts: string[] = [];
  if (booking.bedrooms != null && booking.bedrooms > 0) parts.push(`${booking.bedrooms} bd`);
  if (booking.bathrooms != null && booking.bathrooms > 0) parts.push(`${booking.bathrooms} ba`);
  return parts.length ? parts.join(" · ") : null;
}

const PETS_LABELS: Record<string, string> = {
  none: "No pets",
  dog: "Dog",
  cat: "Cat",
  multiple: "Multiple pets",
  other: "Other pets",
};

const titleCase = (v: string) => v.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());

/** Compact one-liner for the list row: size · beds/baths · dwelling. */
function propertySummary(booking: BookingRow): string | null {
  const parts = [homeSizeLabel(booking), bedBathLabel(booking)].filter(Boolean) as string[];
  if (booking.dwelling_type) parts.push(titleCase(booking.dwelling_type));
  return parts.length ? parts.join(" · ") : null;
}

export default function AdminBookings() {
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("highlight");

  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  // Default to "all" so brand-new internal or customer bookings show up
  // immediately regardless of their `service_date` (the old default
  // "upcoming" used `service_date >= today` which silently hid bookings
  // dated yesterday in UTC, or any booking still missing a service_date).
  // Default to "all" so recently-completed or past-dated jobs (e.g. a
  // booking from yesterday) are never hidden — defaulting to a forward
  // date window made completed/past bookings look "deleted". Admins can
  // still narrow with the date filter.
  const [dateRange, setDateRange] = useState<
    "all" | "upcoming" | "next_14" | "this_week" | "past_30" | "last_7_created"
  >("all");
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [selected, setSelected] = useState<BookingRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-list-bookings", {
        body: {
          search: searchDebounced,
          status: statusFilter,
          dateRange,
          limit: 2000,
        },
      });
      if (error) {
        const ctx = (error as { context?: Response })?.context;
        if (ctx) {
          try {
            const body = await ctx.json();
            if (body?.error) throw new Error(String(body.error));
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message !== error.message) throw parseErr;
          }
        }
        throw error;
      }
      if ((data as { error?: string })?.error) {
        throw new Error((data as { error: string }).error);
      }
      const payload = data as { bookings?: BookingRow[]; total?: number };
      setBookings(payload.bookings || []);
      setTotalCount(payload.total ?? payload.bookings?.length ?? 0);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      setBookings([]);
      setTotalCount(null);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, dateRange, searchDebounced]);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-open the highlighted booking when arriving from internal-booking
  // success screen via `?highlight=…`.
  useEffect(() => {
    if (!highlightId || !bookings.length) return;
    const match = bookings.find((b) => b.id === highlightId);
    if (match) setSelected(match);
  }, [highlightId, bookings]);

  // Keep the open sheet's booking row fresh after mutations (customer info
  // edits, service adjusts, etc.) so the summary reflects the saved values.
  useEffect(() => {
    if (!selected) return;
    const match = bookings.find((b) => b.id === selected.id);
    if (match && match !== selected) setSelected(match);
  }, [bookings, selected]);

  const filtersActive =
    statusFilter !== "all" || dateRange !== "all" || search.trim().length > 0;

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setDateRange("all");
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="font-jakarta text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <RiCalendarCheckLine className="w-6 h-6 text-violet-700" />
            Bookings
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {totalCount != null
              ? `${totalCount} booking${totalCount === 1 ? "" : "s"} match current filters`
              : "Cancel, reschedule, refund, or mark complete — admin control over every booking."}
          </p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading} className="border-slate-200">
          <RiRefreshLine className={cn("w-4 h-4 mr-1.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <Card className="border-slate-200 shadow-sm rounded-2xl">
        <CardContent className="py-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="relative">
              <RiSearch2Line className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search name, email, phone, date…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setSearchDebounced(search.trim());
                }}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <RiFilterLine className="w-4 h-4 mr-2 text-slate-400" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s === "all" ? "All statuses" : (STATUS_LABELS[s] ?? s.replaceAll("_", " "))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={dateRange} onValueChange={(v) => setDateRange(v as typeof dateRange)}>
              <SelectTrigger>
                <RiCalendarEventLine className="w-4 h-4 mr-2 text-slate-400" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="next_14">Next 14 days (service date)</SelectItem>
                <SelectItem value="all">All bookings</SelectItem>
                <SelectItem value="upcoming">All upcoming (incl. no date)</SelectItem>
                <SelectItem value="this_week">This week + next Mon (weekend-safe)</SelectItem>
                <SelectItem value="last_7_created">Booked in last 7 days</SelectItem>
                <SelectItem value="past_30">Service in last 30 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {filtersActive ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-500">Filters active — some bookings may be hidden.</span>
              <Button type="button" variant="outline" size="sm" className="h-7" onClick={clearFilters}>
                Clear all filters
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* List */}
      <Card className="border-slate-200 shadow-sm rounded-2xl overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">
              {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : bookings.length === 0 ? (
            <p className="p-12 text-center text-sm text-slate-500">
              No bookings matched. Try <strong>All bookings</strong> or search by customer name or email.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {bookings.map((b) => {
                const statusKey = (b.status || "").toLowerCase();
                return (
                  <button
                    key={b.id}
                    onClick={() => setSelected(b)}
                    className={cn(
                      "w-full text-left grid grid-cols-12 gap-2 px-5 py-3 hover:bg-slate-50 transition-colors items-center",
                      highlightId === b.id && "bg-violet-50/50",
                    )}
                  >
                    <div className="col-span-12 md:col-span-3 min-w-0">
                      <p className="font-semibold text-slate-900 text-sm truncate">
                        {b.first_name || ""} {b.last_name || ""}
                        {!b.first_name && !b.last_name && (
                          <span className="text-slate-400">(no name)</span>
                        )}
                      </p>
                      <p className="text-xs text-slate-500 tabular-nums truncate">
                        #{b.booking_number || b.id.slice(0, 6)} · {b.email || "—"}
                      </p>
                    </div>
                    <div className="col-span-6 md:col-span-2">
                      <p className="text-sm text-slate-700 tabular-nums">
                        {b.service_date || "—"}
                      </p>
                      <p className="text-xs text-slate-500">{b.time_slot || ""}</p>
                    </div>
                    <div className="col-span-6 md:col-span-2 min-w-0">
                      <p className="text-sm text-slate-700 capitalize truncate">
                        {b.service_type ? b.service_type.replaceAll("_", " ") : "—"}
                      </p>
                      {/* Size and contents, so the list can be scanned for
                          "which of these is a big job" without opening each. */}
                      <p className="text-xs text-slate-500 truncate">
                        {propertySummary(b) || ""}
                      </p>
                    </div>
                    <div className="col-span-6 md:col-span-2 min-w-0">
                      <p className="text-xs text-slate-500 truncate">
                        {b.city ? `${b.city}, ${b.state || ""} ${b.zip_code || ""}` : "—"}
                      </p>
                      {b.checklist && (b.checklist.total_items ?? 0) > 0 ? (
                        <p
                          className={cn(
                            "text-xs tabular-nums truncate",
                            b.checklist.completed_at ? "text-emerald-600" : "text-slate-500",
                          )}
                        >
                          {b.checklist.completed_at ? "Checklist done" : "Checklist"}{" "}
                          {b.checklist.completed_items ?? 0}/{b.checklist.total_items}
                        </p>
                      ) : null}
                    </div>
                    <div className="col-span-6 md:col-span-2 text-sm tabular-nums text-slate-900 font-medium">
                      {fmtMoney(b.total_estimate_cents)}
                    </div>
                    <div className="col-span-12 md:col-span-1 flex md:justify-end">
                      <Badge
                        variant="outline"
                        className={cn("text-[10px] capitalize border", STATUS_COLORS[statusKey] ?? "")}
                      >
                        {STATUS_LABELS[b.status || ""] ?? (b.status || "—").replaceAll("_", " ")}
                      </Badge>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <BookingSheet
        booking={selected}
        onClose={() => setSelected(null)}
        onMutated={load}
      />
    </div>
  );
}

// ─── Manual cleaner assign (GHL contractor fields) ───────────────────

interface CleanerOption {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  status: string | null;
  pay_tier?: string | null;
  pay_percentage?: number | null;
}

const PAY_TIER_LADDER = [
  { tier: "foundation", pct: 35, label: "Foundation" },
  { tier: "proven", pct: 40, label: "Proven" },
  { tier: "elite", pct: 45, label: "Elite" },
] as const;

function nextPayTier(current: string | null | undefined) {
  const raw = String(current || "foundation").toLowerCase();
  const idx = Math.max(0, PAY_TIER_LADDER.findIndex((t) => t.tier === raw));
  return {
    current: PAY_TIER_LADDER[idx],
    next: PAY_TIER_LADDER[idx + 1] ?? null,
  };
}

function crewMoney(cents?: number | null) {
  if (cents == null) return null;
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** IRS-standard default used by Extra Pay / payroll mileage ($0.70/mi). */
const MILEAGE_RATE_CENTS = 70;

type MileageDraftRow = {
  cleanerId: string;
  name: string;
  miles: string;
  amount: string;
  /** Flat cleaner pay bump ($) — recorded as surge via admin-extra-pay. */
  payAdjust: string;
  recommendedMiles: number | null;
  recommendedAmountDollars: number | null;
  include: boolean;
};

function recommendedMileageDollars(miles: number | null | undefined): number | null {
  if (miles == null || !Number.isFinite(miles) || miles <= 0) return null;
  return Math.round(miles * MILEAGE_RATE_CENTS) / 100;
}

interface SuggestedCleaner {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  distance_miles: number | null;
  match_score: number;
  available: boolean;
  reason?: string;
  /** Set when this cleaner's earlier job that day leaves no room before this one. */
  bufferConflict?: string | null;
}

// AI/ops risk layer — advisory flags per cleaner for THIS job (score trends,
// QC history, stated-constraint mismatches). Flags + suggests only; assigning
// a flagged cleaner is always allowed — the human decides.
interface RiskInfo {
  overall: number | null;
  flags: string[];
}

type BookingAssignee = {
  id?: string | null;
  cleaner_id: string;
  role: string | null;
  status: string;
  estimated_pay_cents?: number | null;
  pay_percentage_snapshot?: number | null;
  crew_size_snapshot?: number | null;
  pay_tier?: string | null;
  pay_percentage?: number | null;
  first_name?: string | null;
  last_name?: string | null;
};

function BookingAssignBlock({
  booking,
  working,
  setWorking,
  onMutated,
}: {
  booking: BookingRow;
  working: string | null;
  setWorking: (v: string | null) => void;
  onMutated: () => void;
}) {
  const { isAdmin } = useAdminRole();
  const [cleaners, setCleaners] = useState<CleanerOption[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestedCleaner[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [assignees, setAssignees] = useState<BookingAssignee[]>([]);
  const [loadingCleaners, setLoadingCleaners] = useState(true);
  const [loadingSuggest, setLoadingSuggest] = useState(true);
  const [loadingAssignees, setLoadingAssignees] = useState(true);
  const [depositBlocked, setDepositBlocked] = useState(false);
  const [risk, setRisk] = useState<Map<string, RiskInfo>>(new Map());
  // The schedule buffer blocked this assignment. Holds the explanation the
  // server computed (projected end + how short the gap is) plus the reason the
  // admin types to force it — an override is only ever an explicit, logged act.
  const [bufferBlock, setBufferBlock] = useState<string | null>(null);
  const [bufferReason, setBufferReason] = useState("");
  const [checkedIn, setCheckedIn] = useState(Boolean(booking.check_in_time));
  const [mileageOpen, setMileageOpen] = useState(false);
  const [mileageRows, setMileageRows] = useState<MileageDraftRow[]>([]);
  const [mileageLoading, setMileageLoading] = useState(false);
  const [pendingAssign, setPendingAssign] = useState<{
    allowUnpaid: boolean;
    bufferOverrideReason?: string;
  } | null>(null);

  useEffect(() => {
    void (async () => {
      setLoadingCleaners(true);
      setLoadingSuggest(true);
      const [dir, sug, rsk] = await Promise.all([
        supabase
          .from("cleaners")
          .select("id, first_name, last_name, phone, status, pay_tier, pay_percentage")
          .eq("status", "active")
          .eq("approved", true)
          .order("last_name"),
        supabase.functions.invoke("admin-booking-assign", {
          body: { action: "suggest_cleaners", bookingId: booking.id, limit: 8 },
        }),
        supabase.functions.invoke("cleaner-scores-admin", {
          body: { action: "risk_flags", bookingId: booking.id },
        }),
      ]);
      setCleaners((dir.data || []) as CleanerOption[]);
      setLoadingCleaners(false);
      if (!sug.error && (sug.data as { suggestions?: SuggestedCleaner[] })?.suggestions) {
        setSuggestions((sug.data as { suggestions: SuggestedCleaner[] }).suggestions);
      } else {
        setSuggestions([]);
      }
      setLoadingSuggest(false);
      const riskRows = (rsk.data as { cleaners?: Array<{ cleanerId: string; overall: number | null; flags: string[] }> })?.cleaners;
      if (!rsk.error && riskRows) {
        setRisk(new Map(riskRows.map((r) => [r.cleanerId, { overall: r.overall, flags: r.flags || [] }])));
      }
    })();
  }, [booking.id]);

  useEffect(() => {
    setCheckedIn(Boolean(booking.check_in_time));
  }, [booking.check_in_time]);

  const enrichAssignees = async (rows: BookingAssignee[]) => {
    const ids = [...new Set(rows.map((r) => r.cleaner_id).filter(Boolean))];
    if (ids.length === 0) return rows;
    const { data } = await supabase
      .from("cleaners")
      .select("id, first_name, last_name, pay_tier, pay_percentage")
      .in("id", ids);
    type PayProfile = {
      id: string;
      first_name: string | null;
      last_name: string | null;
      pay_tier: string | null;
      pay_percentage: number | null;
    };
    const byId = new Map(((data || []) as PayProfile[]).map((c) => [c.id, c]));
    return rows.map((r) => {
      const c = byId.get(r.cleaner_id);
      return c
        ? {
            ...r,
            first_name: c.first_name,
            last_name: c.last_name,
            pay_tier: c.pay_tier,
            pay_percentage: c.pay_percentage,
          }
        : r;
    });
  };

  useEffect(() => {
    setLoadingAssignees(true);
    if (!booking.job_id) {
      void (async () => {
        const fallback = booking.cleaner_id
          ? await enrichAssignees([
              { cleaner_id: booking.cleaner_id, role: "Lead", status: "Assigned" },
            ])
          : [];
        setAssignees(fallback);
        setSelectedIds(fallback.map((a) => a.cleaner_id));
        setLoadingAssignees(false);
      })();
      return;
    }
    void (async () => {
      // Cast: generated types lag columns like crew_size_snapshot on job_assignments.
      const { data } = await (supabase.from as any)("job_assignments")
        .select("id, cleaner_id, role, status, estimated_pay_cents, pay_percentage_snapshot, crew_size_snapshot")
        .eq("job_id", booking.job_id)
        .in("status", ["Confirmed", "Accepted", "Assigned", "Offered", "In Progress"]);
      const rows = ((data || []) as BookingAssignee[])
        .filter((a) => a.cleaner_id)
        .slice()
        .sort((a, b) =>
          String(a.role || "").toLowerCase() === "lead" ? -1 : 1,
        );
      setAssignees(await enrichAssignees(rows));
      // Pre-seed the replace form with the current crew so adding one person
      // doesn't accidentally wipe the rest on Save.
      const ids = rows.map((a) => a.cleaner_id).slice(0, 3);
      setSelectedIds(ids.length ? ids : booking.cleaner_id ? [booking.cleaner_id] : []);
      setLoadingAssignees(false);
    })();
  }, [booking.id, booking.job_id, booking.cleaner_id, booking.num_cleaners_assigned]);

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 3) {
        toast.error("Select up to 3 cleaners.");
        return prev;
      }
      return [...prev, id];
    });
  };

  const buildMileageRows = (distanceById: Map<string, number | null>): MileageDraftRow[] =>
    selectedIds.map((id) => {
      const c = cleaners.find((x) => x.id === id);
      const name = c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Cleaner" : "Cleaner";
      const miles = distanceById.get(id) ?? null;
      const recommended = recommendedMileageDollars(miles);
      return {
        cleanerId: id,
        name,
        miles: miles != null ? String(miles) : "",
        amount: recommended != null ? recommended.toFixed(2) : "",
        payAdjust: "",
        recommendedMiles: miles,
        recommendedAmountDollars: recommended,
        include: miles != null && miles > 0,
      };
    });

  /** Open mileage + pay-adjustment popup before assign — $0.70/mi from distance. */
  const openMileageThenAssign = async (
    allowUnpaid = false,
    bufferOverrideReason?: string,
  ) => {
    if (selectedIds.length === 0) {
      toast.error("Pick at least one cleaner from the directory.");
      return;
    }
    setPendingAssign({ allowUnpaid, bufferOverrideReason });
    setMileageLoading(true);
    setMileageOpen(true);
    try {
      // Refresh distances for a wider set so directory picks (not just top
      // suggestions) still get a recommended mileage when possible.
      const distanceById = new Map<string, number | null>();
      for (const s of suggestions) {
        if (s.distance_miles != null) distanceById.set(s.id, Number(s.distance_miles));
      }
      const { data, error } = await supabase.functions.invoke("admin-booking-assign", {
        body: { action: "suggest_cleaners", bookingId: booking.id, limit: 80 },
      });
      if (!error) {
        const rows = (data as { suggestions?: SuggestedCleaner[] })?.suggestions || [];
        for (const s of rows) {
          if (s.distance_miles != null) distanceById.set(s.id, Number(s.distance_miles));
        }
      }
      setMileageRows(buildMileageRows(distanceById));
    } catch {
      setMileageRows(buildMileageRows(new Map()));
    } finally {
      setMileageLoading(false);
    }
  };

  const updateMileageRow = (
    cleanerId: string,
    patch: Partial<Pick<MileageDraftRow, "miles" | "amount" | "payAdjust" | "include">>,
  ) => {
    setMileageRows((prev) =>
      prev.map((r) => {
        if (r.cleanerId !== cleanerId) return r;
        const next = { ...r, ...patch };
        // Editing miles recalculates the recommended $ (admin can still
        // override amount afterward).
        if (patch.miles != null && patch.amount == null) {
          const miles = parseFloat(patch.miles);
          const rec = recommendedMileageDollars(Number.isFinite(miles) ? miles : null);
          if (rec != null) next.amount = rec.toFixed(2);
        }
        return next;
      }),
    );
  };

  /**
   * Record assign-time mileage and/or flat pay adjustment via job_extra_pay.
   * Portal pay (get-cleaner-portal) already folds these extras into display.
   */
  const recordAssignExtras = async (rows: MileageDraftRow[]) => {
    let paid = 0;
    let failed = 0;
    for (const row of rows) {
      const miles = row.include ? Math.max(0, parseFloat(row.miles) || 0) : 0;
      const amountCents = row.include
        ? Math.max(0, Math.round((parseFloat(row.amount) || 0) * 100))
        : 0;
      const payAdjustCents = Math.max(0, Math.round((parseFloat(row.payAdjust) || 0) * 100));
      if (amountCents <= 0 && payAdjustCents <= 0) continue;

      // admin-extra-pay stores miles × rate; derive rate so customized $ sticks.
      const body: Record<string, unknown> = {
        action: "pay",
        cleanerId: row.cleanerId,
        bookingId: booking.id,
        note:
          amountCents > 0 && payAdjustCents > 0
            ? "Assign-time mileage + pay adjustment"
            : payAdjustCents > 0
              ? "Assign-time pay adjustment"
              : "Assign-time mileage",
      };
      if (amountCents > 0) {
        const milesForApi = miles > 0 ? miles : 1;
        body.mileageMiles = milesForApi;
        body.mileageRateCents =
          miles > 0 ? Math.max(1, Math.round(amountCents / miles)) : amountCents;
      }
      if (payAdjustCents > 0) {
        // Flat bump to cleaner pay — same ledger the portal shows as extras.
        body.surgeCents = payAdjustCents;
      }

      try {
        const { data, error } = await supabase.functions.invoke("admin-extra-pay", { body });
        if (error || (data as { error?: string })?.error) {
          failed += 1;
        } else {
          paid += 1;
        }
      } catch {
        failed += 1;
      }
    }
    return { paid, failed };
  };

  const assign = async (
    allowUnpaid = false,
    bufferOverrideReason?: string,
    mileage: MileageDraftRow[] | null = null,
  ) => {
    if (selectedIds.length === 0) {
      toast.error("Pick at least one cleaner from the directory.");
      return;
    }
    setWorking("assign");
    try {
      const { data, error } = await supabase.functions.invoke("admin-booking-assign", {
        body: {
          bookingId: booking.id,
          cleanerIds: selectedIds,
          mode: "replace",
          allowUnpaid,
          bufferOverrideReason,
        },
      });
      // On non-2xx the supabase client returns a FunctionsHttpError whose
      // `context` is the raw Response — the JSON body (error message +
      // code like "deposit_unpaid") must be parsed out of it, otherwise
      // every failure surfaces as a useless generic toast and the deposit
      // override button never appears.
      let payload = (data ?? {}) as { error?: string; code?: string; bufferConflict?: unknown };
      if (!payload?.code && !payload?.error && error) {
        const ctx = (error as any)?.context;
        try {
          if (ctx && typeof ctx.json === "function" && !ctx.bodyUsed) {
            payload = await ctx.json();
          }
        } catch { /* body unavailable — fall through to generic error */ }
      }
      if (payload?.code === "deposit_unpaid") {
        setDepositBlocked(true);
        // Keep mileage draft so override can reuse it.
        if (mileage) setMileageRows(mileage);
        toast.error(
          "Customer hasn't paid the deposit yet — assignment blocked. Use the override below for cash/comp jobs.",
        );
        return;
      }
      if (payload?.code === "buffer_conflict") {
        setBufferBlock(payload.error || "This start time leaves no buffer after the crew's earlier job.");
        if (mileage) setMileageRows(mileage);
        toast.error("No buffer after this crew's earlier job — assignment blocked.");
        return;
      }
      if (payload?.error) throw new Error(payload.error);
      if (error) throw error;
      setDepositBlocked(false);
      setBufferBlock(null);
      setBufferReason("");
      setPendingAssign(null);

      let extrasNote = "";
      const hasExtras =
        mileage &&
        mileage.some(
          (r) =>
            (r.include && (parseFloat(r.amount) || 0) > 0) ||
            (parseFloat(r.payAdjust) || 0) > 0,
        );
      if (hasExtras) {
        const { paid, failed } = await recordAssignExtras(mileage);
        if (paid > 0) extrasNote = ` · extras recorded for ${paid}`;
        if (failed > 0) extrasNote += ` · ${failed} extras failed`;
      }

      const notes = (data as { notifications?: Array<{ email?: boolean; sms?: boolean }> })?.notifications;
      const emailed = notes?.filter((n) => n.email).length ?? 0;
      const texted = notes?.filter((n) => n.sms).length ?? 0;
      toast.success(
        `Assigned · GHL synced · ${emailed} email · ${texted} SMS · GHL task(s) created when contact is linked${extrasNote}`,
      );
      onMutated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(null);
    }
  };

  const confirmMileageAndAssign = async (withExtras: boolean) => {
    const opts = pendingAssign || { allowUnpaid: false };
    setMileageOpen(false);
    await assign(opts.allowUnpaid, opts.bufferOverrideReason, withExtras ? mileageRows : []);
  };

  // Admin-approved offer blast: scores nearby cleaners and texts them the
  // tokenized offer (the ONLY way offers go out besides the Dispatch page).
  const sendOffers = async () => {
    if (!confirm("Send SMS job offers to the best-matched nearby cleaners now? First to accept wins their slot.")) return;
    setWorking("send_offers");
    try {
      const { data, error } = await supabase.functions.invoke("auto-dispatch-booking", {
        body: { bookingId: booking.id, sendOffers: true },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const payload = data as { offersSent?: number; noCleanersAvailable?: boolean };
      if (payload?.noCleanersAvailable) {
        toast.warning("No eligible cleaners found right now — assign manually above or retry later.");
      } else {
        toast.success(`Offers sent to ${payload?.offersSent ?? 0} cleaner(s).`);
      }
      onMutated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(null);
    }
  };

  const authHeaders = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("Not signed in");
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    };
  };

  const callUnassign = async (cleanerId?: string) => {
    const res = await fetch("/api/admin/unassign-job", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify(cleanerId ? { bookingId: booking.id, cleanerId } : { bookingId: booking.id }),
    });
    const json = await res.json();
    if (!res.ok || json?.error) throw new Error(json?.error || "Unassign failed");
  };

  const unassignOne = async (cleanerId: string, label: string) => {
    if (!confirm(`Unassign ${label} from this job? It will drop off their dashboard.`)) return;
    setWorking(`unassign-${cleanerId}`);
    try {
      await callUnassign(cleanerId);
      toast.success(`${label} unassigned — removed from their dashboard, GHL + Airtable synced`);
      onMutated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(null);
    }
  };

  const unassignAll = async () => {
    if (!confirm("Unassign all cleaners from this job? It will drop off their dashboards and the job reopens for assignment.")) return;
    setWorking("unassign-all");
    try {
      await callUnassign();
      toast.success("All cleaners unassigned — removed from their dashboards, GHL + Airtable synced");
      onMutated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(null);
    }
  };

  const setLead = async (cleanerId: string, label: string) => {
    if (!confirm(`Make ${label} the lead on this job?`)) return;
    setWorking(`lead-${cleanerId}`);
    try {
      const res = await fetch("/api/admin/booking-crew", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ action: "set_lead", bookingId: booking.id, cleanerId }),
      });
      const json = await res.json();
      if (!res.ok || json?.error) throw new Error(json?.error || "Could not set lead");
      toast.success(`${label} is now lead`);
      onMutated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(null);
    }
  };

  const increasePayoutTier = async (a: BookingAssignee, label: string) => {
    const { current, next } = nextPayTier(a.pay_tier);
    if (!next) {
      toast.info(`${label} is already at Elite.`);
      return;
    }
    if (
      !confirm(
        `Increase ${label}'s payout tier from ${current.label} (${a.pay_percentage ?? current.pct}%) to ${next.label} (${next.pct}%)?\n\nThey get an email about the raise. This job's locked pay snapshot stays until you re-assign or recalc; future jobs use the new tier.`,
      )
    ) {
      return;
    }
    setWorking(`tier-${a.cleaner_id}`);
    try {
      const { data, error } = await supabase.functions.invoke("cleaner-admin-action", {
        body: { action: "advance_pay_tier", cleanerId: a.cleaner_id },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      toast.success(`${label} → ${next.label} (${next.pct}%)`);
      onMutated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(null);
    }
  };

  const checkInAssignee = async (a: BookingAssignee, label: string) => {
    if (!a.id) {
      toast.error("No assignment row for check-in — try re-assigning first.");
      return;
    }
    if (!confirm(`Start this job / check in ${label}? Same as their portal Check in — texts the BEFORE-photos link.`)) return;
    setWorking(`checkin-${a.cleaner_id}`);
    try {
      const { data, error } = await supabase.functions.invoke("admin-cleaner-jobs", {
        body: { action: "check_in", assignmentId: a.id },
      });
      if (error) throw error;
      const d = data as { ok?: boolean; error?: string; alreadyCheckedIn?: boolean };
      if (d?.ok === false || d?.error) throw new Error(d?.error || "Check-in failed");
      setCheckedIn(true);
      toast.success(d?.alreadyCheckedIn ? "Job was already checked in." : `Checked in ${label} — before-photos link texted.`);
      onMutated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(null);
    }
  };

  const sendCrewPhotoLink = async (a: BookingAssignee, phase: "before" | "after" | "both") => {
    setWorking(`photo-${a.cleaner_id}-${phase}`);
    try {
      const { data, error } = await supabase.functions.invoke("admin-cleaner-sms", {
        body: { cleanerId: a.cleaner_id, template: "photo_request", bookingId: booking.id, phase },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      toast.success(
        phase === "before" ? "Before-photos link texted." : phase === "after" ? "After-photos link texted." : "Combined photo link texted.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(null);
    }
  };

  if (booking.status === "cancelled" || booking.status === "completed") return null;

  const hasAssignment =
    assignees.length > 0 || Boolean(booking.cleaner_id) || (booking.num_cleaners_assigned ?? 0) > 0;

  const cleanerName = (a: BookingAssignee | string) => {
    if (typeof a === "string") {
      const c = cleaners.find((x) => x.id === a);
      return c ? `${c.first_name} ${c.last_name}` : "Cleaner";
    }
    if (a.first_name || a.last_name) return `${a.first_name || ""} ${a.last_name || ""}`.trim();
    const c = cleaners.find((x) => x.id === a.cleaner_id);
    return c ? `${c.first_name} ${c.last_name}` : "Cleaner";
  };

  const crewBusy = Boolean(
    working &&
      (working.startsWith("unassign") ||
        working.startsWith("lead-") ||
        working.startsWith("tier-") ||
        working.startsWith("checkin-") ||
        working.startsWith("photo-")),
  );

  return (
    <div className="space-y-3">
      {/* Current crew — manage who's on the job (separate from assign/replace). */}
      <Card className="border-rose-200 bg-rose-50/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-1.5 text-rose-900">
            <RiUserStarLine className="w-4 h-4" />
            Current crew
          </CardTitle>
          <CardDescription>
            Manage who&apos;s on this job: lead, payout tier, check-in, photo links, or unassign.
            {checkedIn ? " · Job checked in ✓" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loadingAssignees ? (
            <Skeleton className="h-16 w-full" />
          ) : !hasAssignment ? (
            <p className="text-xs text-slate-500">No cleaners assigned yet.</p>
          ) : (
            <>
              {assignees.length === 0 ? (
                <p className="text-xs text-slate-500">
                  Booking shows {booking.num_cleaners_assigned ?? 1} assigned, but no active
                  assignment rows were found. You can still clear the crew below.
                </p>
              ) : (
                <div className="space-y-2">
                  {assignees.map((a) => {
                    const name = cleanerName(a);
                    const isLead = String(a.role || "").toLowerCase() === "lead" || a.cleaner_id === booking.cleaner_id;
                    const { current, next } = nextPayTier(a.pay_tier);
                    const payLabel = crewMoney(a.estimated_pay_cents);
                    const tierPct = a.pay_percentage ?? current.pct;
                    const snapPct = a.pay_percentage_snapshot;
                    return (
                      <div
                        key={`${a.cleaner_id}-${a.status}-${a.id || ""}`}
                        className="rounded-md border border-rose-100 bg-white px-3 py-2.5 space-y-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-900 truncate">
                              {name}
                              {isLead ? (
                                <Badge className="ml-1.5 bg-violet-100 text-violet-800 text-[10px] font-semibold">Lead</Badge>
                              ) : null}
                            </p>
                            <p className="text-[11px] text-slate-500">
                              {a.role || (isLead ? "Lead" : "Support")} · {a.status}
                              {payLabel ? ` · est. ${payLabel}` : ""}
                              {snapPct != null ? ` @ ${snapPct}%` : ""}
                              {a.crew_size_snapshot != null && a.crew_size_snapshot > 1
                                ? ` · crew of ${a.crew_size_snapshot}`
                                : ""}
                            </p>
                            <p className="text-[11px] text-slate-500">
                              Payout tier: {current.label} · {tierPct}%
                              {next ? ` · next ${next.label} ${next.pct}%` : " · max tier"}
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {!isLead && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={crewBusy}
                              onClick={() => setLead(a.cleaner_id, name)}
                            >
                              {working === `lead-${a.cleaner_id}` ? (
                                <RiLoader4Line className="w-4 h-4 animate-spin" />
                              ) : (
                                "Make lead"
                              )}
                            </Button>
                          )}
                          {isAdmin && next && (
                            <Button
                              size="sm"
                              className="bg-emerald-600 hover:bg-emerald-700 text-white"
                              disabled={crewBusy}
                              onClick={() => increasePayoutTier(a, name)}
                            >
                              {working === `tier-${a.cleaner_id}` ? (
                                <RiLoader4Line className="w-4 h-4 animate-spin" />
                              ) : (
                                <>
                                  <RiUserStarLine className="w-3.5 h-3.5 mr-1" />
                                  Increase payout tier
                                </>
                              )}
                            </Button>
                          )}
                          {!checkedIn && a.id && (
                            <Button
                              size="sm"
                              className="bg-emerald-600 hover:bg-emerald-700 text-white"
                              disabled={crewBusy}
                              onClick={() => checkInAssignee(a, name)}
                            >
                              {working === `checkin-${a.cleaner_id}` ? (
                                <RiLoader4Line className="w-4 h-4 animate-spin" />
                              ) : (
                                <>
                                  <RiLoginCircleLine className="w-3.5 h-3.5 mr-1" />
                                  Check in
                                </>
                              )}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={crewBusy}
                            onClick={() => sendCrewPhotoLink(a, "both")}
                          >
                            {working === `photo-${a.cleaner_id}-both` ? (
                              <RiLoader4Line className="w-4 h-4 animate-spin" />
                            ) : (
                              <>
                                <RiCameraLine className="w-3.5 h-3.5 mr-1" />
                                Photo link
                              </>
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-rose-200 text-rose-700 hover:bg-rose-50"
                            disabled={crewBusy}
                            onClick={() => unassignOne(a.cleaner_id, name)}
                          >
                            {working === `unassign-${a.cleaner_id}` ? (
                              <RiLoader4Line className="w-4 h-4 animate-spin" />
                            ) : (
                              "Unassign"
                            )}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <Button
                onClick={unassignAll}
                disabled={crewBusy}
                variant="outline"
                size="sm"
                className="w-full border-rose-300 text-rose-800 hover:bg-rose-50"
              >
                {working === "unassign-all" ? (
                  <>
                    <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" />
                    Unassigning…
                  </>
                ) : assignees.length > 1 ? (
                  "Unassign entire crew"
                ) : (
                  "Unassign & reopen job"
                )}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="border-indigo-200 bg-indigo-50/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-1.5 text-indigo-900">
            <RiUserSmileLine className="w-4 h-4" />
            Assign / replace crew
          </CardTitle>
          <CardDescription>
            Nearby / available cleaners are ranked first. Saving replaces the crew with your
            selection, emails + texts them, and creates a GHL task when the customer is linked.
            Use Current crew above to drop someone without replacing the rest.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!loadingSuggest && suggestions.length > 0 ? (
            <div className="space-y-1">
              <p className="text-[11px] font-semibold text-indigo-800 uppercase tracking-wide">
                Suggested (nearby &amp; available)
              </p>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.slice(0, 6).map((s) => {
                  const on = selectedIds.includes(s.id);
                  const r = risk.get(s.id);
                  const flagged = (r?.flags.length || 0) > 0;
                  // A buffer conflict is harder than a risk flag: this crew
                  // physically can't get here in time without an override.
                  const noRoom = Boolean(s.bufferConflict);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggle(s.id)}
                      title={
                        [s.bufferConflict, flagged ? r!.flags.join("\n") : null]
                          .filter(Boolean)
                          .join("\n") || undefined
                      }
                      className={cn(
                        "text-xs px-2 py-1 rounded-full border transition-colors",
                        on
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : noRoom
                            ? "bg-orange-50 text-orange-900 border-orange-300 hover:bg-orange-100"
                            : flagged
                              ? "bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100"
                              : "bg-white text-indigo-900 border-indigo-200 hover:bg-indigo-50",
                      )}
                    >
                      {noRoom ? "⏱ " : flagged ? "⚠ " : ""}
                      {s.first_name} {s.last_name?.[0]}.
                      {r?.overall != null ? ` · ${Math.round(r.overall)}` : ""}
                      {s.distance_miles != null ? ` · ${s.distance_miles} mi` : ""}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          {/* Risk layer: advisory only — flags + reasons, human decides. */}
          {selectedIds.some((id) => (risk.get(id)?.flags.length || 0) > 0) && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 space-y-1">
              <p className="font-semibold">Risk flags on your selection (advisory — you decide):</p>
              {selectedIds.map((id) => {
                const r = risk.get(id);
                if (!r || r.flags.length === 0) return null;
                const c = cleaners.find((x) => x.id === id);
                return (
                  <div key={id}>
                    <span className="font-medium">{c ? `${c.first_name} ${c.last_name}` : "Cleaner"}:</span>{" "}
                    {r.flags.join(" · ")}
                  </div>
                );
              })}
            </div>
          )}
          {loadingCleaners ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <div className="max-h-40 overflow-y-auto space-y-1 border border-slate-200 rounded-md bg-white p-2">
              {cleaners.map((c) => {
                const checked = selectedIds.includes(c.id);
                return (
                  <label
                    key={c.id}
                    className={cn(
                      "flex items-center gap-2 text-sm px-2 py-1.5 rounded cursor-pointer",
                      checked ? "bg-indigo-50" : "hover:bg-slate-50",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(c.id)}
                      className="rounded border-slate-300"
                    />
                    <span className="font-medium text-slate-900">
                      {c.first_name} {c.last_name}
                    </span>
                    <span className="text-xs text-slate-500 ml-auto">{c.phone || ""}</span>
                  </label>
                );
              })}
            </div>
          )}
          {depositBlocked && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 space-y-2">
              <p className="font-medium">
                Deposit not received yet — this customer hasn&apos;t paid. Assigning a cleaner is
                blocked until the deposit clears.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="w-full border-amber-400 text-amber-900 hover:bg-amber-100"
                onClick={() => openMileageThenAssign(true)}
                disabled={working === "assign"}
              >
                Assign anyway (override — cash / comp job)
              </Button>
            </div>
          )}
          {bufferBlock && (
            <div className="rounded-md border border-orange-300 bg-orange-50 px-3 py-2 text-xs text-orange-900 space-y-2">
              <p className="font-medium">{bufferBlock}</p>
              <p className="text-orange-800/90">
                Pick a different crew or time, or force it with a reason. Overrides stay on the
                booking — if this turns into a cascade later, this is where it started.
              </p>
              <Input
                value={bufferReason}
                onChange={(e) => setBufferReason(e.target.value)}
                placeholder="Why is this the right call? (required, logged)"
                className="bg-white text-sm"
              />
              <Button
                variant="outline"
                size="sm"
                className="w-full border-orange-400 text-orange-900 hover:bg-orange-100"
                onClick={() => openMileageThenAssign(false, bufferReason.trim())}
                disabled={working === "assign" || bufferReason.trim().length < 8}
              >
                Assign inside the buffer anyway (logged override)
              </Button>
            </div>
          )}
          <Button
            onClick={() => openMileageThenAssign(false)}
            disabled={working === "assign"}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            {working === "assign" ? (
              <>
                <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" />
                Saving &amp; syncing GHL…
              </>
            ) : (
              "Save, notify cleaners & sync GHL"
            )}
          </Button>
          <Button
            onClick={sendOffers}
            disabled={working === "send_offers"}
            variant="outline"
            className="w-full border-indigo-300 text-indigo-800 hover:bg-indigo-50"
          >
            {working === "send_offers" ? (
              <>
                <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" />
                Sending offers…
              </>
            ) : (
              "Send SMS offers to best-matched cleaners"
            )}
          </Button>
          <p className="text-[11px] text-slate-500 -mt-1">
            Offers only ever go out from this button or the Dispatch page — nothing is texted to
            contractors automatically.
          </p>
        </CardContent>
      </Card>

      <Dialog
        open={mileageOpen}
        onOpenChange={(open) => {
          setMileageOpen(open);
          if (!open) setPendingAssign(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Mileage &amp; pay for this assignment</DialogTitle>
            <DialogDescription>
              Mileage recommended at ${(MILEAGE_RATE_CENTS / 100).toFixed(2)}/mi from home to the
              job. Optional pay adjustment is added on top of base cut and shows in the cleaner
              portal as extras.
            </DialogDescription>
          </DialogHeader>
          {mileageLoading ? (
            <div className="py-8 flex justify-center">
              <RiLoader4Line className="w-5 h-5 animate-spin text-slate-400" />
            </div>
          ) : (
            <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
              {mileageRows.map((row) => (
                <div
                  key={row.cleanerId}
                  className="rounded-md border border-slate-200 bg-slate-50/60 p-3 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">{row.name}</p>
                      <p className="text-[11px] text-slate-500">
                        {row.recommendedMiles != null
                          ? `Recommended ${row.recommendedMiles} mi · $${(row.recommendedAmountDollars ?? 0).toFixed(2)}`
                          : "No distance on file — enter miles or $ manually"}
                      </p>
                    </div>
                    <label className="flex items-center gap-1.5 text-xs text-slate-600 shrink-0">
                      <input
                        type="checkbox"
                        checked={row.include}
                        onChange={(e) =>
                          updateMileageRow(row.cleanerId, { include: e.target.checked })
                        }
                        className="rounded border-slate-300"
                      />
                      Mileage
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs text-slate-600">Miles</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.1"
                        value={row.miles}
                        disabled={!row.include}
                        onChange={(e) =>
                          updateMileageRow(row.cleanerId, { miles: e.target.value })
                        }
                        placeholder="0"
                        className="bg-white mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-slate-600">Mileage ($)</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={row.amount}
                        disabled={!row.include}
                        onChange={(e) =>
                          updateMileageRow(row.cleanerId, { amount: e.target.value })
                        }
                        placeholder="0.00"
                        className="bg-white mt-1"
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-slate-600">Pay adjustment ($)</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={row.payAdjust}
                      onChange={(e) =>
                        updateMileageRow(row.cleanerId, { payAdjust: e.target.value })
                      }
                      placeholder="0.00"
                      className="bg-white mt-1"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">
                      Flat bump to this cleaner&apos;s pay for the job (optional). Leave blank to skip.
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-2 flex-col sm:flex-row">
            <Button
              type="button"
              variant="outline"
              disabled={working === "assign" || mileageLoading}
              onClick={() => confirmMileageAndAssign(false)}
            >
              Assign without extras
            </Button>
            <Button
              type="button"
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
              disabled={working === "assign" || mileageLoading}
              onClick={() => confirmMileageAndAssign(true)}
            >
              {working === "assign" ? (
                <>
                  <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" />
                  Assigning…
                </>
              ) : (
                "Confirm extras & assign"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Side sheet with admin actions ───────────────────────────────────

function BookingSheet({
  booking,
  onClose,
  onMutated,
}: {
  booking: BookingRow | null;
  onClose: () => void;
  onMutated: () => void;
}) {
  const [working, setWorking] = useState<string | null>(null);
  const [suppressReview, setSuppressReview] = useState(false);
  const [suppressSaving, setSuppressSaving] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [delayOpen, setDelayOpen] = useState(false);
  const [addonOpen, setAddonOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  // Adjust-service state (prefilled from the booking when the sheet opens).
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [svcType, setSvcType] = useState<string>("standard");
  const [svcHomeSize, setSvcHomeSize] = useState<string>("");
  const [svcAddOns, setSvcAddOns] = useState<string[]>([]);
  // Editable per-add-on price (dollars, as strings for the inputs). Seeded
  // from the catalog default but the admin can override any line.
  const [addOnPrices, setAddOnPrices] = useState<Record<string, string>>({});
  // Optional manual override of the whole new total (dollars). Blank = auto.
  const [totalOverride, setTotalOverride] = useState<string>("");
  // Customer personal info (name / email / phone / address) — records
  // correction on THIS booking. Mirrors to the linked customer + job rows.
  const [customerOpen, setCustomerOpen] = useState(false);
  const [custFirstName, setCustFirstName] = useState("");
  const [custLastName, setCustLastName] = useState("");
  const [custEmail, setCustEmail] = useState("");
  const [custPhone, setCustPhone] = useState("");
  const [custAddress, setCustAddress] = useState("");
  const [custCity, setCustCity] = useState("");
  const [custState, setCustState] = useState("");
  const [custZip, setCustZip] = useState("");
  // Credit state (grants and removals both target the booking email's wallet).
  const [creditMode, setCreditMode] = useState<"grant" | "remove">("grant");
  const [creditAmount, setCreditAmount] = useState("");
  const [creditSource, setCreditSource] = useState("admin_grant");
  const [creditReason, setCreditReason] = useState("");
  const [creditNotify, setCreditNotify] = useState(true);
  const [walletCents, setWalletCents] = useState<number | null>(null);
  // Adjust-job-cost state (revenue + optional refund).
  const [jobCost, setJobCost] = useState("");
  const [jobCostRefund, setJobCostRefund] = useState("");
  const [jobCostReason, setJobCostReason] = useState("");
  const [unpaidAddonCharge, setUnpaidAddonCharge] = useState<{
    id: string;
    added_addons: string[];
  } | null>(null);
  // Scope adjustment: prior adjustments on this job, plus any unresolved
  // scope flag the crew raised from the field.
  const [scopeOpen, setScopeOpen] = useState(false);
  const [scopeHistory, setScopeHistory] = useState<ScopeAdjustmentRow[]>([]);
  const [scopeFlags, setScopeFlags] = useState<Array<{ id: string; issue_number: number | null; title: string | null; description: string | null }>>([]);

  useEffect(() => {
    if (!booking) return;
    setAdjustOpen(false);
    setCustomerOpen(false);
    setCustFirstName(booking.first_name || "");
    setCustLastName(booking.last_name || "");
    setCustEmail(booking.email || "");
    setCustPhone(booking.phone || "");
    setCustAddress(booking.address || "");
    setCustCity(booking.city || "");
    setCustState(booking.state || "");
    setCustZip(booking.zip_code || "");
    setSuppressReview(Boolean(booking.suppress_review_request));
    setCreditMode("grant");
    setCreditAmount("");
    setCreditSource("admin_grant");
    setCreditReason("");
    setCreditNotify(true);
    setWalletCents(null);
    void loadWalletBalance(booking.email);
    setJobCost(
      booking.final_charge_cents != null
        ? (booking.final_charge_cents / 100).toFixed(2)
        : booking.total_estimate_cents != null
          ? (booking.total_estimate_cents / 100).toFixed(2)
          : "",
    );
    setJobCostRefund("");
    setJobCostReason("");
    setSvcType(booking.service_type || "standard");
    setSvcHomeSize(booking.home_size_id || "");
    setSvcAddOns([]);
    setAddOnPrices({});
    setTotalOverride("");
    // add_ons + suppress_review_request — refresh from the row so the sheet
    // stays correct even if the list payload is stale / missing a column.
    void (async () => {
      const { data } = await (supabase.from as any)("bookings")
        .select("add_ons, suppress_review_request")
        .eq("id", booking.id)
        .maybeSingle();
      const current = Array.isArray(data?.add_ons) ? (data.add_ons as string[]) : [];
      setSvcAddOns(current);
      if (data && typeof data.suppress_review_request === "boolean") {
        setSuppressReview(data.suppress_review_request);
      }
      const seeded: Record<string, string> = {};
      for (const id of current) {
        const def = (ADD_ONS as Record<string, { price: number }>)[id]?.price;
        if (def != null) seeded[id] = String(def);
      }
      setAddOnPrices(seeded);
    })();
    void (async () => {
      const { data } = await (supabase.from as any)("booking_addon_charges")
        .select("id, added_addons, amount_cents, status")
        .eq("booking_id", booking.id)
        .eq("status", "no_charge")
        .eq("amount_cents", 0)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data?.id && Array.isArray(data.added_addons) && data.added_addons.length) {
        setUnpaidAddonCharge({ id: data.id, added_addons: data.added_addons as string[] });
      } else {
        setUnpaidAddonCharge(null);
      }
    })();
    void loadScopeState(booking.id);
  }, [booking?.id]);

  const loadWalletBalance = async (email: string | null) => {
    if (!email) {
      setWalletCents(0);
      return;
    }
    const { data } = await (supabase.rpc as any)("get_customer_credit_balance_by_email", { _email: email });
    setWalletCents(Number((data as { balance_cents?: number })?.balance_cents || 0));
  };

  const loadScopeState = async (id: string) => {
    const [{ data: adjustments }, { data: flags }] = await Promise.all([
      (supabase.from as any)("scope_adjustments")
        .select("*")
        .eq("booking_id", id)
        .order("applied_at", { ascending: false }),
      (supabase.from as any)("qc_issues")
        .select("id, issue_number, title, description")
        .eq("booking_id", id)
        .eq("reported_via", "cleaner_field")
        .neq("status", "resolved")
        .order("created_at", { ascending: false }),
    ]);
    setScopeHistory((adjustments || []) as ScopeAdjustmentRow[]);
    setScopeFlags((flags || []) as Array<{ id: string; issue_number: number | null; title: string | null; description: string | null }>);
  };

  if (!booking) return null;

  const currentAddOns = (booking.add_ons || []) as string[];

  const retryUnpaidAddonCharge = async () => {
    if (!unpaidAddonCharge) return;
    setWorking("addon-retry");
    try {
      const priced: Record<string, number> = {};
      for (const id of unpaidAddonCharge.added_addons) {
        const def = (ADD_ONS as Record<string, { price: number }>)[id]?.price;
        if (def != null) priced[id] = def;
      }
      const { data, error } = await supabase.functions.invoke("admin-add-booking-addons", {
        body: {
          bookingId: booking.id,
          addOns: currentAddOns,
          charge: true,
          addOnPrices: priced,
          retryChargeAuditId: unpaidAddonCharge.id,
        },
      });
      if (error) throw error;
      const d = data as { error?: string; status?: string; deltaCents?: number };
      if (d?.error) throw new Error(d.error);
      if (d?.status === "paid") toast.success(`Charged ${fmtMoney(d.deltaCents)} for unpaid add-ons.`);
      else if (d?.status === "charge_failed") toast.warning("No usable card on file — amount stays on the booking balance and will be collected with the remaining balance.");
      else toast.success("Add-on charge retried.");
      onMutated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not retry add-on charge");
    } finally {
      setWorking(null);
    }
  };

  // A disputed adjustment becomes a normal QC case, with the reasons, prices
  // and evidence already attached, so it runs the existing open →
  // investigating → resolved path.
  const openDispute = async (adjustmentId: string) => {
    const note = window.prompt("What did the customer say? (added to the QC case)") ?? "";
    setWorking(`dispute-${adjustmentId}`);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not signed in");
      const res = await fetch("/api/admin/scope-adjustment/dispute", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ adjustmentId, note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not open the QC case");
      toast.success("QC case opened with the adjustment evidence attached.");
      await loadScopeState(booking!.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open the QC case");
    } finally {
      setWorking(null);
    }
  };

  const requestPhotos = async (phase: "before" | "after" | "both" = "both") => {
    if (!booking.cleaner_id) {
      toast.error("Assign a cleaner first.");
      return;
    }
    setWorking(`photos-${phase}`);
    try {
      const { data, error } = await supabase.functions.invoke("admin-cleaner-sms", {
        body: { cleanerId: booking.cleaner_id, template: "photo_request", bookingId: booking.id, phase },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(
        phase === "before"
          ? "Before-photos link texted to the cleaner."
          : phase === "after"
            ? "After-photos link texted to the cleaner."
            : "Combined before & after photo link texted to the cleaner.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(null);
    }
  };

  const totalCents = booking.total_estimate_cents ?? 0;
  const depositCents = booking.deposit_cents ?? 0;
  const paidCents = booking.final_charge_cents || depositCents;
  const remainingCents = Math.max(0, totalCents - depositCents);

  const adminCancelWithRefund = async (refundType: "auto" | "full" | "none") => {
    if (!cancelReason.trim()) {
      toast.error("Add a cancel reason first.");
      return;
    }
    setWorking("cancel");
    try {
      // Always go through cancel-booking. It applies the 24-hr fee rule for
      // "auto", forces a full deposit refund for "full", and skips Stripe for
      // "none". Refund failures are best-effort — the booking still cancels
      // (unlike admin-refund-booking, which 500s and leaves the row open).
      const { data, error } = await supabase.functions.invoke("cancel-booking", {
        body: {
          bookingId: booking.id,
          cancelReason,
          source: "admin",
          refundType,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Booking cancelled (${refundType === "none" ? "no refund" : refundType + " refund"})`);
      onMutated();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(null);
    }
  };

  const toggleAddOn = (id: string) =>
    setSvcAddOns((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      // Seed the editable price with the catalog default when first added.
      setAddOnPrices((p) =>
        p[id] != null
          ? p
          : { ...p, [id]: String((ADD_ONS as Record<string, { price: number }>)[id]?.price ?? 0) },
      );
      return [...prev, id];
    });

  const setAddOnPrice = (id: string, value: string) =>
    setAddOnPrices((p) => ({ ...p, [id]: value }));

  // Move-In/Out includes fridge + oven free; everything else is chargeable.
  const isFreeAddOn = (id: string) => svcType === "moveInOut" && (id === "fridge" || id === "oven");

  // Service-only price (no add-ons), then add the (possibly overridden)
  // per-add-on prices. Falls back to the catalog price when a field is blank.
  const serviceOnlyCents = Math.round(
    (calculatePrice(svcHomeSize, svcType, [], "none", booking.uses_credit ?? false, "B").total || 0) * 100,
  );
  const addOnsTotalCents = svcAddOns.reduce((sum, id) => {
    if (isFreeAddOn(id)) return sum;
    const raw = addOnPrices[id];
    const dollars = raw != null && raw !== "" ? Number(raw) : (ADD_ONS as Record<string, { price: number }>)[id]?.price ?? 0;
    return sum + (Number.isFinite(dollars) ? Math.round(dollars * 100) : 0);
  }, 0);
  const computedQuoteCents = Math.max(0, serviceOnlyCents + addOnsTotalCents);
  const overrideCents = totalOverride !== "" && Number.isFinite(Number(totalOverride))
    ? Math.round(Number(totalOverride) * 100)
    : null;
  const newQuoteCents = overrideCents != null ? overrideCents : computedQuoteCents;

  const adjustService = async () => {
    if (!svcHomeSize || !svcType) {
      toast.error("Pick a service type and home size.");
      return;
    }
    setWorking("adjust");
    try {
      // Build the priced add-on map (dollars) we pass to the backend so the
      // customer comms + ops notes show exactly what was charged per add-on.
      const pricedAddOns: Record<string, number> = {};
      for (const id of svcAddOns) {
        if (isFreeAddOn(id)) {
          pricedAddOns[id] = 0;
          continue;
        }
        const raw = addOnPrices[id];
        const dollars = raw != null && raw !== "" ? Number(raw) : (ADD_ONS as Record<string, { price: number }>)[id]?.price ?? 0;
        if (Number.isFinite(dollars)) pricedAddOns[id] = dollars;
      }
      const { data, error } = await supabase.functions.invoke("admin-modify-booking", {
        body: {
          action: "update_service",
          bookingId: booking.id,
          serviceType: svcType,
          homeSizeId: svcHomeSize,
          addOns: svcAddOns,
          addOnPrices: pricedAddOns,
          totalEstimateCents: newQuoteCents,
        },
      });
      const outcome = await edgeResult(error, data);
      if (!outcome.ok) throw new Error(outcome.error || "Update failed");
      toast.success("Service updated — customer notified via SMS & email.");
      onMutated();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(null);
    }
  };

  const saveCustomerInfo = async () => {
    if (!booking) return;
    const first = custFirstName.trim();
    const email = custEmail.trim().toLowerCase();
    if (!first) {
      toast.error("First name is required.");
      return;
    }
    if (!email || !email.includes("@")) {
      toast.error("A valid email is required.");
      return;
    }
    setWorking("customer");
    try {
      const { data, error } = await supabase.functions.invoke("admin-modify-booking", {
        body: {
          action: "update_customer_info",
          bookingId: booking.id,
          firstName: first,
          lastName: custLastName.trim(),
          email,
          phone: custPhone.trim(),
          address: custAddress.trim(),
          city: custCity.trim(),
          state: custState.trim(),
          zipCode: custZip.trim(),
        },
      });
      // invoke() collapses every non-2xx into the generic "Edge Function
      // returned a non-2xx status code" — pull the real reason out.
      const outcome = await edgeResult(error, data);
      if (!outcome.ok) throw new Error(outcome.error || "Update failed");
      toast.success("Customer info updated on this booking.");
      setCustomerOpen(false);
      onMutated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(null);
    }
  };

  const deleteBooking = async () => {
    if (
      !confirm(
        "Permanently DELETE this booking? The customer will NOT be notified. This cannot be undone.",
      )
    )
      return;
    setWorking("delete");
    try {
      const { data, error } = await supabase.functions.invoke("admin-delete-booking", {
        body: { bookingId: booking.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Booking deleted (customer not notified).");
      onMutated();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(null);
    }
  };

  const adjustJobCost = async () => {
    const newCents = Math.round(parseFloat(jobCost) * 100);
    if (!Number.isFinite(newCents) || newCents < 0) {
      toast.error("Enter a valid job cost");
      return;
    }
    const refundCents = jobCostRefund ? Math.round(parseFloat(jobCostRefund) * 100) : 0;
    if (jobCostRefund && (!Number.isFinite(refundCents) || refundCents < 0)) {
      toast.error("Enter a valid refund amount");
      return;
    }
    setWorking("jobcost");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not signed in");
      const res = await fetch("/api/admin/adjust-job-cost", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          bookingId: booking.id,
          newJobCostCents: newCents,
          refundCents: refundCents || undefined,
          reason: jobCostReason || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || json?.error) throw new Error(json?.error || "Adjust failed");
      const refundNote = json.refund
        ? json.refund.ok
          ? ` · refunded $${(refundCents / 100).toFixed(2)}`
          : ` · refund failed: ${json.refund.error}`
        : "";
      toast.success(`Job cost set to $${(newCents / 100).toFixed(2)} (GHL + Airtable synced)${refundNote}`);
      setJobCostRefund("");
      onMutated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(null);
    }
  };

  const applyCreditChange = async () => {
    const removing = creditMode === "remove";
    const cents = Math.round(parseFloat(creditAmount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      toast.error("Enter a positive dollar amount");
      return;
    }
    if (!booking.email) {
      toast.error("This booking has no customer email to credit.");
      return;
    }
    if (removing && !creditReason.trim()) {
      toast.error("Add a reason so the ledger says why the credit came off");
      return;
    }
    if (removing && walletCents != null && cents > walletCents) {
      toast.error(`Only $${(walletCents / 100).toFixed(2)} available to remove`);
      return;
    }
    setWorking("credit");
    try {
      const { data, error } = await supabase.functions.invoke("admin-grant-credit", {
        body: removing
          ? {
              action: "revoke",
              email: booking.email,
              amountCents: cents,
              reason: creditReason.trim(),
            }
          : {
              action: "grant",
              email: booking.email,
              firstName: booking.first_name || undefined,
              lastName: booking.last_name || undefined,
              phone: booking.phone || undefined,
              amountCents: cents,
              source: creditSource,
              reason: creditReason || `Credit applied from booking #${booking.booking_number || booking.id.slice(0, 6)}`,
              notify: creditNotify,
            },
      });
      const outcome = await edgeResult(error, data);
      if (!outcome.ok) throw new Error(outcome.error);
      if (removing) {
        const removed = Number((data as { removedCents?: number })?.removedCents || 0);
        toast.success(`Removed $${(removed / 100).toFixed(2)} from ${booking.email} · customer not notified`);
      } else {
        const notified = [(data as { emailSent?: boolean })?.emailSent && "email", (data as { smsSent?: boolean })?.smsSent && "SMS"].filter(Boolean).join(" + ");
        toast.success(`Credited $${(cents / 100).toFixed(2)} to ${booking.email}${notified ? ` · ${notified} sent` : " · no notification sent"}`);
      }
      setCreditAmount("");
      setCreditReason("");
      await loadWalletBalance(booking.email);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(null);
    }
  };

  const markCompleted = async () => {
    if (!confirm("Finalize this booking? This triggers the final charge + cleaner payout + customer comms.")) return;
    setWorking("complete");
    try {
      const { data, error } = await supabase.functions.invoke("complete-booking", {
        body: { bookingId: booking.id, source: "admin" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Booking marked complete");
      onMutated();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(null);
    }
  };

  return (
    <>
      <Sheet open={Boolean(booking)} onOpenChange={(o) => !o && onClose()}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="font-jakarta tracking-tight">
              Booking #{booking.booking_number || booking.id.slice(0, 6)}
            </SheetTitle>
            <SheetDescription>
              {booking.first_name || ""} {booking.last_name || ""} · {booking.email || ""}
              {booking.phone ? ` · ${booking.phone}` : ""}
            </SheetDescription>
          </SheetHeader>

          <div className="mt-5 space-y-5">
            {/* Summary */}
            <Card className="border-slate-200">
              <CardContent className="py-4 grid grid-cols-2 gap-y-2 text-sm">
                <span className="text-slate-500">Service</span>
                <span className="text-right capitalize">
                  {booking.service_type?.replaceAll("_", " ") || "—"}
                </span>
                <span className="text-slate-500">Date</span>
                <span className="text-right tabular-nums">
                  {booking.service_date || "—"} {booking.time_slot || ""}
                </span>
                <span className="text-slate-500">Phone</span>
                <span className="text-right tabular-nums">{booking.phone || "—"}</span>
                <span className="text-slate-500">Address</span>
                <span className="text-right truncate">
                  {booking.address || "—"}
                  {booking.city && `, ${booking.city}`}
                  {booking.state ? ` ${booking.state}` : ""}
                  {booking.zip_code ? ` ${booking.zip_code}` : ""}
                </span>

                {/* What the crew is walking into. Sits with service and address
                    because size and contents decide staffing and duration as
                    much as the service tier does. */}
                <span className="text-slate-500">Home size</span>
                <span className="text-right">{homeSizeLabel(booking) || "—"}</span>
                <span className="text-slate-500">Beds / baths</span>
                <span className="text-right tabular-nums">{bedBathLabel(booking) || "—"}</span>
                {booking.dwelling_type ? (
                  <>
                    <span className="text-slate-500">Property type</span>
                    <span className="text-right">{titleCase(booking.dwelling_type)}</span>
                  </>
                ) : null}
                {booking.flooring_type ? (
                  <>
                    <span className="text-slate-500">Flooring</span>
                    <span className="text-right">{titleCase(booking.flooring_type)}</span>
                  </>
                ) : null}
                {booking.pets ? (
                  <>
                    <span className="text-slate-500">Pets</span>
                    <span className="text-right">
                      {PETS_LABELS[booking.pets] || titleCase(booking.pets)}
                    </span>
                  </>
                ) : null}
                {booking.frequency ? (
                  <>
                    <span className="text-slate-500">Frequency</span>
                    <span className="text-right">{titleCase(booking.frequency)}</span>
                  </>
                ) : null}
                {booking.access_notes ? (
                  <>
                    <span className="text-slate-500">Access</span>
                    {/* Gate codes and parking, so wrap rather than truncate —
                        a half-shown door code is useless. */}
                    <span className="text-right whitespace-pre-wrap break-words">
                      {booking.access_notes}
                    </span>
                  </>
                ) : null}

                <Separator className="col-span-2 my-1" />
                <span className="text-slate-500">Total</span>
                <span className="text-right tabular-nums font-semibold">
                  {fmtMoney(totalCents)}
                </span>
                <span className="text-slate-500">Deposit paid</span>
                <span className="text-right tabular-nums">{fmtMoney(depositCents)}</span>
                <span className="text-slate-500">Remaining</span>
                <span className="text-right tabular-nums">{fmtMoney(remainingCents)}</span>
                <span className="text-slate-500">Status</span>
                <span className="text-right capitalize">
                  {STATUS_LABELS[booking.status || ""] ?? (booking.status || "—").replaceAll("_", " ")}
                </span>
                <span className="text-slate-500">Add-ons</span>
                <span className="text-right">
                  {currentAddOns.length
                    ? currentAddOns.map((a) => ADD_ONS[a as AddOnId]?.label || a).join(", ")
                    : "—"}
                </span>
              </CardContent>
            </Card>

            {/* Edit customer personal info on this booking */}
            <Card className="border-slate-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <RiUserSmileLine className="w-4 h-4 text-violet-700" />
                  Customer info
                </CardTitle>
                <CardDescription>
                  Update name, email, phone, or address on this booking. Also updates the linked customer directory and job address when present.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {!customerOpen ? (
                  <Button variant="outline" className="w-full" onClick={() => setCustomerOpen(true)}>
                    Edit customer info <RiArrowRightLine className="w-4 h-4 ml-2" />
                  </Button>
                ) : (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs">First name</Label>
                        <Input
                          value={custFirstName}
                          onChange={(e) => setCustFirstName(e.target.value)}
                          autoComplete="off"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Last name</Label>
                        <Input
                          value={custLastName}
                          onChange={(e) => setCustLastName(e.target.value)}
                          autoComplete="off"
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Email</Label>
                      <Input
                        type="email"
                        value={custEmail}
                        onChange={(e) => setCustEmail(e.target.value)}
                        autoComplete="off"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Phone</Label>
                      <Input
                        value={custPhone}
                        onChange={(e) => setCustPhone(e.target.value)}
                        placeholder="4105551234"
                        autoComplete="off"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Address</Label>
                      <Input
                        value={custAddress}
                        onChange={(e) => setCustAddress(e.target.value)}
                        autoComplete="off"
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div className="sm:col-span-1">
                        <Label className="text-xs">City</Label>
                        <Input
                          value={custCity}
                          onChange={(e) => setCustCity(e.target.value)}
                          autoComplete="off"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">State</Label>
                        <Input
                          value={custState}
                          onChange={(e) => setCustState(e.target.value)}
                          autoComplete="off"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">ZIP</Label>
                        <Input
                          value={custZip}
                          onChange={(e) => setCustZip(e.target.value)}
                          autoComplete="off"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={() => {
                          setCustomerOpen(false);
                          setCustFirstName(booking.first_name || "");
                          setCustLastName(booking.last_name || "");
                          setCustEmail(booking.email || "");
                          setCustPhone(booking.phone || "");
                          setCustAddress(booking.address || "");
                          setCustCity(booking.city || "");
                          setCustState(booking.state || "");
                          setCustZip(booking.zip_code || "");
                        }}
                        disabled={working === "customer"}
                      >
                        Cancel
                      </Button>
                      <Button
                        className="flex-1 bg-violet-600 hover:bg-violet-700 text-white"
                        onClick={saveCustomerInfo}
                        disabled={working === "customer"}
                      >
                        {working === "customer" ? (
                          <><RiLoader4Line className="w-4 h-4 mr-2 animate-spin" /> Saving…</>
                        ) : (
                          <><RiCheckLine className="w-4 h-4 mr-2" /> Save customer info</>
                        )}
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* The scope of work, and how much of it is done */}
            <BookingChecklist booking={booking} />

            {/* Final balance link — issued after the clean, when the number is
                actually known */}
            <BalanceLinkCard booking={booking} />

            {/* Per-booking review / feedback request opt-out */}
            <Card className="border-slate-200">
              <CardContent className="py-4 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">Don&apos;t send review request</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Skips the post-job feedback SMS/email and any follow-up nudges for this booking only.
                  </p>
                </div>
                <Switch
                  checked={suppressReview}
                  disabled={suppressSaving || !booking}
                  onCheckedChange={(checked) => {
                    if (!booking) return;
                    const prev = suppressReview;
                    setSuppressReview(checked);
                    setSuppressSaving(true);
                    void (async () => {
                      try {
                        const { error } = await (supabase.from as any)("bookings")
                          .update({ suppress_review_request: checked })
                          .eq("id", booking.id);
                        if (error) throw error;
                        toast.success(
                          checked
                            ? "Review request disabled for this booking"
                            : "Review request re-enabled for this booking",
                        );
                        onMutated();
                      } catch (e) {
                        setSuppressReview(prev);
                        toast.error(e instanceof Error ? e.message : "Could not update review setting");
                      } finally {
                        setSuppressSaving(false);
                      }
                    })();
                  }}
                />
              </CardContent>
            </Card>

            {/* Scope adjustment — justified, documented price increases */}
            {isScopeAdjustable(booking.status) && (
              <Card className="border-slate-200">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-1.5">
                    <RiPriceTag3Line className="w-4 h-4 text-violet-700" />
                    Scope adjustment
                  </CardTitle>
                  <CardDescription>
                    For a job that turned out materially different from what was booked. Requires a defined reason
                    and the job&apos;s condition photos, prices off the pricing engine, sends the customer a written
                    justification, and pays the crew off the adjusted value.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Mid-job cue: the crew flagged something while they're still on site */}
                  {scopeFlags.length > 0 && isJobStillActive(booking.status) && (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
                      <p className="text-sm font-medium text-amber-900">
                        The crew flagged this job — consider a scope adjustment now
                      </p>
                      <p className="text-xs text-amber-800 mt-1">
                        {scopeFlags[0].title || scopeFlags[0].description || "Field report open on this job."}
                      </p>
                      <p className="text-xs text-amber-800 mt-1">
                        The job is still active, so the customer can be told in the moment rather than finding it on
                        a closed invoice.
                      </p>
                    </div>
                  )}

                  <Button
                    variant="outline"
                    className="w-full border-violet-200 text-violet-800 hover:bg-violet-50"
                    onClick={() => setScopeOpen(true)}
                  >
                    Apply scope adjustment <RiArrowRightLine className="w-4 h-4 ml-2" />
                  </Button>

                  {scopeHistory.map((adj) => (
                    <div key={adj.id} className="rounded-lg border border-slate-200 p-3 text-xs space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-slate-900 tabular-nums">
                          {fmtMoney(adj.original_price_cents)} → {fmtMoney(adj.adjusted_price_cents)}
                        </span>
                        <span className="text-slate-500">
                          {format(new Date(adj.applied_at), "MMM d, yyyy")}
                        </span>
                      </div>
                      <p className="text-slate-600">{adj.reason_codes.join(", ").replaceAll("_", " ")}</p>
                      <div className="flex flex-wrap gap-1">
                        {adj.evidence_missing ? (
                          <Badge variant="outline" className="border-amber-300 text-amber-800 text-[10px]">
                            Unsupported — no photo evidence
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-emerald-300 text-emerald-800 text-[10px]">
                            {adj.evidence_photo_count} photo{adj.evidence_photo_count === 1 ? "" : "s"} on file
                          </Badge>
                        )}
                        {adj.amount_overridden && (
                          <Badge variant="outline" className="border-slate-300 text-slate-700 text-[10px]">
                            Amount overridden
                          </Badge>
                        )}
                        {(adj.message_channels || []).map((c) => (
                          <Badge key={c} variant="outline" className="border-violet-200 text-violet-800 text-[10px]">
                            Sent by {c}
                          </Badge>
                        ))}
                        {adj.status === "disputed" && (
                          <Badge variant="outline" className="border-rose-300 text-rose-800 text-[10px]">
                            Disputed — QC case open
                          </Badge>
                        )}
                      </div>
                      {(adj.payout_supplement_cents || 0) > 0 && (
                        <p className="text-amber-800">
                          Supplemental pay owed: {fmtMoney(adj.payout_supplement_cents)} per cleaner
                        </p>
                      )}
                      {adj.status !== "disputed" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs text-rose-700 hover:bg-rose-50 px-2"
                          onClick={() => openDispute(adj.id)}
                          disabled={working === `dispute-${adj.id}`}
                        >
                          {working === `dispute-${adj.id}` ? (
                            <RiLoader4Line className="w-3 h-3 mr-1 animate-spin" />
                          ) : null}
                          Customer disputed this
                        </Button>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Add-on services — works even after completion */}
            {booking.status !== "cancelled" && (
              <Card className="border-slate-200">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-1.5">
                    <RiMoneyDollarCircleLine className="w-4 h-4 text-violet-700" />
                    Add-on services
                  </CardTitle>
                  <CardDescription>
                    Add services and charge the customer{booking.status === "completed" ? " — even after this job is completed" : ""}. Charges the card on file (or emails a secure invoice), updates the total, and emails the customer.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button variant="outline" className="w-full" onClick={() => setAddonOpen(true)}>
                    Add / edit add-on services <RiArrowRightLine className="w-4 h-4 ml-2" />
                  </Button>
                  {unpaidAddonCharge && (
                    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                      <p className="text-amber-900 font-medium">Add-ons saved but not charged</p>
                      <p className="text-amber-800 text-xs mt-1">
                        {unpaidAddonCharge.added_addons.map((id) => ADD_ONS[id as AddOnId]?.label || id).join(", ")} were added with a $0 charge (server catalog was out of date).
                      </p>
                      <Button
                        size="sm"
                        className="mt-2 w-full bg-violet-600 hover:bg-violet-700 text-white"
                        onClick={retryUnpaidAddonCharge}
                        disabled={working === "addon-retry"}
                      >
                        {working === "addon-retry" ? <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" /> : null}
                        Retry charge (
                        {fmtMoney(
                          unpaidAddonCharge.added_addons.reduce(
                            (s, id) => s + Math.round(((ADD_ONS as Record<string, { price: number }>)[id]?.price || 0) * 100),
                            0,
                          ),
                        )}
                        )
                      </Button>
                    </div>
                  )}
                  {booking.hosted_invoice_url && (
                    <a href={booking.hosted_invoice_url} target="_blank" rel="noreferrer" className="block mt-2 text-xs text-violet-700 underline">
                      View latest hosted invoice
                    </a>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Before/after photos: request from the cleaner OR upload here */}
            <Card className="border-slate-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <RiInformationLine className="w-4 h-4 text-violet-700" />
                  Before &amp; after photos &amp; videos
                </CardTitle>
                <CardDescription>
                  Text the assigned cleaner a secure upload link, or upload the before/after photos and videos yourself.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <LivePhotoGallery bookingId={booking.id} />
                {booking.cleaner_id && (
                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Text the cleaner a photo link
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <Button variant="outline" size="sm" onClick={() => requestPhotos("before")} disabled={working?.startsWith("photos-")}>
                        {working === "photos-before" ? <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" /> : null}
                        Before link
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => requestPhotos("after")} disabled={working?.startsWith("photos-")}>
                        {working === "photos-after" ? <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" /> : null}
                        After link
                      </Button>
                    </div>
                    <Button variant="outline" size="sm" className="w-full" onClick={() => requestPhotos("both")} disabled={working?.startsWith("photos-")}>
                      {working === "photos-both" ? <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" /> : null}
                      Combined link (before &amp; after on one page)
                    </Button>
                  </div>
                )}
                <AdminPhotoSubmit booking={booking} onSubmitted={onMutated} />
              </CardContent>
            </Card>

            <BookingAssignBlock
              booking={booking}
              working={working}
              setWorking={setWorking}
              onMutated={onMutated}
            />

            {/* Reschedule */}
            <Card className="border-slate-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <RiCalendarEventLine className="w-4 h-4 text-violet-700" />
                  Reschedule
                </CardTitle>
                <CardDescription>
                  Reschedule to any date — including weekends and short notice. Customer gets SMS + email; GHL pipelines update automatically.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setRescheduleOpen(true)}
                  disabled={booking.status === "cancelled" || booking.status === "completed"}
                >
                  Reschedule booking <RiArrowRightLine className="w-4 h-4 ml-2" />
                </Button>
              </CardContent>
            </Card>

            {/* Delay arrival window (same-day 1h/2h/3h push + optional discount/credit) */}
            <Card className="border-slate-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <RiTimeLine className="w-4 h-4 text-amber-700" />
                  Delay arrival window
                </CardTitle>
                <CardDescription>
                  Push today&apos;s arrival back by 1h, 2h, or 3h with a reason.
                  Optionally discount this cleaning or issue a wallet credit for
                  the trouble. Customer and cleaner are notified.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  className="w-full border-amber-200 text-amber-800 hover:bg-amber-50"
                  onClick={() => setDelayOpen(true)}
                  disabled={
                    booking.status === "cancelled" ||
                    booking.status === "completed" ||
                    !booking.time_slot
                  }
                >
                  Delay this booking <RiTimeLine className="w-4 h-4 ml-2" />
                </Button>
              </CardContent>
            </Card>

            {/* Adjust service */}
            {booking.status !== "cancelled" && booking.status !== "completed" && (
              <Card className="border-slate-200">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-1.5">
                    <RiEdit2Line className="w-4 h-4 text-violet-700" />
                    Adjust service
                  </CardTitle>
                  <CardDescription>
                    Change service type, home size, or add-ons. The customer is notified via SMS &amp; email and the new total syncs to GHL.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {!adjustOpen ? (
                    <Button variant="outline" className="w-full" onClick={() => setAdjustOpen(true)}>
                      Adjust service <RiArrowRightLine className="w-4 h-4 ml-2" />
                    </Button>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <Label className="text-xs">Service type</Label>
                          <Select value={svcType} onValueChange={setSvcType}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {Object.entries(SERVICE_TIER_PRICING).map(([id, v]) => (
                                <SelectItem key={id} value={id}>{v.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs">Home size</Label>
                          <Select value={svcHomeSize} onValueChange={setSvcHomeSize}>
                            <SelectTrigger><SelectValue placeholder="Select size" /></SelectTrigger>
                            <SelectContent>
                              {HOME_SIZE_RANGES.map((h) => (
                                <SelectItem key={h.id} value={h.id}>{h.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs">Add-ons</Label>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {Object.entries(ADD_ONS).map(([id, v]) => {
                            const on = svcAddOns.includes(id);
                            return (
                              <button
                                key={id}
                                type="button"
                                onClick={() => toggleAddOn(id)}
                                className={cn(
                                  "text-xs px-2 py-1 rounded-full border transition-colors",
                                  on
                                    ? "bg-violet-600 text-white border-violet-600"
                                    : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50",
                                )}
                              >
                                {v.label} (${v.price})
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Editable price per selected add-on */}
                      {svcAddOns.length > 0 && (
                        <div className="space-y-1.5 rounded-lg border border-slate-200 p-2">
                          <Label className="text-xs text-slate-500">Add-on pricing (editable)</Label>
                          {svcAddOns.map((id) => {
                            const label = (ADD_ONS as Record<string, { label: string }>)[id]?.label || id;
                            const free = isFreeAddOn(id);
                            return (
                              <div key={id} className="flex items-center justify-between gap-2 text-sm">
                                <span className="text-slate-700">{label}</span>
                                {free ? (
                                  <span className="text-xs text-emerald-600 font-medium">Included free</span>
                                ) : (
                                  <div className="flex items-center gap-1">
                                    <span className="text-slate-400 text-sm">$</span>
                                    <Input
                                      type="number"
                                      min="0"
                                      step="1"
                                      value={addOnPrices[id] ?? ""}
                                      onChange={(e) => setAddOnPrice(id, e.target.value)}
                                      className="h-8 w-20 text-right tabular-nums"
                                    />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                        <span className="text-slate-500">New total</span>
                        <span className="font-semibold tabular-nums">
                          {fmtMoney(newQuoteCents)}
                          <span className="text-slate-400 font-normal"> (was {fmtMoney(totalCents)})</span>
                        </span>
                      </div>

                      <div>
                        <Label className="text-xs text-slate-500">
                          Override total (optional) — leave blank to use the computed price
                        </Label>
                        <div className="flex items-center gap-1 mt-1">
                          <span className="text-slate-400 text-sm">$</span>
                          <Input
                            type="number"
                            min="0"
                            step="1"
                            placeholder={(computedQuoteCents / 100).toFixed(2)}
                            value={totalOverride}
                            onChange={(e) => setTotalOverride(e.target.value)}
                            className="h-8 w-32 text-right tabular-nums"
                          />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" className="flex-1" onClick={() => setAdjustOpen(false)} disabled={working === "adjust"}>
                          Cancel
                        </Button>
                        <Button
                          className="flex-1 bg-violet-600 hover:bg-violet-700 text-white"
                          onClick={adjustService}
                          disabled={working === "adjust"}
                        >
                          {working === "adjust" ? (
                            <><RiLoader4Line className="w-4 h-4 mr-2 animate-spin" /> Saving…</>
                          ) : (
                            "Save & notify customer"
                          )}
                        </Button>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Adjust job cost (revenue) + optional refund */}
            <Card className="border-slate-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <RiMoneyDollarCircleLine className="w-4 h-4 text-violet-700" />
                  Adjust job cost
                </CardTitle>
                <CardDescription>
                  Set the recorded job cost (revenue) — e.g. after a refund. Updates GHL, Airtable, and payroll profit. Optionally issue a partial Stripe refund.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">New job cost (USD)</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={jobCost}
                      onChange={(e) => setJobCost(e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Refund now (optional)</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={jobCostRefund}
                      onChange={(e) => setJobCostRefund(e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Reason</Label>
                  <Input
                    value={jobCostReason}
                    onChange={(e) => setJobCostReason(e.target.value)}
                    placeholder="e.g., Refunded $50 for missed bathroom"
                  />
                </div>
                <Button
                  onClick={adjustJobCost}
                  disabled={working === "jobcost" || !jobCost}
                  variant="outline"
                  className="w-full border-violet-200 text-violet-800 hover:bg-violet-50"
                >
                  {working === "jobcost" ? (
                    <><RiLoader4Line className="w-4 h-4 mr-2 animate-spin" /> Saving…</>
                  ) : (
                    <><RiMoneyDollarCircleLine className="w-4 h-4 mr-2" /> Save job cost{jobCostRefund ? " & refund" : ""}</>
                  )}
                </Button>
              </CardContent>
            </Card>

            {/* Grant or remove credit (to the booking's customer, by email) */}
            <Card className="border-slate-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <RiMoneyDollarCircleLine className="w-4 h-4 text-violet-700" />
                  Account credit
                </CardTitle>
                <CardDescription>
                  {creditMode === "remove" ? (
                    <>Takes credit back off {booking.email || "this customer"}&apos;s wallet. They are never emailed or texted about a removal.</>
                  ) : (
                    <>Adds wallet credit to {booking.email || "this customer"} (auto-applies at their next checkout).</>
                  )}
                  {walletCents != null ? (
                    <> Current balance <strong className="text-slate-900">${(walletCents / 100).toFixed(2)}</strong>.</>
                  ) : null}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant={creditMode === "grant" ? "default" : "outline"}
                    onClick={() => setCreditMode("grant")}
                    className={cn(
                      "h-8 text-xs",
                      creditMode === "grant" && "bg-violet-600 hover:bg-violet-700 text-white",
                    )}
                  >
                    Grant credit
                  </Button>
                  <Button
                    type="button"
                    variant={creditMode === "remove" ? "default" : "outline"}
                    onClick={() => setCreditMode("remove")}
                    className={cn(
                      "h-8 text-xs",
                      creditMode === "remove" && "bg-rose-600 hover:bg-rose-700 text-white",
                    )}
                  >
                    Remove credit
                  </Button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Amount (USD)</Label>
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      inputMode="decimal"
                      value={creditAmount}
                      onChange={(e) => setCreditAmount(e.target.value)}
                      placeholder="50"
                    />
                  </div>
                  {creditMode === "grant" ? (
                    <div>
                      <Label className="text-xs">Source</Label>
                      <Select value={creditSource} onValueChange={setCreditSource}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin_grant">Admin grant</SelectItem>
                          <SelectItem value="refund_credit">Refund as credit</SelectItem>
                          <SelectItem value="promo">Promo</SelectItem>
                          <SelectItem value="perk">Loyalty perk / goodwill</SelectItem>
                          <SelectItem value="adjustment">Service recovery / adjustment</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                </div>
                <div>
                  <Label className="text-xs">
                    {creditMode === "remove" ? "Reason (internal only)" : "Reason (visible to customer)"}
                  </Label>
                  <Input
                    value={creditReason}
                    onChange={(e) => setCreditReason(e.target.value)}
                    placeholder={
                      creditMode === "remove"
                        ? "e.g., Duplicate goodwill credit issued on 7/2"
                        : "e.g., Sorry about the late arrival"
                    }
                  />
                </div>
                {creditMode === "grant" ? (
                  <label className="flex items-center gap-2 text-xs text-slate-700">
                    <Switch checked={creditNotify} onCheckedChange={setCreditNotify} />
                    Email + text the customer about this credit
                  </label>
                ) : null}
                <Button
                  onClick={applyCreditChange}
                  disabled={working === "credit" || !creditAmount}
                  className={cn(
                    "w-full text-white",
                    creditMode === "remove"
                      ? "bg-rose-600 hover:bg-rose-700"
                      : "bg-violet-600 hover:bg-violet-700",
                  )}
                >
                  {working === "credit" ? (
                    <><RiLoader4Line className="w-4 h-4 mr-2 animate-spin" /> Applying…</>
                  ) : creditMode === "remove" ? (
                    <><RiSubtractLine className="w-4 h-4 mr-2" /> Remove ${creditAmount || "0"} credit</>
                  ) : (
                    <><RiMoneyDollarCircleLine className="w-4 h-4 mr-2" /> Apply ${creditAmount || "0"} credit</>
                  )}
                </Button>
              </CardContent>
            </Card>

            {/* Mark complete */}
            {booking.status !== "completed" && booking.status !== "cancelled" && (
              <Card className="border-slate-200">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-1.5">
                    <RiUserSmileLine className="w-4 h-4 text-violet-700" />
                    {booking.status === "pending_review" ? "Finalize completion" : "Mark complete"}
                  </CardTitle>
                  <CardDescription>
                    {booking.status === "pending_review"
                      ? "The cleaner marked this job done and uploaded (or was asked to upload) photos. Finalizing triggers the final charge + cleaner payout + customer comms."
                      : "Triggers final charge + cleaner payout. Use when the cleaner forgot to mark it."}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {booking.status === "pending_review" && (
                    <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      Cleaner marked this complete — awaiting your review. Check the
                      uploaded photos, then finalize to charge the balance and release
                      the payout — or send it back if something's missing.
                    </div>
                  )}
                  <Button
                    onClick={markCompleted}
                    disabled={working === "complete" || working === "send_back"}
                    className="w-full bg-violet-600 hover:bg-violet-700 text-white"
                  >
                    {working === "complete" ? (
                      <>
                        <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" />
                        Completing…
                      </>
                    ) : (
                      <>
                        <RiCheckLine className="w-4 h-4 mr-2" />
                        {booking.status === "pending_review" ? "Finalize & complete booking" : "Mark booking completed"}
                      </>
                    )}
                  </Button>
                  {booking.status === "pending_review" && (
                    <Button
                      variant="outline"
                      disabled={working === "complete" || working === "send_back"}
                      className="w-full mt-2 border-amber-300 text-amber-800 hover:bg-amber-50"
                      onClick={async () => {
                        const reason = window.prompt(
                          "What needs fixing? The cleaner gets this exact message and the job returns to their Active list.",
                        );
                        if (!reason || !reason.trim()) return;
                        setWorking("send_back");
                        try {
                          const { data, error } = await supabase.functions.invoke("admin-review-completion", {
                            body: { bookingId: booking.id, action: "send_back", reason: reason.trim() },
                          });
                          if (error) throw error;
                          if ((data as { ok?: boolean; error?: string })?.ok === false) {
                            throw new Error((data as { error?: string })?.error || "Failed");
                          }
                          toast.success("Sent back to the cleaner — they've been texted the reason.");
                          onMutated();
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Failed to send back");
                        } finally {
                          setWorking(null);
                        }
                      }}
                    >
                      <RiArrowGoBackLine className="w-4 h-4 mr-2" />
                      Send back to cleaner (needs another pass)
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Cancel + refund */}
            {booking.status !== "cancelled" && (
              <Card className="border-rose-200 bg-rose-50/30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-rose-900 flex items-center gap-1.5">
                    <RiCloseCircleLine className="w-4 h-4" />
                    Cancel booking
                  </CardTitle>
                  <CardDescription className="text-rose-800/80">
                    Pick a refund posture. Customer gets a confirmation email automatically.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <Label className="text-xs">Cancel reason (visible to customer)</Label>
                    <Textarea
                      rows={2}
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                      placeholder="e.g. Customer requested via phone"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <Button
                      variant="outline"
                      onClick={() => adminCancelWithRefund("full")}
                      disabled={Boolean(working)}
                      className="border-violet-200 text-violet-800 bg-violet-50 hover:bg-violet-100"
                    >
                      <RiMoneyDollarCircleLine className="w-4 h-4 mr-1.5" />
                      Full refund
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => adminCancelWithRefund("auto")}
                      disabled={Boolean(working)}
                      className="border-amber-200 text-amber-800 bg-amber-50 hover:bg-amber-100"
                    >
                      <RiInformationLine className="w-4 h-4 mr-1.5" />
                      Auto (24-hr fee rule)
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => adminCancelWithRefund("none")}
                      disabled={Boolean(working)}
                      className="border-slate-300 text-slate-700"
                    >
                      No refund
                    </Button>
                  </div>
                  {working === "cancel" && (
                    <p className="text-xs text-slate-500 inline-flex items-center gap-1.5">
                      <RiLoader4Line className="w-3 h-3 animate-spin" /> Cancelling…
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Delete booking — permanent, NO customer notification */}
            <Card className="border-rose-300 bg-rose-50/40">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-rose-900 flex items-center gap-1.5">
                  <RiDeleteBin6Line className="w-4 h-4" />
                  Delete booking
                </CardTitle>
                <CardDescription className="text-rose-800/80">
                  Permanently removes this booking. The customer is <strong>not</strong> notified and this cannot be undone. Use cancel + refund if the customer should be told.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  onClick={deleteBooking}
                  disabled={working === "delete"}
                  className="w-full border-rose-300 text-rose-700 hover:bg-rose-100"
                >
                  {working === "delete" ? (
                    <><RiLoader4Line className="w-4 h-4 mr-2 animate-spin" /> Deleting…</>
                  ) : (
                    <><RiDeleteBin6Line className="w-4 h-4 mr-2" /> Delete booking (no notice)</>
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>
        </SheetContent>
      </Sheet>

      {booking && (
        <DelayBookingDialog
          open={delayOpen}
          onOpenChange={setDelayOpen}
          booking={{
            id: booking.id,
            service_date: booking.service_date,
            time_slot: booking.time_slot,
            first_name: booking.first_name,
            last_name: booking.last_name,
            total_estimate_cents: booking.total_estimate_cents,
          }}
          onSuccess={() => {
            setDelayOpen(false);
            onMutated();
          }}
        />
      )}

      {booking && (
        <RescheduleDialog
          open={rescheduleOpen}
          onOpenChange={setRescheduleOpen}
          booking={{
            id: booking.id,
            service_date: booking.service_date || "",
            time_slot: booking.time_slot || "",
            service_type: booking.service_type || "",
            home_size_id: booking.home_size_id || "",
            service_duration: booking.service_duration ?? undefined,
            address: booking.address || "",
            city: booking.city || "",
            state: booking.state || "",
          }}
          source="admin"
          onSuccess={() => {
            setRescheduleOpen(false);
            onMutated();
            onClose();
          }}
        />
      )}

      {booking && (
        <AddonDialog
          open={addonOpen}
          onOpenChange={setAddonOpen}
          booking={booking}
          onSuccess={() => {
            setAddonOpen(false);
            onMutated();
          }}
        />
      )}

      {booking && (
        <ScopeAdjustmentDialog
          open={scopeOpen}
          onOpenChange={setScopeOpen}
          bookingId={booking.id}
          onApplied={() => {
            void loadScopeState(booking.id);
            onMutated();
          }}
        />
      )}
    </>
  );
}

// ─── Live photo gallery ────────────────────────────────────────────────────
// Shows the booking's CURRENT before/after photos, straight from the bookings
// row, the moment they exist. Auto-refreshes while the sheet is open so a
// cleaner uploading from the field appears here within seconds — no reload.
// ─── The cleaning checklist for this booking ─────────────────────────────────
//
// Checklist progress already existed on the Dispatch board and in QC, but not
// here — and Bookings is the screen you are on when a customer asks what is
// included, or whether the oven actually got done. Answering meant going to
// find the job somewhere else.
//
// Fetched when the section is opened rather than with the list: the item-level
// detail is only wanted for the one booking being looked at, and the summary
// already rides along on the list row.

interface ChecklistDetail {
  name: string;
  service_type: string;
  sections: { title: string; items: string[] }[];
  items: Record<string, { done?: boolean; at?: string; by?: string }>;
  total_items: number;
  completed_items: number;
  progress_pct: number;
  started_at: string | null;
  completed_at: string | null;
  last_activity_at: string | null;
  last_activity_by: string | null;
}

function BookingChecklist({ booking }: { booking: BookingRow }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<ChecklistDetail | null>(null);
  const [contractorUrl, setContractorUrl] = useState<string | null>(null);
  const [hasJob, setHasJob] = useState<boolean>(Boolean(booking.job_id));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-collapse and drop everything when the sheet moves to another booking, so
  // an open panel never shows the previous booking's checklist.
  useEffect(() => {
    setOpen(false);
    setDetail(null);
    setError(null);
    setContractorUrl(null);
    setHasJob(Boolean(booking.job_id));
  }, [booking.id, booking.job_id]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Two steps on purpose. The first finds the booking's job and guarantees a
      // checklist row exists; the second reads it through the same resolver the
      // contractors use, so admin and crew can never be looking at different
      // versions of the list.
      const access = await supabase.functions.invoke("admin-booking-checklist", {
        body: { bookingId: booking.id },
      });
      const accessOutcome = await edgeResult(access.error, access.data);
      if (!accessOutcome.ok) throw new Error(accessOutcome.error);
      const { hasJob: jobExists, token, contractorUrl: url } = access.data as {
        hasJob: boolean;
        token: string | null;
        contractorUrl: string | null;
      };
      setHasJob(jobExists);
      setContractorUrl(url);

      if (!jobExists || !token) {
        setDetail(null);
        return;
      }

      const read = await supabase.functions.invoke("cleaner-job-checklist", {
        body: { token },
      });
      const readOutcome = await edgeResult(read.error, read.data);
      if (!readOutcome.ok) throw new Error(readOutcome.error);
      setDetail((read.data as { checklist: ChecklistDetail }).checklist);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [booking.id]);

  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    if (next && !detail && !loading) void load();
  };

  const summary = booking.checklist;
  const done = detail?.completed_items ?? summary?.completed_items ?? 0;
  const total = detail?.total_items ?? summary?.total_items ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const completedAt = detail?.completed_at ?? summary?.completed_at ?? null;

  // Two different things both end up as "complete", and conflating them would
  // mislead: a crew ticking each line leaves a per-item record, while closing
  // the job rolls the count to 100% via a database trigger and ticks nothing.
  // When the headline count outruns the per-item record, say so — otherwise
  // this panel reads as "32 of 32 done" beside 32 visibly unticked lines.
  const tickedItems = detail
    ? Object.values(detail.items || {}).filter((entry) => entry?.done).length
    : 0;
  const countedWithoutDetail = Boolean(detail) && done > tickedItems;

  return (
    <Card className="border-slate-200">
      <CardContent className="py-4 space-y-3">
        <button onClick={toggleOpen} className="w-full text-left" type="button">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-slate-900 flex items-center gap-1.5">
              <RiListCheck2 className="h-4 w-4 text-slate-400" />
              Cleaning checklist
              {completedAt ? (
                <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800 text-[10px]">
                  complete
                </Badge>
              ) : null}
            </p>
            <span className="flex items-center gap-2 text-xs text-slate-500 tabular-nums">
              {total > 0 ? `${done}/${total}` : null}
              <RiArrowRightSLine
                className={cn("h-4 w-4 transition-transform", open && "rotate-90")}
              />
            </span>
          </div>
          {total > 0 ? (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  pct === 100 ? "bg-emerald-500" : "bg-[#5C0FFE]",
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
          ) : null}
          <p className="mt-1.5 text-xs text-slate-500">
            {!booking.job_id
              ? "Not dispatched yet — a checklist starts once a contractor is assigned."
              : open
                ? "What the crew works through on site."
                : "Tap to see what's in scope and what's been done."}
          </p>
        </button>

        {open ? (
          <div className="space-y-3">
            {loading ? (
              <p className="flex items-center gap-1.5 text-xs text-slate-500">
                <RiLoader4Line className="h-3.5 w-3.5 animate-spin" />
                Loading the checklist…
              </p>
            ) : null}

            {error ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
                <p className="text-xs text-rose-800">{error}</p>
                <Button size="sm" variant="outline" className="mt-2" onClick={() => void load()}>
                  Try again
                </Button>
              </div>
            ) : null}

            {!loading && !error && !hasJob ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                No checklist yet — one is created when this booking is dispatched to a
                contractor. Until then there is no job for the crew to work through.
              </p>
            ) : null}

            {countedWithoutDetail ? (
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Counted as {done}/{total} when the job was closed
                {tickedItems > 0 ? `, but only ${tickedItems} were ticked off individually` : ""} —
                so the lines below are not a record of what the crew confirmed one by one.
              </p>
            ) : null}

            {detail ? (
              <>
                {detail.last_activity_by && detail.last_activity_at ? (
                  <p className="text-xs text-slate-500">
                    Last update by {detail.last_activity_by} ·{" "}
                    {new Date(detail.last_activity_at).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                ) : null}

                <div className="space-y-3">
                  {detail.sections.map((section, sectionIdx) => {
                    const doneInSection = section.items.filter(
                      (_, itemIdx) => detail.items?.[`${sectionIdx}:${itemIdx}`]?.done,
                    ).length;
                    return (
                      <div key={section.title}>
                        <p className="flex items-baseline justify-between gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          <span>{section.title}</span>
                          <span className="tabular-nums">
                            {doneInSection}/{section.items.length}
                          </span>
                        </p>
                        <ul className="mt-1 space-y-1">
                          {section.items.map((item, itemIdx) => {
                            const entry = detail.items?.[`${sectionIdx}:${itemIdx}`];
                            const isDone = Boolean(entry?.done);
                            return (
                              <li
                                key={`${sectionIdx}:${itemIdx}`}
                                className="flex items-start gap-1.5 text-xs"
                              >
                                <RiCheckLine
                                  className={cn(
                                    "mt-0.5 h-3.5 w-3.5 shrink-0",
                                    isDone ? "text-emerald-600" : "text-slate-300",
                                  )}
                                />
                                <span
                                  className={cn(
                                    isDone ? "text-slate-500 line-through" : "text-slate-700",
                                  )}
                                >
                                  {item}
                                  {entry?.by ? (
                                    <span className="text-slate-400"> · {entry.by}</span>
                                  ) : null}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })}
                </div>

                {contractorUrl ? (
                  <a
                    href={contractorUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block text-xs font-medium text-[#5C0FFE] underline decoration-dotted"
                  >
                    Open the contractor&apos;s view
                  </a>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ─── Final-balance link ──────────────────────────────────────────────────────
//
// The deposit page is sent before the clean against an estimate. This is its
// counterpart for after: the customer sees what was actually done — add-ons
// performed on site, any scope adjustment — and pays the rest from the same
// page. It lives here rather than being a payment option chosen at booking time
// because the final figure isn't knowable until the job is finished.
//
// Re-issuing returns the SAME link, so sending it twice never invalidates the
// copy the customer already has.

function BalanceLinkCard({ booking }: { booking: BookingRow }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setUrl(null);
  }, [booking.id]);

  const issue = async (sendSms: boolean) => {
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not signed in");
      const res = await fetch("/api/bookings/balance-link", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ bookingId: booking.id, sendSms }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error || "Could not create the link.");
      setUrl(d.url as string);
      if (sendSms) {
        if (d.smsSent) toast.success("Balance link texted to the customer");
        else {
          toast.error("Couldn't text the link", {
            description: `${d.smsError || "Unknown error"} — the link below still works.`,
            duration: 15_000,
          });
        }
      } else {
        try {
          await navigator.clipboard.writeText(d.url as string);
          toast.success("Balance link copied");
        } catch {
          toast.success("Balance link ready");
        }
      }
    } catch (e) {
      toast.error("Couldn't create the balance link", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-slate-200">
      <CardContent className="py-4 space-y-3">
        <div>
          <p className="text-sm font-medium text-slate-900">Final balance link</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Shows the customer what was completed, how the total was reached, and collects the
            remaining balance. Safe to send more than once — the link stays the same.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={() => void issue(true)}>
            {busy ? <RiLoader4Line className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            Text it to the customer
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void issue(false)}>
            Copy link
          </Button>
        </div>
        {url ? (
          <p className="break-all rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
            {url}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function LivePhotoGallery({ bookingId }: { bookingId: string }) {
  const [before, setBefore] = useState<string[]>([]);
  const [after, setAfter] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data } = await supabase
        .from("bookings")
        .select("before_photos, after_photos")
        .eq("id", bookingId)
        .maybeSingle();
      if (!alive || !data) return;
      setBefore(((data.before_photos as string[]) || []).filter((u) => u?.startsWith("http")));
      setAfter(((data.after_photos as string[]) || []).filter((u) => u?.startsWith("http")));
      setLoaded(true);
    };
    void load();
    const timer = setInterval(load, 12_000);
    return () => { alive = false; clearInterval(timer); };
  }, [bookingId]);

  if (!loaded || (before.length === 0 && after.length === 0)) return null;

  const strip = (label: string, urls: string[]) =>
    urls.length > 0 ? (
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
          {label} ({urls.length})
        </p>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {urls.map((u, i) => (
            <a key={i} href={u} target="_blank" rel="noreferrer" className="shrink-0">
              <MediaThumb url={u} alt={`${label} ${i + 1}`} className="h-16 w-16 object-cover rounded-md border border-slate-200" />
            </a>
          ))}
        </div>
      </div>
    ) : null;

  return (
    <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
      <p className="text-xs font-semibold text-emerald-800 flex items-center gap-1.5">
        <RiCameraLine className="w-4 h-4" /> Uploaded photos &amp; videos (live)
      </p>
      {strip("Before", before)}
      {strip("After", after)}
    </div>
  );
}

// ─── Admin before/after photo upload ──────────────────────────────────────
// Lets an admin/VA upload before & after photos directly from the portal
// instead of waiting on the contractor. Files are compressed and pushed to the
// public `cleaner-job-photos` bucket (authenticated RLS allows it), then the
// public URLs are handed to admin-submit-photos, which reuses the same
// append + customer-gallery flow as a cleaner submission.
const PHOTO_BUCKET = "cleaner-job-photos";

async function prepareAdminPhoto(
  file: File,
): Promise<{ blob: Blob; ext: string; contentType: string }> {
  if (isVideoFile(file)) {
    const rawExt = (file.name.split(".").pop() || "mp4").toLowerCase();
    const ext = rawExt === "qt" ? "mov" : rawExt;
    return { blob: file, ext, contentType: file.type || "video/mp4" };
  }
  try {
    const compressed = await imageCompression(file, {
      maxSizeMB: 1.5,
      maxWidthOrHeight: 1600,
      useWebWorker: true,
      fileType: "image/jpeg",
      initialQuality: 0.8,
    });
    return { blob: compressed, ext: "jpg", contentType: "image/jpeg" };
  } catch {
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    return { blob: file, ext, contentType: file.type || "image/jpeg" };
  }
}

function AdminPhotoSubmit({ booking, onSubmitted }: { booking: BookingRow; onSubmitted: () => void }) {
  const [beforeUrls, setBeforeUrls] = useState<string[]>([]);
  const [afterUrls, setAfterUrls] = useState<string[]>([]);
  const [uploadingKind, setUploadingKind] = useState<"before" | "after" | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleFiles = async (kind: "before" | "after", files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadingKind(kind);
    const added: string[] = [];
    try {
      for (const file of Array.from(files)) {
        const tooBig = videoTooLargeMessage(file);
        if (tooBig) {
          toast.error(tooBig);
          continue;
        }
        const { blob, ext, contentType } = await prepareAdminPhoto(file);
        const key = `bookings/${booking.id}/${kind}/${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}.${ext}`;
        const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(key, blob, {
          cacheControl: "3600",
          contentType,
          upsert: false,
        });
        if (error) throw error;
        const { data: pub } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(key);
        added.push(pub.publicUrl);
      }
      if (!added.length) return;
      if (kind === "before") setBeforeUrls((prev) => [...prev, ...added]);
      else setAfterUrls((prev) => [...prev, ...added]);
      toast.success(`Added ${added.length} ${kind} file${added.length === 1 ? "" : "s"}`);
    } catch (err) {
      toast.error("Upload failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setUploadingKind(null);
    }
  };

  const removeUrl = (kind: "before" | "after", url: string) => {
    if (kind === "before") setBeforeUrls((u) => u.filter((x) => x !== url));
    else setAfterUrls((u) => u.filter((x) => x !== url));
  };

  const submit = async () => {
    if (beforeUrls.length === 0 && afterUrls.length === 0) {
      toast.error("Add at least one photo or video first.");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-submit-photos", {
        body: { bookingId: booking.id, beforeUrls, afterUrls },
      });
      if (error) throw error;
      const d = data as { ok?: boolean; error?: string };
      if (!d?.ok) throw new Error(d?.error || "Submit failed");
      toast.success("Photos saved to this booking.");
      setBeforeUrls([]);
      setAfterUrls([]);
      onSubmitted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not submit photos");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <p className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
        <RiUploadCloud2Line className="w-4 h-4 text-violet-700" /> Upload photos yourself
      </p>
      <AdminPhotoGroup
        title="Before photos & videos"
        urls={beforeUrls}
        uploading={uploadingKind === "before"}
        onAdd={(files) => handleFiles("before", files)}
        onRemove={(u) => removeUrl("before", u)}
      />
      <AdminPhotoGroup
        title="After photos & videos"
        urls={afterUrls}
        uploading={uploadingKind === "after"}
        onAdd={(files) => handleFiles("after", files)}
        onRemove={(u) => removeUrl("after", u)}
      />
      <Button
        className="w-full bg-violet-600 hover:bg-violet-700 text-white"
        onClick={submit}
        disabled={submitting || uploadingKind !== null || (beforeUrls.length === 0 && afterUrls.length === 0)}
      >
        {submitting ? <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" /> : <RiCheckLine className="w-4 h-4 mr-2" />}
        Submit photos
      </Button>
      <p className="text-[11px] text-slate-400">
        After photos trigger the customer&apos;s before/after gallery link, exactly like a cleaner upload.
      </p>
    </div>
  );
}

function AdminPhotoGroup({
  title,
  urls,
  uploading,
  onAdd,
  onRemove,
}: {
  title: string;
  urls: string[];
  uploading: boolean;
  onAdd: (files: FileList | null) => void;
  onRemove: (u: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium text-slate-600">{title}</p>
        <span className="text-[11px] text-slate-400">{urls.length} attached</span>
      </div>
      {urls.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {urls.map((u) => (
            <div key={u} className="relative aspect-square rounded-md overflow-hidden border border-slate-200">
              <MediaThumb url={u} className="absolute inset-0 w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => onRemove(u)}
                className="absolute top-0.5 right-0.5 bg-black/50 text-white rounded-full p-0.5 hover:bg-black/70"
              >
                <RiCloseCircleLine className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      <label
        className={cn(
          "flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 p-3 cursor-pointer hover:border-violet-400 hover:bg-violet-50/40 transition",
          uploading && "opacity-60 pointer-events-none",
        )}
      >
        {uploading ? (
          <>
            <RiLoader4Line className="w-4 h-4 animate-spin text-slate-500" />
            <span className="text-xs text-slate-500">Uploading…</span>
          </>
        ) : (
          <>
            <RiCameraLine className="w-4 h-4 text-violet-600" />
            <span className="text-xs font-medium text-slate-700">Tap to take or pick photos or videos</span>
            <RiImageAddLine className="w-4 h-4 text-slate-400" />
          </>
        )}
        <input
          type="file"
          accept="image/*,video/*"
          multiple
          onChange={(e) => {
            onAdd(e.target.files);
            e.target.value = "";
          }}
          className="hidden"
        />
      </label>
    </div>
  );
}

// ─── Add-on services dialog (post-completion capable) ─────────────────────
function AddonDialog({
  open,
  onOpenChange,
  booking,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  booking: BookingRow;
  onSuccess: () => void;
}) {
  const current = (booking.add_ons || []) as string[];
  const [selected, setSelected] = useState<string[]>(current);
  const [addOnPrices, setAddOnPrices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // Re-sync when opening a different booking.
  useEffect(() => {
    if (!open) return;
    setSelected((booking.add_ons || []) as string[]);
    setAddOnPrices({});
  }, [open, booking.id, booking.add_ons]);

  const isMoveInOut = booking.service_type === "moveInOut";
  const chargeable = (id: string) => (isMoveInOut ? id !== "fridge" && id !== "oven" : true);
  const catalogPrice = (id: string) => (ADD_ONS as Record<string, { price: number }>)[id]?.price ?? 0;
  const priceDollars = (id: string) => {
    const raw = addOnPrices[id];
    const dollars = raw != null && raw !== "" ? Number(raw) : catalogPrice(id);
    return Number.isFinite(dollars) ? dollars : 0;
  };

  const added = selected.filter((a) => !current.includes(a));
  const removed = current.filter((a) => !selected.includes(a));
  const deltaCents =
    added.filter(chargeable).reduce((s, a) => s + Math.round(priceDollars(a) * 100), 0) -
    removed.filter(chargeable).reduce((s, a) => s + Math.round(catalogPrice(a) * 100), 0);

  const toggle = (id: string) =>
    setSelected((s) => {
      if (s.includes(id)) return s.filter((x) => x !== id);
      setAddOnPrices((p) =>
        p[id] != null ? p : { ...p, [id]: String(catalogPrice(id)) },
      );
      return [...s, id];
    });

  const setAddOnPrice = (id: string, value: string) =>
    setAddOnPrices((p) => ({ ...p, [id]: value }));

  const buildPricedAddOns = () => {
    const priced: Record<string, number> = {};
    for (const id of added.filter(chargeable)) {
      priced[id] = priceDollars(id);
    }
    return priced;
  };

  const submit = async (charge: boolean) => {
    if (added.length === 0 && removed.length === 0) {
      toast.error("No add-on changes selected.");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-add-booking-addons", {
        body: { bookingId: booking.id, addOns: selected, charge, addOnPrices: buildPricedAddOns() },
      });
      if (error) throw error;
      const d = data as { error?: string; status?: string; deltaCents?: number };
      if (d?.error) throw new Error(d.error);
      if (d?.status === "paid") toast.success(`Added & charged ${fmtMoney(d.deltaCents)} to card on file. Customer notified.`);
      else if (d?.status === "charge_failed") toast.warning("Add-ons saved — no usable card on file, so the amount will be collected with the booking balance. Customer notified.");
      else if (charge && d?.status === "no_charge") {
        throw new Error("Charge was $0.00 — the server may not recognize these add-ons yet. Use Retry charge after deploy.");
      } else toast.success("Add-ons updated. Customer notified.");
      onSuccess();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update add-ons");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add-on services</DialogTitle>
          <DialogDescription>
            Select add-ons for booking #{booking.booking_number || booking.id.slice(0, 6)}. The price difference is auto-charged to the card on file and the customer is notified — no pay links are sent.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[50vh] overflow-y-auto space-y-1.5 py-1">
          {Object.entries(ADD_ONS).map(([id, def]) => {
            const free = isMoveInOut && !chargeable(id);
            const on = selected.includes(id);
            const isNew = on && !current.includes(id);
            return (
              <div key={id} className="rounded-md border border-slate-200 px-3 py-2 hover:bg-slate-50">
                <label className="flex items-center justify-between gap-3 cursor-pointer">
                  <span className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={on} onChange={() => toggle(id)} />
                    {def.label}
                  </span>
                  {!on || free ? (
                    <span className="text-xs text-slate-500 tabular-nums">{free ? "Included" : `$${def.price}`}</span>
                  ) : (
                    <div className="flex items-center gap-1" onClick={(e) => e.preventDefault()}>
                      <span className="text-slate-400 text-xs">$</span>
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        value={addOnPrices[id] ?? String(def.price)}
                        onChange={(e) => setAddOnPrice(id, e.target.value)}
                        className="h-7 w-20 text-right tabular-nums text-xs"
                      />
                    </div>
                  )}
                </label>
                {isNew && chargeable(id) && (
                  <p className="mt-1 pl-6 text-[11px] text-slate-400">New add-on — adjust price before charging</p>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between text-sm border-t pt-3">
          <span className="text-slate-500">Amount to charge</span>
          <span className="font-semibold tabular-nums">{fmtMoney(Math.max(0, deltaCents))}</span>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => submit(false)} disabled={busy}>
            Save without charging
          </Button>
          <Button onClick={() => submit(true)} disabled={busy || deltaCents <= 0} className="bg-violet-600 hover:bg-violet-700 text-white">
            {busy ? <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" /> : null}
            Add &amp; charge {fmtMoney(Math.max(0, deltaCents))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
