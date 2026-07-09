"use client";

// ─── Cleaner job offer (token-protected) ───────────────────────────────
//
// Public page reached from the SMS Novara sends a cleaner when a new
// job is offered. The path looks like:
//
//   https://contractor.novaracleaning.com/cleaner/job-offer/<token>
//
// The token is the only credential — there is no other auth gate. The
// token is a 32-char hex string stored on job_assignments.response_token
// and unique-indexed. The page calls get-job-offer to resolve the
// assignment, then accept-job-offer / respond-to-offer to register the
// decision. Accept does an overlap check against the cleaner's other
// active assignments and rejects on conflict.

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  RiCalendarCheckLine,
  RiMapPin2Line,
  RiTimeLine,
  RiMoneyDollarCircleLine,
  RiHomeLine,
  RiCheckLine,
  RiCloseLine,
  RiLoader4Line,
  RiAlertLine,
  RiArrowLeftLine,
} from "@remixicon/react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface OfferDetail {
  assignment: {
    id: string;
    status: string;
    role: string | null;
    distance_miles: number | null;
    pay_rate_hr: number | null;
    pay_percentage_snapshot: number | null;
    estimated_pay_cents: number | null;
    expires_at: string | null;
    accepted_at: string | null;
    declined_at: string | null;
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
  booking?: {
    service_date: string | null;
    time_slot: string | null;
    arrival_window: string | null;
  } | null;
  customer: {
    first_name: string | null;
  };
  cleaner: { first_name: string | null };
}

