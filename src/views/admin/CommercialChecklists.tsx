"use client";

// ─── Commercial hub → Checklists ───────────────────────────────────────────
//
// Three views over the same items:
//
//   Standard  the published Edition 1.0 lists, as the customer and crew see
//             them, with the live wording (which may be an edited version).
//   Review    items that crossed the signal threshold this cycle, with the
//             counts behind each one. Edit, leave unchanged with a reason, or
//             escalate. Nothing here is auto-applied.
//   Health    per item: signal totals, and — where an item has been edited —
//             signal before that edit vs after it. This is the loop closing:
//             edit → observe → confirm or revisit.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  RiAlertLine,
  RiCheckboxCircleFill,
  RiExternalLinkLine,
  RiFileCopyLine,
  RiFileDownloadLine,
  RiInformationLine,
  RiLoader4Line,
  RiRefreshLine,
} from "@remixicon/react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CommercialScopeComparison } from "@/components/checklists/CommercialScopePreview";
import {
  CHECKLISTS,
  COMMERCIAL_CHECKLIST_SLUGS,
  TRY_CHECKLIST_ORIGIN,
  type ChecklistSlug,
} from "@/lib/checklists";
import { CHECKLIST_CATALOG_LABELS } from "@/lib/checklist-catalog";
import { cn } from "@/lib/utils";

type View = "standard" | "review" | "health";

interface ChecklistItemRow {
  item_id: string;
  area: string;
  checklists: string[];
  item_text: string;
  photo_required: boolean;
  current_version: number;
  origin: string;
  catalog_text: string | null;
}

interface HealthRow {
  item_id: string;
  area: string;
  checklists: string[];
  item_text: string;
  current_version: number;
  last_edited_at: string | null;
  quality_miss_total: number;
  scope_confusion_total: number;
  qc_case_total: number;
  duration_variance_total: number;
  recurrence_total: number;
  review_theme_total: number;
  signals_before_edit: number;
  signals_after_edit: number;
  last_signal_at: string | null;
}

interface VersionRow {
  id: string;
  item_id: string;
  version: number;
  item_text: string;
  change_summary: string | null;
  source_insight_id: string | null;
  changed_by_name: string | null;
  created_at: string;
}

interface InsightRow {
  id: string;
  item_id: string;
  cycle_start: string;
  cycle_end: string;
  checklist_keys: string[];
  area: string | null;
  item_text_at_surface: string | null;
  quality_miss_count: number;
  scope_confusion_count: number;
  qc_case_count: number;
  review_theme_count: number;
  duration_variance_count: number;
  recurrence_count: number;
  observation: string;
  numbers: string;
  hypothesis: string;
  model: string | null;
  model_version: string | null;
  status: string;
  resolution_note: string | null;
  escalated_to: string | null;
  resolved_by_name: string | null;
  resolved_at: string | null;
}

async function api(path: string, init?: RequestInit) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out?.ok === false) throw new Error(out?.error || `Request failed (${res.status})`);
  return out as Record<string, unknown>;
}

