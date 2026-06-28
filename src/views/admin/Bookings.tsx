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
  RiCheckLine,
  RiArrowRightLine,
  RiInformationLine,
  RiEdit2Line,
  RiDeleteBin6Line,
} from "@remixicon/react";
import { format } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { RescheduleDialog } from "@/components/booking/RescheduleDialog";
import { cn } from "@/lib/utils";
import { calculatePrice, SERVICE_TIER_PRICING, HOME_SIZE_RANGES, ADD_ONS } from "@/lib/pricing";

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
}

const STATUS_COLORS: Record<string, string> = {
  pending_payment: "bg-amber-100 text-amber-900 border-amber-200",
  pending_details: "bg-amber-100 text-amber-900 border-amber-200",
  confirmed: "bg-violet-100 text-violet-900 border-violet-200",
  assigned: "bg-indigo-100 text-indigo-900 border-indigo-200",
  in_progress: "bg-blue-100 text-blue-900 border-blue-200",
  completed: "bg-blue-100 text-blue-900 border-blue-200",
  cancelled: "bg-slate-100 text-slate-700 border-slate-200",
};

const STATUS_OPTIONS = [
  "all",
  "confirmed",
  "assigned",
  "completed",
  "cancelled",
  "pending_payment",
  "pending_details",
] as const;

