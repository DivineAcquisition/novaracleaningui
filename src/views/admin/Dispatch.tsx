"use client";

// ─── Admin Dispatch console (v2 — premium, approval-first) ──────────────
//
// The operational command center for staffing every job. As of 2026-07-06
// NOTHING goes out to cleaners without an admin's sign-off:
//
//   • "Needs dispatch"  — confirmed bookings without a job yet. One click
//     approves + sends offers, or quietly queues the job for later.
//   • "Awaiting approval" — jobs parked by the automatic pipeline (new
//     confirmations, declines, expiries). The dispatch Discord channel is
//     pinged when these appear; approving here sends the SMS offers.
//   • "Add-on approvals" — contractor-reported add-ons from their job
//     checklists. Approving charges the customer (off-session / invoice)
//     and visibly bumps the crew's pay; rejecting charges nothing.
//   • Live contractor checklist progress relays onto every job card.
//   • Header switches: contractor add-on reporting on/off, auto-offers
//     on/off (default off = approval-first).
//
// Built on HeroUI, themed to the Novara purple ramp.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Divider,
  Input,
  Spinner,
  Switch,
  Tab,
  Tabs,
  Tooltip,
} from "@heroui/react";
import {
  RiAlertLine,
  RiCalendarCheckLine,
  RiCheckboxCircleFill,
  RiCheckLine,
  RiCloseLine,
  RiExternalLinkLine,
  RiFileList3Line,
  RiMapPin2Line,
  RiMoneyDollarCircleLine,
  RiRefreshLine,
  RiRocket2Line,
  RiShieldCheckLine,
  RiTimeLine,
  RiUserStarLine,
} from "@remixicon/react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { FocusedChecklistEditor } from "@/components/admin/FocusedChecklistEditor";

