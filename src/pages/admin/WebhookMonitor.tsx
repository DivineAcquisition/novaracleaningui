import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { RefreshCw, CheckCircle, XCircle, Clock } from "lucide-react";
import { format } from "date-fns";
import { WebhookTestButton } from "@/components/admin/WebhookTestButton";

interface WebhookFailure {
  id: string;
  created_at: string;
  booking_id: string;
  webhook_url: string;
  error_message: string;
  retry_count: number;
  resolved: boolean;
  payload: any;
}

const WebhookMonitor = () => {
  const [failures, setFailures] = useState<WebhookFailure[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);

  const fetchFailures = async () => {
    try {
      const { data, error } = await (supabase as any)
        .from("webhook_failures")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      setFailures(data || []);
    } catch (error: any) {
      toast.error("Failed to load webhook failures", {
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = async (failureId: string, bookingId: string) => {
    setRetrying(failureId);
    try {
      const { error } = await supabase.functions.invoke("retry-webhook", {
        body: { failureId, bookingId },
      });

      if (error) throw error;

      toast.success("Webhook retry initiated");
      fetchFailures();
    } catch (error: any) {
      toast.error("Failed to retry webhook", {
        description: error.message,
      });
    } finally {
      setRetrying(null);
    }
  };

  const handleMarkResolved = async (failureId: string) => {
    try {
      const { error } = await (supabase as any)
        .from("webhook_failures")
        .update({ resolved: true })
        .eq("id", failureId);

      if (error) throw error;

      toast.success("Marked as resolved");
      fetchFailures();
    } catch (error: any) {
      toast.error("Failed to update status", {
        description: error.message,
      });
    }
  };

  useEffect(() => {
    fetchFailures();
  }, []);

  if (loading) {
    return (
      <div className="container mx-auto py-8">
        <div className="flex items-center justify-center">
          <RefreshCw className="animate-spin h-8 w-8" />
        </div>
      </div>
    );
  }

  const unresolvedCount = failures.filter((f) => !f.resolved).length;

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Webhook Monitor</h1>
          <p className="text-muted-foreground mt-2">
            Track and manage Zapier webhook integration status
          </p>
        </div>
        <div className="flex gap-2">
          <WebhookTestButton />
          <Button onClick={fetchFailures} variant="outline">
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Failures</CardTitle>
            <XCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{failures.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Unresolved</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{unresolvedCount}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Resolved</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{failures.length - unresolvedCount}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Webhook Failures</CardTitle>
          <CardDescription>
            Failed webhook attempts to Zapier integration
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {failures.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No webhook failures recorded
              </div>
            ) : (
              failures.map((failure) => (
                <div
                  key={failure.id}
                  className="flex items-start justify-between border-b pb-4 last:border-0"
                >
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant={failure.resolved ? "secondary" : "destructive"}>
                        {failure.resolved ? "Resolved" : "Unresolved"}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {format(new Date(failure.created_at), "MMM dd, yyyy HH:mm")}
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-medium">
                        Booking ID: {failure.booking_id}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Retry attempts: {failure.retry_count}
                      </p>
                      {failure.error_message && (
                        <p className="text-sm text-destructive mt-1">
                          Error: {failure.error_message}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleRetry(failure.id, failure.booking_id)}
                      disabled={retrying === failure.id}
                    >
                      {retrying === failure.id ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <RefreshCw className="h-4 w-4 mr-1" />
                          Retry
                        </>
                      )}
                    </Button>
                    {!failure.resolved && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleMarkResolved(failure.id)}
                      >
                        <CheckCircle className="h-4 w-4 mr-1" />
                        Mark Resolved
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default WebhookMonitor;
