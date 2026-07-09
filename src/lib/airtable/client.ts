// ─── Airtable REST client ─────────────────────────────────────────────────────
//
// Thin, typed wrapper over the Airtable Web API + Meta API.
//
//   • PAT read from env (AIRTABLE_PAT, falling back to AIRTABLE_API_KEY).
//     Server-side ONLY — never logged, never shipped to the browser.
//   • Rate-limit aware: a single shared queue paces every request to stay under
//     Airtable's 5 req/sec/base ceiling (we space requests ~220ms apart).
//   • Batched, idempotent upserts via performUpsert.fieldsToMergeOn so re-syncing
//     the same natural key (Email / Job ID / Run ID / Nickname) updates the row
//     instead of creating a duplicate. Max 10 records per request.
//   • Every call is wrapped in try/catch with retry + exponential backoff on 429
//     (honours Retry-After) and transient 5xx.
//   • typecast:true on writes so a select value that isn't yet an option is
//     created rather than erroring — and we log when a value falls outside the
//     known vocabulary so it can be reviewed (Section 3.4).

import { REVENUE_OPS_BASE_ID } from "./schema";

const API_BASE = "https://api.airtable.com/v0";
const META_BASE = "https://api.airtable.com/v0/meta";

const MIN_REQUEST_SPACING_MS = 220; // ~4.5 req/s, safely under the 5 req/s/base cap
const MAX_RECORDS_PER_REQUEST = 10;
const DEFAULT_MAX_RETRIES = 5;

export class AirtableError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = "AirtableError";
  }
}

const log = (msg: string, data?: unknown) =>
  // eslint-disable-next-line no-console
  console.log(`[airtable] ${msg}${data === undefined ? "" : " " + JSON.stringify(data)}`);

const warn = (msg: string, data?: unknown) =>
  // eslint-disable-next-line no-console
  console.warn(`[airtable] ${msg}${data === undefined ? "" : " " + JSON.stringify(data)}`);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Resolve the PAT at call time so it's never captured at import. Never logged. */
function getToken(): string {
  const token =
    (typeof process !== "undefined" && (process.env.AIRTABLE_PAT || process.env.AIRTABLE_API_KEY)) ||
    "";
  if (!token) {
    throw new AirtableError(
      "Missing Airtable PAT. Set AIRTABLE_PAT (scopes: schema.bases:write, data.records:read, data.records:write).",
    );
  }
  return token.trim();
}

/** Base id is fixed to the Client & Revenue Ops base but overridable via env. */
export function getBaseId(): string {
  return (
    (typeof process !== "undefined" && process.env.AIRTABLE_REVENUE_OPS_BASE_ID) ||
    REVENUE_OPS_BASE_ID
  );
}

// ─── Shared rate-limit queue ──────────────────────────────────────────────────
// All requests funnel through one promise chain so concurrent mappers can't
// burst past the per-base limit.

let queueTail: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

