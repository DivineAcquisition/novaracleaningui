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
  RiCameraLine,
  RiCheckboxCircleFill,
  RiCheckLine,
  RiHourglassLine,
  RiLoader4Line,
  RiMapPinLine,
  RiMoneyDollarCircleLine,
  RiProhibitedLine,
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
  areaId?: string;
  instance?: number;
}
interface ItemState {
  done?: boolean;
  skipped?: boolean;
  skipReason?: string;
  at?: string;
  by?: string;
}
interface SectionMeta {
  before?: string[];
  after?: string[];
  conditions_note?: string | null;
  conditions_photos?: string[];
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
    focused_areas?: Array<{ areaId: string; quantity: number; label?: string }>;
  } | null;
  cleaner: { id: string; first_name: string | null } | null;
  checklist: {
    name: string;
    sections: ChecklistSection[];
    items: Record<string, ItemState>;
    total_items: number;
    completed_items: number;
    progress_pct: number;
    completed_at: string | null;
    section_meta?: Record<string, SectionMeta>;
  };
  focused?: {
    enabled: boolean;
    areas_label?: string;
    scope_boundary?: string;
    areas_progress?: Array<{
      title: string;
      areaId: string | null;
      tasksDone: boolean;
      photosDone: boolean;
      complete: boolean;
    }>;
    photos_complete?: boolean;
    missing_photo_sections?: number[];
  };
  addons: {
    enabled: boolean;
    sharePct: number;
    teamSize: number;
    catalog: AddonCatalogEntry[];
    requests: AddonRequest[];
  };
}

