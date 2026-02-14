import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import AdminLayout from "@/components/admin/AdminLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Users, TrendingUp, DollarSign, CalendarClock, Phone, Mail,
  MessageSquare, Search, Filter, BarChart3, ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCents } from "@/lib/sales-pricing";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";

const PIPELINE_COLUMNS = [
  { id: "new", label: "New Leads", color: "border-blue-500/50 bg-blue-500/5" },
  { id: "contacted", label: "Contacted", color: "border-cyan-500/50 bg-cyan-500/5" },
  { id: "quoted", label: "Quoted", color: "border-violet-500/50 bg-violet-500/5" },
  { id: "follow_up", label: "Follow-Up", color: "border-amber-500/50 bg-amber-500/5" },
  { id: "booked", label: "Booked", color: "border-emerald-500/50 bg-emerald-500/5" },
  { id: "lost", label: "Lost", color: "border-red-500/50 bg-red-500/5" },
];

const SOURCE_FILTERS = ["All", "Google Ads", "Facebook", "Instagram DM", "Referral", "Website", "Cold Outreach"];

const CHANNEL_ICONS: Record<string, any> = {
  "Phone Call": Phone,
  "Email": Mail,
  "Text/SMS": MessageSquare,
  "Instagram DM": MessageSquare,
  "Facebook DM": MessageSquare,
};

const STATUS_VALUES = PIPELINE_COLUMNS.map((c) => c.id);