const RAMP = "linear-gradient(135deg,#5C0FFE 0%,#8F7BFD 100%)";
const CONTRACTOR_BASE = "https://contractor.novaracleaning.com";

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
  add_ons: string[] | null;
}
interface ChecklistSummary {
  token: string;
  service_type: string | null;
  total_items: number;
  completed_items: number;
  progress_pct: number;
  started_at: string | null;
  completed_at: string | null;
  last_activity_at: string | null;
  last_activity_by: string | null;
}
interface AddonRequest {
  id: string;
  job_id: string;
  booking_id: string | null;
  cleaner_id: string | null;
  cleaner_name: string | null;
  addon_id: string;
  addon_label: string | null;
  amount_cents: number;
  cleaner_share_cents: number;
  note: string | null;
  status: "pending" | "approved" | "rejected";
  charge_status: string | null;
  created_at: string;
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
  checklist: ChecklistSummary | null;
  addon_requests: AddonRequest[];
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
interface DispatchSettings {
  contractor_addons_enabled: boolean;
  dispatch_auto_offers_enabled: boolean;
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
type StageKey =
  | "awaiting_approval"
  | "needs_attention"
  | "new"
  | "dispatching"
  | "offered"
  | "confirmed"
  | "in_progress"
  | "completed";
const STAGES: { key: StageKey; label: string; tone: "danger" | "warning" | "primary" | "success" | "default"; hint: string }[] = [
  { key: "awaiting_approval", label: "Awaiting your approval", tone: "warning", hint: "Nothing is sent to cleaners until you approve" },
  { key: "needs_attention", label: "Needs attention", tone: "danger", hint: "Flagged by the pipeline for manual review" },
  { key: "new", label: "New", tone: "default", hint: "Job created, no offers yet" },
  { key: "dispatching", label: "Dispatching", tone: "warning", hint: "Partially staffed / re-offering" },
  { key: "offered", label: "Offers out", tone: "primary", hint: "Waiting on cleaner responses" },
  { key: "confirmed", label: "Confirmed", tone: "success", hint: "Crew locked in" },
  { key: "in_progress", label: "In progress", tone: "primary", hint: "Crew on site — watch the checklist" },
  { key: "completed", label: "Completed", tone: "default", hint: "Done" },
];

function stageForJob(job: DispatchJob): StageKey {
  const s = String(job.status || "").toLowerCase();
  if (s === "pending approval") return "awaiting_approval";
  if (job.manual_intervention_required) return "needs_attention";
  if (s.includes("complete")) return "completed";
  if (s.includes("progress")) return "in_progress";
  if (s.includes("confirm") || s === "assigned") return "confirmed";
  if (s === "offered") return "offered";
  if (s === "broadcast" || s === "dispatching") return "dispatching";
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

// ─── Page ──────────────────────────────────────────────────────────────────
export default function AdminDispatch() {
  const searchParams = useSearchParams();
  const highlightJobId = searchParams?.get("job") || null;
  const highlightRef = useRef<HTMLDivElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<DispatchJob[]>([]);
  const [unassigned, setUnassigned] = useState<UnassignedBooking[]>([]);
  const [settings, setSettings] = useState<DispatchSettings>({
    contractor_addons_enabled: true,
    dispatch_auto_offers_enabled: false,
  });
  const [dateRange, setDateRange] = useState("active");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [settingBusy, setSettingBusy] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-list-jobs", {
        body: { dateRange },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);

      // Normalize defensively: an older deployed admin-list-jobs won't
      // include checklist/addon_requests/settings yet, and a missing array
      // here previously crashed the whole page ("client-side exception").
      const rawJobs = (((data as any)?.jobs as any[]) || []);
      const normalized: DispatchJob[] = rawJobs
        .filter((j) => String(j?.status || "").toLowerCase() !== "cancelled")
        .map((j) => ({
          ...j,
          booking: j?.booking ?? null,
          assignments: Array.isArray(j?.assignments) ? j.assignments : [],
          checklist: j?.checklist ?? null,
          addon_requests: Array.isArray(j?.addon_requests) ? j.addon_requests : [],
        }));
      setJobs(normalized);
      setUnassigned(((data as any)?.unassignedBookings as UnassignedBooking[]) || []);
      const s = (data as any)?.settings;
      if (s) {
        setSettings({
          contractor_addons_enabled: s.contractor_addons_enabled !== false,
          dispatch_auto_offers_enabled: s.dispatch_auto_offers_enabled === true,
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load dispatch board");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [dateRange]);

  useEffect(() => {
    void load();
  }, [load]);

  // Gentle background refresh so checklist progress + add-on requests stay live.
  useEffect(() => {
    const t = setInterval(() => void load(true), 45_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!loading && highlightJobId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [loading, highlightJobId]);

  // ─── Actions ─────────────────────────────────────────────────────────────
  const dispatchBooking = async (bookingId: string, sendOffers: boolean) => {
    setBusyId(bookingId);
    try {
      const { data, error } = await supabase.functions.invoke("auto-dispatch-booking", {
        body: { bookingId, sendOffers },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      if (sendOffers) {
        toast.success((data as any)?.noCleanersAvailable
          ? "Job created, but no eligible cleaners found — assign manually or retry."
          : `Job created and ${(data as any)?.offersSent ?? 0} offer(s) sent to cleaners.`);
      } else {
        toast.success("Job created and queued — approve it below when you're ready to send offers.");
      }
      await load(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Dispatch failed");
    } finally {
      setBusyId(null);
    }
  };

  const approveJob = async (jobId: string) => {
    setBusyId(jobId);
    try {
      const { data, error } = await supabase.functions.invoke("dispatch-job", {
        body: { jobId, approved: true },
      });
      if (error) throw error;
      const payload = (data as any) || {};
      if (payload.noCleanersAvailable) {
        toast.warning("No eligible cleaners found right now — try again shortly or assign manually from Bookings.");
      } else {
        toast.success(`Approved — ${payload.offersSent ?? 0} offer(s) sent to cleaners.`);
      }
      await load(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Approval failed");
    } finally {
      setBusyId(null);
    }
  };

  const reviewAddon = async (request: AddonRequest, action: "approve" | "reject", priceDollars?: number) => {
    setBusyId(request.id);
    try {
      const { data, error } = await supabase.functions.invoke("admin-review-addon-request", {
        body: { requestId: request.id, action, priceDollars },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      if (action === "approve") {
        const payload = data as any;
        toast.success(
          `Add-on approved — customer charge ${payload.chargeStatus}. Crew pay +${money(payload.perCleanerBumpCents)} each.`,
        );
      } else {
        toast.success("Add-on rejected — no charge made.");
      }
      await load(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Review failed");
    } finally {
      setBusyId(null);
    }
  };

  const updateSetting = async (key: keyof DispatchSettings, value: boolean) => {
    setSettingBusy(key);
    const prev = settings[key];
    setSettings((s) => ({ ...s, [key]: value }));
    try {
      const { error } = await (supabase.from as any)("app_settings")
        .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
      if (error) throw error;
      toast.success(
        key === "contractor_addons_enabled"
          ? value ? "Contractors can report add-ons again." : "Contractor add-on reporting disabled."
          : value ? "Auto-offers ON — new jobs will text cleaners without approval." : "Approval-first dispatch restored.",
      );
    } catch (err) {
      setSettings((s) => ({ ...s, [key]: prev }));
      toast.error(err instanceof Error ? err.message : "Couldn't save setting");
    } finally {
      setSettingBusy(null);
    }
  };

  // ─── Derived ─────────────────────────────────────────────────────────────
  const grouped = useMemo(() => {
    const map: Record<StageKey, DispatchJob[]> = {
      awaiting_approval: [], needs_attention: [], new: [], dispatching: [],
      offered: [], confirmed: [], in_progress: [], completed: [],
    };
    for (const j of jobs) map[stageForJob(j)].push(j);
    return map;
  }, [jobs]);

  const pendingAddons = useMemo(
    () => jobs.flatMap((j) => j.addon_requests.filter((r) => r.status === "pending").map((r) => ({ request: r, job: j }))),
    [jobs],
  );

  const stats = useMemo(() => ({
    approvals: grouped.awaiting_approval.length + grouped.needs_attention.length,
    needsDispatch: unassigned.length,
    offersOut: grouped.offered.length + grouped.dispatching.length,
    working: grouped.in_progress.length,
    addons: pendingAddons.length,
  }), [grouped, unassigned, pendingAddons]);

  return (
    <div className="space-y-6 font-sans">
      {/* ─── Command header ─────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(120% 140% at 0% 0%, rgba(92,15,254,0.10), transparent 55%)" }} />
        <div className="relative px-5 py-5 sm:px-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-jakarta text-2xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2.5">
              <span className="w-10 h-10 rounded-xl inline-flex items-center justify-center text-white shadow-[0_4px_12px_-2px_rgba(92,15,254,0.5)]" style={{ background: RAMP }}>
                <RiRocket2Line className="w-5 h-5" />
              </span>
              Dispatch
            </h1>
            <p className="text-sm text-slate-500 mt-1.5 max-w-xl">
              Approval-first staffing. New jobs wait here (and ping the dispatch channel) — cleaners are only
              texted when <span className="font-semibold text-slate-700">you</span> approve.
            </p>
          </div>
          <div className="flex flex-col items-start sm:items-end gap-3 w-full sm:w-auto">
            <div className="flex flex-wrap items-center gap-2">
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
              <Button isIconOnly variant="flat" aria-label="Refresh" onPress={() => void load()} isLoading={loading}>
                <RiRefreshLine className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-x-5 gap-y-2">
              <Switch
                size="sm"
                isSelected={settings.contractor_addons_enabled}
                isDisabled={settingBusy === "contractor_addons_enabled"}
                onValueChange={(v) => void updateSetting("contractor_addons_enabled", v)}
              >
                <span className="text-xs text-slate-600">Contractor add-ons</span>
              </Switch>
              <Tooltip content="OFF (recommended) = every job waits for your approval before cleaners are texted. ON = the old auto-ping behavior.">
                <div>
                  <Switch
                    size="sm"
                    isSelected={settings.dispatch_auto_offers_enabled}
                    isDisabled={settingBusy === "dispatch_auto_offers_enabled"}
                    onValueChange={(v) => void updateSetting("dispatch_auto_offers_enabled", v)}
                  >
                    <span className="text-xs text-slate-600">Auto-offers</span>
                  </Switch>
                </div>
              </Tooltip>
            </div>
          </div>
        </div>

        {/* Stat tiles */}
        <div className="relative grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 border-t border-slate-100 divide-x divide-slate-100">
          <StatTile label="Awaiting approval" value={stats.approvals} tone={stats.approvals > 0 ? "amber" : "slate"} icon={RiShieldCheckLine} />
          <StatTile label="Needs dispatch" value={stats.needsDispatch} tone={stats.needsDispatch > 0 ? "amber" : "slate"} icon={RiCalendarCheckLine} />
          <StatTile label="Offers out" value={stats.offersOut} tone="violet" icon={RiRocket2Line} />
          <StatTile label="Crews working" value={stats.working} tone="emerald" icon={RiTimeLine} />
          <StatTile label="Add-ons to review" value={stats.addons} tone={stats.addons > 0 ? "amber" : "slate"} icon={RiMoneyDollarCircleLine} />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-24">
          <Spinner color="primary" label="Loading dispatch board…" />
        </div>
      ) : (
        <>
          {/* ─── Needs dispatch (bookings without a job) ─────────────────── */}
          <section className="space-y-3">
            <SectionHeading
              icon={RiCalendarCheckLine}
              title="Needs dispatch"
              count={unassigned.length}
              tone="warning"
              hint="Confirmed bookings without a job yet — approve to send offers, or queue to decide later."
            />
            {unassigned.length === 0 ? (
              <EmptyRow text="Every confirmed booking has a job. Nothing waiting here." />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {unassigned.map((b) => (
                  <Card key={b.id} shadow="sm" className="border border-amber-200/70 bg-gradient-to-br from-amber-50/60 to-white">
                    <CardBody className="gap-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-sm text-slate-900 truncate">
                            {b.first_name} {b.last_name}
                            {b.booking_number ? <span className="text-slate-400 font-normal"> · NVC-{String(b.booking_number).padStart(4, "0")}</span> : null}
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
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          color="primary"
                          className="flex-1 min-w-[160px] font-semibold"
                          startContent={<RiRocket2Line className="w-4 h-4" />}
                          isLoading={busyId === b.id}
                          onPress={() => void dispatchBooking(b.id, true)}
                        >
                          Approve &amp; send offers
                        </Button>
                        <Tooltip content="Create the job without texting anyone — it'll sit in 'Awaiting your approval' below.">
                          <Button
                            size="sm"
                            variant="flat"
                            isDisabled={busyId === b.id}
                            onPress={() => void dispatchBooking(b.id, false)}
                          >
                            Queue
                          </Button>
                        </Tooltip>
                      </div>
                    </CardBody>
                  </Card>
                ))}
              </div>
            )}
          </section>

          {/* ─── Add-on approvals ─────────────────────────────────────────── */}
          {pendingAddons.length > 0 && (
            <section className="space-y-3">
              <SectionHeading
                icon={RiMoneyDollarCircleLine}
                title="Add-on approvals"
                count={pendingAddons.length}
                tone="warning"
                hint="Contractor-reported add-ons. Approving charges the customer and raises the crew's pay — nothing happens until you decide."
              />
              <div className="grid gap-3 lg:grid-cols-2">
                {pendingAddons.map(({ request, job }) => (
                  <AddonReviewCard
                    key={request.id}
                    request={request}
                    job={job}
                    busy={busyId === request.id}
                    onReview={(action, price) => void reviewAddon(request, action, price)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* ─── Pipeline by stage ────────────────────────────────────────── */}
          {STAGES.map((stage) => {
            const list = grouped[stage.key];
            if (!list || list.length === 0) return null;
            return (
              <section key={stage.key} className="space-y-3">
                <SectionHeading
                  icon={stage.key === "awaiting_approval" ? RiShieldCheckLine : RiRocket2Line}
                  title={stage.label}
                  count={list.length}
                  tone={stage.tone}
                  hint={stage.hint}
                />
                <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                  {list.map((job) => (
                    <div
                      key={job.id}
                      ref={job.id === highlightJobId ? highlightRef : undefined}
                    >
                      <JobCard
                        job={job}
                        stage={stage.key}
                        busy={busyId === job.id}
                        highlighted={job.id === highlightJobId}
                        onApprove={() => void approveJob(job.id)}
                      />
                    </div>
                  ))}
                </div>
              </section>
            );
          })}

          {jobs.length === 0 && unassigned.length === 0 && (
            <Card shadow="sm">
              <CardBody className="py-14 text-center text-slate-500">
                <RiCalendarCheckLine className="w-10 h-10 mx-auto mb-3 text-primary" />
                No dispatch jobs in this range.
              </CardBody>
            </Card>
          )}
        </>
      )}

      <FocusedChecklistEditor />
    </div>
  );
}

// ─── Building blocks ───────────────────────────────────────────────────────

function StatTile({
  label, value, tone, icon: Icon,
}: {
  label: string;
  value: number;
  tone: "amber" | "violet" | "emerald" | "slate";
  icon: typeof RiRocket2Line;
}) {
  const toneMap = {
    amber: "text-amber-600 bg-amber-500/10",
    violet: "text-[#5C0FFE] bg-[#5C0FFE]/10",
    emerald: "text-emerald-600 bg-emerald-500/10",
    slate: "text-slate-400 bg-slate-100",
  } as const;
  return (
    <div className="px-4 py-3.5 flex items-center gap-3 min-w-0">
      <span className={cn("w-9 h-9 rounded-lg inline-flex items-center justify-center shrink-0", toneMap[tone])}>
        <Icon className="w-5 h-5" />
      </span>
      <div className="min-w-0">
        <p className="font-jakarta text-xl font-extrabold leading-none text-slate-900 tabular-nums">{value}</p>
        <p className="text-[11px] text-slate-500 truncate mt-0.5">{label}</p>
      </div>
    </div>
  );
}

function SectionHeading({
  icon: Icon, title, count, tone, hint,
}: {
  icon: typeof RiRocket2Line;
  title: string;
  count: number;
  tone: "danger" | "warning" | "primary" | "success" | "default";
  hint?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Icon className="w-4 h-4 text-slate-400" />
      <h2 className="font-jakarta font-bold text-slate-900">{title}</h2>
      <Chip size="sm" variant="flat" color={tone}>{count}</Chip>
      {hint && <span className="text-xs text-slate-400">{hint}</span>}
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-4 text-sm text-slate-400">
      {text}
    </div>
  );
}

// ─── Add-on review card ───────────────────────────────────────────────────
function AddonReviewCard({
  request, job, busy, onReview,
}: {
  request: AddonRequest;
  job: DispatchJob;
  busy: boolean;
  onReview: (action: "approve" | "reject", priceDollars?: number) => void;
}) {
  const [price, setPrice] = useState(String((request.amount_cents / 100).toFixed(2)));
  const customer = job.booking
    ? `${job.booking.first_name || ""} ${job.booking.last_name || ""}`.trim()
    : "Customer";
  const ref = job.booking?.booking_number
    ? `NVC-${String(job.booking.booking_number).padStart(4, "0")}`
    : `Job ${job.id.slice(0, 8)}`;

  const parsedPrice = Number(price);
  const validPrice = Number.isFinite(parsedPrice) && parsedPrice >= 0;

  return (
    <Card shadow="sm" className="border border-amber-200/80">
      <CardBody className="gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-sm text-slate-900">
              {request.addon_label || request.addon_id}
              <span className="text-slate-400 font-normal"> · {ref} — {customer}</span>
            </p>
            <p className="text-xs text-slate-500">
              Reported by <span className="font-medium text-slate-700">{request.cleaner_name || "cleaner"}</span>
              {" · "}crew pay bump ≈ {money(request.cleaner_share_cents)}/cleaner if approved
            </p>
            {request.note && (
              <p className="text-xs text-slate-500 italic mt-1">"{request.note}"</p>
            )}
          </div>
          <Chip size="sm" variant="flat" color="warning" startContent={<RiTimeLine className="w-3 h-3" />}>
            pending
          </Chip>
        </div>
        <Divider />
        <div className="flex flex-wrap items-center gap-2">
          <Input
            size="sm"
            type="number"
            min={0}
            step="0.01"
            value={price}
            onValueChange={setPrice}
            startContent={<span className="text-xs text-slate-400">$</span>}
            className="w-28"
            aria-label="Charge amount"
          />
          <Button
            size="sm"
            color="success"
            className="text-white font-semibold"
            startContent={<RiCheckLine className="w-4 h-4" />}
            isLoading={busy}
            isDisabled={!validPrice}
            onPress={() => onReview("approve", validPrice ? parsedPrice : undefined)}
          >
            Approve &amp; charge
          </Button>
          <Button
            size="sm"
            variant="flat"
            color="danger"
            startContent={<RiCloseLine className="w-4 h-4" />}
            isDisabled={busy}
            onPress={() => onReview("reject")}
          >
            Reject
          </Button>
        </div>
        <p className="text-[11px] text-slate-400">
          Approve = charge the customer's card on file (or send a hosted invoice) and visibly raise the crew's pay.
        </p>
      </CardBody>
    </Card>
  );
}

// ─── Job card ──────────────────────────────────────────────────────────────
function JobCard({
  job, stage, busy, highlighted, onApprove,
}: {
  job: DispatchJob;
  stage: StageKey;
  busy: boolean;
  highlighted: boolean;
  onApprove: () => void;
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
  const checklist = job.checklist;
  const approvedAddons = job.addon_requests.filter((r) => r.status === "approved");
  const pendingAddonCount = job.addon_requests.filter((r) => r.status === "pending").length;
  const isApprovalStage = stage === "awaiting_approval" || stage === "new" || stage === "needs_attention";

  return (
    <Card
      shadow="sm"
      className={cn(
        "border h-full",
        highlighted ? "border-[#5C0FFE] ring-2 ring-[#5C0FFE]/30" : "border-slate-200",
        stage === "awaiting_approval" && !highlighted && "border-amber-300/80",
      )}
    >
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

        {job.dispatch_alert_reason && (stage === "awaiting_approval" || job.manual_intervention_required) && (
          <div className={cn(
            "rounded-lg px-2.5 py-1.5 text-xs flex items-start gap-1.5 border",
            stage === "awaiting_approval" ? "bg-amber-50 border-amber-200 text-amber-800" : "bg-rose-50 border-rose-200 text-rose-800",
          )}>
            <RiAlertLine className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            {job.dispatch_alert_reason}
          </div>
        )}

        {/* Crew */}
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
          <p className="text-xs text-slate-400">No cleaners offered yet — waiting on your approval.</p>
        )}

        {/* Live contractor checklist */}
        {checklist && (
          <div className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-slate-600 flex items-center gap-1">
                <RiFileList3Line className="w-3.5 h-3.5" />
                Contractor checklist
                {checklist.completed_at && (
                  <RiCheckboxCircleFill className="w-3.5 h-3.5 text-emerald-500" />
                )}
              </span>
              <span className={cn(
                "text-[11px] font-bold tabular-nums",
                checklist.progress_pct === 100 ? "text-emerald-600" : "text-slate-600",
              )}>
                {checklist.completed_items}/{checklist.total_items} · {checklist.progress_pct}%
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all", checklist.progress_pct === 100 ? "bg-emerald-500" : "bg-[#5C0FFE]")}
                style={{ width: `${checklist.progress_pct}%` }}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-400 truncate">
                {checklist.last_activity_by
                  ? `Last: ${checklist.last_activity_by}${checklist.last_activity_at ? ` · ${new Date(checklist.last_activity_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : ""}`
                  : "No activity yet"}
              </span>
              <a
                href={`${CONTRACTOR_BASE}/cleaner/job-checklist/${checklist.token}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] font-semibold text-[#5C0FFE] hover:underline inline-flex items-center gap-0.5"
              >
                View <RiExternalLinkLine className="w-3 h-3" />
              </a>
            </div>
          </div>
        )}

        {/* Add-on badges */}
        {(approvedAddons.length > 0 || pendingAddonCount > 0) && (
          <div className="flex flex-wrap gap-1.5">
            {approvedAddons.map((r) => (
              <Chip key={r.id} size="sm" variant="flat" color="success" startContent={<RiMoneyDollarCircleLine className="w-3 h-3" />}>
                {r.addon_label || r.addon_id} +{money(r.amount_cents)}
              </Chip>
            ))}
            {pendingAddonCount > 0 && (
              <Chip size="sm" variant="flat" color="warning">
                {pendingAddonCount} add-on{pendingAddonCount > 1 ? "s" : ""} awaiting review ↑
              </Chip>
            )}
          </div>
        )}

        <Divider />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-slate-400">
            {money(job.booking?.total_estimate_cents)} job
          </span>
          <Button
            size="sm"
            variant={isApprovalStage ? "solid" : "flat"}
            color="primary"
            className={isApprovalStage ? "font-semibold" : undefined}
            startContent={isApprovalStage ? <RiShieldCheckLine className="w-4 h-4" /> : <RiRocket2Line className="w-4 h-4" />}
            isLoading={busy}
            onPress={onApprove}
          >
            {isApprovalStage
              ? "Approve & send offers"
              : confirmedCount >= needed
                ? "Re-dispatch"
                : "Send more offers"}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
