// ─── POST /api/airtable/webhook ───────────────────────────────────────────────
//
// Receiver for Airtable webhook notification pings — the "Airtable changed
// something" doorbell. Airtable POSTs { base: {id}, webhook: {id}, timestamp }
// signed with the webhook's MAC secret; we verify the signature, then pull the
// actual change payloads from the cursor we last acknowledged and process them
// (freshness marker + conflict/unmapped/deletion review flags).
//
// Auth is the HMAC itself (X-Airtable-Content-MAC) — no session, no shared
// secret in the URL. Unknown or unverifiable pings are rejected.
//
// At-least-once safe: if a ping races the 5-minute poll cron, both consume the
// same cursor window idempotently (flags dedupe, marker bumps are monotonic).

import { NextResponse } from "next/server";

import {
  getWebhookState,
  processWebhookPayloads,
  verifyWebhookMac,
} from "@/lib/airtable/inbound";
import { primeAirtablePat } from "@/lib/airtable/sources/prime-pat";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { logSyncRun } from "@/lib/airtable/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface PingBody {
  base?: { id?: string };
  webhook?: { id?: string };
  timestamp?: string;
}

export async function POST(req: Request): Promise<NextResponse> {
  const rawBody = await req.text();

  let ping: PingBody;
  try {
    ping = JSON.parse(rawBody) as PingBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const webhookId = ping.webhook?.id;
  if (!webhookId) return NextResponse.json({ error: "Missing webhook id" }, { status: 400 });

  const state = await getWebhookState(webhookId);
  if (!state) {
    // A webhook we didn't register (or whose secret we lost) — refuse it; the
    // daily ensure pass replaces orphaned registrations.
    return NextResponse.json({ error: "Unknown webhook" }, { status: 404 });
  }

  const mac = req.headers.get("x-airtable-content-mac") || "";
  if (!verifyWebhookMac(rawBody, mac, state.mac_secret_b64)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    await primeAirtablePat();
    await getAdminSupabase()
      .from("airtable_webhook_state")
      .update({ last_ping_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", state.id);

    const result = await processWebhookPayloads(state);
    await logSyncRun({
      flow: "inbound",
      direction: "inbound",
      trigger: "webhook",
      status: "success",
      records: result.payloads,
      detail: {
        changedTables: result.changedTables,
        conflicts: result.conflicts,
        flagged: result.flagged,
      },
      startedAt,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    await logSyncRun({
      flow: "inbound",
      direction: "inbound",
      trigger: "webhook",
      status: "error",
      error: (err as Error).message,
      startedAt,
    });
    // eslint-disable-next-line no-console
    console.error("[airtable-webhook]", (err as Error).message);
    // Non-200 → Airtable retries the ping; the cursor wasn't advanced past
    // anything unprocessed, so nothing is lost.
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
