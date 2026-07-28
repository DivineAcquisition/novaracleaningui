// ─── Talent Acquisition collector — applications reviewed ─────────────────────
//
// The Applicants table in the Talent Acquisition pipeline syncs into
// public.cleaner_applicants, and the cleaner hub stamps stage_changed_by with
// the acting admin's email whenever someone moves an applicant along. That
// stamp is the attribution: an application counts as "reviewed" on the day a
// VA moved it out of the untouched `applicant` stage.
//
// Stage moves made by the sync itself ("sync:airtable") or by a migration
// ("system:…") are never attributed to anyone.

import type { MetricKey, SourceStatus } from "../metrics";
import {
  bump,
  ok,
  setValue,
  unavailable,
  type Collector,
  type CollectContext,
  type CollectorResult,
} from "./types";

const METRICS: MetricKey[] = ["applications_reviewed"];

export const talentCollector: Collector = {
  source: "airtableTalent",
  metrics: METRICS,

  async collect(ctx: CollectContext): Promise<CollectorResult> {
    const byVa = new Map<string, Record<string, number | null>>();
    const vaStatus = new Map<string, SourceStatus>();

    const byEmail = new Map<string, string>();
    for (const va of ctx.vas) {
      const email = va.email.trim().toLowerCase();
      if (email) byEmail.set(email, va.id);
      else vaStatus.set(va.id, "unlinked");
    }

    const { data, error } = await ctx.supabase
      .from("cleaner_applicants")
      .select("id, stage, stage_changed_at, stage_changed_by")
      .gte("stage_changed_at", ctx.window.startIso)
      .lt("stage_changed_at", ctx.window.endIso)
      .not("stage_changed_by", "is", null);

    if (error) return { byVa, status: unavailable(error.message), vaStatus };

    for (const va of ctx.vas) setValue(byVa, va.id, "applications_reviewed", 0);

    for (const row of ((data || []) as Record<string, unknown>[])) {
      const actor = String(row.stage_changed_by || "").trim().toLowerCase();
      if (!actor || actor.startsWith("sync:") || actor.startsWith("system:")) continue;
      const vaId = byEmail.get(actor);
      if (vaId) bump(byVa, vaId, "applications_reviewed", 1);
    }

    return { byVa, status: ok(), vaStatus };
  },
};
