"use client";
export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  RefreshCcw,
  MapPin,
  Clock,
  User,
  AlertTriangle,
  CheckCircle,
  Zap,
  Calendar,
  Users,
} from "lucide-react";
import { toast } from "sonner";

interface Job {
  id: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  service_type: string;
  start_datetime: string;
  duration_est_hours: number;
  min_cleaners_required: number;
  status: string;
  notes: string | null;
  manual_intervention_required: boolean | null;
  dispatch_alert_reason: string | null;
  customers?: {
    first_name: string;
    last_name: string;
    email: string;
    phone: string | null;
  };
  job_assignments?: {
    id: string;
    status: string;
    role: string;
    cleaners: {
      id: string;
      first_name: string;
      last_name: string;
    };
  }[];
}

interface Cleaner {
  id: string;
  first_name: string;
  last_name: string;
}

interface DispatchAlert {
  id: string;
  job_id: string;
  reason: string;
  severity: string;
  created_at: string;
  resolved: boolean | null;
}

export default function DispatchQueuePage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [cleaners, setCleaners] = useState<Cleaner[]>([]);
  const [alerts, setAlerts] = useState<DispatchAlert[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [selectedCleaner, setSelectedCleaner] = useState("");
  const [isAssigning, setIsAssigning] = useState(false);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      // Fetch pending jobs
      const { data: jobsData, error: jobsError } = await supabase
        .from("jobs")
        .select(`
          *,
          customers (first_name, last_name, email, phone),
          job_assignments (
            id,
            status,
            role,
            cleaners (id, first_name, last_name)
          )
        `)
        .in("status", ["pending", "dispatching", "assigned"])
        .order("start_datetime");

      if (jobsError) throw jobsError;
      setJobs(jobsData || []);

      // Fetch active cleaners
      const { data: cleanersData } = await supabase
        .from("cleaners")
        .select("id, first_name, last_name")
        .eq("status", "active")
        .order("first_name");

      setCleaners(cleanersData || []);

      // Fetch unresolved alerts
      const { data: alertsData } = await supabase
        .from("dispatch_alerts")
        .select("*")
        .eq("resolved", false)
        .order("created_at", { ascending: false });

      setAlerts(alertsData || []);
    } catch (error) {
      console.error("Error fetching dispatch data:", error);
      toast.error("Failed to load dispatch data");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAutoDispatch = async (job: Job) => {
    try {
      const { error } = await supabase.functions.invoke("auto-dispatch-booking", {
        body: { jobId: job.id },
      });

      if (error) throw error;

      toast.success("Auto-dispatch triggered");
      fetchData();
    } catch (error) {
      console.error("Error auto-dispatching:", error);
      toast.error("Failed to auto-dispatch");
    }
  };

  const handleManualAssign = async () => {
    if (!selectedJob || !selectedCleaner) return;

    setIsAssigning(true);
    try {
      const { error } = await supabase.functions.invoke("assign-cleaner", {
        body: {
          jobId: selectedJob.id,
          cleanerId: selectedCleaner,
          role: "lead",
        },
      });

      if (error) throw error;

      toast.success("Cleaner assigned");
      setAssignDialogOpen(false);
      setSelectedJob(null);
      setSelectedCleaner("");
      fetchData();
    } catch (error) {
      console.error("Error assigning cleaner:", error);
      toast.error("Failed to assign cleaner");
    } finally {
      setIsAssigning(false);
    }
  };

  const resolveAlert = async (alertId: string) => {
    try {
      const { error } = await supabase
        .from("dispatch_alerts")
        .update({ resolved: true, resolved_at: new Date().toISOString() })
        .eq("id", alertId);

      if (error) throw error;

      toast.success("Alert resolved");
      fetchData();
    } catch (error) {
      console.error("Error resolving alert:", error);
      toast.error("Failed to resolve alert");
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="outline">Pending</Badge>;
      case "dispatching":
        return <Badge variant="secondary">Dispatching</Badge>;
      case "assigned":
        return <Badge>Assigned</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const pendingJobs = jobs.filter((j) => j.status === "pending");
  const dispatchingJobs = jobs.filter((j) => j.status === "dispatching");
  const assignedJobs = jobs.filter((j) => j.status === "assigned");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dispatch Queue</h1>
          <p className="text-muted-foreground">
            Manage job assignments and dispatch cleaners
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/portal/dispatch/calendar">
            <Button variant="outline">
              <Calendar className="mr-2 h-4 w-4" />
              Calendar View
            </Button>
          </Link>
          <Button variant="outline" onClick={fetchData}>
            <RefreshCcw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <Card className="border-orange-200 bg-orange-50/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-orange-700">
              <AlertTriangle className="h-5 w-5" />
              Dispatch Alerts ({alerts.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className="flex items-center justify-between rounded-lg border border-orange-200 bg-white p-3"
              >
                <div>
                  <p className="font-medium text-orange-800">{alert.reason}</p>
                  <p className="text-sm text-muted-foreground">
                    {format(parseISO(alert.created_at), "MMM d, h:mm a")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="border-orange-300 text-orange-700">
                    {alert.severity}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => resolveAlert(alert.id)}
                  >
                    <CheckCircle className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Pending Assignment
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pendingJobs.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Dispatching
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dispatchingJobs.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Assigned Today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{assignedJobs.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* Queue */}
      <Card>
        <CardHeader>
          <CardTitle>Jobs Queue</CardTitle>
          <CardDescription>
            Jobs awaiting cleaner assignment
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-32 w-full" />
              ))}
            </div>
          ) : jobs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No jobs in the dispatch queue
            </div>
          ) : (
            <div className="space-y-4">
              {jobs.map((job) => (
                <Card key={job.id}>
                  <CardContent className="pt-4">
                    <div className="flex items-start justify-between">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          {getStatusBadge(job.status)}
                          <Badge variant="outline">{job.service_type}</Badge>
                          {job.manual_intervention_required && (
                            <Badge variant="destructive" className="gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              Manual Intervention
                            </Badge>
                          )}
                        </div>
                        
                        <div className="flex items-center gap-4 text-sm">
                          <span className="flex items-center gap-1">
                            <Clock className="h-4 w-4 text-muted-foreground" />
                            {format(parseISO(job.start_datetime), "MMM d, h:mm a")}
                          </span>
                          <span className="text-muted-foreground">
                            {job.duration_est_hours}h estimated
                          </span>
                        </div>

                        <div className="flex items-start gap-1 text-sm">
                          <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground" />
                          <span>
                            {job.address}, {job.city}, {job.state} {job.zip}
                          </span>
                        </div>

                        {job.customers && (
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <User className="h-4 w-4" />
                            {job.customers.first_name} {job.customers.last_name}
                          </div>
                        )}

                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <Users className="h-4 w-4" />
                          {job.min_cleaners_required} cleaner{job.min_cleaners_required > 1 ? "s" : ""} needed
                        </div>

                        {/* Current assignments */}
                        {job.job_assignments && job.job_assignments.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {job.job_assignments.map((assignment) => (
                              <Badge
                                key={assignment.id}
                                variant={
                                  assignment.status === "accepted"
                                    ? "default"
                                    : assignment.status === "pending"
                                    ? "outline"
                                    : "secondary"
                                }
                              >
                                {assignment.cleaners.first_name} {assignment.cleaners.last_name}
                                {" "}({assignment.status})
                              </Badge>
                            ))}
                          </div>
                        )}

                        {job.dispatch_alert_reason && (
                          <p className="text-sm text-orange-600 mt-2">
                            ⚠️ {job.dispatch_alert_reason}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-col gap-2">
                        <Button
                          size="sm"
                          onClick={() => handleAutoDispatch(job)}
                        >
                          <Zap className="mr-2 h-4 w-4" />
                          Auto-Dispatch
                        </Button>
                        <Dialog open={assignDialogOpen && selectedJob?.id === job.id} onOpenChange={(open) => {
                          setAssignDialogOpen(open);
                          if (open) setSelectedJob(job);
                        }}>
                          <DialogTrigger asChild>
                            <Button variant="outline" size="sm">
                              Manual Assign
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Assign Cleaner</DialogTitle>
                              <DialogDescription>
                                Select a cleaner to assign to this job
                              </DialogDescription>
                            </DialogHeader>
                            <Select value={selectedCleaner} onValueChange={setSelectedCleaner}>
                              <SelectTrigger>
                                <SelectValue placeholder="Select a cleaner" />
                              </SelectTrigger>
                              <SelectContent>
                                {cleaners.map((cleaner) => (
                                  <SelectItem key={cleaner.id} value={cleaner.id}>
                                    {cleaner.first_name} {cleaner.last_name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <DialogFooter>
                              <Button
                                onClick={handleManualAssign}
                                disabled={!selectedCleaner || isAssigning}
                              >
                                {isAssigning ? "Assigning..." : "Assign"}
                              </Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
