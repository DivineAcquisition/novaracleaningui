"use client";

// ─── /admin/qc — QC & Job Documentation Hub ─────────────────────────────
//
// Two connected capabilities:
//   1. Documentation — every completed job's before/after photos, checklist,
//      and Drive dispute packet, with mirror status + compliance metrics.
//      Supabase is the queryable store; Google Drive is the durable archive.
//   2. Issues — complaints / re-cleans / damage / no-shows / quality flags,
//      each tied to a job so its documentation is the evidence. Lifecycle
//      Open → Investigating → Awaiting Customer → Resolved/Escalated with a
//      full audit trail.
//
// Dashboard: open issues by severity, issues by cleaner, issue rate, and
// documentation compliance (undocumented completed jobs surfaced loudly).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  RiAlertLine,
  RiAddLine,
  RiCameraLine,
  RiCheckboxCircleFill,
  RiCloseCircleLine,
  RiExternalLinkLine,
  RiFileTextLine,
  RiFolderCheckLine,
  RiLoader4Line,
  RiMoneyDollarCircleLine,
  RiRefreshLine,
  RiSearch2Line,
  RiShieldCheckLine,
  RiUserSmileLine,
} from "@remixicon/react";
import { format } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import AccountabilityActionDialog from "@/components/admin/AccountabilityActionDialog";
import RecleanWorkflow from "@/components/admin/RecleanWorkflow";
import { ChecklistItemPicker } from "@/components/checklists/ChecklistItemPicker";

// ─── Types ──────────────────────────────────────────────────────────────

interface AttachedCleaner {
  id: string;
  name: string | null;
  role: string | null;
}

interface IssueRow {
  id: string;
  issue_number: number;
  booking_id: string;
  job_id: string | null;
  client_type?: string | null;
  booking_ref: string | null;
  documentation_id: string | null;
  cleaner_id: string | null;
  cleaner_name: string | null;
  cleaners: AttachedCleaner[] | null;
  client_name: string | null;
  client_email: string | null;
  issue_type: string;
  severity: string;
  status: string;
  title: string;
  description: string | null;
  reported_via: string;
  reported_by_name: string | null;
  resolution_note: string | null;
  resolution_photos: string[] | null;
  resolved_at: string | null;
  resolved_by_name: string | null;
  created_at: string;
  updated_at: string;
  details?: Record<string, unknown> | null;
  reclean_status?: string | null;
  reclean_classification?: string | null;
  reclean_inside_window?: boolean | null;
}

interface IssueEvent {
  id: string;
  action: string;
  from_status: string | null;
  to_status: string | null;
  note: string | null;
  actor_name: string | null;
  created_at: string;
}

interface DocRow {
  id: string;
  booking_id: string | null;
  client_type?: string | null;
  source_kind?: string | null;
  booking_ref: string | null;
  client_name: string | null;
  service_type: string | null;
  service_date: string | null;
  cleaner_names: string | null;
  before_photos: string[];
  after_photos: string[];
  photo_count: number;
  checklist_progress_pct: number | null;
  documented: boolean;
  mirror_status: string;
  mirror_attempts: number;
  mirror_last_error: string | null;
  mirrored_at: string | null;
  drive_folder_url: string | null;
  drive_pdf_url: string | null;
  photos_purged_at: string | null;
  completed_at: string | null;
}

interface BookingPick {
  id: string;
  booking_number: number | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  service_date: string | null;
  service_type: string | null;
  status: string | null;
}

// ─── Constants ──────────────────────────────────────────────────────────

const SEVERITY_STYLE: Record<string, string> = {
  low: "bg-slate-100 text-slate-600",
  medium: "bg-amber-100 text-amber-700",
  high: "bg-orange-100 text-orange-700",
  critical: "bg-rose-100 text-rose-700",
};
const STATUS_STYLE: Record<string, string> = {
  open: "bg-rose-100 text-rose-700",
  investigating: "bg-blue-100 text-blue-700",
  awaiting_customer: "bg-amber-100 text-amber-700",
  resolved: "bg-emerald-100 text-emerald-700",
  escalated: "bg-purple-100 text-purple-700",
};
const MIRROR_STYLE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  mirroring: "bg-blue-100 text-blue-700",
  mirrored: "bg-emerald-100 text-emerald-700",
  failed: "bg-rose-100 text-rose-700",
  skipped: "bg-slate-100 text-slate-500",
};
const CLIENT_TYPES = [
  { id: "residential", label: "Residential" },
  { id: "commercial", label: "Commercial" },
  { id: "office", label: "Office" },
  { id: "str", label: "STR / Airbnb" },
];
const CLIENT_TYPE_STYLE: Record<string, string> = {
  residential: "bg-slate-100 text-slate-600",
  commercial: "bg-blue-100 text-blue-700",
  office: "bg-cyan-100 text-cyan-700",
  str: "bg-fuchsia-100 text-fuchsia-700",
};

const ISSUE_TYPES = [
  { id: "complaint", label: "Complaint" },
  { id: "reclean", label: "Re-clean" },
  { id: "damage", label: "Damage" },
  { id: "no_show", label: "No-show" },
  { id: "late", label: "Late arrival" },
  { id: "quality_flag", label: "Quality flag" },
  { id: "payment", label: "Payment" },
  { id: "site_finding", label: "Site finding" },
  { id: "addon", label: "Add-on" },
  { id: "other", label: "Other" },
];
const STATUSES = ["open", "investigating", "awaiting_customer", "resolved", "escalated"];
const SEVERITIES = ["low", "medium", "high", "critical"];

const label = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const fmtDT = (iso?: string | null) => (iso ? format(new Date(iso), "MMM d, yyyy h:mm a") : "—");
const fmtD = (iso?: string | null) => (iso ? format(new Date(`${iso}`.slice(0, 10) + "T12:00:00"), "MMM d, yyyy") : "—");

// ─── Page ───────────────────────────────────────────────────────────────

