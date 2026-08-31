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
import { SEO } from "@/components/SEO";
import { MediaThumb } from "@/components/job-media/MediaThumb";
import { isVideoFile, videoTooLargeMessage } from "@/lib/job-media";
import { ChecklistField } from "@/components/proposals/ChecklistField";
import { ZoneMapEditor } from "@/components/commercial/ZoneMapEditor";
import { parseSiteZones, type SiteZone } from "@/lib/site-zones";
import type { ChecklistItem, PropertyTypeDef } from "@/lib/proposal-request";
import { typeRequiresWalkthrough } from "@/lib/proposal-request";
import { TokenPageShell, TokenPanel } from "@/components/token/TokenPageShell";
import { ShimmerButton } from "@/components/magicui/shimmer-button";
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
  };
  answers: Record<string, unknown>;
  photos: string[];
  scheduledAt: string | null;
  zonesRequired?: boolean;
  zoneThresholdSqft?: number;
  existingZones?: SiteZone[];
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
  const [zones, setZones] = useState<SiteZone[]>([]);
  const [photoZoneId, setPhotoZoneId] = useState<string>("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<"conducted" | "excluded" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await walkthroughFetch(token);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) throw new Error(data?.error || "Link not valid");
      setInfo(data as FormPayload);
      setAnswers(data.answers || {});
      setPhotos(Array.isArray(data.photos) ? data.photos : []);
      const fromAnswers = parseSiteZones((data.answers || {}).zones);
      setZones(fromAnswers.length ? fromAnswers : parseSiteZones(data.existingZones));
      if (data.submitted) setDone(data.status === "excluded" ? "excluded" : "conducted");
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "Could not open this walkthrough");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const persist = useCallback(async (nextAnswers: Record<string, unknown>, nextPhotos: string[], nextZones?: SiteZone[]) => {
    setSaveState("saving");
    try {
      const res = await walkthroughFetch(token, {
        method: "PATCH",
        body: JSON.stringify({ answers: { ...nextAnswers, zones: nextZones ?? zones }, photos: nextPhotos }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Save failed");
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 1500);
    } catch {
      setSaveState("error");
    }
  }, [token, zones]);

  const setAnswer = (key: string, value: unknown) => {
    setAnswers((prev) => {
      const next = { ...prev, [key]: value, zones };
      void persist(next, photos, zones);
      return next;
    });
  };

  const saveZones = (nextZones: SiteZone[]) => {
    setZones(nextZones);
    setAnswers((prev) => {
      const next = { ...prev, zones: nextZones };
      void persist(next, photos, nextZones);
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
      const zonePhotos = { ...((answers.zone_photos as Record<string, string[]>) || {}) };
      if (photoZoneId) {
        zonePhotos[photoZoneId] = [...(zonePhotos[photoZoneId] || []), ...added];
      }
      const nextAnswers = { ...answers, photos: next, zones, zone_photos: zonePhotos };
      setAnswers(nextAnswers);
      await persist(nextAnswers, next, zones);
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
        body: JSON.stringify({ answers: { ...answers, photos, zones }, photos }),
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
            : "Site findings submitted. You can still add photos or notes on this document.",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <TokenPageShell embedded={staff} eyebrow="Site findings">
        <div className="flex items-center justify-center py-16 text-slate-500 text-sm">
          <RiLoader4Line className="w-4 h-4 animate-spin mr-2" /> Opening site findings…
        </div>
      </TokenPageShell>
    );
  }
  if (loadErr || !info) {
    return (
      <TokenPageShell embedded={staff} eyebrow="Site findings" title="This link isn't valid">
        <TokenPanel className="text-center">
          <p className="text-sm text-slate-500">{loadErr || "Ask dispatch to resend the walkthrough assignment."}</p>
        </TokenPanel>
      </TokenPageShell>
    );
  }

  const universal = info.checklist.universal.filter((i) => i.kind !== "media");
  const typeItems = info.checklist.typeSpecific;
  const inPipeline = Boolean(done || info.submitted);
  const extrasTitle = typeRequiresWalkthrough(info.propertyType)
    ? "Additional findings"
    : `${info.propertyType.shortLabel} findings`;

  return (
    <TokenPageShell
      embedded={staff}
      eyebrow={`Site findings · ${info.propertyType.shortLabel}`}
      title={info.site.nickname}
      subtitle={info.site.address}
      topBar={
        !staff ? (
          <span>
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved ✓" : saveState === "error" ? "Save failed" : "Auto-saves"}
          </span>
        ) : undefined
      }
      footer={
        <p className="text-[11px] text-slate-400 text-center">
          If you find mold past threshold, active infestation, biohazard, or a structural hazard, mark it on the exclusion check. That stops pricing.
        </p>
      }
    >
      <SEO title={`${info.propertyType.shortLabel} site findings`} />
      {staff && (
        <div className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-900">
          Office copy of the walkthrough agent&apos;s site findings. This is not the crew job checklist —
          that token is issued after the job is booked and assigned.
          <span className="block mt-1 text-violet-700/80">
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved ✓" : "Auto-saves as you go"}
          </span>
        </div>
      )}

      <TokenPanel shine>
        <p className="text-[11px] uppercase tracking-wider font-semibold text-violet-700">
          Novara · Site findings · {info.propertyType.shortLabel}
        </p>
        <p className="text-xs text-slate-600 flex items-start gap-1 mt-2">
          <RiMapPinLine className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          {info.site.address}
        </p>
        {info.site.clientStatedSqft ? (
          <p className="text-[11px] text-slate-500 mt-2">Client stated {Number(info.site.clientStatedSqft).toLocaleString()} sq ft — confirm on site.</p>
        ) : null}
        {info.access?.name && (
          <p className="text-[11px] text-slate-500 mt-1">Access: {info.access.name}{info.access.phone ? ` · ${info.access.phone}` : ""}</p>
        )}
      </TokenPanel>

      {info.preview && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          Preview only — answers save in this browser session against the API fixture, not a live assignment.
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
              : "Findings are in the pipeline. Same document — add photos or notes without re-entering."}
          </p>
        </div>
      )}

      <TokenPanel>
        <h2 className="text-sm font-bold text-slate-900">Site findings</h2>
        <p className="text-[11px] text-slate-500 mb-3">
          Required fields set the firm price. Notes below them are optional — type only what matters.
        </p>
        <div className="space-y-3">
          {universal.map((item) => (
            <ChecklistField key={item.key} item={item} value={answers[item.key]} onChange={(v) => setAnswer(item.key, v)} compact />
          ))}
        </div>
      </TokenPanel>

      {typeItems.length > 0 && (
        <TokenPanel>
          <h2 className="text-sm font-bold text-violet-900">{extrasTitle}</h2>
          <p className="text-[11px] text-slate-500 mb-3">
            {typeRequiresWalkthrough(info.propertyType)
              ? "Same additional questions on every office and commercial walkthrough — not the crew job list."
              : "Only this property type — leftover STR token. Not the crew job list."}
          </p>
          <div className="space-y-3">
            {typeItems.map((item) => (
              <ChecklistField key={item.key} item={item} value={answers[item.key]} onChange={(v) => setAnswer(item.key, v)} compact />
            ))}
          </div>
        </TokenPanel>
      )}

      {(info.zonesRequired || zones.length > 0) && (
        <TokenPanel className="bg-violet-50/40">
          <h2 className="text-sm font-bold text-violet-950">Site zones</h2>
          <p className="text-[11px] text-violet-800 mb-3">
            This site is large enough that one photo pair doesn&apos;t prove the visit.
            Name each physical section now — that map is reused on every future job.
            {info.zoneThresholdSqft
              ? ` Required at ${info.zoneThresholdSqft.toLocaleString()} sq ft and above.`
              : ""}
          </p>
          <ZoneMapEditor zones={zones} onChange={saveZones} compact />
        </TokenPanel>
      )}

      <TokenPanel>
        <h2 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
          <RiCameraLine className="w-4 h-4" /> Photos + video
        </h2>
        <p className="text-[11px] text-slate-500 mb-3">
          Condition photos and a short clip. When zones are named, tag each upload to the section it shows.
        </p>
        {zones.length > 0 && (
          <select
            value={photoZoneId}
            onChange={(e) => setPhotoZoneId(e.target.value)}
            className="h-8 text-xs rounded-md border border-slate-200 bg-white px-2 mb-3"
          >
            <option value="">Whole site / not yet zoned</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>{z.name}</option>
            ))}
          </select>
        )}
        <div className="flex flex-wrap gap-2">
          {photos.map((url) => (
            <MediaThumb key={url} url={url} className="w-20 h-20 rounded-lg overflow-hidden" />
          ))}
        </div>
        <label className="inline-flex items-center gap-2 text-sm font-medium text-violet-700 cursor-pointer mt-3">
          <input type="file" accept="image/*,video/*" multiple className="hidden" disabled={uploading}
            onChange={(e) => void upload(e.target.files)} />
          {uploading ? <RiLoader4Line className="w-4 h-4 animate-spin" /> : <RiVideoLine className="w-4 h-4" />}
          Add photos or video
        </label>
      </TokenPanel>

      <ShimmerButton className="w-full h-11" disabled={submitting} onClick={() => void submit()}>
        {submitting ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiCheckLine className="w-4 h-4 mr-1.5" />}
        {inPipeline ? "Save additions" : "Submit site findings"}
      </ShimmerButton>
    </TokenPageShell>
  );
}