const PHOTO_BUCKET = "cleaner-job-photos";

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
  const [skipKey, setSkipKey] = useState<string | null>(null);
  const [skipReason, setSkipReason] = useState("");
  const [scopeOpen, setScopeOpen] = useState(false);
  const [scopeNote, setScopeNote] = useState("");
  const [scopeSending, setScopeSending] = useState(false);
  const [conditionsFor, setConditionsFor] = useState<number | null>(null);
  const [conditionsNote, setConditionsNote] = useState("");
  const [photoBusy, setPhotoBusy] = useState<string | null>(null);

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
    try {
      setState(await call({ action: "toggle", itemKey, done }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save — check your connection");
      await load();
    } finally {
      setBusyKey(null);
    }
  };

  const skipItem = async () => {
    if (!skipKey || skipReason.trim().length < 3) return;
    setBusyKey(skipKey);
    try {
      setState(await call({ action: "skip", itemKey: skipKey, reason: skipReason.trim() }));
      toast.success("Skipped — reason saved for QC");
      setSkipKey(null);
      setSkipReason("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't skip item");
    } finally {
      setBusyKey(null);
    }
  };

  const finish = async () => {
    setFinishing(true);
    try {
      setState(await call({ action: "complete" }));
      toast.success("Checklist complete — the office has been notified.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't finish checklist");
    } finally {
      setFinishing(false);
    }
  };

  const uploadSectionPhoto = async (sectionIndex: number, kind: "before" | "after", files: FileList | null) => {
    if (!files?.length || !state) return;
    const busy = `${sectionIndex}:${kind}`;
    setPhotoBusy(busy);
    try {
      const meta = state.checklist.section_meta || {};
      const current = meta[String(sectionIndex)] || {};
      const existing = [...(kind === "before" ? current.before || [] : current.after || [])];
      for (const file of Array.from(files)) {
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        const path = `focused/${state.job.id}/s${sectionIndex}-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
        const { error: upErr } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, {
          contentType: file.type || "image/jpeg",
          upsert: false,
        });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path);
        if (pub?.publicUrl) existing.push(pub.publicUrl);
      }
      const before = kind === "before" ? existing : (current.before || []);
      const after = kind === "after" ? existing : (current.after || []);
      setState(await call({ action: "save_section_photos", sectionIndex, before, after }));
      toast.success(`${kind === "before" ? "Before" : "After"} photo saved for this area`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Photo upload failed");
    } finally {
      setPhotoBusy(null);
    }
  };

  const submitConditions = async () => {
    if (conditionsFor == null || conditionsNote.trim().length < 3) return;
    setBusyKey(`cond-${conditionsFor}`);
    try {
      setState(await call({
        action: "conditions_found",
        sectionIndex: conditionsFor,
        note: conditionsNote.trim(),
      }));
      toast.success("Conditions note sent to QC / dispatch");
      setConditionsFor(null);
      setConditionsNote("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save conditions note");
    } finally {
      setBusyKey(null);
    }
  };

  const requestScopeAddition = async () => {
    if (scopeNote.trim().length < 3) return;
    setScopeSending(true);
    try {
      setState(await call({ action: "request_scope_addition", note: scopeNote.trim() }));
      toast.success("Office notified — they'll price the extra work. Don't start it yet.");
      setScopeOpen(false);
      setScopeNote("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't reach the office");
    } finally {
      setScopeSending(false);
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
  const isFocused = Boolean(state?.focused?.enabled);
  const allDone = state
    ? state.checklist.completed_items >= state.checklist.total_items
      && state.checklist.total_items > 0
      && (!isFocused || Boolean(state.focused?.photos_complete))
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

      {/* ─── Focused scope boundary ──────────────────────────────────── */}
      {isFocused && state.focused?.scope_boundary && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 space-y-3">
          <p className="text-sm font-semibold text-amber-950">
            Scope: <span className="font-bold">{state.focused.areas_label || "selected areas"}</span> only.
            If the customer asks for work outside these areas, don&apos;t start it — contact the office so it can be added and priced.
          </p>
          {state.focused.areas_progress && state.focused.areas_progress.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {state.focused.areas_progress.map((a) => (
                <span
                  key={a.title}
                  className={cn(
                    "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold",
                    a.complete ? "bg-emerald-600 text-white" : "bg-white border border-amber-200 text-amber-900",
                  )}
                >
                  {a.title}: {a.complete ? "complete" : a.tasksDone ? "photos needed" : "in progress"}
                </span>
              ))}
            </div>
          )}
          {state.canWrite && (
            !scopeOpen ? (
              <Button variant="outline" className="w-full border-amber-400 text-amber-950 bg-white" onClick={() => setScopeOpen(true)}>
                Request scope addition
              </Button>
            ) : (
              <div className="space-y-2">
                <textarea
                  value={scopeNote}
                  onChange={(e) => setScopeNote(e.target.value)}
                  rows={2}
                  placeholder="What extra area/work did the customer ask for?"
                  className="w-full rounded-lg border border-amber-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-300"
                />
                <div className="flex gap-2">
                  <Button className="flex-1" disabled={scopeNote.trim().length < 3 || scopeSending} onClick={() => void requestScopeAddition()}>
                    {scopeSending ? <RiLoader4Line className="w-4 h-4 animate-spin mr-1.5" /> : null}
                    Notify office to price it
                  </Button>
                  <Button variant="ghost" onClick={() => { setScopeOpen(false); setScopeNote(""); }}>Cancel</Button>
                </div>
              </div>
            )
          )}
        </div>
      )}

      {/* ─── Checklist sections ──────────────────────────────────────── */}
      {checklist.sections.map((section, sIdx) => {
        const sectionDone = section.items.every((_, iIdx) => {
          const e = checklist.items[`${sIdx}:${iIdx}`];
          return Boolean(e?.done || (e?.skipped && e?.skipReason));
        });
        const meta = checklist.section_meta?.[String(sIdx)] || {};
        const beforeCount = meta.before?.length || 0;
        const afterCount = meta.after?.length || 0;
        return (
          <div key={`${section.title}-${sIdx}`} className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-bold text-slate-900">{section.title}</h2>
              {sectionDone && (
                <span className="text-xs font-semibold text-emerald-600 flex items-center gap-1">
                  <RiCheckboxCircleFill className="w-4 h-4" /> Tasks done
                </span>
              )}
            </div>
            <ul className="divide-y divide-slate-100">
              {section.items.map((item, iIdx) => {
                const key = `${sIdx}:${iIdx}`;
                const entry = checklist.items[key];
                const skipped = Boolean(entry?.skipped && entry?.skipReason);
                const done = Boolean(entry?.done) || skipped;
                return (
                  <li key={key} className={cn(done ? "bg-emerald-50/50" : "")}>
                    <div className="flex items-start gap-3 px-5 py-3">
                      <button
                        type="button"
                        disabled={!state.canWrite || busyKey === key}
                        onClick={() => void toggleItem(key, !done)}
                        className="mt-0.5 shrink-0"
                        aria-label={done ? "Uncheck" : "Check off"}
                      >
                        <span
                          className={cn(
                            "w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all",
                            skipped ? "bg-amber-500 border-amber-500" : done ? "bg-emerald-500 border-emerald-500" : "border-slate-300 bg-white",
                          )}
                        >
                          {busyKey === key
                            ? <RiLoader4Line className="w-3 h-3 animate-spin text-slate-400" />
                            : skipped
                              ? <RiProhibitedLine className="w-3.5 h-3.5 text-white" />
                              : done && <RiCheckLine className="w-3.5 h-3.5 text-white" />}
                        </span>
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className={cn("text-sm", done && !skipped ? "text-slate-400 line-through" : "text-slate-800")}>
                          {item}
                        </p>
                        {skipped && (
                          <p className="text-[11px] text-amber-800 mt-0.5">Skipped: {entry?.skipReason}</p>
                        )}
                        {done && entry?.by && entry.by !== "You" && (
                          <span className="block text-[11px] text-slate-400">by {entry.by}</span>
                        )}
                        {state.canWrite && !done && (
                          <button
                            type="button"
                            className="mt-1 text-[11px] font-semibold text-slate-500 underline"
                            onClick={() => { setSkipKey(key); setSkipReason(""); }}
                          >
                            Skip with reason
                          </button>
                        )}
                      </div>
                    </div>
                    {skipKey === key && (
                      <div className="px-5 pb-3 space-y-2">
                        <textarea
                          value={skipReason}
                          onChange={(e) => setSkipReason(e.target.value)}
                          rows={2}
                          placeholder='Why? e.g. "shower door removed" or "customer asked us not to touch"'
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
                        />
                        <div className="flex gap-2">
                          <Button size="sm" disabled={skipReason.trim().length < 3 || busyKey === key} onClick={() => void skipItem()}>
                            Save skip
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setSkipKey(null)}>Cancel</Button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            {isFocused && (
              <div className="px-5 py-4 border-t border-slate-100 space-y-3 bg-slate-50/60">
                <p className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <RiCameraLine className="w-4 h-4 text-violet-600" />
                  Before &amp; after photos required for this area
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <label className="rounded-xl border border-dashed border-slate-300 bg-white px-3 py-3 text-center text-xs cursor-pointer hover:border-violet-400">
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      disabled={!state.canWrite || photoBusy === `${sIdx}:before`}
                      onChange={(e) => void uploadSectionPhoto(sIdx, "before", e.target.files)}
                    />
                    {photoBusy === `${sIdx}:before`
                      ? <RiLoader4Line className="w-4 h-4 animate-spin mx-auto mb-1" />
                      : <RiCameraLine className="w-4 h-4 mx-auto mb-1 text-violet-600" />}
                    Before ({beforeCount})
                  </label>
                  <label className="rounded-xl border border-dashed border-slate-300 bg-white px-3 py-3 text-center text-xs cursor-pointer hover:border-violet-400">
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      disabled={!state.canWrite || photoBusy === `${sIdx}:after`}
                      onChange={(e) => void uploadSectionPhoto(sIdx, "after", e.target.files)}
                    />
                    {photoBusy === `${sIdx}:after`
                      ? <RiLoader4Line className="w-4 h-4 animate-spin mx-auto mb-1" />
                      : <RiCameraLine className="w-4 h-4 mx-auto mb-1 text-violet-600" />}
                    After ({afterCount})
                  </label>
                </div>
                {state.canWrite && (
                  conditionsFor === sIdx ? (
                    <div className="space-y-2">
                      <textarea
                        value={conditionsNote}
                        onChange={(e) => setConditionsNote(e.target.value)}
                        rows={2}
                        placeholder="Heavy buildup, mold, damage, out of scope — describe it. Stop and report biohazard/mold — do not attempt that work."
                        className="w-full rounded-lg border border-rose-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300"
                      />
                      <div className="flex gap-2">
                        <Button size="sm" className="bg-rose-600 hover:bg-rose-700" disabled={conditionsNote.trim().length < 3 || busyKey === `cond-${sIdx}`} onClick={() => void submitConditions()}>
                          Send conditions to QC
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => { setConditionsFor(null); setConditionsNote(""); }}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="text-[11px] font-semibold text-rose-700 underline"
                      onClick={() => { setConditionsFor(sIdx); setConditionsNote(meta.conditions_note || ""); }}
                    >
                      {meta.conditions_note ? "Update conditions-found note" : "Add conditions-found note"}
                    </button>
                  )
                )}
                {meta.conditions_note && conditionsFor !== sIdx && (
                  <p className="text-[11px] text-rose-800 rounded-lg bg-rose-50 border border-rose-100 px-3 py-2">
                    Conditions noted: {meta.conditions_note}
                  </p>
                )}
              </div>
            )}
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
          {allDone
            ? "Finish checklist — notify the office"
            : isFocused
              ? "Finish every task (or skip with reason) + area photos"
              : `Complete all ${checklist.total_items} tasks to finish`}
        </Button>
      )}
      {checklist.completed_at && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-center">
          <RiCheckboxCircleFill className="w-8 h-8 text-emerald-500 mx-auto mb-1" />
          <p className="font-bold text-emerald-800">Checklist complete</p>
          <p className="text-xs text-emerald-700 mt-0.5">
            The office has been notified. Mark the job complete in your dashboard when you&apos;re done on site.
          </p>
        </div>
      )}

      <p className="text-xs text-center text-slate-400 pb-8">
        {isFocused
          ? "Focused clean — only the areas above. Extra work goes through the office."
          : "Questions on-site? Text dispatch — do not leave until every line is checked."}
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
