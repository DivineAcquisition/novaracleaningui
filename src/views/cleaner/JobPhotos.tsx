"use client";

// ─── /cleaner/job-photos/[token] — public photo-upload form ───────────────
//
// Cleaner-facing page reached via the SMS that complete-booking fires
// when a job is marked completed. No login required — the URL carries
// a single-use token that resolves to a specific booking via the
// `get-cleaner-photo-form` edge function. Uploads land in the public
// Storage bucket `cleaner-job-photos` and the URLs are appended to
// bookings.before_photos / after_photos via `submit-cleaner-photos`.
//
// Designed mobile-first — cleaners almost always tap the link from a
// phone in the field.

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import imageCompression from "browser-image-compression";
import {
  RiCameraLine,
  RiCheckLine,
  RiCloseCircleLine,
  RiImageAddLine,
  RiLoader4Line,
  RiSparklingLine,
} from "@remixicon/react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface BookingInfo {
  bookingId: string;
  bookingNumber: number | null;
  serviceDate: string | null;
  timeSlot: string | null;
  customerFirstName: string | null;
  addressLine: string | null;
  cleanerFirstName: string | null;
  status: string | null;
  beforeCount: number;
  afterCount: number;
  /** Full saved photo URLs (older deployed fn versions may omit these). */
  beforePhotos?: string[];
  afterPhotos?: string[];
  alreadySubmitted: boolean;
}

const BUCKET = "cleaner-job-photos";

