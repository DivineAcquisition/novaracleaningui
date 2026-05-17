// ─── reconcile-ghl ───────────────────────────────────────────────────────
// Safety-net cron that runs every 5 minutes (scheduled in pg_cron).
// Finds bookings whose GHL sync is stale or never happened and
// re-fires send-zapier-webhook for each. Three "needs sync" signals:
//
//   1. ghl_synced_at IS NULL                   — never been synced
//   2. ghl_synced_at < updated_at - grace      — stale (booking has been
//                                                modified since last sync)
//   3. ghl_sync_error IS NOT NULL              — last sync failed
//
// Caps each run to a small batch so we don't hammer GHL during a
// backlog spike. Subsequent cron ticks pick up the rest.
//
// Always returns 200 + a summary so pg_cron doesn't log spurious errors.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const log = (step: string, details?: unknown) => {
  console.log(`[RECONCILE-GHL] ${step}`, details ? JSON.stringify(details) : "");
};

// Tunables — keep small so a single run never DDoSes GHL.
// 10 per pass × 4 concurrent → ~10-15s wall time, well under the
// 150s edge-function idle-timeout. Cron runs every 5 minutes so
// even a 100-row backlog clears in well under an hour.
const BATCH_SIZE = 10;
const CONCURRENCY = 4;
const STALE_GRACE_SECONDS = 60;     // mark stale once updated_at is >60s newer than ghl_synced_at
const LOOKBACK_HOURS = 24 * 7;      // never reconcile bookings older than this (avoids backfilling history forever)
const MAX_ATTEMPTS = 5;              // give up after 5 failed attempts on a row to avoid hot-loops

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const cutoff = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();

  // Bookings needing a refresh. Sorted oldest-stale first so anything
  // that's been waiting the longest gets caught up first.
  // Note: We can't use OR'd column comparisons easily in postgrest,
  // so we union three quick queries via .or() with a synthetic
  // "never synced or stale or errored" filter.
  const { data: rows, error } = await supabase
    .from("bookings")
    .select("id, ghl_synced_at, ghl_sync_attempts, ghl_sync_error, updated_at, email")
    .or(
      // never synced
      "ghl_synced_at.is.null," +
      // last attempt errored (and not over the attempt cap)
      "ghl_sync_error.not.is.null",
    )
    .lt("ghl_sync_attempts", MAX_ATTEMPTS)
    .gt("updated_at", cutoff)
    .order("updated_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (error) {
    log("query failed", { error: error.message });
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Also pick up "stale" rows in a second query — postgrest can't
  // express column-to-column comparison (updated_at > ghl_synced_at)
  // in a single .or() expression, so we run a focused RPC-style
  // raw select via the .rpc('').select() trick. Simpler: do a second
  // fetch and merge by id.
  const { data: staleRows } = await supabase
    .from("bookings")
    .select("id, ghl_synced_at, ghl_sync_attempts, ghl_sync_error, updated_at, email")
    .not("ghl_synced_at", "is", null)
    .lt("ghl_sync_attempts", MAX_ATTEMPTS)
    .gt("updated_at", cutoff)
    .order("updated_at", { ascending: true })
    .limit(BATCH_SIZE * 2);

  const candidates = new Map<string, typeof rows[number]>();
  for (const r of rows || []) candidates.set(r.id, r);
  for (const r of staleRows || []) {
    // Stale = updated_at is more than STALE_GRACE_SECONDS newer than the last sync
    const synced = r.ghl_synced_at ? new Date(r.ghl_synced_at).getTime() : 0;
    const updated = r.updated_at ? new Date(r.updated_at).getTime() : 0;
    if (updated > synced + STALE_GRACE_SECONDS * 1000) {
      candidates.set(r.id, r);
    }
  }

  const batch = Array.from(candidates.values()).slice(0, BATCH_SIZE);
  log("candidates", { count: batch.length, lookbackHours: LOOKBACK_HOURS });

  let succeeded = 0;
  let failed = 0;

  // Process the batch in CONCURRENCY-sized waves so GHL sees a
  // steady trickle instead of a thundering herd. Each row's sync
  // is independent — no shared mutation between waves.
  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    const wave = batch.slice(i, i + CONCURRENCY);
    await Promise.all(wave.map(async (row) => {
      try {
        const { error: invokeErr } = await supabase.functions.invoke(
          "send-zapier-webhook",
          { body: { bookingId: row.id, source: "reconcile_cron" } },
        );
        if (invokeErr) throw new Error(invokeErr.message || String(invokeErr));
        succeeded += 1;
        try {
          await supabase.from("ghl_sync_log").insert({
            booking_id: row.id,
            source: "reconcile_cron",
            trigger_op: "RECONCILE",
            succeeded: true,
            http_status: 200,
          });
        } catch (_) { /* best effort */ }
      } catch (err) {
        failed += 1;
        const errMsg = err instanceof Error ? err.message : String(err);
        log("invoke failed", { bookingId: row.id, error: errMsg });
        try {
          await supabase
            .from("bookings")
            .update({
              ghl_sync_attempts: (row.ghl_sync_attempts || 0) + 1,
              ghl_sync_error: errMsg.slice(0, 500),
            })
            .eq("id", row.id);
          await supabase.from("ghl_sync_log").insert({
            booking_id: row.id,
            source: "reconcile_cron",
            trigger_op: "RECONCILE",
            succeeded: false,
            error_message: errMsg.slice(0, 500),
          });
        } catch (_) { /* best effort */ }
      }
    }));
  }

  log("done", { batchSize: batch.length, succeeded, failed });
  return new Response(
    JSON.stringify({
      ok: true,
      batch_size: batch.length,
      succeeded,
      failed,
      lookback_hours: LOOKBACK_HOURS,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
