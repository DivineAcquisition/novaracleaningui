"use client";
export const dynamic = "force-dynamic";

import { useState } from "react";
import Link from "next/link";
import { format, subDays, subMonths } from "date-fns";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft,
  Download,
  FileSpreadsheet,
  Calendar as CalendarIcon,
  Clock,
  Users,
  UserCog,
  DollarSign,
  Settings,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ExportConfig {
  type: string;
  label: string;
  icon: React.ReactNode;
  description: string;
  columns: string[];
}

const exportConfigs: ExportConfig[] = [
  {
    type: "customers",
    label: "Customer List",
    icon: <Users className="h-4 w-4" />,
    description: "Export all customers with their details",
    columns: ["ID", "First Name", "Last Name", "Email", "Phone", "City", "State", "ZIP", "Created At"],
  },
  {
    type: "cleaners",
    label: "Cleaner List",
    icon: <UserCog className="h-4 w-4" />,
    description: "Export all cleaners with performance metrics",
    columns: ["ID", "Name", "Email", "Phone", "Status", "Rating", "Jobs", "Earnings", "Created At"],
  },
  {
    type: "bookings",
    label: "Booking History",
    icon: <CalendarIcon className="h-4 w-4" />,
    description: "Export all bookings with full details",
    columns: ["Booking #", "Date", "Customer", "Service", "Status", "Total", "Cleaner", "Address"],
  },
  {
    type: "revenue",
    label: "Revenue Report",
    icon: <DollarSign className="h-4 w-4" />,
    description: "Export revenue breakdown by period",
    columns: ["Date", "Bookings", "Revenue", "Membership Rev", "One-Time Rev"],
  },
  {
    type: "payouts",
    label: "Payout Report",
    icon: <DollarSign className="h-4 w-4" />,
    description: "Export cleaner payouts with status",
    columns: ["Cleaner", "Amount", "Platform Fee", "Status", "Created", "Processed"],
  },
];

