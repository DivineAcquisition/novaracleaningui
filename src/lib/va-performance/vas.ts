// ─── The VA record + verification identity (server only) ──────────────────────
//
// A VA is a row in va_onboarding — the record that already exists from the
// team.novaracleaning.com onboarding flow and already syncs to Airtable. This
// module adds the performance-layer view of it: the linked source user IDs that
// let the verification layer attribute activity to a person.
//
// Attribution is explicit and per-source. An unlinked source doesn't guess by
// name — it reports "unlinked", and every metric it would have supplied stays
// NULL (unverified). Silently attributing someone else's calls would be worse
// than showing nothing.

import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";

export interface VaRecord {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  name: string;
  phone: string | null;
  /** Onboarding lifecycle: started | signed | submitted | approved | … */
  status: string;
  /** Performance standing: active | probation | inactive | removed */
  performanceStatus: string;
  payType: string;
  rateCents: number | null;
  startDate: string | null;
  functionsAssigned: string[];
  vaRole: string | null;
  // Verification identity
  apployeUserId: string | null;
  ghlUserId: string | null;
  /** auth.users id — the workspace user. Also how the EOD form identifies them. */
  workspaceUserId: string | null;
  perfAirtableRecordId: string | null;
}

const VA_COLUMNS =
  "id, email, first_name, last_name, phone, status, performance_status, pay_type, rate_cents, " +
  "start_date, functions_assigned, va_role, apploye_user_id, ghl_user_id, portal_user_id, " +
  "perf_airtable_record_id";

type Row = Record<string, unknown>;

function mapVa(row: Row): VaRecord {
  const first = (row.first_name as string) || "";
  const last = (row.last_name as string) || "";
  const email = String(row.email || "");
  return {
    id: String(row.id),
    email,
    firstName: first || null,
    lastName: last || null,
    name: `${first} ${last}`.trim() || email,
    phone: (row.phone as string) || null,
    status: String(row.status || "started"),
    performanceStatus: String(row.performance_status || "active"),
    payType: String(row.pay_type || "base"),
    rateCents: row.rate_cents === null || row.rate_cents === undefined ? null : Number(row.rate_cents),
    startDate: (row.start_date as string) || null,
    functionsAssigned: Array.isArray(row.functions_assigned)
      ? (row.functions_assigned as string[])
      : [],
    vaRole: (row.va_role as string) || null,
    apployeUserId: (row.apploye_user_id as string) || null,
    ghlUserId: (row.ghl_user_id as string) || null,
    workspaceUserId: (row.portal_user_id as string) || null,
    perfAirtableRecordId: (row.perf_airtable_record_id as string) || null,
  };
}

/**
 * VAs the verification layer should sync. Approved and not removed — someone
 * still onboarding has no work to verify, and a removed VA's history is kept
 * but no longer refreshed.
 */
export async function listTrackedVas(): Promise<VaRecord[]> {
  const supabase = getAdminSupabase();
  const { data, error } = await supabase
    .from("va_onboarding")
    .select(VA_COLUMNS)
    .eq("status", "approved")
    .neq("performance_status", "removed")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Read VAs failed: ${error.message}`);
  return (data || []).map((r) => mapVa(r as unknown as Row));
}

/** Every VA, including those still onboarding — for the admin roster view. */
export async function listAllVas(): Promise<VaRecord[]> {
  const supabase = getAdminSupabase();
  const { data, error } = await supabase
    .from("va_onboarding")
    .select(VA_COLUMNS)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Read VAs failed: ${error.message}`);
  return (data || []).map((r) => mapVa(r as unknown as Row));
}

export async function getVaById(id: string): Promise<VaRecord | null> {
  const supabase = getAdminSupabase();
  const { data, error } = await supabase
    .from("va_onboarding")
    .select(VA_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Read VA failed: ${error.message}`);
  return data ? mapVa(data as unknown as Row) : null;
}

/**
 * Resolve the signed-in user to their VA record for the EOD form.
 *
 * Matched on portal_user_id first (the link written at provisioning), then on
 * email as a fallback for VAs provisioned before that column was populated.
 * Identity is never typed by the VA — it comes from the verified session.
 */
export async function resolveVaForUser(
  userId: string,
  email: string | null,
): Promise<VaRecord | null> {
  const supabase = getAdminSupabase();

  const { data: byLink } = await supabase
    .from("va_onboarding")
    .select(VA_COLUMNS)
    .eq("portal_user_id", userId)
    .maybeSingle();
  if (byLink) return mapVa(byLink as unknown as Row);

  const normalized = (email || "").trim().toLowerCase();
  if (!normalized) return null;

  const { data: byEmail } = await supabase
    .from("va_onboarding")
    .select(VA_COLUMNS)
    .ilike("email", normalized)
    .maybeSingle();
  if (!byEmail) return null;

  const record = mapVa(byEmail as unknown as Row);
  // Backfill the link so subsequent lookups are exact.
  if (!record.workspaceUserId) {
    await supabase.from("va_onboarding").update({ portal_user_id: userId }).eq("id", record.id);
    record.workspaceUserId = userId;
  }
  return record;
}

/**
 * Best-effort match of a VA to the free-text name fields older systems use
 * (bookings.sdr_rep_name, va_quotes.csr_name). Returns the lowercase name
 * variants that should be treated as this VA.
 */
export function nameAliases(va: VaRecord): string[] {
  const out = new Set<string>();
  const add = (s: string | null | undefined) => {
    const v = (s || "").trim().toLowerCase();
    if (v) out.add(v);
  };
  add(va.name);
  add(va.firstName);
  add(va.email);
  add(va.email.split("@")[0]);
  if (va.firstName && va.lastName) add(`${va.firstName} ${va.lastName[0]}`);
  return [...out];
}
