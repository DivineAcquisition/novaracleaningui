// ─── GHL collector — outbound activity + inbound lead handling ────────────────
//
// Two halves, because they live in two places:
//
//   Messaging (calls placed, conversations connected, SMS sent) comes from the
//   GHL conversations API, attributed by the sender's GHL user id. When GHL
//   credentials aren't configured we fall back to the workspace's own call log
//   (phone_calls, populated by the OpenPhone/GHL bridge) for calls, and leave
//   sms_sent UNVERIFIED — a fallback that can't see SMS must say so rather
//   than report zero.
//
//   Lead handling (leads received, responded, median response, converted) comes
//   from public.leads, where assignment already carries the VA's workspace user
//   id. That is the system's own record of who owned the lead, so it is both
//   more attributable and more reliable than re-deriving it from the CRM.

import {
  conversationMessages,
  conversationsSince,
  isGhlConfigured,
  mapWithConcurrency,
} from "@/lib/ghl/reader";
import type { MetricKey, SourceStatus } from "../metrics";
import { median } from "../time";
import {
  bump,
  ok,
  setValue,
  unavailable,
  type Collector,
  type CollectContext,
  type CollectorResult,
} from "./types";

const MESSAGING_METRICS: MetricKey[] = ["calls_placed", "conversations_connected", "sms_sent"];
const LEAD_METRICS: MetricKey[] = [
  "inbound_leads",
  "leads_responded",
  "median_response_seconds",
  "leads_converted",
];

/** A call that lasted this long counts as a real conversation, not a dial. */
const CONNECTED_SECONDS = 30;

const CONVERTED_STATUSES = new Set(["converted", "booked", "won", "customer", "closed_won"]);

async function collectMessaging(
  ctx: CollectContext,
  byVa: Map<string, Record<string, number | null>>,
): Promise<{ status: SourceStatus; error?: string; unseen: MetricKey[] }> {
  const byGhlUser = new Map<string, string>();
  for (const va of ctx.vas) if (va.ghlUserId) byGhlUser.set(va.ghlUserId, va.id);

  if (isGhlConfigured() && byGhlUser.size > 0) {
    try {
      const ids = await conversationsSince(ctx.window.start.getTime());
      const batches = await mapWithConcurrency(ids, 5, async (id) => {
        try {
          return await conversationMessages(id);
        } catch {
          return [];
        }
      });

      // Source reached: every linked VA starts at a real zero.
      for (const vaId of byGhlUser.values()) {
        for (const key of MESSAGING_METRICS) setValue(byVa, vaId, key, 0);
      }

      const startMs = ctx.window.start.getTime();
      const endMs = ctx.window.end.getTime();
      for (const messages of batches) {
        for (const m of messages) {
          if (m.direction !== "outbound") continue;
          if (m.at < startMs || m.at >= endMs) continue;
          const vaId = m.userId ? byGhlUser.get(m.userId) : undefined;
          if (!vaId) continue;

          if (m.messageType.includes("SMS")) {
            bump(byVa, vaId, "sms_sent", 1);
          } else if (m.messageType.includes("CALL")) {
            bump(byVa, vaId, "calls_placed", 1);
            const connected =
              (m.callDurationSeconds ?? 0) >= CONNECTED_SECONDS ||
              (m.callStatus || "").toLowerCase() === "completed";
            if (connected) bump(byVa, vaId, "conversations_connected", 1);
          }
        }
      }
      return { status: "ok", unseen: [] };
    } catch (err) {
      // Fall through to the local call log rather than losing the whole day.
      const reason = err instanceof Error ? err.message : String(err);
      const fallback = await collectCallsFromWorkspace(ctx, byVa);
      return fallback.ok
        ? { status: "ok", unseen: ["sms_sent"], error: `GHL API unavailable (${reason}); calls read from the workspace call log.` }
        : { status: "unavailable", error: reason, unseen: MESSAGING_METRICS };
    }
  }

  const fallback = await collectCallsFromWorkspace(ctx, byVa);
  if (!fallback.ok) {
    return {
      status: "not_configured",
      error: "GHL credentials are not set and the workspace call log is unavailable.",
      unseen: MESSAGING_METRICS,
    };
  }
  return {
    status: "ok",
    error: "GHL credentials are not set — calls read from the workspace call log; SMS unverified.",
    unseen: ["sms_sent"],
  };
}

/** Fallback: the workspace's own call log, attributed by workspace user id. */
async function collectCallsFromWorkspace(
  ctx: CollectContext,
  byVa: Map<string, Record<string, number | null>>,
): Promise<{ ok: boolean }> {
  const userIds = ctx.vas.map((v) => v.workspaceUserId).filter((v): v is string => !!v);
  if (userIds.length === 0) return { ok: false };

  const { data, error } = await ctx.supabase
    .from("phone_calls")
    .select("va_user_id, direction, duration_seconds, status, started_at")
    .in("va_user_id", userIds)
    .gte("started_at", ctx.window.startIso)
    .lt("started_at", ctx.window.endIso);
  if (error) return { ok: false };

  const byUser = new Map<string, string>();
  for (const va of ctx.vas) if (va.workspaceUserId) byUser.set(va.workspaceUserId, va.id);
  for (const vaId of byUser.values()) {
    setValue(byVa, vaId, "calls_placed", 0);
    setValue(byVa, vaId, "conversations_connected", 0);
  }

  for (const row of (data || []) as Record<string, unknown>[]) {
    const vaId = byUser.get(String(row.va_user_id));
    if (!vaId) continue;
    if (String(row.direction || "").toLowerCase() === "inbound") continue;
    bump(byVa, vaId, "calls_placed", 1);
    const seconds = Number(row.duration_seconds || 0);
    if (seconds >= CONNECTED_SECONDS || String(row.status || "").toLowerCase() === "completed") {
      bump(byVa, vaId, "conversations_connected", 1);
    }
  }
  return { ok: true };
}

