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
  alreadySubmitted: boolean;
}

const BUCKET = "cleaner-job-photos";

export default function CleanerJobPhotosPage() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token || "");

  const [info, setInfo] = useState<BookingInfo | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [beforeUrls, setBeforeUrls] = useState<string[]>([]);
  const [afterUrls, setAfterUrls] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [uploadingKind, setUploadingKind] = useState<"before" | "after" | null>(null);

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
      if (d.alreadySubmitted) setSubmitted(true);
    } catch (err) {
      setLoadErr((err as Error).message || "Couldn't load this job");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) void load();
  }, [token, load]);

  const handleFiles = async (
    kind: "before" | "after",
    files: FileList | null,
  ) => {
    if (!files || files.length === 0 || !info) return;
    setUploadingKind(kind);
    const added: string[] = [];
    try {
      for (const file of Array.from(files)) {
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        const key = `bookings/${info.bookingId}/${kind}/${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}.${ext}`;
        const { error } = await supabase.storage.from(BUCKET).upload(key, file, {
          cacheControl: "3600",
          contentType: file.type || "image/jpeg",
          upsert: false,
        });
        if (error) throw error;
        const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(key);
        added.push(pub.publicUrl);
      }
      if (kind === "before") setBeforeUrls((prev) => [...prev, ...added]);
      else setAfterUrls((prev) => [...prev, ...added]);
      toast.success(`Added ${added.length} ${kind} photo${added.length === 1 ? "" : "s"}`);
    } catch (err) {
      toast.error("Upload failed: " + (err as Error).message);
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

  if (submitted) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 max-w-md mx-auto">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-600 text-white mb-3">
            <RiCheckLine className="w-6 h-6" />
          </div>
          <p className="font-semibold text-emerald-900">Photos submitted.</p>
          <p className="text-xs text-emerald-800 mt-1">
            Your payout should appear in your Stripe payouts within 1–2 business days.
          </p>
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
              Hi {info.cleanerFirstName || "team"} — drop your photos
            </p>
          </div>
          <p className="mt-2 text-xs text-emerald-50 leading-snug">
            Job NOV-{String(info.bookingNumber || 0).padStart(5, "0")} ·{" "}
            {info.customerFirstName || "Customer"} · {info.serviceDate}{" "}
            {info.timeSlot && `· ${info.timeSlot}`}
            {info.addressLine && <span className="block">{info.addressLine}</span>}
          </p>
        </header>

        <PhotoGroup
          title="Before photos"
          urls={beforeUrls}
          uploading={uploadingKind === "before"}
          onAdd={(files) => handleFiles("before", files)}
          onRemove={(u) => removeUrl("before", u)}
        />
        <PhotoGroup
          title="After photos"
          urls={afterUrls}
          uploading={uploadingKind === "after"}
          onAdd={(files) => handleFiles("after", files)}
          onRemove={(u) => removeUrl("after", u)}
        />

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
            disabled={submitting || (beforeUrls.length === 0 && afterUrls.length === 0)}
            className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
          >
            {submitting ? (
              <>
                <RiLoader4Line className="w-5 h-5 mr-2 animate-spin" /> Submitting…
              </>
            ) : (
              <>
                <RiCheckLine className="w-5 h-5 mr-2" /> Submit photos
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
          capture="environment"
          onChange={(e) => onAdd(e.target.files)}
          className="hidden"
        />
      </label>
    </div>
  );
}
