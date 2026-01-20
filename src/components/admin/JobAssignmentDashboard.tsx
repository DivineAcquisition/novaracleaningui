/**
 * Job Assignment Dashboard
 * 
 * Admin component for monitoring and managing job assignments.
 * Shows assignment analytics, queue status, and priority escalations.
 */

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Users,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  TrendingUp,
  MapPin,
  Timer,
  Zap,
  AlertCircle
} from "lucide-react";

interface AssignmentAnalytics {
  id: string;
  job_id: string;
  total_cleaners_needed: number;
  total_cleaners_assigned: number;
  total_offers_sent: number;
  total_accepts: number;
  total_declines: number;
  total_expirations: number;
  current_priority: string;
  escalation_count: number;
  status: string;
  avg_response_time_seconds: number | null;
  created_at: string;
  jobs?: {
    id: string;
    city: string;
    state: string;
    zip: string;
    start_datetime: string;
    duration_est_hours: number;
    status: string;
  };
}

interface QueueEntry {
  id: string;
  job_id: string;
  cleaner_id: string;
  priority_level: string;
  queue_position: number;
  match_score: number;
  distance_miles: number;
  status: string;
  response_deadline: string | null;
  cleaners?: {
    first_name: string;
    last_name: string;
    average_rating: number;
  };
}

interface DashboardStats {
  activeJobs: number;
  pendingOffers: number;
  todayAccepts: number;
  todayDeclines: number;
  avgResponseTime: number;
  escalatedJobs: number;
}

