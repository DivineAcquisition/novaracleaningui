// ─── GoHighLevel Private Integration client ────────────────────────────────
//
// Uses a Private Integration Token (PIT) — set GHL_PIT_TOKEN and GHL_LOCATION_ID
// as Supabase Edge Function secrets. This client is INTENTIONALLY tolerant of
// missing credentials: if either env var is empty it short-circuits without
// throwing so existing webhook flows are not disrupted.
//
// Reference: https://highlevel.stoplight.io/docs/integrations
// Auth header:  Authorization: Bearer pit-…
// Version:      2021-07-28
//
// All custom fields are looked up by `fieldKey` (not UUID) and the resolved
// id-map is cached per cold start.

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

type Json = Record<string, unknown>;

export interface GhlContactInput {
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  address1?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  source?: string | null;
  tags?: string[];
  // Custom fields, keyed by GHL `fieldKey` (e.g. "utm_content", "cleaning_type").
  customFieldsByKey?: Record<string, string | number | boolean | null | undefined>;
}

export interface GhlOpportunityInput {
  contactId: string;
  pipelineId?: string;
  pipelineStageId?: string;
  name: string;
  status?: "open" | "won" | "lost" | "abandoned";
  monetaryValue?: number;
  source?: string;
  assignedTo?: string;
  customFieldsByKey?: Record<string, string | number | boolean | null | undefined>;
}

interface GhlConfig {
  token: string;
  locationId: string;
  pipelineId?: string;
  pipelineStageId?: string;
}

function readConfig(): GhlConfig | null {
  // deno-lint-ignore no-explicit-any
  const env = (globalThis as any).Deno?.env;
  if (!env) return null;
  const token = (env.get("GHL_PIT_TOKEN") || "").trim();
  const locationId = (env.get("GHL_LOCATION_ID") || "").trim();
  if (!token || !locationId) return null;
  return {
    token,
    locationId,
    pipelineId: (env.get("GHL_PIPELINE_ID") || "").trim() || undefined,
    pipelineStageId: (env.get("GHL_PIPELINE_STAGE_ID") || "").trim() || undefined,
  };
}

function log(step: string, details?: unknown) {
  const suffix = details === undefined ? "" : ` ${JSON.stringify(details)}`;
  console.log(`[GHL] ${step}${suffix}`);
}

// Retry-on-failure wrapper for every GHL API call. Network blips +
// transient 5xx + 429 rate-limits get up to 3 attempts with
// exponential backoff (200 ms → 600 ms → 1.8 s). Non-retryable
// statuses (4xx other than 429) return immediately.
async function ghlFetch(
  cfg: GhlConfig,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = `${GHL_BASE}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.token}`,
    Version: GHL_VERSION,
    Accept: "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const maxAttempts = 3;
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, { ...init, headers });
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt === maxAttempts) return res;
      log("ghlFetch retrying", { attempt, status: res.status, path });
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts) {
        log("ghlFetch network error — giving up", {
          attempt,
          path,
          err: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
      log("ghlFetch network error retrying", {
        attempt,
        path,
        err: err instanceof Error ? err.message : String(err),
      });
    }
    // 200ms * 3^(attempt-1) → 200, 600, 1800 ms
    await new Promise((r) => setTimeout(r, 200 * Math.pow(3, attempt - 1)));
  }
  // Should be unreachable but TypeScript needs a value.
  throw lastErr instanceof Error ? lastErr : new Error("ghlFetch exhausted retries");
}

// ─── Custom-field id cache ────────────────────────────────────────────────
// `fieldKey` → field UUID. Populated once per cold start.
let fieldIdCache: Record<string, string> | null = null;
let fieldIdCachePromise: Promise<Record<string, string>> | null = null;

// ─── Pipeline / first-stage cache ─────────────────────────────────────────
// Used when GHL_PIPELINE_ID / GHL_PIPELINE_STAGE_ID are NOT set as env
// vars — we auto-discover the first pipeline and its first stage so
// opportunities still get created rather than silently no-op'ing.
let pipelineCache: { pipelineId: string; pipelineStageId: string } | null = null;
let pipelineCachePromise: Promise<{ pipelineId: string; pipelineStageId: string } | null> | null = null;

