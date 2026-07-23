"use client";

// ─── Admin Quotes ─────────────────────────────────────────────────────
//
// View saved VA quotes (from Internal Booking) and website custom-quote
// requests. From any row, send the customer-facing cleaning checklist
// via email and/or SMS (public /checklist/* page + full HTML email), and
// the Glow Membership benefits one-pager (/membership-benefits) — the
// benefits block is highlighted automatically on membership quotes
// (weekly / biweekly / monthly frequency).

import {
  RiSearchLine,
  RiMailLine,
  RiSmartphoneLine,
  RiExternalLinkLine,
  RiLoader4Line,
  RiAlertLine,
  RiFileList3Line,
  RiFileCopyLine,
  RiCalendarCheckLine,
  RiVipCrownLine,
} from "@remixicon/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface VaQuote {
  id: string;
  created_at: string;
  updated_at: string | null;
  csr_name: string | null;
  first_name: string;
  last_name: string | null;
  email: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  home_size_id: string;
  service_type: string;
  add_ons: string[] | null;
  frequency: string | null;
  service_date: string | null;
  time_slot: string | null;
  base_price_cents: number | null;
  total_estimate_cents: number | null;
  notes: string | null;
  team_notes: string | null;
  status: string;
  converted_booking_id: string | null;
}

interface CustomQuote {
  id: string;
  created_at: string;
  full_name: string;
  email: string;
  phone: string | null;
  address: string | null;
  sqft: number | null;
  notes: string | null;
  status: string | null;
}

type SendChannel = "email" | "sms" | "both";

const HOME_SIZE_LABELS: Record<string, string> = {
  "0_999": "Under 1,000 sq ft",
  "1000_1500": "1,000–1,500 sq ft",
  "1500_2000": "1,500–2,000 sq ft",
  "2000_2500": "2,000–2,500 sq ft",
  "2500_3000": "2,500–3,000 sq ft",
  "3000_3500": "3,000–3,500 sq ft",
  "3500_4000": "3,500–4,000 sq ft",
  "4000_4500": "4,000–4,500 sq ft",
  "4500_5000": "4,500–5,000 sq ft",
  "5000_plus": "5,000+ sq ft",
};

const SERVICE_LABELS: Record<string, string> = {
  standard: "Standard",
  deep: "Deep",
  moveInOut: "Move in/out",
  moveinout: "Move in/out",
  combo: "Combo",
  membership: "Membership",
};

