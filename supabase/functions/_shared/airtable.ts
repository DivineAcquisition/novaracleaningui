// ─── Airtable mirror ────────────────────────────────────────────────────────
//
// Sends Novara operational data to Airtable so it can act as a secondary
// "insight" database. Fire-and-forget and fully gated: if the Airtable
// credentials aren't configured it no-ops (mirrors the GHL/Stripe pattern),
// so wiring these calls in never risks breaking the primary flow.
//
// Configure via public.app_secrets (or Edge Function env):
//   AIRTABLE_API_KEY      Personal Access Token (pat…) with data.records:write
//   AIRTABLE_BASE_ID      Base id (app…)
//   AIRTABLE_JOBS_TABLE   Table name for job data    (default "Jobs")
//   AIRTABLE_PAYROLL_TABLE Table name for payroll     (default "Payroll")
//
// Upserts use Airtable's native PATCH performUpsert so re-syncing the same
// record updates the existing row instead of creating duplicates. The merge
// fields ("Booking ID" / "Payout ID") must exist in the Airtable tables.

import { resolveSecret } from "./app-secrets.ts";

const AIRTABLE_API = "https://api.airtable.com/v0";

// deno-lint-ignore no-explicit-any
type SupabaseLike = any;

interface AirtableConfig {
  apiKey: string;
  baseId: string;
}

const log = (s: string, d?: unknown) =>
  console.log(`[AIRTABLE] ${s}${d === undefined ? "" : " " + JSON.stringify(d)}`);

async function getConfig(supabase: SupabaseLike): Promise<AirtableConfig | null> {
  // Accept either key name so the PAT can live under AIRTABLE_API_KEY or
  // AIRTABLE_PAT (the name the Next.js side uses) — single token, one place.
  const apiKey = (await resolveSecret(supabase, "AIRTABLE_API_KEY")) ||
    (await resolveSecret(supabase, "AIRTABLE_PAT"));
  const baseId = (await resolveSecret(supabase, "AIRTABLE_BASE_ID")) ||
    (await resolveSecret(supabase, "AIRTABLE_REVENUE_OPS_BASE_ID"));
  if (!apiKey || !baseId) return null;
  return { apiKey, baseId };
}

export async function airtableIsConfigured(supabase: SupabaseLike): Promise<boolean> {
  return (await getConfig(supabase)) !== null;
}

/**
 * Validate the Airtable credentials by listing one record from the Jobs
 * table. Surfaces a clear message for the admin setup screen / backfill.
 */
