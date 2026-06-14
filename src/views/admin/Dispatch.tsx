"use client";

// ─── Admin Dispatch console ────────────────────────────────────────────
//
// Live operational board for getting confirmed bookings staffed. It shows:
//   • "Needs dispatch" — confirmed bookings with no job yet (one-click
//     create-job + auto-dispatch)
//   • Active dispatch jobs grouped by stage (New → Dispatching/Broadcast →
//     Offered → Confirmed → In Progress → Completed), each with its cleaner
//     assignments, the real arrival window, and a re-dispatch action.
//
// Built with HeroUI (themed to the Novara purple) — the first net-new admin
// surface on the HeroUI design system. Reads via the admin-list-jobs edge
// function; actions reuse auto-dispatch-booking / dispatch-job.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Divider,
  Spinner,
  Tab,
  Tabs,
  Tooltip,
} from "@heroui/react";
import {
  RiRefreshLine,
  RiRocket2Line,
  RiMapPin2Line,
  RiTimeLine,
  RiAlertLine,
  RiUserStarLine,
  RiCalendarCheckLine,
} from "@remixicon/react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// ─── Types ───────────────────────────────────────────────────────────────
interface Assignment {
  id: string;
  cleaner_id: string | null;
  cleaner_name: string | null;
  role: string | null;
  status: string | null;
  distance_miles: number | null;
  estimated_pay_cents: number | null;
  expires_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
}
interface BookingSummary {
  id: string;
  booking_number: number | null;
  status: string | null;
  service_date: string | null;
  time_slot: string | null;
  arrival_window: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  total_estimate_cents: number | null;
}
interface DispatchJob {
  id: string;
  status: string | null;
  service_type: string | null;
  sq_ft: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  start_datetime: string | null;
  duration_est_hours: number | null;
  min_cleaners_required: number | null;
  manual_intervention_required: boolean | null;
  dispatch_alert_reason: string | null;
  booking: BookingSummary | null;
  assignments: Assignment[];
}
interface UnassignedBooking {
  id: string;
  booking_number: number | null;
  status: string | null;
  service_date: string | null;
  time_slot: string | null;
  arrival_window: string | null;
  first_name: string | null;
  last_name: string | null;
  city: string | null;
  state: string | null;
  total_estimate_cents: number | null;
}

// ─── Formatters (tz-safe, no UTC drift) ────────────────────────────────────
const fmtDate = (d?: string | null) => {
  if (!d) return "Unscheduled";
  const dt = new Date(`${d}T12:00:00`);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};
