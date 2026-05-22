"use client";

// ─── Cleaner job-completion (token-protected) ───────────────────────────
//
// Public page reached from the day-of-cleaning SMS the cleaner gets ~end-
// time. Path:
//
//   https://contractor.novaracleaning.com/cleaner/job/<token>/complete
//
// Token is the credential. On open: get-job-completion resolves the
// assignment + job + customer first name. Cleaner picks one of four
// outcomes:
//
//   ✅ Mark complete       → photo upload required (before + after)
//   ⚠️  Quality issue      → notes required
//   ❌ Could not complete  → notes required
//   🚨 Escalate to admin   → notes required
//
// submit-job-completion handles state transitions + GHL contact sync +
// dispatch_alerts insertion when the outcome is anything other than
// 'completed'.

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  RiCheckLine,
  RiAlertLine,
  RiCloseCircleLine,
  RiAlarmWarningLine,
  RiCamera2Line,
  RiLoader4Line,
  RiArrowLeftLine,
  RiCheckboxCircleFill,
  RiTimeLine,
  RiMapPin2Line,
  RiHomeLine,
} from "@remixicon/react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Outcome = "completed" | "quality_issue" | "incomplete" | "escalated";

interface OfferDetail {
  assignment: {
    id: string;
    status: string;
    role: string | null;
    estimated_pay_cents: number | null;
    completion_submitted_at: string | null;
    completion_outcome: string | null;
    before_photo_urls: string[];
    after_photo_urls: string[];
  };
  job: {
    id: string;
    service_type: string | null;
    start_datetime: string | null;
    duration_est_hours: number | null;
    bedrooms: number | null;
    bathrooms: number | null;
    sq_ft: number | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    notes: string | null;
  };
  customer: { first_name: string | null };
  cleaner: { first_name: string | null };
}

const OUTCOMES: Array<{
  id: Outcome;
  title: string;
  description: string;
  tone: "emerald" | "amber" | "rose" | "indigo";
  icon: typeof RiCheckLine;
}> = [
  { id: "completed",    title: "Mark complete",         description: "Job is done — upload before & after photos.", tone: "emerald", icon: RiCheckLine },
  { id: "quality_issue",title: "Quality issue",         description: "Got it done but flag a spot for the team.",     tone: "amber",   icon: RiAlertLine },
  { id: "incomplete",   title: "Couldn't complete",     description: "Could not finish — capture why for dispatch.",  tone: "rose",    icon: RiCloseCircleLine },
  { id: "escalated",    title: "Escalate to admin",     description: "Customer / safety issue — needs human follow-up.", tone: "indigo", icon: RiAlarmWarningLine },
];

const TONE_BG: Record<string, string> = {
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100",
  amber:   "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100",
  rose:    "border-rose-200 bg-rose-50 text-rose-900 hover:bg-rose-100",
  indigo:  "border-indigo-200 bg-indigo-50 text-indigo-900 hover:bg-indigo-100",
};
const TONE_ICON: Record<string, string> = {
  emerald: "bg-emerald-100 text-emerald-700",
  amber:   "bg-amber-100 text-amber-700",
  rose:    "bg-rose-100 text-rose-700",
  indigo:  "bg-indigo-100 text-indigo-700",
};

