// ─── Workspace collector — cleaner hub + quotes ───────────────────────────────
//
// Everything the admin workspace itself records about a VA's output:
//
//   phone_screenings   — screens submitted, keyed by screener_id (auth user)
//                        and their recommendation (advance / hold / decline)
//   cleaner_applicants — onboarding launched and cleaners activated, keyed by
//                        the stage_changed_by email stamp
//   va_quotes          — quotes saved and sent, keyed by the free-text csr_name
//
// Each sub-query degrades on its own: a failure in one leaves its metrics
// unverified without taking the rest of the source down with it.

import type { MetricKey, SourceStatus } from "../metrics";
import { nameAliases } from "../vas";
import {
  bump,
  ok,
  setValue,
  unavailable,
  type Collector,
  type CollectContext,
  type CollectorResult,
} from "./types";

const SCREEN_METRICS: MetricKey[] = [
  "phone_screens_completed",
  "screens_advanced",
  "screens_held",
  "screens_declined",
];
const APPLICANT_METRICS: MetricKey[] = ["onboarding_launched", "cleaners_activated"];
const QUOTE_METRICS: MetricKey[] = ["quotes_sent"];

export const workspaceCollector: Collector = {
  source: "workspace",
  metrics: [...SCREEN_METRICS, ...APPLICANT_METRICS, ...QUOTE_METRICS],

  async collect(ctx: CollectContext): Promise<CollectorResult> {
    const byVa = new Map<string, Record<string, number | null>>();
    const vaStatus = new Map<string, SourceStatus>();
    const metricStatus: Partial<Record<MetricKey, SourceStatus>> = {};

    const byUser = new Map<string, string>();
    const byEmail = new Map<string, string>();
    const byAlias = new Map<string, string>();
    for (const va of ctx.vas) {
      if (va.workspaceUserId) byUser.set(va.workspaceUserId, va.id);
      const email = va.email.trim().toLowerCase();
      if (email) byEmail.set(email, va.id);
      for (const alias of nameAliases(va)) if (!byAlias.has(alias)) byAlias.set(alias, va.id);
    }

    for (const va of ctx.vas) {
      for (const key of this.metrics) setValue(byVa, va.id, key, 0);
    }

    const [screens, applicants, quotes] = await Promise.all([
      ctx.supabase
        .from("phone_screenings")
        .select("id, screener_id, recommendation, submitted_at, status")
        .eq("status", "submitted")
        .gte("submitted_at", ctx.window.startIso)
        .lt("submitted_at", ctx.window.endIso),
      ctx.supabase
        .from("cleaner_applicants")
        .select("id, stage, stage_changed_at, stage_changed_by, onboarding_launched_at")
        .gte("stage_changed_at", ctx.window.startIso)
        .lt("stage_changed_at", ctx.window.endIso)
        .not("stage_changed_by", "is", null),
      ctx.supabase
        .from("va_quotes")
        .select("id, csr_name, created_at")
        .gte("created_at", ctx.window.startIso)
        .lt("created_at", ctx.window.endIso),
    ]);

    let anyOk = false;

    if (screens.error) {
      for (const key of SCREEN_METRICS) {
        metricStatus[key] = "unavailable";
        for (const va of ctx.vas) setValue(byVa, va.id, key, null);
      }
    } else {
      anyOk = true;
      for (const row of ((screens.data || []) as Record<string, unknown>[])) {
        const vaId = row.screener_id ? byUser.get(String(row.screener_id)) : undefined;
        if (!vaId) continue;
        bump(byVa, vaId, "phone_screens_completed", 1);
        switch (String(row.recommendation || "").toLowerCase()) {
          case "advance":
            bump(byVa, vaId, "screens_advanced", 1);
            break;
          case "hold":
            bump(byVa, vaId, "screens_held", 1);
            break;
          case "decline":
            bump(byVa, vaId, "screens_declined", 1);
            break;
        }
      }
    }

    if (applicants.error) {
      for (const key of APPLICANT_METRICS) {
        metricStatus[key] = "unavailable";
        for (const va of ctx.vas) setValue(byVa, va.id, key, null);
      }
    } else {
      anyOk = true;
      for (const row of ((applicants.data || []) as Record<string, unknown>[])) {
        const actor = String(row.stage_changed_by || "").trim().toLowerCase();
        if (!actor || actor.startsWith("sync:") || actor.startsWith("system:")) continue;
        const vaId = byEmail.get(actor);
        if (!vaId) continue;
        const stage = String(row.stage || "").toLowerCase();
        if (stage === "onboarding") bump(byVa, vaId, "onboarding_launched", 1);
        if (stage === "active") bump(byVa, vaId, "cleaners_activated", 1);
      }
    }

    if (quotes.error) {
      for (const key of QUOTE_METRICS) {
        metricStatus[key] = "unavailable";
        for (const va of ctx.vas) setValue(byVa, va.id, key, null);
      }
    } else {
      anyOk = true;
      for (const row of ((quotes.data || []) as Record<string, unknown>[])) {
        const name = String(row.csr_name || "").trim().toLowerCase();
        const vaId = name ? byAlias.get(name) : undefined;
        if (vaId) bump(byVa, vaId, "quotes_sent", 1);
      }
    }

    if (!anyOk) {
      return {
        byVa,
        status: unavailable(
          screens.error?.message || applicants.error?.message || quotes.error?.message || "Workspace read failed",
        ),
        vaStatus,
      };
    }

    return { byVa, status: ok(), vaStatus, metricStatus };
  },
};