const dollars = (cents: number | null) =>
  cents == null
    ? "—"
    : (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

const fmtWhen = (iso: string | null, hours: number | null) => {
  if (!iso) return "—";
  const start = new Date(iso);
  const end = new Date(start.getTime() + (hours || 3) * 60 * 60 * 1000);
  const dayLabel = start.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
  const startTime = start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const endTime = end.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${dayLabel} · ${startTime} – ${endTime}`;
};

// Friendly "Mon, Jun 20" for a YYYY-MM-DD string. Anchored at noon so the
// date never rolls backward in negative-offset timezones.
const fmtServiceDate = (dateStr?: string | null): string => {
  if (!dateStr) return "";
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
};

// Turn a stored arrival window into a readable label. Canonical slot ids
// map to ranges; already-human "8:00 AM - 9:00 AM" strings pass through.
const fmtArrivalWindow = (slot?: string | null): string => {
  if (!slot) return "";
  const map: Record<string, string> = {
    "8-12": "8:00 AM – 12:00 PM",
    "12-16": "12:00 PM – 4:00 PM",
    "16-20": "4:00 PM – 8:00 PM",
  };
  return map[slot] || slot.replace(/\s*-\s*/, " – ");
};

// Prefer the booking's canonical date + arrival window (what the customer
// actually booked) over the tz-naive job timestamp.
const whenLabel = (offer: OfferDetail): string => {
  const date = fmtServiceDate(offer.booking?.service_date);
  const window = fmtArrivalWindow(offer.booking?.time_slot || offer.booking?.arrival_window);
  if (date && window) return `${date} · ${window}`;
  if (date) return date;
  return fmtWhen(offer.job.start_datetime, offer.job.duration_est_hours);
};

export default function CleanerJobOfferPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = String(params?.token || "");

  const [loading, setLoading] = useState(true);
  const [offer, setOffer] = useState<OfferDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<"accept" | "decline" | null>(null);
  const [outcome, setOutcome] = useState<"accepted" | "declined" | "expired" | "taken" | "overlap" | null>(null);
  const [outcomeMsg, setOutcomeMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    void load();
  }, [token]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("get-job-offer", {
        body: { token },
      });
      if (invokeError) throw invokeError;
      if ((data as any)?.error) throw new Error((data as any).error);
      setOffer(data as OfferDetail);
      const status = (data as OfferDetail).assignment.status.toLowerCase();
      if (status === "confirmed" || status === "accepted") setOutcome("accepted");
      else if (status === "declined" || status === "withdrawn") setOutcome("declined");
      else if (status === "expired") setOutcome("expired");
    } catch (err: any) {
      setError(err?.message || "Couldn't load this job offer");
    } finally {
      setLoading(false);
    }
  };

  const respond = async (action: "accept" | "decline") => {
    if (!token || !offer) return;
    setActing(action);
    setOutcomeMsg(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("accept-job-offer", {
        body: { token, action },
      });
      if (invokeError) throw invokeError;
      const result = data as { ok: boolean; status: string; reason?: string; message?: string };
      if (!result.ok) {
        if (result.reason === "overlap") {
          setOutcome("overlap");
          setOutcomeMsg(result.message || "This job overlaps with another job you've already accepted.");
        } else if (result.reason === "expired") {
          setOutcome("expired");
        } else if (result.reason === "taken") {
          setOutcome("taken");
          setOutcomeMsg(result.message || "Another cleaner already accepted this job.");
        } else {
          toast.error(result.message || "Couldn't update offer");
        }
      } else {
        setOutcome(action === "accept" ? "accepted" : "declined");
      }
      await load();
    } catch (err: any) {
      toast.error(err?.message || "Failed to update offer");
    } finally {
      setActing(null);
    }
  };

  if (!token) {
    return (
      <ErrorShell title="Missing token" hint="This link looks broken. Ask dispatch to resend." />
    );
  }
  if (loading) {
    return (
      <CenterShell>
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-12 w-full" />
      </CenterShell>
    );
  }
  if (error || !offer) {
    return (
      <ErrorShell
        title="Couldn't load this job offer"
        hint={error || "The link may be invalid or expired."}
      />
    );
  }

  const now = Date.now();
  const expiresAt = offer.assignment.expires_at ? new Date(offer.assignment.expires_at).getTime() : null;
  const isExpired = expiresAt != null && expiresAt < now && outcome == null;

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
              <RiCalendarCheckLine className="w-6 h-6 text-white" />
            </span>
            <div>
              <p className="text-[11px] uppercase tracking-wider font-semibold text-emerald-700">
                Novara · Job offer
              </p>
              <h1 className="text-lg font-bold text-slate-900">
                Hi {offer.cleaner.first_name || "there"}, we've got a job for you
              </h1>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">
        {/* Outcome banner */}
        {outcome === "accepted" && (
          <BannerCard
            tone="emerald"
            icon={RiCheckLine}
            title="Job accepted"
            body="You're locked in. Your job checklist has everything to complete on-site — work through it as you clean, and report any add-ons you did. Address and arrival window are on your dashboard too."
            cta={{ label: "Open your job checklist", onClick: () => router.push(`/cleaner/job-checklist/${token}`) }}
          />
        )}
        {outcome === "declined" && (
          <BannerCard
            tone="slate"
            icon={RiCloseLine}
            title="Offer declined"
            body="Got it. We'll route this job to the next available cleaner."
          />
        )}
        {outcome === "expired" && (
          <BannerCard
            tone="amber"
            icon={RiAlertLine}
            title="This offer has expired"
            body="Sorry — this job has been re-assigned because the response window closed."
          />
        )}
        {outcome === "taken" && (
          <BannerCard
            tone="amber"
            icon={RiAlertLine}
            title="Already claimed"
            body={outcomeMsg || "Another cleaner accepted this job first. Thanks for being quick!"}
          />
        )}
        {outcome === "overlap" && (
          <BannerCard
            tone="rose"
            icon={RiAlertLine}
            title="Schedule conflict"
            body={
              outcomeMsg ||
              "This job overlaps with another active assignment you've already accepted. Decline one to free up the slot."
            }
          />
        )}

        {/* Job card */}
        <Card className="border-slate-200">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-slate-900">
                  {prettyServiceType(offer.job.service_type)}
                </CardTitle>
                <CardDescription>
                  {offer.job.sq_ft ? `${offer.job.sq_ft.toLocaleString()} sq ft · ` : ""}
                  {offer.job.bedrooms ? `${offer.job.bedrooms} bd · ` : ""}
                  {offer.job.bathrooms ? `${offer.job.bathrooms} ba` : ""}
                </CardDescription>
              </div>
              <div className="text-right">
                <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                  You earn
                </p>
                <p className="text-xl font-bold text-emerald-700">
                  {dollars(offer.assignment.estimated_pay_cents)}
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <InfoRow
              icon={RiTimeLine}
              label="When"
              value={whenLabel(offer)}
              hint={offer.job.duration_est_hours ? `~${offer.job.duration_est_hours} hrs on site` : undefined}
            />
            <InfoRow
              icon={RiMapPin2Line}
              label="Where"
              value={`${offer.job.address || "(address revealed on accept)"}${offer.job.city ? `, ${offer.job.city}` : ""}${offer.job.state ? `, ${offer.job.state}` : ""} ${offer.job.zip || ""}`.trim()}
              hint={
                offer.assignment.distance_miles != null
                  ? `${Number(offer.assignment.distance_miles).toFixed(1)} miles from your home base`
                  : undefined
              }
            />
            <InfoRow
              icon={RiHomeLine}
              label="Customer"
              value={offer.customer.first_name || "Customer"}
              hint="The job address & details appear in your dashboard after you accept."
            />
            <InfoRow
              icon={RiMoneyDollarCircleLine}
              label="Revenue share"
              value={
                offer.assignment.estimated_pay_cents
                  ? `${offer.assignment.pay_percentage_snapshot ?? 35}% of job revenue · ${dollars(offer.assignment.estimated_pay_cents)} for you`
                  : "—"
              }
              hint="Pay = job revenue × your tier %, split evenly when multiple cleaners are assigned."
            />
            {offer.job.notes ? (
              <>
                <Separator />
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                    Customer notes
                  </p>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">{offer.job.notes}</p>
                </div>
              </>
            ) : null}

            {expiresAt && !outcome ? (
              <p className="text-[11px] text-slate-500 mt-1">
                Offer auto-expires {new Date(expiresAt).toLocaleString()}
                {isExpired ? " · already past" : ""}.
              </p>
            ) : null}
          </CardContent>
        </Card>

        {!outcome && !isExpired && (
          <div className="grid grid-cols-2 gap-3 sticky bottom-3">
            <Button
              size="lg"
              variant="outline"
              disabled={acting != null}
              onClick={() => respond("decline")}
              className="h-14 border-rose-200 bg-white text-rose-700 hover:bg-rose-50 font-semibold text-base"
            >
              {acting === "decline" ? (
                <RiLoader4Line className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <RiCloseLine className="w-5 h-5 mr-1.5" />
                  Decline
                </>
              )}
            </Button>
            <Button
              size="lg"
              disabled={acting != null}
              onClick={() => respond("accept")}
              className="h-14 bg-gradient-to-br from-emerald-500 to-emerald-700 hover:from-emerald-600 hover:to-emerald-800 text-white font-semibold text-base shadow shadow-emerald-700/20"
            >
              {acting === "accept" ? (
                <RiLoader4Line className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <RiCheckLine className="w-5 h-5 mr-1.5" />
                  Accept job
                </>
              )}
            </Button>
          </div>
        )}

        {outcome === "accepted" && (
          <Button
            variant="outline"
            className="w-full border-slate-200"
            onClick={() => router.push("/cleaner/dashboard")}
          >
            Open my dashboard
          </Button>
        )}

        <p className="text-[11px] text-slate-500 text-center pt-2">
          Tap secure link · Powered by Novara dispatch
        </p>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────

function CenterShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-start justify-center p-4">
      <div className="w-full max-w-2xl space-y-4 mt-6">{children}</div>
    </div>
  );
}

function ErrorShell({ title, hint }: { title: string; hint?: string }) {
  return (
    <CenterShell>
      <Card className="border-rose-200 bg-rose-50">
        <CardContent className="text-center py-10 space-y-2">
          <RiAlertLine className="w-10 h-10 text-rose-600 mx-auto" />
          <h2 className="font-semibold text-rose-900">{title}</h2>
          {hint ? <p className="text-sm text-rose-800">{hint}</p> : null}
          <Button
            variant="outline"
            className="mt-3 border-rose-300 text-rose-800"
            onClick={() => (window.location.href = "/cleaner/dashboard")}
          >
            <RiArrowLeftLine className="w-4 h-4 mr-1.5" />
            Go to dashboard
          </Button>
        </CardContent>
      </Card>
    </CenterShell>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof RiTimeLine;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-9 h-9 rounded-md bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4" />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">{label}</p>
        <p className="text-sm text-slate-900">{value}</p>
        {hint ? <p className="text-[11px] text-slate-500">{hint}</p> : null}
      </div>
    </div>
  );
}

function BannerCard({
  tone,
  icon: Icon,
  title,
  body,
  cta,
}: {
  tone: "emerald" | "slate" | "amber" | "rose";
  icon: typeof RiCheckLine;
  title: string;
  body: string;
  cta?: { label: string; onClick: () => void };
}) {
  const map = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-900",
    slate:   "border-slate-200 bg-slate-50 text-slate-800",
    amber:   "border-amber-200 bg-amber-50 text-amber-900",
    rose:    "border-rose-200 bg-rose-50 text-rose-900",
  }[tone];
  return (
    <Card className={cn("border", map)}>
      <CardContent className="p-4 flex items-start gap-3">
        <Icon className="w-5 h-5 mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="font-semibold">{title}</p>
          <p className="text-sm opacity-90">{body}</p>
          {cta ? (
            <Button
              size="sm"
              variant="outline"
              onClick={cta.onClick}
              className="mt-2 bg-white"
            >
              {cta.label}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
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
