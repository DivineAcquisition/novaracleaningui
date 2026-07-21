// ─── POST /api/airtable/sync-worker ───────────────────────────────────────────
//
// The single drainer of the airtable_sync_queue outbox — the engine that makes
// the Airtable sync live AND reliable:
//
//   • DB triggers enqueue + nudge this route the moment source data changes
//     (near-real-time), and a 1-minute pg_cron catch-up drains anything a
//     nudge missed plus all backoff retries. If Airtable is down, items simply
//     wait; catch-up replays are idempotent upserts (no doubles, no re-fired
//     side effects).
//   • A DB-side worker lease keeps ONE drainer active at a time, so the
//     rate-limit queue in the Airtable client is the true global limiter
//     (never past 5 req/s/base). Items are claimed atomically; a crashed
//     worker's claims are reclaimed by the watchdog.
//   • Every pass is logged to airtable_sync_runs / flow state (the /admin/sync
//     health view), and repeated failures alert admins via the events bus.
//
// Tasks (body {task} or ?task=):
//   drain          — claim + process due queue items (default)
//   reconcile      — enqueue the full reconcile set, then drain
//   poll-inbound   — fetch Airtable webhook payloads (or poll fallback)
//   ensure-webhook — register/refresh the Airtable→app webhook
//
// Auth: shared secret in `x-airtable-sync-secret` (or ?secret=), same as
// /api/airtable/sync — resolved from env or app_secrets.

import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

import { runFlow, FlowPermanentError, type FlowPayload } from "@/lib/airtable/flows";
import {
  ensureWebhook,
  getWebhookState,
  pollInboundFallback,
  processWebhookPayloads,
} from "@/lib/airtable/inbound";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { primeAirtablePat } from "@/lib/airtable/sources/prime-pat";
import {
  flagForReview,
  installAirtableReviewHooks,
  logSyncRun,
  type SyncTrigger,
} from "@/lib/airtable/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Leave headroom under maxDuration so an in-flight item can finish + report.
const DRAIN_BUDGET_MS = 45_000;
const CLAIM_BATCH = 5;
const LEASE_SECONDS = 120;

interface QueueItem {
  id: number;
  flow: string;
  entity_id: string | null;
  payload: FlowPayload | null;
  source: string;
  attempts: number;
}

async function resolveSyncSecret(): Promise<string> {
  const fromEnv = (process.env.AIRTABLE_SYNC_WEBHOOK_SECRET || "").trim();
  if (fromEnv) return fromEnv;
  try {
    const { data } = await getAdminSupabase()
      .from("app_secrets")
      .select("value")
      .eq("key", "AIRTABLE_SYNC_WEBHOOK_SECRET")
      .maybeSingle();
    return (data?.value || "").trim();
  } catch {
    return "";
  }
}

async function authorized(req: Request): Promise<boolean> {
  const expected = await resolveSyncSecret();
  if (!expected) return false; // closed by default until configured
  const header = req.headers.get("x-airtable-sync-secret");
  const query = new URL(req.url).searchParams.get("secret");
  return header === expected || query === expected;
}

function triggerFor(source: string): SyncTrigger {
  return source === "reconcile" ? "reconcile" : source === "manual" ? "manual" : "live";
}

