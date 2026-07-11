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
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────

interface IssueRow {
  id: string;
  issue_number: number;
  booking_id: string;
  booking_ref: string | null;
  documentation_id: string | null;
  cleaner_id: string | null;
  cleaner_name: string | null;
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
  booking_id: string;
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
const ISSUE_TYPES = [
  { id: "complaint", label: "Complaint" },
  { id: "reclean", label: "Re-clean" },
  { id: "damage", label: "Damage" },
  { id: "no_show", label: "No-show" },
  { id: "late", label: "Late arrival" },
  { id: "quality_flag", label: "Quality flag" },
  { id: "payment", label: "Payment" },
  { id: "other", label: "Other" },
];
const STATUSES = ["open", "investigating", "awaiting_customer", "resolved", "escalated"];
const SEVERITIES = ["low", "medium", "high", "critical"];

const label = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const fmtDT = (iso?: string | null) => (iso ? format(new Date(iso), "MMM d, yyyy h:mm a") : "—");
const fmtD = (iso?: string | null) => (iso ? format(new Date(`${iso}`.slice(0, 10) + "T12:00:00"), "MMM d, yyyy") : "—");

// ─── Page ───────────────────────────────────────────────────────────────

export default function QualityControl() {
  const [tab, setTab] = useState<"issues" | "docs" | "cleaners">("issues");
  const [loading, setLoading] = useState(true);
  const [issues, setIssues] = useState<IssueRow[]>([]);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [completed30, setCompleted30] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const since90 = new Date(Date.now() - 90 * 86400_000).toISOString();
      const since30 = new Date(Date.now() - 30 * 86400_000).toISOString();
      const [issuesRes, docsRes, completedRes] = await Promise.all([
        (supabase.from as any)("qc_issues").select("*").order("created_at", { ascending: false }).limit(500),
        (supabase.from as any)("job_documentation")
          .select("id, booking_id, booking_ref, client_name, service_type, service_date, cleaner_names, before_photos, after_photos, photo_count, checklist_progress_pct, documented, mirror_status, mirror_attempts, mirror_last_error, mirrored_at, drive_folder_url, drive_pdf_url, photos_purged_at, completed_at")
          .gte("completed_at", since90)
          .order("completed_at", { ascending: false })
          .limit(500),
        supabase.from("bookings").select("id", { count: "exact", head: true })
          .eq("status", "completed").gte("completed_at", since30),
      ]);
      setIssues(((issuesRes.data || []) as IssueRow[]));
      setDocs(((docsRes.data || []) as DocRow[]));
      setCompleted30(completedRes.count || 0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load QC data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

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
      const key = i.cleaner_name || "Unattributed";
      const e = m.get(key) || { name: key, total: 0, open: 0, recleans: 0, complaints: 0 };
      e.total++;
      if (i.status !== "resolved") e.open++;
      if (i.issue_type === "reclean") e.recleans++;
      if (i.issue_type === "complaint") e.complaints++;
      m.set(key, e);
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
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          <RiRefreshLine className={cn("w-4 h-4 mr-1.5", loading && "animate-spin")} /> Refresh
        </Button>
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
        {([["issues", "Issues"], ["docs", "Documentation"], ["cleaners", "By Cleaner"]] as const).map(([id, t]) => (
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
        <IssuesTab issues={issues} docs={docs} reload={load} />
      ) : tab === "docs" ? (
        <DocsTab docs={docs} reload={load} />
      ) : (
        <CleanersTab byCleaner={byCleaner} />
      )}
    </div>
  );
}

// ─── Issues tab ─────────────────────────────────────────────────────────

function IssuesTab({ issues, docs, reload }: { issues: IssueRow[]; docs: DocRow[]; reload: () => Promise<void> }) {
  const [statusFilter, setStatusFilter] = useState("active");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<IssueRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

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
                <Badge className={cn("border-0", SEVERITY_STYLE[i.severity])}>{label(i.severity)}</Badge>
                <Badge className={cn("border-0", STATUS_STYLE[i.status])}>{label(i.status)}</Badge>
                <Badge variant="outline">{ISSUE_TYPES.find((t) => t.id === i.issue_type)?.label || i.issue_type}</Badge>
                <span className="text-xs text-slate-400 ml-auto">{fmtDT(i.created_at)}</span>
              </div>
              <p className="font-semibold text-slate-900 mt-1.5">{i.title}</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {i.booking_ref || i.booking_id.slice(0, 8)} · {i.client_name || i.client_email || "—"}
                {i.cleaner_name ? ` · cleaner: ${i.cleaner_name}` : ""} · via {label(i.reported_via)}
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

  useEffect(() => {
    void (async () => {
      const { data } = await (supabase.from as any)("qc_issue_events")
        .select("id, action, from_status, to_status, note, actor_name, created_at")
        .eq("issue_id", issue.id)
        .order("created_at", { ascending: true });
      setEvents((data || []) as IssueEvent[]);
    })();
  }, [issue.id]);

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
            {issue.cleaner_name && <Badge variant="outline">Cleaner: {issue.cleaner_name}</Badge>}
          </div>

          {issue.description && (
            <p className="text-sm text-slate-700 whitespace-pre-wrap bg-slate-50 rounded-lg p-3">{issue.description}</p>
          )}

          {/* ─── Evidence: the linked job's documentation ─────────────── */}
          <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-4 space-y-3">
            <p className="text-sm font-bold text-violet-800 flex items-center gap-1.5">
              <RiFolderCheckLine className="w-4 h-4" /> Job evidence
            </p>
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
                {(beforePhotos.length > 0 || afterPhotos.length > 0) && (
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
  const [saving, setSaving] = useState(false);

  const searchBookings = useCallback(async () => {
    const q = query.trim();
    if (q.length < 2) return;
    setSearching(true);
    try {
      const num = q.replace(/^nov-?0*/i, "");
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
        body: { action: "create", bookingId: booking.id, issueType, severity, title: title.trim(), description: description.trim() || undefined },
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
                  placeholder="Find job: client email, name, or NOV-00012…"
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
                      {b.booking_number ? `NOV-${String(b.booking_number).padStart(5, "0")}` : b.id.slice(0, 8)}
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
                  <strong>{booking.booking_number ? `NOV-${String(booking.booking_number).padStart(5, "0")}` : booking.id.slice(0, 8)}</strong>{" "}
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
              <span className="font-semibold text-slate-900">{d.booking_ref || d.booking_id.slice(0, 8)}</span>
              <span className="text-sm text-slate-500">{d.client_name} · {fmtD(d.service_date)} · {d.service_type}</span>
              <div className="flex gap-1.5 ml-auto items-center">
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
