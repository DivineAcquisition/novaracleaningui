import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { ensureIdentity } from "./identity";
import { mintHandoffToken } from "./magic-link";
import { establishSession } from "./session";
import { hashToken, normalizeEmail } from "./tokens";

export async function consumeLoginToken(raw: string): Promise<{
  ok: boolean;
  message?: string;
  email?: string;
}> {
  if (!raw || raw.length < 16) return { ok: false, message: "This sign-in link isn't valid." };
  const supabase = getAdminSupabase();
  const { data } = await supabase
    .from("partner_login_tokens")
    .select("*")
    .eq("token_hash", hashToken(raw))
    .maybeSingle();
  if (!data) return { ok: false, message: "This sign-in link isn't valid." };
  if (data.consumed_at) return { ok: false, message: "This sign-in link was already used. Request a new one." };
  if (new Date(data.expires_at).getTime() <= Date.now()) {
    return { ok: false, message: "This sign-in link has expired. Request a new one." };
  }

  const identity =
    (data.identity_id &&
      (await ensureIdentity(supabase, {
        email: data.email,
        hostId: data.host_id,
        accountId: data.business_account_id,
      }))) ||
    (await ensureIdentity(supabase, {
      email: data.email,
      hostId: data.host_id,
      accountId: data.business_account_id,
    }));
  if (!identity) return { ok: false, message: "We couldn't open your portal from this link." };

  await supabase
    .from("partner_login_tokens")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", data.id);

  await establishSession(identity.id, identity.email);
  return { ok: true, email: identity.email };
}

export async function provisionHostPortalAccess(input: {
  email: string;
  hostId: string;
  displayName?: string | null;
  phone?: string | null;
  sessionId?: string | null;
}): Promise<{ ok: boolean; handoffUrl: string; error?: string }> {
  const supabase = getAdminSupabase();
  const email = normalizeEmail(input.email);
  const identity = await ensureIdentity(supabase, {
    email,
    displayName: input.displayName,
    phone: input.phone,
    hostId: input.hostId,
  });
  if (!identity) return { ok: false, handoffUrl: "", error: "Could not open portal access." };

  const now = new Date().toISOString();
  if (input.sessionId) {
    await supabase
      .from("host_onboarding_sessions")
      .update({
        portal_provisioned_at: now,
        last_completed_step: "payment",
        last_activity_at: now,
        updated_at: now,
      })
      .eq("id", input.sessionId);
  }

  const handoff = await mintHandoffToken({
    email,
    identityId: identity.id,
    hostId: input.hostId,
    kind: "host",
  });
  return { ok: true, handoffUrl: handoff.url };
}

export async function provisionCommercialPortalAccess(input: {
  email: string;
  accountId: string;
  displayName?: string | null;
  phone?: string | null;
}): Promise<{ ok: boolean; handoffUrl: string; error?: string }> {
  const supabase = getAdminSupabase();
  const email = normalizeEmail(input.email);
  const identity = await ensureIdentity(supabase, {
    email,
    displayName: input.displayName,
    phone: input.phone,
    accountId: input.accountId,
  });
  if (!identity) return { ok: false, handoffUrl: "", error: "Could not open portal access." };

  await supabase
    .from("business_accounts")
    .update({ portal_created_at: new Date().toISOString() })
    .eq("id", input.accountId)
    .is("portal_created_at", null);

  // If portal_created_at was already set, still bump last_activity via a no-op-safe update.
  await supabase
    .from("business_accounts")
    .update({ portal_created_at: new Date().toISOString() })
    .eq("id", input.accountId);

  const handoff = await mintHandoffToken({
    email,
    identityId: identity.id,
    accountId: input.accountId,
    kind: "commercial",
  });
  return { ok: true, handoffUrl: handoff.url };
}
