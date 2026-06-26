// purge-old-turnover-photos
//
// Privacy/retention sweep: deletes turnover & cleaner job photos older than 7
// days from Storage and blanks the now-dangling photo URL arrays on the rows.
// Hosts are told (in the portal) that photos are kept for 7 days — this is the
// job that enforces it. Idempotent; safe to run daily via pg_cron.
//
// Buckets purged: `turnover-photos`, `cleaner-job-photos`.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status });
}

// deno-lint-ignore no-explicit-any
type SB = any;

const RETENTION_DAYS = 7;
const BUCKETS = ["turnover-photos", "cleaner-job-photos"];
const log = (s: string, d?: unknown) => console.log(`[purge-photos] ${s}${d === undefined ? "" : " " + JSON.stringify(d)}`);

interface FileEntry { path: string; createdAt: number }

// Recursively walk a bucket and collect every file with its created timestamp.
async function listAllFiles(supabase: SB, bucket: string, prefix = ""): Promise<FileEntry[]> {
  const out: FileEntry[] = [];
  let offset = 0;
  const pageSize = 1000;
  // Guard against pathological recursion / runaway listings.
  for (let page = 0; page < 50; page++) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, {
      limit: pageSize,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) { log("list error", { bucket, prefix, error: error.message }); break; }
    const entries = (data || []) as Array<{ name: string; id: string | null; created_at?: string; updated_at?: string }>;
    if (entries.length === 0) break;
    for (const e of entries) {
      const full = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.id === null) {
        // Folder → recurse.
        const nested = await listAllFiles(supabase, bucket, full);
        out.push(...nested);
      } else {
        const ts = Date.parse(e.created_at || e.updated_at || "") || Date.now();
        out.push({ path: full, createdAt: ts });
      }
    }
    if (entries.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  try {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const cutoffIso = new Date(cutoff).toISOString();
    const summary: Record<string, number> = {};

    // 1) Delete expired files from each bucket.
    for (const bucket of BUCKETS) {
      const files = await listAllFiles(supabase, bucket);
      const expired = files.filter((f) => f.createdAt < cutoff).map((f) => f.path);
      let removed = 0;
      for (let i = 0; i < expired.length; i += 100) {
        const batch = expired.slice(i, i + 100);
        const { error } = await supabase.storage.from(bucket).remove(batch);
        if (error) { log("remove error", { bucket, error: error.message }); continue; }
        removed += batch.length;
      }
      summary[bucket] = removed;
      log("bucket purged", { bucket, scanned: files.length, removed });
    }

    // 2) Blank the dangling photo arrays so the app stops showing dead links.
    //    Bookings: completed/serviced before the cutoff.
    const { data: oldBookings } = await supabase
      .from("bookings")
      .select("id")
      .lt("service_date", cutoffIso.slice(0, 10))
      .limit(2000);
    let bookingsCleared = 0;
    for (const b of oldBookings || []) {
      await supabase.from("bookings").update({ before_photos: [], after_photos: [] }).eq("id", b.id);
      bookingsCleared++;
    }

    //    Turnover requests: requested before the cutoff.
    const { data: oldTurnovers } = await supabase
      .from("turnover_requests")
      .select("id")
      .lt("requested_date", cutoffIso.slice(0, 10))
      .limit(2000);
    let turnoversCleared = 0;
    for (const t of oldTurnovers || []) {
      await supabase.from("turnover_requests").update({ before_photos: [], after_photos: [] }).eq("id", t.id);
      turnoversCleared++;
    }

    log("done", { summary, bookingsCleared, turnoversCleared });
    return json({ ok: true, retentionDays: RETENTION_DAYS, removed: summary, bookingsCleared, turnoversCleared });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("ERROR", msg);
    return json({ error: msg }, 500);
  }
});