export default function JobAssignmentDashboard() {
  const [analytics, setAnalytics] = useState<AssignmentAnalytics[]>([]);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  useEffect(() => {
    loadData();
    
    // Set up real-time subscription
    const channel = supabase
      .channel('assignment-updates')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'job_assignments' },
        () => loadData()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'assignment_analytics' },
        () => loadData()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const loadData = async () => {
    try {
      // Load analytics for recent jobs
      const { data: analyticsData, error: analyticsError } = await supabase
        .from("assignment_analytics")
        .select(`
          *,
          jobs(id, city, state, zip, start_datetime, duration_est_hours, status)
        `)
        .order("created_at", { ascending: false })
        .limit(50);

      if (analyticsError) throw analyticsError;
      setAnalytics(analyticsData || []);

      // Calculate stats
      const today = new Date().toISOString().split('T')[0];
      const activeJobs = analyticsData?.filter(a => a.status === 'in_progress').length || 0;
      const pendingOffers = analyticsData?.reduce((sum, a) => 
        sum + (a.total_offers_sent - a.total_accepts - a.total_declines - a.total_expirations), 0
      ) || 0;
      const todayAnalytics = analyticsData?.filter(a => a.created_at.startsWith(today)) || [];
      const todayAccepts = todayAnalytics.reduce((sum, a) => sum + a.total_accepts, 0);
      const todayDeclines = todayAnalytics.reduce((sum, a) => sum + a.total_declines, 0);
      const escalatedJobs = analyticsData?.filter(a => a.escalation_count > 0).length || 0;
      
      const responseTimes = analyticsData?.filter(a => a.avg_response_time_seconds)
        .map(a => a.avg_response_time_seconds!) || [];
      const avgResponseTime = responseTimes.length > 0
        ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
        : 0;

      setStats({
        activeJobs,
        pendingOffers,
        todayAccepts,
        todayDeclines,
        avgResponseTime,
        escalatedJobs
      });

    } catch (error) {
      console.error("Error loading assignment data:", error);
      toast.error("Failed to load assignment data");
    } finally {
      setIsLoading(false);
    }
  };

  const loadQueueForJob = async (jobId: string) => {
    setSelectedJobId(jobId);
    
    const { data: queueData, error } = await supabase
      .from("assignment_queue")
      .select(`
        *,
        cleaners(first_name, last_name, average_rating)
      `)
      .eq("job_id", jobId)
      .order("queue_position", { ascending: true });

    if (error) {
      toast.error("Failed to load queue");
      return;
    }
    
    setQueue(queueData || []);
  };

  const handleManualRedistribute = async (jobId: string) => {
    try {
      setIsRefreshing(true);
      const { error } = await supabase.functions.invoke("automated-job-redistribution", {
        body: { jobId, reason: "manual" }
      });

      if (error) throw error;
      toast.success("Redistribution triggered");
      await loadData();
    } catch (error) {
      toast.error("Failed to trigger redistribution");
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleCheckExpired = async () => {
    try {
      setIsRefreshing(true);
      const { error } = await supabase.functions.invoke("check-expired-offers");
      if (error) throw error;
      toast.success("Expired offers processed");
      await loadData();
    } catch (error) {
      toast.error("Failed to check expired offers");
    } finally {
      setIsRefreshing(false);
    }
  };

  const getPriorityBadge = (priority: string) => {
    const config = {
      normal: { color: "bg-gray-100 text-gray-800", icon: Clock },
      high: { color: "bg-yellow-100 text-yellow-800", icon: AlertTriangle },
      urgent: { color: "bg-red-100 text-red-800", icon: Zap }
    };
    const { color, icon: Icon } = config[priority as keyof typeof config] || config.normal;
    return (
      <Badge className={`${color} flex items-center gap-1`}>
        <Icon className="w-3 h-3" />
        {priority}
      </Badge>
    );
  };

  const getStatusBadge = (status: string) => {
    const config: Record<string, { color: string; icon: any }> = {
      in_progress: { color: "bg-blue-100 text-blue-800", icon: RefreshCw },
      completed: { color: "bg-green-100 text-green-800", icon: CheckCircle2 },
      failed: { color: "bg-red-100 text-red-800", icon: XCircle },
      manual_intervention: { color: "bg-orange-100 text-orange-800", icon: AlertCircle }
    };
    const { color, icon: Icon } = config[status] || config.in_progress;
    return (
      <Badge className={`${color} flex items-center gap-1`}>
        <Icon className="w-3 h-3" />
        {status.replace('_', ' ')}
      </Badge>
    );
  };

  const formatResponseTime = (seconds: number | null) => {
    if (!seconds) return "—";
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 animate-spin text-[#5500FF]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Job Assignment System</h2>
          <p className="text-muted-foreground">Monitor and manage cleaner assignments</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCheckExpired}
            disabled={isRefreshing}
          >
            {isRefreshing ? (
              <RefreshCw className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Timer className="w-4 h-4 mr-2" />
            )}
            Check Expired
          </Button>
          <Button
            size="sm"
            onClick={() => loadData()}
            disabled={isRefreshing}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                  <RefreshCw className="w-4 h-4 text-blue-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.activeJobs}</p>
                  <p className="text-xs text-muted-foreground">Active Jobs</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-yellow-100 flex items-center justify-center">
                  <Clock className="w-4 h-4 text-yellow-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.pendingOffers}</p>
                  <p className="text-xs text-muted-foreground">Pending Offers</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.todayAccepts}</p>
                  <p className="text-xs text-muted-foreground">Today's Accepts</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center">
                  <XCircle className="w-4 h-4 text-red-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.todayDeclines}</p>
                  <p className="text-xs text-muted-foreground">Today's Declines</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
                  <Timer className="w-4 h-4 text-purple-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{formatResponseTime(stats.avgResponseTime)}</p>
                  <p className="text-xs text-muted-foreground">Avg Response</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center">
                  <AlertTriangle className="w-4 h-4 text-orange-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.escalatedJobs}</p>
                  <p className="text-xs text-muted-foreground">Escalated</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Main Content */}
      <Tabs defaultValue="active" className="space-y-4">
        <TabsList>
          <TabsTrigger value="active">Active Assignments</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
          <TabsTrigger value="escalated">Escalated</TabsTrigger>
        </TabsList>

        <TabsContent value="active">
          <Card>
            <CardHeader>
              <CardTitle>Active Job Assignments</CardTitle>
              <CardDescription>Jobs currently being assigned to cleaners</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {analytics.filter(a => a.status === 'in_progress').map((item) => (
                  <div
                    key={item.id}
                    className="p-4 border rounded-lg hover:border-[#5500FF]/30 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <MapPin className="w-4 h-4 text-muted-foreground" />
                          <span className="font-medium">
                            {item.jobs?.city}, {item.jobs?.state} {item.jobs?.zip}
                          </span>
                          {getPriorityBadge(item.current_priority)}
                          {getStatusBadge(item.status)}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {new Date(item.jobs?.start_datetime || '').toLocaleDateString('en-US', {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit'
                          })}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleManualRedistribute(item.job_id)}
                        disabled={isRefreshing}
                      >
                        <RefreshCw className="w-3 h-3 mr-1" />
                        Redistribute
                      </Button>
                    </div>

                    <div className="mt-4 grid grid-cols-4 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground">Needed</p>
                        <p className="font-medium">{item.total_cleaners_needed}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Assigned</p>
                        <p className="font-medium text-green-600">{item.total_cleaners_assigned}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Offers Sent</p>
                        <p className="font-medium">{item.total_offers_sent}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Response Time</p>
                        <p className="font-medium">{formatResponseTime(item.avg_response_time_seconds)}</p>
                      </div>
                    </div>

                    <div className="mt-3">
                      <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                        <span>Assignment Progress</span>
                        <span>{item.total_cleaners_assigned}/{item.total_cleaners_needed}</span>
                      </div>
                      <Progress 
                        value={(item.total_cleaners_assigned / item.total_cleaners_needed) * 100}
                        className="h-2"
                      />
                    </div>

                    {item.escalation_count > 0 && (
                      <div className="mt-3 p-2 bg-orange-50 rounded text-sm text-orange-700 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4" />
                        Escalated {item.escalation_count} time{item.escalation_count > 1 ? 's' : ''}
                      </div>
                    )}

                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-3"
                      onClick={() => loadQueueForJob(item.job_id)}
                    >
                      <Users className="w-3 h-3 mr-1" />
                      View Queue ({item.total_offers_sent - item.total_accepts} remaining)
                    </Button>
                  </div>
                ))}

                {analytics.filter(a => a.status === 'in_progress').length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-green-500" />
                    <p>No active assignments</p>
                    <p className="text-sm">All jobs are currently staffed</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="completed">
          <Card>
            <CardHeader>
              <CardTitle>Completed Assignments</CardTitle>
              <CardDescription>Successfully assigned jobs</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {analytics.filter(a => a.status === 'completed').slice(0, 20).map((item) => (
                  <div
                    key={item.id}
                    className="p-3 border rounded-lg flex items-center justify-between"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                        <span className="font-medium">
                          {item.jobs?.city}, {item.jobs?.state}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {item.total_cleaners_assigned} cleaner{item.total_cleaners_assigned !== 1 ? 's' : ''} assigned
                        {' · '}
                        {item.total_offers_sent} offers sent
                      </p>
                    </div>
                    <div className="text-right text-sm">
                      <p className="font-medium">{formatResponseTime(item.avg_response_time_seconds)}</p>
                      <p className="text-muted-foreground">avg response</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="escalated">
          <Card>
            <CardHeader>
              <CardTitle>Escalated Jobs</CardTitle>
              <CardDescription>Jobs requiring attention due to declines or timeouts</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {analytics.filter(a => a.escalation_count > 0).map((item) => (
                  <div
                    key={item.id}
                    className="p-4 border border-orange-200 bg-orange-50/50 rounded-lg"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-orange-500" />
                          <span className="font-medium">
                            {item.jobs?.city}, {item.jobs?.state}
                          </span>
                          {getPriorityBadge(item.current_priority)}
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          {item.total_declines} declines, {item.total_expirations} expired
                          {' · '}
                          Escalated {item.escalation_count}x
                        </p>
                      </div>
                      {item.status !== 'completed' && (
                        <Button
                          size="sm"
                          onClick={() => handleManualRedistribute(item.job_id)}
                        >
                          Retry Assignment
                        </Button>
                      )}
                    </div>
                  </div>
                ))}

                {analytics.filter(a => a.escalation_count > 0).length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <TrendingUp className="w-12 h-12 mx-auto mb-3 text-green-500" />
                    <p>No escalated jobs</p>
                    <p className="text-sm">Assignments are running smoothly</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Queue Modal/Panel */}
      {selectedJobId && queue.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Assignment Queue</CardTitle>
              <CardDescription>Cleaners in queue for this job</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setSelectedJobId(null)}>
              Close
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {queue.map((entry, index) => (
                <div
                  key={entry.id}
                  className={`p-3 rounded-lg flex items-center justify-between ${
                    entry.status === 'offered' ? 'bg-blue-50 border border-blue-200' :
                    entry.status === 'accepted' ? 'bg-green-50 border border-green-200' :
                    entry.status === 'declined' ? 'bg-red-50 border border-red-200' :
                    'bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-sm font-medium">
                      #{entry.queue_position}
                    </div>
                    <div>
                      <p className="font-medium">
                        {entry.cleaners?.first_name} {entry.cleaners?.last_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Score: {entry.match_score} · {entry.distance_miles?.toFixed(1)} mi
                        {entry.cleaners?.average_rating && ` · ⭐ ${entry.cleaners.average_rating.toFixed(1)}`}
                      </p>
                    </div>
                  </div>
                  <Badge variant={
                    entry.status === 'offered' ? 'default' :
                    entry.status === 'accepted' ? 'default' :
                    entry.status === 'declined' ? 'destructive' :
                    'secondary'
                  } className={
                    entry.status === 'accepted' ? 'bg-green-500' : ''
                  }>
                    {entry.status}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
