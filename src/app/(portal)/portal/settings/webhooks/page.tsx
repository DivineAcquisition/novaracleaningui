"use client";
export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowLeft, RefreshCcw, RotateCcw, Eye, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface WebhookFailure {
  id: string;
  booking_id: string | null;
  webhook_url: string;
  payload: any;
  error_message: string | null;
  retry_count: number | null;
  resolved: boolean | null;
  created_at: string | null;
}

export default function WebhooksSettingsPage() {
  const [failures, setFailures] = useState<WebhookFailure[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedFailure, setSelectedFailure] = useState<WebhookFailure | null>(null);

  const fetchFailures = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("webhook_failures")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;
      setFailures(data || []);
    } catch (error) {
      console.error("Error fetching webhook failures:", error);
      toast.error("Failed to load webhook failures");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchFailures();
  }, []);

  const retryWebhook = async (id: string) => {
    try {
      const { error } = await supabase.functions.invoke("retry-webhook", {
        body: { failureId: id },
      });

      if (error) throw error;

      toast.success("Retry triggered");
      fetchFailures();
    } catch (error) {
      console.error("Error retrying webhook:", error);
      toast.error("Failed to retry webhook");
    }
  };

  const markResolved = async (id: string) => {
    try {
      const { error } = await supabase
        .from("webhook_failures")
        .update({ resolved: true })
        .eq("id", id);

      if (error) throw error;

      toast.success("Marked as resolved");
      fetchFailures();
    } catch (error) {
      console.error("Error marking resolved:", error);
      toast.error("Failed to update");
    }
  };

  const unresolvedCount = failures.filter((f) => !f.resolved).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/portal/settings">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Webhook Monitor</h1>
          <p className="text-muted-foreground">
            Monitor webhook deliveries and failures
          </p>
        </div>
        <Button variant="outline" onClick={fetchFailures}>
          <RefreshCcw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Failures
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{failures.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Unresolved
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">{unresolvedCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Resolved
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {failures.length - unresolvedCount}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Failures Table */}
      <Card>
        <CardHeader>
          <CardTitle>Webhook Failures</CardTitle>
          <CardDescription>
            Recent webhook delivery failures
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : failures.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No webhook failures recorded
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>URL</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead>Retries</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {failures.map((failure) => (
                  <TableRow key={failure.id}>
                    <TableCell className="font-mono text-xs max-w-xs truncate">
                      {failure.webhook_url}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground">
                      {failure.error_message || "Unknown error"}
                    </TableCell>
                    <TableCell>{failure.retry_count || 0}</TableCell>
                    <TableCell>
                      {failure.resolved ? (
                        <Badge className="gap-1 bg-green-100 text-green-800">
                          <CheckCircle className="h-3 w-3" />
                          Resolved
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 border-orange-300 text-orange-700">
                          <AlertCircle className="h-3 w-3" />
                          Unresolved
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {failure.created_at
                        ? format(parseISO(failure.created_at), "MMM d, h:mm a")
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setSelectedFailure(failure)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-2xl">
                            <DialogHeader>
                              <DialogTitle>Webhook Payload</DialogTitle>
                              <DialogDescription>
                                Full payload sent to {failure.webhook_url}
                              </DialogDescription>
                            </DialogHeader>
                            <ScrollArea className="h-[400px]">
                              <pre className="text-xs bg-muted p-4 rounded-lg overflow-auto">
                                {JSON.stringify(failure.payload, null, 2)}
                              </pre>
                            </ScrollArea>
                          </DialogContent>
                        </Dialog>
                        {!failure.resolved && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => retryWebhook(failure.id)}
                            >
                              <RotateCcw className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => markResolved(failure.id)}
                            >
                              <CheckCircle className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
