"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  RiSearchLine,
  RiLoader4Line,
  RiCalendarLine,
  RiMapPinLine,
  RiTimeLine,
  RiMoneyDollarCircleLine,
  RiCheckboxCircleLine,
  RiPlayCircleLine,
  RiStopCircleLine,
  RiArrowLeftLine,
  RiPhoneLine,
  RiMailLine,
  RiNavigationLine,
  RiCalendarCheckLine,
  RiSparklingLine,
  RiExternalLinkLine,
} from "@remixicon/react";
import { format, isFuture, isPast } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { SEO } from "@/components/SEO";

const logo = "/novara-logo.png";

interface Job {
  id: string;
  booking_id?: string;
  service_date: string;
  time_slot: string;
  service_type: string;
  status: string;
  address: string;
  city: string;
  state: string;
  zip_code: string;
  total_estimate_cents: number;
  cleaner_payout_cents?: number | null;
  home_size_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  service_duration?: number;
  checked_in?: boolean;
  check_in_time?: string;
  cleaner_id?: string;
}

function getStatusConfig(status: string) {
  const configs: Record<string, { label: string; class: string; dot: string }> = {
    confirmed: { label: "Scheduled", class: "bg-blue-50 text-blue-700 border-blue-200", dot: "bg-blue-500" },
    assigned: { label: "Assigned", class: "bg-blue-50 text-blue-700 border-blue-200", dot: "bg-blue-500" },
    accepted: { label: "Accepted", class: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
    in_progress: { label: "In Progress", class: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500" },
    completed: { label: "Completed", class: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
    cancelled: { label: "Cancelled", class: "bg-red-50 text-red-600 border-red-200", dot: "bg-red-500" },
  };
  return configs[status] || { label: status, class: "bg-muted text-muted-foreground", dot: "bg-muted-foreground" };
}

export default function ContractorJobs() {
  const [lookupType, setLookupType] = useState<"email" | "phone">("email");
  const [lookupValue, setLookupValue] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [cleanerName, setCleanerName] = useState("");
  const [cleanerId, setCleanerId] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lookupValue.trim()) {
      toast.error("Please enter your email or phone number");
      return;
    }

    setIsSearching(true);
    setSearched(false);
    try {
      const filterColumn = lookupType === "email" ? "email" : "phone";
      const cleanValue = lookupType === "phone"
        ? lookupValue.replace(/\D/g, "").replace(/^1/, "")
        : lookupValue.trim().toLowerCase();

      const { data: cleaner, error: cleanerErr } = await supabase
        .from("cleaners")
        .select("id, first_name, last_name, email, phone")
        .ilike(filterColumn, lookupType === "phone" ? `%${cleanValue.slice(-10)}%` : cleanValue)
        .maybeSingle();

      if (cleanerErr) throw cleanerErr;

      if (!cleaner) {
        setJobs([]);
        setSearched(true);
        return;
      }

      setCleanerName(`${cleaner.first_name} ${cleaner.last_name}`);
      setCleanerId(cleaner.id);

      const { data: bookingJobs, error: jobErr } = await supabase
        .from("bookings")
        .select("*")
        .eq("cleaner_id", cleaner.id)
        .order("service_date", { ascending: false })
        .limit(30);

      if (jobErr) throw jobErr;
      setJobs(bookingJobs || []);
      setSearched(true);
    } catch (error: any) {
      console.error("Search error:", error);
      toast.error("Failed to look up jobs");
    } finally {
      setIsSearching(false);
    }
  };

  const handleCheckIn = async (job: Job) => {
    setActionLoading(job.id);
    try {
      // job.id here is a BOOKING id (this page queries the bookings
      // table directly). The job-check-in function expects the
      // job_assignments row id, so resolve it via the booking + cleaner
      // pair. Falls back to flipping `bookings.status` directly when no
      // assignment row exists (admin-assigned bookings).
      const { data: assignment } = await supabase
        .from("job_assignments")
        .select("id")
        .eq("job_id", job.id)
        .eq("cleaner_id", cleanerId)
        .maybeSingle();

      if (assignment?.id) {
        const response = await supabase.functions.invoke("job-check-in", {
          body: {
            jobAssignmentId: assignment.id,
            action: "check_in",
            cleanerId,
          },
        });
        if (response.error) throw response.error;
      } else {
        // No assignment row — mark the booking in_progress directly so
        // the cleaner can still complete the job afterward.
        const { error } = await supabase
          .from("bookings")
          .update({
            status: "in_progress",
            check_in_at: new Date().toISOString(),
          } as any)
          .eq("id", job.id)
          .eq("cleaner_id", cleanerId);
        if (error) throw error;
      }
      toast.success("Checked in successfully!");
      setJobs((prev) =>
        prev.map((j) => j.id === job.id ? { ...j, checked_in: true, check_in_time: new Date().toISOString(), status: "in_progress" } : j)
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
      // The public /contractor/jobs portal has no JWT — `complete-booking`
      // therefore needs `cleanerId` in the body so it can verify the
      // caller matches `bookings.cleaner_id`. Without it the function
      // returns "Unauthorized" (the symptom previously reported as
      // "Failed to complete job" with no useful error in the toast).
      const response = await supabase.functions.invoke("complete-booking", {
        body: {
          bookingId: job.booking_id || job.id,
          cleanerId,
        },
      });
      if (response.error) throw response.error;
      toast.success("Job marked as completed! Payout will be processed.");
      setJobs((prev) =>
        prev.map((j) => j.id === job.id ? { ...j, status: "completed" } : j)
      );
    } catch (error: any) {
      toast.error(error.message || "Failed to complete job");
    } finally {
      setActionLoading(null);
    }
  };

  const getMapsUrl = (job: Job) =>
    `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${job.address}, ${job.city}, ${job.state} ${job.zip_code}`)}`;

  const getCalendarUrl = (job: Job) => {
    const date = job.service_date.replace(/-/g, "");
    const title = encodeURIComponent(`Cleaning - ${job.service_type}`);
    const location = encodeURIComponent(`${job.address}, ${job.city}, ${job.state} ${job.zip_code}`);
    const details = encodeURIComponent(`Client: ${job.first_name} ${job.last_name}\nService: ${job.service_type}\nAddress: ${job.address}, ${job.city}`);
    return `https://www.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${date}/${date}&details=${details}&location=${location}`;
  };

  const handleReset = () => {
    setSearched(false);
    setJobs([]);
    setCleanerName("");
    setCleanerId("");
    setLookupValue("");
  };

  const upcomingJobs = jobs.filter((j) => isFuture(new Date(j.service_date)) && j.status !== "cancelled" && j.status !== "completed");
  const completedJobs = jobs.filter((j) => j.status === "completed");
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

            {/* Upcoming / Active Jobs */}
            {upcomingJobs.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest px-1">Upcoming & Active ({upcomingJobs.length})</h2>
                {upcomingJobs.map((job) => {
                  const sc = getStatusConfig(job.status);
                  const isActive = job.status === "in_progress" || job.checked_in;
                  const loading = actionLoading === job.id;
                  return (
                    <Card key={job.id} className={cn("shadow-sm hover:shadow-md transition-shadow", isActive && "border-amber-300 bg-amber-50/30")}>
                      <CardContent className="p-4 md:p-5 space-y-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <div className="text-center min-w-[48px] py-2 px-3 rounded-xl bg-primary/5">
                              <p className="text-[10px] uppercase tracking-wider font-semibold text-primary">{format(new Date(job.service_date), "MMM")}</p>
                              <p className="text-xl font-bold leading-tight">{format(new Date(job.service_date), "d")}</p>
                            </div>
                            <div>
                              <p className="font-semibold text-sm">{format(new Date(job.service_date), "EEEE")}</p>
                              <p className="text-xs text-muted-foreground flex items-center gap-1">
                                <RiTimeLine className="w-3 h-3" />{job.time_slot}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className={cn("text-[10px]", sc.class)}>
                              <span className={cn("w-1.5 h-1.5 rounded-full mr-1", sc.dot)} />{sc.label}
                            </Badge>
                            <span className="font-bold text-primary text-sm">${((job.cleaner_payout_cents ?? Math.floor(job.total_estimate_cents * 0.40)) / 100).toFixed(0)}</span>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3 rounded-xl bg-muted/30 text-xs">
                          <div className="flex items-center gap-2">
                            <RiMapPinLine className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                            <span className="truncate">{job.address}, {job.city}, {job.state}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <RiSparklingLine className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                            <span>{job.service_type} &middot; {job.home_size_id}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <RiPhoneLine className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                            <span>{job.first_name} {job.last_name}</span>
                          </div>
                          {job.check_in_time && (
                            <div className="flex items-center gap-2 text-amber-600">
                              <RiPlayCircleLine className="w-3.5 h-3.5 flex-shrink-0" />
                              <span>Checked in at {format(new Date(job.check_in_time), "h:mm a")}</span>
                            </div>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <Button variant="outline" size="sm" className="text-xs h-8" onClick={() => window.open(getMapsUrl(job), "_blank")}>
                            <RiNavigationLine className="w-3.5 h-3.5 mr-1" />Directions
                          </Button>
                          <Button variant="outline" size="sm" className="text-xs h-8" onClick={() => window.open(getCalendarUrl(job), "_blank")}>
                            <RiCalendarCheckLine className="w-3.5 h-3.5 mr-1" />Calendar
                          </Button>

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
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}

            {/* Completed Jobs */}
            {completedJobs.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest px-1">Completed ({completedJobs.length})</h2>
                {completedJobs.slice(0, 10).map((job) => (
                  <Card key={job.id} className="bg-muted/20 border-border/60 shadow-none">
                    <CardContent className="p-3.5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="text-center min-w-[40px]">
                            <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{format(new Date(job.service_date), "MMM")}</p>
                            <p className="text-base font-bold leading-tight">{format(new Date(job.service_date), "d")}</p>
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate">{job.service_type}</p>
                            <p className="text-xs text-muted-foreground truncate">{job.address}, {job.city}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">
                            <RiCheckboxCircleLine className="w-3 h-3 mr-0.5" />Done
                          </Badge>
                          <span className="text-sm font-semibold text-emerald-600">${((job.cleaner_payout_cents ?? Math.floor(job.total_estimate_cents * 0.40)) / 100).toFixed(0)}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {upcomingJobs.length === 0 && completedJobs.length === 0 && (
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
