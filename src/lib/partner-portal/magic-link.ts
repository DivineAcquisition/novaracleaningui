import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { sendPortalMagicLink } from "@/lib/partnership-comms/server";
import { emailHasPartnership, ensureIdentity, findIdentityByEmail } from "./identity";
import { enterUrl } from "./origins";
import { loadPortalSettings } from "./settings";
import { hashToken, looksLikeEmail, mintRawToken, normalizeEmail } from "./tokens";

export async function requestMagicLink(emailRaw: string): Promise<{ ok: true }> {
  const email = normalizeEmail(emailRaw);
  // Always the same shape — never reveal whether the address has a partnership,
  // and never 500 the sign-in screen if the mailer or admin client is down.
  if (!looksLikeEmail(email)) return { ok: true };

  try {
    return await sendMagicLink(email);
  } catch (err) {
    console.error("[partner-portal] magic link failed", err);
    return { ok: true };
  }
}

async function sendMagicLink(email: string): Promise<{ ok: true }> {
  const supabase = getAdminSupabase();
  const exists = await emailHasPartnership(supabase, email);
  if (!exists) return { ok: true };

  const identity = (await findIdentityByEmail(supabase, email)) || (await ensureIdentity(supabase, { email }));
  if (!identity || !identity.kinds.length) return { ok: true };

  const settings = await loadPortalSettings(supabase);
  const raw = mintRawToken();
  const expiresAt = new Date(Date.now() + settings.magicLinkMinutes * 60_000);
  await supabase.from("partner_login_tokens").insert({
    token_hash: hashToken(raw),
    email,
    identity_id: identity.id,
    purpose: "magic_link",
    expires_at: expiresAt.toISOString(),
  });

  const link = enterUrl(raw);
  const name = (identity.displayName || identity.hosts[0]?.name || identity.accounts[0]?.contactName || "there")
    .split(" ")[0];
  const phone = identity.phone || identity.hosts[0]?.phone || identity.accounts[0]?.phone;

  await sendPortalMagicLink(supabase, {
    email,
    phone,
    firstName: name,
    link,
    expiresMinutes: settings.magicLinkMinutes,
    hostId: identity.hosts[0]?.id || null,
    accountId: identity.accounts[0]?.id || null,
  }).catch(() => null);

  return { ok: true };
}

export async function mintHandoffToken(input: {
  email: string;
  identityId: string;
  hostId?: string | null;
  accountId?: string | null;
  kind: "host" | "commercial";
}): Promise<{ raw: string; url: string; expiresAt: Date }> {
  const supabase = getAdminSupabase();
  const settings = await loadPortalSettings(supabase);
  const raw = mintRawToken();
  const expiresAt = new Date(Date.now() + settings.handoffMinutes * 60_000);
  await supabase.from("partner_login_tokens").insert({
    token_hash: hashToken(raw),
    email: normalizeEmail(input.email),
    identity_id: input.identityId,
    purpose: "onboarding_handoff",
    host_id: input.hostId || null,
    business_account_id: input.accountId || null,
    onboarding_kind: input.kind,
    expires_at: expiresAt.toISOString(),
  });
  return { raw, url: enterUrl(raw), expiresAt };
}