async function collectLeads(
  ctx: CollectContext,
  byVa: Map<string, Record<string, number | null>>,
): Promise<{ ok: boolean; error?: string }> {
  const byUser = new Map<string, string>();
  for (const va of ctx.vas) if (va.workspaceUserId) byUser.set(va.workspaceUserId, va.id);
  if (byUser.size === 0) return { ok: true };

  const userIds = [...byUser.keys()];

  const [received, converted] = await Promise.all([
    ctx.supabase
      .from("leads")
      .select("id, assigned_va_user_id, created_at, speed_to_lead_sms_sent_at, call_attempts, status")
      .in("assigned_va_user_id", userIds)
      .gte("created_at", ctx.window.startIso)
      .lt("created_at", ctx.window.endIso),
    ctx.supabase
      .from("leads")
      .select("id, assigned_va_user_id, status, updated_at")
      .in("assigned_va_user_id", userIds)
      .gte("updated_at", ctx.window.startIso)
      .lt("updated_at", ctx.window.endIso),
  ]);

  if (received.error) return { ok: false, error: received.error.message };

  for (const vaId of byUser.values()) {
    setValue(byVa, vaId, "inbound_leads", 0);
    setValue(byVa, vaId, "leads_responded", 0);
    setValue(byVa, vaId, "leads_converted", 0);
    // Median stays NULL until there is at least one responded lead — a median
    // of nothing is not zero seconds.
    setValue(byVa, vaId, "median_response_seconds", null);
  }

  const rows = (received.data || []) as Record<string, unknown>[];
  const leadIds = rows.map((r) => String(r.id));

  // First outbound touch per lead: the speed-to-lead SMS if one fired,
  // otherwise the earliest logged call.
  const firstCallByLead = new Map<string, number>();
  if (leadIds.length) {
    const { data: calls } = await ctx.supabase
      .from("phone_calls")
      .select("lead_id, started_at")
      .in("lead_id", leadIds)
      .not("started_at", "is", null);
    for (const c of (calls || []) as Record<string, unknown>[]) {
      const leadId = String(c.lead_id);
      const at = Date.parse(String(c.started_at));
      if (!Number.isFinite(at)) continue;
      const prev = firstCallByLead.get(leadId);
      if (prev === undefined || at < prev) firstCallByLead.set(leadId, at);
    }
  }

  const responseSeconds = new Map<string, number[]>();
  for (const row of rows) {
    const vaId = byUser.get(String(row.assigned_va_user_id));
    if (!vaId) continue;
    bump(byVa, vaId, "inbound_leads", 1);

    const createdAt = Date.parse(String(row.created_at));
    const smsAt = row.speed_to_lead_sms_sent_at ? Date.parse(String(row.speed_to_lead_sms_sent_at)) : NaN;
    const callAt = firstCallByLead.get(String(row.id));
    const touches = [smsAt, callAt].filter((t): t is number => Number.isFinite(t as number));
    if (touches.length === 0) continue;

    bump(byVa, vaId, "leads_responded", 1);
    const first = Math.min(...touches);
    if (Number.isFinite(createdAt) && first >= createdAt) {
      const list = responseSeconds.get(vaId) || [];
      list.push(Math.round((first - createdAt) / 1000));
      responseSeconds.set(vaId, list);
    }
  }

  for (const [vaId, list] of responseSeconds) {
    setValue(byVa, vaId, "median_response_seconds", median(list));
  }

  for (const row of ((converted.data || []) as Record<string, unknown>[])) {
    if (!CONVERTED_STATUSES.has(String(row.status || "").toLowerCase())) continue;
    const vaId = byUser.get(String(row.assigned_va_user_id));
    if (vaId) bump(byVa, vaId, "leads_converted", 1);
  }

  return { ok: true };
}

export const ghlCollector: Collector = {
  source: "ghl",
  metrics: [...MESSAGING_METRICS, ...LEAD_METRICS],

  async collect(ctx): Promise<CollectorResult> {
    const byVa = new Map<string, Record<string, number | null>>();
    const vaStatus = new Map<string, SourceStatus>();
    const metricStatus: Partial<Record<MetricKey, SourceStatus>> = {};

    for (const va of ctx.vas) {
      if (!va.ghlUserId && !va.workspaceUserId) vaStatus.set(va.id, "unlinked");
    }

    const messaging = await collectMessaging(ctx, byVa);
    for (const key of messaging.unseen) {
      metricStatus[key] = messaging.status === "ok" ? "not_configured" : messaging.status;
    }

    const leads = await collectLeads(ctx, byVa);
    if (!leads.ok) for (const key of LEAD_METRICS) metricStatus[key] = "unavailable";

    if (messaging.status === "unavailable" && !leads.ok) {
      return { byVa, status: unavailable(messaging.error || "GHL unavailable"), vaStatus };
    }

    const status = ok();
    if (messaging.error) status.error = messaging.error;
    return { byVa, status, vaStatus, metricStatus };
  },
};