export default function CleanerJobCompletionPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = String(params?.token || "");

  const [loading, setLoading] = useState(true);
  const [offer, setOffer] = useState<OfferDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [notes, setNotes] = useState("");
  const [beforeUrls, setBeforeUrls] = useState<string[]>([]);
  const [afterUrls, setAfterUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState<"before" | "after" | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) return;
    void load();
  }, [token]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase.functions.invoke("get-job-completion", {
        body: { token },
      });
      if (err) throw err;
      if ((data as any)?.error) throw new Error((data as any).error);
      setOffer(data as OfferDetail);
    } catch (e: any) {
      setError(e?.message || "Couldn't load this job");
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (kind: "before" | "after", files: FileList | null) => {
    if (!files || files.length === 0 || !token) return;
    setUploading(kind);
    try {
      const uploaded: string[] = [];
      for (const file of Array.from(files).slice(0, 8)) {
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        const safeExt = /^[a-z0-9]{1,5}$/.test(ext) ? ext : "jpg";
        const path = `${token}/${kind}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`;
        const { error: upErr } = await supabase.storage
          .from("job-evidence")
          .upload(path, file, { cacheControl: "31536000", upsert: false, contentType: file.type });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from("job-evidence").getPublicUrl(path);
        if (pub?.publicUrl) uploaded.push(pub.publicUrl);
      }
      if (kind === "before") setBeforeUrls((p) => [...p, ...uploaded]);
      else setAfterUrls((p) => [...p, ...uploaded]);
      toast.success(`${uploaded.length} ${kind} photo${uploaded.length === 1 ? "" : "s"} uploaded`);
    } catch (e: any) {
      toast.error(e?.message || "Upload failed");
    } finally {
      setUploading(null);
    }
  };

  const handleSubmit = async () => {
    if (!outcome) return;
    if (outcome === "completed" && (beforeUrls.length === 0 || afterUrls.length === 0)) {
      toast.error("Upload at least one before AND one after photo.");
      return;
    }
    if (outcome !== "completed" && notes.trim().length < 10) {
      toast.error("Please add a quick note (10+ characters) so dispatch can follow up.");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error: err } = await supabase.functions.invoke("submit-job-completion", {
        body: {
          token,
          outcome,
          notes: notes.trim() || null,
          beforePhotoUrls: beforeUrls,
          afterPhotoUrls: afterUrls,
        },
      });
      if (err) throw err;
      const result = data as { ok: boolean; reason?: string; message?: string };
      if (!result.ok) {
        toast.error(result.message || "Couldn't submit");
        return;
      }
      toast.success("Submitted — thanks!");
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) return <ErrorShell title="Missing token" />;
  if (loading) {
    return (
      <Shell>
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-72 w-full" />
      </Shell>
    );
  }
  if (error || !offer) {
    return (
      <ErrorShell
        title="Couldn't load this job"
        hint={error || "The link may be invalid or expired."}
      />
    );
  }

  const alreadySubmitted = Boolean(offer.assignment.completion_submitted_at);

  return (
    <Shell>
      <Header offer={offer} />

      {alreadySubmitted ? (
        <Card className="border-emerald-200 bg-emerald-50">
          <CardContent className="p-5 text-center space-y-2">
            <RiCheckboxCircleFill className="w-10 h-10 text-emerald-600 mx-auto" />
            <p className="font-semibold text-emerald-900">
              You already submitted this wrap-up
            </p>
            <p className="text-sm text-emerald-800">
              Outcome: <strong>{prettyOutcome(offer.assignment.completion_outcome)}</strong>. If something's
              wrong, message dispatch directly.
            </p>
            <Button
              variant="outline"
              className="mt-2 border-emerald-300 text-emerald-800 bg-white"
              onClick={() => router.push("/cleaner/dashboard")}
            >
              <RiArrowLeftLine className="w-4 h-4 mr-1.5" />
              Back to dashboard
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="border-slate-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">How did it go?</CardTitle>
              <CardDescription>Pick one. You can change your mind before you submit.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {OUTCOMES.map((o) => {
                const selected = outcome === o.id;
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setOutcome(o.id)}
                    className={cn(
                      "border rounded-lg p-3 text-left transition-colors flex items-start gap-3",
                      selected ? TONE_BG[o.tone] : "border-slate-200 bg-white hover:bg-slate-50",
                    )}
                  >
                    <span
                      className={cn(
                        "w-9 h-9 rounded-md flex items-center justify-center shrink-0",
                        selected ? TONE_ICON[o.tone] : "bg-slate-100 text-slate-500",
                      )}
                    >
                      <o.icon className="w-4 h-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold leading-tight">{o.title}</p>
                      <p className="text-[12px] leading-tight opacity-80">{o.description}</p>
                    </div>
                  </button>
                );
              })}
            </CardContent>
          </Card>

          {outcome === "completed" && (
            <Card className="border-emerald-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Before &amp; after photos</CardTitle>
                <CardDescription>
                  At least one of each. Aim for the kitchen + a bathroom + the main living area.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <PhotoSlot
                  label="Before"
                  urls={beforeUrls}
                  onUpload={(f) => handleUpload("before", f)}
                  busy={uploading === "before"}
                />
                <PhotoSlot
                  label="After"
                  urls={afterUrls}
                  onUpload={(f) => handleUpload("after", f)}
                  busy={uploading === "after"}
                />
              </CardContent>
            </Card>
          )}

          {outcome && (
            <Card className="border-slate-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {outcome === "completed" ? "Anything to add? (optional)" : "What happened?"}
                </CardTitle>
                <CardDescription>
                  {outcome === "completed"
                    ? "Customer feedback, broken supplies, a spot you want admin to spot-check."
                    : "Be specific — this goes straight to dispatch + admin and (for escalations) on the customer record."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Textarea
                  rows={4}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={
                    outcome === "completed"
                      ? "Everything went great. Customer mentioned the new dog. Used extra glass cleaner."
                      : "Couldn't access master bathroom — locked. Cust was unreachable after 15 min of knocking."
                  }
                  className="resize-none"
                />
              </CardContent>
            </Card>
          )}

          <div className="sticky bottom-3 pt-1">
            <Button
              size="lg"
              disabled={!outcome || submitting || uploading != null}
              onClick={handleSubmit}
              className={cn(
                "w-full h-14 font-semibold text-base shadow",
                outcome === "completed"
                  ? "bg-gradient-to-br from-emerald-500 to-emerald-700 hover:from-emerald-600 hover:to-emerald-800 text-white shadow-emerald-700/20"
                  : outcome === "escalated"
                  ? "bg-gradient-to-br from-rose-500 to-rose-700 hover:from-rose-600 hover:to-rose-800 text-white"
                  : "bg-slate-900 hover:bg-slate-800 text-white",
              )}
            >
              {submitting ? (
                <RiLoader4Line className="w-5 h-5 animate-spin" />
              ) : outcome ? (
                <>
                  {outcome === "completed" ? <RiCheckLine className="w-5 h-5 mr-2" /> : <RiAlertLine className="w-5 h-5 mr-2" />}
                  Submit {OUTCOMES.find((o) => o.id === outcome)?.title.toLowerCase()}
                </>
              ) : (
                "Pick an outcome above"
              )}
            </Button>
          </div>
        </>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <div
        className="border-b border-emerald-200 bg-gradient-to-br from-emerald-50 to-white"
        style={{
          backgroundImage:
            "radial-gradient(circle at top left, rgba(22,163,74,0.10), transparent 60%)",
        }}
      >
        <div className="max-w-2xl mx-auto px-4 py-5 sm:py-6">
          <div className="flex items-center gap-3">
            <span className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center shadow-sm">
              <RiCheckboxCircleFill className="w-6 h-6 text-white" />
            </span>
            <div>
              <p className="text-[11px] uppercase tracking-wider font-semibold text-emerald-700">
                Novara · Job wrap-up
              </p>
              <h1 className="text-lg font-bold text-slate-900">Mark this job complete</h1>
            </div>
          </div>
        </div>
      </div>
      <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">{children}</div>
    </div>
  );
}

function Header({ offer }: { offer: OfferDetail }) {
  const start = offer.job.start_datetime ? new Date(offer.job.start_datetime) : null;
  const startTxt = start
    ? `${start.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })} · ${start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
    : "—";
  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-slate-900 flex items-center justify-between">
          <span>{prettyServiceType(offer.job.service_type)}</span>
          <Badge variant="outline" className="bg-slate-50 text-slate-700">
            {offer.assignment.role || "Lead"}
          </Badge>
        </CardTitle>
        <CardDescription>
          {offer.job.sq_ft ? `${offer.job.sq_ft.toLocaleString()} sq ft · ` : ""}
          {offer.job.bedrooms ? `${offer.job.bedrooms} bd · ` : ""}
          {offer.job.bathrooms ? `${offer.job.bathrooms} ba` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2.5">
        <Row icon={RiTimeLine} label="When" value={startTxt} />
        <Row
          icon={RiMapPin2Line}
          label="Where"
          value={`${offer.job.address || "—"}${offer.job.city ? `, ${offer.job.city}` : ""} ${offer.job.zip || ""}`}
        />
        <Row icon={RiHomeLine} label="Customer" value={offer.customer.first_name || "Customer"} />
      </CardContent>
    </Card>
  );
}

function Row({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof RiTimeLine;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-9 h-9 rounded-md bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4" />
      </span>
      <div>
        <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">{label}</p>
        <p className="text-sm text-slate-900">{value}</p>
      </div>
    </div>
  );
}

function PhotoSlot({
  label,
  urls,
  onUpload,
  busy,
}: {
  label: string;
  urls: string[];
  onUpload: (files: FileList | null) => void;
  busy: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-800">{label}</p>
        <Badge variant="outline" className="bg-slate-50 text-slate-700 text-[10px]">
          {urls.length} uploaded
        </Badge>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={(e) => onUpload(e.target.files)}
      />
      <Button
        type="button"
        variant="outline"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="w-full border-emerald-200 text-emerald-800 bg-emerald-50 hover:bg-emerald-100"
      >
        {busy ? <RiLoader4Line className="w-4 h-4 animate-spin mr-1.5" /> : <RiCamera2Line className="w-4 h-4 mr-1.5" />}
        Add {label.toLowerCase()} photos
      </Button>
      {urls.length > 0 && (
        <div className="grid grid-cols-3 gap-1.5">
          {urls.slice(0, 6).map((u, idx) => (
            <a key={idx} href={u} target="_blank" rel="noopener noreferrer" className="block">
              <img
                src={u}
                alt={`${label} ${idx + 1}`}
                className="w-full h-20 object-cover rounded border border-slate-200"
                loading="lazy"
              />
            </a>
          ))}
          {urls.length > 6 && (
            <div className="w-full h-20 rounded border border-slate-200 flex items-center justify-center text-xs text-slate-500 bg-slate-50">
              +{urls.length - 6} more
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ErrorShell({ title, hint }: { title: string; hint?: string }) {
  return (
    <Shell>
      <Card className="border-rose-200 bg-rose-50">
        <CardContent className="text-center py-10 space-y-2">
          <RiAlertLine className="w-10 h-10 text-rose-600 mx-auto" />
          <p className="font-semibold text-rose-900">{title}</p>
          {hint ? <p className="text-sm text-rose-800">{hint}</p> : null}
        </CardContent>
      </Card>
    </Shell>
  );
}

function prettyServiceType(s: string | null): string {
  if (!s) return "Cleaning job";
  const key = s.toLowerCase();
  if (key === "standard") return "Standard cleaning";
  if (key === "deep") return "Deep cleaning";
  if (key === "moveinout" || key === "move_in_out") return "Move-in / move-out cleaning";
  if (key === "combo") return "Deep + standard combo";
  return s;
}

function prettyOutcome(s: string | null): string {
  if (!s) return "—";
  if (s === "completed") return "Completed";
  if (s === "quality_issue") return "Quality issue";
  if (s === "incomplete") return "Incomplete";
  if (s === "escalated") return "Escalated";
  return s;
}