const fmtMoney = (cents: number | null | undefined) =>
  cents == null ? "—" : `$${(cents / 100).toFixed(2)}`;

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
                    {s === "all" ? "All statuses" : s.replaceAll("_", " ")}
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
                    <div className="col-span-12 md:col-span-3">
                      <p className="font-semibold text-slate-900 text-sm">
                        {b.first_name || ""} {b.last_name || ""}
                        {!b.first_name && !b.last_name && (
                          <span className="text-slate-400">(no name)</span>
                        )}
                      </p>
                      <p className="text-xs text-slate-500 tabular-nums">
                        #{b.booking_number || b.id.slice(0, 6)} · {b.email || "—"}
                      </p>
                    </div>
                    <div className="col-span-6 md:col-span-2">
                      <p className="text-sm text-slate-700 tabular-nums">
                        {b.service_date || "—"}
                      </p>
                      <p className="text-xs text-slate-500">{b.time_slot || ""}</p>
                    </div>
                    <div className="col-span-6 md:col-span-2 text-sm text-slate-700">
                      {b.service_type ? b.service_type.replaceAll("_", " ") : "—"}
                    </div>
                    <div className="col-span-6 md:col-span-2 text-xs text-slate-500 truncate">
                      {b.city ? `${b.city}, ${b.state || ""} ${b.zip_code || ""}` : "—"}
                    </div>
                    <div className="col-span-6 md:col-span-2 text-sm tabular-nums text-slate-900 font-medium">
                      {fmtMoney(b.total_estimate_cents)}
                    </div>
                    <div className="col-span-12 md:col-span-1 flex md:justify-end">
                      <Badge
                        variant="outline"
                        className={cn("text-[10px] capitalize border", STATUS_COLORS[statusKey] ?? "")}
                      >
                        {(b.status || "—").replaceAll("_", " ")}
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
}

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
  const [cleaners, setCleaners] = useState<CleanerOption[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestedCleaner[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loadingCleaners, setLoadingCleaners] = useState(true);
  const [loadingSuggest, setLoadingSuggest] = useState(true);
  const [depositBlocked, setDepositBlocked] = useState(false);

  useEffect(() => {
    void (async () => {
      setLoadingCleaners(true);
      setLoadingSuggest(true);
      const [dir, sug] = await Promise.all([
        supabase
          .from("cleaners")
          .select("id, first_name, last_name, phone, status")
          .eq("status", "active")
          .eq("approved", true)
          .order("last_name"),
        supabase.functions.invoke("admin-booking-assign", {
          body: { action: "suggest_cleaners", bookingId: booking.id, limit: 8 },
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
    })();
  }, [booking.id]);

  useEffect(() => {
    if (!booking.job_id) {
      setSelectedIds(booking.cleaner_id ? [booking.cleaner_id] : []);
      return;
    }
    void (async () => {
      const { data } = await supabase
        .from("job_assignments")
        .select("cleaner_id, role, status")
        .eq("job_id", booking.job_id)
        .in("status", ["Confirmed", "Accepted", "Assigned", "Offered"]);
      const ids = (data || [])
        .slice()
        .sort((a: any, b: any) =>
          String(a.role || "").toLowerCase() === "lead" ? -1 : 1,
        )
        .map((a: any) => a.cleaner_id as string)
        .filter(Boolean)
        .slice(0, 3);
      setSelectedIds(ids.length ? ids : booking.cleaner_id ? [booking.cleaner_id] : []);
    })();
  }, [booking.id, booking.job_id, booking.cleaner_id]);

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

  const assign = async (allowUnpaid = false) => {
    if (selectedIds.length === 0) {
      toast.error("Pick at least one cleaner from the directory.");
      return;
    }
    setWorking("assign");
    try {
      const { data, error } = await supabase.functions.invoke("admin-booking-assign", {
        body: { bookingId: booking.id, cleanerIds: selectedIds, mode: "replace", allowUnpaid },
      });
      // The deposit gate returns HTTP 402 with code "deposit_unpaid". The
      // supabase client surfaces non-2xx via `error`, but the JSON body is
      // still in `data` — check both so we can offer an override.
      const payload = (data ?? (error as any)?.context ?? {}) as { error?: string; code?: string };
      if (payload?.code === "deposit_unpaid") {
        setDepositBlocked(true);
        toast.error("Customer hasn't paid the deposit yet — assignment blocked.");
        return;
      }
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setDepositBlocked(false);
      const notes = (data as { notifications?: Array<{ email?: boolean; sms?: boolean }> })?.notifications;
      const emailed = notes?.filter((n) => n.email).length ?? 0;
      const texted = notes?.filter((n) => n.sms).length ?? 0;
      toast.success(
        `Assigned · GHL synced · ${emailed} email · ${texted} SMS · GHL task(s) created when contact is linked`,
      );
      onMutated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(null);
    }
  };

  if (booking.status === "cancelled" || booking.status === "completed") return null;

  return (
    <Card className="border-indigo-200 bg-indigo-50/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5 text-indigo-900">
          <RiUserSmileLine className="w-4 h-4" />
          Assign / reassign cleaners
        </CardTitle>
        <CardDescription>
          Nearby / available cleaners are ranked first. Assigning emails + texts cleaners and
          creates a GHL task on the customer contact when linked.
          {booking.num_cleaners_assigned
            ? ` Currently ${booking.num_cleaners_assigned} assigned.`
            : ""}
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
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggle(s.id)}
                    className={cn(
                      "text-xs px-2 py-1 rounded-full border transition-colors",
                      on
                        ? "bg-indigo-600 text-white border-indigo-600"
                        : "bg-white text-indigo-900 border-indigo-200 hover:bg-indigo-50",
                    )}
                  >
                    {s.first_name} {s.last_name?.[0]}.
                    {s.distance_miles != null ? ` · ${s.distance_miles} mi` : ""}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
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
              onClick={() => assign(true)}
              disabled={working === "assign"}
            >
              Assign anyway (override — cash / comp job)
            </Button>
          </div>
        )}
        <Button
          onClick={() => assign(false)}
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
      </CardContent>
    </Card>
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
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
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

  useEffect(() => {
    if (!booking) return;
    setAdjustOpen(false);
    setSvcType(booking.service_type || "standard");
    setSvcHomeSize(booking.home_size_id || "");
    setSvcAddOns([]);
    setAddOnPrices({});
    setTotalOverride("");
    // add_ons isn't in the list payload — pull the current ones so the
    // adjust form starts from the real selection on the booking.
    void (async () => {
      const { data } = await (supabase.from as any)("bookings")
        .select("add_ons")
        .eq("id", booking.id)
        .maybeSingle();
      const current = Array.isArray(data?.add_ons) ? (data.add_ons as string[]) : [];
      setSvcAddOns(current);
      const seeded: Record<string, string> = {};
      for (const id of current) {
        const def = (ADD_ONS as Record<string, { price: number }>)[id]?.price;
        if (def != null) seeded[id] = String(def);
      }
      setAddOnPrices(seeded);
    })();
  }, [booking?.id]);

  if (!booking) return null;

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
      const fn = refundType === "none" ? "cancel-booking" : "admin-refund-booking";
      const body =
        refundType === "none"
          ? { bookingId: booking.id, cancelReason, source: "admin", refundType: "none" }
          : { bookingId: booking.id, reason: cancelReason, refundType, markCancelled: true };
      const { data, error } = await supabase.functions.invoke(fn, { body });
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
          bookingId: booking.id,
          serviceType: svcType,
          homeSizeId: svcHomeSize,
          addOns: svcAddOns,
          addOnPrices: pricedAddOns,
          totalEstimateCents: newQuoteCents,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Service updated — customer notified via SMS & email.");
      onMutated();
      onClose();
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

  const markCompleted = async () => {
    if (!confirm("Mark this booking complete? This triggers final charge + payout.")) return;
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
                <span className="text-slate-500">Address</span>
                <span className="text-right truncate">
                  {booking.address || "—"}
                  {booking.city && `, ${booking.city}`}
                </span>
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
                  {(booking.status || "—").replaceAll("_", " ")}
                </span>
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

            {/* Mark complete */}
            {booking.status !== "completed" && booking.status !== "cancelled" && (
              <Card className="border-slate-200">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-1.5">
                    <RiUserSmileLine className="w-4 h-4 text-violet-700" />
                    Mark complete
                  </CardTitle>
                  <CardDescription>
                    Triggers final charge + cleaner payout. Use when the cleaner forgot to mark it.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    onClick={markCompleted}
                    disabled={working === "complete"}
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
                        Mark booking completed
                      </>
                    )}
                  </Button>
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
    </>
  );
}
