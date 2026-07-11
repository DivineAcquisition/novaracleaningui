// qc-retention-purge
//
// 14-day photo retention for job documentation. Daily cron.
//
// Photos live in Supabase (fast, powers the UI) for 14 days after job
// completion, then are deleted from Storage + the booking row — but ONLY
// for jobs whose Google Drive mirror is CONFIRMED (mirror_status='mirrored').
// An unmirrored job's photos are never touched: Drive is the durable archive
// and nothing may be deleted before the archive copy exists.
//
// What gets purged per eligible job:
//   • Storage objects under bookings/{bookingId}/ in cleaner-job-photos
//   • bookings.before_photos / after_photos arrays (dead links otherwise)
//   • job_documentation.before_photos/after_photos are REPLACED with the
//     Drive folder reference so the QC console still links to the evidence.
//
// NOTE: cleaner-job-photos retention is owned exclusively by this function.
// (purge-old-turnover-photos used to blanket-purge that bucket at 7 days —
// it now only handles turnover-photos.)

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }, status,
  });
}
const log = (s: string, d?: unknown) =>
  console.log(`[qc-retention-purge] ${s}${d === undefined ? "" : " " + JSON.stringify(d)}`);

const RETENTION_DAYS = 14;
const BUCKET = "cleaner-job-photos";
const BATCH = 50;

// deno-lint-ignore no-explicit-any
type SB = any;

/** Recursively list every object under a prefix. */
async function listAll(supabase: SB, prefix: string): Promise<string[]> {
  const out: string[] = [];
  const { data, error } = await supabase.storage.from(BUCKET).list(prefix, { limit: 1000 });
  if (error || !data) return out;
  for (const e of data as Array<{ name: string; id: string | null }>) {
    const full = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.id === null) out.push(...await listAll(supabase, full));
    else out.push(full);
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
    const cutoffIso = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

    // Eligible: mirrored to Drive, completed > 14 days ago, not yet purged.
    const { data: docs, error } = await supabase
      .from("job_documentation")
      .select("id, booking_id, booking_ref, drive_folder_url")
      .eq("mirror_status", "mirrored")
      .is("photos_purged_at", null)
      .lt("completed_at", cutoffIso)
      .limit(BATCH);
    if (error) throw error;
    if (!docs || docs.length === 0) {
      log("nothing to purge");
      return json({ ok: true, purged: 0 });
    }

    let purged = 0, filesRemoved = 0;
    for (const doc of docs) {
      try {
        // 1) Storage objects for this booking.
        const files = await listAll(supabase, `bookings/${doc.booking_id}`);
        for (let i = 0; i < files.length; i += 100) {
          const batch = files.slice(i, i + 100);
          const { error: rmErr } = await supabase.storage.from(BUCKET).remove(batch);
          if (rmErr) throw new Error(`storage remove failed: ${rmErr.message}`);
          filesRemoved += batch.length;
        }

        // 2) Booking arrays (dead links otherwise).
        await supabase.from("bookings")
          .update({ before_photos: [], after_photos: [] })
          .eq("id", doc.booking_id);

        // 3) Documentation record: point at the Drive archive.
        const driveRef = doc.drive_folder_url ? [doc.drive_folder_url] : [];
        await supabase.from("job_documentation").update({
          before_photos: driveRef,
          after_photos: driveRef,
          photos_purged_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", doc.id);

        purged++;
        log("purged", { ref: doc.booking_ref, bookingId: doc.booking_id, files: files.length });
      } catch (e) {
        // Leave the row unpurged — next run retries. Never purge on error.
        log("purge failed (will retry)", {
          ref: doc.booking_ref,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return json({ ok: true, purged, filesRemoved, retentionDays: RETENTION_DAYS });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("ERROR", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
