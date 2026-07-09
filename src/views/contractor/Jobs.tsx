"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  RiSearchLine,
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
} from "@remixicon/react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format, isFuture } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { SEO } from "@/components/SEO";

const logo = "/novara-logo.png";

interface JobPay {
  actualCents: number | null;
  baseCents?: number | null;
  extrasCents?: number;
  estimateCents: number | null;
  displayCents: number | null;
  isActual: boolean;
  status: "paid" | "pending" | null;
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
  jobValueCents: number | null;
  estimateCents: number | null;
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
    pending_review: { label: "Submitted — under review", class: "bg-violet-50 text-violet-700 border-violet-200", dot: "bg-violet-500" },
    completed: { label: "Completed", class: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
    cancelled: { label: "Cancelled", class: "bg-red-50 text-red-600 border-red-200", dot: "bg-red-500" },
  };
  return configs[status] || { label: status, class: "bg-muted text-muted-foreground", dot: "bg-muted-foreground" };
}

// Pay chip: shows the ACTUAL payout (green when paid, amber when pending) and
// only falls back to a labelled estimate when no payout has been recorded yet.
function PayChip({ pay }: { pay: JobPay }) {
  const amt = money(pay.displayCents);
  if (pay.isActual && pay.status === "paid") {
    return (
      <span className="inline-flex flex-col items-end">
        <span className="font-bold text-emerald-600 text-sm">{amt}</span>
        <span className="text-[10px] font-medium text-emerald-600">Paid</span>
      </span>
    );
  }
  if (pay.isActual && pay.status === "pending") {
    return (
      <span className="inline-flex flex-col items-end">
        <span className="font-bold text-amber-600 text-sm">{amt}</span>
        <span className="text-[10px] font-medium text-amber-600">Payout pending</span>
      </span>
    );
  }
  return (
    <span className="inline-flex flex-col items-end">
      <span className="font-bold text-primary text-sm">{amt}</span>
      <span className="text-[10px] font-medium text-muted-foreground">Estimate</span>
    </span>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === "" ) return null;
  return (
    <div className="flex items-start justify-between gap-3 py-0.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
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
    <div className="rounded-xl border border-border/60 bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium"
      >
        <span className="flex items-center gap-1.5">
          <RiInformationLine className="w-3.5 h-3.5 text-primary" /> View job details
        </span>
        <RiArrowDownSLine className={cn("w-4 h-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-3">
          {cd && (
            <div className="rounded-lg bg-background border border-border/50 p-2.5">
              <p className="text-[11px] font-semibold text-slate-900 flex items-center gap-1 mb-1">
                <RiUser3Line className="w-3.5 h-3.5 text-primary" /> Customer details
              </p>
              <DetailRow label="Service" value={titleCase(job.serviceType)} />
              <DetailRow label="Home" value={homeBits || (job.homeSizeId ? titleCase(job.homeSizeId) : null)} />
              <DetailRow label="Dwelling" value={cd.dwellingType ? titleCase(cd.dwellingType) : null} />
              <DetailRow label="Flooring" value={cd.flooringType ? titleCase(cd.flooringType) : null} />
              <DetailRow label="Pets" value={cd.pets ? titleCase(cd.pets) : null} />
              <DetailRow label="Frequency" value={cd.frequency ? titleCase(cd.frequency) : null} />
              <DetailRow
                label="Add-ons"
                value={cd.addOns.length ? cd.addOns.map(addonLabel).join(", ") : null}
              />
              <DetailRow label="Access notes" value={cd.accessNotes} />
            </div>
          )}
          {id && (
            <div className="rounded-lg bg-background border border-border/50 p-2.5">
              <p className="text-[11px] font-semibold text-slate-900 flex items-center gap-1 mb-1">
                <RiToolsLine className="w-3.5 h-3.5 text-primary" /> Internal / office
              </p>
              <DetailRow label="Job value" value={money(id.jobValueCents)} />
              <DetailRow
                label="Your pay"
                value={
                  <span className={cn(
                    job.pay.status === "paid" ? "text-emerald-600" : job.pay.status === "pending" ? "text-amber-600" : "",
                  )}>
                    {money(job.pay.displayCents)}
                    {job.pay.isActual
                      ? job.pay.status === "paid" ? " · paid" : " · pending"
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

export default function ContractorJobs() {
  const [lookupType, setLookupType] = useState<"email" | "phone">("email");
  const [lookupValue, setLookupValue] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [cleanerName, setCleanerName] = useState("");
  const [cleanerId, setCleanerId] = useState("");
  const [summary, setSummary] = useState<{ lifetimePaidCents: number; pendingCents: number; paidJobs: number } | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [crewMembers, setCrewMembers] = useState<{ id: string; first_name: string; last_name: string }[]>([]);
  const [handoffJobId, setHandoffJobId] = useState<string | null>(null);
  const [handoffTarget, setHandoffTarget] = useState<string>("");

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lookupValue.trim()) {
      toast.error("Please enter your email or phone number");
      return;
    }

    setIsSearching(true);
    setSearched(false);
    try {
      // Resolve the cleaner (also gives us crew_id for hand-off) — the enriched
      // jobs + actual pay come from the get-cleaner-portal edge function since
      // manual_payouts is not client-readable.
      const filterColumn = lookupType === "email" ? "email" : "phone";
      const cleanValue = lookupType === "phone"
        ? lookupValue.replace(/\D/g, "").replace(/^1/, "")
        : lookupValue.trim().toLowerCase();

      const { data: cleaner, error: cleanerErr } = await (supabase.from as any)("cleaners")
        .select("id, first_name, last_name, crew_id")
        .ilike(filterColumn, lookupType === "phone" ? `%${cleanValue.slice(-10)}%` : cleanValue)
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

      const { data, error } = await supabase.functions.invoke("get-cleaner-portal", {
        body: { cleanerId: cleaner.id },
      });
      if (error) throw error;
      const res = data as { ok?: boolean; jobs?: Job[]; summary?: typeof summary };
      if (!res?.ok) throw new Error("Could not load jobs");
      setJobs(res.jobs || []);
      setSummary(res.summary || null);
      setSearched(true);
    } catch (error: any) {
      console.error("Search error:", error);
      toast.error("Failed to look up jobs");
      setSearched(true);
    } finally {
      setIsSearching(false);
    }
  };

  const handleCheckIn = async (job: Job) => {
    setActionLoading(job.id);
    try {
      // Prefer the real jobs.id for the assignment lookup; fall back to
      // flipping the booking status directly for admin-assigned bookings.
      const { data: assignment } = job.jobId
        ? await supabase
            .from("job_assignments")
            .select("id")
            .eq("job_id", job.jobId)
            .eq("cleaner_id", cleanerId)
            .maybeSingle()
        : { data: null };

      if (assignment?.id) {
        const response = await supabase.functions.invoke("job-check-in", {
          body: { jobAssignmentId: assignment.id, action: "check_in", cleanerId },
        });
        if (response.error) throw response.error;
      } else {
        const { error } = await supabase
          .from("bookings")
          .update({ status: "in_progress", check_in_at: new Date().toISOString() } as any)
          .eq("id", job.bookingId)
          .eq("cleaner_id", cleanerId);
        if (error) throw error;
      }
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
      setHandoffJobId(null);
      setHandoffTarget("");
    } catch (error: any) {
      toast.error(error.message || "Couldn't hand off the clean");
    } finally {
      setActionLoading(null);
    }
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
    setLookupValue("");
    setCrewMembers([]);
    setHandoffJobId(null);
    setHandoffTarget("");
  };

  const upcomingJobs = jobs.filter(
    (j) => j.status !== "cancelled" && j.status !== "completed" && j.status !== "pending_review" &&
      (isFuture(new Date(j.serviceDate)) || j.status === "in_progress" || j.checkInTime),
  );
  const completedJobs = jobs.filter((j) => j.status === "completed" || j.status === "pending_review");
  const cancelledJobs = jobs.filter((j) => j.status === "cancelled");

  return (
    <div className="min-h-screen bg-background">
      <SEO title="Contractor Job Portal" description="Look up and manage your assigned cleaning jobs. Check in, complete jobs, and view your history." />

      <header className="border-b border-border/50 bg-background/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="container max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2.5">
            <img src={logo} alt="Novara" className="w-8 h-8 rounded-xl shadow-sm" />
            <div>
              <span className="font-bold text-sm block leading-tight">Novara</span>
              <span className="text-[9px] text-muted-foreground uppercase tracking-widest">Contractor Portal</span>
            </div>
          </a>
          {searched && (
            <Button variant="ghost" size="sm" onClick={handleReset}>
              <RiArrowLeftLine className="w-4 h-4 mr-1" /> New Search
            </Button>
          )}
        </div>
      </header>

      <div className="container max-w-4xl mx-auto px-4 py-8 md:py-12">
        {!searched ? (
          <div className="max-w-md mx-auto space-y-8 animate-fade-in">
            <div className="text-center space-y-2">
              <div className="mx-auto w-16 h-16 rounded-2xl flex items-center justify-center shadow-lg mb-4" style={{ background: "var(--gradient-primary)" }}>
                <RiSearchLine className="w-8 h-8 text-white" />
              </div>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Contractor Job Portal</h1>
              <p className="text-muted-foreground text-sm">Look up your jobs to check in, mark complete, or view history</p>
            </div>

            <Card className="shadow-lg border-0">
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
                  <Button type="submit" className="w-full h-11 bg-gradient-primary" disabled={isSearching}>
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
            <div>
              <h1 className="text-xl md:text-2xl font-bold tracking-tight">
                {cleanerName ? `${cleanerName}'s Jobs` : "Your Jobs"}
              </h1>
              <p className="text-sm text-muted-foreground">{jobs.length} job{jobs.length !== 1 ? "s" : ""} found</p>
            </div>

            {summary && (summary.lifetimePaidCents > 0 || summary.pendingCents > 0) && (
              <div className="grid grid-cols-2 gap-3">
                <Card className="border-0 shadow-sm bg-emerald-50/60">
                  <CardContent className="p-3">
                    <p className="text-[11px] font-medium text-emerald-700/80">Paid to you (lifetime)</p>
                    <p className="text-lg font-bold text-emerald-700">{money(summary.lifetimePaidCents)}</p>
                    <p className="text-[10px] text-emerald-700/70">{summary.paidJobs} job{summary.paidJobs === 1 ? "" : "s"} paid</p>
                  </CardContent>
                </Card>
                <Card className="border-0 shadow-sm bg-amber-50/60">
                  <CardContent className="p-3">
                    <p className="text-[11px] font-medium text-amber-700/80">Payout pending</p>
                    <p className="text-lg font-bold text-amber-700">{money(summary.pendingCents)}</p>
                    <p className="text-[10px] text-amber-700/70">Awaiting the office to release</p>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Upcoming / Active Jobs */}
            {upcomingJobs.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest px-1">Upcoming & Active ({upcomingJobs.length})</h2>
                {upcomingJobs.map((job) => {
                  const sc = getStatusConfig(job.status);
                  const isActive = job.status === "in_progress" || !!job.checkInTime;
                  const loading = actionLoading === job.id;
                  return (
                    <Card key={job.id} className={cn("shadow-sm hover:shadow-md transition-shadow", isActive && "border-amber-300 bg-amber-50/30")}>
                      <CardContent className="p-4 md:p-5 space-y-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <div className="text-center min-w-[48px] py-2 px-3 rounded-xl bg-primary/5">
                              <p className="text-[10px] uppercase tracking-wider font-semibold text-primary">{format(new Date(job.serviceDate), "MMM")}</p>
                              <p className="text-xl font-bold leading-tight">{format(new Date(job.serviceDate), "d")}</p>
                            </div>
                            <div>
                              <p className="font-semibold text-sm leading-tight">{job.customerName || "Customer"}</p>
                              <p className="text-xs text-muted-foreground">{titleCase(job.serviceType)}</p>
                              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                                <RiTimeLine className="w-3 h-3" />{format(new Date(job.serviceDate), "EEE")}{job.timeSlot ? ` · ${job.timeSlot}` : ""}
                              </p>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1.5">
                            <Badge variant="outline" className={cn("text-[10px]", sc.class)}>
                              <span className={cn("w-1.5 h-1.5 rounded-full mr-1", sc.dot)} />{sc.label}
                            </Badge>
                            <PayChip pay={job.pay} />
                          </div>
                        </div>

                        <div className="flex items-center gap-2 p-3 rounded-xl bg-muted/30 text-xs">
                          <RiMapPinLine className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                          <span className="truncate">{[job.address, job.city, job.state].filter(Boolean).join(", ")}</span>
                        </div>

                        <JobDetails job={job} />

                        <div className="flex flex-wrap gap-2">
                          <Button variant="outline" size="sm" className="text-xs h-8" onClick={() => window.open(getMapsUrl(job), "_blank")}>
                            <RiNavigationLine className="w-3.5 h-3.5 mr-1" />Directions
                          </Button>
                          <Button variant="outline" size="sm" className="text-xs h-8" onClick={() => window.open(getCalendarUrl(job), "_blank")}>
                            <RiCalendarCheckLine className="w-3.5 h-3.5 mr-1" />Calendar
                          </Button>

                          {job.photoUploadToken && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-xs h-8 border-emerald-200 text-emerald-700"
                              onClick={() => window.open(`${PHOTO_UPLOAD_BASE}${job.photoUploadToken}?phase=before`, "_blank")}
                            >
                              <RiSparklingLine className="w-3.5 h-3.5 mr-1" />Before photos
                            </Button>
                          )}

                          {!isActive && job.status !== "completed" && (
                            <Button size="sm" className="text-xs h-8 bg-blue-600 hover:bg-blue-700" onClick={() => handleCheckIn(job)} disabled={loading}>
                              {loading ? <RiLoader4Line className="w-3.5 h-3.5 animate-spin mr-1" /> : <RiPlayCircleLine className="w-3.5 h-3.5 mr-1" />}
                              Check In
                            </Button>
                          )}

                          {isActive && job.status !== "completed" && (
                            <Button size="sm" className="text-xs h-8 bg-emerald-600 hover:bg-emerald-700" onClick={() => handleComplete(job)} disabled={loading}>
                              {loading ? <RiLoader4Line className="w-3.5 h-3.5 animate-spin mr-1" /> : <RiCheckboxCircleLine className="w-3.5 h-3.5 mr-1" />}
                              Mark Complete
                            </Button>
                          )}

                          {crewMembers.length > 0 && job.status !== "completed" && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-xs h-8"
                              onClick={() => { setHandoffJobId(handoffJobId === job.id ? null : job.id); setHandoffTarget(""); }}
                            >
                              <RiUserSharedLine className="w-3.5 h-3.5 mr-1" />
                              Hand off to crew
                            </Button>
                          )}
                        </div>

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
              </div>
            )}

            {/* Completed Jobs */}
            {completedJobs.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest px-1">Completed &amp; submitted ({completedJobs.length})</h2>
                {completedJobs.slice(0, 12).map((job) => {
                  const photoCount = (job.beforePhotos?.length || 0) + (job.afterPhotos?.length || 0);
                  const uploadHref = job.photoUploadToken ? `${PHOTO_UPLOAD_BASE}${job.photoUploadToken}?phase=after` : null;
                  const viewHref = job.photoViewToken ? `${PHOTO_VIEW_BASE}${job.photoViewToken}` : null;
                  return (
                    <Card key={job.id} className="bg-muted/20 border-border/60 shadow-none">
                      <CardContent className="p-3.5 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="text-center min-w-[40px]">
                              <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{format(new Date(job.serviceDate), "MMM")}</p>
                              <p className="text-base font-bold leading-tight">{format(new Date(job.serviceDate), "d")}</p>
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-sm truncate">{job.customerName || "Customer"}</p>
                              <p className="text-xs text-muted-foreground truncate">{titleCase(job.serviceType)} · {[job.city, job.state].filter(Boolean).join(", ")}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {job.status === "pending_review" ? (
                              <Badge variant="outline" className="text-[10px] bg-violet-50 text-violet-700 border-violet-200">
                                <RiCheckboxCircleLine className="w-3 h-3 mr-0.5" />Under review
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
                                className={cn("text-xs h-7", photoCount === 0 && "bg-emerald-600 hover:bg-emerald-700")}
                                onClick={() => window.open(uploadHref, "_blank")}
                              >
                                <RiSparklingLine className="w-3.5 h-3.5 mr-1" />
                                {photoCount > 0 ? "Add more photos" : "Upload photos"}
                              </Button>
                            )}
                            {viewHref && (
                              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => window.open(viewHref, "_blank")}>
                                <RiExternalLinkLine className="w-3.5 h-3.5 mr-1" />
                                Customer gallery
                              </Button>
                            )}
                            {photoCount > 0 && (
                              <span className="text-[11px] text-muted-foreground">{photoCount} photo{photoCount === 1 ? "" : "s"}</span>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}

            {/* Cancelled — greyed out, no client info, auto-removed after 24h */}
            {cancelledJobs.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest px-1">Cancelled ({cancelledJobs.length})</h2>
                {cancelledJobs.map((job) => (
                  <Card key={job.id} className="bg-muted/30 border-border/50 shadow-none opacity-70">
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
              </div>
            )}

            {upcomingJobs.length === 0 && completedJobs.length === 0 && cancelledJobs.length === 0 && (
              <Card className="border-dashed">
                <CardContent className="py-12 text-center">
                  <p className="text-muted-foreground">No active or past jobs found.</p>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