async function autoDiscoverPipeline(
  cfg: GhlConfig,
): Promise<{ pipelineId: string; pipelineStageId: string } | null> {
  if (pipelineCache) return pipelineCache;
  if (pipelineCachePromise) return await pipelineCachePromise;

  pipelineCachePromise = (async () => {
    try {
      const res = await ghlFetch(
        cfg,
        `/opportunities/pipelines?locationId=${encodeURIComponent(cfg.locationId)}`,
      );
      if (!res.ok) {
        log("auto-pipeline fetch failed", { status: res.status });
        return null;
      }
      const json = (await res.json()) as Json;
      const pipelines = (json.pipelines ?? []) as Array<{
        id?: string;
        name?: string;
        stages?: Array<{ id?: string; name?: string; position?: number }>;
      }>;
      if (pipelines.length === 0) {
        log("auto-pipeline — no pipelines on location");
        return null;
      }
      const p = pipelines[0];
      const stages = p.stages ?? [];
      const stage = stages.length > 0
        ? stages.slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0]
        : null;
      if (!p.id || !stage?.id) {
        log("auto-pipeline — pipeline or stage missing id", { pipelineName: p.name });
        return null;
      }
      const result = { pipelineId: p.id, pipelineStageId: stage.id };
      log("auto-pipeline resolved", { pipelineName: p.name, stageName: stage.name });
      pipelineCache = result;
      return result;
    } catch (err) {
      log("auto-pipeline error", { message: err instanceof Error ? err.message : String(err) });
      return null;
    }
  })();

  return await pipelineCachePromise;
}

async function loadCustomFieldMap(cfg: GhlConfig): Promise<Record<string, string>> {
  if (fieldIdCache) return fieldIdCache;
  if (fieldIdCachePromise) return await fieldIdCachePromise;

  fieldIdCachePromise = (async () => {
    const map: Record<string, string> = {};
    try {
      const res = await ghlFetch(
        cfg,
        `/locations/${encodeURIComponent(cfg.locationId)}/customFields`,
      );
      if (!res.ok) {
        log("custom-fields fetch failed", { status: res.status });
        return map;
      }
      const json = (await res.json()) as Json;
      const fields = (json.customFields ?? []) as Array<{
        id?: string;
        fieldKey?: string;
        key?: string;
        name?: string;
      }>;
      for (const f of fields) {
        if (!f.id) continue;
        // GHL returns fieldKey shaped like "contact.utm_content". Normalize to the
        // bare key portion so callers can pass either form.
        const rawKey = f.fieldKey || f.key || "";
        const bareKey = rawKey.split(".").pop() || rawKey;
        if (bareKey) map[bareKey] = f.id;
        if (rawKey) map[rawKey] = f.id;
        if (f.name) map[f.name] = f.id;
      }
      log("custom-fields loaded", { count: Object.keys(map).length });
    } catch (err) {
      log("custom-fields error", { message: err instanceof Error ? err.message : String(err) });
    }
    fieldIdCache = map;
    return map;
  })();

  return await fieldIdCachePromise;
}

function buildCustomFieldsArray(
  fieldMap: Record<string, string>,
  byKey?: Record<string, string | number | boolean | null | undefined>,
): Array<{ id: string; field_value: string }> {
  if (!byKey) return [];
  const out: Array<{ id: string; field_value: string }> = [];
  for (const [key, raw] of Object.entries(byKey)) {
    if (raw === undefined || raw === null || raw === "") continue;
    // Accept either bare key ("utm_content") or fully-qualified ("contact.utm_content")
    const id = fieldMap[key] ?? fieldMap[`contact.${key}`];
    if (!id) {
      log("custom-field key not found in GHL — skipping", { key });
      continue;
    }
    out.push({ id, field_value: String(raw) });
  }
  return out;
}

// ─── Public API ───────────────────────────────────────────────────────────

export function ghlIsConfigured(): boolean {
  return readConfig() !== null;
}

/**
 * Upsert a contact in GHL. Returns the contact id, or null if GHL is not configured
 * or the request fails. Never throws — this is fire-and-forget friendly.
 */