export default function QualityControl() {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<"issues" | "docs" | "cleaners" | "scope" | "recleans">("issues");
  const [loading, setLoading] = useState(true);
  const [allIssues, setAllIssues] = useState<IssueRow[]>([]);
  const [allDocs, setAllDocs] = useState<DocRow[]>([]);
  // One hub, three sources — the client-type dimension filters every view.
  const [clientType, setClientType] = useState("all");
  const [completed30, setCompleted30] = useState(0);
  const deepLinkIssueId = searchParams.get("issue");
  const issues = useMemo(
    () => (clientType === "all" ? allIssues : allIssues.filter((i) => (i.client_type || "residential") === clientType)),
    [allIssues, clientType],
  );
  const docs = useMemo(
    () => (clientType === "all" ? allDocs : allDocs.filter((d) => (d.client_type || "residential") === clientType)),
    [allDocs, clientType],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const since90 = new Date(Date.now() - 90 * 86400_000).toISOString();
      const since30 = new Date(Date.now() - 30 * 86400_000).toISOString();
      const [issuesRes, docsRes, completedRes] = await Promise.all([
        (supabase.from as any)("qc_issues").select("*").order("created_at", { ascending: false }).limit(500),
        (supabase.from as any)("job_documentation")
          .select("id, booking_id, client_type, source_kind, booking_ref, client_name, service_type, service_date, cleaner_names, before_photos, after_photos, photo_count, checklist_progress_pct, documented, mirror_status, mirror_attempts, mirror_last_error, mirrored_at, drive_folder_url, drive_pdf_url, photos_purged_at, completed_at")
          .gte("completed_at", since90)
          .order("completed_at", { ascending: false })
          .limit(500),
        supabase.from("bookings").select("id", { count: "exact", head: true })
          .eq("status", "completed").gte("completed_at", since30),
      ]);
      setAllIssues(((issuesRes.data || []) as IssueRow[]));
      setAllDocs(((docsRes.data || []) as DocRow[]));
      setCompleted30(completedRes.count || 0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load QC data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (deepLinkIssueId) setTab("issues");
  }, [deepLinkIssueId]);

  // ─── Dashboard metrics ────────────────────────────────────────────────
  const openIssues = useMemo(() => issues.filter((i) => i.status !== "resolved"), [issues]);
  const openBySeverity = useMemo(() => {
    const m: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const i of openIssues) m[i.severity] = (m[i.severity] || 0) + 1;
    return m;
  }, [openIssues]);
  const docs30 = useMemo(
    () => docs.filter((d) => d.completed_at && new Date(d.completed_at).getTime() > Date.now() - 30 * 86400_000),
    [docs],
  );
  const compliancePct = useMemo(() => {
    if (docs30.length === 0) return null;
    return Math.round((docs30.filter((d) => d.documented).length / docs30.length) * 100);
  }, [docs30]);
  const undocumented = useMemo(() => docs.filter((d) => !d.documented && !d.photos_purged_at), [docs]);
  // Documentation compliance per client type (30d) — an undocumented
  // commercial visit is as much a gap as an undocumented turnover.
  const complianceByType = useMemo(() => {
    const recent = allDocs.filter((d) => d.completed_at && new Date(d.completed_at).getTime() > Date.now() - 30 * 86400_000);
    return CLIENT_TYPES.map((t) => {
      const ofType = recent.filter((d) => (d.client_type || "residential") === t.id);
      return {
        ...t,
        total: ofType.length,
        pct: ofType.length ? Math.round((ofType.filter((d) => d.documented).length / ofType.length) * 100) : null,
      };
    }).filter((t) => t.total > 0);
  }, [allDocs]);
  const issues30 = useMemo(
    () => issues.filter((i) => new Date(i.created_at).getTime() > Date.now() - 30 * 86400_000),
    [issues],
  );
  const issueRatePct = useMemo(() => {
    if (!completed30) return null;
    return Math.round((issues30.length / completed30) * 1000) / 10;
  }, [issues30, completed30]);
  const byCleaner = useMemo(() => {
    const m = new Map<string, { name: string; total: number; open: number; recleans: number; complaints: number }>();
    for (const i of issues) {
      // Crew jobs: every cleaner attached to the case is counted, not just
      // the lead — the incident happened on everyone's job.
      const names = (i.cleaners?.length ? i.cleaners.map((c) => c.name).filter(Boolean) : [i.cleaner_name])
        .map((n) => n || "Unattributed");
      for (const key of names.length ? names : ["Unattributed"]) {
        const e = m.get(key) || { name: key, total: 0, open: 0, recleans: 0, complaints: 0 };
        e.total++;
        if (i.status !== "resolved") e.open++;
        if (i.issue_type === "reclean") e.recleans++;
        if (i.issue_type === "complaint") e.complaints++;
        m.set(key, e);
      }
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [issues]);

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-[1400px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <RiShieldCheckLine className="w-6 h-6 text-violet-600" /> Quality Control
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            A documented job is a defensible job — photos + checklist in Supabase, dispute packets in Drive.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={clientType} onValueChange={setClientType}>
            <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All client types</SelectItem>
              {CLIENT_TYPES.map((t) => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RiRefreshLine className={cn("w-4 h-4 mr-1.5", loading && "animate-spin")} /> Refresh
          </Button>
          <SiteFindingTemplatesButton />
        </div>
      </div>

      {/* ─── Dashboard cards ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium text-slate-500">Open issues</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{openIssues.length}</p>
            <div className="flex flex-wrap gap-1 mt-2">
              {SEVERITIES.slice().reverse().map((s) => (
                <span key={s} className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded", SEVERITY_STYLE[s])}>
                  {openBySeverity[s] || 0} {label(s)}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card className={cn(compliancePct !== null && compliancePct < 80 && "border-rose-300")}>
          <CardContent className="p-4">
            <p className="text-xs font-medium text-slate-500">Documentation compliance (30d)</p>
            <p className={cn("text-2xl font-bold mt-1", compliancePct !== null && compliancePct < 80 ? "text-rose-600" : "text-emerald-600")}>
              {compliancePct === null ? "—" : `${compliancePct}%`}
            </p>
            <p className="text-[11px] text-slate-500 mt-2">
              {docs30.filter((d) => d.documented).length}/{docs30.length} completed jobs fully documented
            </p>
            {clientType === "all" && complianceByType.length > 1 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {complianceByType.map((t) => (
                  <span key={t.id} className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded", CLIENT_TYPE_STYLE[t.id])}>
                    {t.label}: {t.pct}%
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium text-slate-500">Issue rate (30d)</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{issueRatePct === null ? "—" : `${issueRatePct}%`}</p>
            <p className="text-[11px] text-slate-500 mt-2">{issues30.length} issues / {completed30} completed jobs</p>
          </CardContent>
        </Card>
        <Card className={cn(undocumented.length > 0 && "border-rose-300 bg-rose-50/50")}>
          <CardContent className="p-4">
            <p className="text-xs font-medium text-slate-500">Undocumented jobs</p>
            <p className={cn("text-2xl font-bold mt-1", undocumented.length > 0 ? "text-rose-600" : "text-emerald-600")}>
              {undocumented.length}
            </p>
            <p className="text-[11px] text-slate-500 mt-2">
              {undocumented.length > 0 ? "Missing before/after photos — undefendable in a dispute" : "Every completed job has evidence"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ─── Tabs ──────────────────────────────────────────────────────── */}
      <div className="flex gap-1 border-b border-slate-200">
        {([["issues", "Issues"], ["docs", "Documentation"], ["cleaners", "By Cleaner"], ["recleans", "Re-cleans"], ["scope", "Scope Adjustments"]] as const).map(([id, t]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors",
              tab === id ? "border-violet-600 text-violet-700" : "border-transparent text-slate-500 hover:text-slate-800",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : tab === "issues" ? (
        <IssuesTab issues={issues} docs={docs} reload={load} deepLinkIssueId={deepLinkIssueId} />
      ) : tab === "docs" ? (
        <DocsTab docs={docs} reload={load} />
      ) : tab === "cleaners" ? (
        <CleanersTab byCleaner={byCleaner} />
      ) : tab === "recleans" ? (
        <RecleansTab />
      ) : (
        <ScopeAdjustmentsTab />
      )}
    </div>
  );
}

// ─── Issues tab ─────────────────────────────────────────────────────────

function IssuesTab({
  issues,
  docs,
  reload,
  deepLinkIssueId,
}: {
  issues: IssueRow[];
  docs: DocRow[];
  reload: () => Promise<void>;
  deepLinkIssueId?: string | null;
}) {
  const [statusFilter, setStatusFilter] = useState("active");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<IssueRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (!deepLinkIssueId || issues.length === 0) return;
    const match = issues.find((i) => i.id === deepLinkIssueId);
    if (match) {
      setStatusFilter("all");
      setSelected(match);
    }
  }, [deepLinkIssueId, issues]);

  const filtered = useMemo(() => issues.filter((i) => {
    if (statusFilter === "active" && i.status === "resolved") return false;
    if (statusFilter !== "all" && statusFilter !== "active" && i.status !== statusFilter) return false;
    if (severityFilter !== "all" && i.severity !== severityFilter) return false;
    if (typeFilter !== "all" && i.issue_type !== typeFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const hay = `${i.booking_ref} ${i.client_name} ${i.client_email} ${i.cleaner_name} ${i.title}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }), [issues, statusFilter, severityFilter, typeFilter, search]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <RiSearch2Line className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input placeholder="Search ref, client, cleaner…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active (unresolved)</SelectItem>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{label(s)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severities</SelectItem>
            {SEVERITIES.map((s) => <SelectItem key={s} value={s}>{label(s)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {ISSUE_TYPES.map((t) => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button onClick={() => setCreateOpen(true)}>
          <RiAddLine className="w-4 h-4 mr-1.5" /> Report issue
        </Button>
      </div>

      {filtered.length === 0 ? (
        <Card><CardContent className="p-10 text-center text-slate-500 text-sm">
          <RiCheckboxCircleFill className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
          No issues match these filters.
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((i) => (
            <button
              key={i.id}
              onClick={() => setSelected(i)}
              className="w-full text-left rounded-xl border border-slate-200 bg-white px-4 py-3 hover:border-violet-300 hover:shadow-sm transition-all"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-slate-400">#{i.issue_number}</span>
                <Badge className={cn("border-0", CLIENT_TYPE_STYLE[i.client_type || "residential"])}>
                  {CLIENT_TYPES.find((t) => t.id === (i.client_type || "residential"))?.label}
                </Badge>
                <Badge className={cn("border-0", SEVERITY_STYLE[i.severity])}>{label(i.severity)}</Badge>
                <Badge className={cn("border-0", STATUS_STYLE[i.status])}>{label(i.status)}</Badge>
                <Badge variant="outline">{ISSUE_TYPES.find((t) => t.id === i.issue_type)?.label || i.issue_type}</Badge>
            {i.reclean_status && i.reclean_status !== "none" && (
              <Badge className="border-0 bg-violet-100 text-violet-800">Re-clean: {i.reclean_status.replace(/_/g, " ")}</Badge>
            )}
                <span className="text-xs text-slate-400 ml-auto">{fmtDT(i.created_at)}</span>
              </div>
              <p className="font-semibold text-slate-900 mt-1.5">{i.title}</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {i.booking_ref || i.booking_id.slice(0, 8)} · {i.client_name || i.client_email || "—"}
                {i.cleaners?.length
                  ? ` · cleaner${i.cleaners.length > 1 ? "s" : ""}: ${i.cleaners.map((c) => c.name).filter(Boolean).join(", ")}`
                  : i.cleaner_name ? ` · cleaner: ${i.cleaner_name}` : ""} · via {label(i.reported_via)}
                {i.reported_by_name ? ` (${i.reported_by_name})` : ""}
              </p>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <IssueSheet
          issue={selected}
          doc={docs.find((d) => d.booking_id === selected.booking_id) || null}
          onClose={() => setSelected(null)}
          reload={reload}
        />
      )}
      {createOpen && <CreateIssueDialog onClose={() => setCreateOpen(false)} reload={reload} />}
    </div>
  );
}

// ─── Issue detail sheet (timeline + evidence + actions) ─────────────────

function IssueSheet({ issue, doc, onClose, reload }: {
  issue: IssueRow;
  doc: DocRow | null;
  onClose: () => void;
  reload: () => Promise<void>;
}) {
  const [events, setEvents] = useState<IssueEvent[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [caseOpen, setCaseOpen] = useState(false);
  const [accountabilityOpen, setAccountabilityOpen] = useState(false);
  // Crew-aware attribution: every cleaner attached to the case (auto-filled
  // from the job's assignments; admin can attach/detach) and which one an
  // accountability action targets.
  const [attached, setAttached] = useState<AttachedCleaner[]>(
    issue.cleaners?.length
      ? issue.cleaners
      : issue.cleaner_id
        ? [{ id: issue.cleaner_id, name: issue.cleaner_name, role: null }]
        : [],
  );
  const [jobCleaners, setJobCleaners] = useState<AttachedCleaner[]>([]);
  const [attachPick, setAttachPick] = useState("");
  const [attachBusy, setAttachBusy] = useState(false);
  const [actionCleanerId, setActionCleanerId] = useState("");

  useEffect(() => {
    void (async () => {
      const { data } = await (supabase.from as any)("qc_issue_events")
        .select("id, action, from_status, to_status, note, actor_name, created_at")
        .eq("issue_id", issue.id)
        .order("created_at", { ascending: true });
      setEvents((data || []) as IssueEvent[]);
    })();
  }, [issue.id]);

  // Everyone assigned to this job — the pool the attach picker draws from.
  useEffect(() => {
    if (!issue.job_id) return;
    void (async () => {
      const { data } = await (supabase.from as any)("job_assignments")
        .select("cleaner_id, role, status, cleaners(first_name, last_name)")
        .eq("job_id", issue.job_id);
      const seen = new Set<string>();
      const out: AttachedCleaner[] = [];
      for (const a of data || []) {
        if (!a.cleaner_id || seen.has(a.cleaner_id)) continue;
        if (!["confirmed", "accepted", "completed", "in progress"].includes(String(a.status || "").toLowerCase())) continue;
        seen.add(a.cleaner_id);
        const c = Array.isArray(a.cleaners) ? a.cleaners[0] : a.cleaners;
        out.push({
          id: a.cleaner_id,
          name: c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() || null : null,
          role: a.role || null,
        });
      }
      setJobCleaners(out);
    })();
  }, [issue.job_id]);

  // Keep the accountability target valid as attachments change.
  useEffect(() => {
    if (!actionCleanerId || !attached.some((c) => c.id === actionCleanerId)) {
      setActionCleanerId(attached[0]?.id || "");
    }
  }, [attached, actionCleanerId]);

  const unattached = jobCleaners.filter((c) => !attached.some((a) => a.id === c.id));
  const actionCleaner = attached.find((c) => c.id === actionCleanerId) || null;

  const attachCleaner = async (cleanerId: string) => {
    if (!cleanerId) return;
    setAttachBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("qc-issues", {
        body: { action: "attach_cleaner", issueId: issue.id, cleanerId },
      });
      if (error) throw error;
      const d = data as { ok?: boolean; error?: string; cleaners?: AttachedCleaner[] };
      if (d?.ok === false) throw new Error(d.error || "Attach failed");
      if (d.cleaners) setAttached(d.cleaners);
      setAttachPick("");
      toast.success("Cleaner attached to this case.");
      void reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Attach failed");
    } finally {
      setAttachBusy(false);
    }
  };

  const detachCleaner = async (cleanerId: string) => {
    setAttachBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("qc-issues", {
        body: { action: "detach_cleaner", issueId: issue.id, cleanerId },
      });
      if (error) throw error;
      const d = data as { ok?: boolean; error?: string; cleaners?: AttachedCleaner[] };
      if (d?.ok === false) throw new Error(d.error || "Detach failed");
      if (d.cleaners) setAttached(d.cleaners);
      toast.success("Cleaner detached (logged in the audit trail).");
      void reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Detach failed");
    } finally {
      setAttachBusy(false);
    }
  };

  const act = async (body: Record<string, unknown>, busyKey: string, success: string) => {
    setBusy(busyKey);
    try {
      const { data, error } = await supabase.functions.invoke("qc-issues", { body: { issueId: issue.id, ...body } });
      if (error) throw error;
      if ((data as { ok?: boolean; error?: string })?.ok === false) throw new Error((data as { error?: string }).error || "Failed");
      toast.success(success);
      setNote("");
      await reload();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  const beforePhotos = (doc?.before_photos || []).filter((u) => u.startsWith("http"));
  const afterPhotos = (doc?.after_photos || []).filter((u) => u.startsWith("http"));

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm text-slate-400">#{issue.issue_number}</span>
            {issue.title}
          </SheetTitle>
          <SheetDescription>
            {issue.booking_ref} · {issue.client_name || issue.client_email} · reported {fmtDT(issue.created_at)} by {issue.reported_by_name || label(issue.reported_via)}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-5">
          <div className="flex flex-wrap gap-2">
            <Badge className={cn("border-0", SEVERITY_STYLE[issue.severity])}>{label(issue.severity)}</Badge>
            <Badge className={cn("border-0", STATUS_STYLE[issue.status])}>{label(issue.status)}</Badge>
            <Badge variant="outline">{ISSUE_TYPES.find((t) => t.id === issue.issue_type)?.label || issue.issue_type}</Badge>
            {issue.reclean_status && issue.reclean_status !== "none" && (
              <Badge className="border-0 bg-violet-100 text-violet-800">Re-clean: {issue.reclean_status.replace(/_/g, " ")}</Badge>
            )}
            {attached.length > 0 && (
              <Badge variant="outline">
                Cleaner{attached.length > 1 ? "s" : ""}: {attached.map((c) => c.name).filter(Boolean).join(", ")}
              </Badge>
            )}
          </div>

          {issue.description && (
            <p className="text-sm text-slate-700 whitespace-pre-wrap bg-slate-50 rounded-lg p-3">{issue.description}</p>
          )}

          {issue.issue_type === "site_finding" && issue.details && (
            <SiteFindingEvidence details={issue.details} />
          )}
          {issue.issue_type === "addon" && issue.details && (
            <AddonEvidence details={issue.details} />
          )}

          <ChecklistTagging issue={issue} onSaved={reload} />

          {((issue.reclean_status && issue.reclean_status !== "none") || ["reclean", "complaint", "quality_flag"].includes(issue.issue_type)) && (
            <RecleanWorkflow issueId={issue.id} onChanged={reload} />
          )}

          {/* ─── Evidence: the linked job's documentation ─────────────── */}
          <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-violet-800 flex items-center gap-1.5">
                <RiFolderCheckLine className="w-4 h-4" /> Job evidence
              </p>
              <Button size="sm" variant="outline" className="h-7 text-xs border-violet-300 text-violet-700" onClick={() => setCaseOpen(true)}>
                Full case file
              </Button>
            </div>
            {doc ? (
              <>
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge className={cn("border-0", doc.documented ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700")}>
                    {doc.documented ? "Documented ✓" : "NOT documented"}
                  </Badge>
                  <Badge className={cn("border-0", MIRROR_STYLE[doc.mirror_status])}>Drive: {label(doc.mirror_status)}</Badge>
                  {doc.checklist_progress_pct != null && <Badge variant="outline">Checklist {doc.checklist_progress_pct}%</Badge>}
                  <Badge variant="outline">{doc.photo_count} photos</Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  {doc.drive_folder_url && (
                    <a href={doc.drive_folder_url} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-violet-700 hover:underline">
                      <RiExternalLinkLine className="w-3.5 h-3.5" /> Drive folder
                    </a>
                  )}
                  {doc.drive_pdf_url && (
                    <a href={doc.drive_pdf_url} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-violet-700 hover:underline">
                      <RiFileTextLine className="w-3.5 h-3.5" /> Dispute packet (PDF)
                    </a>
                  )}
                </div>
                {!doc.photos_purged_at && (beforePhotos.length > 0 || afterPhotos.length > 0) && (
                  <div className="grid grid-cols-4 gap-1.5">
                    {[...beforePhotos.slice(0, 4).map((u) => ({ u, l: "Before" })), ...afterPhotos.slice(0, 4).map((u) => ({ u, l: "After" }))].map(({ u, l }, i) => (
                      <a key={i} href={u} target="_blank" rel="noreferrer" className="relative group">
                        <img src={u} alt={l} className="w-full h-16 object-cover rounded-md border border-slate-200" />
                        <span className="absolute bottom-0.5 left-0.5 text-[9px] font-bold bg-black/60 text-white px-1 rounded">{l}</span>
                      </a>
                    ))}
                  </div>
                )}
                {doc.photos_purged_at && (
                  <p className="text-[11px] text-slate-500">
                    Supabase copies purged {fmtDT(doc.photos_purged_at)} (14-day retention) — originals live in the Drive folder above.
                  </p>
                )}
              </>
            ) : (
              <p className="text-xs text-rose-600 font-medium">
                No documentation record for this job — it may predate the QC hub or the job never completed.
              </p>
            )}
          </div>

          {/* ─── Cleaners on this case + accountability ───────────────── */}
          <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 space-y-3">
            <p className="text-sm font-bold text-amber-900">Cleaners on this case</p>
            <div className="flex flex-wrap gap-1.5">
              {attached.length === 0 && (
                <p className="text-xs text-amber-900/70">
                  No cleaner attached yet — attach one from the job&apos;s crew below.
                </p>
              )}
              {attached.map((c) => (
                <span
                  key={c.id}
                  className="inline-flex items-center gap-1 rounded-full bg-white border border-amber-300 pl-2.5 pr-1 py-0.5 text-xs font-medium text-amber-900"
                >
                  {c.name || "Cleaner"}
                  {c.role ? <span className="text-amber-700/60">· {c.role}</span> : null}
                  <button
                    type="button"
                    className="ml-0.5 rounded-full hover:bg-amber-100 p-0.5"
                    title="Detach from this case (logged)"
                    disabled={attachBusy}
                    onClick={() => void detachCleaner(c.id)}
                  >
                    <RiCloseCircleLine className="w-3.5 h-3.5 text-amber-700" />
                  </button>
                </span>
              ))}
            </div>
            {unattached.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <Select value={attachPick} onValueChange={setAttachPick}>
                  <SelectTrigger className="w-[220px] h-8 bg-white text-xs">
                    <SelectValue placeholder="Attach a cleaner from this job…" />
                  </SelectTrigger>
                  <SelectContent>
                    {unattached.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name || "Cleaner"}{c.role ? ` (${c.role})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 border-amber-300 text-amber-900 bg-white hover:bg-amber-100"
                  disabled={!attachPick || attachBusy}
                  onClick={() => void attachCleaner(attachPick)}
                >
                  {attachBusy ? <RiLoader4Line className="w-3.5 h-3.5 animate-spin" /> : "Attach"}
                </Button>
                <span className="text-[11px] text-amber-800/70">
                  Only cleaners assigned to this job can be attached.
                </span>
              </div>
            )}

            {attached.length > 0 && (
              <div className="pt-1 border-t border-amber-200/70 space-y-2">
                <p className="text-xs text-amber-900/80">
                  Take a formal action pre-linked to this case — coaching note, strike, suspension,
                  or removal. Documented, emailed (office + QC CC&apos;d), and logged on their profile.
                  Never touches pay for completed work.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {attached.length > 1 && (
                    <Select value={actionCleanerId} onValueChange={setActionCleanerId}>
                      <SelectTrigger className="w-[200px] h-8 bg-white text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {attached.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name || "Cleaner"}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-amber-300 text-amber-900 bg-white hover:bg-amber-100"
                    disabled={!actionCleaner}
                    onClick={() => setAccountabilityOpen(true)}
                  >
                    Take action on {actionCleaner?.name || "cleaner"} → Strike / Suspend / Remove / Coaching note
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* ─── Timeline ─────────────────────────────────────────────── */}
          <div>
            <p className="text-sm font-bold text-slate-800 mb-2">Audit trail</p>
            <div className="space-y-2">
              {events.map((e) => (
                <div key={e.id} className="flex gap-2 text-xs">
                  <span className="text-slate-400 whitespace-nowrap">{fmtDT(e.created_at)}</span>
                  <span className="text-slate-700">
                    <strong>{e.actor_name || "System"}</strong>{" "}
                    {e.action === "created" ? "reported the issue"
                      : e.action === "note" ? "added a note"
                      : e.action === "resolved" ? "resolved the issue"
                      : e.action === "escalated" ? "escalated the issue"
                      : `moved ${label(e.from_status || "?")} → ${label(e.to_status || "?")}`}
                    {e.note ? <span className="block text-slate-500 mt-0.5 whitespace-pre-wrap">“{e.note}”</span> : null}
                  </span>
                </div>
              ))}
              {events.length === 0 && <p className="text-xs text-slate-400">No activity yet.</p>}
            </div>
          </div>

          <Separator />

          {/* ─── Actions ──────────────────────────────────────────────── */}
          {issue.status !== "resolved" && (
            <div className="space-y-3">
              <Textarea
                placeholder="Add a note, or describe the resolution / proof-of-fix…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
              />
              <div className="flex flex-wrap gap-2">
                {issue.status !== "investigating" && (
                  <Button size="sm" variant="outline" disabled={!!busy}
                    onClick={() => void act({ action: "update_status", status: "investigating", note: note || undefined }, "inv", "Marked investigating")}>
                    Investigating
                  </Button>
                )}
                {issue.status !== "awaiting_customer" && (
                  <Button size="sm" variant="outline" disabled={!!busy}
                    onClick={() => void act({ action: "update_status", status: "awaiting_customer", note: note || undefined }, "wait", "Marked awaiting customer")}>
                    Awaiting customer
                  </Button>
                )}
                {issue.status !== "escalated" && (
                  <Button size="sm" variant="outline" className="border-purple-300 text-purple-700" disabled={!!busy}
                    onClick={() => void act({ action: "update_status", status: "escalated", note: note || undefined }, "esc", "Escalated — admin alerted")}>
                    Escalate
                  </Button>
                )}
                <Button size="sm" variant="outline" disabled={!!busy || !note.trim()}
                  onClick={() => void act({ action: "add_note", note }, "note", "Note added")}>
                  Add note only
                </Button>
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 ml-auto" disabled={!!busy || !note.trim()}
                  onClick={() => void act({ action: "resolve", note }, "res", "Issue resolved")}>
                  {busy === "res" ? <RiLoader4Line className="w-4 h-4 animate-spin mr-1" /> : <RiCheckboxCircleFill className="w-4 h-4 mr-1" />}
                  Resolve
                </Button>
              </div>
              <p className="text-[11px] text-slate-400">Resolving requires a note — it becomes the permanent resolution record.</p>
            </div>
          )}
          {issue.status === "resolved" && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3">
              <p className="text-sm font-semibold text-emerald-800">Resolved by {issue.resolved_by_name} · {fmtDT(issue.resolved_at)}</p>
              {issue.resolution_note && <p className="text-xs text-emerald-700 mt-1 whitespace-pre-wrap">{issue.resolution_note}</p>}
            </div>
          )}
        </div>
        {caseOpen && (
          <CaseFileSheet bookingId={issue.booking_id} caseRef={issue.booking_ref} onClose={() => setCaseOpen(false)} />
        )}
        {actionCleaner && (
          <AccountabilityActionDialog
            open={accountabilityOpen}
            onOpenChange={setAccountabilityOpen}
            cleanerId={actionCleaner.id}
            cleanerName={actionCleaner.name || "Cleaner"}
            qcIssue={{
              id: issue.id,
              issue_number: issue.issue_number,
              booking_ref: issue.booking_ref,
              title: issue.title,
              issue_type: issue.issue_type,
              severity: issue.severity,
              created_at: issue.created_at,
              job_id: issue.job_id,
            }}
            onDone={() => void reload()}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Create issue dialog ────────────────────────────────────────────────

function CreateIssueDialog({ onClose, reload }: { onClose: () => void; reload: () => Promise<void> }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BookingPick[]>([]);
  const [searching, setSearching] = useState(false);
  const [booking, setBooking] = useState<BookingPick | null>(null);
  const [issueType, setIssueType] = useState("complaint");
  const [severity, setSeverity] = useState("medium");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [requestReclean, setRequestReclean] = useState(true);
  const [saving, setSaving] = useState(false);

  const searchBookings = useCallback(async () => {
    const q = query.trim();
    if (q.length < 2) return;
    setSearching(true);
    try {
      const num = q.replace(/^(nvc|nov)-?0*/i, "");
      let sel = supabase.from("bookings")
        .select("id, booking_number, first_name, last_name, email, service_date, service_type, status")
        .order("service_date", { ascending: false })
        .limit(15);
      if (/^\d+$/.test(num)) {
        sel = sel.eq("booking_number", Number(num));
      } else {
        sel = sel.or(`email.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%`);
      }
      const { data } = await sel;
      setResults((data || []) as BookingPick[]);
    } finally {
      setSearching(false);
    }
  }, [query]);

  const submit = async () => {
    if (!booking || !title.trim()) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("qc-issues", {
        body: {
          action: "create",
          bookingId: booking.id,
          issueType,
          severity,
          title: title.trim(),
          description: description.trim() || undefined,
          requestReclean: ["complaint", "reclean", "quality_flag"].includes(issueType) ? requestReclean : false,
        },
      });
      if (error) throw error;
      if ((data as { ok?: boolean; error?: string })?.ok === false) throw new Error((data as { error?: string }).error || "Failed");
      toast.success(severity === "high" || severity === "critical" ? "Issue created — admin alerted immediately" : "Issue created");
      await reload();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create issue");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Report a QC issue</DialogTitle>
          <DialogDescription>Every issue links to a job — its documentation becomes the evidence.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {!booking ? (
            <>
              <div className="flex gap-2">
                <Input
                  placeholder="Find job: client email, name, or NVC-00012…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void searchBookings()}
                />
                <Button variant="outline" onClick={() => void searchBookings()} disabled={searching}>
                  {searching ? <RiLoader4Line className="w-4 h-4 animate-spin" /> : <RiSearch2Line className="w-4 h-4" />}
                </Button>
              </div>
              <div className="max-h-56 overflow-y-auto space-y-1">
                {results.map((b) => (
                  <button key={b.id} onClick={() => setBooking(b)}
                    className="w-full text-left rounded-lg border border-slate-200 px-3 py-2 text-sm hover:border-violet-300">
                    <span className="font-semibold">
                      {b.booking_number ? `NVC-${String(b.booking_number).padStart(4, "0")}` : b.id.slice(0, 8)}
                    </span>{" "}
                    · {b.first_name} {b.last_name} · {fmtD(b.service_date)} · {b.service_type} · {b.status}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-sm flex items-center justify-between">
                <span>
                  <strong>{booking.booking_number ? `NVC-${String(booking.booking_number).padStart(4, "0")}` : booking.id.slice(0, 8)}</strong>{" "}
                  · {booking.first_name} {booking.last_name} · {fmtD(booking.service_date)}
                </span>
                <button className="text-xs text-violet-600 font-semibold" onClick={() => setBooking(null)}>Change</button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Select value={issueType} onValueChange={setIssueType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{ISSUE_TYPES.map((t) => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={severity} onValueChange={setSeverity}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SEVERITIES.map((s) => <SelectItem key={s} value={s}>{label(s)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <Input placeholder="Short title (what happened)" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
              <Textarea placeholder="Details — what the customer said, what was found…" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
              {["complaint", "reclean", "quality_flag"].includes(issueType) && (
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <Checkbox checked={requestReclean} onCheckedChange={(v) => setRequestReclean(v === true)} />
                  Request a re-clean (verify original photos before dispatch)
                </label>
              )}
              {(severity === "high" || severity === "critical") && (
                <p className="text-xs text-orange-600 font-medium flex items-center gap-1">
                  <RiAlertLine className="w-3.5 h-3.5" /> {label(severity)} issues alert admin on Discord immediately.
                </p>
              )}
              <Button className="w-full" disabled={!title.trim() || saving} onClick={() => void submit()}>
                {saving ? <RiLoader4Line className="w-4 h-4 animate-spin mr-1.5" /> : <RiAddLine className="w-4 h-4 mr-1.5" />}
                Create issue
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Documentation tab ──────────────────────────────────────────────────

function DocsTab({ docs, reload }: { docs: DocRow[]; reload: () => Promise<void> }) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [caseOpen, setCaseOpen] = useState<{ bookingId: string; ref: string | null } | null>(null);

  const filtered = useMemo(() => docs.filter((d) => {
    if (filter === "undocumented" && (d.documented || d.photos_purged_at)) return false;
    if (filter === "failed" && d.mirror_status !== "failed") return false;
    if (filter === "pending" && !["pending", "mirroring"].includes(d.mirror_status)) return false;
    if (filter === "mirrored" && d.mirror_status !== "mirrored") return false;
    if (search) {
      const q = search.toLowerCase();
      if (!`${d.booking_ref} ${d.client_name} ${d.cleaner_names}`.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [docs, filter, search]);

  const retryMirror = async (doc: DocRow) => {
    setBusyId(doc.id);
    try {
      await (supabase.from as any)("job_documentation")
        .update({ mirror_status: "pending", mirror_attempts: 0, mirror_next_attempt_at: null, mirror_last_error: null })
        .eq("id", doc.id);
      await supabase.functions.invoke("qc-drive-mirror", { body: { docId: doc.id } });
      toast.success("Mirror queued — refresh in a minute");
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Retry failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <RiSearch2Line className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input placeholder="Search ref, client, cleaner…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All jobs (90d)</SelectItem>
            <SelectItem value="undocumented">⚠ Undocumented</SelectItem>
            <SelectItem value="pending">Drive: pending</SelectItem>
            <SelectItem value="failed">Drive: failed</SelectItem>
            <SelectItem value="mirrored">Drive: mirrored</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => void supabase.functions.invoke("qc-drive-mirror", { body: {} }).then(() => toast.success("Mirror worker triggered"))}>
          <RiRefreshLine className="w-4 h-4 mr-1.5" /> Run mirror now
        </Button>
      </div>

      <div className="space-y-2">
        {filtered.map((d) => (
          <div key={d.id} className={cn(
            "rounded-xl border bg-white px-4 py-3",
            !d.documented && !d.photos_purged_at ? "border-rose-300 bg-rose-50/40" : "border-slate-200",
          )}>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="font-semibold text-slate-900 hover:text-violet-700 hover:underline disabled:no-underline disabled:text-slate-900"
                disabled={!d.booking_id}
                onClick={() => d.booking_id && setCaseOpen({ bookingId: d.booking_id, ref: d.booking_ref })}
              >
                {d.booking_ref || d.id.slice(0, 8)}
              </button>
              <Badge className={cn("border-0", CLIENT_TYPE_STYLE[d.client_type || "residential"])}>
                {CLIENT_TYPES.find((t) => t.id === (d.client_type || "residential"))?.label}
              </Badge>
              <span className="text-sm text-slate-500">{d.client_name} · {fmtD(d.service_date)} · {d.service_type}</span>
              <div className="flex gap-1.5 ml-auto items-center">
                {d.booking_id && (
                  <Button size="sm" variant="ghost" className="h-6 text-xs text-violet-700"
                    onClick={() => setCaseOpen({ bookingId: d.booking_id!, ref: d.booking_ref })}>
                    <RiFolderCheckLine className="w-3.5 h-3.5 mr-1" /> Case file
                  </Button>
                )}
                <Badge className={cn("border-0", d.documented ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700")}>
                  {d.documented ? "Documented ✓" : "No photos"}
                </Badge>
                <Badge className={cn("border-0", MIRROR_STYLE[d.mirror_status])}>{label(d.mirror_status)}</Badge>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-slate-500">
              <span className="flex items-center gap-1"><RiCameraLine className="w-3.5 h-3.5" /> {d.photo_count} photos</span>
              {d.cleaner_names && <span className="flex items-center gap-1"><RiUserSmileLine className="w-3.5 h-3.5" /> {d.cleaner_names}</span>}
              {d.checklist_progress_pct != null && <span>Checklist {d.checklist_progress_pct}%</span>}
              {d.drive_folder_url && (
                <a href={d.drive_folder_url} target="_blank" rel="noreferrer" className="text-violet-600 font-semibold hover:underline flex items-center gap-0.5">
                  <RiExternalLinkLine className="w-3.5 h-3.5" /> Drive
                </a>
              )}
              {d.drive_pdf_url && (
                <a href={d.drive_pdf_url} target="_blank" rel="noreferrer" className="text-violet-600 font-semibold hover:underline flex items-center gap-0.5">
                  <RiFileTextLine className="w-3.5 h-3.5" /> PDF packet
                </a>
              )}
              {d.photos_purged_at && <span className="text-slate-400">purged from Supabase {fmtD(d.photos_purged_at)}</span>}
              {(d.mirror_status === "failed" || d.mirror_status === "pending") && !d.photos_purged_at && (
                <Button size="sm" variant="outline" className="h-6 text-xs ml-auto" disabled={busyId === d.id} onClick={() => void retryMirror(d)}>
                  {busyId === d.id ? <RiLoader4Line className="w-3 h-3 animate-spin" /> : "Mirror now"}
                </Button>
              )}
            </div>
            {d.mirror_status === "failed" && d.mirror_last_error && (
              <p className="text-[11px] text-rose-600 mt-1 flex items-center gap-1">
                <RiCloseCircleLine className="w-3.5 h-3.5" /> {d.mirror_attempts} attempts — {d.mirror_last_error}
              </p>
            )}
          </div>
        ))}
        {filtered.length === 0 && (
          <Card><CardContent className="p-10 text-center text-slate-500 text-sm">No documentation records match.</CardContent></Card>
        )}
      </div>
      {caseOpen && (
        <CaseFileSheet bookingId={caseOpen.bookingId} caseRef={caseOpen.ref} onClose={() => setCaseOpen(null)} />
      )}
    </div>
  );
}

// ─── Case file sheet (live case-management view) ────────────────────────
//
// Everything assembled LIVE by the qc-case-file edge function at open time:
// customer + signed agreement PDFs, Stripe payment records w/ receipts,
// cleaner photos, checklist, Drive archive, issues + audit, event timeline.

interface CaseFile {
  ref: string;
  booking: Record<string, any>;
  customer: Record<string, any>;
  cleaners: Array<{ name: string; status: string }>;
  agreements: Array<{ id: string; signed_by: string | null; signed_at: string; pdf_url: string | null; source: string }>;
  docuseal: Array<{ id: string; audience: string; status: string; document_url: string | null; created_at: string; completed_at: string | null }>;
  payments: {
    totals: Record<string, any>;
    stripe: Array<{ kind: string; payment_intent_id: string; amount_cents: number | null; status: string | null; receipt_url: string | null; refunded_cents: number; created: string | null; error?: string }>;
    addon_charges: Array<Record<string, any>>;
    completion_hold: Record<string, any> | null;
  };
  photos: { before: string[]; after: string[]; purged: boolean; submitted_at: string | null };
  four_stage_sequence?: Array<{ stage: string; url: string }>;
  reclean_photos?: Array<{ before: string[]; after: string[] }>;
  checklist: Record<string, any> | null;
  documentation: Record<string, any> | null;
  issues: IssueRow[];
  issue_events: Array<Record<string, any>>;
  timeline: Array<{ event_type: string; occurred_at: string; source: string; summary: string }>;
  policy_highlights?: string[];
}

const cents = (c: number | null | undefined) => (c != null ? `$${(Number(c) / 100).toFixed(2)}` : "—");

export function CaseFileSheet({ bookingId, caseRef, onClose }: { bookingId: string; caseRef?: string | null; onClose: () => void }) {
  const [cf, setCf] = useState<CaseFile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const { data, error: invErr } = await supabase.functions.invoke("qc-case-file", { body: { bookingId } });
        if (invErr) throw invErr;
        if ((data as { ok?: boolean; error?: string })?.ok === false) throw new Error((data as { error?: string }).error || "Failed");
        setCf((data as { case: CaseFile }).case);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't load case file");
      }
    })();
  }, [bookingId]);

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <RiFolderCheckLine className="w-5 h-5 text-violet-600" /> Case file — {cf?.ref || caseRef || "…"}
          </SheetTitle>
          <SheetDescription>
            Assembled live: agreement, payments, photos, checklist, issues, and full timeline for this job.
          </SheetDescription>
        </SheetHeader>

        {error && <p className="mt-6 text-sm text-rose-600">{error}</p>}
        {!cf && !error && (
          <div className="mt-6 space-y-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
        )}

        {cf && (
          <div className="mt-4 space-y-5">
            {/* Customer & job */}
            <section className="rounded-xl border border-slate-200 p-4 space-y-1.5">
              <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                <RiUserSmileLine className="w-4 h-4 text-violet-600" /> Customer & job
              </p>
              <p className="text-sm text-slate-800 font-semibold">
                {cf.customer.first_name} {cf.customer.last_name}
                <span className="font-normal text-slate-500"> · {cf.customer.email} · {cf.customer.phone || "no phone"}</span>
              </p>
              <p className="text-xs text-slate-500">
                {label(String(cf.booking.service_type || ""))} on {fmtD(cf.booking.service_date)} · {cf.booking.time_slot || ""} · {cf.booking.address}
              </p>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <Badge variant="outline">Status: {label(String(cf.booking.status || ""))}</Badge>
                {cf.booking.membership_plan && cf.booking.membership_plan !== "none" && <Badge variant="outline">Member: {cf.booking.membership_plan}</Badge>}
                {cf.cleaners.map((c, i) => <Badge key={i} className="bg-violet-100 text-violet-700 border-0">Cleaner: {c.name}</Badge>)}
              </div>
              <div className="text-[11px] text-slate-400 pt-1 space-x-3">
                {cf.booking.confirmed_at && <span>Confirmed {fmtDT(cf.booking.confirmed_at)}</span>}
                {cf.booking.check_in_time && <span>Check-in {fmtDT(cf.booking.check_in_time)}</span>}
                {cf.booking.check_out_time && <span>Check-out {fmtDT(cf.booking.check_out_time)}</span>}
                {cf.booking.completed_at && <span>Completed {fmtDT(cf.booking.completed_at)}</span>}
              </div>
            </section>

            {/* Agreements */}
            <section className="rounded-xl border border-slate-200 p-4 space-y-2">
              <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                <RiFileTextLine className="w-4 h-4 text-violet-600" /> Signed agreements
              </p>
              {cf.agreements.length === 0 && cf.docuseal.length === 0 && (
                <p className="text-xs text-rose-600 font-medium">⚠ No signed agreement on file for this customer — legal exposure.</p>
              )}
              {cf.agreements.map((a) => (
                <div key={a.id} className="flex items-center justify-between text-sm bg-slate-50 rounded-lg px-3 py-2">
                  <span className="text-slate-700">
                    Service agreement — signed by <strong>{a.signed_by || "customer"}</strong> · {fmtDT(a.signed_at)} <span className="text-slate-400">({a.source})</span>
                  </span>
                  {a.pdf_url
                    ? <a href={a.pdf_url} target="_blank" rel="noreferrer" className="text-violet-600 font-semibold text-xs hover:underline shrink-0 ml-2">Open PDF</a>
                    : <span className="text-xs text-slate-400 shrink-0 ml-2">no PDF</span>}
                </div>
              ))}
              {cf.docuseal.map((d) => (
                <div key={d.id} className="flex items-center justify-between text-sm bg-slate-50 rounded-lg px-3 py-2">
                  <span className="text-slate-700">
                    DocuSeal ({label(d.audience)}) — {label(d.status)} · {fmtDT(d.completed_at || d.created_at)}
                  </span>
                  {d.document_url && <a href={d.document_url} target="_blank" rel="noreferrer" className="text-violet-600 font-semibold text-xs hover:underline shrink-0 ml-2">Open</a>}
                </div>
              ))}
            </section>

            {/* Payments — live from Stripe */}
            <section className="rounded-xl border border-slate-200 p-4 space-y-2">
              <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                <RiMoneyDollarCircleLine className="w-4 h-4 text-violet-600" /> Payment record <span className="text-[10px] font-normal text-emerald-600">(live from Stripe)</span>
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">
                <span>Total: <strong className="text-slate-900">{cents(cf.payments.totals.total_cents)}</strong></span>
                <span>Payment option: <strong className="text-slate-900">{cf.payments.totals.payment_option || "—"}</strong></span>
                {Number(cf.payments.totals.deposit_cents) > 0 && <span>Deposit: {cents(cf.payments.totals.deposit_cents)}</span>}
                {Number(cf.payments.totals.applied_credit_cents) > 0 && <span>Credit applied: {cents(cf.payments.totals.applied_credit_cents)}</span>}
                {Number(cf.payments.totals.tip_cents) > 0 && <span>Tip: {cents(cf.payments.totals.tip_cents)}</span>}
                {cf.payments.totals.payment_received_at && <span>Received: {fmtDT(cf.payments.totals.payment_received_at)}</span>}
              </div>
              {(Array.isArray(cf.booking.add_ons) && cf.booking.add_ons.length > 0) || (cf.payments.addon_charges || []).length > 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 space-y-1.5">
                  <p className="text-xs font-bold text-amber-950">Add-ons on this job</p>
                  {Array.isArray(cf.booking.add_ons) && cf.booking.add_ons.length > 0 && (
                    <p className="text-xs text-slate-700">Booked: {cf.booking.add_ons.map(String).join(", ")}</p>
                  )}
                  {(cf.payments.addon_charges || []).map((a, i) => (
                    <p key={i} className="text-xs text-slate-700">
                      Charge {String(a.status || "")}: {(Array.isArray(a.added_addons) ? a.added_addons : []).join(", ") || "add-ons"}
                      {" — "}{cents(a.amount_cents)}
                    </p>
                  ))}
                </div>
              ) : null}
              {cf.payments.stripe.map((p, i) => (
                <div key={i} className="flex items-center justify-between text-sm bg-slate-50 rounded-lg px-3 py-2">
                  <span className="text-slate-700">
                    <strong>{p.kind}</strong> — {cents(p.amount_cents)}{" "}
                    <Badge className={cn("border-0 ml-1", p.status === "succeeded" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>
                      {p.status || p.error || "?"}
                    </Badge>
                    {p.refunded_cents > 0 && <Badge className="bg-rose-100 text-rose-700 border-0 ml-1">refunded {cents(p.refunded_cents)}</Badge>}
                    <span className="block text-[10px] text-slate-400 font-mono">{p.payment_intent_id}</span>
                  </span>
                  {p.receipt_url && <a href={p.receipt_url} target="_blank" rel="noreferrer" className="text-violet-600 font-semibold text-xs hover:underline shrink-0 ml-2">Receipt</a>}
                </div>
              ))}
              {cf.payments.totals.hosted_invoice_url && (
                <a href={cf.payments.totals.hosted_invoice_url} target="_blank" rel="noreferrer" className="text-xs text-violet-600 font-semibold hover:underline inline-flex items-center gap-1">
                  <RiExternalLinkLine className="w-3.5 h-3.5" /> Invoice / pay link
                </a>
              )}
            </section>

            {/* Photos */}
            <section className="rounded-xl border border-slate-200 p-4 space-y-2">
              <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                <RiCameraLine className="w-4 h-4 text-violet-600" /> Cleaner photos
                <span className="text-[10px] font-normal text-slate-400">
                  {cf.photos.before.length} before · {cf.photos.after.length} after
                  {cf.photos.submitted_at ? ` · submitted ${fmtDT(cf.photos.submitted_at)}` : ""}
                </span>
              </p>
              {cf.photos.purged ? (
                <p className="text-xs text-slate-500">
                  Supabase copies purged under the 14-day policy — the originals live in the Drive archive below.
                </p>
              ) : cf.photos.before.length + cf.photos.after.length === 0 ? (
                <p className="text-xs text-rose-600 font-medium">⚠ No photos uploaded — this job is undefendable in a dispute.</p>
              ) : (
                <div className="grid grid-cols-5 gap-1.5">
                  {[...cf.photos.before.slice(0, 5).map((u) => ({ u, l: "B" })), ...cf.photos.after.slice(0, 5).map((u) => ({ u, l: "A" }))].map(({ u, l }, i) => (
                    <a key={i} href={u} target="_blank" rel="noreferrer" className="relative">
                      <img src={u} alt={l} className="w-full h-14 object-cover rounded border border-slate-200" />
                      <span className="absolute bottom-0.5 left-0.5 text-[8px] font-bold bg-black/60 text-white px-1 rounded">{l === "B" ? "Before" : "After"}</span>
                    </a>
                  ))}
                </div>
              )}
              {(cf.four_stage_sequence?.length || 0) > 0 && (
                <div className="pt-2 space-y-1">
                  <p className="text-[11px] font-semibold text-violet-800">Four-stage sequence (original → re-clean)</p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {cf.four_stage_sequence!.slice(0, 16).map((p, i) => (
                      <a key={i} href={p.url} target="_blank" rel="noreferrer" className="relative">
                        <img src={p.url} alt={p.stage} className="w-full h-14 object-cover rounded border border-violet-200" />
                        <span className="absolute bottom-0.5 left-0.5 text-[8px] font-bold bg-violet-800/80 text-white px-1 rounded">
                          {p.stage.replace(/_/g, " ")}
                        </span>
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {cf.documentation && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Badge className={cn("border-0", MIRROR_STYLE[cf.documentation.mirror_status] || "bg-slate-100")}>
                    Drive archive: {label(String(cf.documentation.mirror_status))}
                  </Badge>
                  {cf.documentation.drive_folder_url && (
                    <a href={cf.documentation.drive_folder_url} target="_blank" rel="noreferrer" className="text-xs text-violet-600 font-semibold hover:underline inline-flex items-center gap-0.5">
                      <RiExternalLinkLine className="w-3.5 h-3.5" /> Drive folder
                    </a>
                  )}
                  {cf.documentation.drive_pdf_url && (
                    <a href={cf.documentation.drive_pdf_url} target="_blank" rel="noreferrer" className="text-xs text-violet-600 font-semibold hover:underline inline-flex items-center gap-0.5">
                      <RiFileTextLine className="w-3.5 h-3.5" /> Dispute packet (PDF)
                    </a>
                  )}
                </div>
              )}
            </section>

            {/* Checklist */}
            {cf.checklist && (
              <section className="rounded-xl border border-slate-200 p-4">
                <p className="text-sm font-bold text-slate-800">Checklist execution</p>
                <p className="text-xs text-slate-600 mt-1">
                  {cf.checklist.completed_items}/{cf.checklist.total_items} items ({cf.checklist.progress_pct}%)
                  {cf.checklist.completed_at ? ` — completed ${fmtDT(cf.checklist.completed_at)}` : " — not finished"}
                  {cf.checklist.last_activity_by ? ` · by ${cf.checklist.last_activity_by}` : ""}
                </p>
              </section>
            )}

            {/* Issues on this job */}
            <section className="rounded-xl border border-slate-200 p-4 space-y-2">
              <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                <RiAlertLine className="w-4 h-4 text-violet-600" /> QC issues on this job ({cf.issues.length})
              </p>
              {cf.issues.length === 0 && <p className="text-xs text-slate-500">None reported.</p>}
              {cf.issues.map((i) => (
                <div key={i.id} className="bg-slate-50 rounded-lg px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[10px] text-slate-400">#{i.issue_number}</span>
                    <Badge className={cn("border-0", SEVERITY_STYLE[i.severity])}>{label(i.severity)}</Badge>
                    <Badge className={cn("border-0", STATUS_STYLE[i.status])}>{label(i.status)}</Badge>
                    <span className="text-xs text-slate-400 ml-auto">{fmtDT(i.created_at)}</span>
                  </div>
                  <p className="font-medium text-slate-800 mt-1">{i.title}</p>
                  {cf.issue_events.filter((e) => e.issue_id === i.id).map((e, j) => (
                    <p key={j} className="text-[11px] text-slate-500 mt-0.5">
                      {fmtDT(String(e.created_at))} — <strong>{String(e.actor_name || "System")}</strong> {String(e.action)}{e.note ? `: “${String(e.note)}”` : ""}
                    </p>
                  ))}
                </div>
              ))}
            </section>

            {/* Policies the client agreed to */}
            {(cf.policy_highlights || []).length > 0 && (
              <section className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
                <p className="text-sm font-bold text-amber-900 mb-2">Policies the client agreed to</p>
                <ul className="space-y-1">
                  {cf.policy_highlights!.map((p, i) => (
                    <li key={i} className="text-xs text-amber-900/80 flex gap-1.5">
                      <span className="shrink-0">•</span> {p}
                    </li>
                  ))}
                </ul>
                <p className="text-[10px] text-amber-700/70 mt-2">
                  These commitments are baked into every dispute packet PDF alongside the signed agreement.
                </p>
              </section>
            )}

            {/* Timeline */}
            <section className="rounded-xl border border-slate-200 p-4">
              <p className="text-sm font-bold text-slate-800 mb-2">Event timeline</p>
              <div className="space-y-1.5 max-h-72 overflow-y-auto">
                {cf.timeline.map((e, i) => (
                  <div key={i} className="flex gap-2 text-[11px]">
                    <span className="text-slate-400 whitespace-nowrap shrink-0">{fmtDT(e.occurred_at)}</span>
                    <span className="text-slate-600">
                      <span className="font-mono text-violet-600">{e.event_type}</span> — {e.summary}
                    </span>
                  </div>
                ))}
                {cf.timeline.length === 0 && <p className="text-xs text-slate-400">No events recorded.</p>}
              </div>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Re-cleans cost-center tab ──────────────────────────────────────────

function RecleansTab() {
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke("qc-reclean", { body: { action: "report" } });
        if (error) throw error;
        setReport((data || {}) as Record<string, unknown>);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't load re-clean report");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>;
  if (!report?.ok) {
    return <Card><CardContent className="p-8 text-sm text-slate-500">No re-clean data yet.</CardContent></Card>;
  }

  const byClass = (report.byClassification || {}) as Record<string, number>;
  const byService = (report.byServiceType || {}) as Record<string, number>;
  const bySize = (report.bySizeBand || {}) as Record<string, number>;
  const byCleaner = (report.byCleaner || []) as Array<{ name: string; total: number; qualityMiss: number; absorbed: number }>;
  const serial = (report.serialRequesters || []) as Array<{ name: string; count: number }>;
  const repeat = (report.repeatQualityMissCleaners || []) as Array<{ name: string; qualityMiss: number; total: number }>;
  const rate = Number(report.recleanRate || 0);

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">{String(report.note || "")}</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4">
          <p className="text-xs text-slate-500">Re-clean requests</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{Number(report.recleanRequests || 0)}</p>
          <p className="text-[11px] text-slate-500 mt-1">{(rate * 100).toFixed(1)}% of {Number(report.completedJobs || 0)} completed jobs</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-slate-500">Absorbed cost</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">${(Number(report.absorbedCostCents || 0) / 100).toFixed(0)}</p>
          <p className="text-[11px] text-slate-500 mt-1">Company margin — customer not charged</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-slate-500">Quality misses</p>
          <p className="text-2xl font-bold text-rose-700 mt-1">{byClass.quality_miss || 0}</p>
          <p className="text-[11px] text-slate-500 mt-1">Scope confusion: {byClass.scope_confusion || 0} · not supported: {byClass.not_supported || 0}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-slate-500">Serial requesters</p>
          <p className="text-2xl font-bold text-amber-700 mt-1">{serial.length}</p>
          <p className="text-[11px] text-slate-500 mt-1">Pattern flag, not an accusation</p>
        </CardContent></Card>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <Card><CardContent className="p-4 space-y-2">
          <p className="text-sm font-bold text-slate-800">By classification</p>
          {Object.entries(byClass).map(([k, n]) => (
            <div key={k} className="flex justify-between text-sm"><span className="capitalize text-slate-600">{k.replace(/_/g, " ")}</span><span className="font-semibold">{n}</span></div>
          ))}
          <p className="text-[11px] text-slate-500 pt-2">A high scope-confusion rate is a booking/intake problem, not a cleaning problem.</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 space-y-2">
          <p className="text-sm font-bold text-slate-800">By service type</p>
          {Object.entries(byService).length === 0 && <p className="text-xs text-slate-400">None in this window.</p>}
          {Object.entries(byService).map(([k, n]) => (
            <div key={k} className="flex justify-between text-sm"><span className="text-slate-600">{k}</span><span className="font-semibold">{n}</span></div>
          ))}
          <p className="text-sm font-bold text-slate-800 pt-2">By size band</p>
          {Object.entries(bySize).map(([k, n]) => (
            <div key={k} className="flex justify-between text-sm"><span className="text-slate-600">{k.replace(/_/g, " ")}</span><span className="font-semibold">{n}</span></div>
          ))}
        </CardContent></Card>
      </div>
      <Card><CardContent className="p-4 space-y-2">
        <p className="text-sm font-bold text-slate-800">By original cleaner (coaching signal)</p>
        {byCleaner.length === 0 && <p className="text-xs text-slate-400">None.</p>}
        {byCleaner.map((c) => (
          <div key={c.name} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold text-slate-800">{c.name}</span>
            <Badge variant="outline">{c.total} requests</Badge>
            {c.qualityMiss > 0 && <Badge className="border-0 bg-rose-100 text-rose-800">{c.qualityMiss} quality miss</Badge>}
            <span className="text-xs text-slate-500 ml-auto">absorbed ${(c.absorbed / 100).toFixed(0)}</span>
          </div>
        ))}
      </CardContent></Card>
      {repeat.length > 0 && (
        <Card className="border-amber-200"><CardContent className="p-4 space-y-2">
          <p className="text-sm font-bold text-amber-800">Repeat quality-miss re-cleans — human review (no auto-penalty)</p>
          {repeat.map((c) => (
            <p key={c.name} className="text-sm text-slate-800">{c.name} — {c.qualityMiss} quality-miss re-cleans</p>
          ))}
        </CardContent></Card>
      )}
      {serial.length > 0 && (
        <Card><CardContent className="p-4 space-y-2">
          <p className="text-sm font-bold text-slate-800">Customers with repeated re-clean requests</p>
          {serial.map((c) => (
            <p key={c.name} className="text-sm text-slate-700">{c.name} — {c.count} requests</p>
          ))}
        </CardContent></Card>
      )}
    </div>
  );
}

// ─── By-cleaner tab ─────────────────────────────────────────────────────

function CleanersTab({ byCleaner }: {
  byCleaner: Array<{ name: string; total: number; open: number; recleans: number; complaints: number }>;
}) {
  return (
    <div className="space-y-2">
      {byCleaner.length === 0 && (
        <Card><CardContent className="p-10 text-center text-slate-500 text-sm">No issues on record — clean slate.</CardContent></Card>
      )}
      {byCleaner.map((c) => (
        <div key={c.name} className="rounded-xl border border-slate-200 bg-white px-4 py-3 flex flex-wrap items-center gap-3">
          <span className="font-semibold text-slate-900 flex items-center gap-1.5">
            <RiUserSmileLine className="w-4 h-4 text-slate-400" /> {c.name}
          </span>
          <div className="flex gap-2 ml-auto text-xs">
            <Badge variant="outline">{c.total} total</Badge>
            {c.open > 0 && <Badge className="bg-rose-100 text-rose-700 border-0">{c.open} open</Badge>}
            {c.recleans > 0 && <Badge className="bg-amber-100 text-amber-700 border-0">{c.recleans} re-cleans</Badge>}
            {c.complaints > 0 && <Badge className="bg-orange-100 text-orange-700 border-0">{c.complaints} complaints</Badge>}
          </div>
        </div>
      ))}
      <p className="text-xs text-slate-400 pt-2">
        A cleaner repeatedly driving re-cleans or complaints is a coaching conversation — the issue links carry the photo evidence for it.
      </p>
    </div>
  );
}

// ─── Scope adjustments tab ──────────────────────────────────────────────
//
// Documented price increases, cut by reason, cleaner, and customer. The
// customer cut is the one that earns its keep: it surfaces the account that
// keeps booking a standard clean for a deep-condition home.

interface ScopeBucket {
  key: string;
  label: string;
  count: number;
  deltaCents: number;
  unsupported: number;
}

interface ScopeReport {
  days: number;
  totals: {
    count: number;
    deltaCents: number;
    unsupported: number;
    overridden: number;
    disputed: number;
    payoutSupplementCents: number;
  };
  byReason: ScopeBucket[];
  byCleaner: ScopeBucket[];
  byCustomer: ScopeBucket[];
  repeatCustomers: ScopeBucket[];
  recent: Array<{
    id: string;
    bookingNumber: number | null;
    customerName: string | null;
    cleanerName: string | null;
    serviceDate: string | null;
    applied_at: string;
    applied_by_name: string | null;
    original_price_cents: number;
    adjusted_price_cents: number;
    delta_cents: number;
    evidence_missing: boolean;
    evidence_photo_count: number;
    amount_overridden: boolean;
    status: string;
    reasonLabels: string[];
  }>;
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function ScopeAdjustmentsTab() {
  const [report, setReport] = useState<ScopeReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState("180");

  useEffect(() => {
    setLoading(true);
    void (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`/api/admin/scope-adjustment/report?days=${days}`, {
          headers: { Authorization: `Bearer ${session?.access_token || ""}` },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Could not load scope adjustments");
        setReport(data as ScopeReport);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not load scope adjustments");
      } finally {
        setLoading(false);
      }
    })();
  }, [days]);

  if (loading) {
    return <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>;
  }
  if (!report) return null;

  const breakdown = (title: string, rows: ScopeBucket[], hint: string) => (
    <Card>
      <CardContent className="p-4">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        <div className="mt-2 space-y-1.5">
          {rows.length === 0 && <p className="text-sm text-slate-500">Nothing yet.</p>}
          {rows.slice(0, 8).map((r) => (
            <div key={r.key} className="flex items-center gap-2 text-sm">
              <span className="text-slate-700 truncate">{r.label}</span>
              <span className="ml-auto flex items-center gap-2 shrink-0">
                {r.unsupported > 0 && (
                  <Badge variant="outline" className="border-amber-300 text-amber-800 text-[10px]">
                    {r.unsupported} unsupported
                  </Badge>
                )}
                <Badge variant="outline">{r.count}</Badge>
                <span className="tabular-nums text-slate-900 font-medium w-20 text-right">{money(r.deltaCents)}</span>
              </span>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-400 mt-3">{hint}</p>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
            <SelectItem value="180">Last 180 days</SelectItem>
            <SelectItem value="365">Last 12 months</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: "Adjustments", value: String(report.totals.count) },
          { label: "Additional revenue", value: money(report.totals.deltaCents) },
          { label: "Unsupported", value: String(report.totals.unsupported), warn: report.totals.unsupported > 0 },
          { label: "Off suggestion", value: String(report.totals.overridden) },
          { label: "Disputed", value: String(report.totals.disputed), warn: report.totals.disputed > 0 },
        ].map((m) => (
          <Card key={m.label}>
            <CardContent className="p-4">
              <p className="text-xs text-slate-500">{m.label}</p>
              <p className={cn("text-2xl font-bold mt-1", m.warn ? "text-amber-700" : "text-slate-900")}>{m.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {report.totals.payoutSupplementCents > 0 && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="p-4 text-sm text-amber-900">
            <strong>{money(report.totals.payoutSupplementCents)}</strong> in supplemental cleaner pay is owed across
            these adjustments — jobs where the payout was released before the price went up. Cleaner pay follows the
            work performed, so payroll settles the difference.
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {breakdown("By reason", report.byReason, "Which scope problems keep costing us — and which reasons carry the most unsupported adjustments.")}
        {breakdown("By cleaner", report.byCleaner, "One cleaner raising most of the adjustments is either working the hardest jobs or over-calling them.")}
        {breakdown(
          "By customer",
          report.byCustomer,
          report.repeatCustomers.length
            ? `${report.repeatCustomers.length} customer(s) adjusted more than once — a pattern worth a conversation about the right service tier.`
            : "No customer has been adjusted more than once.",
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="divide-y divide-slate-100">
            {report.recent.length === 0 && (
              <p className="p-10 text-center text-slate-500 text-sm">No scope adjustments in this window.</p>
            )}
            {report.recent.map((a) => (
              <div key={a.id} className="p-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="font-semibold text-slate-900">
                  {a.bookingNumber ? `NVC-${String(a.bookingNumber).padStart(4, "0")}` : "—"}
                </span>
                <span className="text-slate-700">{a.customerName || "—"}</span>
                <span className="text-slate-500 text-xs">{a.reasonLabels.join(" · ")}</span>
                <span className="ml-auto flex items-center gap-2">
                  {a.evidence_missing ? (
                    <Badge variant="outline" className="border-amber-300 text-amber-800 text-[10px]">Unsupported</Badge>
                  ) : (
                    <Badge variant="outline" className="border-emerald-300 text-emerald-800 text-[10px]">
                      {a.evidence_photo_count} photos
                    </Badge>
                  )}
                  {a.status === "disputed" && (
                    <Badge variant="outline" className="border-rose-300 text-rose-800 text-[10px]">Disputed</Badge>
                  )}
                  <span className="tabular-nums text-slate-500">
                    {money(a.original_price_cents)} → <strong className="text-slate-900">{money(a.adjusted_price_cents)}</strong>
                  </span>
                  <span className="text-xs text-slate-400 w-24 text-right">
                    {format(new Date(a.applied_at), "MMM d, yyyy")}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function moneyCents(cents: unknown): string {
  const n = Number(cents);
  if (!Number.isFinite(n)) return "—";
  return `$${(n / 100).toFixed(2)}`;
}

function AddonEvidence({ details }: { details: Record<string, unknown> }) {
  const lines = Array.isArray(details.addons) ? details.addons as Array<Record<string, unknown>> : [];
  const before = Array.isArray(details.before_photo_urls) ? details.before_photo_urls.map(String) : [];
  const after = Array.isArray(details.after_photo_urls) ? details.after_photo_urls.map(String) : [];
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 space-y-3">
      <p className="text-sm font-bold text-amber-950">Add-ons — dispute evidence (auto-assembled)</p>
      <ul className="text-xs text-slate-700 space-y-1">
        {lines.map((l, i) => (
          <li key={`${String(l.id || i)}-${i}`}>
            <span className="font-semibold">{String(l.label || l.id || "Add-on")}</span>
            {" · "}
            {String(l.source || "booked").replace(/_/g, " ")}
            {l.amount_cents != null && <> · {moneyCents(l.amount_cents)}</>}
            {l.charge_status ? <> · {String(l.charge_status).replace(/_/g, " ")}</> : null}
          </li>
        ))}
      </ul>
      {(before.length > 0 || after.length > 0) && (
        <div className="grid grid-cols-4 gap-1.5">
          {[
            ...before.slice(0, 4).map((u) => ({ u, l: "Before" })),
            ...after.slice(0, 4).map((u) => ({ u, l: "After" })),
          ].map(({ u, l }, i) => (
            <a key={`${l}-${i}`} href={u} target="_blank" rel="noreferrer" className="relative group">
              <img src={u} alt={l} className="w-full h-16 object-cover rounded-md border border-slate-200" />
              <span className="absolute bottom-0.5 left-0.5 text-[9px] font-bold bg-black/60 text-white px-1 rounded">{l}</span>
            </a>
          ))}
        </div>
      )}
      <p className="text-[11px] text-slate-500">
        Documentation record for extra services — not a quality complaint. Lives on the same QC packet as the rest of the job.
      </p>
    </div>
  );
}

/**
 * Tag the checklist items a quality case relates to. This is the tag the
 * feedback loop counts, so it stays on the record rather than living in the
 * case description where nothing can aggregate it.
 */
function ChecklistTagging({
  issue,
  onSaved,
}: {
  issue: IssueRow & { checklist_item_ids?: string[] | null };
  onSaved: () => void;
}) {
  const [ids, setIds] = useState<string[]>(
    Array.isArray(issue.checklist_item_ids) ? issue.checklist_item_ids : [],
  );
  const [busy, setBusy] = useState(false);
  const saved = Array.isArray(issue.checklist_item_ids) ? issue.checklist_item_ids : [];
  const dirty =
    ids.length !== saved.length || ids.some((v) => !saved.includes(v));

  const save = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("qc-issues", {
        body: { action: "tag_checklist_items", issueId: issue.id, checklistItemIds: ids },
      });
      if (error) throw error;
      if ((data as { ok?: boolean; error?: string })?.ok === false) {
        throw new Error((data as { error?: string }).error || "Tagging failed");
      }
      toast.success("Checklist items tagged on this case.");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Tagging failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 p-3 space-y-3">
      <ChecklistItemPicker value={ids} onChange={setIds} />
      {dirty && (
        <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save checklist tags"}
        </Button>
      )}
    </div>
  );
}

function SiteFindingEvidence({ details }: { details: Record<string, unknown> }) {
  const before = Array.isArray(details.before_photo_urls) ? details.before_photo_urls.map(String) : [];
  const after = Array.isArray(details.after_photo_urls) ? details.after_photo_urls.map(String) : [];
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 space-y-3">
      <p className="text-sm font-bold text-amber-950">Site finding — dispute evidence (auto-assembled)</p>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-slate-700">
        <dt className="text-slate-500">Finding</dt>
        <dd className="font-semibold">{String(details.finding_type || "").replace(/_/g, " ")}</dd>
        <dt className="text-slate-500">Location</dt>
        <dd>{String(details.location || "—")}</dd>
        <dt className="text-slate-500">Size/severity</dt>
        <dd>{details.confined ? "Confined to one small area (in-scope)" : "Spread, still surface-level/minor"}</dd>
        <dt className="text-slate-500">Pricing rule</dt>
        <dd>{String(details.pricing_rule_label || details.pricing_path || "—")}</dd>
        <dt className="text-slate-500">Price impact</dt>
        <dd>
          {moneyCents(details.price_delta_cents ?? details.preview_delta_cents)}
          {details.new_total_cents != null && (
            <> · {moneyCents(details.original_total_cents)} → {moneyCents(details.new_total_cents)}</>
          )}
        </dd>
        <dt className="text-slate-500">Recurrence</dt>
        <dd>
          {details.recurrence
            ? `Yes${details.recurrence_same_spot ? " — same spot (moisture signal)" : " — same property"}`
            : "No prior record"}
        </dd>
        <dt className="text-slate-500">Status</dt>
        <dd>{String(details.status || "—").replace(/_/g, " ")}</dd>
      </dl>
      {(before.length > 0 || after.length > 0) && (
        <div className="grid grid-cols-4 gap-1.5">
          {[
            ...before.slice(0, 4).map((u) => ({ u, l: "Before" })),
            ...after.slice(0, 4).map((u) => ({ u, l: "After" })),
          ].map(({ u, l }, i) => (
            <a key={`${l}-${i}`} href={u} target="_blank" rel="noreferrer" className="relative group">
              <img src={u} alt={l} className="w-full h-16 object-cover rounded-md border border-slate-200" />
              <span className="absolute bottom-0.5 left-0.5 text-[9px] font-bold bg-black/60 text-white px-1 rounded">{l}</span>
            </a>
          ))}
        </div>
      )}
      <p className="text-[11px] text-slate-500">
        This QC record is the chargeback packet for this finding — no separate admin assembly.
      </p>
    </div>
  );
}

function SiteFindingTemplatesButton() {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    email_subject: "",
    email_body_priced: "",
    email_body_info: "",
    sms_priced: "",
    sms_info: "",
    mold_recurrence_sentence: "",
  });

  const loadTemplates = async () => {
    const { data } = await (supabase.from as any)("app_settings").select("value").eq("key", "site_finding_notice_templates").maybeSingle();
    const v = (data?.value || {}) as Record<string, string>;
    setDraft({
      email_subject: v.email_subject || "A quick update on today's clean",
      email_body_priced: v.email_body_priced || "",
      email_body_info: v.email_body_info || "",
      sms_priced: v.sms_priced || "",
      sms_info: v.sms_info || "",
      mold_recurrence_sentence: v.mold_recurrence_sentence || "",
    });
  };

  return (
    <>
      <Button variant="outline" onClick={() => { setOpen(true); void loadTemplates(); }}>
        Finding notices
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Pest / mold customer notices</DialogTitle>
            <DialogDescription>
              Auto-filled from the QC record. Placeholders: {"{name} {finding} {finding_sms} {location} {adjustment} {delta} {new_total} {recurrence}"}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {(
              [
                ["email_subject", "Email subject"],
                ["email_body_priced", "Email — price changed"],
                ["email_body_info", "Email — no price change"],
                ["sms_priced", "SMS — price changed"],
                ["sms_info", "SMS — no price change"],
                ["mold_recurrence_sentence", "Mold recurrence sentence"],
              ] as const
            ).map(([key, label]) => (
              <div key={key}>
                <p className="text-xs font-semibold text-slate-600 mb-1">{label}</p>
                {key === "email_subject" ? (
                  <Input value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
                ) : (
                  <Textarea rows={key.includes("email") ? 4 : 3} value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
                )}
              </div>
            ))}
            <Button
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  const { error } = await (supabase.from as any)("app_settings").upsert({
                    key: "site_finding_notice_templates",
                    value: draft,
                    description: "Customer email/SMS copy for pest (light) and mold (minor) site findings.",
                    updated_at: new Date().toISOString(),
                  }, { onConflict: "key" });
                  if (error) throw error;
                  toast.success("Notice templates saved");
                  setOpen(false);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Couldn't save templates");
                } finally {
                  setSaving(false);
                }
              }}
            >
              Save templates
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
