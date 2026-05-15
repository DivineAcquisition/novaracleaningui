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
  return await fetch(url, { ...init, headers });
}

// ─── Custom-field id cache ────────────────────────────────────────────────
// `fieldKey` → field UUID. Populated once per cold start.
let fieldIdCache: Record<string, string> | null = null;
let fieldIdCachePromise: Promise<Record<string, string>> | null = null;

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

    const body: Json = {
      locationId: cfg.locationId,
      email: input.email || undefined,
      phone: input.phone || undefined,
      firstName: input.firstName || undefined,
      lastName: input.lastName || undefined,
      name: input.name || undefined,
      address1: input.address1 || undefined,
      city: input.city || undefined,
      state: input.state || undefined,
      postalCode: input.postalCode || undefined,
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
      log("upsertContact failed", { status: res.status, bodyPreview: text.slice(0, 200) });
      return null;
    }

    let parsed: Json = {};
    try { parsed = JSON.parse(text); } catch { /* ignore */ }
    const contact = (parsed.contact as Json | undefined) ?? parsed;
    const id = (contact?.id as string | undefined) || (parsed.id as string | undefined) || null;
    log("upsertContact ok", { id, isNew: parsed.new });
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

  const pipelineId = input.pipelineId || cfg.pipelineId;
  if (!pipelineId) {
    log("createOpportunity skipped — no pipelineId (set GHL_PIPELINE_ID)");
    return null;
  }

  try {
    const fieldMap = await loadCustomFieldMap(cfg);
    const customFields = buildCustomFieldsArray(fieldMap, input.customFieldsByKey);

    const body: Json = {
      locationId: cfg.locationId,
      contactId: input.contactId,
      pipelineId,
      pipelineStageId: input.pipelineStageId || cfg.pipelineStageId || undefined,
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