export default function CommercialChecklists() {
  const [view, setView] = useState<View>("standard");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [items, setItems] = useState<ChecklistItemRow[]>([]);
  const [health, setHealth] = useState<HealthRow[]>([]);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [insights, setInsights] = useState<InsightRow[]>([]);
  const [queueStatus, setQueueStatus] = useState("open");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [base, queue] = await Promise.all([
        api("/api/admin/checklists"),
        api(`/api/admin/checklists/insights?status=${queueStatus}`),
      ]);
      setItems((base.items as ChecklistItemRow[]) || []);
      setHealth((base.health as HealthRow[]) || []);
      setVersions((base.versions as VersionRow[]) || []);
      setInsights((queue.insights as InsightRow[]) || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't load checklists");
    } finally {
      setLoading(false);
    }
  }, [queueStatus]);

  useEffect(() => { void load(); }, [load]);

  const sync = async () => {
    setSyncing(true);
    try {
      const out = await api("/api/admin/checklists", {
        method: "POST",
        body: JSON.stringify({ action: "sync" }),
      });
      toast.success(
        `Synced ${out.synced} items from the Edition 1.0 catalog${
          Number(out.preservedEdits) > 0 ? ` — ${out.preservedEdits} edited item(s) kept their wording` : ""
        }.`,
      );
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const liveText = useMemo(
    () => new Map(items.map((i) => [i.item_id, i])),
    [items],
  );
  const openCount = insights.filter((i) => i.status === "open").length;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-violet-200 bg-violet-50/60 px-4 py-3 text-sm text-slate-700 flex items-start gap-2">
        <RiInformationLine className="w-4 h-4 mt-0.5 text-violet-700 shrink-0" />
        <p>
          Edition 1.0 of the{" "}
          <Link href="/checklist" className="font-medium text-violet-800 underline underline-offset-2" target="_blank">
            standard cleaning checklists
          </Link>
          . Items are addressable — QC cases, re-cleans, and duration variance point at a specific
          item, so signal survives a rewording. Light ⊂ Standard ⊂ Detailed. Nothing on this screen
          changes automatically; every edit is versioned and attributed.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {([
            ["standard", "Standard"],
            ["review", openCount > 0 ? `Review (${openCount})` : "Review"],
            ["health", "Health"],
          ] as Array<[View, string]>).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setView(id)}
              className={cn(
                "rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                view === id
                  ? "bg-violet-50 text-violet-800 ring-1 ring-violet-200"
                  : "text-slate-500 hover:bg-slate-100 hover:text-slate-800",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {items.length === 0 && !loading && (
            <span className="text-xs text-amber-700">Catalog not seeded yet —</span>
          )}
          <Button variant="outline" size="sm" onClick={() => void sync()} disabled={syncing}>
            {syncing ? <RiLoader4Line className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RiRefreshLine className="w-3.5 h-3.5 mr-1.5" />}
            Sync catalog
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500 flex items-center gap-2">
          <RiLoader4Line className="w-4 h-4 animate-spin" /> Loading…
        </p>
      ) : view === "standard" ? (
        <StandardView liveText={liveText} versions={versions} onEdited={load} />
      ) : view === "review" ? (
        <ReviewQueue
          insights={insights}
          liveText={liveText}
          status={queueStatus}
          onStatusChange={setQueueStatus}
          onResolved={load}
        />
      ) : (
        <HealthView health={health} />
      )}
    </div>
  );
}

// ─── Standard ─────────────────────────────────────────────────────────────

