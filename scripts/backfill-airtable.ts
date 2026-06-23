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
import { syncClient, syncJob } from "../src/lib/airtable/mappers/index";
import { ENTRY_SOURCE } from "../src/lib/airtable/schema";
import {
  bookingToClientInput,
  bookingToJobInput,
  customerToClientInput,
  type CleanerRow,
} from "../src/lib/airtable/sources/supabase";
import { syncAllPayrollRuns } from "../src/lib/airtable/sync";

const LIMIT = Number(process.env.AIRTABLE_BACKFILL_LIMIT || 1000);
const ASSIGNMENT_STATUSES = ["Confirmed", "Accepted", "accepted", "In Progress", "Completed"];

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
    .select(
      "id, booking_number, status, service_type, service_date, completed_at, email, first_name, last_name, phone, city, state, zip_code, final_charge_cents, total_estimate_cents, cleaner_payout_cents, num_cleaners_assigned, booking_channel, membership_plan, job_id",
    )
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  if (error) throw error;
  const rows = data || [];
  console.log(`Jobs: ${rows.length} source bookings`);

  // Preload assignments + cleaners for all jobs in one pass.
  const jobIds = Array.from(new Set(rows.map((b) => b.job_id).filter(Boolean))) as string[];
  const cleanersByJob = new Map<string, CleanerRow[]>();
  if (jobIds.length) {
    const { data: assigns } = await supabase
      .from("job_assignments")
      .select("job_id, cleaner_id, status")
      .in("job_id", jobIds)
      .in("status", ASSIGNMENT_STATUSES);
    const cleanerIds = Array.from(new Set((assigns || []).map((a) => a.cleaner_id).filter(Boolean))) as string[];
    const cleanerById = new Map<string, CleanerRow>();
    if (cleanerIds.length) {
      const { data: cleaners } = await supabase
        .from("cleaners")
        .select("id, first_name, last_name, pay_tier, pay_percentage")
        .in("id", cleanerIds);
      for (const c of cleaners || []) cleanerById.set(c.id, c as CleanerRow);
    }
    for (const a of assigns || []) {
      if (!a.job_id || !a.cleaner_id) continue;
      const list = cleanersByJob.get(a.job_id) || [];
      const cleaner = cleanerById.get(a.cleaner_id);
      if (cleaner) list.push(cleaner);
      cleanersByJob.set(a.job_id, list);
    }
  }

  let ok = 0;
  for (const b of rows) {
    try {
      // Ensure a Client exists for this booking's email so the Job→Client link
      // resolves even for emails not present in the customers table.
      const clientInput = bookingToClientInput(b);
      if (clientInput) await syncClient(clientInput).catch(() => null);

      const cleaners = b.job_id ? cleanersByJob.get(b.job_id) || [] : [];
      await syncJob(bookingToJobInput(b, cleaners, { entrySource: ENTRY_SOURCE.backfill }));
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