export default function LeadPipeline() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState("All");

  const { data: leads = [], isLoading, refetch } = useQuery({
    queryKey: ["leads-pipeline", sourceFilter],
    queryFn: async () => {
      let query = supabase
        .from("leads")
        .select("*")
        .order("created_at", { ascending: false });
      if (sourceFilter !== "All") {
        query = query.eq("source", sourceFilter);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const { data: quotes = [] } = useQuery({
    queryKey: ["sales-quotes-pipeline"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_quotes")
        .select("lead_id, final_price_cents")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const { data: followUps = [] } = useQuery({
    queryKey: ["follow-ups-due"],
    queryFn: async () => {
      const today = new Date().toISOString().split("T")[0];
      const { data, error } = await supabase
        .from("follow_ups")
        .select("*")
        .eq("completed", false)
        .lte("scheduled_date", today)
        .order("scheduled_date");
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  // Build quote lookup by lead_id (latest quote)
  const quoteByLead = quotes.reduce((acc: Record<string, number>, q: any) => {
    if (!acc[q.lead_id]) acc[q.lead_id] = q.final_price_cents;
    return acc;
  }, {});

  // Filter by search
  const filtered = leads.filter((l: any) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (l.first_name || "").toLowerCase().includes(q) ||
      (l.last_name || "").toLowerCase().includes(q) ||
      (l.email || "").toLowerCase().includes(q) ||
      (l.phone || "").includes(q)
    );
  });

  // Group by status
  const grouped = PIPELINE_COLUMNS.reduce((acc, col) => {
    acc[col.id] = filtered.filter((l: any) => (l.status || "new") === col.id);
    return acc;
  }, {} as Record<string, any[]>);

  // Quick stats
  const totalLeads = leads.length;
  const bookedCount = leads.filter((l: any) => l.status === "booked").length;
  const conversionRate = totalLeads > 0 ? Math.round((bookedCount / totalLeads) * 100) : 0;
  const followUpsDueToday = followUps.length;
  
  // Revenue stats from quotes
  const bookedLeadIds = leads.filter((l: any) => l.status === "booked").map((l: any) => l.id);
  const totalRevenueCents = bookedLeadIds.reduce((sum: number, id: string) => sum + (quoteByLead[id] || 0), 0);
  const avgDealCents = bookedCount > 0 ? Math.round(totalRevenueCents / bookedCount) : 0;

  const handleStatusChange = async (leadId: string, newStatus: string) => {
    try {
      await supabase.from("leads").update({ status: newStatus } as any).eq("id", leadId);
      await supabase.from("lead_activity_log").insert({
        lead_id: leadId,
        action: "status_changed",
        notes: `Status changed to ${newStatus} from pipeline`,
      } as any);
      refetch();
      toast.success("Status updated");
    } catch (err: any) {
      toast.error("Failed: " + err.message);
    }
  };

  const handleOpenLead = (leadId: string) => {
    navigate(`/admin/sales?leadId=${leadId}`);
  };

  return (
    <AdminLayout>
      <div className="max-w-[1800px] mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <BarChart3 className="w-6 h-6 text-amber-400" />
              Lead Pipeline
            </h1>
            <p className="text-sm text-slate-400 mt-1">Track and manage your sales pipeline</p>
          </div>
          <Button
            onClick={() => navigate("/admin/sales")}
            className="bg-amber-500 hover:bg-amber-600 text-black font-semibold"
          >
            + New Lead
          </Button>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <Card className="bg-slate-900 border-slate-800 p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Users className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-white">{totalLeads}</div>
                <div className="text-xs text-slate-400">Total Leads</div>
              </div>
            </div>
          </Card>
          <Card className="bg-slate-900 border-slate-800 p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-white">{conversionRate}%</div>
                <div className="text-xs text-slate-400">Conversion Rate</div>
              </div>
            </div>
          </Card>
          <Card className="bg-slate-900 border-slate-800 p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-white">{totalRevenueCents > 0 ? formatCents(totalRevenueCents) : "$0"}</div>
                <div className="text-xs text-slate-400">Revenue Booked</div>
              </div>
            </div>
          </Card>
          <Card className="bg-slate-900 border-slate-800 p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-violet-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-white">{avgDealCents > 0 ? formatCents(avgDealCents) : "$0"}</div>
                <div className="text-xs text-slate-400">Avg Deal Value</div>
              </div>
            </div>
          </Card>
          <Card className="bg-slate-900 border-slate-800 p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center">
                <CalendarClock className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-white">{followUpsDueToday}</div>
                <div className="text-xs text-slate-400">Follow-ups Due</div>
              </div>
            </div>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 mb-6">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search leads..."
              className="bg-slate-800 border-slate-700 text-white pl-9"
            />
          </div>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-48 bg-slate-800 border-slate-700 text-white">
              <Filter className="w-4 h-4 mr-2 text-slate-400" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_FILTERS.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Kanban Board */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 overflow-x-auto">
          {PIPELINE_COLUMNS.map((col) => (
            <div key={col.id} className="min-w-[220px]">
              <div className={cn("rounded-t-lg border-t-2 p-3", col.color)}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-white">{col.label}</span>
                  <Badge variant="secondary" className="bg-slate-700 text-slate-300 text-xs">
                    {grouped[col.id]?.length || 0}
                  </Badge>
                </div>
              </div>
              <div className="space-y-2 mt-2 max-h-[600px] overflow-y-auto pr-1">
                {(grouped[col.id] || []).map((lead: any) => {
                  const ChannelIcon = CHANNEL_ICONS[lead.channel] || Phone;
                  const quoteCents = quoteByLead[lead.id];
                  return (
                    <Card
                      key={lead.id}
                      className="bg-slate-900 border-slate-800 p-3 hover:border-amber-500/50 transition-colors cursor-pointer group"
                      onClick={() => handleOpenLead(lead.id)}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="font-medium text-white text-sm truncate">
                          {lead.first_name} {lead.last_name}
                        </div>
                        <ExternalLink className="w-3 h-3 text-slate-600 group-hover:text-amber-400 shrink-0 transition-colors" />
                      </div>
                      {lead.service_type && (
                        <div className="text-xs text-slate-400 mb-1 capitalize">{lead.service_type}</div>
                      )}
                      {quoteCents && (
                        <div className="text-xs text-amber-400 font-semibold mb-1">
                          {formatCents(quoteCents)}/clean
                        </div>
                      )}
                      {lead.zip_code && (
                        <div className="text-xs text-slate-500">ZIP: {lead.zip_code}</div>
                      )}
                      <div className="flex items-center justify-between mt-2">
                        <Badge variant="secondary" className="text-[10px] bg-slate-800 text-slate-400">
                          {lead.source}
                        </Badge>
                        <span className="text-[10px] text-slate-500">
                          {lead.created_at ? format(parseISO(lead.created_at), "MMM d") : ""}
                        </span>
                      </div>
                      {/* Quick status change */}
                      <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                        <Select
                          value={lead.status || "new"}
                          onValueChange={(v) => handleStatusChange(lead.id, v)}
                        >
                          <SelectTrigger className="h-7 text-[10px] bg-slate-800 border-slate-700 text-slate-400">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {PIPELINE_COLUMNS.map((s) => (
                              <SelectItem key={s.id} value={s.id} className="text-xs">{s.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </Card>
                  );
                })}
                {(!grouped[col.id] || grouped[col.id].length === 0) && (
                  <div className="text-center py-8 text-slate-600 text-xs">No leads</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </AdminLayout>
  );
}
