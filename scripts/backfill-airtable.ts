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
import { customerToClientInput } from "../src/lib/airtable/sources/supabase";
import { syncAllPayrollRuns, syncJobByBookingId } from "../src/lib/airtable/sync";

const LIMIT = Number(process.env.AIRTABLE_BACKFILL_LIMIT || 1000);

async function backfillClients(): Promise<void> {
  const supabase = getAdminSupabase();
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  if (error) throw error;
  const rows = data || [];
  console.log(`Clients: ${rows.length} source rows`);
  let ok = 0;
  for (const c of rows) {
    try {
      await syncClient(customerToClientInput(c));
      ok++;
    } catch (err) {
      console.error(`  client ${c.email} failed: ${(err as Error).message}`);
    }
  }
  console.log(`Clients: ${ok}/${rows.length} upserted`);
}

async function backfillJobs(): Promise<void> {
  const supabase = getAdminSupabase();
  const { data, error } = await supabase
    .from("bookings")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  if (error) throw error;
  const rows = data || [];
  console.log(`Jobs: ${rows.length} source bookings`);

  let ok = 0;
  for (const b of rows) {
    try {
      // Route through the same ledger-aware sync the live webhook uses so the
      // pay figures always come from manual_payouts + job_extra_pay.
      await syncJobByBookingId(b.id, { entrySource: ENTRY_SOURCE.backfill });
      ok++;
    } catch (err) {
      console.error(`  booking ${b.id} failed: ${(err as Error).message}`);
    }
  }
  console.log(`Jobs: ${ok}/${rows.length} upserted`);
}

async function backfillPayroll(): Promise<void> {
  const count = await syncAllPayrollRuns(LIMIT);
  console.log(`Payroll Runs: ${count} upserted`);
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
