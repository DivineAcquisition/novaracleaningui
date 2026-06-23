// ─── Seamless Host Portal account provisioning ────────────────────────────
//
// Runs inside POST /api/host-onboarding (service role). Turns a click-wrap
// onboarding submission into a usable Host Portal account in one request:
//
//   1. Create (or detect) the Supabase auth user — email pre-confirmed so the
//      host can sign in immediately, no inbox round-trip.
//   2. Upsert the `hosts` row keyed on user_id (mirrors partner-turnover
//      `host.ensure`).
//   3. Insert each submitted property as Pending Pricing (turnover_price NULL
//      → not bookable until an admin sets the rate, per the STR spec).
//
// Best-effort + idempotent: any failure is returned as a warning and never
// blocks the submission itself. The host can always finish via the portal.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { OnboardingFormPayload } from "./types";

export interface ProvisionResult {
  accountCreated: boolean;
  accountExists: boolean;
  userId: string | null;
  hostId: string | null;
  propertyIds: string[];
  error?: string;
}

const digits = (s: string) => (s || "").replace(/\D/g, "");
const isDuplicate = (msg: string) => /already|registered|exist|duplicate/i.test(msg);

/** Best-effort lookup of an existing auth user id by email (paginates). */
async function findUserIdByEmail(admin: SupabaseClient, email: string): Promise<string | null> {
  const target = email.toLowerCase();
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const users = (data?.users ?? []) as Array<{ id: string; email?: string | null }>;
    if (error || users.length === 0) return null;
    const hit = users.find((u) => (u.email || "").toLowerCase() === target);
    if (hit) return hit.id;
    if (users.length < 200) return null;
  }
  return null;
}

async function ensureHost(
  admin: SupabaseClient,
  userId: string,
  payload: OnboardingFormPayload,
): Promise<string | null> {
  const { data: existing } = await admin
    .from("hosts")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing?.id) return existing.id as string;

  const { data, error } = await admin
    .from("hosts")
    .insert({
      user_id: userId,
      email: payload.email,
      name: payload.fullName || null,
      phone: digits(payload.phone) || null,
    })
    .select("id")
    .single();
  if (error) {
    // Lost a race (unique user_id) → re-read.
    const { data: again } = await admin.from("hosts").select("id").eq("user_id", userId).maybeSingle();
    return (again?.id as string) || null;
  }
  return data.id as string;
}

async function insertProperties(
  admin: SupabaseClient,
  hostId: string,
  payload: OnboardingFormPayload,
): Promise<string[]> {
  if (!payload.properties.length) return [];
  // Avoid duplicating properties if this host already has some (idempotent
  // re-submit / existing portal host).
  const { data: existing } = await admin
    .from("properties")
    .select("id")
    .eq("host_id", hostId)
    .limit(1);
  if (existing && existing.length > 0) return [];

  const rows = payload.properties.map((p) => ({
    host_id: hostId,
    nickname: p.nickname || null,
    address: p.address || null,
    access_instructions: p.accessInstructions || null,
    bedrooms: p.bedrooms ?? null,
    bathrooms: p.bathrooms ?? null,
    sqft: p.sqft ?? null,
    laundry_included: !!p.linen,
    restock_included: !!p.restock,
    special_notes: p.stagingNotes || null,
    // turnover_price intentionally omitted → NULL → Pending Pricing.
  }));
  const { data, error } = await admin.from("properties").insert(rows).select("id");
  if (error) return [];
  return (data || []).map((r) => r.id as string);
}

/**
 * Provision (or link) the host's portal account from an onboarding payload.
 * Never throws — returns a result with `error` set on failure so the caller
 * can record a warning and still report success for the submission.
 */
export async function provisionHostAccount(
  admin: SupabaseClient,
  payload: OnboardingFormPayload,
): Promise<ProvisionResult> {
  const result: ProvisionResult = {
    accountCreated: false,
    accountExists: false,
    userId: null,
    hostId: null,
    propertyIds: [],
  };

  if (!payload.password) {
    // No password supplied → caller chose not to provision an account.
    return result;
  }

  try {
    const created = await admin.auth.admin.createUser({
      email: payload.email,
      password: payload.password,
      email_confirm: true,
      user_metadata: {
        is_partner_host: true,
        full_name: payload.fullName,
        first_name: payload.fullName.split(" ")[0] || payload.fullName,
        phone: digits(payload.phone),
      },
    });

    if (created.error) {
      if (isDuplicate(created.error.message)) {
        result.accountExists = true;
        result.userId = await findUserIdByEmail(admin, payload.email);
      } else {
        result.error = created.error.message;
        return result;
      }
    } else {
      result.accountCreated = true;
      result.userId = created.data.user?.id || null;
    }

    if (result.userId) {
      result.hostId = await ensureHost(admin, result.userId, payload);
      if (result.hostId) {
        result.propertyIds = await insertProperties(admin, result.hostId, payload);
      }
    }
    return result;
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
    return result;
  }
}
