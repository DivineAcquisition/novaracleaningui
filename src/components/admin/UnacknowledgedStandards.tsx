"use client";

// ─── Contractors who haven't acknowledged the current standards ──────────────
//
// The re-acknowledgment campaign as a worklist. Two populations end up here and
// they are not the same conversation, so the panel keeps them apart:
//
//   * never — no acknowledgment of any version on file;
//   * outdated — acknowledged an earlier version, and the addendum has since
//     been revised. These people did what was asked; they're being asked again.
//
// Publishing a revision refills this panel for the whole roster with no code
// change, which is the point: a standard nobody re-acknowledged is a standard
// that is awkward to enforce. It hides itself when everyone is current, because
// a permanent empty card teaches people to stop looking at it.

import { RiFileWarningLine, RiLoader4Line, RiMailSendLine } from "@remixicon/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { describeEdgeError } from "@/lib/edge-invoke";
import {
  CONTRACTOR_STANDARDS_EDITION,
  CONTRACTOR_STANDARDS_VERSION,
} from "@/lib/contractor-standards";

interface StandardsStatusRow {
  cleaner_id: string;
  cleaner_name: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  acknowledged_version: string | null;
  acknowledged_at: string | null;
  standing: "never" | "outdated" | "current";
  link_outstanding: boolean;
  conduct_standards_token_sent_at: string | null;
  link_sent_count: number;
  working_unacknowledged: boolean;
}

function sinceLabel(iso: string | null): string {
  if (!iso) return "never asked";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "asked today";
  if (days === 1) return "asked yesterday";
  return `asked ${days} days ago`;
}

export default function UnacknowledgedStandards({
  onSelectCleaner,
}: {
  onSelectCleaner?: (cleanerId: string) => void;
}) {
  const [rows, setRows] = useState<StandardsStatusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    // The view post-dates the generated Supabase types. It computes `standing`
    // against app_settings, so this never needs to know the current version to
    // decide who is behind — only to label it.
    const { data, error } = await (supabase.from as any)("cleaner_conduct_standards_status_v1")
      .select("*")
      .neq("standing", "current")
      .order("working_unacknowledged", { ascending: false })
      .order("cleaner_name", { ascending: true })
      .limit(100);
    // An empty roster and a broken query both used to render as nothing at all,
    // which reads as "everybody is current" — the most expensive wrong answer
    // here. Say so instead.
    setLoadError(error ? error.message || "Couldn't load standards status." : null);
    setRows(error ? [] : ((data || []) as StandardsStatusRow[]));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sendLink = async (row: StandardsStatusRow) => {
    setBusyId(row.cleaner_id);
    try {
      const { data, error } = await supabase.functions.invoke("cleaner-admin-action", {
        body: { action: "send_standards", cleanerId: row.cleaner_id },
      });
      if (error) throw new Error(await describeEdgeError(error, data));
      const d = (data || {}) as { error?: string; emailed?: boolean; smsSent?: boolean; standardsUrl?: string };
      if (d.error) throw new Error(d.error);
      const via = [d.emailed ? "email" : null, d.smsSent ? "text" : null].filter(Boolean).join(" + ");
      toast.success(
        via
          ? `Standards link sent to ${row.cleaner_name || "them"} by ${via}`
          : "Standards link created",
        { description: d.standardsUrl, duration: via ? 6000 : 20_000 },
      );
      await load();
    } catch (e) {
      toast.error("Couldn't send the standards link", {
        description: (e as Error).message,
        duration: 20_000,
      });
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return null;

  if (loadError) {
    return (
      <Card className="border-rose-200 bg-rose-50/40">
        <CardContent className="p-4">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-rose-900">
            <RiFileWarningLine className="h-4 w-4" />
            Couldn&apos;t check who has acknowledged the contractor standards
          </p>
          <p className="mt-1 text-xs text-rose-800">
            {loadError} — treat this as unknown rather than clear.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (rows.length === 0) return null;

  const working = rows.filter((r) => r.working_unacknowledged);
  const outdated = rows.filter((r) => r.standing === "outdated");

  return (
    <Card className="border-indigo-200 bg-indigo-50/40">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-indigo-900">
            <RiFileWarningLine className="h-4 w-4" />
            {rows.length} contractor{rows.length === 1 ? "" : "s"} haven&apos;t acknowledged the
            current standards
          </p>
          <p className="text-xs text-indigo-800">
            {working.length > 0 ? (
              <>
                <span className="font-semibold">{working.length}</span> active and taking work
                {outdated.length > 0 ? " · " : ""}
              </>
            ) : null}
            {outdated.length > 0 ? `${outdated.length} on an older version` : null}
          </p>
        </div>

        <div className="space-y-1.5">
          {rows.map((r) => (
            <div
              key={r.cleaner_id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-indigo-200 bg-white px-3 py-2"
            >
              <div className="min-w-0 text-xs">
                <button
                  onClick={() => onSelectCleaner?.(r.cleaner_id)}
                  className="font-medium text-slate-900 underline decoration-dotted"
                >
                  {r.cleaner_name || "Unnamed contractor"}
                </button>
                {r.working_unacknowledged ? (
                  <Badge variant="destructive" className="ml-1.5 text-[10px]">
                    working unacknowledged
                  </Badge>
                ) : (
                  <Badge variant="outline" className="ml-1.5 text-[10px]">
                    {r.status || "pending"}
                  </Badge>
                )}
                <span className="ml-1.5 text-slate-500">
                  {r.standing === "outdated"
                    ? `on ${r.acknowledged_version} · `
                    : "never acknowledged · "}
                  {r.link_outstanding
                    ? `link out · ${sinceLabel(r.conduct_standards_token_sent_at)}`
                    : sinceLabel(r.conduct_standards_token_sent_at)}
                  {r.link_sent_count > 1 ? ` · ${r.link_sent_count} attempts` : ""}
                  {!r.email && !r.phone ? " · no contact details on file" : ""}
                </span>
              </div>
              <Button
                size="sm"
                variant={r.link_outstanding ? "outline" : "default"}
                onClick={() => void sendLink(r)}
                disabled={busyId !== null || (!r.email && !r.phone)}
              >
                {busyId === r.cleaner_id ? (
                  <RiLoader4Line className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>
                    <RiMailSendLine className="mr-1 h-3.5 w-3.5" />
                    {r.link_outstanding ? "Send again" : "Send standards link"}
                  </>
                )}
              </Button>
            </div>
          ))}
        </div>

        <p className="text-[11px] text-indigo-800/90">
          Current version: {CONTRACTOR_STANDARDS_VERSION} ({CONTRACTOR_STANDARDS_EDITION}). The link
          opens straight onto the standards with no login, and stays open afterwards so contractors
          can re-read them on a job.
        </p>
      </CardContent>
    </Card>
  );
}
