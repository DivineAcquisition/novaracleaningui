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
import { Input } from "@/components/ui/input";
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Search, RefreshCcw, Eye, CheckCircle, XCircle, Clock } from "lucide-react";
import { toast } from "sonner";

interface SmsLog {
  id: string;
  to_phone: string;
  message: string;
  type: string;
  status: string;
  error_message: string | null;
  cost: number | null;
  provider_message_id: string | null;
  created_at: string;
}

export default function SmsLogsPage() {
  const [logs, setLogs] = useState<SmsLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selectedLog, setSelectedLog] = useState<SmsLog | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from("sms_logs")
        .select("*", { count: "exact" });

      if (searchQuery) {
        query = query.ilike("to_phone", `%${searchQuery}%`);
      }

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      if (typeFilter !== "all") {
        query = query.eq("type", typeFilter);
      }

      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      const { data, error } = await query
        .order("created_at", { ascending: false })
        .range(from, to);

      if (error) throw error;
      setLogs(data || []);
    } catch (error) {
      console.error("Error fetching SMS logs:", error);
      toast.error("Failed to load SMS logs");
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, statusFilter, typeFilter, page]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "sent":
      case "delivered":
        return (
          <Badge className="gap-1 bg-green-100 text-green-800">
            <CheckCircle className="h-3 w-3" />
            {status}
          </Badge>
        );
      case "pending":
        return (
          <Badge variant="outline" className="gap-1">
            <Clock className="h-3 w-3" />
            Pending
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="h-3 w-3" />
            Failed
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/portal/communications">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">SMS Logs</h1>
          <p className="text-muted-foreground">
            View all SMS messages sent through the platform
          </p>
        </div>
        <Button variant="outline" onClick={fetchLogs}>
          <RefreshCcw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by phone number..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="delivered">Delivered</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="job_offer">Job Offer</SelectItem>
                <SelectItem value="job_reminder">Job Reminder</SelectItem>
                <SelectItem value="booking_confirmation">Booking Confirmation</SelectItem>
                <SelectItem value="verification">Verification</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Logs Table */}
      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(10)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No SMS logs found
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Phone</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Cost</TableHead>
                  <TableHead>Sent At</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="font-mono">{log.to_phone}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{log.type}</Badge>
                    </TableCell>
                    <TableCell>{getStatusBadge(log.status)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {log.cost ? `$${log.cost.toFixed(4)}` : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {format(parseISO(log.created_at), "MMM d, h:mm a")}
                    </TableCell>
                    <TableCell>
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setSelectedLog(log)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>SMS Details</DialogTitle>
                            <DialogDescription>
                              Full message content and details
                            </DialogDescription>
                          </DialogHeader>
                          <div className="space-y-4">
                            <div>
                              <p className="text-sm font-medium text-muted-foreground">To</p>
                              <p className="font-mono">{log.to_phone}</p>
                            </div>
                            <div>
                              <p className="text-sm font-medium text-muted-foreground">Message</p>
                              <p className="text-sm bg-muted p-3 rounded-lg whitespace-pre-wrap">
                                {log.message}
                              </p>
                            </div>
                            {log.error_message && (
                              <div>
                                <p className="text-sm font-medium text-red-600">Error</p>
                                <p className="text-sm text-red-600">{log.error_message}</p>
                              </div>
                            )}
                          </div>
                        </DialogContent>
                      </Dialog>
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
