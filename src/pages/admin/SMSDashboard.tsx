import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { 
  MessageSquare, 
  Send, 
  Phone, 
  Users, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Search,
  RefreshCw,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownLeft,
  Shield
} from "lucide-react";

interface SMSLog {
  id: string;
  to_phone: string;
  message: string;
  type: string;
  status: string;
  provider: string;
  provider_message_id: string;
  error_message: string | null;
  created_at: string;
}

interface IncomingSMS {
  id: string;
  from_phone: string;
  message: string;
  processed: boolean;
  response_sent: string | null;
  created_at: string;
}

interface OptOut {
  id: string;
  phone: string;
  cleaner_id: string | null;
  opted_out_at: string;
  opted_back_in_at: string | null;
}

interface SMSStats {
  totalSent: number;
  delivered: number;
  failed: number;
  pendingVerifications: number;
  verifiedPhones: number;
  optedOut: number;
}

export default function SMSDashboard() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [smsLogs, setSmsLogs] = useState<SMSLog[]>([]);
  const [incomingSms, setIncomingSms] = useState<IncomingSMS[]>([]);
  const [optOuts, setOptOuts] = useState<OptOut[]>([]);
  const [stats, setStats] = useState<SMSStats>({
    totalSent: 0,
    delivered: 0,
    failed: 0,
    pendingVerifications: 0,
    verifiedPhones: 0,
    optedOut: 0
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [sendingTest, setSendingTest] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);

      // Fetch SMS logs
      const { data: logs } = await supabase
        .from("sms_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      setSmsLogs(logs || []);

      // Fetch incoming SMS
      const { data: incoming } = await supabase
        .from("incoming_sms_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      setIncomingSms(incoming || []);

      // Fetch opt-outs
      const { data: optOutsData } = await supabase
        .from("sms_opt_outs")
        .select("*")
        .order("opted_out_at", { ascending: false });

      setOptOuts(optOutsData || []);

      // Calculate stats
      const { count: totalSent } = await supabase
        .from("sms_logs")
        .select("*", { count: "exact", head: true });

      const { count: delivered } = await supabase
        .from("sms_logs")
        .select("*", { count: "exact", head: true })
        .eq("status", "sent");

      const { count: failed } = await supabase
        .from("sms_logs")
        .select("*", { count: "exact", head: true })
        .eq("status", "failed");

      const { count: verifiedPhones } = await supabase
        .from("cleaners")
        .select("*", { count: "exact", head: true })
        .eq("phone_verified", true);

      const { count: pendingVerifications } = await supabase
        .from("phone_verification_codes")
        .select("*", { count: "exact", head: true })
        .eq("used", false);

      setStats({
        totalSent: totalSent || 0,
        delivered: delivered || 0,
        failed: failed || 0,
        verifiedPhones: verifiedPhones || 0,
        pendingVerifications: pendingVerifications || 0,
        optedOut: optOutsData?.length || 0
      });

    } catch (error: any) {
      toast({
        title: "Error loading data",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
    toast({ title: "Data refreshed" });
  };

  const handleSendTestSMS = async () => {
    if (!testPhone) {
      toast({
        title: "Phone required",
        description: "Enter a phone number to send test SMS",
        variant: "destructive"
      });
      return;
    }

    try {
      setSendingTest(true);
      
      const { error } = await supabase.functions.invoke('send-sms-notification', {
        body: {
          toPhone: testPhone,
          message: "This is a test message from Novara Cleaning SMS system. If you received this, SMS is working correctly!",
          type: "general"
        }
      });

      if (error) throw error;

      toast({
        title: "Test SMS sent!",
        description: `Message sent to ${testPhone}`
      });

      setTestPhone("");
      await fetchData();
    } catch (error: any) {
      toast({
        title: "Failed to send test SMS",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setSendingTest(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "sent":
      case "delivered":
        return <Badge className="bg-green-100 text-green-800"><CheckCircle2 className="h-3 w-3 mr-1" /> Sent</Badge>;
      case "failed":
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" /> Failed</Badge>;
      case "pending":
        return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" /> Pending</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getTypeBadge = (type: string) => {
    const typeColors: Record<string, string> = {
      job_offer: "bg-blue-100 text-blue-800",
      reminder: "bg-yellow-100 text-yellow-800",
      confirmation: "bg-green-100 text-green-800",
      verification: "bg-purple-100 text-purple-800",
      contractor_verification: "bg-purple-100 text-purple-800",
      welcome: "bg-pink-100 text-pink-800",
      general: "bg-gray-100 text-gray-800"
    };
    return <Badge className={typeColors[type] || "bg-gray-100 text-gray-800"}>{type.replace(/_/g, " ")}</Badge>;
  };

  const filteredLogs = smsLogs.filter(log => 
    log.to_phone.includes(searchQuery) || 
    log.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
    log.type.includes(searchQuery.toLowerCase())
  );

  const filteredIncoming = incomingSms.filter(sms =>
    sms.from_phone.includes(searchQuery) ||
    sms.message.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <RefreshCw className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <MessageSquare className="h-6 w-6 text-primary" />
            SMS Dashboard
          </h1>
          <p className="text-muted-foreground">Monitor SMS activity and manage notifications</p>
        </div>
        <Button onClick={handleRefresh} variant="outline" disabled={refreshing}>
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{stats.totalSent}</p>
                <p className="text-sm text-muted-foreground">Total Sent</p>
              </div>
              <Send className="h-8 w-8 text-blue-500 opacity-50" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-green-600">{stats.delivered}</p>
                <p className="text-sm text-muted-foreground">Delivered</p>
              </div>
              <CheckCircle2 className="h-8 w-8 text-green-500 opacity-50" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-red-600">{stats.failed}</p>
                <p className="text-sm text-muted-foreground">Failed</p>
              </div>
              <XCircle className="h-8 w-8 text-red-500 opacity-50" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-purple-600">{stats.verifiedPhones}</p>
                <p className="text-sm text-muted-foreground">Verified</p>
              </div>
              <Shield className="h-8 w-8 text-purple-500 opacity-50" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-yellow-600">{stats.pendingVerifications}</p>
                <p className="text-sm text-muted-foreground">Pending</p>
              </div>
              <Clock className="h-8 w-8 text-yellow-500 opacity-50" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-gray-600">{stats.optedOut}</p>
                <p className="text-sm text-muted-foreground">Opt-outs</p>
              </div>
              <Users className="h-8 w-8 text-gray-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Test SMS Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Send Test SMS</CardTitle>
          <CardDescription>Send a test message to verify Twilio configuration</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder="Enter phone number (e.g., +12025551234)"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              className="max-w-xs"
            />
            <Button onClick={handleSendTestSMS} disabled={sendingTest}>
              {sendingTest ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Send Test
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by phone, message, or type..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="outgoing" className="space-y-4">
        <TabsList>
          <TabsTrigger value="outgoing" className="flex items-center gap-2">
            <ArrowUpRight className="h-4 w-4" />
            Outgoing ({smsLogs.length})
          </TabsTrigger>
          <TabsTrigger value="incoming" className="flex items-center gap-2">
            <ArrowDownLeft className="h-4 w-4" />
            Incoming ({incomingSms.length})
          </TabsTrigger>
          <TabsTrigger value="optouts" className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Opt-outs ({optOuts.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="outgoing">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Phone</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Sent</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLogs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        No SMS logs found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredLogs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="font-mono text-sm">
                          {log.to_phone.slice(-4).padStart(log.to_phone.length, '*')}
                        </TableCell>
                        <TableCell className="max-w-xs truncate text-sm">
                          {log.message.substring(0, 50)}...
                        </TableCell>
                        <TableCell>{getTypeBadge(log.type)}</TableCell>
                        <TableCell>{getStatusBadge(log.status)}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{log.provider || 'twilio'}</Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(log.created_at).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="incoming">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>From</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead>Response</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Received</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredIncoming.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        No incoming SMS found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredIncoming.map((sms) => (
                      <TableRow key={sms.id}>
                        <TableCell className="font-mono text-sm">
                          {sms.from_phone.slice(-4).padStart(sms.from_phone.length, '*')}
                        </TableCell>
                        <TableCell className="font-medium">{sms.message}</TableCell>
                        <TableCell className="max-w-xs truncate text-sm text-muted-foreground">
                          {sms.response_sent || '-'}
                        </TableCell>
                        <TableCell>
                          {sms.processed ? (
                            <Badge className="bg-green-100 text-green-800">
                              <CheckCircle2 className="h-3 w-3 mr-1" /> Processed
                            </Badge>
                          ) : (
                            <Badge variant="secondary">
                              <Clock className="h-3 w-3 mr-1" /> Pending
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(sms.created_at).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="optouts">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Phone</TableHead>
                    <TableHead>Opted Out</TableHead>
                    <TableHead>Re-subscribed</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {optOuts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                        No opt-outs recorded
                      </TableCell>
                    </TableRow>
                  ) : (
                    optOuts.map((optOut) => (
                      <TableRow key={optOut.id}>
                        <TableCell className="font-mono text-sm">
                          {optOut.phone.slice(-4).padStart(optOut.phone.length, '*')}
                        </TableCell>
                        <TableCell className="text-sm">
                          {new Date(optOut.opted_out_at).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-sm">
                          {optOut.opted_back_in_at 
                            ? new Date(optOut.opted_back_in_at).toLocaleString() 
                            : '-'
                          }
                        </TableCell>
                        <TableCell>
                          {optOut.opted_back_in_at ? (
                            <Badge className="bg-green-100 text-green-800">Active</Badge>
                          ) : (
                            <Badge variant="destructive">Opted Out</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
