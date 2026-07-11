// ─── Google Drive helper (service-account JWT flow) ─────────────────────────
//
// Reusable Drive client for edge functions. Same service-account credentials
// as the Calendar integration (GOOGLE_SERVICE_ACCOUNT_EMAIL /
// GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY env vars); scope swapped to Drive.
// All calls send supportsAllDrives=true so shared drives work too.

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const FOLDER_MIME = "application/vnd.google-apps.folder";

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem: string): Uint8Array {
  // Normalise escaped newlines, slice strictly between the PEM markers (the
  // stored env value may carry surrounding quotes or other wrapper chars),
  // then drop anything that isn't base64.
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

export function driveConfigured(): boolean {
  return Boolean(
    Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL") &&
      Deno.env.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"),
  );
}

/**
 * Mint a short-lived Drive access token via the service-account JWT flow.
 *
 * `impersonate` (optional): a Google Workspace user email to act as via
 * domain-wide delegation. Needed when the archive folder lives in a user's
 * My Drive — service accounts have NO storage quota of their own, so files
 * must be owned by either a Shared Drive or an impersonated user.
 */
export async function getDriveToken(impersonate?: string): Promise<string | null> {
  const saEmail = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const saKey = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY");
  if (!saEmail || !saKey) return null;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claim = b64url(
    new TextEncoder().encode(JSON.stringify({
      iss: saEmail,
      scope: DRIVE_SCOPE,
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

function escapeQuery(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** Find a direct child (any mime) of `parentId` by exact name. */
export async function findChild(
  token: string,
  parentId: string,
  name: string,
  mimeType?: string,
): Promise<{ id: string; name: string } | null> {
  const qParts = [
    `'${escapeQuery(parentId)}' in parents`,
    `name = '${escapeQuery(name)}'`,
    "trashed = false",
  ];
  if (mimeType) qParts.push(`mimeType = '${escapeQuery(mimeType)}'`);
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", qParts.join(" and "));
  url.searchParams.set("fields", "files(id,name)");
  url.searchParams.set("pageSize", "5");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`drive list failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.files?.[0] || null;
}

/** List names of every file directly inside a folder (for upload dedupe). */
export async function listChildNames(token: string, parentId: string): Promise<Set<string>> {
  const names = new Set<string>();
  let pageToken: string | undefined;
  do {
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set("q", `'${escapeQuery(parentId)}' in parents and trashed = false`);
    url.searchParams.set("fields", "nextPageToken,files(name)");
    url.searchParams.set("pageSize", "1000");
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("includeItemsFromAllDrives", "true");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`drive list failed: ${res.status}`);
    const data = await res.json();
    for (const f of data.files || []) names.add(String(f.name));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return names;
}

/** Find-or-create a child folder. Idempotent — safe on retries. */
export async function ensureFolder(token: string, parentId: string, name: string): Promise<string> {
  const existing = await findChild(token, parentId, name, FOLDER_MIME);
  if (existing) return existing.id;
  const res = await fetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
  if (!res.ok) throw new Error(`drive folder create failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const file = await res.json();
  return file.id as string;
}

/** Multipart upload of raw bytes into a folder. Returns the new file id. */
export async function uploadFile(
  token: string,
  folderId: string,
  filename: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<string> {
  const boundary = "novara" + crypto.randomUUID();
  const meta = JSON.stringify({ name: filename, parents: [folderId] });
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  const enc = new TextEncoder();
  const headBytes = enc.encode(head);
  const tailBytes = enc.encode(tail);
  const body = new Uint8Array(headBytes.length + bytes.length + tailBytes.length);
  body.set(headBytes, 0);
  body.set(bytes, headBytes.length);
  body.set(tailBytes, headBytes.length + bytes.length);
  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    },
  );
  if (!res.ok) throw new Error(`drive upload failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const file = await res.json();
  return file.id as string;
}

/**
 * Make a file/folder readable by anyone with the link (so the Drive URL on
 * the Airtable job record / QC console opens without account juggling).
 * Best-effort — shared-drive policies may forbid it; never throws.
 */
export async function shareReadableByLink(token: string, fileId: string): Promise<void> {
  try {
    await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?supportsAllDrives=true`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ role: "reader", type: "anyone" }),
      },
    );
  } catch {
    /* best-effort */
  }
}

export function folderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`;
}

export function fileUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`;
}
