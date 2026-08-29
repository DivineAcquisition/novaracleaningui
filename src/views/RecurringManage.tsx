"use client";

// ─── /manage-recurring/[token] — customer recurring-plan self-service ─────
//
// Tokenized page texted to recurring customers (no login — the URL token is
// the credential, same model as /photos). Lets the customer:
//   • see their plan, next visit, and the cadence-aware upcoming dates
//   • move the next visit's date/time (future visits ripple from it)
//   • change the arrival window
//   • skip the next visit
//   • change frequency (weekly / bi-weekly / monthly)
//   • pause / resume the plan
//   • request a different cleaner
//
// Every change relays to the internal ops Discord channel via
// manage-recurring-schedule, and moves any already-generated booking too.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { format } from "date-fns";
import {
  RiAlertLine,
  RiCalendarEventLine,
  RiCheckboxCircleFill,
  RiLoader4Line,
  RiPauseCircleLine,
  RiPlayCircleLine,
  RiRepeatLine,
  RiSkipForwardLine,
  RiSparklingLine,
  RiTimeLine,
  RiUserSearchLine,
} from "@remixicon/react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { SEO } from "@/components/SEO";
import { cn } from "@/lib/utils";

interface ManageState {
  ok: boolean;
  schedule: {
    first_name: string | null;
    cadence: string;
    service_type: string;
    add_ons: string[];
    preferred_time_slot: string | null;
    next_service_date: string | null;
    active: boolean;
    price_cents: number | null;
    membership_plan: string | null;
    address: string | null;
    city: string | null;
  };
  upcoming: { id: string; service_date: string; time_slot: string | null; status: string }[];
  preview: string[];
}

const TIME_SLOTS = [
  "8:00 AM - 9:00 AM", "9:00 AM - 10:00 AM", "10:00 AM - 11:00 AM", "11:00 AM - 12:00 PM",
  "12:00 PM - 1:00 PM", "1:00 PM - 2:00 PM", "2:00 PM - 3:00 PM", "3:00 PM - 4:00 PM",
  "4:00 PM - 5:00 PM", "5:00 PM - 6:00 PM",
];
const CADENCE_LABEL: Record<string, string> = {
  weekly: "Every week",
  biweekly: "Every 2 weeks",
  monthly: "Every month",
};
const fmtDay = (d?: string | null) => {
  if (!d) return "—";
  const dt = new Date(`${d}T12:00:00`);
  return Number.isNaN(dt.getTime()) ? d : format(dt, "EEEE, MMMM d");
};

