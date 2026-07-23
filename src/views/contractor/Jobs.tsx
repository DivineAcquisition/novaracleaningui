"use client";

// ─── /contractor/jobs — public contractor portal ────────────────────────────
//
// Premium, mobile-first job portal for 1099 contractors. Loads enriched jobs
// from get-cleaner-portal: every dollar shown derives from the two REAL pay
// ledgers (custom pay / manual_payouts + extra pay / job_extra_pay), including
// crew-split jobs — never a guessed percentage. Customer phone/email are never
// present in the payload.

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  RiSearchLine,
  RiAlertLine,
  RiLoader4Line,
  RiTimeLine,
  RiMapPinLine,
  RiCheckboxCircleLine,
  RiPlayCircleLine,
  RiArrowLeftLine,
  RiPhoneLine,
  RiMailLine,
  RiNavigationLine,
  RiCalendarCheckLine,
  RiSparklingLine,
  RiExternalLinkLine,
  RiUserSharedLine,
  RiCloseCircleLine,
  RiUser3Line,
  RiInformationLine,
  RiToolsLine,
  RiArrowDownSLine,
  RiWallet3Line,
  RiHourglassLine,
  RiVipCrownLine,
  RiErrorWarningLine,
  RiHandCoinLine,
} from "@remixicon/react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { format, isFuture, differenceInHours } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { SEO } from "@/components/SEO";
import SuspensionBanner from "@/components/cleaner/SuspensionBanner";

const logo = "/novara-logo.png";

interface JobPay {
  actualCents: number | null;
  baseCents?: number | null;
  extrasCents?: number;
  paidCents?: number;
  pendingCents?: number;
  estimateCents: number | null;
  displayCents: number | null;
  isActual: boolean;
  status: "paid" | "partial" | "pending" | null;
  pctPaid: number | null;
}
interface CustomerDetails {
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  dwellingType: string | null;
  flooringType: string | null;
  pets: string | null;
  addOns: string[];
  frequency: string | null;
  accessNotes: string | null;
}
interface InternalDetails {
  estimateCents: number | null;
  baseCents?: number | null;
  extrasCents?: number;
  payoutStatus: string | null;
  payoutNote: string | null;
  dispatchNotes: string | null;
  teamNotes: string | null;
  issuesFlag: boolean;
  issuesNotes: string | null;
}
interface Job {
  id: string;
  bookingId: string;
  jobId: string | null;
  bookingNumber: number | null;
  status: string;
  serviceDate: string;
  timeSlot: string | null;
  serviceType: string;
  homeSizeId: string | null;
  customerName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  checkInTime?: string | null;
  cancelledAt?: string | null;
  rescheduledAt?: string | null;
  rescheduledFromDate?: string | null;
  rescheduledFromTimeSlot?: string | null;
  qcToken?: string | null;
  tipCents?: number;
  photoUploadToken?: string | null;
  photoViewToken?: string | null;
  beforePhotos?: string[] | null;
  afterPhotos?: string[] | null;
  pay: JobPay;
  customerDetails: CustomerDetails | null;
  internalDetails: InternalDetails | null;
}

const PHOTO_UPLOAD_BASE = "https://contractor.novaracleaning.com/cleaner/job-photos/";
const PHOTO_VIEW_BASE = "https://try.novaracleaning.com/photos/";

const money = (cents: number | null | undefined) =>
  cents == null ? "—" : `$${(cents / 100).toFixed(2)}`;

const titleCase = (s: string) => s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const ADDON_LABELS: Record<string, string> = {
  deepBathroomDetail: "Deep bathroom detail",
  trashHaul: "Trash haul",
  petHair: "Heavy pet-hair removal",
  basement: "Basement clean",
  insideFridge: "Inside fridge",
  insideOven: "Inside oven",
  insideCabinets: "Inside cabinets",
  interiorWindows: "Interior windows",
  laundry: "Laundry",
  dishes: "Dishes",
};
const addonLabel = (id: string) => ADDON_LABELS[id] || titleCase(id);