export default function DataExportsPage() {
  const [selectedExport, setSelectedExport] = useState<string>("customers");
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
    from: subMonths(new Date(), 1),
    to: new Date(),
  });
  const [isExporting, setIsExporting] = useState(false);
  const [exportHistory, setExportHistory] = useState<
    { type: string; date: string; records: number }[]
  >([]);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const fromDate = format(dateRange.from, "yyyy-MM-dd");
      const toDate = format(dateRange.to, "yyyy-MM-dd");
      let data: any[] = [];
      let headers: string[] = [];
      let filename = "";

      switch (selectedExport) {
        case "customers": {
          const { data: customers, error } = await supabase
            .from("customers")
            .select("*")
            .gte("created_at", fromDate)
            .lte("created_at", toDate)
            .order("created_at", { ascending: false });

          if (error) throw error;

          headers = ["ID", "First Name", "Last Name", "Email", "Phone", "City", "State", "ZIP", "Created At"];
          data = (customers || []).map((c) => [
            c.id,
            c.first_name,
            c.last_name,
            c.email,
            c.phone || "",
            c.city || "",
            c.state || "",
            c.zip || "",
            c.created_at || "",
          ]);
          filename = `customers-export-${format(new Date(), "yyyy-MM-dd")}.csv`;
          break;
        }
        case "cleaners": {
          const { data: cleaners, error } = await supabase
            .from("cleaners")
            .select("*")
            .order("created_at", { ascending: false });

          if (error) throw error;

          headers = ["ID", "Name", "Email", "Phone", "Status", "Rating", "Jobs", "Earnings", "Created At"];
          data = (cleaners || []).map((c) => [
            c.id,
            `${c.first_name} ${c.last_name}`,
            c.email,
            c.phone,
            c.status,
            c.average_rating?.toFixed(2) || "",
            c.completed_bookings || 0,
            ((c.total_earnings_cents || 0) / 100).toFixed(2),
            c.created_at || "",
          ]);
          filename = `cleaners-export-${format(new Date(), "yyyy-MM-dd")}.csv`;
          break;
        }
        case "bookings": {
          const { data: bookings, error } = await supabase
            .from("bookings")
            .select("*, customers(first_name, last_name)")
            .gte("service_date", fromDate)
            .lte("service_date", toDate)
            .order("service_date", { ascending: false });

          if (error) throw error;

          headers = ["Booking #", "Date", "Customer", "Service", "Status", "Total", "Address", "City"];
          data = (bookings || []).map((b: any) => [
            b.booking_number || "",
            b.service_date,
            b.customers ? `${b.customers.first_name} ${b.customers.last_name}` : b.email,
            b.service_type,
            b.status || "",
            ((b.total_estimate_cents || 0) / 100).toFixed(2),
            b.address,
            b.city,
          ]);
          filename = `bookings-export-${format(new Date(), "yyyy-MM-dd")}.csv`;
          break;
        }
        case "revenue": {
          const { data: bookings, error } = await supabase
            .from("bookings")
            .select("service_date, total_estimate_cents, payment_option")
            .gte("service_date", fromDate)
            .lte("service_date", toDate)
            .in("status", ["confirmed", "completed"])
            .order("service_date", { ascending: true });

          if (error) throw error;

          // Aggregate by date
          const dailyMap = new Map<string, { count: number; total: number; membership: number; oneTime: number }>();
          (bookings || []).forEach((b) => {
            const date = b.service_date;
            const current = dailyMap.get(date) || { count: 0, total: 0, membership: 0, oneTime: 0 };
            const amount = b.total_estimate_cents || 0;
            dailyMap.set(date, {
              count: current.count + 1,
              total: current.total + amount,
              membership: current.membership + (b.payment_option === "membership" ? amount : 0),
              oneTime: current.oneTime + (b.payment_option !== "membership" ? amount : 0),
            });
          });

          headers = ["Date", "Bookings", "Revenue", "Membership Rev", "One-Time Rev"];
          data = Array.from(dailyMap.entries()).map(([date, stats]) => [
            date,
            stats.count,
            (stats.total / 100).toFixed(2),
            (stats.membership / 100).toFixed(2),
            (stats.oneTime / 100).toFixed(2),
          ]);
          filename = `revenue-export-${format(new Date(), "yyyy-MM-dd")}.csv`;
          break;
        }
        case "payouts": {
          const { data: payouts, error } = await supabase
            .from("payouts")
            .select("*, cleaners(first_name, last_name)")
            .gte("created_at", fromDate)
            .lte("created_at", toDate)
            .order("created_at", { ascending: false });

          if (error) throw error;

          headers = ["Cleaner", "Amount", "Platform Fee", "Status", "Created", "Processed"];
          data = (payouts || []).map((p: any) => [
            p.cleaners ? `${p.cleaners.first_name} ${p.cleaners.last_name}` : "Unknown",
            (p.cleaner_payout_cents / 100).toFixed(2),
            (p.platform_fee_cents / 100).toFixed(2),
            p.status,
            p.created_at || "",
            p.processed_at || "",
          ]);
          filename = `payouts-export-${format(new Date(), "yyyy-MM-dd")}.csv`;
          break;
        }
      }

      // Generate CSV
      const csvContent = [
        headers.join(","),
        ...data.map((row) =>
          row.map((cell: any) => {
            const str = String(cell);
            if (str.includes(",") || str.includes('"') || str.includes("\n")) {
              return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
          }).join(",")
        ),
      ].join("\n");

      // Download
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      // Add to history
      setExportHistory((prev) => [
        {
          type: selectedExport,
          date: format(new Date(), "MMM d, yyyy h:mm a"),
          records: data.length,
        },
        ...prev.slice(0, 9),
      ]);

      toast.success("Export completed", {
        description: `Exported ${data.length} records`,
      });
    } catch (error) {
      console.error("Export error:", error);
      toast.error("Export failed");
    } finally {
      setIsExporting(false);
    }
  };

  const selectedConfig = exportConfigs.find((c) => c.type === selectedExport);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/portal/metrics">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Data Exports</h1>
          <p className="text-muted-foreground">
            Export data to CSV for reporting and analysis
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Export Options */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Export Data</CardTitle>
            <CardDescription>Choose what data to export</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Export Type Selection */}
            <div className="space-y-2">
              <Label>Export Type</Label>
              <div className="grid gap-3 md:grid-cols-2">
                {exportConfigs.map((config) => (
                  <div
                    key={config.type}
                    className={cn(
                      "flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors",
                      selectedExport === config.type
                        ? "border-primary bg-primary/5"
                        : "hover:border-muted-foreground/50"
                    )}
                    onClick={() => setSelectedExport(config.type)}
                  >
                    <div className="mt-0.5">{config.icon}</div>
                    <div>
                      <p className="font-medium">{config.label}</p>
                      <p className="text-xs text-muted-foreground">{config.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Date Range */}
            <div className="space-y-2">
              <Label>Date Range</Label>
              <div className="flex gap-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-left font-normal">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(dateRange.from, "MMM d, yyyy")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dateRange.from}
                      onSelect={(date) => date && setDateRange((prev) => ({ ...prev, from: date }))}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                <span className="flex items-center text-muted-foreground">to</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-left font-normal">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(dateRange.to, "MMM d, yyyy")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dateRange.to}
                      onSelect={(date) => date && setDateRange((prev) => ({ ...prev, to: date }))}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* Columns Preview */}
            {selectedConfig && (
              <div className="space-y-2">
                <Label>Columns Included</Label>
                <div className="flex flex-wrap gap-2">
                  {selectedConfig.columns.map((col) => (
                    <span
                      key={col}
                      className="px-2 py-1 text-xs bg-muted rounded-md"
                    >
                      {col}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <Button onClick={handleExport} disabled={isExporting} className="w-full">
              <Download className="mr-2 h-4 w-4" />
              {isExporting ? "Exporting..." : "Export to CSV"}
            </Button>
          </CardContent>
        </Card>

        {/* Export History */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Recent Exports
            </CardTitle>
          </CardHeader>
          <CardContent>
            {exportHistory.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No exports yet
              </p>
            ) : (
              <div className="space-y-3">
                {exportHistory.map((exp, index) => (
                  <div key={index} className="flex items-start gap-3 text-sm">
                    <FileSpreadsheet className="h-4 w-4 mt-0.5 text-muted-foreground" />
                    <div>
                      <p className="font-medium capitalize">{exp.type}</p>
                      <p className="text-xs text-muted-foreground">
                        {exp.date} • {exp.records} records
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Export Buttons */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quick Exports</CardTitle>
          <CardDescription>One-click exports for common reports</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-4">
            <Button
              variant="outline"
              onClick={() => {
                setSelectedExport("customers");
                setDateRange({ from: subMonths(new Date(), 1), to: new Date() });
                handleExport();
              }}
            >
              <Users className="mr-2 h-4 w-4" />
              All Customers
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setSelectedExport("bookings");
                setDateRange({ from: subDays(new Date(), 7), to: new Date() });
                handleExport();
              }}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              This Week's Bookings
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setSelectedExport("revenue");
                setDateRange({ from: subMonths(new Date(), 1), to: new Date() });
                handleExport();
              }}
            >
              <DollarSign className="mr-2 h-4 w-4" />
              Monthly Revenue
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setSelectedExport("cleaners");
                handleExport();
              }}
            >
              <UserCog className="mr-2 h-4 w-4" />
              All Cleaners
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