export default function RecurringManagePage() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token || "");

  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<ManageState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Reschedule panel
  const [panel, setPanel] = useState<"none" | "date" | "cadence">("none");
  const [newDate, setNewDate] = useState("");
  const [newSlot, setNewSlot] = useState("");

  const call = useCallback(async (body: Record<string, unknown>) => {
    const { data, error: invokeError } = await supabase.functions.invoke("manage-recurring-schedule", {
      body: { token, ...body },
    });
    if (invokeError) throw invokeError;
    if ((data as { error?: string })?.error) throw new Error((data as { error?: string }).error);
    return data as ManageState;
  }, [token]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await call({});
      setState(s);
      setNewSlot(s.schedule.preferred_time_slot || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load your plan");
    } finally {
      setLoading(false);
    }
  }, [call]);

  useEffect(() => {
    if (token) void load();
  }, [token, load]);

  const act = async (key: string, body: Record<string, unknown>, successMsg: string) => {
    setBusy(key);
    try {
      const s = await call(body);
      setState(s);
      toast.success(successMsg);
      setPanel("none");
      setNewDate("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Change failed — text us and we'll fix it.");
    } finally {
      setBusy(null);
    }
  };

  // Cadence-aware ripple preview when picking a new date.
  const ripple = useMemo(() => {
    if (!newDate || !state) return [];
    const out: string[] = [];
    let d = new Date(`${newDate}T12:00:00`);
    for (let i = 0; i < 4; i++) {
      out.push(d.toISOString().slice(0, 10));
      const n = new Date(d);
      if (state.schedule.cadence === "weekly") n.setDate(n.getDate() + 7);
      else if (state.schedule.cadence === "monthly") n.setMonth(n.getMonth() + 1);
      else n.setDate(n.getDate() + 14);
      d = n;
    }
    return out;
  }, [newDate, state]);

  const minDate = useMemo(() => {
    const t = new Date();
    t.setDate(t.getDate() + 1);
    return t.toISOString().slice(0, 10);
  }, []);

  if (!token) return <Shell><ErrorCard title="Missing link" hint="This link looks broken — text us for a fresh one." /></Shell>;
  if (loading) {
    return (
      <Shell>
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-slate-500">
          <RiLoader4Line className="w-8 h-8 animate-spin text-violet-600" />
          <p className="text-sm">Loading your cleaning plan…</p>
        </div>
      </Shell>
    );
  }
  if (error || !state) {
    return <Shell><ErrorCard title="Couldn't open your plan" hint={error || "This link may have been replaced — text us for a fresh one."} /></Shell>;
  }

  const { schedule, upcoming, preview } = state;
  const firstName = schedule.first_name?.trim();

  return (
    <Shell>
      <SEO title="Manage your recurring clean" noindex />

      {/* Header */}
      <div className="rounded-2xl overflow-hidden border border-violet-200 bg-white shadow-sm">
        <div className="px-5 py-4" style={{ background: "linear-gradient(135deg,#5C0FFE 0%,#8F7BFD 100%)" }}>
          <p className="text-[11px] uppercase tracking-wider font-semibold text-white/70">
            Novara Cleaning · Your plan
          </p>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <RiSparklingLine className="w-5 h-5" />
            {firstName ? `${firstName}'s recurring clean` : "Your recurring clean"}
          </h1>
          <p className="text-sm text-white/80 mt-0.5 capitalize">
            {CADENCE_LABEL[schedule.cadence] || schedule.cadence} · {String(schedule.service_type || "standard").replace(/_/g, " ")} clean
            {schedule.price_cents ? ` · $${(schedule.price_cents / 100).toFixed(0)}/visit` : ""}
          </p>
        </div>

        {/* Next visit */}
        <div className="px-5 py-4">
          {!schedule.active ? (
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900 flex items-center gap-2">
              <RiPauseCircleLine className="w-5 h-5 shrink-0" />
              Your plan is paused — resume below whenever you're ready.
            </div>
          ) : (
            <div className="flex items-start gap-3">
              <span className="w-11 h-11 rounded-xl bg-violet-100 text-violet-700 flex items-center justify-center shrink-0">
                <RiCalendarEventLine className="w-6 h-6" />
              </span>
              <div>
                <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide">Next visit</p>
                <p className="font-bold text-slate-900">{fmtDay(schedule.next_service_date)}</p>
                <p className="text-sm text-slate-500">
                  {schedule.preferred_time_slot || "Arrival window TBD"}
                  {schedule.city ? ` · ${schedule.city}` : ""}
                </p>
              </div>
            </div>
          )}

          {/* Upcoming (cadence-aware) */}
          {schedule.active && preview.length > 1 && (
            <div className="mt-4">
              <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide mb-1.5">
                Following visits ({CADENCE_LABEL[schedule.cadence]?.toLowerCase() || schedule.cadence})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {preview.slice(1).map((d) => (
                  <span key={d} className="rounded-full bg-slate-100 text-slate-600 text-xs px-2.5 py-1">
                    {format(new Date(`${d}T12:00:00`), "EEE, MMM d")}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Actions ── */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm divide-y divide-slate-100">
        {/* Change date/time */}
        <div className="p-4">
          <button
            type="button"
            className="w-full flex items-center justify-between gap-2 text-left"
            onClick={() => setPanel(panel === "date" ? "none" : "date")}
          >
            <span className="flex items-center gap-2.5 font-semibold text-slate-900 text-sm">
              <RiCalendarEventLine className="w-5 h-5 text-violet-600" /> Change next visit's date / time
            </span>
            <span className="text-slate-400 text-xs">{panel === "date" ? "Close" : "Open"}</span>
          </button>
          {panel === "date" && (
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="date"
                  min={minDate}
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  className="h-11 rounded-lg border border-slate-200 px-3 text-sm w-full focus:outline-none focus:ring-2 focus:ring-violet-300"
                />
                <select
                  value={newSlot}
                  onChange={(e) => setNewSlot(e.target.value)}
                  className="h-11 rounded-lg border border-slate-200 px-3 text-sm w-full bg-white focus:outline-none focus:ring-2 focus:ring-violet-300"
                >
                  <option value="">Keep current window</option>
                  {TIME_SLOTS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              {ripple.length > 0 && (
                <div className="rounded-lg bg-violet-50 border border-violet-100 px-3 py-2 text-xs text-violet-800">
                  <p className="font-semibold mb-1">Your {CADENCE_LABEL[schedule.cadence]?.toLowerCase() || schedule.cadence} plan would continue:</p>
                  <p>{ripple.map((d) => format(new Date(`${d}T12:00:00`), "MMM d")).join("  →  ")} …</p>
                </div>
              )}
              <Button
                className="w-full h-11"
                disabled={!newDate || busy === "set_next"}
                onClick={() => void act(
                  "set_next",
                  { action: "set_next", date: newDate, timeSlot: newSlot || undefined },
                  "Next visit moved — future visits follow from the new date.",
                )}
              >
                {busy === "set_next" ? <RiLoader4Line className="w-4 h-4 animate-spin mr-2" /> : null}
                Confirm new date
              </Button>
            </div>
          )}
        </div>

        {/* Change window only */}
        <ActionRow
          icon={RiTimeLine}
          label="Change arrival window"
          hint={schedule.preferred_time_slot || "No window set"}
        >
          <div className="flex flex-col sm:flex-row gap-2">
            <select
              value={newSlot}
              onChange={(e) => setNewSlot(e.target.value)}
              className="h-11 rounded-lg border border-slate-200 px-3 text-sm flex-1 bg-white focus:outline-none focus:ring-2 focus:ring-violet-300"
            >
              <option value="">Pick a window…</option>
              {TIME_SLOTS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <Button
              className="h-11"
              disabled={!newSlot || busy === "set_time"}
              onClick={() => void act("set_time", { action: "set_time", timeSlot: newSlot }, "Arrival window updated.")}
            >
              {busy === "set_time" ? <RiLoader4Line className="w-4 h-4 animate-spin" /> : "Save"}
            </Button>
          </div>
        </ActionRow>

        {/* Skip next */}
        {schedule.active && schedule.next_service_date && (
          <div className="p-4 flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2.5 font-semibold text-slate-900 text-sm">
              <RiSkipForwardLine className="w-5 h-5 text-violet-600" /> Skip the {format(new Date(`${schedule.next_service_date}T12:00:00`), "MMM d")} visit
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={busy === "skip_next"}
              onClick={() => {
                if (confirm("Skip your next visit? Your plan continues on the following date.")) {
                  void act("skip_next", { action: "skip_next" }, "Visit skipped — see your updated next date above.");
                }
              }}
            >
              {busy === "skip_next" ? <RiLoader4Line className="w-4 h-4 animate-spin" /> : "Skip once"}
            </Button>
          </div>
        )}

        {/* Frequency */}
        <div className="p-4">
          <button
            type="button"
            className="w-full flex items-center justify-between gap-2 text-left"
            onClick={() => setPanel(panel === "cadence" ? "none" : "cadence")}
          >
            <span className="flex items-center gap-2.5 font-semibold text-slate-900 text-sm">
              <RiRepeatLine className="w-5 h-5 text-violet-600" /> Change frequency
            </span>
            <span className="text-xs text-slate-400">{CADENCE_LABEL[schedule.cadence] || schedule.cadence}</span>
          </button>
          {panel === "cadence" && (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
              {(["weekly", "biweekly", "monthly"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  disabled={busy === "set_cadence"}
                  onClick={() => void act("set_cadence", { action: "set_cadence", cadence: c }, `Frequency changed to ${CADENCE_LABEL[c].toLowerCase()}.`)}
                  className={cn(
                    "rounded-lg border px-3 py-2.5 text-sm font-medium transition-all",
                    schedule.cadence === c
                      ? "border-violet-500 bg-violet-50 text-violet-800 ring-2 ring-violet-200"
                      : "border-slate-200 bg-white text-slate-700 hover:border-violet-300",
                  )}
                >
                  {CADENCE_LABEL[c]}
                  {schedule.cadence === c && <RiCheckboxCircleFill className="w-4 h-4 inline ml-1.5 text-violet-600" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Different cleaner */}
        <div className="p-4 flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2.5 font-semibold text-slate-900 text-sm">
            <RiUserSearchLine className="w-5 h-5 text-violet-600" /> Request a different cleaner
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={busy === "request_new_cleaner"}
            onClick={() => {
              if (confirm("Ask our team to assign you a new regular cleaner?")) {
                void act("request_new_cleaner", { action: "request_new_cleaner" }, "Got it — our team will assign a new regular cleaner.");
              }
            }}
          >
            {busy === "request_new_cleaner" ? <RiLoader4Line className="w-4 h-4 animate-spin" /> : "Request"}
          </Button>
        </div>

        {/* Pause / resume */}
        <div className="p-4 flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2.5 font-semibold text-slate-900 text-sm">
            {schedule.active
              ? <><RiPauseCircleLine className="w-5 h-5 text-violet-600" /> Pause my plan</>
              : <><RiPlayCircleLine className="w-5 h-5 text-emerald-600" /> Resume my plan</>}
          </span>
          <Button
            variant={schedule.active ? "outline" : "default"}
            size="sm"
            disabled={busy === "pause" || busy === "resume"}
            onClick={() => {
              const action = schedule.active ? "pause" : "resume";
              if (action === "resume" || confirm("Pause your recurring plan? No visits will be scheduled until you resume.")) {
                void act(action, { action }, action === "pause" ? "Plan paused — resume anytime." : "Welcome back! Your plan is active again.");
              }
            }}
          >
            {(busy === "pause" || busy === "resume") ? <RiLoader4Line className="w-4 h-4 animate-spin" /> : schedule.active ? "Pause" : "Resume"}
          </Button>
        </div>
      </div>

      {/* Already-booked upcoming visits */}
      {upcoming.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
          <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide mb-2">Booked visits</p>
          <ul className="space-y-1.5">
            {upcoming.map((b) => (
              <li key={b.id} className="flex items-center justify-between text-sm">
                <span className="text-slate-800">{fmtDay(b.service_date)}{b.time_slot ? ` · ${b.time_slot}` : ""}</span>
                <span className={cn(
                  "text-xs rounded-full px-2 py-0.5 capitalize",
                  b.status === "cancelled" ? "bg-slate-100 text-slate-500" : "bg-emerald-50 text-emerald-700",
                )}>
                  {b.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-center text-slate-400 pb-8">
        Need something else? Just reply to our text or email hello@novaracleaning.com.
      </p>
    </Shell>
  );
}

function ActionRow({
  icon: Icon, label, hint, children,
}: {
  icon: typeof RiTimeLine;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="p-4">
      <button
        type="button"
        className="w-full flex items-center justify-between gap-2 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex items-center gap-2.5 font-semibold text-slate-900 text-sm">
          <Icon className="w-5 h-5 text-violet-600" /> {label}
        </span>
        <span className="text-xs text-slate-400">{open ? "Close" : hint || "Open"}</span>
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-xl mx-auto px-4 py-5 space-y-4">{children}</div>
    </div>
  );
}

function ErrorCard({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-rose-200 bg-white shadow-sm px-6 py-10 text-center mt-16">
      <RiAlertLine className="w-10 h-10 text-rose-500 mx-auto mb-3" />
      <h1 className="font-bold text-slate-900 text-lg">{title}</h1>
      <p className="text-sm text-slate-500 mt-1">{hint}</p>
    </div>
  );
}