function StandardView({
  liveText,
  versions,
  onEdited,
}: {
  liveText: Map<string, ChecklistItemRow>;
  versions: VersionRow[];
  onEdited: () => void;
}) {
  const [active, setActive] = useState<ChecklistSlug>("commercial-standard");
  const checklist = CHECKLISTS[active];
  const publicHref = `${TRY_CHECKLIST_ORIGIN}/checklist/${checklist.slug}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicHref);
      toast.success("Public checklist link copied");
    } catch {
      toast.error("Copy failed");
    }
  };

  return (
    <div className="space-y-5">
      <CommercialScopeComparison />

      <div className="flex flex-wrap gap-1.5">
        {COMMERCIAL_CHECKLIST_SLUGS.map((slug) => (
          <button
            key={slug}
            type="button"
            onClick={() => setActive(slug)}
            className={cn(
              "rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
              slug === active
                ? "bg-violet-50 text-violet-800 ring-1 ring-violet-200"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-800",
            )}
          >
            {CHECKLISTS[slug].name}
          </button>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">{checklist.name}</h2>
          <p className="text-sm text-slate-500 mt-1">{checklist.tagline}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href="/NovaraCleaning_Standard_Cleaning_Checklists_v1.pdf" target="_blank" rel="noopener noreferrer">
              <RiFileDownloadLine className="w-3.5 h-3.5 mr-1.5" />
              Printable PDF
            </a>
          </Button>
          <Button variant="outline" size="sm" onClick={() => void copyLink()}>
            <RiFileCopyLine className="w-3.5 h-3.5 mr-1.5" />
            Copy public link
          </Button>
          <Button size="sm" asChild>
            <Link href={`/checklist/${checklist.slug}`} target="_blank" rel="noopener noreferrer">
              Open public page
              <RiExternalLinkLine className="w-3.5 h-3.5 ml-1.5" />
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {checklist.sections.map((section) => (
          <Card key={section.title} className="border-slate-200">
            <CardContent className="p-4">
              <p className="font-semibold text-slate-900 mb-2">{section.title}</p>
              <ul className="space-y-2">
                {section.items.map((item, idx) => {
                  const id = section.itemIds?.[idx];
                  const row = id ? liveText.get(id) : undefined;
                  const history = id ? versions.filter((v) => v.item_id === id) : [];
                  return (
                    <li key={id || item} className="text-sm text-slate-800">
                      <div className="flex items-start gap-2">
                        <RiCheckboxCircleFill className="w-4 h-4 mt-0.5 shrink-0 text-violet-600" />
                        <div className="min-w-0">
                          <p>{row?.item_text || item}</p>
                          {id && (
                            <p className="text-[10px] font-mono text-slate-400 mt-0.5">
                              {id}
                              {row && row.current_version > 1 && (
                                <span className="ml-1.5 text-violet-600">v{row.current_version}</span>
                              )}
                            </p>
                          )}
                          {row && row.current_version > 1 && history[0]?.change_summary && (
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              Last change: {history[0].change_summary}
                              {history[0].changed_by_name ? ` — ${history[0].changed_by_name}` : ""}
                            </p>
                          )}
                        </div>
                      </div>
                      {id && row && (
                        <ItemEditor item={row} onEdited={onEdited} />
                      )}
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function ItemEditor({ item, onEdited }: { item: ChecklistItemRow; onEdited: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(item.item_text);
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api("/api/admin/checklists", {
        method: "POST",
        body: JSON.stringify({
          action: "edit",
          itemId: item.item_id,
          itemText: text,
          changeSummary: summary,
        }),
      });
      toast.success(`Saved as v${item.current_version + 1} — the prior version is kept.`);
      setOpen(false);
      setSummary("");
      onEdited();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Edit failed");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        className="ml-6 mt-0.5 text-[11px] font-medium text-slate-400 hover:text-violet-700"
        onClick={() => setOpen(true)}
      >
        Edit item
      </button>
    );
  }

  return (
    <div className="ml-6 mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-2">
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} className="text-xs" />
      <Input
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        placeholder="What changed and why (kept in version history)"
        className="h-8 text-xs"
      />
      <div className="flex gap-2">
        <Button size="sm" className="h-7 text-xs" disabled={busy || !summary.trim()} onClick={() => void save()}>
          {busy ? <RiLoader4Line className="w-3 h-3 mr-1 animate-spin" /> : null}
          Save new version
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ─── Review queue ─────────────────────────────────────────────────────────

function ReviewQueue({
  insights,
  liveText,
  status,
  onStatusChange,
  onResolved,
}: {
  insights: InsightRow[];
  liveText: Map<string, ChecklistItemRow>;
  status: string;
  onStatusChange: (v: string) => void;
  onResolved: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600 max-w-2xl">
          Items that crossed the signal threshold. Each insight names the counts behind it and is
          phrased as a hypothesis — where the data doesn&apos;t show a cause, it says so instead of
          guessing.
        </p>
        <Select value={status} onValueChange={onStatusChange}>
          <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="edited">Edited</SelectItem>
            <SelectItem value="unchanged">Left unchanged</SelectItem>
            <SelectItem value="escalated">Escalated</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {insights.length === 0 ? (
        <Card className="border-slate-200">
          <CardContent className="p-6 text-center text-sm text-slate-500">
            Nothing in this state. Items surface here on the aggregation cycle once they cross the
            minimum signal threshold — a single isolated incident is not a pattern.
          </CardContent>
        </Card>
      ) : (
        insights.map((insight) => (
          <InsightCard
            key={insight.id}
            insight={insight}
            live={liveText.get(insight.item_id)}
            onResolved={onResolved}
          />
        ))
      )}
    </div>
  );
}

function SignalChip({ label, count, tone }: { label: string; count: number; tone: string }) {
  if (!count) return null;
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium", tone)}>
      {count} {label}
    </span>
  );
}

function InsightCard({
  insight,
  live,
  onResolved,
}: {
  insight: InsightRow;
  live?: ChecklistItemRow;
  onResolved: () => void;
}) {
  const [mode, setMode] = useState<"" | "edited" | "unchanged" | "escalated">("");
  const [text, setText] = useState(live?.item_text || insight.item_text_at_surface || "");
  const [note, setNote] = useState("");
  const [target, setTarget] = useState("pricing_scope");
  const [busy, setBusy] = useState(false);
  const resolved = insight.status !== "open";

  const submit = async () => {
    setBusy(true);
    try {
      await api("/api/admin/checklists/insights", {
        method: "POST",
        body: JSON.stringify({
          action: "resolve",
          insightId: insight.id,
          resolution: mode,
          itemText: mode === "edited" ? text : undefined,
          note,
          escalatedTo: mode === "escalated" ? target : undefined,
        }),
      });
      toast.success(
        mode === "edited"
          ? "Item edited — new version saved and linked to this insight."
          : mode === "unchanged"
            ? "Left unchanged, with your reason on the record."
            : "Escalated.",
      );
      setMode("");
      setNote("");
      onResolved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not resolve");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className={cn("border-slate-200", resolved && "opacity-70")}>
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-slate-900">{insight.observation}</p>
            <p className="text-[11px] font-mono text-slate-400 mt-0.5">
              {insight.item_id} · cycle {insight.cycle_start} → {insight.cycle_end}
            </p>
          </div>
          <Badge variant="outline" className="shrink-0">
            {resolved ? insight.status : "open"}
          </Badge>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <SignalChip label="quality-miss re-cleans" count={insight.quality_miss_count} tone="bg-rose-50 text-rose-800" />
          <SignalChip label="scope-confusion re-cleans" count={insight.scope_confusion_count} tone="bg-amber-50 text-amber-800" />
          <SignalChip label="QC cases" count={insight.qc_case_count} tone="bg-slate-100 text-slate-700" />
          <SignalChip label="recurrence flags" count={insight.recurrence_count} tone="bg-purple-50 text-purple-800" />
          <SignalChip label="duration flags (checklist-level)" count={insight.duration_variance_count} tone="bg-sky-50 text-sky-800" />
          <SignalChip label="review mentions (area-level)" count={insight.review_theme_count} tone="bg-teal-50 text-teal-800" />
        </div>

        <div className="rounded-lg bg-slate-50 border border-slate-100 p-3 space-y-1.5">
          <p className="text-xs text-slate-700">
            <span className="font-semibold">Counts: </span>
            {insight.numbers}
          </p>
          <p className="text-xs text-slate-700">
            <span className="font-semibold">Hypothesis: </span>
            {insight.hypothesis}
          </p>
          {insight.model && (
            <p className="text-[10px] text-slate-400">
              {insight.model}
              {insight.model_version ? ` · ${insight.model_version}` : ""}
            </p>
          )}
        </div>

        {live && (
          <p className="text-xs text-slate-600">
            <span className="font-semibold">Live wording (v{live.current_version}): </span>
            {live.item_text}
          </p>
        )}

        {resolved ? (
          <p className="text-xs text-slate-500">
            {insight.status === "escalated"
              ? `Escalated to ${insight.escalated_to}`
              : insight.status === "edited"
                ? "Edited"
                : "Left unchanged"}
            {insight.resolution_note ? ` — ${insight.resolution_note}` : ""}
            {insight.resolved_by_name ? ` · ${insight.resolved_by_name}` : ""}
          </p>
        ) : mode === "" ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setMode("edited")}>Edit item</Button>
            <Button size="sm" variant="outline" onClick={() => setMode("unchanged")}>Leave unchanged</Button>
            <Button size="sm" variant="outline" onClick={() => setMode("escalated")}>Escalate</Button>
          </div>
        ) : (
          <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
            {mode === "edited" && (
              <div>
                <Label className="text-xs">New wording</Label>
                <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} className="mt-1 text-sm" />
              </div>
            )}
            {mode === "escalated" && (
              <div>
                <Label className="text-xs">Route to</Label>
                <Select value={target} onValueChange={setTarget}>
                  <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pricing_scope">Pricing / scope adjustment</SelectItem>
                    <SelectItem value="duration_learning">Duration learning loop</SelectItem>
                    <SelectItem value="training">Crew training</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label className="text-xs">
                {mode === "unchanged"
                  ? "Why it stays as-is (so this isn't re-litigated next cycle)"
                  : mode === "edited"
                    ? "What changed and why"
                    : "Context for whoever picks this up"}
              </Label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="mt-1 text-sm" />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={busy || (mode !== "escalated" && !note.trim()) || (mode === "edited" && !text.trim())}
                onClick={() => void submit()}
              >
                {busy ? <RiLoader4Line className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
                Confirm
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setMode("")}>Cancel</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Health ───────────────────────────────────────────────────────────────

function HealthView({ health }: { health: HealthRow[] }) {
  const withSignal = useMemo(
    () =>
      health
        .filter(
          (h) =>
            h.quality_miss_total + h.scope_confusion_total + h.qc_case_total +
              h.recurrence_total + h.review_theme_total + h.duration_variance_total >
            0,
        )
        .sort((a, b) => b.quality_miss_total - a.quality_miss_total),
    [health],
  );

  if (withSignal.length === 0) {
    return (
      <Card className="border-slate-200">
        <CardContent className="p-6 text-center text-sm text-slate-500">
          No item has drawn signal yet. Tag checklist items on QC cases and re-clean
          classifications, and this fills in on the next aggregation cycle.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600 max-w-2xl">
        Signal per item, and — for items that have been edited — how much of it landed before the
        edit versus after. An edit that didn&apos;t move the numbers is visible here rather than
        assumed successful.
      </p>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/80 text-left">
              <th className="px-3 py-2 font-semibold text-slate-700">Item</th>
              <th className="px-3 py-2 font-semibold text-slate-700 text-center">Quality-miss</th>
              <th className="px-3 py-2 font-semibold text-slate-700 text-center">Scope-confusion</th>
              <th className="px-3 py-2 font-semibold text-slate-700 text-center">QC</th>
              <th className="px-3 py-2 font-semibold text-slate-700 text-center">Recurrence</th>
              <th className="px-3 py-2 font-semibold text-slate-700 text-center">Before → after edit</th>
            </tr>
          </thead>
          <tbody>
            {withSignal.map((h) => {
              const improved =
                h.last_edited_at && h.signals_after_edit < h.signals_before_edit;
              const worse = h.last_edited_at && h.signals_after_edit > h.signals_before_edit;
              return (
                <tr key={h.item_id} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2">
                    <p className="text-slate-800">{h.item_text}</p>
                    <p className="text-[10px] font-mono text-slate-400 mt-0.5">
                      {h.item_id}
                      {h.current_version > 1 ? ` · v${h.current_version}` : ""}
                      {h.checklists?.length
                        ? ` · ${h.checklists.map((k) => CHECKLIST_CATALOG_LABELS[k as keyof typeof CHECKLIST_CATALOG_LABELS] || k).join(", ")}`
                        : ""}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-center font-medium text-rose-700">{h.quality_miss_total || "—"}</td>
                  <td className="px-3 py-2 text-center font-medium text-amber-700">{h.scope_confusion_total || "—"}</td>
                  <td className="px-3 py-2 text-center text-slate-700">{h.qc_case_total || "—"}</td>
                  <td className="px-3 py-2 text-center text-purple-700">{h.recurrence_total || "—"}</td>
                  <td className="px-3 py-2 text-center">
                    {!h.last_edited_at ? (
                      <span className="text-xs text-slate-400">not edited</span>
                    ) : (
                      <span
                        className={cn(
                          "text-xs font-medium",
                          improved ? "text-emerald-700" : worse ? "text-rose-700" : "text-slate-600",
                        )}
                      >
                        {h.signals_before_edit} → {h.signals_after_edit}
                        {improved ? " ↓" : worse ? " ↑" : ""}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500 flex items-start gap-1.5">
        <RiAlertLine className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-600" />
        Before/after counts use the whole retained signal history, not just the current cycle, so a
        recent edit will look thin on the after side until more jobs run.
      </p>
    </div>
  );
}
