"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import imageCompression from "browser-image-compression";
import {
  RiCameraLine,
  RiCheckLine,
  RiCheckboxCircleFill,
  RiLoader4Line,
  RiMapPinLine,
  RiProhibitedLine,
  RiShieldCheckLine,
  RiSparklingLine,
  RiVideoLine,
} from "@remixicon/react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { SEO } from "@/components/SEO";
import { MediaThumb } from "@/components/job-media/MediaThumb";
import { isVideoFile, videoTooLargeMessage } from "@/lib/job-media";
import { ChecklistField } from "@/components/proposals/ChecklistField";
import type { ChecklistItem, PropertyTypeDef } from "@/lib/proposal-request";
import {
  SCOPE_PROGRESS_ANSWER_KEY,
  itemIsComplete,
  parseScopeProgress,
  scopeProgressKey,
  scopeProgressStats,
  type ScopeChecklistSection,
  type ScopeItemState,
} from "@/lib/proposal-scope-checklists";
import { cn } from "@/lib/utils";

const BUCKET = "cleaner-job-photos";

async function prepareForUpload(file: File): Promise<{ blob: Blob; ext: string; contentType: string }> {
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

interface FormPayload {
  submitted: boolean;
  preview?: boolean;
  expired?: boolean;
  staffAccess?: boolean;
  editable?: boolean;
  status: string;
  walkthroughId: string;
  propertyType: PropertyTypeDef;
  checklist: {
    universal: ChecklistItem[];
    typeSpecific: ChecklistItem[];
    all: ChecklistItem[];
    scope?: ScopeChecklistSection[];
    scopeTemplate?: string;
  };
  answers: Record<string, unknown>;
  photos: string[];
  scheduledAt: string | null;
  site: { nickname: string; address: string; clientStatedSqft: number | null };
  access: { name: string | null; phone: string | null };
  account: { name: string; contact: string } | null;
  cleaner: { name: string } | null;
}

async function walkthroughFetch(token: string, init: RequestInit = {}): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const access = data.session?.access_token;
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body) headers.set("Content-Type", "application/json");
  if (access) headers.set("Authorization", `Bearer ${access}`);
  return fetch(`/api/walkthrough/${token}`, { ...init, headers });
}

