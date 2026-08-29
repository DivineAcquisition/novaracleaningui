"use client";

// ─── /cleaner/turnovers — Turnover crew job board ────────────────────────
//
// The cleaner-facing side of the partner (Airbnb/STR host) turnover portal.
// Lists turnovers assigned to the signed-in cleaner with everything they
// need on the job: address, access instructions, host notes, and the
// confirm → check-in → complete flow with before/after photo upload.
//
// All state changes go through the partner-turnover edge function, which
// verifies the acting user owns the assignment. Reads are scoped by RLS.

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  RiLoader4Line, RiMapPinLine, RiTimeLine, RiKey2Line, RiHome4Line,
  RiCheckboxCircleLine, RiCameraLine, RiArrowLeftLine, RiInformationLine,
  RiCheckLine, RiPlayCircleLine,
} from "@remixicon/react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SEO } from "@/components/SEO";
import { cn } from "@/lib/utils";
import { resolveCleanerAuth } from "@/lib/cleaner-auth";

const BUCKET = "turnover-photos";

interface PropertyLite {
  nickname: string | null; address: string | null; access_instructions: string | null;
  bedrooms: number | null; bathrooms: number | null; laundry_included: boolean;
  restock_included: boolean; special_notes: string | null;
}
interface TurnoverJob {
  id: string; property_id: string; requested_date: string; window_start: string | null;
  window_end: string | null; price: number; status: string;
  before_photos: string[] | null; after_photos: string[] | null;
  properties: PropertyLite | null;
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  assigned: { label: "Action needed — confirm", cls: "bg-amber-100 text-amber-700" },
  cleaner_confirmed: { label: "Confirmed", cls: "bg-emerald-100 text-emerald-700" },
  in_progress: { label: "In progress", cls: "bg-blue-100 text-blue-700" },
  completed: { label: "Completed", cls: "bg-emerald-100 text-emerald-700" },
};

// Cleaner's informational share of the turnover price.
const CLEANER_SHARE = 0.7;