async function drainQueue(): Promise<{
  processed: number;
  failed: number;
  skipped: number;
  leaseHeldElsewhere: boolean;
}> {
  const supabase = getAdminSupabase();
  const workerId = randomUUID();
  const deadline = Date.now() + DRAIN_BUDGET_MS;
  let processed = 0;
  let failed = 0;
  let skipped = 0;
  let claimedAnything = false;

  try {
    while (Date.now() < deadline) {
      const { data: items, error } = await supabase.rpc("airtable_claim_queue", {
        p_worker: workerId,
        p_batch: CLAIM_BATCH,
        p_lease_seconds: LEASE_SECONDS,
      });
      if (error) throw new Error(`claim failed: ${error.message}`);
      const claimed = (items || []) as QueueItem[];
      if (claimed.length === 0) break;
      claimedAnything = true;

      for (const item of claimed) {
        const startedAt = Date.now();
        try {
          const result = await runFlow(item.flow, item.payload || {});
          await supabase.rpc("airtable_complete_queue", { p_id: item.id, p_ok: true });
          await logSyncRun({
            flow: item.flow,
            trigger: triggerFor(item.source),
            status: result.status === "skipped" ? "skipped" : "success",
            records: result.records,
            detail: { ...result.detail, entityId: item.entity_id },
            startedAt,
          });
          if (result.status === "skipped") skipped += 1;
          else processed += 1;
        } catch (err) {
          const message = (err as Error).message || "unknown error";
          const permanent = err instanceof FlowPermanentError;
          await supabase.rpc("airtable_complete_queue", {
            p_id: item.id,
            p_ok: false,
            p_error: message,
            p_permanent: permanent,
          });
          await logSyncRun({
            flow: item.flow,
            trigger: triggerFor(item.source),
            status: "error",
            error: message,
            detail: { entityId: item.entity_id, attempts: item.attempts, permanent },
            startedAt,
          });
          // Exhausted retries → the item is dead; make sure a human sees it.
          if (!permanent && item.attempts >= 8) {
            await flagForReview({
              flow: item.flow,
              reason: "error",
              recordRef: item.entity_id || undefined,
              message: `Sync gave up after ${item.attempts} attempts: ${message.slice(0, 300)}. Fix the cause, then retry it from the Sync Health view.`,
            });
          }
          failed += 1;
        }
        if (Date.now() >= deadline) break;
      }
    }
  } finally {
    await supabase.rpc("airtable_release_worker_lease", { p_worker: workerId }).then(
      () => undefined,
      () => undefined,
    );
  }

  return { processed, failed, skipped, leaseHeldElsewhere: !claimedAnything };
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!(await authorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { task?: string } = {};
  try {
    body = (await req.json()) as { task?: string };
  } catch {
    /* task may come from the query string */
  }
  const task = (body.task || new URL(req.url).searchParams.get("task") || "drain").trim();

  await primeAirtablePat();
  installAirtableReviewHooks();

  try {
    switch (task) {
      case "drain": {
        const result = await drainQueue();
        return NextResponse.json({ ok: true, task, ...result });
      }

      case "reconcile": {
        const supabase = getAdminSupabase();
        const { data: enqueued, error } = await supabase.rpc("airtable_enqueue_reconcile");
        if (error) throw new Error(`reconcile enqueue failed: ${error.message}`);
        // Start draining immediately; the 1-minute cron finishes the backlog.
        const result = await drainQueue();
        return NextResponse.json({ ok: true, task, enqueued, ...result });
      }

      case "poll-inbound": {
        const startedAt = Date.now();
        try {
          const state = await getWebhookState();
          if (state) {
            const result = await processWebhookPayloads(state);
            await logSyncRun({
              flow: "inbound",
              direction: "inbound",
              trigger: "poll",
              status: "success",
              records: result.payloads,
              detail: {
                mode: "webhook",
                changedTables: result.changedTables,
                conflicts: result.conflicts,
                flagged: result.flagged,
              },
              startedAt,
            });
            return NextResponse.json({ ok: true, task, mode: "webhook", ...result });
          }
          const result = await pollInboundFallback();
          await logSyncRun({
            flow: "inbound",
            direction: "inbound",
            trigger: "poll",
            status: "success",
            records: result.tables.length,
            detail: { mode: "poll", changedTables: result.tables },
            startedAt,
          });
          return NextResponse.json({ ok: true, task, mode: "poll", ...result });
        } catch (err) {
          await logSyncRun({
            flow: "inbound",
            direction: "inbound",
            trigger: "poll",
            status: "error",
            error: (err as Error).message,
            startedAt,
          });
          throw err;
        }
      }

      case "ensure-webhook": {
        const startedAt = Date.now();
        const result = await ensureWebhook();
        await logSyncRun({
          flow: "inbound",
          direction: "inbound",
          trigger: "manual",
          status: result.ok ? "success" : "error",
          error: result.ok ? undefined : result.message,
          detail: { mode: result.mode, webhookId: result.webhookId, expirationTime: result.expirationTime },
          startedAt,
        });
        return NextResponse.json({ ok: result.ok, task, ...result });
      }

      default:
        return NextResponse.json({ error: `Unknown task: ${task}` }, { status: 400 });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[airtable-sync-worker]", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