function money(cents: number | null | undefined) {
  if (cents == null) return "—";
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fullName(q: VaQuote) {
  return `${q.first_name || ""} ${q.last_name || ""}`.trim() || q.email;
}

function checklistViewUrl(serviceType: string) {
  const base = "https://try.novaracleaning.com/checklist";
  const lower = (serviceType || "").toLowerCase().replace(/[\s_-]/g, "");
  if (lower.includes("move") || lower.includes("inout")) return `${base}/move-in-out`;
  if (lower === "deep" || lower === "combo") return `${base}/deep-clean`;
  if (lower.includes("member") || lower.includes("recur")) return `${base}/recurring`;
  return `${base}/standard-clean`;
}

function statusBadge(status: string) {
  const s = (status || "draft").toLowerCase();
  if (s === "converted") return "bg-emerald-50 text-emerald-800 border-emerald-200";
  if (s === "expired") return "bg-slate-100 text-slate-600 border-slate-200";
  if (s === "pending") return "bg-amber-50 text-amber-800 border-amber-200";
  return "bg-violet-50 text-violet-800 border-violet-200";
}

async function sendChecklist(opts: {
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  serviceType: string;
  channel: SendChannel;
}) {
  const sendEmail = opts.channel === "email" || opts.channel === "both";
  const sendSms = opts.channel === "sms" || opts.channel === "both";
  const { data, error } = await supabase.functions.invoke("send-cleaning-checklist", {
    body: {
      email: opts.email || undefined,
      phone: opts.phone || undefined,
      firstName: opts.firstName || undefined,
      serviceType: opts.serviceType,
      sendEmail,
      sendSms,
      force: true,
    },
  });
  if (error) throw error;
  if ((data as { error?: string })?.error) {
    throw new Error((data as { error: string }).error);
  }
  return data as {
    success?: boolean;
    emailed?: boolean;
    smsSent?: boolean;
    viewUrl?: string;
    skipped?: boolean;
  };
}

const MEMBERSHIP_BENEFITS_URL = "https://try.novaracleaning.com/membership-benefits";

/** Weekly / biweekly / monthly quotes are membership territory. */
function isMembershipQuote(q: Pick<VaQuote, "frequency" | "service_type">): boolean {
  const freq = (q.frequency || "").toLowerCase();
  if (["weekly", "biweekly", "bi-weekly", "monthly"].includes(freq)) return true;
  const svc = (q.service_type || "").toLowerCase();
  return svc.includes("member") || svc.includes("recur");
}

async function sendMembershipBenefits(opts: {
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  channel: SendChannel;
}) {
  const sendEmail = opts.channel === "email" || opts.channel === "both";
  const sendSms = opts.channel === "sms" || opts.channel === "both";
  const { data, error } = await supabase.functions.invoke("send-membership-benefits", {
    body: {
      email: opts.email || undefined,
      phone: opts.phone || undefined,
      firstName: opts.firstName || undefined,
      sendEmail,
      sendSms,
      force: true,
    },
  });
  if (error) throw error;
  if ((data as { error?: string })?.error) {
    throw new Error((data as { error: string }).error);
  }
  return data as {
    success?: boolean;
    emailed?: boolean;
    smsSent?: boolean;
    viewUrl?: string;
  };
}

// ─── Membership benefits send block (shared by both quote sheets) ────────
// Email the full benefits one-pager and/or text the public
// /membership-benefits page — portal access, before & after photo report,
// cleaner-selection control, and the rest of the Glow stack.
function MembershipBenefitsBlock({
  email,
  phone,
  firstName,
  suggested,
}: {
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  suggested: boolean;
}) {
  const [actioning, setActioning] = useState<SendChannel | "copy" | null>(null);

  const runSend = async (channel: SendChannel) => {
    if ((channel === "email" || channel === "both") && !email) {
      toast.error("No email on this quote");
      return;
    }
    if ((channel === "sms" || channel === "both") && !phone) {
      toast.error("No phone on this quote");
      return;
    }
    setActioning(channel);
    try {
      const data = await sendMembershipBenefits({ email, phone, firstName, channel });
      const parts: string[] = [];
      if (data.emailed) parts.push("emailed");
      if (data.smsSent) parts.push("texted");
      toast.success(
        parts.length
          ? `Membership benefits ${parts.join(" + ")}`
          : "Membership benefits send completed",
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to send membership benefits");
    } finally {
      setActioning(null);
    }
  };

  const copyLink = async () => {
    setActioning("copy");
    try {
      await navigator.clipboard.writeText(MEMBERSHIP_BENEFITS_URL);
      toast.success("Membership benefits link copied");
    } catch {
      toast.error("Copy failed");
    } finally {
      setActioning(null);
    }
  };

  return (
    <div
      className={cn(
        "space-y-3 rounded-xl p-3 -mx-1",
        suggested && "bg-violet-50/60 border border-violet-200",
      )}
    >
      <div className="flex items-start gap-2">
        <RiVipCrownLine className="w-5 h-5 text-violet-600 mt-0.5 shrink-0" />
        <div>
          <div className="font-medium text-slate-900 flex items-center gap-2">
            Membership benefits
            {suggested && (
              <Badge className="bg-violet-600 text-white border-0 text-[10px]">
                Membership quote
              </Badge>
            )}
          </div>
          <p className="text-sm text-slate-500">
            Email the Glow benefits one-pager and/or text the public benefits page — portal
            access, before &amp; after photo report, cleaner selection, member pricing.
          </p>
          <a
            href={MEMBERSHIP_BENEFITS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-violet-700 hover:underline mt-1"
          >
            Preview customer view <RiExternalLinkLine className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          className="bg-violet-600 hover:bg-violet-700 text-white"
          onClick={() => void runSend("email")}
          disabled={actioning !== null || !email}
        >
          {actioning === "email" ? (
            <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" />
          ) : (
            <RiMailLine className="w-4 h-4 mr-1.5" />
          )}
          Email benefits
        </Button>
        <Button
          variant="outline"
          className="border-violet-200 text-violet-800 bg-violet-50 hover:bg-violet-100"
          onClick={() => void runSend("sms")}
          disabled={actioning !== null || !phone}
        >
          {actioning === "sms" ? (
            <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" />
          ) : (
            <RiSmartphoneLine className="w-4 h-4 mr-1.5" />
          )}
          Text benefits link
        </Button>
        <Button
          variant="outline"
          className="border-slate-200"
          onClick={() => void runSend("both")}
          disabled={actioning !== null || !email || !phone}
        >
          {actioning === "both" ? (
            <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" />
          ) : (
            <RiMailLine className="w-4 h-4 mr-1.5" />
          )}
          Email + SMS
        </Button>
        <Button
          variant="outline"
          className="border-slate-200"
          onClick={() => void copyLink()}
          disabled={actioning === "copy"}
        >
          <RiFileCopyLine className="w-4 h-4 mr-1.5" />
          Copy link
        </Button>
      </div>
    </div>
  );
}

export default function AdminQuotes() {
  const [tab, setTab] = useState<"va" | "custom">("va");
  const [vaQuotes, setVaQuotes] = useState<VaQuote[]>([]);
  const [customQuotes, setCustomQuotes] = useState<CustomQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedVaId, setSelectedVaId] = useState<string | null>(null);
  const [selectedCustomId, setSelectedCustomId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [vaRes, customRes] = await Promise.all([
        (supabase as any)
          .from("va_quotes")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(200),
        (supabase as any)
          .from("custom_quotes")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(200),
      ]);
      if (vaRes.error) throw vaRes.error;
      if (customRes.error) throw customRes.error;
      setVaQuotes((vaRes.data || []) as VaQuote[]);
      setCustomQuotes((customRes.data || []) as CustomQuote[]);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to load quotes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedVa = useMemo(
    () => vaQuotes.find((q) => q.id === selectedVaId) || null,
    [vaQuotes, selectedVaId],
  );
  const selectedCustom = useMemo(
    () => customQuotes.find((q) => q.id === selectedCustomId) || null,
    [customQuotes, selectedCustomId],
  );

  const filteredVa = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vaQuotes.filter((row) => {
      if (statusFilter !== "all" && (row.status || "").toLowerCase() !== statusFilter) return false;
      if (!q) return true;
      const hay = [
        row.first_name,
        row.last_name,
        row.email,
        row.phone,
        row.zip_code,
        row.city,
        row.service_type,
        row.csr_name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [vaQuotes, search, statusFilter]);

  const filteredCustom = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customQuotes.filter((row) => {
      if (statusFilter !== "all" && (row.status || "pending").toLowerCase() !== statusFilter) {
        return false;
      }
      if (!q) return true;
      const hay = [row.full_name, row.email, row.phone, row.address, row.notes]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [customQuotes, search, statusFilter]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-jakarta text-2xl font-bold text-slate-900 tracking-tight">Quotes</h1>
          <p className="text-sm text-slate-500">
            Saved Internal Booking quotes and website custom-quote requests · send customer
            checklists by email or SMS.
          </p>
        </div>
        <Button asChild className="bg-violet-600 hover:bg-violet-700 text-white">
          <Link href="/admin/csr">
            <RiCalendarCheckLine className="w-4 h-4 mr-1.5" />
            New quote / book
          </Link>
        </Button>
      </div>

      <Card className="border-slate-200">
        <CardContent className="p-3 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <RiSearchLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, phone, ZIP…"
              className="pl-10"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-[160px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="converted">Converted</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "va" | "custom")}>
        <TabsList className="bg-slate-100">
          <TabsTrigger value="va">Saved quotes ({filteredVa.length})</TabsTrigger>
          <TabsTrigger value="custom">Website requests ({filteredCustom.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="va" className="mt-4">
          <QuoteTable
            loading={loading}
            empty="No saved quotes yet. Save one from Internal Booking."
            headers={["Customer", "Service", "Price", "Status", "Saved", ""]}
            rows={filteredVa.map((q) => (
              <tr
                key={q.id}
                onClick={() => setSelectedVaId(q.id)}
                className="cursor-pointer hover:bg-slate-50"
              >
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-900">{fullName(q)}</div>
                  <div className="text-xs text-slate-500 truncate max-w-[220px]">{q.email}</div>
                </td>
                <td className="px-4 py-3 text-slate-700">
                  <div>{SERVICE_LABELS[q.service_type] || q.service_type}</div>
                  <div className="text-xs text-slate-500">
                    {HOME_SIZE_LABELS[q.home_size_id] || q.home_size_id}
                    {q.frequency ? ` · ${q.frequency}` : ""}
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-900 font-semibold tabular-nums">
                  {money(q.total_estimate_cents)}
                </td>
                <td className="px-4 py-3">
                  <Badge variant="outline" className={cn("capitalize", statusBadge(q.status))}>
                    {q.status || "draft"}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {new Date(q.created_at).toLocaleDateString()}
                  {q.csr_name ? <div className="text-slate-400">by {q.csr_name}</div> : null}
                </td>
                <td className="px-4 py-3 text-right">
                  <Button size="sm" variant="ghost" className="text-violet-700">
                    Open
                  </Button>
                </td>
              </tr>
            ))}
          />
        </TabsContent>

        <TabsContent value="custom" className="mt-4">
          <QuoteTable
            loading={loading}
            empty="No website custom-quote requests yet."
            headers={["Name", "Contact", "Sq ft", "Status", "Requested", ""]}
            rows={filteredCustom.map((q) => (
              <tr
                key={q.id}
                onClick={() => setSelectedCustomId(q.id)}
                className="cursor-pointer hover:bg-slate-50"
              >
                <td className="px-4 py-3 font-medium text-slate-900">{q.full_name}</td>
                <td className="px-4 py-3">
                  <div className="text-slate-700 truncate max-w-[220px]">{q.email}</div>
                  <div className="text-xs text-slate-500">{q.phone || "—"}</div>
                </td>
                <td className="px-4 py-3 text-slate-700 tabular-nums">
                  {q.sqft != null ? q.sqft.toLocaleString() : "—"}
                </td>
                <td className="px-4 py-3">
                  <Badge
                    variant="outline"
                    className={cn("capitalize", statusBadge(q.status || "pending"))}
                  >
                    {q.status || "pending"}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {new Date(q.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-right">
                  <Button size="sm" variant="ghost" className="text-violet-700">
                    Open
                  </Button>
                </td>
              </tr>
            ))}
          />
        </TabsContent>
      </Tabs>

      <VaQuoteSheet
        quote={selectedVa}
        onClose={() => setSelectedVaId(null)}
        onSent={load}
      />
      <CustomQuoteSheet
        quote={selectedCustom}
        onClose={() => setSelectedCustomId(null)}
        onSent={load}
      />
    </div>
  );
}

function QuoteTable({
  loading,
  empty,
  headers,
  rows,
}: {
  loading: boolean;
  empty: string;
  headers: string[];
  rows: ReactNode[];
}) {
  return (
    <Card className="border-slate-200">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
            <tr>
              {headers.map((h, i) => (
                <th
                  key={`${h}-${i}`}
                  className={cn(
                    "px-4 py-3 font-semibold",
                    i === headers.length - 1 ? "w-10" : "text-left",
                  )}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={headers.length} className="p-3">
                    <Skeleton className="h-7 w-full" />
                  </td>
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={headers.length} className="text-center py-12 text-slate-500">
                  <RiAlertLine className="w-7 h-7 mx-auto text-slate-300 mb-2" />
                  {empty}
                </td>
              </tr>
            ) : (
              rows
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function VaQuoteSheet({
  quote,
  onClose,
  onSent,
}: {
  quote: VaQuote | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const [actioning, setActioning] = useState<SendChannel | "copy" | null>(null);

  const viewUrl = quote ? checklistViewUrl(quote.service_type) : "";

  const runSend = async (channel: SendChannel) => {
    if (!quote) return;
    if ((channel === "email" || channel === "both") && !quote.email) {
      toast.error("No email on this quote");
      return;
    }
    if ((channel === "sms" || channel === "both") && !quote.phone) {
      toast.error("No phone on this quote");
      return;
    }
    setActioning(channel);
    try {
      const data = await sendChecklist({
        email: quote.email,
        phone: quote.phone,
        firstName: quote.first_name,
        serviceType: quote.service_type,
        channel,
      });
      const parts: string[] = [];
      if (data.emailed) parts.push("emailed");
      if (data.smsSent) parts.push("texted");
      toast.success(
        parts.length
          ? `Checklist ${parts.join(" + ")} · customer view ready`
          : "Checklist send completed",
      );
      onSent();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to send checklist");
    } finally {
      setActioning(null);
    }
  };

  const copyLink = async () => {
    if (!viewUrl) return;
    setActioning("copy");
    try {
      await navigator.clipboard.writeText(viewUrl);
      toast.success("Customer checklist link copied");
    } catch {
      toast.error("Copy failed");
    } finally {
      setActioning(null);
    }
  };

  return (
    <Sheet open={Boolean(quote)} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto bg-white">
        {!quote ? null : (
          <>
            <SheetHeader className="pb-4 border-b border-slate-100">
              <SheetTitle className="text-lg text-slate-900">{fullName(quote)}</SheetTitle>
              <SheetDescription className="text-slate-500">
                Saved {new Date(quote.created_at).toLocaleString()}
                {quote.csr_name ? ` · by ${quote.csr_name}` : ""}
              </SheetDescription>
            </SheetHeader>

            <div className="py-4 space-y-5">
              <div className="grid sm:grid-cols-2 gap-3 text-sm">
                <Detail label="Email" value={quote.email} />
                <Detail label="Phone" value={quote.phone || "—"} />
                <Detail
                  label="Address"
                  value={
                    [quote.address, quote.city, quote.state, quote.zip_code]
                      .filter(Boolean)
                      .join(", ") || "—"
                  }
                />
                <Detail
                  label="Service"
                  value={`${SERVICE_LABELS[quote.service_type] || quote.service_type}${
                    quote.frequency ? ` · ${quote.frequency}` : ""
                  }`}
                />
                <Detail
                  label="Home size"
                  value={HOME_SIZE_LABELS[quote.home_size_id] || quote.home_size_id}
                />
                <Detail label="Estimate" value={money(quote.total_estimate_cents)} />
                <Detail
                  label="Preferred date"
                  value={
                    quote.service_date
                      ? `${quote.service_date}${quote.time_slot ? ` · ${quote.time_slot}` : ""}`
                      : "—"
                  }
                />
                <Detail label="Status" value={quote.status} />
              </div>

              {quote.team_notes ? (
                <div className="rounded-lg bg-slate-50 border border-slate-100 p-3 text-sm text-slate-700">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
                    Team notes
                  </div>
                  {quote.team_notes}
                </div>
              ) : null}

              <Separator />

              <div className="space-y-3">
                <div className="flex items-start gap-2">
                  <RiFileList3Line className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
                  <div>
                    <div className="font-medium text-slate-900">Customer checklist</div>
                    <p className="text-sm text-slate-500">
                      Email the full scope checklist and/or text the public customer view link for
                      this service type.
                    </p>
                    <a
                      href={viewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-violet-700 hover:underline mt-1"
                    >
                      Preview customer view <RiExternalLinkLine className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={() => void runSend("email")}
                    disabled={actioning !== null || !quote.email}
                  >
                    {actioning === "email" ? (
                      <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" />
                    ) : (
                      <RiMailLine className="w-4 h-4 mr-1.5" />
                    )}
                    Email checklist
                  </Button>
                  <Button
                    variant="outline"
                    className="border-emerald-200 text-emerald-800 bg-emerald-50 hover:bg-emerald-100"
                    onClick={() => void runSend("sms")}
                    disabled={actioning !== null || !quote.phone}
                  >
                    {actioning === "sms" ? (
                      <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" />
                    ) : (
                      <RiSmartphoneLine className="w-4 h-4 mr-1.5" />
                    )}
                    Text checklist link
                  </Button>
                  <Button
                    variant="outline"
                    className="border-slate-200"
                    onClick={() => void runSend("both")}
                    disabled={actioning !== null || !quote.email || !quote.phone}
                  >
                    {actioning === "both" ? (
                      <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" />
                    ) : (
                      <RiMailLine className="w-4 h-4 mr-1.5" />
                    )}
                    Email + SMS
                  </Button>
                  <Button
                    variant="outline"
                    className="border-slate-200"
                    onClick={() => void copyLink()}
                    disabled={actioning === "copy"}
                  >
                    <RiFileCopyLine className="w-4 h-4 mr-1.5" />
                    Copy link
                  </Button>
                </div>
              </div>

              <Separator />

              <MembershipBenefitsBlock
                email={quote.email}
                phone={quote.phone}
                firstName={quote.first_name}
                suggested={isMembershipQuote(quote)}
              />

              <Separator />

              <Button asChild variant="outline" className="w-full border-violet-200 text-violet-800">
                <Link href={`/admin/csr?quoteId=${quote.id}`}>Open in Internal Booking</Link>
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function CustomQuoteSheet({
  quote,
  onClose,
  onSent,
}: {
  quote: CustomQuote | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const [serviceType, setServiceType] = useState("standard");
  const [actioning, setActioning] = useState<SendChannel | "copy" | null>(null);

  useEffect(() => {
    setServiceType("standard");
  }, [quote?.id]);

  const viewUrl = checklistViewUrl(serviceType);
  const firstName = (quote?.full_name || "").trim().split(/\s+/)[0] || "there";

  const runSend = async (channel: SendChannel) => {
    if (!quote) return;
    if ((channel === "email" || channel === "both") && !quote.email) {
      toast.error("No email on this request");
      return;
    }
    if ((channel === "sms" || channel === "both") && !quote.phone) {
      toast.error("No phone on this request");
      return;
    }
    setActioning(channel);
    try {
      const data = await sendChecklist({
        email: quote.email,
        phone: quote.phone,
        firstName,
        serviceType,
        channel,
      });
      const parts: string[] = [];
      if (data.emailed) parts.push("emailed");
      if (data.smsSent) parts.push("texted");
      toast.success(
        parts.length ? `Checklist ${parts.join(" + ")}` : "Checklist send completed",
      );
      onSent();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to send checklist");
    } finally {
      setActioning(null);
    }
  };

  const copyLink = async () => {
    setActioning("copy");
    try {
      await navigator.clipboard.writeText(viewUrl);
      toast.success("Customer checklist link copied");
    } catch {
      toast.error("Copy failed");
    } finally {
      setActioning(null);
    }
  };

  return (
    <Sheet open={Boolean(quote)} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto bg-white">
        {!quote ? null : (
          <>
            <SheetHeader className="pb-4 border-b border-slate-100">
              <SheetTitle className="text-lg text-slate-900">{quote.full_name}</SheetTitle>
              <SheetDescription className="text-slate-500">
                Website custom quote · {new Date(quote.created_at).toLocaleString()}
              </SheetDescription>
            </SheetHeader>

            <div className="py-4 space-y-5">
              <div className="grid sm:grid-cols-2 gap-3 text-sm">
                <Detail label="Email" value={quote.email} />
                <Detail label="Phone" value={quote.phone || "—"} />
                <Detail label="Address" value={quote.address || "—"} />
                <Detail
                  label="Sq ft"
                  value={quote.sqft != null ? quote.sqft.toLocaleString() : "—"}
                />
                <Detail label="Status" value={quote.status || "pending"} />
              </div>
              {quote.notes ? (
                <div className="rounded-lg bg-slate-50 border border-slate-100 p-3 text-sm text-slate-700">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
                    Notes
                  </div>
                  {quote.notes}
                </div>
              ) : null}

              <Separator />

              <div className="space-y-3">
                <div>
                  <Label className="text-slate-700">Checklist service type</Label>
                  <Select value={serviceType} onValueChange={setServiceType}>
                    <SelectTrigger className="mt-1.5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="standard">Standard / maintenance</SelectItem>
                      <SelectItem value="deep">Deep clean</SelectItem>
                      <SelectItem value="moveInOut">Move in / out</SelectItem>
                      <SelectItem value="combo">Combo (deep first)</SelectItem>
                    </SelectContent>
                  </Select>
                  <a
                    href={viewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-violet-700 hover:underline mt-2"
                  >
                    Preview customer view <RiExternalLinkLine className="w-3.5 h-3.5" />
                  </a>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={() => void runSend("email")}
                    disabled={actioning !== null || !quote.email}
                  >
                    {actioning === "email" ? (
                      <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" />
                    ) : (
                      <RiMailLine className="w-4 h-4 mr-1.5" />
                    )}
                    Email checklist
                  </Button>
                  <Button
                    variant="outline"
                    className="border-emerald-200 text-emerald-800 bg-emerald-50 hover:bg-emerald-100"
                    onClick={() => void runSend("sms")}
                    disabled={actioning !== null || !quote.phone}
                  >
                    {actioning === "sms" ? (
                      <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" />
                    ) : (
                      <RiSmartphoneLine className="w-4 h-4 mr-1.5" />
                    )}
                    Text checklist link
                  </Button>
                  <Button
                    variant="outline"
                    className="border-slate-200"
                    onClick={() => void runSend("both")}
                    disabled={actioning !== null || !quote.email || !quote.phone}
                  >
                    Email + SMS
                  </Button>
                  <Button
                    variant="outline"
                    className="border-slate-200"
                    onClick={() => void copyLink()}
                    disabled={actioning === "copy"}
                  >
                    <RiFileCopyLine className="w-4 h-4 mr-1.5" />
                    Copy link
                  </Button>
                </div>
              </div>

              <Separator />

              <MembershipBenefitsBlock
                email={quote.email}
                phone={quote.phone}
                firstName={firstName}
                suggested={false}
              />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">{label}</div>
      <div className="text-slate-800 mt-0.5 break-words">{value}</div>
    </div>
  );
}
