import { cookies } from "next/headers";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { getIdentity, type PartnerIdentity } from "./identity";
import { loadPortalSettings } from "./settings";
import { hashToken, mintRawToken } from "./tokens";

export const SESSION_COOKIE = "nv_partner_session";

export interface PortalSession {
  id: string;
  identity: PartnerIdentity;
  expiresAt: string;
}

function cookieOptions(maxAgeSec: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSec,
  };
}

export async function createPortalSession(
  identityId: string,
  email: string,
): Promise<{ raw: string; expiresAt: Date }> {
  const supabase = getAdminSupabase();
  const settings = await loadPortalSettings(supabase);
  const raw = mintRawToken();
  const expiresAt = new Date(Date.now() + settings.sessionDays * 86400_000);
  await supabase.from("partner_portal_sessions").insert({
    token_hash: hashToken(raw),
    identity_id: identityId,
    email,
    expires_at: expiresAt.toISOString(),
  });
  return { raw, expiresAt };
}

export async function setSessionCookie(raw: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  const maxAge = Math.max(60, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  store.set(SESSION_COOKIE, raw, cookieOptions(maxAge));
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { ...cookieOptions(0), maxAge: 0 });
}

export async function readSessionCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value || null;
}

export async function resolvePortalSession(raw?: string | null): Promise<PortalSession | null> {
  const token = raw ?? (await readSessionCookie());
  if (!token || token.length < 16) return null;
  const supabase = getAdminSupabase();
  const { data } = await supabase
    .from("partner_portal_sessions")
    .select("id, identity_id, email, expires_at, revoked_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (!data || data.revoked_at) return null;
  if (new Date(data.expires_at).getTime() <= Date.now()) return null;
  const identity = await getIdentity(supabase, data.identity_id);
  if (!identity) return null;
  await supabase
    .from("partner_portal_sessions")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", data.id);
  return { id: data.id, identity, expiresAt: data.expires_at };
}

export async function revokePortalSession(raw?: string | null): Promise<void> {
  const token = raw ?? (await readSessionCookie());
  if (!token) {
    await clearSessionCookie();
    return;
  }
  const supabase = getAdminSupabase();
  await supabase
    .from("partner_portal_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("token_hash", hashToken(token));
  await clearSessionCookie();
}

export async function establishSession(identityId: string, email: string): Promise<Date> {
  const { raw, expiresAt } = await createPortalSession(identityId, email);
  await setSessionCookie(raw, expiresAt);
  return expiresAt;
}
