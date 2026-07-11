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
  RiCameraLine,
  RiImageAddLine,
  RiUploadCloud2Line,
} from "@remixicon/react";
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
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { RescheduleDialog } from "@/components/booking/RescheduleDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {
  ADD_ONS,
  type AddOnId,
  calculatePrice,
  SERVICE_TIER_PRICING,
  HOME_SIZE_RANGES,
} from "@/lib/pricing";
import { cn } from "@/lib/utils";

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

  const unassign = async () => {
    if (!confirm("Unassign all cleaners from this job? It will drop off their dashboards and the job reopens for assignment.")) return;
    setWorking("unassign");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not signed in");
      const res = await fetch("/api/admin/unassign-job", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ bookingId: booking.id }),
      });
      const json = await res.json();
      if (!res.ok || json?.error) throw new Error(json?.error || "Unassign failed");
      toast.success("Cleaner(s) unassigned — removed from their dashboards, GHL + Airtable synced");
      onMutated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(null);
    }
  };

  if (booking.status === "cancelled" || booking.status === "completed") return null;

  const hasAssignment = Boolean(booking.cleaner_id) || (booking.num_cleaners_assigned ?? 0) > 0;

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
        {hasAssignment && (
          <Button
            onClick={unassign}
            disabled={working === "unassign"}
            variant="outline"
            className="w-full border-rose-200 text-rose-700 hover:bg-rose-50"
          >
            {working === "unassign" ? (
              <>
                <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" />
                Unassigning…
              </>
            ) : (
              <>
                <RiCloseCircleLine className="w-4 h-4 mr-2" />
                Unassign cleaner(s) — remove from their dashboard
              </>
            )}
          </Button>
        )}
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
  // Grant-credit state (applies to the booking's customer by email).
  const [creditAmount, setCreditAmount] = useState("");
  const [creditSource, setCreditSource] = useState("admin_grant");
  const [creditReason, setCreditReason] = useState("");
  // Adjust-job-cost state (revenue + optional refund).
  const [jobCost, setJobCost] = useState("");
  const [jobCostRefund, setJobCostRefund] = useState("");
  const [jobCostReason, setJobCostReason] = useState("");
  const [unpaidAddonCharge, setUnpaidAddonCharge] = useState<{
    id: string;
    added_addons: string[];
  } | null>(null);

  useEffect(() => {
    if (!booking) return;
    setAdjustOpen(false);
    setCreditAmount("");
    setCreditSource("admin_grant");
    setCreditReason("");
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
  }, [booking?.id]);

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

  const grantCredit = async () => {
    const cents = Math.round(parseFloat(creditAmount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      toast.error("Enter a positive dollar amount");
      return;
    }
    if (!booking.email) {
      toast.error("This booking has no customer email to credit.");
      return;
    }
    setWorking("credit");
    try {
      const { data, error } = await supabase.functions.invoke("admin-grant-credit", {
        body: {
          action: "grant",
          email: booking.email,
          firstName: booking.first_name || undefined,
          lastName: booking.last_name || undefined,
          phone: booking.phone || undefined,
          amountCents: cents,
          source: creditSource,
          reason: creditReason || `Credit applied from booking #${booking.booking_number || booking.id.slice(0, 6)}`,
        },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      const notified = [(data as { emailSent?: boolean })?.emailSent && "email", (data as { smsSent?: boolean })?.smsSent && "SMS"].filter(Boolean).join(" + ");
      toast.success(`Credited $${(cents / 100).toFixed(2)} to ${booking.email}${notified ? ` · ${notified} sent` : ""}`);
      setCreditAmount("");
      setCreditReason("");
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
                  Before &amp; after photos
                </CardTitle>
                <CardDescription>
                  Text the assigned cleaner a secure upload link, or upload the before/after photos yourself.
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

            {/* Grant credit (to the booking's customer, by email) */}
            <Card className="border-slate-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <RiMoneyDollarCircleLine className="w-4 h-4 text-violet-700" />
                  Apply account credit
                </CardTitle>
                <CardDescription>
                  Adds wallet credit to {booking.email || "this customer"} (auto-applies at their next checkout). They get an email + SMS.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
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
                </div>
                <div>
                  <Label className="text-xs">Reason (visible to customer)</Label>
                  <Input
                    value={creditReason}
                    onChange={(e) => setCreditReason(e.target.value)}
                    placeholder="e.g., Sorry about the late arrival"
                  />
                </div>
                <Button
                  onClick={grantCredit}
                  disabled={working === "credit" || !creditAmount}
                  className="w-full bg-violet-600 hover:bg-violet-700 text-white"
                >
                  {working === "credit" ? (
                    <><RiLoader4Line className="w-4 h-4 mr-2 animate-spin" /> Applying…</>
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
                      the payout.
                    </div>
                  )}
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
                        {booking.status === "pending_review" ? "Finalize & complete booking" : "Mark booking completed"}
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
    </>
  );
}

// ─── Live photo gallery ────────────────────────────────────────────────────
// Shows the booking's CURRENT before/after photos, straight from the bookings
// row, the moment they exist. Auto-refreshes while the sheet is open so a
// cleaner uploading from the field appears here within seconds — no reload.
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
              <img src={u} alt={`${label} ${i + 1}`} className="h-16 w-16 object-cover rounded-md border border-slate-200" loading="lazy" />
            </a>
          ))}
        </div>
      </div>
    ) : null;

  return (
    <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
      <p className="text-xs font-semibold text-emerald-800 flex items-center gap-1.5">
        <RiCameraLine className="w-4 h-4" /> Uploaded photos (live)
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
      if (kind === "before") setBeforeUrls((prev) => [...prev, ...added]);
      else setAfterUrls((prev) => [...prev, ...added]);
      toast.success(`Added ${added.length} ${kind} photo${added.length === 1 ? "" : "s"}`);
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
      toast.error("Add at least one photo first.");
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
        title="Before photos"
        urls={beforeUrls}
        uploading={uploadingKind === "before"}
        onAdd={(files) => handleFiles("before", files)}
        onRemove={(u) => removeUrl("before", u)}
      />
      <AdminPhotoGroup
        title="After photos"
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
              <img src={u} alt="" className="absolute inset-0 w-full h-full object-cover" />
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
            <span className="text-xs font-medium text-slate-700">Tap to take or pick photos</span>
            <RiImageAddLine className="w-4 h-4 text-slate-400" />
          </>
        )}
        <input
          type="file"
          accept="image/*"
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
      } else toast.success("Add-ons updated.");
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