export async function upsertContact(input: GhlContactInput): Promise<string | null> {
  const cfg = readConfig();
  if (!cfg) {
    log("upsertContact skipped — GHL not configured");
    return null;
  }
  if (!input.email && !input.phone) {
    log("upsertContact skipped — no email or phone");
    return null;
  }

  try {
    const fieldMap = await loadCustomFieldMap(cfg);
    const customFields = buildCustomFieldsArray(fieldMap, input.customFieldsByKey);

    // Defensive split — if caller passed a full "Street, City, ST ZIP"
    // string as address1, lift City / State / ZIP out so each lands in
    // its native GHL slot and address1 contains the street only. This
    // mirrors the client-side parser so the API contract is the same
    // regardless of which integration path called us.
    const split = splitFullAddress(input.address1 || "");
    const finalStreet = split.street || input.address1 || undefined;
    const finalCity = input.city || split.city || undefined;
    const finalState = input.state || split.state || undefined;
    const finalZip = input.postalCode || split.zipCode || undefined;

    const body: Json = {
      locationId: cfg.locationId,
      email: input.email || undefined,
      phone: input.phone || undefined,
      firstName: input.firstName || undefined,
      lastName: input.lastName || undefined,
      name: input.name || undefined,
      address1: finalStreet,
      city: finalCity,
      state: finalState,
      postalCode: finalZip,
      country: input.country || "US",
      source: input.source || "Novara Booking",
      tags: input.tags && input.tags.length > 0 ? input.tags : undefined,
      customFields: customFields.length > 0 ? customFields : undefined,
    };

    // /contacts/upsert dedupes on email or phone within the location.
    const res = await ghlFetch(cfg, "/contacts/upsert", {
      method: "POST",
      body: JSON.stringify(body),
    });

    const text = await res.text();
    if (!res.ok) {
      log("upsertContact failed", { status: res.status, bodyPreview: text.slice(0, 500) });
      return null;
    }

    let parsed: Json = {};
    try { parsed = JSON.parse(text); } catch { /* ignore */ }
    const contact = (parsed.contact as Json | undefined) ?? parsed;
    const id = (contact?.id as string | undefined) || (parsed.id as string | undefined) || null;
    // Log how many custom fields actually came back so we can spot a
    // GHL-side drop (e.g. validation errors that silently strip MONETORY
    // values that have a "$" prefix when GHL expects raw numbers).
    const returnedFields = Array.isArray((contact as any)?.customFields) ? (contact as any).customFields.length : 0;
    log("upsertContact ok", {
      id,
      isNew: parsed.new,
      sent: customFields.length,
      returned: returnedFields,
    });
    return id;
  } catch (err) {
    log("upsertContact error", { message: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/**
 * Create an opportunity (the GHL equivalent of a "booking" in a pipeline).
 * Returns the opportunity id, or null on failure / when GHL is not configured.
 *
 * If pipelineId is not provided either in the input or as GHL_PIPELINE_ID,
 * this no-ops because GHL requires a pipeline.
 */
export async function createOpportunity(
  input: GhlOpportunityInput,
): Promise<string | null> {
  const cfg = readConfig();
  if (!cfg) {
    log("createOpportunity skipped — GHL not configured");
    return null;
  }

  // Resolve pipeline + stage: explicit input wins, env-var second,
  // auto-discover (first pipeline / first stage) third. This stops
  // opportunity creation from silently being skipped when the env
  // vars aren't set.
  let pipelineId = input.pipelineId || cfg.pipelineId;
  let pipelineStageId = input.pipelineStageId || cfg.pipelineStageId;
  if (!pipelineId || !pipelineStageId) {
    const discovered = await autoDiscoverPipeline(cfg);
    if (discovered) {
      pipelineId = pipelineId || discovered.pipelineId;
      pipelineStageId = pipelineStageId || discovered.pipelineStageId;
    }
  }
  if (!pipelineId) {
    log("createOpportunity skipped — could not resolve pipelineId");
    return null;
  }

  try {
    const fieldMap = await loadCustomFieldMap(cfg);
    const customFields = buildCustomFieldsArray(fieldMap, input.customFieldsByKey);

    const body: Json = {
      locationId: cfg.locationId,
      contactId: input.contactId,
      pipelineId,
      pipelineStageId: pipelineStageId || undefined,
      name: input.name,
      status: input.status || "open",
      monetaryValue: input.monetaryValue,
      source: input.source || "Novara Booking",
      assignedTo: input.assignedTo,
      customFields: customFields.length > 0 ? customFields : undefined,
    };

    const res = await ghlFetch(cfg, "/opportunities/", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      log("createOpportunity failed", { status: res.status, bodyPreview: text.slice(0, 200) });
      return null;
    }
    let parsed: Json = {};
    try { parsed = JSON.parse(text); } catch { /* ignore */ }
    const opp = (parsed.opportunity as Json | undefined) ?? parsed;
    const id = (opp?.id as string | undefined) || null;
    log("createOpportunity ok", { id });
    return id;
  } catch (err) {
    log("createOpportunity error", { message: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/**
 * Convenience helper: upsert a contact AND (if booking-related data is supplied)
 * create an opportunity for it. Never throws.
 *
 * For LIFECYCLE events (reschedule, cancel, complete) prefer
 * `syncBookingLifecycle` instead — it UPDATES the existing opportunity
 * for the contact rather than creating a duplicate every time.
 */
export async function syncContactAndOpportunity(args: {
  contact: GhlContactInput;
  opportunity?: Omit<GhlOpportunityInput, "contactId"> & { contactId?: string };
}): Promise<{ contactId: string | null; opportunityId: string | null }> {
  const contactId = await upsertContact(args.contact);
  if (!contactId || !args.opportunity) {
    return { contactId, opportunityId: null };
  }
  const opportunityId = await createOpportunity({ ...args.opportunity, contactId });
  return { contactId, opportunityId };
}

// ─── Opportunity lookup + update ──────────────────────────────────────────
//
// GHL's PIT API exposes:
//   GET  /opportunities/search?location_id=&contact_id=
//   PUT  /opportunities/:id    (body fields are partial — only what you send)
//
// We use these to keep ONE opportunity per booking and mutate its status
// + custom fields rather than spamming the pipeline with a new card on
// every reschedule / cancel / completion.

/**
 * Find the most-recent opportunity for a contact. Returns null when the
 * contact has no opportunities or GHL isn't configured. Never throws.
 */
export async function findLatestOpportunityForContact(
  contactId: string,
): Promise<{ id: string; name?: string; status?: string } | null> {
  const cfg = readConfig();
  if (!cfg || !contactId) return null;
  try {
    const url =
      `/opportunities/search?location_id=${encodeURIComponent(cfg.locationId)}` +
      `&contact_id=${encodeURIComponent(contactId)}&limit=20`;
    const res = await ghlFetch(cfg, url);
    if (!res.ok) {
      log("findLatestOpportunityForContact failed", { status: res.status });
      return null;
    }
    const json = (await res.json()) as Json;
    const opps = (json.opportunities ?? []) as Array<{
      id?: string; name?: string; status?: string; updatedAt?: string; createdAt?: string;
    }>;
    if (opps.length === 0) return null;
    opps.sort((a, b) => {
      const aT = Date.parse(a.updatedAt || a.createdAt || "") || 0;
      const bT = Date.parse(b.updatedAt || b.createdAt || "") || 0;
      return bT - aT;
    });
    const top = opps[0];
    return top.id ? { id: top.id, name: top.name, status: top.status } : null;
  } catch (err) {
    log("findLatestOpportunityForContact error", { message: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export interface GhlOpportunityUpdate {
  name?: string;
  status?: "open" | "won" | "lost" | "abandoned";
  pipelineId?: string;
  pipelineStageId?: string;
  monetaryValue?: number;
  assignedTo?: string;
  customFieldsByKey?: Record<string, string | number | boolean | null | undefined>;
}

/**
 * PUT /opportunities/:id — partial update. Returns true on 2xx, false
 * otherwise. Never throws.
 */
export async function updateOpportunity(
  opportunityId: string,
  patch: GhlOpportunityUpdate,
): Promise<boolean> {
  const cfg = readConfig();
  if (!cfg || !opportunityId) return false;
  try {
    const fieldMap = await loadCustomFieldMap(cfg);
    const customFields = buildCustomFieldsArray(fieldMap, patch.customFieldsByKey);
    const body: Json = {};
    if (patch.name !== undefined) body.name = patch.name;
    if (patch.status !== undefined) body.status = patch.status;
    if (patch.pipelineId !== undefined) body.pipelineId = patch.pipelineId;
    if (patch.pipelineStageId !== undefined) body.pipelineStageId = patch.pipelineStageId;
    if (patch.monetaryValue !== undefined) body.monetaryValue = patch.monetaryValue;
    if (patch.assignedTo !== undefined) body.assignedTo = patch.assignedTo;
    if (customFields.length > 0) body.customFields = customFields;

    const res = await ghlFetch(cfg, `/opportunities/${encodeURIComponent(opportunityId)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      log("updateOpportunity failed", { id: opportunityId, status: res.status, bodyPreview: text.slice(0, 200) });
      return false;
    }
    log("updateOpportunity ok", { id: opportunityId, status: patch.status });
    return true;
  } catch (err) {
    log("updateOpportunity error", { message: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/**
 * Lifecycle sync — single helper used by cancel/reschedule/complete and
 * the inbound-SMS handler. It:
 *   1. upserts the contact (refreshes address / tags / custom fields)
 *   2. finds the existing opportunity for that contact and PATCHES it
 *      (status + name + monetary + custom fields). If no opportunity
 *      exists yet, creates one — so partial-state bookings still land.
 *
 * Never throws. Returns the resolved contactId + opportunityId for
 * caller logging.
 */
export async function syncBookingLifecycle(args: {
  contact: GhlContactInput;
  opportunity: Omit<GhlOpportunityInput, "contactId">;
}): Promise<{ contactId: string | null; opportunityId: string | null; updated: boolean }> {
  const contactId = await upsertContact(args.contact);
  if (!contactId) return { contactId: null, opportunityId: null, updated: false };

  const existing = await findLatestOpportunityForContact(contactId);
  if (existing) {
    const ok = await updateOpportunity(existing.id, {
      name: args.opportunity.name,
      status: args.opportunity.status,
      monetaryValue: args.opportunity.monetaryValue,
      customFieldsByKey: args.opportunity.customFieldsByKey,
    });
    return { contactId, opportunityId: existing.id, updated: ok };
  }

  const newOppId = await createOpportunity({ ...args.opportunity, contactId });
  return { contactId, opportunityId: newOppId, updated: false };
}

// ─── Shared payload mappers ───────────────────────────────────────────────

/** Common helper: format cents as "$X.XX" for monetary GHL fields. */
export function fmtMoney(cents: number | null | undefined): string {
  if (!cents && cents !== 0) return "";
  return `$${(cents / 100).toFixed(2)}`;
}

/** Yes/No string for GHL dropdowns that store yes/no. */
export function ynBool(v: boolean | null | undefined): string {
  if (v === true) return "Yes";
  if (v === false) return "No";
  return "";
}

// ─── Address splitter (mirrors client-side parseAddressString) ────────────
const US_STATE_CODE_SET = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DC","DE","FL","GA","HI","ID","IL","IN",
  "IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH",
  "NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT",
  "VT","VA","WA","WV","WI","WY",
]);

/**
 * Pull ZIP + 2-letter state + city + street out of a freeform address.
 * Returns blank fields when nothing matches; the caller is responsible
 * for falling back to the original string.
 */
export function splitFullAddress(input: string): {
  street: string; city: string; state: string; zipCode: string;
} {
  const empty = { street: "", city: "", state: "", zipCode: "" };
  if (!input || typeof input !== "string") return empty;
  let work = input.trim().replace(/\s+/g, " ");
  if (!work) return empty;

  let zipCode = ""; let state = ""; let city = ""; let street = work;

  const zipMatch = work.match(/\b(\d{5})(?:-\d{4})?\b\s*$/);
  if (zipMatch) {
    zipCode = zipMatch[1];
    work = work.slice(0, zipMatch.index).trim().replace(/,\s*$/, "");
  }

  const stateMatch = work.match(/,?\s*([A-Za-z]{2})\s*$/);
  if (stateMatch && US_STATE_CODE_SET.has(stateMatch[1].toUpperCase())) {
    state = stateMatch[1].toUpperCase();
    work = work.slice(0, stateMatch.index).trim().replace(/,\s*$/, "");
  }

  const lastComma = work.lastIndexOf(",");
  if (lastComma >= 0) {
    city = work.slice(lastComma + 1).trim();
    street = work.slice(0, lastComma).trim();
  } else {
    street = work;
  }

  return { street, city, state, zipCode };
}
