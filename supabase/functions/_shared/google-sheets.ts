// ─── Google Sheets helper (service-account JWT flow) ────────────────────────
//
// Same credentials + JWT pattern as the Drive/Calendar integrations
// (GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY), scoped
// to spreadsheets. Supports domain-wide-delegation impersonation for
// workbooks living in a user's My Drive.

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem: string): Uint8Array {
  const normalized = pem.replace(/\\n/g, "\n");
  const begin = normalized.indexOf("-----BEGIN");
  const beginEnd = begin >= 0 ? normalized.indexOf("-----", begin + 10) : -1;
  const end = normalized.indexOf("-----END");
  const body = (begin >= 0 && end > begin
    ? normalized.slice(beginEnd + 5, end)
    : normalized
  ).replace(/[^A-Za-z0-9+/=]/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function getSheetsToken(impersonate?: string): Promise<string | null> {
  const saEmail = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const saKey = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY");
  if (!saEmail || !saKey) return null;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claim = b64url(
    new TextEncoder().encode(JSON.stringify({
      iss: saEmail,
      scope: SHEETS_SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
      ...(impersonate ? { sub: impersonate } : {}),
    })),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(saKey) as unknown as ArrayBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claim}`)),
  );
  const jwt = `${header}.${claim}.${b64url(sig)}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const { access_token } = await res.json().catch(() => ({ access_token: null }));
  return access_token || null;
}

const API = "https://sheets.googleapis.com/v4/spreadsheets";

/** Clear a range (values only — formatting and formulas outside it untouched). */
export async function clearRange(token: string, spreadsheetId: string, range: string): Promise<void> {
  const res = await fetch(
    `${API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:clear`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`sheets clear failed (${range}): ${res.status} ${(await res.text()).slice(0, 200)}`);
}

/**
 * Write values starting at `range` with RAW input (strings stay strings —
 * guarantees dates remain literal YYYY-MM-DD text for the month roll-ups).
 */
export async function writeRange(
  token: string,
  spreadsheetId: string,
  range: string,
  values: (string | number)[][],
): Promise<void> {
  const res = await fetch(
    `${API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ range, majorDimension: "ROWS", values }),
    },
  );
  if (!res.ok) throw new Error(`sheets write failed (${range}): ${res.status} ${(await res.text()).slice(0, 200)}`);
}

/** List tab titles (to fail fast with a clear message when a tab is missing). */
export async function listTabs(token: string, spreadsheetId: string): Promise<string[]> {
  const res = await fetch(
    `${API}/${encodeURIComponent(spreadsheetId)}?fields=sheets(properties(title))`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`sheets meta failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (data.sheets || []).map((s: { properties?: { title?: string } }) => String(s.properties?.title || ""));
}