const fmtWindow = (slot?: string | null) => {
  if (!slot) return "";
  const map: Record<string, string> = {
    "8-12": "8:00 AM – 12:00 PM",
    "12-16": "12:00 PM – 4:00 PM",
    "16-20": "4:00 PM – 8:00 PM",
  };
  return map[slot] || slot.replace(/\s*-\s*/, " – ");
};
const money = (c?: number | null) =>
  c == null ? "—" : (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

// ─── Stage grouping ────────────────────────────────────────────────────────
type StageKey = "needs_attention" | "new" | "dispatching" | "offered" | "confirmed" | "in_progress" | "completed";
const STAGES: { key: StageKey; label: string; tone: "danger" | "warning" | "primary" | "success" | "default" }[] = [
  { key: "needs_attention", label: "Needs attention", tone: "danger" },
  { key: "new", label: "New", tone: "default" },
  { key: "dispatching", label: "Dispatching", tone: "warning" },
  { key: "offered", label: "Offered", tone: "primary" },
  { key: "confirmed", label: "Confirmed", tone: "success" },
  { key: "in_progress", label: "In progress", tone: "primary" },
  { key: "completed", label: "Completed", tone: "default" },
];

function stageForJob(job: DispatchJob): StageKey {
  const s = String(job.status || "").toLowerCase();
  if (job.manual_intervention_required) return "needs_attention";
  if (s.includes("complete")) return "completed";
  if (s.includes("progress")) return "in_progress";
  if (s.includes("confirm")) return "confirmed";
  if (s === "offered") return "offered";
  if (s === "broadcast" || s === "dispatching") return "dispatching";
  // Confirmed assignment present?
  if (job.assignments.some((a) => ["confirmed", "accepted"].includes(String(a.status || "").toLowerCase()))) {
    return "confirmed";
  }
  if (job.assignments.some((a) => ["offered", "broadcast"].includes(String(a.status || "").toLowerCase()))) {
    return "offered";
  }
  return "new";
}

const assignTone = (status?: string | null): "success" | "primary" | "danger" | "default" => {
  const s = String(status || "").toLowerCase();
  if (["confirmed", "accepted"].includes(s)) return "success";
  if (["offered", "broadcast"].includes(s)) return "primary";
  if (["declined", "expired", "withdrawn", "broadcast_lost", "cancelled"].includes(s)) return "danger";
  return "default";
};

export default function AdminDispatch() {
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<DispatchJob[]>([]);
  const [unassigned, setUnassigned] = useState<UnassignedBooking[]>([]);
  const [dateRange, setDateRange] = useState("active");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-list-jobs", {
        body: { dateRange },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setJobs(((data as any)?.jobs as DispatchJob[]) || []);
      setUnassigned(((data as any)?.unassignedBookings as UnassignedBooking[]) || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load dispatch board");
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

  useEffect(() => {
    void load();
  }, [load]);

  const dispatchBooking = async (bookingId: string) => {
    setBusyId(bookingId);
    try {
      const { data, error } = await supabase.functions.invoke("auto-dispatch-booking", {
        body: { bookingId },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Job created and offers sent to cleaners.");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Dispatch failed");
    } finally {
      setBusyId(null);
    }
  };

  const redispatchJob = async (jobId: string) => {
    setBusyId(jobId);
    try {
      const { data, error } = await supabase.functions.invoke("dispatch-job", {
        body: { jobId },
      });
      if (error) throw error;
      const payload = (data as any) || {};
      if (payload.noCleanersAvailable) {
        toast.warning("No eligible cleaners found right now — broadcast/manual assign may be needed.");
      } else {
        toast.success(`Offers sent (${payload.offersSent ?? payload.broadcastSent ?? 0}).`);
      }
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Re-dispatch failed");
    } finally {
      setBusyId(null);
    }
  };

  const grouped = useMemo(() => {
    const map: Record<StageKey, DispatchJob[]> = {
      needs_attention: [], new: [], dispatching: [], offered: [], confirmed: [], in_progress: [], completed: [],
    };
    for (const j of jobs) map[stageForJob(j)].push(j);
    return map;
  }, [jobs]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-jakarta text-2xl font-extrabold flex items-center gap-2 text-slate-900">
            <RiRocket2Line className="w-6 h-6 text-primary" />
            Dispatch Console
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Staff confirmed bookings, track offers, and re-dispatch in one place.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Tabs
            aria-label="Date range"
            size="sm"
            selectedKey={dateRange}
            onSelectionChange={(k) => setDateRange(String(k))}
            color="primary"
          >
            <Tab key="active" title="Active" />
            <Tab key="next_14" title="Next 14 days" />
            <Tab key="past_7" title="Past 7 days" />
          </Tabs>
          <Button
            isIconOnly
            variant="flat"
            aria-label="Refresh"
            onPress={() => void load()}
            isLoading={loading}
          >
            <RiRefreshLine className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Spinner color="primary" label="Loading dispatch board…" />
        </div>
      ) : (
        <>
          {/* Needs dispatch (no job yet) */}
          <Card shadow="sm" className="border border-amber-200">
            <CardHeader className="flex items-center gap-2 pb-2">
              <RiAlertLine className="w-4 h-4 text-amber-500" />
              <span className="font-semibold text-slate-900">Needs dispatch</span>
              <Chip size="sm" variant="flat" color="warning">{unassigned.length}</Chip>
              <span className="text-xs text-slate-500 ml-1">Confirmed bookings without a job yet</span>
            </CardHeader>
            <CardBody className="pt-0">
              {unassigned.length === 0 ? (
                <p className="text-sm text-slate-500 py-2">Everything is staffed — nothing waiting on dispatch. 🎉</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {unassigned.map((b) => (
                    <div key={b.id} className="rounded-xl border border-slate-200 p-3 flex flex-col gap-2 bg-white">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-sm text-slate-900 truncate">
                            {b.first_name} {b.last_name}
                          </p>
                          <p className="text-xs text-slate-500">
                            {fmtDate(b.service_date)} · {fmtWindow(b.time_slot || b.arrival_window) || "time TBD"}
                          </p>
                          <p className="text-xs text-slate-500 truncate">
                            {b.city || ""}{b.state ? `, ${b.state}` : ""} · {money(b.total_estimate_cents)}
                          </p>
                        </div>
                        <Chip size="sm" variant="flat" color={b.status === "confirmed" ? "success" : "default"}>
                          {b.status}
                        </Chip>
                      </div>
                      <Button
                        size="sm"
                        color="primary"
                        startContent={<RiRocket2Line className="w-4 h-4" />}
                        isLoading={busyId === b.id}
                        onPress={() => void dispatchBooking(b.id)}
                      >
                        Create &amp; dispatch
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          {/* Job stages */}
          {STAGES.map((stage) => {
            const list = grouped[stage.key];
            if (!list || list.length === 0) return null;
            return (
              <div key={stage.key} className="space-y-2">
                <div className="flex items-center gap-2">
                  <h2 className="font-jakarta font-bold text-slate-900">{stage.label}</h2>
                  <Chip size="sm" variant="flat" color={stage.tone}>{list.length}</Chip>
                </div>
                <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                  {list.map((job) => (
                    <JobCard
                      key={job.id}
                      job={job}
                      busy={busyId === job.id}
                      onRedispatch={() => void redispatchJob(job.id)}
                    />
                  ))}
                </div>
              </div>
            );
          })}

          {jobs.length === 0 && unassigned.length === 0 && (
            <Card shadow="sm">
              <CardBody className="py-12 text-center text-slate-500">
                <RiCalendarCheckLine className="w-10 h-10 mx-auto mb-3 text-primary" />
                No dispatch jobs in this range.
              </CardBody>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ─── Job card ──────────────────────────────────────────────────────────────
function JobCard({
  job,
  busy,
  onRedispatch,
}: {
  job: DispatchJob;
  busy: boolean;
  onRedispatch: () => void;
}) {
  const date = job.booking?.service_date ?? null;
  const window = job.booking?.time_slot || job.booking?.arrival_window || null;
  const customer = job.booking
    ? `${job.booking.first_name || ""} ${job.booking.last_name || ""}`.trim()
    : "Customer";
  const confirmedCount = job.assignments.filter((a) =>
    ["confirmed", "accepted"].includes(String(a.status || "").toLowerCase()),
  ).length;
  const needed = job.min_cleaners_required || 1;

  return (
    <Card shadow="sm" className="border border-slate-200">
      <CardHeader className="flex items-start justify-between gap-2 pb-2">
        <div className="min-w-0">
          <p className="font-semibold text-slate-900 truncate capitalize">
            {(job.service_type || "Cleaning").replace(/_/g, " ")} · {customer}
          </p>
          <p className="text-xs text-slate-500 flex items-center gap-1">
            <RiTimeLine className="w-3.5 h-3.5" />
            {fmtDate(date)}{window ? ` · ${fmtWindow(window)}` : ""}
            {job.duration_est_hours ? ` · ~${job.duration_est_hours}h` : ""}
          </p>
        </div>
        <Chip
          size="sm"
          variant="flat"
          color={confirmedCount >= needed ? "success" : "warning"}
        >
          {confirmedCount}/{needed} staffed
        </Chip>
      </CardHeader>
      <CardBody className="pt-0 space-y-3">
        <p className="text-xs text-slate-500 flex items-center gap-1 truncate">
          <RiMapPin2Line className="w-3.5 h-3.5 shrink-0" />
          {job.address || ""}{job.city ? `, ${job.city}` : ""} {job.zip || ""}
        </p>

        {job.manual_intervention_required && job.dispatch_alert_reason && (
          <div className="rounded-lg bg-rose-50 border border-rose-200 px-2.5 py-1.5 text-xs text-rose-800 flex items-start gap-1.5">
            <RiAlertLine className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            {job.dispatch_alert_reason}
          </div>
        )}

        {job.assignments.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {job.assignments.map((a) => (
              <Tooltip
                key={a.id}
                content={`${a.status || "—"}${a.estimated_pay_cents ? ` · ${money(a.estimated_pay_cents)}` : ""}${a.distance_miles != null ? ` · ${Number(a.distance_miles).toFixed(1)} mi` : ""}`}
              >
                <Chip
                  size="sm"
                  variant="flat"
                  color={assignTone(a.status)}
                  startContent={<RiUserStarLine className="w-3 h-3" />}
                >
                  {a.cleaner_name || "Cleaner"}
                </Chip>
              </Tooltip>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-400">No cleaners offered yet.</p>
        )}

        <Divider />
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-400">
            {money(job.booking?.total_estimate_cents)} job
          </span>
          <Button
            size="sm"
            variant="flat"
            color="primary"
            startContent={<RiRocket2Line className="w-4 h-4" />}
            isLoading={busy}
            onPress={onRedispatch}
          >
            {confirmedCount >= needed ? "Re-dispatch" : "Send more offers"}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