export default function WalkthroughIntakeForm({ staff = false }: { staff?: boolean }) {
  const params = useParams<{ token: string }>();
  const token = String(params?.token || "");
  const [info, setInfo] = useState<FormPayload | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [photos, setPhotos] = useState<string[]>([]);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<"conducted" | "excluded" | null>(null);
  const [skipKey, setSkipKey] = useState<string | null>(null);
  const [skipReason, setSkipReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await walkthroughFetch(token);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) throw new Error(data?.error || "Link not valid");
      setInfo(data as FormPayload);
      setAnswers(data.answers || {});
      setPhotos(Array.isArray(data.photos) ? data.photos : []);
      if (data.submitted) setDone(data.status === "excluded" ? "excluded" : "conducted");
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "Could not open this walkthrough");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const persist = useCallback(async (nextAnswers: Record<string, unknown>, nextPhotos: string[]) => {
    setSaveState("saving");
    try {
      const res = await walkthroughFetch(token, {
        method: "PATCH",
        body: JSON.stringify({ answers: nextAnswers, photos: nextPhotos }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Save failed");
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 1500);
    } catch {
      setSaveState("error");
    }
  }, [token]);

  const setAnswer = (key: string, value: unknown) => {
    setAnswers((prev) => {
      const next = { ...prev, [key]: value };
      void persist(next, photos);
      return next;
    });
  };

  const scopeProgress = parseScopeProgress(answers[SCOPE_PROGRESS_ANSWER_KEY]);

  const setScopeProgress = (next: Record<string, ScopeItemState>) => {
    setAnswer(SCOPE_PROGRESS_ANSWER_KEY, next);
  };

  const toggleScopeItem = (key: string, done: boolean) => {
    const next = { ...scopeProgress };
    if (done) next[key] = { done: true };
    else delete next[key];
    setSkipKey(null);
    setScopeProgress(next);
  };

  const skipScopeItem = () => {
    if (!skipKey || skipReason.trim().length < 3) return;
    setScopeProgress({
      ...scopeProgress,
      [skipKey]: { skipped: true, skipReason: skipReason.trim() },
    });
    setSkipKey(null);
    setSkipReason("");
  };

  const upload = async (files: FileList | null) => {
    if (!files?.length || !info) return;
    setUploading(true);
    try {
      const added: string[] = [];
      for (const file of Array.from(files).slice(0, 12)) {
        const tooBig = videoTooLargeMessage(file);
        if (tooBig) { toast.error(tooBig); continue; }
        const prepared = await prepareForUpload(file);
        const key = `walkthroughs/${info.walkthroughId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${prepared.ext}`;
        const { error } = await supabase.storage.from(BUCKET).upload(key, prepared.blob, {
          cacheControl: "3600",
          contentType: prepared.contentType,
          upsert: false,
        });
        if (error) throw error;
        added.push(supabase.storage.from(BUCKET).getPublicUrl(key).data.publicUrl);
      }
      const next = [...photos, ...added];
      setPhotos(next);
      setAnswers((a) => ({ ...a, photos: next }));
      await persist({ ...answers, photos: next }, next);
      toast.success(`${added.length} file${added.length === 1 ? "" : "s"} added.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (!info) return;
    setSubmitting(true);
    try {
      const res = await walkthroughFetch(token, {
        method: "POST",
        body: JSON.stringify({ answers: { ...answers, photos }, photos }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Submit failed");
      setDone(data.excluded ? "excluded" : "conducted");
      setInfo((prev) => prev ? { ...prev, submitted: true, status: data.status || prev.status } : prev);
      toast.success(
        data.excluded
          ? "Exclusion recorded — pricing stopped."
          : data.appended
            ? "Additions saved on the same document. PDF refreshed."
            : "Walkthrough submitted. You can still add photos or notes on this document.",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-500 text-sm">
        <RiLoader4Line className="w-4 h-4 animate-spin mr-2" /> Opening walkthrough…
      </div>
    );
  }
  if (loadErr || !info) {
    return (
      <div className={cn("flex items-center justify-center p-6", staff ? "py-16" : "min-h-screen bg-slate-50")}>
        <div className="max-w-md text-center space-y-2">
          <p className="font-bold text-slate-900">This link isn't valid</p>
          <p className="text-sm text-slate-500">{loadErr || "Ask dispatch to resend the walkthrough assignment."}</p>
        </div>
      </div>
    );
  }

  const universal = info.checklist.universal.filter((i) => i.kind !== "media");
  const typeItems = info.checklist.typeSpecific;
  const inPipeline = Boolean(done || info.submitted);
  const liveScope = info.checklist.scope || [];
  const liveProgress = parseScopeProgress(answers[SCOPE_PROGRESS_ANSWER_KEY]);
  const liveStats = scopeProgressStats(liveScope, liveProgress);

  return (
    <div className={cn(staff ? "pb-16" : "min-h-screen bg-slate-50 pb-24")}>
      <SEO title={`${info.propertyType.shortLabel} walkthrough`} />
      {!staff && (
        <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200">
          <div className="max-w-xl mx-auto px-4 h-14 flex items-center justify-between">
            <img src="/novara-logo.png" alt="Novara Cleaning" className="h-7" />
            <span className="text-[11px] font-semibold text-slate-500">
              {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved ✓" : saveState === "error" ? "Save failed" : "Auto-saves"}
            </span>
          </div>
        </header>
      )}

      <main className="max-w-xl mx-auto px-4 py-4 space-y-4">
        {staff && (
          <div className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-900">
            Office copy of the tokenized onsite document. The walkthrough agent uses this same checklist — additions you make land here too.
            <span className="block mt-1 text-violet-700/80">
              {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved ✓" : "Auto-saves as you go"}
            </span>
          </div>
        )}

        <div className="rounded-2xl overflow-hidden border border-violet-200 bg-white shadow-sm">
          <div className="px-5 py-4" style={{ background: "linear-gradient(135deg,#5C0FFE 0%,#8F7BFD 100%)" }}>
            <p className="text-[11px] uppercase tracking-wider font-semibold text-white/70">
              Novara · Walkthrough checklist · {info.propertyType.shortLabel}
            </p>
            <h1 className="text-xl font-bold text-white flex items-center gap-2 mt-0.5">
              <RiSparklingLine className="w-5 h-5" /> {info.site.nickname}
            </h1>
            <p className="text-xs text-white/85 flex items-start gap-1 mt-1">
              <RiMapPinLine className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              {info.site.address}
            </p>
            {info.site.clientStatedSqft ? (
              <p className="text-[11px] text-white/70 mt-2">Client stated {Number(info.site.clientStatedSqft).toLocaleString()} sq ft — confirm on site.</p>
            ) : null}
            {info.access?.name && (
              <p className="text-[11px] text-white/70 mt-1">Access: {info.access.name}{info.access.phone ? ` · ${info.access.phone}` : ""}</p>
            )}
          </div>
          {liveStats.total > 0 && (
            <div className="px-5 py-4">
              <div className="flex items-center justify-between text-xs font-semibold mb-1.5">
                <span className={cn(liveStats.pct === 100 ? "text-emerald-600" : "text-violet-700")}>
                  {liveStats.completed}/{liveStats.total} tasks · {liveStats.pct}%
                </span>
                {liveStats.pct === 100 && (
                  <span className="text-emerald-600 flex items-center gap-1">
                    <RiCheckboxCircleFill className="w-4 h-4" /> Scope walked
                  </span>
                )}
              </div>
              <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all duration-500", liveStats.pct === 100 ? "bg-emerald-500" : "bg-violet-600")}
                  style={{ width: `${liveStats.pct}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {info.preview && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            Preview only — ticks save in this browser session against the API fixture, not a live assignment.
          </div>
        )}

        {inPipeline && (
          <div className={cn(
            "rounded-xl border px-3 py-2 text-sm flex items-start gap-2",
            done === "excluded" ? "border-rose-200 bg-rose-50 text-rose-900" : "border-emerald-200 bg-emerald-50 text-emerald-900",
          )}>
            {done === "excluded" ? <RiShieldCheckLine className="w-4 h-4 mt-0.5 shrink-0" /> : <RiCheckLine className="w-4 h-4 mt-0.5 shrink-0" />}
            <p>
              {done === "excluded"
                ? "Exclusion is recorded and pricing is stopped. You can still add photos or notes on this document."
                : "Findings are in the pipeline. Same document — add photos, notes, or checklist detail without re-entering."}
            </p>
          </div>
        )}

        {liveScope.map((section, sIdx) => {
          const sectionDone = section.items.every((_, iIdx) => itemIsComplete(liveProgress[scopeProgressKey(sIdx, iIdx)]));
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
                  const key = scopeProgressKey(sIdx, iIdx);
                  const entry = liveProgress[key];
                  const skipped = Boolean(entry?.skipped && entry?.skipReason);
                  const doneItem = Boolean(entry?.done) || skipped;
                  return (
                    <li key={key} className={cn(doneItem ? "bg-emerald-50/50" : "")}>
                      <div className="flex items-start gap-3 px-5 py-3">
                        <button
                          type="button"
                          onClick={() => toggleScopeItem(key, !doneItem)}
                          className="mt-0.5 shrink-0"
                          aria-label={doneItem ? "Uncheck" : "Check off"}
                        >
                          <span
                            className={cn(
                              "w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all",
                              skipped ? "bg-amber-500 border-amber-500" : doneItem ? "bg-emerald-500 border-emerald-500" : "border-slate-300 bg-white",
                            )}
                          >
                            {skipped
                              ? <RiProhibitedLine className="w-3.5 h-3.5 text-white" />
                              : doneItem && <RiCheckLine className="w-3.5 h-3.5 text-white" />}
                          </span>
                        </button>
                        <div className="min-w-0 flex-1">
                          <p className={cn("text-sm", doneItem && !skipped ? "text-slate-400 line-through" : "text-slate-800")}>
                            {item}
                          </p>
                          {skipped && (
                            <p className="text-[11px] text-amber-800 mt-0.5">Skipped: {entry?.skipReason}</p>
                          )}
                          {!doneItem && (
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
                            placeholder='Why? e.g. "no kitchen on this floor" or "client asked us not to enter"'
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
                          />
                          <div className="flex gap-2">
                            <Button size="sm" disabled={skipReason.trim().length < 3} onClick={skipScopeItem}>
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
            </div>
          );
        })}

        <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
          <h2 className="text-sm font-bold text-slate-900">Site findings</h2>
          <p className="text-[11px] text-slate-500">These numbers set the firm price. Confirm them after you walk the scope above.</p>
          {universal.map((item) => (
            <ChecklistField key={item.key} item={item} value={answers[item.key]} onChange={(v) => setAnswer(item.key, v)} compact />
          ))}
        </section>

        {typeItems.length > 0 && (
          <section className="rounded-2xl border border-violet-200 bg-white p-4 space-y-3">
            <h2 className="text-sm font-bold text-violet-900">{info.propertyType.shortLabel} findings</h2>
            <p className="text-[11px] text-slate-500">Only this property type — not a generic form.</p>
            {typeItems.map((item) => (
              <ChecklistField key={item.key} item={item} value={answers[item.key]} onChange={(v) => setAnswer(item.key, v)} compact />
            ))}
          </section>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
            <RiCameraLine className="w-4 h-4" /> Photos + video
          </h2>
          <p className="text-[11px] text-slate-500">Condition photos and a short clip. Uploads to this site's dated Drive folder on submit.</p>
          <div className="flex flex-wrap gap-2">
            {photos.map((url) => (
              <MediaThumb key={url} url={url} className="w-20 h-20 rounded-lg overflow-hidden" />
            ))}
          </div>
          <label className="inline-flex items-center gap-2 text-sm font-medium text-violet-700 cursor-pointer">
            <input type="file" accept="image/*,video/*" multiple className="hidden" disabled={uploading}
              onChange={(e) => void upload(e.target.files)} />
            {uploading ? <RiLoader4Line className="w-4 h-4 animate-spin" /> : <RiVideoLine className="w-4 h-4" />}
            Add photos or video
          </label>
        </section>

        <Button className="w-full h-11" disabled={submitting} onClick={() => void submit()}>
          {submitting ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiCheckLine className="w-4 h-4 mr-1.5" />}
          {inPipeline ? "Save additions" : "Submit walkthrough"}
        </Button>
        <p className="text-[11px] text-slate-400 text-center">
          If you find mold past threshold, active infestation, biohazard, or a structural hazard, mark it on the exclusion check. That stops pricing.
        </p>
      </main>
    </div>
  );
}