export default function TurnoverJobs() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [cleanerId, setCleanerId] = useState<string | null>(null);
  const [jobs, setJobs] = useState<TurnoverJob[]>([]);

  const loadJobs = useCallback(async () => {
    const { data } = await (supabase.from as any)("turnover_requests")
      .select("*, properties(nickname,address,access_instructions,bedrooms,bathrooms,laundry_included,restock_included,special_notes)")
      .in("status", ["assigned", "cleaner_confirmed", "in_progress", "completed"])
      .order("requested_date", { ascending: true });
    setJobs((data as TurnoverJob[]) || []);
  }, []);

  useEffect(() => {
    (async () => {
      const { cleaner, routing } = await resolveCleanerAuth();
      if (routing === "auth") { router.replace("/cleaner/auth"); return; }
      if (!cleaner) { router.replace("/cleaner/dashboard"); return; }
      setCleanerId(cleaner.id);
      await loadJobs();
      setLoading(false);
    })();
  }, [router, loadJobs]);

  // Live refresh when an assignment / status changes.
  useEffect(() => {
    if (!cleanerId) return;
    const ch = supabase
      .channel("cleaner-turnovers-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "turnover_requests" }, () => loadJobs())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [cleanerId, loadJobs]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><RiLoader4Line className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  const active = jobs.filter((j) => j.status !== "completed");
  const done = jobs.filter((j) => j.status === "completed");

  return (
    <div className="min-h-screen bg-background">
      <SEO title="My Turnovers" noindex />
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => router.push("/cleaner/dashboard")}><RiArrowLeftLine className="w-4 h-4" /></Button>
          <div className="flex items-center gap-2 font-bold"><RiHome4Line className="w-5 h-5" style={{ color: "#5C0FFE" }} /> Turnovers</div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        <section className="space-y-3">
          <h2 className="text-lg font-bold">Assigned to you</h2>
          {active.length === 0 && <p className="text-sm text-muted-foreground">No active turnovers right now. We'll text you when one is assigned.</p>}
          <div className="grid gap-3">
            {active.map((j) => <JobCard key={j.id} job={j} onChanged={loadJobs} />)}
          </div>
        </section>

        {done.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-lg font-bold">Completed</h2>
            <div className="grid gap-3">
              {done.map((j) => <JobCard key={j.id} job={j} onChanged={loadJobs} />)}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function JobCard({ job, onChanged }: { job: TurnoverJob; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [uploading, setUploading] = useState<"before" | "after" | null>(null);
  const p = job.properties;
  const st = STATUS_LABEL[job.status] || { label: job.status, cls: "bg-slate-100 text-slate-600" };
  const before = job.before_photos || [];
  const after = job.after_photos || [];
  const share = (Number(job.price) * CLEANER_SHARE).toFixed(0);

  const uploadFiles = async (kind: "before" | "after", files: FileList | null): Promise<string[]> => {
    if (!files || files.length === 0) return [];
    setUploading(kind);
    const added: string[] = [];
    try {
      for (const file of Array.from(files)) {
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        const key = `turnovers/${job.id}/${kind}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error } = await supabase.storage.from(BUCKET).upload(key, file, {
          cacheControl: "3600", contentType: file.type || "image/jpeg", upsert: false,
        });
        if (error) throw error;
        const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(key);
        added.push(pub.publicUrl);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(null);
    }
    return added;
  };

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action);
    const { data, error } = await supabase.functions.invoke("partner-turnover", {
      body: { action, turnoverId: job.id, ...extra },
    });
    setBusy(null);
    if (error || (data as any)?.error) { toast.error((data as any)?.error || "Something went wrong"); return false; }
    onChanged();
    return true;
  };

  const confirm = () => act("cleaner.confirm").then((ok) => ok && toast.success("Confirmed — see you there!"));

  const checkin = async (files: FileList | null) => {
    const photos = await uploadFiles("before", files);
    const ok = await act("cleaner.checkin", photos.length ? { before_photos: [...before, ...photos] } : {});
    if (ok) toast.success("Checked in. Good luck!");
  };

  const complete = async (files: FileList | null) => {
    const photos = await uploadFiles("after", files);
    if (after.length + photos.length === 0) { toast.error("Add at least one after photo to complete."); return; }
    const ok = await act("cleaner.complete", { after_photos: [...after, ...photos] });
    if (ok) toast.success("Marked complete — host notified!");
  };

  const addPhotos = async (kind: "before" | "after", files: FileList | null) => {
    const photos = await uploadFiles(kind, files);
    if (!photos.length) return;
    const col = kind === "before" ? "before_photos" : "after_photos";
    const next = kind === "before" ? [...before, ...photos] : [...after, ...photos];
    const { error } = await (supabase.from as any)("turnover_requests").update({ [col]: next }).eq("id", job.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Photo added");
    onChanged();
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-sm flex items-center gap-1.5"><RiMapPinLine className="w-4 h-4 text-primary" />{p?.nickname || p?.address || "Property"}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{p?.address}</p>
            <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1">
              <RiTimeLine className="w-3 h-3" />{format(new Date(`${job.requested_date}T12:00:00`), "EEE, MMM d")}
              {job.window_start ? ` · ${job.window_start.slice(0, 5)}–${(job.window_end || "").slice(0, 5)}` : ""}
            </p>
          </div>
          <div className="text-right shrink-0">
            <Badge className={cn("text-[11px]", st.cls)}>{st.label}</Badge>
            <p className="text-sm font-semibold mt-1">${share}<span className="text-[10px] text-muted-foreground"> est. pay</span></p>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 text-[11px]">
          {p?.bedrooms != null && <Badge variant="secondary">{p.bedrooms} BR</Badge>}
          {p?.bathrooms != null && <Badge variant="secondary">{p.bathrooms} BA</Badge>}
          {p?.laundry_included && <Badge variant="secondary">Laundry on-site</Badge>}
          {p?.restock_included && <Badge variant="secondary">Restock</Badge>}
        </div>

        {/* Access + notes — only meaningful once confirmed/working */}
        {p?.access_instructions && (
          <div className="rounded-lg bg-violet-50 border border-violet-100 p-3">
            <p className="text-[11px] font-semibold text-violet-700 flex items-center gap-1.5"><RiKey2Line className="w-3.5 h-3.5" /> Access</p>
            <p className="text-xs text-slate-700 mt-1 whitespace-pre-wrap">{p.access_instructions}</p>
          </div>
        )}
        {p?.special_notes && (
          <div className="rounded-lg bg-slate-50 border p-3">
            <p className="text-[11px] font-semibold text-slate-600 flex items-center gap-1.5"><RiInformationLine className="w-3.5 h-3.5" /> Host notes</p>
            <p className="text-xs text-slate-700 mt-1 whitespace-pre-wrap">{p.special_notes}</p>
          </div>
        )}

        {/* Photo thumbnails */}
        {(before.length > 0 || after.length > 0) && (
          <div className="space-y-2">
            {before.length > 0 && <PhotoRow label="Before" urls={before} />}
            {after.length > 0 && <PhotoRow label="After" urls={after} />}
          </div>
        )}

        {/* Lifecycle actions */}
        <div className="flex flex-wrap gap-2 pt-1">
          {job.status === "assigned" && (
            <Button size="sm" disabled={!!busy} onClick={confirm} style={{ background: "#5C0FFE" }}>
              {busy === "cleaner.confirm" ? <RiLoader4Line className="w-3.5 h-3.5 animate-spin" /> : <><RiCheckLine className="w-3.5 h-3.5 mr-1" /> Confirm job</>}
            </Button>
          )}
          {job.status === "cleaner_confirmed" && (
            <PhotoButton
              label={<><RiPlayCircleLine className="w-3.5 h-3.5 mr-1" /> Check in</>}
              busy={busy === "cleaner.checkin" || uploading === "before"}
              onFiles={checkin}
              style={{ background: "#5C0FFE" }}
            />
          )}
          {job.status === "in_progress" && (
            <>
              <PhotoButton label={<><RiCameraLine className="w-3.5 h-3.5 mr-1" /> Add before</>} variant="outline" busy={uploading === "before"} onFiles={(f) => addPhotos("before", f)} />
              <PhotoButton
                label={<><RiCheckboxCircleLine className="w-3.5 h-3.5 mr-1" /> Complete + photos</>}
                busy={busy === "cleaner.complete" || uploading === "after"}
                onFiles={complete}
                style={{ background: "#5C0FFE" }}
              />
            </>
          )}
          {job.status === "completed" && (
            <span className="text-xs text-emerald-600 flex items-center gap-1.5"><RiCheckboxCircleLine className="w-4 h-4" /> Guest-ready — thank you!</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function PhotoRow({ label, urls }: { label: string; urls: string[] }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-slate-500">{label}</p>
      <div className="flex gap-2 mt-1 overflow-x-auto">
        {urls.map((u, i) => (
          <a key={i} href={u} target="_blank" rel="noreferrer" className="block h-16 w-16 shrink-0 overflow-hidden rounded-lg border bg-slate-100">
            <img src={u} alt={`${label} ${i + 1}`} className="h-full w-full object-cover" />
          </a>
        ))}
      </div>
    </div>
  );
}

function PhotoButton({
  label, onFiles, busy, variant, style,
}: {
  label: React.ReactNode; onFiles: (files: FileList | null) => void; busy?: boolean;
  variant?: "outline"; style?: React.CSSProperties;
}) {
  return (
    <label className={cn(
      "inline-flex items-center justify-center rounded-md text-sm font-medium h-9 px-3 cursor-pointer transition",
      variant === "outline" ? "border border-input bg-background hover:bg-accent" : "text-white hover:opacity-95",
      busy && "opacity-60 pointer-events-none",
    )} style={variant === "outline" ? undefined : style}>
      {busy ? <RiLoader4Line className="w-3.5 h-3.5 animate-spin" /> : label}
      <input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
    </label>
  );
}
