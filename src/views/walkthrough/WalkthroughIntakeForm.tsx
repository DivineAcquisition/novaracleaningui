"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import imageCompression from "browser-image-compression";
import {
  RiCameraLine,
  RiCheckLine,
  RiLoader4Line,
  RiMapPinLine,
  RiShieldCheckLine,
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
  expired?: boolean;
  status: string;
  walkthroughId: string;
  propertyType: PropertyTypeDef;
  checklist: { universal: ChecklistItem[]; typeSpecific: ChecklistItem[]; all: ChecklistItem[] };
  answers: Record<string, unknown>;
  photos: string[];
  scheduledAt: string | null;
  site: { nickname: string; address: string; clientStatedSqft: number | null };
  access: { name: string | null; phone: string | null };
  account: { name: string; contact: string } | null;
  cleaner: { name: string } | null;
}

export default function WalkthroughIntakeForm() {
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/walkthrough/${token}`);
      const data = await res.json();
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
      const res = await fetch(`/api/walkthrough/${token}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: nextAnswers, photos: nextPhotos }),
      });
      const data = await res.json();
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
      const res = await fetch(`/api/walkthrough/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: { ...answers, photos }, photos }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Submit failed");
      setDone(data.excluded ? "excluded" : "conducted");
      toast.success(data.excluded ? "Exclusion recorded — pricing stopped." : "Walkthrough submitted. Findings are in the pricing pipeline.");
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
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-2">
          <p className="font-bold text-slate-900">This link isn't valid</p>
          <p className="text-sm text-slate-500">{loadErr || "Ask dispatch to resend the walkthrough assignment."}</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <SEO title="Walkthrough submitted" />
        <div className="max-w-md text-center space-y-3">
          <div className={cn("mx-auto w-12 h-12 rounded-full flex items-center justify-center", done === "excluded" ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700")}>
            {done === "excluded" ? <RiShieldCheckLine className="w-6 h-6" /> : <RiCheckLine className="w-6 h-6" />}
          </div>
          <h1 className="text-xl font-bold text-slate-900">
            {done === "excluded" ? "Exclusion recorded" : "Walkthrough submitted"}
          </h1>
          <p className="text-sm text-slate-500">
            {done === "excluded"
              ? "Pricing has stopped. This routes to existing exclusion handling — Novara does not price or service excluded conditions."
              : "Findings are in the pipeline. Admin will set the firm price from what you captured — no re-entry."}
          </p>
        </div>
      </div>
    );
  }

  const universal = info.checklist.universal.filter((i) => i.kind !== "media");
  const typeItems = info.checklist.typeSpecific;

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <SEO title={`${info.propertyType.shortLabel} walkthrough`} />
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-xl mx-auto px-4 h-14 flex items-center justify-between">
          <img src="/novara-logo.png" alt="Novara Cleaning" className="h-7" />
          <span className="text-[11px] font-semibold text-slate-500">
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved ✓" : saveState === "error" ? "Save failed" : "Auto-saves"}
          </span>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 py-4 space-y-4">
        <div className="rounded-2xl text-white p-4" style={{ background: "linear-gradient(135deg,#5C0FFE,#6810FE)" }}>
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/80">{info.propertyType.label}</p>
          <p className="text-lg font-bold mt-1">{info.site.nickname}</p>
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

        <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
          <h2 className="text-sm font-bold text-slate-900">Universal findings</h2>
          {universal.map((item) => (
            <ChecklistField key={item.key} item={item} value={answers[item.key]} onChange={(v) => setAnswer(item.key, v)} compact />
          ))}
        </section>

        {typeItems.length > 0 && (
          <section className="rounded-2xl border border-violet-200 bg-white p-4 space-y-3">
            <h2 className="text-sm font-bold text-violet-900">{info.propertyType.shortLabel} checklist</h2>
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
          Submit walkthrough
        </Button>
        <p className="text-[11px] text-slate-400 text-center">
          If you find mold past threshold, active infestation, biohazard, or a structural hazard, mark it on the exclusion check. That stops pricing.
        </p>
      </main>
    </div>
  );
}