// Shrink large phone photos before upload so they actually go through on a
// flaky cellular connection in the field. Always falls back to the original
// file if compression fails (e.g. an exotic HEIC the browser can't decode) so
// it can never block an upload.
async function prepareForUpload(
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

export default function CleanerJobPhotosPage() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token || "");

  // Phase comes from the link the cleaner taps: ?phase=before (sent before the
  // job) or ?phase=after (sent after completion). No phase → show both
  // sections (legacy / single-link behavior). Read from the URL directly to
  // avoid a Suspense boundary requirement on useSearchParams.
  const [phase, setPhase] = useState<"before" | "after" | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search).get("phase");
    setPhase(p === "before" || p === "after" ? p : null);
  }, []);
  const showBefore = phase !== "after";
  const showAfter = phase !== "before";

  const [info, setInfo] = useState<BookingInfo | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [beforeUrls, setBeforeUrls] = useState<string[]>([]);
  const [afterUrls, setAfterUrls] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [uploadingKind, setUploadingKind] = useState<"before" | "after" | null>(null);
  // Escape hatch: even when a phase looks "done", let the cleaner add more
  // photos. Prevents the "already submitted" screen from ever locking someone
  // out (the historical bug where a stray/before submission blocked the rest).
  const [forceForm, setForceForm] = useState(false);
  // Auto-save status for the "Saved ✓ / Saving…" pill. Every upload and
  // removal is persisted to the booking immediately, so closing the page
  // never loses photos — reopening the link restores everything.
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const { data, error } = await supabase.functions.invoke("get-cleaner-photo-form", {
        body: { token },
      });
      if (error) throw error;
      const d = data as { ok?: boolean; reason?: string } & BookingInfo;
      if (!d?.ok) {
        setLoadErr(d?.reason || "Link no longer valid.");
        return;
      }
      setInfo(d);
      // Restore previously saved/submitted photos so the cleaner picks up
      // exactly where they left off (and removals can be managed).
      if (Array.isArray(d.beforePhotos)) setBeforeUrls(d.beforePhotos);
      if (Array.isArray(d.afterPhotos)) setAfterUrls(d.afterPhotos);
    } catch (err) {
      setLoadErr((err as Error).message || "Couldn't load this job");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) void load();
  }, [token, load]);

  // Persist the current photo set to the booking WITHOUT submitting —
  // no customer notification, no "submitted" stamp. Fired after every
  // successful upload batch and every removal.
  const saveProgress = useCallback(
    async (before: string[], after: string[]) => {
      setSaveState("saving");
      try {
        const { data, error } = await supabase.functions.invoke("submit-cleaner-photos", {
          body: { token, mode: "save", beforeUrls: before, afterUrls: after },
        });
        const d = data as { ok?: boolean } | null;
        if (error || !d?.ok) throw error || new Error("save failed");
        setSaveState("saved");
      } catch {
        // Non-blocking: photos are still in Storage and in local state; the
        // final Submit merges everything anyway.
        setSaveState("error");
      }
    },
    [token],
  );

  const handleFiles = async (
    kind: "before" | "after",
    files: FileList | null,
  ) => {
    if (!files || files.length === 0 || !info) return;
    setUploadingKind(kind);
    const added: string[] = [];
    try {
      for (const file of Array.from(files)) {
        const { blob, ext, contentType } = await prepareForUpload(file);
        const key = `bookings/${info.bookingId}/${kind}/${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}.${ext}`;
        const { error } = await supabase.storage.from(BUCKET).upload(key, blob, {
          cacheControl: "3600",
          contentType,
          upsert: false,
        });
        if (error) throw error;
        const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(key);
        added.push(pub.publicUrl);
      }
      const nextBefore = kind === "before" ? [...beforeUrls, ...added] : beforeUrls;
      const nextAfter = kind === "after" ? [...afterUrls, ...added] : afterUrls;
      setBeforeUrls(nextBefore);
      setAfterUrls(nextAfter);
      toast.success(`Added ${added.length} ${kind} photo${added.length === 1 ? "" : "s"}`);
      void saveProgress(nextBefore, nextAfter);
    } catch (err) {
      toast.error("Upload failed: " + (err as Error).message);
    } finally {
      setUploadingKind(null);
    }
  };

  const removeUrl = (kind: "before" | "after", url: string) => {
    const nextBefore = kind === "before" ? beforeUrls.filter((x) => x !== url) : beforeUrls;
    const nextAfter = kind === "after" ? afterUrls.filter((x) => x !== url) : afterUrls;
    setBeforeUrls(nextBefore);
    setAfterUrls(nextAfter);
    void saveProgress(nextBefore, nextAfter);
  };

  const submit = async () => {
    const relevant = phase === "before" ? beforeUrls : phase === "after" ? afterUrls : [...beforeUrls, ...afterUrls];
    if (relevant.length === 0) {
      toast.error(`Add at least one ${phase || ""} photo first.`.replace("  ", " "));
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("submit-cleaner-photos", {
        body: { token, beforeUrls, afterUrls, notes: notes.trim() || undefined },
      });
      if (error) throw error;
      const d = data as { ok?: boolean; reason?: string };
      if (!d?.ok) throw new Error(d?.reason || "Submit failed");
      setSubmitted(true);
      toast.success("Photos submitted. Thanks!");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 max-w-md mx-auto space-y-4">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    );
  }

  if (loadErr || !info) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 max-w-md mx-auto">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-900">
          <p className="font-semibold">This photo-upload link isn't valid anymore.</p>
          <p className="text-xs mt-1">
            If you still need to submit photos for a completed job, text your
            dispatcher and they'll send you a fresh link.
          </p>
        </div>
      </div>
    );
  }

  // Whether this phase is already done — driven by ACTUAL stored photo counts,
  // never by a single "submitted" flag. A before-photos submission (or a stray
  // legacy submission) must never lock the cleaner out of the other phase:
  //   • before link → done only when before photos exist
  //   • after link  → done only when after photos exist
  //   • combined link (no phase) → done only when BOTH exist
  // ...and even then, "Add more photos" re-opens the form so nobody is ever
  // hard-blocked.
  const alreadyDoneForPhase =
    phase === "before"
      ? info.beforeCount > 0
      : phase === "after"
        ? info.afterCount > 0
        : info.beforeCount > 0 && info.afterCount > 0;

  if (!submitted && alreadyDoneForPhase && !forceForm) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 max-w-md mx-auto">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-600 text-white mb-3">
            <RiCheckLine className="w-6 h-6" />
          </div>
          <p className="font-semibold text-emerald-900">
            {phase === "before" ? "Before photos are in." : phase === "after" ? "After photos are in." : "Photos are in."}
          </p>
          <p className="text-xs text-emerald-800 mt-1">
            {phase === "before"
              ? "You're all set to start the clean. You'll get a link for after photos once the job is marked complete."
              : "Your payout should appear in your Stripe payouts within 1–2 business days."}
          </p>
          <Button
            variant="outline"
            className="mt-4 border-emerald-300 text-emerald-800"
            onClick={() => setForceForm(true)}
          >
            <RiCameraLine className="w-4 h-4 mr-1.5" /> Add more photos
          </Button>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 max-w-md mx-auto">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-600 text-white mb-3">
            <RiCheckLine className="w-6 h-6" />
          </div>
          <p className="font-semibold text-emerald-900">
            {phase === "before" ? "Before photos submitted." : phase === "after" ? "After photos submitted." : "Photos submitted."}
          </p>
          <p className="text-xs text-emerald-800 mt-1">
            {phase === "before"
              ? "You're all set to start the clean. You'll get a link for after photos once the job is marked complete."
              : "Thanks! Your payout should appear in your Stripe payouts within 1–2 business days."}
          </p>
          <Button
            variant="outline"
            className="mt-4 border-emerald-300 text-emerald-800"
            onClick={() => {
              setSubmitted(false);
              setForceForm(true);
            }}
          >
            <RiCameraLine className="w-4 h-4 mr-1.5" /> Add more photos
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-32">
      <div className="max-w-md mx-auto p-4 space-y-4">
        <header className="rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-500 p-5 text-white shadow-md">
          <div className="flex items-center gap-2">
            <RiSparklingLine className="w-5 h-5" />
            <p className="text-sm font-semibold">
              Hi {info.cleanerFirstName || "team"} —{" "}
              {phase === "before"
                ? "drop your BEFORE photos"
                : phase === "after"
                  ? "drop your AFTER photos"
                  : "drop your photos"}
            </p>
          </div>
          {phase && (
            <p className="mt-1 text-[11px] text-emerald-50/90">
              {phase === "before"
                ? "Snap a few before shots when you arrive, before you start cleaning."
                : "Snap the after shots now that the clean is done — these go to the customer."}
            </p>
          )}
          <p className="mt-2 text-xs text-emerald-50 leading-snug">
            Job NOV-{String(info.bookingNumber || 0).padStart(5, "0")} ·{" "}
            {info.customerFirstName || "Customer"} · {info.serviceDate}{" "}
            {info.timeSlot && `· ${info.timeSlot}`}
            {info.addressLine && <span className="block">{info.addressLine}</span>}
          </p>
          <div className="mt-2 flex items-center gap-1.5">
            {saveState === "saving" ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-medium">
                <RiLoader4Line className="w-3 h-3 animate-spin" /> Saving…
              </span>
            ) : saveState === "saved" ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-medium">
                <RiCheckLine className="w-3 h-3" /> Progress saved
              </span>
            ) : saveState === "error" ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/30 px-2 py-0.5 text-[10px] font-medium">
                Save pending — photos kept, will save on submit
              </span>
            ) : (
              <span className="text-[10px] text-emerald-50/80">
                Photos auto-save — you can close this page and come back to add more.
              </span>
            )}
          </div>
        </header>

        {showBefore && (
          <PhotoGroup
            title="Before photos"
            urls={beforeUrls}
            uploading={uploadingKind === "before"}
            onAdd={(files) => handleFiles("before", files)}
            onRemove={(u) => removeUrl("before", u)}
          />
        )}
        {showAfter && (
          <PhotoGroup
            title="After photos"
            urls={afterUrls}
            uploading={uploadingKind === "after"}
            onAdd={(files) => handleFiles("after", files)}
            onRemove={(u) => removeUrl("after", u)}
          />
        )}

        <div className="rounded-2xl border border-slate-200 bg-white p-3 space-y-2">
          <label className="text-xs font-semibold text-slate-700 block">
            Notes for the office (optional)
          </label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything the office should know about this job?"
            rows={3}
          />
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur border-t border-slate-200 p-3">
        <div className="max-w-md mx-auto">
          <Button
            onClick={submit}
            disabled={
              submitting ||
              (phase === "before"
                ? beforeUrls.length === 0
                : phase === "after"
                  ? afterUrls.length === 0
                  : beforeUrls.length === 0 && afterUrls.length === 0)
            }
            className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
          >
            {submitting ? (
              <>
                <RiLoader4Line className="w-5 h-5 mr-2 animate-spin" /> Submitting…
              </>
            ) : (
              <>
                <RiCheckLine className="w-5 h-5 mr-2" />{" "}
                {phase === "before" ? "Submit before photos" : phase === "after" ? "Submit after photos" : "Submit photos"}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function PhotoGroup({
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
    <div className="rounded-2xl border border-slate-200 bg-white p-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-900">{title}</p>
        <span className="text-[11px] text-slate-500">
          {urls.length} attached
        </span>
      </div>
      {urls.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {urls.map((u) => (
            <div key={u} className="relative aspect-square rounded-lg overflow-hidden border border-slate-200">
              <img src={u} alt="" className="absolute inset-0 w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => onRemove(u)}
                className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-0.5 hover:bg-black/70"
              >
                <RiCloseCircleLine className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
      <label
        className={cn(
          "flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-4 cursor-pointer hover:border-emerald-400 hover:bg-emerald-50/40 transition",
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
            <RiCameraLine className="w-4 h-4 text-emerald-600" />
            <span className="text-xs font-medium text-slate-700">
              Tap to take or pick photos
            </span>
            <RiImageAddLine className="w-4 h-4 text-slate-400" />
          </>
        )}
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => {
            onAdd(e.target.files);
            // Reset so picking the same file again still fires onChange.
            e.target.value = "";
          }}
          className="hidden"
        />
      </label>
    </div>
  );
}