function getStatusConfig(status: string) {
  const configs: Record<string, { label: string; class: string; dot: string }> = {
    confirmed: { label: "Scheduled", class: "bg-blue-50 text-blue-700 border-blue-200", dot: "bg-blue-500" },
    assigned: { label: "Assigned", class: "bg-blue-50 text-blue-700 border-blue-200", dot: "bg-blue-500" },
    accepted: { label: "Accepted", class: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
    in_progress: { label: "In Progress", class: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500" },
    pending_review: { label: "Under review", class: "bg-violet-50 text-violet-700 border-violet-200", dot: "bg-violet-500" },
    completed: { label: "Completed", class: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
    cancelled: { label: "Cancelled", class: "bg-red-50 text-red-600 border-red-200", dot: "bg-red-500" },
  };
  return configs[status] || { label: status, class: "bg-muted text-muted-foreground", dot: "bg-muted-foreground" };
}

// Pay chip: real money from the pay ledgers. Green = fully paid, amber =
// pending release, split = partially paid; grey "Est." only when the office
// hasn't recorded pay yet.
function PayChip({ pay }: { pay: JobPay }) {
  const amt = money(pay.displayCents);
  if (pay.isActual && pay.status === "paid") {
    return (
      <span className="inline-flex flex-col items-end leading-tight">
        <span className="font-bold text-emerald-600 text-base tabular-nums">{amt}</span>
        <span className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wide">Paid</span>
      </span>
    );
  }
  if (pay.isActual && pay.status === "partial") {
    return (
      <span className="inline-flex flex-col items-end leading-tight">
        <span className="font-bold text-emerald-600 text-base tabular-nums">{amt}</span>
        <span className="text-[10px] font-semibold text-amber-600">
          {money(pay.paidCents)} paid · {money(pay.pendingCents)} pending
        </span>
      </span>
    );
  }
  if (pay.isActual && pay.status === "pending") {
    return (
      <span className="inline-flex flex-col items-end leading-tight">
        <span className="font-bold text-amber-600 text-base tabular-nums">{amt}</span>
        <span className="text-[10px] font-semibold text-amber-600 uppercase tracking-wide">Payout pending</span>
      </span>
    );
  }
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className="font-bold text-slate-700 text-base tabular-nums">{amt}</span>
      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Est.</span>
    </span>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === "") return null;
  return (
    <div className="flex items-start justify-between gap-3 py-1 border-b border-border/30 last:border-0">
      <span className="text-[11px] text-muted-foreground shrink-0">{label}</span>
      <span className="text-[11px] font-medium text-right">{value}</span>
    </div>
  );
}

// Expandable "Details" panel: customer-provided info + office/internal info.
function JobDetails({ job }: { job: Job }) {
  const [open, setOpen] = useState(false);
  const cd = job.customerDetails;
  const id = job.internalDetails;
  if (!cd && !id) return null;

  const homeBits = [
    cd?.bedrooms != null ? `${cd.bedrooms} bd` : null,
    cd?.bathrooms != null ? `${cd.bathrooms} ba` : null,
    cd?.sqft != null ? `${cd.sqft} sqft` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="rounded-xl border border-border/50 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "w-full flex items-center justify-between px-3.5 py-2.5 text-xs font-medium transition-colors",
          open ? "bg-violet-50/60 text-violet-900" : "bg-muted/20 hover:bg-muted/40",
        )}
      >
        <span className="flex items-center gap-1.5">
          <RiInformationLine className="w-3.5 h-3.5 text-violet-600" /> Job details
        </span>
        <RiArrowDownSLine className={cn("w-4 h-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="p-3 space-y-3 bg-background">
          {cd && (
            <div>
              <p className="text-[10px] font-bold text-violet-700 uppercase tracking-widest flex items-center gap-1 mb-1.5">
                <RiUser3Line className="w-3 h-3" /> Customer
              </p>
              <DetailRow label="Service" value={titleCase(job.serviceType)} />
              <DetailRow label="Home" value={homeBits || (job.homeSizeId ? titleCase(job.homeSizeId) : null)} />
              <DetailRow label="Dwelling" value={cd.dwellingType ? titleCase(cd.dwellingType) : null} />
              <DetailRow label="Flooring" value={cd.flooringType ? titleCase(cd.flooringType) : null} />
              <DetailRow label="Pets" value={cd.pets ? titleCase(cd.pets) : null} />
              <DetailRow label="Frequency" value={cd.frequency ? titleCase(cd.frequency) : null} />
              <DetailRow label="Add-ons" value={cd.addOns.length ? cd.addOns.map(addonLabel).join(", ") : null} />
              <DetailRow label="Access notes" value={cd.accessNotes} />
            </div>
          )}
          {id && (
            <div>
              <p className="text-[10px] font-bold text-violet-700 uppercase tracking-widest flex items-center gap-1 mb-1.5">
                <RiToolsLine className="w-3 h-3" /> Your pay & office notes
              </p>
              <DetailRow
                label="Your pay"
                value={
                  <span className={cn(
                    job.pay.status === "paid" ? "text-emerald-600" : job.pay.status ? "text-amber-600" : "",
                  )}>
                    {money(job.pay.displayCents)}
                    {job.pay.isActual
                      ? job.pay.status === "paid" ? " · paid" : job.pay.status === "partial" ? " · partially paid" : " · pending"
                      : " · estimate"}
                    {job.pay.pctPaid != null ? ` (${job.pay.pctPaid}%)` : ""}
                  </span>
                }
              />
              {!!job.pay.extrasCents && job.pay.extrasCents > 0 && (
                <>
                  <DetailRow label="— Base cut" value={money(job.pay.baseCents ?? job.pay.estimateCents)} />
                  <DetailRow label="— Extras (supplies/mileage/etc.)" value={money(job.pay.extrasCents)} />
                </>
              )}
              {job.pay.status === "partial" && (
                <>
                  <DetailRow label="— Paid so far" value={money(job.pay.paidCents)} />
                  <DetailRow label="— Awaiting release" value={money(job.pay.pendingCents)} />
                </>
              )}
              <DetailRow label="Dispatch notes" value={id.dispatchNotes} />
              <DetailRow label="Office notes" value={id.teamNotes} />
              {id.issuesFlag && <DetailRow label="Issue flagged" value={id.issuesNotes || "Yes"} />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface CleanerScores {
  novara: number | null;
  quality: number | null;
  overall: number | null;
}

interface TipEntry {
  bookingId: string | null;
  bookingRef: string | null;
  amountCents: number;
  totalTipCents: number;
  crewSize: number;
  allocation: "split" | "directed";
  receivedAt: string | null;
}

interface JobOfferEntry {
  assignmentId: string;
  token: string;
  role: string | null;
  status: string;
  expiresAt: string | null;
  serviceType: string;
  serviceDate: string | null;
  timeSlot: string | null;
  city: string | null;
  state: string | null;
  estimatedPayCents: number | null;
}

interface QcSummary {
  last90Days: number;
  bySeverity: Record<string, number>;
}

const LOOKUP_STORAGE_KEY = "novara_contractor_lookup";

export default function ContractorJobs() {
  const [lookupType, setLookupType] = useState<"email" | "phone">("email");
  const [lookupValue, setLookupValue] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [cleanerName, setCleanerName] = useState("");
  const [cleanerId, setCleanerId] = useState("");
  const [cleanerStatus, setCleanerStatus] = useState<string | null>(null);
  const [suspendedUntil, setSuspendedUntil] = useState<string | null>(null);
  const [scores, setScores] = useState<CleanerScores | null>(null);
  const [qcSummary, setQcSummary] = useState<QcSummary | null>(null);
  const [offers, setOffers] = useState<JobOfferEntry[]>([]);
  const [tips, setTips] = useState<TipEntry[]>([]);
  const [summary, setSummary] = useState<{ lifetimePaidCents: number; pendingCents: number; paidJobs: number; lifetimeTipsCents?: number } | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [crewMembers, setCrewMembers] = useState<{ id: string; first_name: string; last_name: string }[]>([]);
  const [handoffJobId, setHandoffJobId] = useState<string | null>(null);
  const [handoffTarget, setHandoffTarget] = useState<string>("");
  const [dropJob, setDropJob] = useState<Job | null>(null);
  const [dropReason, setDropReason] = useState("");
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  // ── TRUE LIVE SYNC ─────────────────────────────────────────────────────
  // The portal is the cleaner's source of truth for pay and job status, so
  // it must never go stale:
  //   1. Realtime: any change to this cleaner's bookings, assignments, pay
  //      ledgers (manual_payouts / job_extra_pay), or tips triggers a
  //      server refetch (debounced).
  //   2. 45s poll backstops environments where the socket can't connect.
  //   3. Refetch on tab focus/visibility so returning to the tab is fresh.
  //   4. Every action (check-in, complete, handoff, drop) refetches from
  //      the server after its optimistic update — no more local-only state.
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadJobs = useCallback(async (cid: string, silent = true) => {
    try {
      const { data, error } = await supabase.functions.invoke("get-cleaner-portal", {
        body: { cleanerId: cid },
      });
      if (error) throw error;
      const res = data as { ok?: boolean; jobs?: Job[]; summary?: typeof summary; tips?: TipEntry[]; offers?: JobOfferEntry[]; cleaner?: { scores?: CleanerScores | null; qcSummary?: QcSummary | null } };
      if (!res?.ok) throw new Error("Could not load jobs");
      setJobs(res.jobs || []);
      setSummary(res.summary || null);
      setScores(res.cleaner?.scores || null);
      setQcSummary(res.cleaner?.qcSummary || null);
      setOffers(res.offers || []);
      setTips(res.tips || []);
      setLastSyncedAt(new Date());
    } catch (err) {
      if (!silent) toast.error("Failed to refresh jobs");
      console.error("Portal refresh error:", err);
    }
  }, []);

  const scheduleRefetch = useCallback((cid: string) => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => void loadJobs(cid), 800);
  }, [loadJobs]);

  useEffect(() => {
    if (!cleanerId) return;
    const refresh = () => scheduleRefetch(cleanerId);
    const channel = supabase
      .channel(`contractor-portal-live-${cleanerId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings", filter: `cleaner_id=eq.${cleanerId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "job_assignments", filter: `cleaner_id=eq.${cleanerId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "manual_payouts", filter: `cleaner_id=eq.${cleanerId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "job_extra_pay", filter: `cleaner_id=eq.${cleanerId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "cleaner_tips", filter: `cleaner_id=eq.${cleanerId}` }, refresh)
      .subscribe();
    const poll = setInterval(() => void loadJobs(cleanerId), 45_000);
    const onFocus = () => void loadJobs(cleanerId);
    const onVisible = () => { if (document.visibilityState === "visible") void loadJobs(cleanerId); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
    };
  }, [cleanerId, loadJobs, scheduleRefetch]);

  // Remembered lookup → auto-reload the portal on return visits.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LOOKUP_STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as { type: "email" | "phone"; value: string };
      if (parsed?.value) {
        setLookupType(parsed.type || "email");
        setLookupValue(parsed.value);
        void runLookup(parsed.type || "email", parsed.value);
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runLookup = async (type: "email" | "phone", value: string) => {
    setIsSearching(true);
    setSearched(false);
    try {
      const filterColumn = type === "email" ? "email" : "phone";
      const cleanValue = type === "phone"
        ? value.replace(/\D/g, "").replace(/^1/, "")
        : value.trim().toLowerCase();

      const { data: cleaner, error: cleanerErr } = await (supabase.from as any)("cleaners")
        .select("id, first_name, last_name, crew_id, status, suspended_until")
        .ilike(filterColumn, type === "phone" ? `%${cleanValue.slice(-10)}%` : cleanValue)
        .maybeSingle();
      if (cleanerErr) throw cleanerErr;

      if (!cleaner) {
        setJobs([]);
        setSummary(null);
        setSearched(true);
        return;
      }

      setCleanerName(`${cleaner.first_name} ${cleaner.last_name}`.trim());
      setCleanerId(cleaner.id);
      setCleanerStatus((cleaner as { status?: string | null }).status ?? null);
      setSuspendedUntil((cleaner as { suspended_until?: string | null }).suspended_until ?? null);
      try { localStorage.setItem(LOOKUP_STORAGE_KEY, JSON.stringify({ type, value })); } catch { /* ignore */ }

      if ((cleaner as { crew_id?: string | null }).crew_id) {
        const { data: mates } = await (supabase.from as any)("cleaners")
          .select("id, first_name, last_name")
          .eq("crew_id", (cleaner as { crew_id: string }).crew_id)
          .eq("status", "active")
          .neq("id", cleaner.id)
          .order("first_name");
        setCrewMembers((mates as any[]) || []);
      } else {
        setCrewMembers([]);
      }

      await loadJobs(cleaner.id, false);
      setSearched(true);
    } catch (error: any) {
      console.error("Search error:", error);
      toast.error("Failed to look up jobs");
      setSearched(true);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lookupValue.trim()) {
      toast.error("Please enter your email or phone number");
      return;
    }
    await runLookup(lookupType, lookupValue);
  };

  const handleCheckIn = async (job: Job) => {
    setActionLoading(job.id);
    try {
      const { data: assignment } = job.jobId
        ? await supabase
            .from("job_assignments")
            .select("id")
            .eq("job_id", job.jobId)
            .eq("cleaner_id", cleanerId)
            .maybeSingle()
        : { data: null };

      // Both paths run through job-check-in so the BEFORE-photos SMS and
      // on-time tracking fire — the old raw-bookings fallback skipped both.
      const response = await supabase.functions.invoke("job-check-in", {
        body: assignment?.id
          ? { jobAssignmentId: assignment.id, action: "check_in", cleanerId }
          : { bookingId: job.bookingId, action: "check_in", cleanerId },
      });
      if (response.error) throw response.error;
      toast.success("Checked in successfully!");
      setJobs((prev) =>
        prev.map((j) => (j.id === job.id ? { ...j, checkInTime: new Date().toISOString(), status: "in_progress" } : j)),
      );
    } catch (error: any) {
      toast.error(error.message || "Check-in failed");
    } finally {
      setActionLoading(null);
    }
  };

  const handleComplete = async (job: Job) => {
    setActionLoading(job.id);
    try {
      const response = await supabase.functions.invoke("cleaner-mark-complete", {
        body: { bookingId: job.bookingId, cleanerId },
      });
      if (response.error) throw response.error;
      if ((response.data as { error?: string })?.error) throw new Error((response.data as { error?: string }).error);
      const uploadToken = (response.data as { photoUploadToken?: string | null })?.photoUploadToken || null;
      toast.success("Marked complete and sent to the office for review. Add your before & after photos to release your payout.");
      setJobs((prev) =>
        prev.map((j) => (j.id === job.id ? { ...j, status: "pending_review", photoUploadToken: uploadToken ?? j.photoUploadToken } : j)),
      );
      if (cleanerId) scheduleRefetch(cleanerId);
    } catch (error: any) {
      toast.error(error.message || "Failed to complete job");
    } finally {
      setActionLoading(null);
    }
  };

  const handleHandoff = async (job: Job) => {
    if (!handoffTarget) {
      toast.error("Pick a crew member to hand this clean to.");
      return;
    }
    setActionLoading(`handoff-${job.id}`);
    try {
      const { data, error } = await supabase.functions.invoke("reassign-booking-cleaner", {
        body: { bookingId: job.bookingId, fromCleanerId: cleanerId, toCleanerId: handoffTarget },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const mate = crewMembers.find((m) => m.id === handoffTarget);
      toast.success(`Clean handed off to ${mate ? `${mate.first_name} ${mate.last_name}` : "your crewmate"}.`);
      setJobs((prev) => prev.filter((j) => j.id !== job.id));
      if (cleanerId) scheduleRefetch(cleanerId);
      setHandoffJobId(null);
      setHandoffTarget("");
    } catch (error: any) {
      toast.error(error.message || "Couldn't hand off the clean");
    } finally {
      setActionLoading(null);
    }
  };

  const handleDrop = async () => {
    if (!dropJob) return;
    setActionLoading(`drop-${dropJob.id}`);
    try {
      const { data, error } = await supabase.functions.invoke("cleaner-drop-job", {
        body: { bookingId: dropJob.bookingId, cleanerId, reason: dropReason.trim() || undefined },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Job dropped. The office has been alerted to reassign it.");
      setJobs((prev) => prev.filter((j) => j.id !== dropJob.id));
      if (cleanerId) scheduleRefetch(cleanerId);
      setDropJob(null);
      setDropReason("");
    } catch (error: any) {
      toast.error(error.message || "Couldn't drop the job");
    } finally {
      setActionLoading(null);
    }
  };

  // Hours until a job's service day starts (uses the window's first hour).
  const hoursUntil = (job: Job): number | null => {
    if (!job.serviceDate) return null;
    const startHour = /^(\d{1,2})/.exec(String(job.timeSlot || ""))?.[1] || "8";
    const dt = new Date(`${job.serviceDate}T${startHour.padStart(2, "0")}:00:00`);
    if (Number.isNaN(dt.getTime())) return null;
    return differenceInHours(dt, new Date());
  };

  const getMapsUrl = (job: Job) =>
    `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${job.address}, ${job.city}, ${job.state} ${job.zip}`)}`;

  const getCalendarUrl = (job: Job) => {
    const date = (job.serviceDate || "").replace(/-/g, "");
    const title = encodeURIComponent(`Cleaning - ${job.customerName || job.serviceType}`);
    const location = encodeURIComponent(`${job.address}, ${job.city}, ${job.state} ${job.zip}`);
    const details = encodeURIComponent(`Client: ${job.customerName}\nService: ${job.serviceType}\nAddress: ${job.address}, ${job.city}`);
    return `https://www.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${date}/${date}&details=${details}&location=${location}`;
  };

  const handleReset = () => {
    setSearched(false);
    setJobs([]);
    setSummary(null);
    setCleanerName("");
    setCleanerId("");
    setCleanerStatus(null);
    setSuspendedUntil(null);
    setLookupValue("");
    setCrewMembers([]);
    setHandoffJobId(null);
    setHandoffTarget("");
  };

  // Every non-terminal job lives in Upcoming & Active — including PAST-dated
  // jobs that never got a check-in. Those used to fall through all three
  // buckets and silently disappear, exactly when the office most needed the
  // cleaner to still see them ("yesterday's job is still open").
  const upcomingJobs = jobs.filter(
    (j) => j.status !== "cancelled" && j.status !== "completed" && j.status !== "pending_review",
  );
  const completedJobs = jobs.filter((j) => j.status === "completed" || j.status === "pending_review");
  const cancelledJobs = jobs.filter((j) => j.status === "cancelled");

  const isOverdue = (j: Job) =>
    !j.checkInTime &&
    j.status !== "in_progress" &&
    !!j.serviceDate &&
    !isFuture(new Date(`${String(j.serviceDate).slice(0, 10)}T23:59:59`));

  const initials = cleanerName
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50">
      <SEO title="Contractor Job Portal" description="Look up and manage your assigned cleaning jobs. Check in, complete jobs, and view your history." />

      <header className="border-b border-border/40 bg-white/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="container max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2.5">
            <img src={logo} alt="Novara" className="w-8 h-8 rounded-xl shadow-sm" />
            <div>
              <span className="font-bold text-sm block leading-tight tracking-tight">Novara</span>
              <span className="text-[9px] text-muted-foreground uppercase tracking-[0.18em]">Contractor Portal</span>
            </div>
          </a>
          {searched && (
            <Button variant="ghost" size="sm" onClick={handleReset}>
              <RiArrowLeftLine className="w-4 h-4 mr-1" /> New Search
            </Button>
          )}
        </div>
      </header>

      <div className="container max-w-3xl mx-auto px-4 py-8 md:py-12">
        {!searched ? (
          <div className="max-w-md mx-auto space-y-8 animate-fade-in">
            <div className="text-center space-y-2">
              <div className="mx-auto w-16 h-16 rounded-2xl flex items-center justify-center shadow-lg mb-4 bg-gradient-to-br from-violet-600 to-purple-500">
                <RiSearchLine className="w-8 h-8 text-white" />
              </div>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Contractor Job Portal</h1>
              <p className="text-muted-foreground text-sm">Look up your jobs to check in, mark complete, or view history</p>
            </div>

            <Card className="shadow-xl shadow-violet-100/60 border-0 rounded-2xl">
              <CardContent className="p-6">
                <form onSubmit={handleSearch} className="space-y-5">
                  <Tabs value={lookupType} onValueChange={(v) => setLookupType(v as "email" | "phone")}>
                    <TabsList className="grid w-full grid-cols-2 mb-4">
                      <TabsTrigger value="email" className="text-sm">
                        <RiMailLine className="w-4 h-4 mr-1.5" /> Email
                      </TabsTrigger>
                      <TabsTrigger value="phone" className="text-sm">
                        <RiPhoneLine className="w-4 h-4 mr-1.5" /> Phone
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="email" className="mt-0">
                      <div className="space-y-2">
                        <Label>Your email address</Label>
                        <div className="relative">
                          <RiMailLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                          <Input type="email" placeholder="contractor@example.com" value={lookupValue} onChange={(e) => setLookupValue(e.target.value)} className="pl-10 h-11" required />
                        </div>
                      </div>
                    </TabsContent>
                    <TabsContent value="phone" className="mt-0">
                      <div className="space-y-2">
                        <Label>Your phone number</Label>
                        <div className="relative">
                          <RiPhoneLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                          <Input type="tel" placeholder="(555) 123-4567" value={lookupValue} onChange={(e) => setLookupValue(e.target.value)} className="pl-10 h-11" required />
                        </div>
                      </div>
                    </TabsContent>
                  </Tabs>
                  <Button type="submit" className="w-full h-11 bg-gradient-to-r from-violet-600 to-purple-500 hover:from-violet-700 hover:to-purple-600 text-white font-semibold shadow-md" disabled={isSearching}>
                    {isSearching ? (<><RiLoader4Line className="mr-2 w-4 h-4 animate-spin" />Searching...</>) : (<><RiSearchLine className="mr-2 w-4 h-4" />Find My Jobs</>)}
                  </Button>
                </form>
              </CardContent>
            </Card>

            <p className="text-center text-xs text-muted-foreground">
              Need help? <a href="tel:+18447352070" className="text-primary hover:underline">Call (844) 735-2070</a>
            </p>
          </div>
        ) : jobs.length === 0 ? (
          <div className="max-w-md mx-auto text-center space-y-4 animate-fade-in py-12">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-muted flex items-center justify-center">
              <RiSearchLine className="w-7 h-7 text-muted-foreground" />
            </div>
            <h2 className="text-xl font-bold">No jobs found</h2>
            <p className="text-sm text-muted-foreground">We couldn't find any assigned jobs for that {lookupType}.</p>
            <Button variant="outline" onClick={handleReset}>Try Again</Button>
          </div>
        ) : (
          <div className="space-y-6 animate-fade-in">
            {/* Suspension status — new assignments paused, pay unaffected. */}
            <SuspensionBanner status={cleanerStatus} suspendedUntil={suspendedUntil} />

            {/* ── Hero: identity + real earnings from the pay ledgers ── */}
            <div className="rounded-3xl bg-gradient-to-br from-violet-700 via-violet-600 to-purple-500 p-5 md:p-6 text-white shadow-xl shadow-violet-200/60">
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 rounded-2xl bg-white/15 ring-1 ring-white/25 flex items-center justify-center font-bold text-lg">
                  {initials || <RiVipCrownLine className="w-6 h-6" />}
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-lg leading-tight truncate">{cleanerName || "Your jobs"}</p>
                  <p className="text-[11px] text-violet-100/90">
                    {jobs.length} job{jobs.length !== 1 ? "s" : ""} · Novara Pro
                  </p>
                </div>
              </div>

              {summary && (
                <div className="mt-4 grid grid-cols-3 gap-2.5">
                  <div className="rounded-2xl bg-white/12 ring-1 ring-white/15 backdrop-blur px-3 py-2.5">
                    <p className="text-[10px] uppercase tracking-wider text-violet-100/90 flex items-center gap-1">
                      <RiWallet3Line className="w-3 h-3" /> Paid to you
                    </p>
                    <p className="text-lg font-bold tabular-nums leading-tight">{money(summary.lifetimePaidCents)}</p>
                  </div>
                  <div className="rounded-2xl bg-white/12 ring-1 ring-white/15 backdrop-blur px-3 py-2.5">
                    <p className="text-[10px] uppercase tracking-wider text-violet-100/90 flex items-center gap-1">
                      <RiHourglassLine className="w-3 h-3" /> Pending
                    </p>
                    <p className="text-lg font-bold tabular-nums leading-tight">{money(summary.pendingCents)}</p>
                  </div>
                  <div className="rounded-2xl bg-white/12 ring-1 ring-white/15 backdrop-blur px-3 py-2.5">
                    <p className="text-[10px] uppercase tracking-wider text-violet-100/90 flex items-center gap-1">
                      <RiCheckboxCircleLine className="w-3 h-3" /> Jobs paid
                    </p>
                    <p className="text-lg font-bold tabular-nums leading-tight">{summary.paidJobs}</p>
                  </div>
                </div>
              )}

              {/* Your scores — yours only, never other cleaners'. */}
              {scores && (scores.novara != null || scores.quality != null || scores.overall != null) && (
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  {scores.overall != null && (
                    <span className="text-[10px] font-bold bg-white/20 ring-1 ring-white/25 rounded-full px-2 py-0.5">
                      Overall {Math.round(scores.overall)}
                    </span>
                  )}
                  {scores.novara != null && (
                    <span className="text-[10px] font-semibold bg-white/12 ring-1 ring-white/15 rounded-full px-2 py-0.5">
                      Novara Score {Math.round(scores.novara)}
                    </span>
                  )}
                  {scores.quality != null && (
                    <span className="text-[10px] font-semibold bg-white/12 ring-1 ring-white/15 rounded-full px-2 py-0.5">
                      Rating {Math.round(scores.quality)}
                    </span>
                  )}
                  {(summary?.lifetimeTipsCents || 0) > 0 && (
                    <span className="text-[10px] font-semibold bg-emerald-400/25 ring-1 ring-emerald-200/40 rounded-full px-2 py-0.5">
                      💜 {money(summary!.lifetimeTipsCents!)} in tips
                    </span>
                  )}
                </div>
              )}
              {/* Score transparency: when QC cases are dragging the Rating,
                  say so — a score change should never be unexplainable. */}
              {qcSummary && qcSummary.last90Days > 0 && (
                <p className="mt-1.5 text-[10px] text-amber-200/90">
                  ⚠ {qcSummary.last90Days} QC case{qcSummary.last90Days === 1 ? "" : "s"} in the last 90 days affect{qcSummary.last90Days === 1 ? "s" : ""} your Rating
                  {" "}({Object.entries(qcSummary.bySeverity).map(([s, n]) => `${n} ${s}`).join(", ")}). Ask the office if you have questions.
                </p>
              )}
              <p className="mt-2.5 text-[10px] text-violet-100/70">
                Amounts reflect your actual payouts (base pay + extras like supplies & mileage).
                {lastSyncedAt ? ` Live · synced ${lastSyncedAt.toLocaleTimeString()}` : ""}
              </p>
            </div>

            {/* ── New job OFFERS — missed the SMS? They're here too. ── */}
            {offers.length > 0 && (
              <section className="rounded-3xl bg-gradient-to-br from-blue-600 to-indigo-600 p-4 text-white shadow-lg space-y-2.5">
                <div className="flex items-center justify-between px-1">
                  <h2 className="text-[11px] font-bold uppercase tracking-[0.16em]">
                    🔔 New job offer{offers.length === 1 ? "" : "s"} — respond before they expire
                  </h2>
                  <span className="text-[11px] font-bold bg-white/20 rounded-full px-2 py-0.5">{offers.length}</span>
                </div>
                {offers.map((o) => (
                  <div key={o.assignmentId} className="rounded-2xl bg-white/10 ring-1 ring-white/20 backdrop-blur px-3.5 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold truncate">
                        {titleCase(o.serviceType)}
                        {o.city ? ` · ${o.city}${o.state ? `, ${o.state}` : ""}` : ""}
                      </p>
                      <p className="text-[11px] text-blue-100">
                        {o.serviceDate ? format(new Date(`${String(o.serviceDate).slice(0, 10)}T12:00:00`), "EEE, MMM d") : "Date TBD"}
                        {o.timeSlot ? ` · ${o.timeSlot}` : ""}
                        {o.estimatedPayCents != null ? ` · est. ${money(o.estimatedPayCents)}` : ""}
                        {o.expiresAt ? ` · expires ${new Date(o.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      className="h-9 shrink-0 bg-white text-blue-700 hover:bg-blue-50 font-bold rounded-xl"
                      onClick={() => window.open(`/cleaner/job-offer/${o.token}`, "_blank")}
                    >
                      Review & respond
                    </Button>
                  </div>
                ))}
              </section>
            )}

            {/* ── Tips preview — every tip, 100% yours, separate from job pay ── */}
            {tips.length > 0 && (
              <section className="rounded-3xl bg-white ring-1 ring-emerald-100 shadow-sm p-4 space-y-2.5">
                <div className="flex items-center justify-between px-1">
                  <h2 className="text-[11px] font-bold text-emerald-700 uppercase tracking-[0.16em]">
                    💜 Tips from customers
                  </h2>
                  <span className="text-xs font-bold text-emerald-700 tabular-nums">
                    {money(tips.reduce((s, t) => s + t.amountCents, 0))} total
                  </span>
                </div>
                <div className="space-y-1.5">
                  {tips.slice(0, 5).map((t, i) => (
                    <div key={i} className="flex items-start justify-between gap-2 rounded-xl bg-emerald-50/60 px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 tabular-nums">{money(t.amountCents)}</p>
                        <p className="text-[11px] text-slate-500">
                          {t.bookingRef ? `${t.bookingRef} · ` : ""}
                          {t.allocation === "directed"
                            ? "the customer sent this to you directly"
                            : t.crewSize > 1
                              ? `your equal share of a ${money(t.totalTipCents)} crew tip (split ${t.crewSize} ways)`
                              : "solo job — the full tip is yours"}
                        </p>
                      </div>
                      <span className="text-[10px] text-slate-400 whitespace-nowrap mt-0.5">
                        {t.receivedAt ? new Date(t.receivedAt).toLocaleDateString() : ""}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-slate-400 px-1">
                  100% of every tip goes to the crew — Novara takes nothing, and tips never
                  affect your scores or job pay. Tips are included with your payouts.
                </p>
              </section>
            )}

            {/* ── Upcoming / Active ── */}
            {upcomingJobs.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center gap-2 px-1">
                  <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.16em]">Upcoming & Active</h2>
                  <span className="text-[11px] font-semibold text-violet-700 bg-violet-100 rounded-full px-2 py-0.5">{upcomingJobs.length}</span>
                </div>
                {upcomingJobs.map((job) => {
                  const sc = getStatusConfig(job.status);
                  const isActive = job.status === "in_progress" || !!job.checkInTime;
                  const loading = actionLoading === job.id;
                  return (
                    <Card key={job.id} className={cn(
                      "rounded-2xl border-border/50 shadow-sm hover:shadow-lg hover:shadow-violet-100/50 transition-all",
                      isActive && "ring-2 ring-amber-300/70 bg-amber-50/20",
                    )}>
                      <CardContent className="p-4 md:p-5 space-y-3.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="text-center min-w-[52px] py-2 px-2.5 rounded-2xl bg-gradient-to-b from-violet-50 to-purple-50 border border-violet-100">
                              <p className="text-[10px] uppercase tracking-wider font-bold text-violet-600">{format(new Date(job.serviceDate), "MMM")}</p>
                              <p className="text-xl font-extrabold leading-tight text-slate-900">{format(new Date(job.serviceDate), "d")}</p>
                            </div>
                            <div className="min-w-0">
                              <p className="font-bold text-[15px] leading-tight truncate">{job.customerName || "Customer"}</p>
                              <p className="text-xs text-muted-foreground">{titleCase(job.serviceType)}</p>
                              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                                <RiTimeLine className="w-3 h-3" />{format(new Date(job.serviceDate), "EEE")}{job.timeSlot ? ` · ${job.timeSlot}` : ""}
                              </p>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1.5 shrink-0">
                            <Badge variant="outline" className={cn("text-[10px]", sc.class)}>
                              <span className={cn("w-1.5 h-1.5 rounded-full mr-1", sc.dot)} />{sc.label}
                            </Badge>
                            {isOverdue(job) && (
                              <Badge variant="outline" className="text-[10px] bg-rose-50 text-rose-700 border-rose-300">
                                ⚠ Overdue — check in or contact the office
                              </Badge>
                            )}
                            <PayChip pay={job.pay} />
                          </div>
                        </div>

                        {job.rescheduledAt && (
                          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-1.5 text-[11px] text-amber-900">
                            📅 Rescheduled{job.rescheduledFromDate ? (
                              <> — was {format(new Date(`${String(job.rescheduledFromDate).slice(0, 10)}T12:00:00`), "EEE, MMM d")}{job.rescheduledFromTimeSlot ? ` (${job.rescheduledFromTimeSlot})` : ""}</>
                            ) : ""}. New date above.
                          </div>
                        )}

                        <a
                          href={getMapsUrl(job)}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors text-xs group"
                        >
                          <RiMapPinLine className="w-3.5 h-3.5 text-violet-600 flex-shrink-0" />
                          <span className="truncate">{[job.address, job.city, job.state].filter(Boolean).join(", ")}</span>
                          <RiExternalLinkLine className="w-3 h-3 text-muted-foreground ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                        </a>

                        <JobDetails job={job} />

                        {/* Primary action */}
                        {job.status !== "completed" && (
                          isActive ? (
                            <Button className="w-full h-11 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 text-white font-semibold shadow-md" onClick={() => handleComplete(job)} disabled={loading}>
                              {loading ? <RiLoader4Line className="w-4 h-4 animate-spin mr-1.5" /> : <RiCheckboxCircleLine className="w-4 h-4 mr-1.5" />}
                              Mark job complete
                            </Button>
                          ) : (
                            <Button className="w-full h-11 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 text-white font-semibold shadow-md" onClick={() => handleCheckIn(job)} disabled={loading}>
                              {loading ? <RiLoader4Line className="w-4 h-4 animate-spin mr-1.5" /> : <RiPlayCircleLine className="w-4 h-4 mr-1.5" />}
                              Check in
                            </Button>
                          )
                        )}

                        {/* Utilities */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {/* The qcToken IS the assignment response_token — the
                              same credential the checklist page accepts. The
                              portal never linked the checklist before. */}
                          {job.qcToken && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-9 text-xs rounded-xl border-violet-200 text-violet-700"
                              onClick={() => window.open(`/cleaner/job-checklist/${job.qcToken}`, "_blank")}
                            >
                              <RiCheckboxCircleLine className="w-3.5 h-3.5 mr-1" />Checklist
                            </Button>
                          )}
                          <Button variant="outline" size="sm" className="h-9 text-xs rounded-xl" onClick={() => window.open(getMapsUrl(job), "_blank")}>
                            <RiNavigationLine className="w-3.5 h-3.5 mr-1" />Directions
                          </Button>
                          <Button variant="outline" size="sm" className="h-9 text-xs rounded-xl" onClick={() => window.open(getCalendarUrl(job), "_blank")}>
                            <RiCalendarCheckLine className="w-3.5 h-3.5 mr-1" />Calendar
                          </Button>
                          {job.photoUploadToken && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-9 text-xs rounded-xl border-emerald-200 text-emerald-700"
                              onClick={() => window.open(`${PHOTO_UPLOAD_BASE}${job.photoUploadToken}?phase=before`, "_blank")}
                            >
                              <RiSparklingLine className="w-3.5 h-3.5 mr-1" />Before photos
                            </Button>
                          )}
                        </div>

                        {job.qcToken && (
                          <QcReportBlock job={job} />
                        )}

                        {job.status !== "completed" && (
                          <div className="flex items-center justify-center gap-4">
                            {crewMembers.length > 0 && (
                              <button
                                type="button"
                                onClick={() => { setHandoffJobId(handoffJobId === job.id ? null : job.id); setHandoffTarget(""); }}
                                className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2"
                              >
                                <RiUserSharedLine className="w-3 h-3 inline mr-1" />
                                {handoffJobId === job.id ? "Cancel hand-off" : "Hand off to a crewmate"}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => { setDropJob(job); setDropReason(""); }}
                              className="text-[11px] text-red-500/80 hover:text-red-600 underline underline-offset-2"
                            >
                              <RiHandCoinLine className="w-3 h-3 inline mr-1" />
                              Drop this job
                            </button>
                          </div>
                        )}

                        {handoffJobId === job.id && crewMembers.length > 0 && (
                          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/40 p-3">
                            <span className="text-xs text-muted-foreground">Give this clean to:</span>
                            <Select value={handoffTarget} onValueChange={setHandoffTarget}>
                              <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue placeholder="Pick a crewmate" /></SelectTrigger>
                              <SelectContent>
                                {crewMembers.map((m) => (
                                  <SelectItem key={m.id} value={m.id}>{`${m.first_name} ${m.last_name}`.trim()}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              size="sm"
                              className="text-xs h-8 bg-blue-600 hover:bg-blue-700"
                              onClick={() => handleHandoff(job)}
                              disabled={!handoffTarget || actionLoading === `handoff-${job.id}`}
                            >
                              {actionLoading === `handoff-${job.id}` ? <RiLoader4Line className="w-3.5 h-3.5 animate-spin mr-1" /> : <RiUserSharedLine className="w-3.5 h-3.5 mr-1" />}
                              Confirm hand-off
                            </Button>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </section>
            )}

            {/* ── Completed & submitted ── */}
            {completedJobs.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center gap-2 px-1">
                  <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.16em]">Completed &amp; Submitted</h2>
                  <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-100 rounded-full px-2 py-0.5">{completedJobs.length}</span>
                </div>
                {completedJobs.slice(0, 15).map((job) => {
                  const photoCount = (job.beforePhotos?.length || 0) + (job.afterPhotos?.length || 0);
                  const uploadHref = job.photoUploadToken ? `${PHOTO_UPLOAD_BASE}${job.photoUploadToken}?phase=after` : null;
                  const viewHref = job.photoViewToken ? `${PHOTO_VIEW_BASE}${job.photoViewToken}` : null;
                  return (
                    <Card key={job.id} className="rounded-2xl bg-white border-border/50 shadow-sm">
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="text-center min-w-[44px] py-1.5 px-2 rounded-xl bg-muted/40">
                              <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">{format(new Date(job.serviceDate), "MMM")}</p>
                              <p className="text-base font-bold leading-tight">{format(new Date(job.serviceDate), "d")}</p>
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-sm truncate">{job.customerName || "Customer"}</p>
                              <p className="text-xs text-muted-foreground truncate">{titleCase(job.serviceType)} · {[job.city, job.state].filter(Boolean).join(", ")}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2.5 flex-shrink-0">
                            {job.status === "pending_review" ? (
                              <Badge variant="outline" className="text-[10px] bg-violet-50 text-violet-700 border-violet-200">
                                Under review
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">
                                <RiCheckboxCircleLine className="w-3 h-3 mr-0.5" />Done
                              </Badge>
                            )}
                            <PayChip pay={job.pay} />
                          </div>
                        </div>

                        <JobDetails job={job} />

                        {(uploadHref || viewHref) && (
                          <div className="flex flex-wrap items-center gap-2">
                            {uploadHref && (
                              <Button
                                variant={photoCount > 0 ? "outline" : "default"}
                                size="sm"
                                className={cn("text-xs h-8 rounded-xl", photoCount === 0 && "bg-emerald-600 hover:bg-emerald-700")}
                                onClick={() => window.open(uploadHref, "_blank")}
                              >
                                <RiSparklingLine className="w-3.5 h-3.5 mr-1" />
                                {photoCount > 0 ? "Add more photos" : "Upload photos"}
                              </Button>
                            )}
                            {viewHref && (
                              <Button variant="ghost" size="sm" className="text-xs h-8" onClick={() => window.open(viewHref, "_blank")}>
                                <RiExternalLinkLine className="w-3.5 h-3.5 mr-1" />
                                Customer gallery
                              </Button>
                            )}
                            {photoCount > 0 && (
                              <span className="text-[11px] text-muted-foreground">{photoCount} photo{photoCount === 1 ? "" : "s"}</span>
                            )}
                          </div>
                        )}

                        {job.qcToken && <QcReportBlock job={job} />}
                      </CardContent>
                    </Card>
                  );
                })}
              </section>
            )}

            {/* ── Cancelled — greyed out, no client info, auto-removed after 24h ── */}
            {cancelledJobs.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.16em] px-1">Cancelled ({cancelledJobs.length})</h2>
                {cancelledJobs.map((job) => (
                  <Card key={job.id} className="rounded-2xl bg-muted/30 border-border/40 shadow-none opacity-70">
                    <CardContent className="p-3.5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="text-center min-w-[40px]">
                            <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{format(new Date(job.serviceDate), "MMM")}</p>
                            <p className="text-base font-bold leading-tight text-muted-foreground line-through">{format(new Date(job.serviceDate), "d")}</p>
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-sm text-muted-foreground">{titleCase(job.serviceType || "Cleaning")}</p>
                            <p className="text-xs text-muted-foreground">This job was cancelled — client details removed.</p>
                          </div>
                        </div>
                        <Badge variant="outline" className="text-[10px] bg-red-50 text-red-600 border-red-200 flex-shrink-0">
                          <RiCloseCircleLine className="w-3 h-3 mr-0.5" />Cancelled
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                ))}
                <p className="text-[11px] text-muted-foreground/70 px-1">Cancelled jobs disappear automatically 24 hours after cancellation.</p>
              </section>
            )}

            {upcomingJobs.length === 0 && completedJobs.length === 0 && cancelledJobs.length === 0 && (
              <Card className="border-dashed rounded-2xl">
                <CardContent className="py-12 text-center">
                  <p className="text-muted-foreground">No active or past jobs found.</p>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>

      {/* ── Drop-job confirmation with reliability warning ── */}
      <Dialog open={!!dropJob} onOpenChange={(o) => { if (!o) { setDropJob(null); setDropReason(""); } }}>
        <DialogContent className="max-w-md rounded-2xl">
          {dropJob && (() => {
            const hrs = hoursUntil(dropJob);
            const isLate = hrs != null && hrs < 48;
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-red-600">
                    <RiErrorWarningLine className="w-5 h-5" /> Drop this job?
                  </DialogTitle>
                  <DialogDescription asChild>
                    <div className="space-y-3 pt-1 text-left">
                      <p className="text-sm text-foreground">
                        {dropJob.customerName || "Customer"} · {titleCase(dropJob.serviceType)} ·{" "}
                        {format(new Date(dropJob.serviceDate), "EEE, MMM d")}
                        {dropJob.timeSlot ? ` · ${dropJob.timeSlot}` : ""}
                      </p>

                      {isLate && (
                        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                          <p className="font-bold uppercase tracking-wide mb-0.5">⚠ Less than 48 hours before this job</p>
                          Late drops hurt the most — the office has very little time to find a
                          replacement, and this counts heavily against your reliability score.
                        </div>
                      )}

                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 space-y-1">
                        <p className="font-semibold">Before you drop, please know:</p>
                        <ul className="list-disc list-inside space-y-0.5">
                          <li>Dropped jobs affect your <strong>reliability score</strong>.</li>
                          <li>Frequent drops can mean <strong>fewer jobs assigned to you</strong> in the future.</li>
                          <li>Drops within <strong>48 hours</strong> of the job impact your standing the most.</li>
                        </ul>
                        {crewMembers.length > 0 && (
                          <p className="pt-1">Tip: handing off to a crewmate does <strong>not</strong> count against you.</p>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Reason (helps the office reassign faster)</Label>
                        <Textarea
                          value={dropReason}
                          onChange={(e) => setDropReason(e.target.value)}
                          placeholder="e.g. family emergency, double-booked, sick…"
                          rows={2}
                        />
                      </div>
                    </div>
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter className="flex-col sm:flex-row gap-2">
                  <Button variant="outline" className="w-full sm:w-auto" onClick={() => { setDropJob(null); setDropReason(""); }}>
                    Keep the job
                  </Button>
                  <Button
                    variant="destructive"
                    className="w-full sm:w-auto"
                    onClick={handleDrop}
                    disabled={actionLoading === `drop-${dropJob.id}`}
                  >
                    {actionLoading === `drop-${dropJob.id}` ? (
                      <RiLoader4Line className="w-4 h-4 animate-spin mr-1.5" />
                    ) : null}
                    {isLate ? "Drop anyway (late drop)" : "Drop this job"}
                  </Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── QC report from the field ────────────────────────────────────────────────
// Contractors submit a QC report about the job (damage found, biohazard,
// access problem, quality flag…) straight into the QC hub. Uses the same
// assignment token that powers the job checklist; high severity by default
// per the stop-and-flag SOP, and dispatch is alerted immediately.
const QC_REPORT_TYPES = [
  { id: "quality_flag", label: "Quality / condition issue" },
  { id: "damage", label: "Damage found / caused" },
  { id: "complaint", label: "Customer complaint on site" },
  { id: "other", label: "Something else" },
];

function QcReportBlock({ job }: { job: Job }) {
  const [open, setOpen] = useState(false);
  const [issueType, setIssueType] = useState("quality_flag");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    const description = text.trim();
    if (!description || !job.qcToken) return;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("qc-issues", {
        body: { action: "field_report", token: job.qcToken, issueType, description },
      });
      if (error) throw error;
      if ((data as { ok?: boolean; error?: string })?.ok === false) {
        throw new Error((data as { error?: string })?.error || "Couldn't send report");
      }
      toast.success("QC report sent — dispatch has been alerted.");
      setSent(true);
      setOpen(false);
      setText("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't send report — text dispatch instead");
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <p className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 text-center">
        ✓ QC report submitted — the office has it with this job's photos attached as evidence.
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full text-[11px] font-semibold text-slate-500 hover:text-slate-700 flex items-center justify-center gap-1.5"
        >
          <RiAlertLine className="w-3.5 h-3.5 text-amber-500" />
          Submit a QC report about this job (damage, condition, complaint…)
        </button>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
            <RiAlertLine className="w-4 h-4 text-amber-500" /> QC report — goes straight to the office
          </p>
          <Select value={issueType} onValueChange={setIssueType}>
            <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {QC_REPORT_TYPES.map((t) => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Textarea
            placeholder="What happened? Be specific — this becomes part of the job's QC record with your photos as evidence."
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            className="text-sm"
          />
          <div className="flex gap-2">
            <Button size="sm" className="flex-1 h-9 bg-amber-600 hover:bg-amber-700 text-white" disabled={!text.trim() || sending} onClick={() => void submit()}>
              {sending ? <RiLoader4Line className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <RiAlertLine className="w-3.5 h-3.5 mr-1.5" />}
              Send QC report
            </Button>
            <Button size="sm" variant="ghost" className="h-9" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
