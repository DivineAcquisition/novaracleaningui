import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, RefreshCw, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { format } from "date-fns";

interface Job {
  id: string;
  created_at: string;
  status: string;
  service_type: string;
  address: string;
  city: string;
  state: string;
  start_datetime: string;
  sq_ft: number;
  min_cleaners_required: number;
  manual_intervention_required: boolean;
  dispatch_alert_reason: string | null;
}

interface JobAssignment {
  id: string;
  status: string;
  role: string;
  cleaner_id: string;
  cleaners: {
    first_name: string;
    last_name: string;
  };
}

export default function DispatchQueue() {
  const { toast } = useToast();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [assignments, setAssignments] = useState<Record<string, JobAssignment[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [dispatchingJobId, setDispatchingJobId] = useState<string | null>(null);

  const fetchJobs = async () => {
    try {
      const { data, error } = await supabase
        .from("jobs")
        .select("*")
        .in("status", ["New", "Dispatching", "Assigned"])
        .order("start_datetime", { ascending: true });

      if (error) throw error;

      setJobs(data || []);

      // Fetch assignments for each job
      if (data && data.length > 0) {
        const jobIds = data.map(j => j.id);
        const { data: assignmentsData, error: assignmentsError } = await supabase
          .from("job_assignments")
          .select("*, cleaners(first_name, last_name)")
          .in("job_id", jobIds);

        if (assignmentsError) throw assignmentsError;

        const assignmentsByJob: Record<string, JobAssignment[]> = {};
        assignmentsData?.forEach((assignment: any) => {
          if (!assignmentsByJob[assignment.job_id]) {
            assignmentsByJob[assignment.job_id] = [];
          }
          assignmentsByJob[assignment.job_id].push(assignment);
        });

        setAssignments(assignmentsByJob);
      }
    } catch (error: any) {
      console.error("Error fetching jobs:", error);
      toast({
        title: "Error",
        description: "Failed to load dispatch queue",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  const handleDispatch = async (jobId: string) => {
    setDispatchingJobId(jobId);
    
    try {
      const { data, error } = await supabase.functions.invoke("dispatch-job", {
        body: { jobId }
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: `Assigned ${data.assignedCleaners} cleaner(s) to job`
      });

      fetchJobs();
    } catch (error: any) {
      console.error("Dispatch error:", error);
      toast({
        title: "Dispatch Failed",
        description: error.message || "Failed to assign cleaners",
        variant: "destructive"
      });
    } finally {
      setDispatchingJobId(null);
    }
  };

  const getStatusBadge = (job: Job) => {
    if (job.manual_intervention_required) {
      return <Badge variant="destructive">Manual Required</Badge>;
    }
    
    switch (job.status) {
      case "New":
        return <Badge variant="secondary">New</Badge>;
      case "Dispatching":
        return <Badge variant="outline">Dispatching...</Badge>;
      case "Assigned":
        const jobAssignments = assignments[job.id] || [];
        const confirmedCount = jobAssignments.filter(a => a.status === "Confirmed").length;
        return confirmedCount >= job.min_cleaners_required
          ? <Badge variant="default">Fully Assigned</Badge>
          : <Badge>Partial ({confirmedCount}/{job.min_cleaners_required})</Badge>;
      default:
        return <Badge>{job.status}</Badge>;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Dispatch Queue</h1>
            <p className="text-muted-foreground">
              Manage job assignments and cleaner dispatch
            </p>
          </div>
          <Button onClick={fetchJobs} variant="outline">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">New Jobs</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {jobs.filter(j => j.status === "New").length}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Dispatching</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {jobs.filter(j => j.status === "Dispatching").length}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Assigned</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {jobs.filter(j => j.status === "Assigned").length}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-destructive">
                Need Attention
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-destructive">
                {jobs.filter(j => j.manual_intervention_required).length}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Jobs Table */}
        <Card>
          <CardHeader>
            <CardTitle>Jobs Awaiting Dispatch</CardTitle>
            <CardDescription>
              {jobs.length} job(s) in queue
            </CardDescription>
          </CardHeader>
          <CardContent>
            {jobs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <CheckCircle2 className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>No jobs in dispatch queue</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date/Time</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Required</TableHead>
                    <TableHead>Assigned</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.map((job) => {
                    const jobAssignments = assignments[job.id] || [];
                    const confirmedCount = jobAssignments.filter(a => a.status === "Confirmed").length;
                    
                    return (
                      <TableRow key={job.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Clock className="h-4 w-4 text-muted-foreground" />
                            <div>
                              <div className="font-medium">
                                {format(new Date(job.start_datetime), "MMM d")}
                              </div>
                              <div className="text-sm text-muted-foreground">
                                {format(new Date(job.start_datetime), "h:mm a")}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div>
                            <div className="font-medium">{job.city}, {job.state}</div>
                            <div className="text-sm text-muted-foreground">{job.address}</div>
                          </div>
                        </TableCell>
                        <TableCell>{job.service_type}</TableCell>
                        <TableCell>{job.sq_ft} sq ft</TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {job.min_cleaners_required} cleaner{job.min_cleaners_required > 1 ? 's' : ''}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {jobAssignments.length > 0 ? (
                            <div className="space-y-1">
                              {jobAssignments.map(assignment => (
                                <div key={assignment.id} className="text-sm">
                                  {assignment.cleaners.first_name} {assignment.cleaners.last_name}
                                  <Badge variant="outline" className="ml-2 text-xs">
                                    {assignment.status}
                                  </Badge>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">None</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {getStatusBadge(job)}
                          {job.dispatch_alert_reason && (
                            <div className="flex items-center gap-1 mt-1 text-xs text-destructive">
                              <AlertTriangle className="h-3 w-3" />
                              {job.dispatch_alert_reason}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            onClick={() => handleDispatch(job.id)}
                            disabled={dispatchingJobId === job.id || confirmedCount >= job.min_cleaners_required}
                          >
                            {dispatchingJobId === job.id ? (
                              <>
                                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                Dispatching...
                              </>
                            ) : (
                              "Dispatch"
                            )}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
