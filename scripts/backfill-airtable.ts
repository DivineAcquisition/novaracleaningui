// ─── Backfill: push existing source records into Airtable (one-time, safe) ────
//
// Idempotent end-to-end seed. Every write upserts on a natural key
// (Email / Job ID / Run ID) so re-running never creates duplicates.
//
//   Run:  npm run airtable:backfill            # everything
//         npm run airtable:backfill -- clients  # one entity
//         npm run airtable:backfill -- jobs payroll
//
// Requires AIRTABLE_PAT, SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and
// SUPABASE_SERVICE_ROLE_KEY.

import { loadEnv } from "./_env";
import { getAdminSupabase } from "../src/lib/airtable/sources/admin-client";
import { ping } from "../src/lib/airtable/index";
import { syncClient } from "../src/lib/airtable/mappers/index";
import { ENTRY_SOURCE } from "../src/lib/airtable/schema";
import { bookingToClientInput } from "../src/lib/airtable/sources/supabase";
import {
  purgeStaleClients,
  purgeStaleJobs,
  syncAllPayrollRuns,
  syncClientById,
  syncJobByBookingId,
} from "../src/lib/airtable/sync";

const LIMIT = Number(process.env.AIRTABLE_BACKFILL_LIMIT || 1000);

async function backfillClients(): Promise<void> {
  const supabase = getAdminSupabase();
  const { data, error } = await supabase
    .from("bookings")
    .select(
      "id, email, customer_id, first_name, last_name, phone, city, state, zip_code, booking_channel, membership_plan, status",
    )
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  if (error) throw error;

  const seen = new Set<string>();
  const rows = data || [];
  console.log(`Clients: ${rows.length} completed bookings`);
  let ok = 0;
  for (const b of rows) {
    const email = String(b.email || "").trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    try {
      let recordId: string | null = null;
      if (b.customer_id) recordId = await syncClientById(String(b.customer_id));
      if (!recordId) {
        const input = bookingToClientInput(b);
        if (input) recordId = await syncClient(input);
      }
      if (recordId) ok++;
    } catch (err) {
      console.error(`  client ${email} failed: ${(err as Error).message}`);
    }
  }
  console.log(`Clients: ${ok} completed-booking clients upserted`);

  const purged = await purgeStaleClients();
  console.log(`Clients: kept ${purged.kept}, purged ${purged.deleted} non-completed rows`);
}

async function backfillJobs(): Promise<void> {
  const supabase = getAdminSupabase();
  const { data, error } = await supabase
    .from("bookings")
    .select("id")
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  if (error) throw error;
  const rows = data || [];
  console.log(`Jobs: ${rows.length} completed bookings`);

  let ok = 0;
  for (const b of rows) {
    try {
      // Pay figures come from custom payroll (`manual_payouts`).
      await syncJobByBookingId(b.id, { entrySource: ENTRY_SOURCE.backfill });
      ok++;
    } catch (err) {
      console.error(`  booking ${b.id} failed: ${(err as Error).message}`);
    }
  }
  console.log(`Jobs: ${ok}/${rows.length} upserted`);
  const purged = await purgeStaleJobs();
  console.log(`Jobs: kept ${purged.kept}, purged ${purged.deleted} non-completed rows`);
}

async function backfillPayroll(): Promise<void> {
  const count = await syncAllPayrollRuns(LIMIT);
  console.log(`Payroll Runs: ${count} upserted from custom payroll (stale extras-only runs purged)`);
}

async function main(): Promise<void> {
  loadEnv();
  const conn = await ping();
  if (!conn.ok) {
    console.error(`✗ Cannot reach Airtable: ${conn.message}`);
    process.exit(1);
  }
  console.log(`✓ ${conn.message}\n`);

  const args = process.argv.slice(2).map((a) => a.toLowerCase());
  const run = (name: string) => args.length === 0 || args.includes(name);

  if (run("clients")) await backfillClients();
  if (run("jobs")) await backfillJobs();
  if (run("payroll")) await backfillPayroll();

  console.log("\nBackfill complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
