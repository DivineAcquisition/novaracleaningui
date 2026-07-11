"use client";

// ─── Contractor job checklist (token-protected) ─────────────────────────
//
// The dedicated per-job checklist page sent to contractors for each type
// of clean:
//   https://contractor.novaracleaning.com/cleaner/job-checklist/<token>
//
// The token is the cleaner's assignment response_token (same credential
// model as the job-offer and job-photos pages — no login needed on-site).
// Progress is shared with the whole crew and relays LIVE to the admin
// Dispatch console. Contractors can also report add-ons they performed;
// those wait for admin approval in the Dispatch console before the
// customer is charged and the cleaner's pay visibly increases.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  RiAddLine,
  RiAlertLine,
  RiCheckboxCircleFill,
  RiCheckLine,
  RiHourglassLine,
  RiLoader4Line,
  RiMapPinLine,
  RiMoneyDollarCircleLine,
  RiSparklingLine,
  RiTimeLine,
} from "@remixicon/react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { SEO } from "@/components/SEO";
import { cn } from "@/lib/utils";

// ─── Types (mirror cleaner-job-checklist edge fn payload) ────────────────
interface ChecklistSection {
  title: string;
  items: string[];
}
interface AddonCatalogEntry {
  id: string;
  label: string;
  price: number;
  note: string;
  included: boolean;
}
interface AddonRequest {
  id: string;
  addon_id: string;
  addon_label: string | null;
  amount_cents: number;
  cleaner_share_cents: number;
  note: string | null;
  status: "pending" | "approved" | "rejected";
  cleaner_name: string | null;
  charge_status: string | null;
}
interface ChecklistState {
  ok: boolean;
  canWrite: boolean;
  job: {
    id: string;
    service_type: string;
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    start_datetime: string | null;
    duration_est_hours: number | null;
    status: string | null;
  };
  booking: {
    ref: string;
    first_name: string | null;
    service_date: string | null;
    time_slot: string | null;
    access_notes: string | null;
    add_ons: string[];
  } | null;
  cleaner: { id: string; first_name: string | null } | null;
  checklist: {
    name: string;
    sections: ChecklistSection[];
    items: Record<string, { done: boolean; at: string; by: string }>;
    total_items: number;
    completed_items: number;
    progress_pct: number;
    completed_at: string | null;
  };
  addons: {
    enabled: boolean;
    sharePct: number;
    teamSize: number;
    catalog: AddonCatalogEntry[];
    requests: AddonRequest[];
  };
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const fmtDate = (d?: string | null) => {
  if (!d) return null;
  const dt = new Date(`${d}T12:00:00`);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
};
const fmtWindow = (slot?: string | null) => {
  if (!slot) return null;
  const map: Record<string, string> = {
    "8-12": "8:00 AM – 12:00 PM",
    "12-16": "12:00 PM – 4:00 PM",
    "16-20": "4:00 PM – 8:00 PM",
  };
  return map[slot] || slot;
};

export default function CleanerJobChecklistPage() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token || "");

  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<ChecklistState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [addonNote, setAddonNote] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedAddon, setSelectedAddon] = useState<string | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueText, setIssueText] = useState("");
  const [issueSending, setIssueSending] = useState(false);

  const call = useCallback(
    async (body: Record<string, unknown>) => {
      const { data, error: invokeError } = await supabase.functions.invoke("cleaner-job-checklist", {
        body: { token, ...body },
      });
      if (invokeError) throw invokeError;
      if ((data as { ok?: boolean; error?: string })?.ok === false) {
        throw new Error((data as { error?: string })?.error || "Request failed");
      }
      return data as ChecklistState;
    },
    [token],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setState(await call({}));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load this checklist");
    } finally {
      setLoading(false);
    }
  }, [call]);

  useEffect(() => {
    if (token) void load();
  }, [token, load]);

  const toggleItem = async (itemKey: string, done: boolean) => {
    if (!state?.canWrite) return;
    setBusyKey(itemKey);
    // Optimistic flip
    setState((prev) => {
      if (!prev) return prev;
      const items = { ...prev.checklist.items };
      if (done) items[itemKey] = { done: true, at: new Date().toISOString(), by: "You" };
      else delete items[itemKey];
      const completed = Object.keys(items).length;
      return {
        ...prev,
        checklist: {
          ...prev.checklist,
          items,
          completed_items: completed,
          progress_pct: prev.checklist.total_items
            ? Math.round((completed / prev.checklist.total_items) * 100)
            : 0,
        },
      };
    });
    try {
      setState(await call({ action: "toggle", itemKey, done }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save — check your connection");
      await load();
    } finally {
      setBusyKey(null);
    }
  };

  const finish = async () => {
    setFinishing(true);
    try {
      setState(await call({ action: "complete" }));
      toast.success("Checklist complete — the office has been notified. Don't forget your before/after photos!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't finish checklist");
    } finally {
      setFinishing(false);
    }
  };

  const requestAddon = async () => {
    if (!selectedAddon) return;
    setBusyKey(`addon-${selectedAddon}`);
    try {
      setState(await call({ action: "request_addon", addonId: selectedAddon, note: addonNote || undefined }));
      toast.success("Add-on sent to the office for approval. Your pay updates once it's approved.");
      setSelectedAddon(null);
      setAddonNote("");
      setPickerOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't submit add-on");
    } finally {
      setBusyKey(null);
    }
  };

  const sendFieldReport = async () => {
    const description = issueText.trim();
    if (!description) return;
    setIssueSending(true);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("qc-issues", {
        body: { action: "field_report", token, description },
      });
      if (invokeError) throw invokeError;
      if ((data as { ok?: boolean; error?: string })?.ok === false) {
        throw new Error((data as { error?: string })?.error || "Couldn't send report");
      }
      toast.success("Report sent — dispatch has been alerted. Stay put unless it's unsafe.");
      setIssueOpen(false);
      setIssueText("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send report — call dispatch instead");
    } finally {
      setIssueSending(false);
    }
  };

  const progress = state?.checklist.progress_pct ?? 0;
  const allDone = state
    ? state.checklist.completed_items >= state.checklist.total_items && state.checklist.total_items > 0
    : false;

  const requestedIds = useMemo(
    () => new Set((state?.addons.requests || []).filter((r) => r.status !== "rejected").map((r) => r.addon_id)),
    [state],
  );
  const availableAddons = useMemo(
    () => (state?.addons.catalog || []).filter((a) => !a.included && !requestedIds.has(a.id)),
    [state, requestedIds],
  );
  const approvedBumpCents = useMemo(
    () => (state?.addons.requests || [])
      .filter((r) => r.status === "approved")
      .reduce((s, r) => s + Number(r.cleaner_share_cents || 0), 0),
    [state],
  );

  if (!token) return <Shell><ErrorCard title="Missing link token" hint="This link looks broken. Ask dispatch to resend it." /></Shell>;

  if (loading) {
    return (
      <Shell>
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-slate-500">
          <RiLoader4Line className="w-8 h-8 animate-spin text-violet-600" />
          <p className="text-sm">Loading your job checklist…</p>
        </div>
      </Shell>
    );
  }
  if (error || !state) {
    return <Shell><ErrorCard title="Couldn't open this checklist" hint={error || "The link may be invalid or expired."} /></Shell>;
  }

  const { job, booking, checklist, addons } = state;

  return (
    <Shell>
      <SEO title={`${checklist.name} checklist`} noindex />

      {/* ─── Job header ──────────────────────────────────────────────── */}
      <div className="rounded-2xl overflow-hidden border border-violet-200 bg-white shadow-sm">
        <div
          className="px-5 py-4"
          style={{ background: "linear-gradient(135deg,#5C0FFE 0%,#8F7BFD 100%)" }}
        >
          <p className="text-[11px] uppercase tracking-wider font-semibold text-white/70">
            Novara · Contractor checklist{booking ? ` · ${booking.ref}` : ""}
          </p>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <RiSparklingLine className="w-5 h-5" /> {checklist.name}
          </h1>
          {state.cleaner?.first_name && (
            <p className="text-sm text-white/80 mt-0.5">
              Hi {state.cleaner.first_name} — work through every line as you clean.
            </p>
          )}
        </div>
        <div className="px-5 py-4 space-y-2 text-sm text-slate-700">
          {(fmtDate(booking?.service_date) || job.start_datetime) && (
            <p className="flex items-center gap-2">
              <RiTimeLine className="w-4 h-4 text-violet-600 shrink-0" />
              {fmtDate(booking?.service_date) ||
                new Date(job.start_datetime as string).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
              {fmtWindow(booking?.time_slot) ? ` · ${fmtWindow(booking?.time_slot)}` : ""}
              {job.duration_est_hours ? ` · ~${job.duration_est_hours}h` : ""}
            </p>
          )}
          {job.address && (
            <p className="flex items-center gap-2">
              <RiMapPinLine className="w-4 h-4 text-violet-600 shrink-0" />
              {job.address}, {job.city} {job.zip}
            </p>
          )}
          {booking?.first_name && (
            <p className="text-slate-500">Customer: {booking.first_name}</p>
          )}
          {booking?.access_notes && (
            <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-amber-900 text-xs">
              <strong>Access notes:</strong> {booking.access_notes}
            </p>
          )}
          {booking && booking.add_ons.length > 0 && (
            <p className="text-xs text-slate-500">
              Booked add-ons to complete: {booking.add_ons.join(", ")}
            </p>
          )}
        </div>

        {/* Progress bar */}
        <div className="px-5 pb-4">
          <div className="flex items-center justify-between text-xs font-semibold mb-1.5">
            <span className={cn(progress === 100 ? "text-emerald-600" : "text-violet-700")}>
              {checklist.completed_items}/{checklist.total_items} tasks · {progress}%
            </span>
            {checklist.completed_at && (
              <span className="text-emerald-600 flex items-center gap-1">
                <RiCheckboxCircleFill className="w-4 h-4" /> Completed
              </span>
            )}
          </div>
          <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all duration-500", progress === 100 ? "bg-emerald-500" : "bg-violet-600")}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      {!state.canWrite && (
        <div className="rounded-xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-600 flex items-center gap-2">
          <RiAlertLine className="w-4 h-4 shrink-0" /> View-only preview — progress can only be updated from a cleaner's own link.
        </div>
      )}

      {/* ─── Checklist sections ──────────────────────────────────────── */}
      {checklist.sections.map((section, sIdx) => {
        const sectionDone = section.items.every((_, iIdx) => checklist.items[`${sIdx}:${iIdx}`]?.done);
        return (
          <div key={section.title} className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-bold text-slate-900">{section.title}</h2>
              {sectionDone && (
                <span className="text-xs font-semibold text-emerald-600 flex items-center gap-1">
                  <RiCheckboxCircleFill className="w-4 h-4" /> Done
                </span>
              )}
            </div>
            <ul className="divide-y divide-slate-100">
              {section.items.map((item, iIdx) => {
                const key = `${sIdx}:${iIdx}`;
                const entry = checklist.items[key];
                const done = !!entry?.done;
                return (
                  <li key={key}>
                    <button
                      type="button"
                      disabled={!state.canWrite || busyKey === key}
                      onClick={() => void toggleItem(key, !done)}
                      className={cn(
                        "w-full flex items-start gap-3 px-5 py-3 text-left transition-colors",
                        done ? "bg-emerald-50/50" : "hover:bg-slate-50",
                        !state.canWrite && "cursor-default",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all",
                          done ? "bg-emerald-500 border-emerald-500" : "border-slate-300 bg-white",
                        )}
                      >
                        {busyKey === key
                          ? <RiLoader4Line className="w-3 h-3 animate-spin text-slate-400" />
                          : done && <RiCheckLine className="w-3.5 h-3.5 text-white" />}
                      </span>
                      <span className="min-w-0">
                        <span className={cn("text-sm", done ? "text-slate-400 line-through" : "text-slate-800")}>
                          {item}
                        </span>
                        {done && entry?.by && entry.by !== "You" && (
                          <span className="block text-[11px] text-slate-400">by {entry.by}</span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      {/* ─── Add-ons ─────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100">
          <h2 className="font-bold text-slate-900 flex items-center gap-2">
            <RiMoneyDollarCircleLine className="w-5 h-5 text-violet-600" /> Add-ons you performed
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Did extra work on-site? Report it here. The office reviews every add-on — once approved, the
            customer is charged and <strong>your pay for this job goes up</strong>.
          </p>
        </div>
        <div className="px-5 py-4 space-y-3">
          {approvedBumpCents > 0 && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800 font-semibold flex items-center gap-2">
              <RiCheckboxCircleFill className="w-5 h-5 shrink-0" />
              Approved add-ons so far: +{money(approvedBumpCents)} added to your pay
            </div>
          )}

          {(addons.requests || []).map((r) => (
            <div
              key={r.id}
              className={cn(
                "rounded-xl border px-4 py-3 flex items-start justify-between gap-3",
                r.status === "approved" && "border-emerald-200 bg-emerald-50/60",
                r.status === "pending" && "border-amber-200 bg-amber-50/60",
                r.status === "rejected" && "border-slate-200 bg-slate-50 opacity-70",
              )}
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">
                  {r.addon_label || r.addon_id} · {money(r.amount_cents)}
                </p>
                <p className="text-xs text-slate-500">
                  {r.status === "pending" && "Waiting for office approval"}
                  {r.status === "approved" && `Approved — +${money(r.cleaner_share_cents)} to your pay`}
                  {r.status === "rejected" && "Not approved"}
                  {r.cleaner_name ? ` · reported by ${r.cleaner_name}` : ""}
                </p>
                {r.note && <p className="text-xs text-slate-400 mt-0.5">"{r.note}"</p>}
              </div>
              <span
                className={cn(
                  "shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold",
                  r.status === "approved" && "bg-emerald-500 text-white",
                  r.status === "pending" && "bg-amber-400 text-amber-950",
                  r.status === "rejected" && "bg-slate-300 text-slate-700",
                )}
              >
                {r.status === "pending" && <RiHourglassLine className="w-3 h-3" />}
                {r.status === "approved" && <RiCheckLine className="w-3 h-3" />}
                {r.status}
              </span>
            </div>
          ))}

          {!addons.enabled ? (
            <p className="text-sm text-slate-500 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              Add-on reporting is currently turned off. Call or text dispatch if you did extra work on-site.
            </p>
          ) : !state.canWrite ? null : !pickerOpen ? (
            <Button variant="outline" className="w-full border-dashed" onClick={() => setPickerOpen(true)}>
              <RiAddLine className="w-4 h-4 mr-1.5" /> Report an add-on I did
            </Button>
          ) : (
            <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-4 space-y-3">
              <p className="text-sm font-semibold text-slate-900">Which add-on did you complete?</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {availableAddons.map((a) => {
                  const shareCents = Math.floor((a.price * 100 * addons.sharePct) / 100 / Math.max(1, addons.teamSize));
                  const selected = selectedAddon === a.id;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setSelectedAddon(selected ? null : a.id)}
                      className={cn(
                        "rounded-lg border px-3 py-2 text-left transition-all",
                        selected ? "border-violet-500 bg-white ring-2 ring-violet-200" : "border-slate-200 bg-white hover:border-violet-300",
                      )}
                    >
                      <p className="text-sm font-semibold text-slate-900">{a.label} · ${a.price}</p>
                      <p className="text-[11px] text-emerald-700 font-medium">≈ +{money(shareCents)} to your pay if approved</p>
                      {a.note && <p className="text-[11px] text-slate-400">{a.note}</p>}
                    </button>
                  );
                })}
                {availableAddons.length === 0 && (
                  <p className="text-sm text-slate-500 col-span-full">Every add-on is either already booked or already reported.</p>
                )}
              </div>
              <textarea
                value={addonNote}
                onChange={(e) => setAddonNote(e.target.value)}
                placeholder="Optional note for the office (what/why)…"
                rows={2}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
              />
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  disabled={!selectedAddon || busyKey === `addon-${selectedAddon}`}
                  onClick={() => void requestAddon()}
                >
                  {busyKey === `addon-${selectedAddon}` ? (
                    <RiLoader4Line className="w-4 h-4 animate-spin mr-1.5" />
                  ) : (
                    <RiAddLine className="w-4 h-4 mr-1.5" />
                  )}
                  Submit for approval
                </Button>
                <Button variant="ghost" onClick={() => { setPickerOpen(false); setSelectedAddon(null); }}>
                  Cancel
                </Button>
              </div>
              <p className="text-[11px] text-slate-500">
                Nothing is charged to the customer until the office approves it in dispatch.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ─── Field issue report (stop-and-flag SOP) ─────────────────── */}
      {state.canWrite && (
        <div className="rounded-2xl border border-rose-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-4">
            <h2 className="font-bold text-slate-900 flex items-center gap-2">
              <RiAlertLine className="w-4 h-4 text-rose-500" /> Problem on site?
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Biohazard conditions, damage, access issues, anything unsafe or wrong — flag it here the
              moment you hit it. Dispatch is alerted immediately.
            </p>
            {!issueOpen ? (
              <Button variant="outline" className="w-full mt-3 border-rose-300 text-rose-600 hover:bg-rose-50" onClick={() => setIssueOpen(true)}>
                <RiAlertLine className="w-4 h-4 mr-1.5" /> Report an issue to dispatch
              </Button>
            ) : (
              <div className="mt-3 space-y-2.5">
                <textarea
                  placeholder="What's wrong? Be specific — dispatch acts on exactly what you write here."
                  value={issueText}
                  onChange={(e) => setIssueText(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300"
                />
                <div className="flex gap-2">
                  <Button
                    className="flex-1 bg-rose-600 hover:bg-rose-700"
                    disabled={!issueText.trim() || issueSending}
                    onClick={() => void sendFieldReport()}
                  >
                    {issueSending
                      ? <RiLoader4Line className="w-4 h-4 animate-spin mr-1.5" />
                      : <RiAlertLine className="w-4 h-4 mr-1.5" />}
                    Send to dispatch now
                  </Button>
                  <Button variant="ghost" onClick={() => { setIssueOpen(false); setIssueText(""); }}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Finish ──────────────────────────────────────────────────── */}
      {state.canWrite && !checklist.completed_at && (
        <Button
          className="w-full h-12 text-base"
          disabled={!allDone || finishing}
          onClick={() => void finish()}
        >
          {finishing
            ? <RiLoader4Line className="w-5 h-5 animate-spin mr-2" />
            : <RiCheckboxCircleFill className="w-5 h-5 mr-2" />}
          {allDone ? "Finish checklist — notify the office" : `Complete all ${checklist.total_items} tasks to finish`}
        </Button>
      )}
      {checklist.completed_at && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-center">
          <RiCheckboxCircleFill className="w-8 h-8 text-emerald-500 mx-auto mb-1" />
          <p className="font-bold text-emerald-800">Checklist complete</p>
          <p className="text-xs text-emerald-700 mt-0.5">
            The office has been notified. Remember to upload your before &amp; after photos and mark the job complete in your dashboard.
          </p>
        </div>
      )}

      <p className="text-xs text-center text-slate-400 pb-8">
        Questions on-site? Text dispatch — do not leave until every line is checked.
      </p>
    </Shell>
  );
}

// ─── Shells ────────────────────────────────────────────────────────────────
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">{children}</div>
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
