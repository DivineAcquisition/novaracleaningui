import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { emailHasPartnership, ensureIdentity, findIdentityByEmail } from "./identity";
import { enterUrl } from "./origins";
import { loadPortalSettings } from "./settings";
import { hashToken, looksLikeEmail, mintRawToken, normalizeEmail } from "./tokens";

export async function requestMagicLink(emailRaw: string): Promise<{ ok: true }> {
  const email = normalizeEmail(emailRaw);
  // Always the same shape — never reveal whether the address has a partnership.
  if (!looksLikeEmail(email)) return { ok: true };

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

  await supabase.functions
    .invoke("admin-send-email", {
      body: {
        to: email,
        subject: "Your Novara partner portal sign-in link",
        html: [
          `<p>Hi ${name},</p>`,
          `<p>Tap the button below to sign in to your Novara partner portal. No password is needed.</p>`,
          `<p style="margin:24px 0"><a href="${link}" style="background:#5C0FFE;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600">Sign in</a></p>`,
          `<p style="font-size:13px;color:#6B7280">This link expires in ${settings.magicLinkMinutes} minutes and can only be used once.</p>`,
          `<p style="font-size:12px;word-break:break-all">${link}</p>`,
        ].join(""),
      },
    })
    .catch(() => null);

  const phone = identity.phone || identity.hosts[0]?.phone || identity.accounts[0]?.phone;
  if (phone) {
    await supabase.functions
      .invoke("send-ghl-sms", {
        body: {
          phone,
          type: "confirmation",
          message: `Novara Cleaning: your partner portal sign-in link (expires in ${settings.magicLinkMinutes} min): ${link}`,
        },
      })
      .catch(() => null);
  }

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