function schedule<T>(fn: () => Promise<T>): Promise<T> {
  const run = queueTail.then(async () => {
    const wait = lastRequestAt + MIN_REQUEST_SPACING_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    return fn();
  });
  // Keep the chain alive regardless of individual success/failure.
  queueTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function backoffMs(attempt: number): number {
  // 0.5s, 1s, 2s, 4s, 8s (+ jitter)
  return Math.round(500 * 2 ** attempt + Math.random() * 250);
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  maxRetries?: number;
  /** Use the Meta API host instead of the data API. */
  meta?: boolean;
}

async function airtableRequest<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const token = getToken();
  const host = opts.meta ? META_BASE : API_BASE;
  const url = new URL(`${host}${path}`);
  for (const [k, v] of Object.entries(opts.query || {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;

  const init: RequestInit = {
    method: opts.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  };

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let res: Response;
    try {
      res = await schedule(() => fetch(url.toString(), init));
    } catch (err) {
      // Network-level failure — retry with backoff.
      if (attempt >= maxRetries) {
        throw new AirtableError(`Network error calling Airtable: ${(err as Error).message}`);
      }
      await sleep(backoffMs(attempt++));
      continue;
    }

    if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
      const body = await res.text().catch(() => "");
      // Monthly billing cap is NOT retryable — fail fast with a clear message.
      if (body.includes("PUBLIC_API_BILLING_LIMIT_EXCEEDED")) {
        throw new AirtableError(
          "Airtable monthly API limit exceeded for this workspace — upgrade the Airtable plan (or wait for the monthly reset) to resume syncing.",
          429,
          body.slice(0, 300),
        );
      }
      if (attempt >= maxRetries) {
        throw new AirtableError(`Airtable ${res.status} after ${attempt} retries`, res.status, body);
      }
      const retryAfter = Number(res.headers.get("Retry-After"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoffMs(attempt);
      warn(`got ${res.status}, retrying`, { attempt: attempt + 1, waitMs });
      await sleep(waitMs);
      attempt++;
      continue;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new AirtableError(`Airtable ${res.status} ${res.statusText}`, res.status, body.slice(0, 500));
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}

// ─── Record types ─────────────────────────────────────────────────────────────

export type FieldValue = string | number | boolean | string[] | null | undefined;
export type Fields = Record<string, FieldValue>;

export interface AirtableRecord {
  id: string;
  fields: Record<string, unknown>;
  createdTime?: string;
}

interface UpsertResponse {
  records: AirtableRecord[];
  createdRecords?: string[];
  updatedRecords?: string[];
}

export interface UpsertResult {
  records: AirtableRecord[];
  created: number;
  updated: number;
}

export interface UpsertOptions {
  /** Send unknown select options to Airtable (created via typecast). Default true. */
  typecast?: boolean;
  /**
   * Known option vocabularies keyed by field id. When a written value isn't in
   * the set we log it (typecast will create it) so it can be reviewed.
   */
  knownOptions?: Record<string, readonly string[]>;
}

/** Strip undefined/null so we never blank an already-populated Airtable cell. */
function clean(fields: Fields): Record<string, Exclude<FieldValue, undefined | null>> {
  const out: Record<string, Exclude<FieldValue, undefined | null>> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    out[k] = v;
  }
  return out;
}

function reviewUnknownOptions(records: { fields: Fields }[], knownOptions?: Record<string, readonly string[]>) {
  if (!knownOptions) return;
  for (const { fields } of records) {
    for (const [fieldId, known] of Object.entries(knownOptions)) {
      const value = fields[fieldId];
      if (value === undefined || value === null) continue;
      const values = Array.isArray(value) ? value : [value];
      for (const v of values) {
        if (typeof v === "string" && v !== "" && !known.includes(v)) {
          warn("writing select value outside known vocabulary (typecast will create it)", {
            fieldId,
            value: v,
          });
        }
      }
    }
  }
}

/**
 * Upsert one or more records into a table, merging on `fieldsToMergeOn`
 * (use field IDs). Batches into chunks of ≤10 records per request.
 * Returns the resulting records plus created/updated counts.
 */
export async function upsertRecords(
  tableId: string,
  fieldsToMergeOn: string[],
  records: Fields[],
  options: UpsertOptions = {},
): Promise<UpsertResult> {
  const baseId = getBaseId();
  const typecast = options.typecast ?? true;
  const prepared = records
    .map((fields) => ({ fields: clean(fields) }))
    .filter((r) => Object.keys(r.fields).length > 0);

  reviewUnknownOptions(prepared as { fields: Fields }[], options.knownOptions);

  const result: UpsertResult = { records: [], created: 0, updated: 0 };
  if (prepared.length === 0) return result;

  for (let i = 0; i < prepared.length; i += MAX_RECORDS_PER_REQUEST) {
    const batch = prepared.slice(i, i + MAX_RECORDS_PER_REQUEST);
    const res = await airtableRequest<UpsertResponse>(`/${baseId}/${tableId}`, {
      method: "PATCH",
      body: {
        performUpsert: { fieldsToMergeOn },
        typecast,
        returnFieldsByFieldId: true,
        records: batch,
      },
    });
    result.records.push(...(res.records || []));
    result.created += res.createdRecords?.length || 0;
    result.updated += res.updatedRecords?.length || 0;
  }

  log("upsert ok", {
    tableId,
    mergeOn: fieldsToMergeOn,
    created: result.created,
    updated: result.updated,
  });
  return result;
}

/** Update existing records by id (batched ≤10). Used to set link fields after upsert. */
export async function updateRecords(
  tableId: string,
  records: { id: string; fields: Fields }[],
  options: { typecast?: boolean } = {},
): Promise<AirtableRecord[]> {
  const baseId = getBaseId();
  const typecast = options.typecast ?? true;
  const prepared = records
    .map((r) => ({ id: r.id, fields: clean(r.fields) }))
    .filter((r) => r.id && Object.keys(r.fields).length > 0);
  const out: AirtableRecord[] = [];
  for (let i = 0; i < prepared.length; i += MAX_RECORDS_PER_REQUEST) {
    const batch = prepared.slice(i, i + MAX_RECORDS_PER_REQUEST);
    const res = await airtableRequest<{ records: AirtableRecord[] }>(`/${baseId}/${tableId}`, {
      method: "PATCH",
      body: { typecast, returnFieldsByFieldId: true, records: batch },
    });
    out.push(...(res.records || []));
  }
  return out;
}

/** Delete records by id (batched ≤10). Used to purge stale rows on rebuilds. */
export async function deleteRecords(tableId: string, ids: string[]): Promise<number> {
  const baseId = getBaseId();
  let deleted = 0;
  for (let i = 0; i < ids.length; i += MAX_RECORDS_PER_REQUEST) {
    const batch = ids.slice(i, i + MAX_RECORDS_PER_REQUEST);
    const qs = batch.map((id) => `records[]=${encodeURIComponent(id)}`).join("&");
    const res = await airtableRequest<{ records: { id: string; deleted: boolean }[] }>(
      `/${baseId}/${tableId}?${qs}`,
      { method: "DELETE" },
    );
    deleted += (res.records || []).filter((r) => r.deleted).length;
  }
  if (deleted > 0) log("delete ok", { tableId, deleted });
  return deleted;
}

/** Convenience: upsert a single record and return its Airtable record id. */
export async function upsertOne(
  tableId: string,
  fieldsToMergeOn: string[],
  fields: Fields,
  options: UpsertOptions = {},
): Promise<string | null> {
  const res = await upsertRecords(tableId, fieldsToMergeOn, [fields], options);
  return res.records[0]?.id ?? null;
}

// ─── Lookups (for resolving link targets by natural key) ──────────────────────

/** Escape a value for use inside an Airtable formula string literal. */
function escapeFormulaValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Find a single record id by matching a field (referenced by NAME) to a value.
 * Used to resolve link targets (e.g. a Client by Email) when the linked record
 * id isn't already known. Case-insensitive.
 */
export async function findRecordIdByField(
  tableId: string,
  fieldName: string,
  value: string,
): Promise<string | null> {
  if (!value) return null;
  const baseId = getBaseId();
  const formula = `LOWER({${fieldName}})=LOWER("${escapeFormulaValue(value)}")`;
  const res = await airtableRequest<{ records: AirtableRecord[] }>(`/${baseId}/${tableId}`, {
    query: { filterByFormula: formula, maxRecords: 1, returnFieldsByFieldId: 1 },
  });
  return res.records?.[0]?.id ?? null;
}

/**
 * Fetch specific records by their Airtable record ids (batched into OR()
 * formula chunks). Fields are returned keyed by field id. Used to read back
 * admin-set rates before sending a contract for signature.
 */
export async function getRecords(tableId: string, ids: string[]): Promise<AirtableRecord[]> {
  const wanted = ids.filter(Boolean);
  if (wanted.length === 0) return [];
  const out: AirtableRecord[] = [];
  for (let i = 0; i < wanted.length; i += 50) {
    const chunk = wanted.slice(i, i + 50);
    const formula = `OR(${chunk.map((id) => `RECORD_ID()="${escapeFormulaValue(id)}"`).join(",")})`;
    const recs = await listRecords(tableId, { filterByFormula: formula, maxRecords: chunk.length });
    out.push(...recs);
  }
  return out;
}

export interface ListOptions {
  fields?: string[];
  filterByFormula?: string;
  pageSize?: number;
  maxRecords?: number;
}

/** List records, transparently paginating. Returns fields keyed by field id. */
export async function listRecords(tableId: string, options: ListOptions = {}): Promise<AirtableRecord[]> {
  const baseId = getBaseId();
  const out: AirtableRecord[] = [];
  let offset: string | undefined;
  do {
    const res = await airtableRequest<{ records: AirtableRecord[]; offset?: string }>(
      `/${baseId}/${tableId}`,
      {
        query: {
          filterByFormula: options.filterByFormula,
          pageSize: options.pageSize ?? 100,
          offset,
          returnFieldsByFieldId: 1,
        },
      },
    );
    out.push(...(res.records || []));
    offset = res.offset;
    if (options.maxRecords && out.length >= options.maxRecords) {
      return out.slice(0, options.maxRecords);
    }
  } while (offset);
  return out;
}

// ─── Meta API ─────────────────────────────────────────────────────────────────

export interface MetaField {
  id: string;
  name: string;
  type: string;
  options?: Record<string, unknown>;
}

export interface MetaTable {
  id: string;
  name: string;
  primaryFieldId: string;
  fields: MetaField[];
}

/** Connection check: list base tables. Surfaces a clear message on failure. */
export async function ping(): Promise<{ ok: boolean; tables: number; message: string }> {
  try {
    const tables = await listBaseTables();
    return { ok: true, tables: tables.length, message: `Connected — ${tables.length} tables.` };
  } catch (err) {
    const e = err as AirtableError;
    return { ok: false, tables: 0, message: `${e.message}${e.body ? ` — ${e.body}` : ""}` };
  }
}

export async function listBaseTables(): Promise<MetaTable[]> {
  const baseId = getBaseId();
  const res = await airtableRequest<{ tables: MetaTable[] }>(`/bases/${baseId}/tables`, { meta: true });
  return res.tables || [];
}

export async function listTableFields(tableId: string): Promise<MetaField[]> {
  const table = (await listBaseTables()).find((t) => t.id === tableId);
  return table?.fields || [];
}

export interface CreateFieldSpec {
  name: string;
  type: string;
  description?: string;
  options?: Record<string, unknown>;
}

/**
 * Create a new table in the base via the Meta API. The first field becomes the
 * primary field. Returns the created table (with field ids).
 */
export async function createTable(
  name: string,
  fields: CreateFieldSpec[],
  description?: string,
): Promise<MetaTable> {
  const baseId = getBaseId();
  return airtableRequest<MetaTable>(`/bases/${baseId}/tables`, {
    meta: true,
    method: "POST",
    body: { name, ...(description ? { description } : {}), fields },
  });
}

/** Add a field to an existing table via the Meta API. Returns the new field. */
export async function createField(tableId: string, field: CreateFieldSpec): Promise<MetaField> {
  const baseId = getBaseId();
  return airtableRequest<MetaField>(`/bases/${baseId}/tables/${tableId}/fields`, {
    meta: true,
    method: "POST",
    body: field,
  });
}

/**
 * Create a multipleRecordLinks field on `tableId` pointing at `linkedTableId`.
 * Airtable auto-creates the symmetric reverse field on the linked table.
 */
export async function createLinkField(
  tableId: string,
  name: string,
  linkedTableId: string,
): Promise<MetaField> {
  const baseId = getBaseId();
  return airtableRequest<MetaField>(`/bases/${baseId}/tables/${tableId}/fields`, {
    meta: true,
    method: "POST",
    body: {
      name,
      type: "multipleRecordLinks",
      options: { linkedTableId },
    },
  });
}
