// ─── GHL location user provisioning (contractor portal access) ─────────────
//
// Creates a sub-account user in GoHighLevel with the same role, permissions,
// scopes, and location access as a template user (default: maliksannie7@gmail.com).
// Soft-fails — callers treat this as best-effort.

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";
const DEFAULT_TEMPLATE_EMAIL = "maliksannie7@gmail.com";

type Json = Record<string, unknown>;

function log(step: string, details?: unknown) {
  const suffix = details === undefined ? "" : ` ${JSON.stringify(details)}`;
  console.log(`[ghl-users] ${step}${suffix}`);
}

async function resolveSecret(
  supabase: { from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: { value?: string } | null }> } } } },
  key: string,
): Promise<string> {
  try {
    const { data } = await supabase.from("app_secrets").select("value").eq("key", key).maybeSingle();
    return (data?.value as string) || (Deno.env.get(key) || "").trim();
  } catch {
    return (Deno.env.get(key) || "").trim();
  }
}

async function ghlFetch(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; json: Json | null; text: string }> {
  const res = await fetch(`${GHL_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Version: GHL_VERSION,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  const text = await res.text();
  let json: Json | null = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, text };
}

async function resolveCompanyId(
  supabase: Parameters<typeof resolveSecret>[0],
  token: string,
  locationId: string,
): Promise<string | null> {
  const fromSecret = await resolveSecret(supabase, "GHL_COMPANY_ID");
  if (fromSecret) return fromSecret;

  const res = await ghlFetch(token, `/locations/${encodeURIComponent(locationId)}`, { method: "GET" });
  if (!res.ok || !res.json) {
    log("resolveCompanyId failed", { status: res.status, preview: res.text.slice(0, 200) });
    return null;
  }
  const loc = (res.json.location as Json | undefined) ?? res.json;
  const companyId = (loc.companyId as string) || (loc.company_id as string) || null;
  return companyId;
}

function normalizeScopes(raw: unknown): string[] | undefined {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string" && raw.trim()) {
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return undefined;
}

function extractUserRecord(json: Json | null): Json | null {
  if (!json) return null;
  if (json.user && typeof json.user === "object") return json.user as Json;
  if (json.id) return json;
  const users = json.users as Json[] | undefined;
  if (Array.isArray(users) && users.length > 0) return users[0];
  return null;
}

async function findUserByEmail(
  token: string,
  companyId: string,
  email: string,
): Promise<Json | null> {
  const target = email.trim().toLowerCase();

  const attempts = [
    `/users/search?companyId=${encodeURIComponent(companyId)}&email=${encodeURIComponent(email)}`,
    `/users/search?companyId=${encodeURIComponent(companyId)}&query=${encodeURIComponent(email)}`,
    `/users/?companyId=${encodeURIComponent(companyId)}&email=${encodeURIComponent(email)}`,
  ];

  for (const path of attempts) {
    const res = await ghlFetch(token, path, { method: "GET" });
    if (!res.ok) continue;

    const users = res.json?.users as Json[] | undefined;
    if (Array.isArray(users)) {
      const match = users.find((u) =>
        String(u.email || "").trim().toLowerCase() === target
      );
      if (match?.id) return match;
    }

    const single = extractUserRecord(res.json);
    if (single?.id && String(single.email || "").trim().toLowerCase() === target) {
      return single;
    }
  }

  return null;
}

async function fetchUserById(token: string, userId: string): Promise<Json | null> {
  const res = await ghlFetch(token, `/users/${encodeURIComponent(userId)}`, { method: "GET" });
  if (!res.ok) return null;
  return extractUserRecord(res.json);
}

export interface ProvisionGhlUserInput {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  password: string;
  templateEmail?: string;
}

export interface ProvisionGhlUserResult {
  ghlUserId: string | null;
  created: boolean;
  skipped?: string;
  error?: string;
}

/**
 * Ensure a GHL sub-account user exists with permissions cloned from the
 * template user. Returns existing user id when already present.
 */
export async function provisionGhlUserFromTemplate(
  supabase: Parameters<typeof resolveSecret>[0],
  input: ProvisionGhlUserInput,
): Promise<ProvisionGhlUserResult> {
  const token = await resolveSecret(supabase, "GHL_PIT_TOKEN");
  const locationId = await resolveSecret(supabase, "GHL_LOCATION_ID");
  if (!token || !locationId) {
    return { ghlUserId: null, created: false, skipped: "GHL not configured" };
  }

  const email = input.email.trim().toLowerCase();
  if (!email) return { ghlUserId: null, created: false, skipped: "no email" };

  const companyId = await resolveCompanyId(supabase, token, locationId);
  if (!companyId) {
    return { ghlUserId: null, created: false, error: "GHL companyId not resolved" };
  }

  const existing = await findUserByEmail(token, companyId, email);
  if (existing?.id) {
    log("user already exists", { email, ghlUserId: existing.id });
    return { ghlUserId: String(existing.id), created: false };
  }

  const templateEmail = (
    input.templateEmail ||
    (await resolveSecret(supabase, "GHL_USER_TEMPLATE_EMAIL")) ||
    DEFAULT_TEMPLATE_EMAIL
  ).trim().toLowerCase();

  let template = await findUserByEmail(token, companyId, templateEmail);
  if (template?.id) {
    const full = await fetchUserById(token, String(template.id));
    if (full) template = full;
  }

  if (!template?.id) {
    return {
      ghlUserId: null,
      created: false,
      error: `GHL template user not found: ${templateEmail}`,
    };
  }

  const roles = (template.roles as Json | undefined) ?? {};
  const locationIds = (
    (template.locationIds as string[] | undefined) ||
    (roles.locationIds as string[] | undefined) ||
    [locationId]
  ).filter(Boolean);

  const body: Json = {
    companyId,
    firstName: input.firstName,
    lastName: input.lastName,
    email,
    password: input.password,
    phone: input.phone || undefined,
    type: (template.type as string) || (roles.type as string) || "account",
    role: (template.role as string) || (roles.role as string) || "user",
    locationIds,
    permissions: template.permissions || undefined,
    scopes: normalizeScopes(template.scopes),
    scopesAssignedToOnly: normalizeScopes(template.scopesAssignedToOnly),
  };

  const createRes = await ghlFetch(token, "/users/", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!createRes.ok) {
    const msg = createRes.text.slice(0, 300);
    if (createRes.status === 422 || msg.toLowerCase().includes("already")) {
      const again = await findUserByEmail(token, companyId, email);
      if (again?.id) {
        return { ghlUserId: String(again.id), created: false };
      }
    }
    log("create user failed", { status: createRes.status, msg });
    return { ghlUserId: null, created: false, error: msg };
  }

  const created = extractUserRecord(createRes.json);
  const ghlUserId = created?.id ? String(created.id) : null;
  log("user created", { email, ghlUserId, templateEmail });
  return { ghlUserId, created: true };
}