export async function airtablePing(
  supabase: SupabaseLike,
): Promise<{ ok: boolean; configured: boolean; status?: number; message: string; jobsTable: string; payrollTable: string }> {
  const jobsTable = (await resolveSecret(supabase, "AIRTABLE_JOBS_TABLE")) || "Jobs";
  const payrollTable = (await resolveSecret(supabase, "AIRTABLE_PAYROLL_TABLE")) || "Payroll";
  const cfg = await getConfig(supabase);
  if (!cfg) {
    return {
      ok: false,
      configured: false,
      message: "Airtable token (AIRTABLE_API_KEY / AIRTABLE_PAT) and/or base id (AIRTABLE_BASE_ID) are not set.",
      jobsTable,
      payrollTable,
    };
  }
  try {
    const url = `${AIRTABLE_API}/${cfg.baseId}/${encodeURIComponent(jobsTable)}?maxRecords=1`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${cfg.apiKey}` } });
    if (res.ok) {
      return { ok: true, configured: true, status: res.status, message: "Connected to Airtable.", jobsTable, payrollTable };
    }
    const body = await res.text().catch(() => "");
    return {
      ok: false,
      configured: true,
      status: res.status,
      message: `Airtable returned ${res.status}. Check the base id, table name "${jobsTable}", and token scopes. ${body.slice(0, 200)}`,
      jobsTable,
      payrollTable,
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      message: err instanceof Error ? err.message : String(err),
      jobsTable,
      payrollTable,
    };
  }
}

const cents = (c: number | null | undefined): number =>
  c == null ? 0 : Math.round(Number(c)) / 100;

const WINDOW_LABELS: Record<string, string> = {
  "8-12": "8:00 AM – 12:00 PM",
  "12-16": "12:00 PM – 4:00 PM",
  "16-20": "4:00 PM – 8:00 PM",
};
const windowLabel = (slot?: string | null): string =>
  !slot ? "" : (WINDOW_LABELS[slot] || slot);

/**
 * Upsert one record into an Airtable table, merging on `mergeField`.
 * Returns true on 2xx. Never throws.
 */
async function upsert(
  cfg: AirtableConfig,
  table: string,
  mergeField: string,
  fields: Record<string, unknown>,
): Promise<boolean> {
  // Drop undefined/null so we never overwrite a populated Airtable cell with blank.
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null && v !== "") clean[k] = v;
  }
  if (clean[mergeField] === undefined) {
    log("upsert skipped — missing merge field value", { table, mergeField });
    return false;
  }
  const url = `${AIRTABLE_API}/${cfg.baseId}/${encodeURIComponent(table)}`;
  try {
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        performUpsert: { fieldsToMergeOn: [mergeField] },
        typecast: true,
        records: [{ fields: clean }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log("upsert failed", { table, status: res.status, body: body.slice(0, 300) });
      return false;
    }
    log("upsert ok", { table, mergeField, key: clean[mergeField] });
    return true;
  } catch (err) {
    log("upsert error", { table, error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/**
 * Mirror a booking/job into the Airtable "Jobs" table. Pulls the booking,
 * its linked dispatch job, and assigned cleaners. Keyed on "Booking ID".
 * Never throws.
 */
export async function syncJobToAirtable(
  supabase: SupabaseLike,
  bookingId: string,
): Promise<boolean> {
  try {
    const cfg = await getConfig(supabase);
    if (!cfg || !bookingId) return false;
    const table = (await resolveSecret(supabase, "AIRTABLE_JOBS_TABLE")) || "Jobs";

    const { data: b } = await supabase
      .from("bookings")
      .select(
        "id, booking_number, status, service_type, service_date, time_slot, arrival_window, first_name, last_name, email, phone, address, city, state, zip_code, total_estimate_cents, deposit_cents, final_charge_cents, cleaner_payout_cents, payout_status, num_cleaners_assigned, booking_channel, membership_plan, job_id, created_at",
      )
      .eq("id", bookingId)
      .maybeSingle();
    if (!b) return false;

    // Assigned cleaners (names) for the linked job, if any.
    let cleanerNames = "";
    let jobStatus: string | null = null;
    if (b.job_id) {
      const { data: job } = await supabase
        .from("jobs")
        .select("status")
        .eq("id", b.job_id)
        .maybeSingle();
      jobStatus = job?.status ?? null;

      const { data: assigns } = await supabase
        .from("job_assignments")
        .select("cleaner_id, status")
        .eq("job_id", b.job_id)
        .in("status", ["Confirmed", "Accepted", "accepted", "In Progress", "Completed"]);
      const ids = Array.from(
        new Set((assigns || []).map((a: { cleaner_id: string | null }) => a.cleaner_id).filter(Boolean)),
      ) as string[];
      if (ids.length > 0) {
        const { data: cleaners } = await supabase
          .from("cleaners")
          .select("id, first_name, last_name")
          .in("id", ids);
        cleanerNames = (cleaners || [])
          .map((c: { first_name: string | null; last_name: string | null }) =>
            `${c.first_name || ""} ${c.last_name || ""}`.trim(),
          )
          .filter(Boolean)
          .join(", ");
      }
    }

    const bookingNumber = b.booking_number
      ? `NOV-${String(b.booking_number).padStart(5, "0")}`
      : null;

    const fields: Record<string, unknown> = {
      "Booking ID": b.id,
      "Booking #": bookingNumber,
      "Status": b.status,
      "Job Status": jobStatus,
      "Service Type": b.service_type,
      "Service Date": b.service_date,
      "Arrival Window": windowLabel(b.time_slot || b.arrival_window),
      "Customer": `${b.first_name || ""} ${b.last_name || ""}`.trim(),
      "Email": b.email,
      "Phone": b.phone,
      "Address": b.address,
      "City": b.city,
      "State": b.state,
      "ZIP": b.zip_code,
      "Total $": cents(b.final_charge_cents || b.total_estimate_cents),
      "Deposit $": cents(b.deposit_cents),
      "Cleaner Payout $": cents(b.cleaner_payout_cents),
      "Cleaners Assigned": cleanerNames,
      "# Cleaners": b.num_cleaners_assigned ?? undefined,
      "Payout Status": b.payout_status,
      "Membership": b.membership_plan && b.membership_plan !== "none" ? b.membership_plan : "",
      "Channel": b.booking_channel,
      "Created At": b.created_at,
      "Synced At": new Date().toISOString(),
    };

    return await upsert(cfg, table, "Booking ID", fields);
  } catch (err) {
    log("syncJobToAirtable error", { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/**
 * Mirror a payout into the Airtable "Payroll" table. Pulls the payout, its
 * booking, and the cleaner. Keyed on "Payout ID". Never throws.
 */
export async function syncPayoutToAirtable(
  supabase: SupabaseLike,
  payoutId: string,
): Promise<boolean> {
  try {
    const cfg = await getConfig(supabase);
    if (!cfg || !payoutId) return false;
    const table = (await resolveSecret(supabase, "AIRTABLE_PAYROLL_TABLE")) || "Payroll";

    const { data: p } = await supabase
      .from("payouts")
      .select(
        "id, booking_id, cleaner_id, total_booking_amount_cents, platform_fee_cents, cleaner_payout_cents, stripe_transfer_id, stripe_account_id, status, processed_at, created_at, notes",
      )
      .eq("id", payoutId)
      .maybeSingle();
    if (!p) return false;

    let cleanerName = "";
    let cleanerEmail: string | null = null;
    let payTier: string | null = null;
    if (p.cleaner_id) {
      const { data: c } = await supabase
        .from("cleaners")
        .select("first_name, last_name, email, pay_tier")
        .eq("id", p.cleaner_id)
        .maybeSingle();
      if (c) {
        cleanerName = `${c.first_name || ""} ${c.last_name || ""}`.trim();
        cleanerEmail = c.email ?? null;
        payTier = c.pay_tier ?? null;
      }
    }

    let bookingNumber: string | null = null;
    let serviceDate: string | null = null;
    let serviceType: string | null = null;
    if (p.booking_id) {
      const { data: b } = await supabase
        .from("bookings")
        .select("booking_number, service_date, service_type")
        .eq("id", p.booking_id)
        .maybeSingle();
      if (b) {
        bookingNumber = b.booking_number
          ? `NOV-${String(b.booking_number).padStart(5, "0")}`
          : null;
        serviceDate = b.service_date ?? null;
        serviceType = b.service_type ?? null;
      }
    }

    const fields: Record<string, unknown> = {
      "Payout ID": p.id,
      "Booking ID": p.booking_id,
      "Booking #": bookingNumber,
      "Cleaner": cleanerName,
      "Cleaner Email": cleanerEmail,
      "Pay Tier": payTier,
      "Payout $": cents(p.cleaner_payout_cents),
      "Platform Fee $": cents(p.platform_fee_cents),
      "Total Booking $": cents(p.total_booking_amount_cents),
      "Status": p.status,
      "Stripe Transfer ID": p.stripe_transfer_id,
      "Service Type": serviceType,
      "Service Date": serviceDate,
      "Processed At": p.processed_at,
      "Created At": p.created_at,
      "Synced At": new Date().toISOString(),
    };

    return await upsert(cfg, table, "Payout ID", fields);
  } catch (err) {
    log("syncPayoutToAirtable error", { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}
