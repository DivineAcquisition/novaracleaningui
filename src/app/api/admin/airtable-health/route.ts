// ─── /api/admin/airtable-health ───────────────────────────────────────────────
//
// Backs the /admin/sync "Sync Health" view. Admin/VA gated.
//
// GET  → one snapshot: per-flow state (last success, consecutive failures),
//        queue depth (pending / processing / dead / done-24h), recent runs,
//        open review flags, and the inbound (Airtable→app) channel status.
// POST → admin actions:
//        { action: "resolve_flag", id }        mark a review flag handled
//        { action: "retry_flow", flow }        enqueue an immediate re-sync
//        { action: "retry_dead", flow? }       revive dead queue items
//        { action: "reconcile" }               full reconcile through the queue
//        { action: "ensure_webhook" }          (re)register the inbound webhook
//        { action: "poll_inbound" }            pull remote changes right now

import { NextResponse } from "next/server";

import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { FLOW_NAMES } from "@/lib/airtable/flows";
import {
  ensureWebhook,
  getWebhookState,
  pollInboundFallback,
  processWebhookPayloads,
} from "@/lib/airtable/inbound";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { primeAirtablePat } from "@/lib/airtable/sources/prime-pat";
import { logSyncRun } from "@/lib/airtable/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  try {
    await requireAdmin(req);
  } catch (err) {
    const e = err as AdminAuthError;
    return NextResponse.json({ error: e.message }, { status: e.status || 401 });
  }

  try {
    const supabase = getAdminSupabase();
    const [flowsRes, statsRes, runsRes, flagsRes, webhookRes] = await Promise.all([
      supabase.from("airtable_sync_flow_state").select("*").order("flow"),
      supabase.rpc("airtable_queue_stats"),
      supabase
        .from("airtable_sync_runs")
        .select("id, flow, direction, trigger_source, status, records_synced, error, started_at, duration_ms")
        .order("started_at", { ascending: false })
        .limit(60),
      supabase
        .from("airtable_review_flags")
        .select("id, flow, reason, record_ref, airtable_table, field_ref, message, seen_count, first_seen_at, last_seen_at, status")
        .eq("status", "open")
        .order("last_seen_at", { ascending: false })
        .limit(100),
      supabase
        .from("airtable_webhook_state")
        .select("id, base_id, cursor_position, notification_url, expiration_time, last_ping_at, last_payload_at")
        .order("updated_at", { ascending: false })
        .limit(1),
    ]);

    const queueByFlow: Record<
      string,
      { pending: number; processing: number; dead: number; done24h: number; oldestPending: string | null }
    > = {};
    for (const row of (statsRes.data || []) as { flow: string; status: string; n: number; oldest: string | null }[]) {
      const bucket = (queueByFlow[row.flow] ||= {
        pending: 0,
        processing: 0,
        dead: 0,
        done24h: 0,
        oldestPending: null,
      });
      if (row.status === "pending") {
        bucket.pending = Number(row.n);
        bucket.oldestPending = row.oldest;
      } else if (row.status === "processing") bucket.processing = Number(row.n);
      else if (row.status === "dead") bucket.dead = Number(row.n);
      else if (row.status === "done") bucket.done24h = Number(row.n);
    }

    const webhook = webhookRes.data?.[0] || null;

    return NextResponse.json({
      ok: true,
      now: new Date().toISOString(),
      flows: flowsRes.data || [],
      queueByFlow,
      runs: runsRes.data || [],
      flags: flagsRes.data || [],
      inbound: {
        mode: webhook ? "webhook" : "poll",
        webhookId: webhook?.id || null,
        notificationUrl: webhook?.notification_url || null,
        expirationTime: webhook?.expiration_time || null,
        lastPingAt: webhook?.last_ping_at || null,
        lastPayloadAt: webhook?.last_payload_at || null,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[airtable-health GET]", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

interface ActionBody {
  action?: string;
  id?: string;
  flow?: string;
}

export async function POST(req: Request): Promise<NextResponse> {
  let principal;
  try {
    principal = await requireAdmin(req);
  } catch (err) {
    const e = err as AdminAuthError;
    return NextResponse.json({ error: e.message }, { status: e.status || 401 });
  }

  let body: ActionBody;
  try {
    body = (await req.json()) as ActionBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const supabase = getAdminSupabase();

  try {
    switch (body.action) {
      case "resolve_flag": {
        if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
        const { error } = await supabase
          .from("airtable_review_flags")
          .update({
            status: "resolved",
            resolved_by: principal.email,
            resolved_at: new Date().toISOString(),
          })
          .eq("id", body.id);
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true });
      }

      case "retry_flow": {
        const flow = String(body.flow || "");
        if (!FLOW_NAMES.includes(flow as (typeof FLOW_NAMES)[number])) {
          return NextResponse.json({ error: `Unknown flow: ${flow}` }, { status: 400 });
        }
        // Per-record flows re-sync via full reconcile; whole-flow ones enqueue directly.
        if (flow === "client" || flow === "job" || flow === "qc_issue" || flow === "turnover") {
          return NextResponse.json(
            { error: `"${flow}" is per-record — use "Run full re-sync" to replay it.` },
            { status: 400 },
          );
        }
        const { error } = await supabase.rpc("airtable_enqueue", {
          p_flow: flow,
          p_entity: null,
          p_payload: {},
          p_nudge: true,
          p_source: "manual",
        });
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true, enqueued: flow });
      }

      case "retry_dead": {
        let query = supabase
          .from("airtable_sync_queue")
          .update({
            status: "pending",
            attempts: 0,
            next_attempt_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("status", "dead");
        if (body.flow) query = query.eq("flow", body.flow);
        const { error } = await query;
        if (error) throw new Error(error.message);
        await supabase.rpc("airtable_nudge_worker", { p_task: "drain" }).then(
          () => undefined,
          () => undefined,
        );
        return NextResponse.json({ ok: true });
      }

      case "reconcile": {
        const { data, error } = await supabase.rpc("airtable_enqueue_reconcile");
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true, enqueued: data });
      }

      case "ensure_webhook": {
        await primeAirtablePat();
        const result = await ensureWebhook();
        return NextResponse.json({ ok: result.ok, ...result });
      }

      case "poll_inbound": {
        await primeAirtablePat();
        const startedAt = Date.now();
        const state = await getWebhookState();
        const result = state ? await processWebhookPayloads(state) : await pollInboundFallback();
        await logSyncRun({
          flow: "inbound",
          direction: "inbound",
          trigger: "manual",
          status: "success",
          detail: { mode: state ? "webhook" : "poll" },
          startedAt,
        });
        return NextResponse.json({ ok: true, mode: state ? "webhook" : "poll", result });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[airtable-health POST]", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
