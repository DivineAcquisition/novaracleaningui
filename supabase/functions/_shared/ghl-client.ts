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

import { toE164US } from "./phone-format.ts";
import {
  expandGhlCustomFieldKeys,
  GHL_FIELD_KEY_ALIASES,
  resolveGhlFieldId,
} from "./ghl-field-aliases.ts";
import {
  inferDispatchStage,
  resolveJobDispatchPipeline,
  stageIdForKey,
  type DispatchStageContext,
} from "./ghl-dispatch-pipeline.ts";
import {
  enforceTagPolicy,
  LEAD_STAGE_TAG_SET,
  MAX_TAGS_PER_CONTACT,
  normalizeTag,
} from "./ghl-tags.ts";

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
  /**
   * Assert `tags` WITHOUT replacing the contact's other tags.
   *
   * /contacts/upsert replaces the whole tag array, so a caller asserting one
   * lifecycle tag ("member - paused") was wiping the contact's role, service,
   * ZIP and source. With this set, the upsert sends fields only and the tags are
   * then merged in through the append/remove endpoints. Use it whenever the
   * caller only knows PART of the picture — which is most lifecycle events.
   */
  mergeTags?: boolean;
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
  followers?: string[];
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

// ─── Owner / location-user resolution ─────────────────────────────────────
let ownerIdCache: string | null | undefined; // undefined = not yet resolved
let locationUsersCache:
  | Array<{ id: string; email: string; name: string }>
  | null = null;
let locationUsersPromise:
  | Promise<Array<{ id: string; email: string; name: string }>>
  | null = null;

async function loadLocationUsers(
  cfg: GhlConfig,
): Promise<Array<{ id: string; email: string; name: string }>> {
  if (locationUsersCache) return locationUsersCache;
  if (locationUsersPromise) return await locationUsersPromise;
  locationUsersPromise = (async () => {
    try {
      const res = await ghlFetch(
        cfg,
        `/users/?locationId=${encodeURIComponent(cfg.locationId)}`,
      );
      if (!res.ok) {
        log("loadLocationUsers failed", { status: res.status });
        return [];
      }
      const json = (await res.json()) as Json;
      const users = (json.users ?? []) as Array<Record<string, unknown>>;
      const mapped = users
        .map((u) => ({
          id: String(u.id || ""),
          email: String(u.email || "").trim().toLowerCase(),
          name: (`${u.firstName || ""} ${u.lastName || ""}`.trim() ||
            String(u.name || "")).toLowerCase(),
        }))
        .filter((u) => u.id);
      locationUsersCache = mapped;
      return mapped;
    } catch (err) {
      log("loadLocationUsers error", {
        message: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  })();
  return await locationUsersPromise;
}

/** Resolve a GHL location user id by email (preferred) or full name. */
export async function resolveLocationUserId(
  opts: { email?: string | null; name?: string | null },
): Promise<string | null> {
  const cfg = readConfig();
  if (!cfg) return null;
  const email = (opts.email || "").trim().toLowerCase();
  const name = (opts.name || "").trim().toLowerCase();
  if (!email && !name) return null;
  const users = await loadLocationUsers(cfg);
  if (email) {
    const m = users.find((u) => u.email === email);
    if (m) return m.id;
  }
  if (name) {
    const m = users.find((u) => u.name === name);
    if (m) return m.id;
  }
  return null;
}

/**
 * Resolve the default opportunity owner (Malik). GHL_OWNER_USER_ID wins;
 * otherwise GHL_OWNER_EMAIL (default maliksannie7@gmail.com) is matched
 * against the location user list. Cached for the cold start.
 */
export async function resolveOwnerUserId(): Promise<string | null> {
  if (ownerIdCache !== undefined) return ownerIdCache;
  const cfg = readConfig();
  if (!cfg) {
    ownerIdCache = null;
    return null;
  }
  // deno-lint-ignore no-explicit-any
  const env = (globalThis as any).Deno?.env;
  const explicit = (env?.get("GHL_OWNER_USER_ID") || "").trim();
  if (explicit) {
    ownerIdCache = explicit;
    return explicit;
  }
  const ownerEmail = (env?.get("GHL_OWNER_EMAIL") || "maliksannie7@gmail.com").trim();
  const resolved = await resolveLocationUserId({ email: ownerEmail });
  ownerIdCache = resolved;
  log("owner resolved", { ownerEmail, ownerId: resolved });
  return resolved;
}

/** Add followers to an opportunity (separate GHL endpoint). Never throws. */
export async function addOpportunityFollowers(
  opportunityId: string,
  userIds: string[],
): Promise<boolean> {
  const cfg = readConfig();
  const ids = (userIds || []).filter(Boolean);
  if (!cfg || !opportunityId || ids.length === 0) return false;
  try {
    const res = await ghlFetch(
      cfg,
      `/opportunities/${encodeURIComponent(opportunityId)}/followers`,
      { method: "POST", body: JSON.stringify({ followers: ids }) },
    );
    if (!res.ok) {
      log("addOpportunityFollowers failed", { status: res.status });
      return false;
    }
    log("addOpportunityFollowers ok", { opportunityId, count: ids.length });
    return true;
  } catch (err) {
    log("addOpportunityFollowers error", {
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/** Read a contact's current tags. Returns null when the read fails. */
export async function getContactTags(contactId: string): Promise<string[] | null> {
  const cfg = readConfig();
  if (!cfg || !contactId) return null;
  try {
    const res = await ghlFetch(cfg, `/contacts/${encodeURIComponent(contactId)}`, {});
    if (!res.ok) {
      log("getContactTags failed", { status: res.status });
      return null;
    }
    const parsed = (await res.json()) as Json;
    const contact = (parsed.contact as Json | undefined) ?? parsed;
    const tags = contact?.tags;
    return Array.isArray(tags) ? tags.map((t) => String(t)) : [];
  } catch (err) {
    log("getContactTags error", { message: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export interface TagReconcileResult {
  ok: boolean;
  final: string[];
  added: string[];
  removed: string[];
  reason?: string;
}

/**
 * Assert some tags on a contact WITHOUT destroying the rest.
 *
 * This is the fix for the narrow callers — "membership-paused", "cancelled",
 * "payment-method-updated" — that used to upsert a one-element tag array and,
 * because upsert replaces, wiped every other tag the contact had. Read, merge,
 * run the policy, then move only the difference using the append/delete
 * endpoints.
 *
 * `replaceSlots` lets a caller say "this supersedes whatever was in the status
 * slot" — a paused membership should not sit next to an active one.
 */
export async function reconcileContactTags(
  contactId: string,
  asserting: (string | null | undefined)[],
): Promise<TagReconcileResult> {
  const cfg = readConfig();
  if (!cfg || !contactId) return { ok: false, final: [], added: [], removed: [], reason: "no config" };

  const current = await getContactTags(contactId);
  if (current === null) {
    // Couldn't read, so we can't merge safely. Appending is the conservative
    // move: it may leave the contact briefly over the cap, and the next sweep
    // or upsert will settle it — better than deleting tags on a guess.
    const appended = await addContactTags(contactId, asserting as string[]);
    return {
      ok: appended,
      final: [],
      added: enforceTagPolicy(asserting).tags,
      removed: [],
      reason: "could not read current tags — appended without merging",
    };
  }

  // Asserted tags go LAST so they win their slot against the contact's history.
  const policy = enforceTagPolicy([...current, ...asserting]);
  const final = policy.tags;
  const finalSet = new Set(final);
  const currentSet = new Set(current);

  const toAdd = final.filter((t) => !currentSet.has(t));
  const toRemove = current.filter((t) => !finalSet.has(t));

  let ok = true;
  if (toRemove.length > 0) ok = (await removeContactTags(contactId, toRemove)) && ok;
  if (toAdd.length > 0) ok = (await addContactTags(contactId, toAdd)) && ok;

  if (toAdd.length > 0 || toRemove.length > 0) {
    log("tags reconciled", { contactId, added: toAdd, removed: toRemove, final });
  }
  return { ok, final, added: toAdd, removed: toRemove };
}

/** Add canonical tags to a contact, policy-capped. Never throws. */
export async function addContactTags(
  contactId: string,
  tags: string[],
): Promise<boolean> {
  const cfg = readConfig();
  if (!cfg || !contactId) return false;
  const clean = enforceTagPolicy(tags, { max: MAX_TAGS_PER_CONTACT }).tags;
  if (clean.length === 0) return false;
  try {
    const res = await ghlFetch(
      cfg,
      `/contacts/${encodeURIComponent(contactId)}/tags`,
      { method: "POST", body: JSON.stringify({ tags: clean }) },
    );
    return res.ok;
  } catch {
    return false;
  }
}

/** Remove tags from a contact. Never throws. */
export async function removeContactTags(
  contactId: string,
  tags: string[],
): Promise<boolean> {
  const cfg = readConfig();
  const list = (tags || []).filter(Boolean);
  if (!cfg || !contactId || list.length === 0) return false;
  try {
    const res = await ghlFetch(
      cfg,
      `/contacts/${encodeURIComponent(contactId)}/tags`,
      { method: "DELETE", body: JSON.stringify({ tags: list }) },
    );
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Move a contact to a single canonical lead stage, removing any other
 * lead-* stage tags so the lead funnel reflects exactly one stage.
 */
export async function setContactLeadStage(
  contactId: string,
  stage: string,
): Promise<boolean> {
  const cfg = readConfig();
  if (!cfg || !contactId) return false;
  const target = normalizeTag(stage);
  const toRemove = [...LEAD_STAGE_TAG_SET].filter((t) => t !== target);
  await removeContactTags(contactId, toRemove);
  return await addContactTags(contactId, [target]);
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
// vars — we auto-discover the best SALES pipeline (NEVER the hiring /
// contractor pipeline) and its first stage so opportunities still get
// created rather than silently no-op'ing.

// Pipelines we must NEVER drop a customer/sales opportunity into. The
// hiring / recruiting / contractor onboarding funnel is for cleaners, not
// customers — a booking landing here is the bug this guards against.
const HIRING_PIPELINE_RE =
  /\b(hir|recruit|cleaner|team|onboard|driver|contractor|applicant|interview|candidate)\b/i;
// The Job Dispatch (fulfillment) pipeline is handled explicitly elsewhere;
// it should not be the generic fallback for a sales opportunity either.
const DISPATCH_PIPELINE_RE = /dispatch|fulfil|fulfill|job\s*board/i;
// Pipelines that clearly ARE the sales/customer funnel.
const SALES_PIPELINE_RE = /sales|customer|booking|revenue|client|lead/i;

let pipelineCache: { pipelineId: string; pipelineStageId: string } | null = null;
let pipelineCachePromise: Promise<{ pipelineId: string; pipelineStageId: string } | null> | null = null;

function firstStageId(
  stages?: Array<{ id?: string; name?: string; position?: number }>,
): string | undefined {
  if (!stages || stages.length === 0) return undefined;
  return stages.slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0]?.id;
}

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

      // Selection priority (a customer/sales opportunity must NEVER land in
      // the hiring pipeline):
      //   1. an explicit sales-named pipeline
      //   2. the first pipeline that is neither hiring nor dispatch
      //   3. the first non-hiring pipeline
      // We deliberately stop here rather than falling back to pipelines[0]
      // (which is frequently the Hiring pipeline).
      const nonHiring = pipelines.filter((p) => p.id && !HIRING_PIPELINE_RE.test(p.name || ""));
      const chosen =
        nonHiring.find((p) => SALES_PIPELINE_RE.test(p.name || "")) ||
        nonHiring.find((p) => !DISPATCH_PIPELINE_RE.test(p.name || "")) ||
        nonHiring[0];

      if (!chosen?.id) {
        log("auto-pipeline — no non-hiring pipeline found; refusing to use hiring pipeline", {
          pipelineNames: pipelines.map((p) => p.name),
        });
        return null;
      }
      const stageId = firstStageId(chosen.stages);
      if (!stageId) {
        log("auto-pipeline — chosen pipeline has no stage", { pipelineName: chosen.name });
        return null;
      }
      const result = { pipelineId: chosen.id, pipelineStageId: stageId };
      log("auto-pipeline resolved", { pipelineName: chosen.name });
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

/** Ops/dispatch keys we always send (including empty) so GHL clears stale contractors. */
export const GHL_OPS_CLEARABLE_KEYS = new Set([
  "1_contractor",
  "2_contractor",
  "3_contractor",
  "1_contractor_number",
  "2_contractor_number",
  "3_contractor_number",
  "1_contractor_pay",
  "2_contractor_pay",
  "3_contractor_pay",
  "1_contractor_pay_percentage",
  "2_contractor_pay_percentage",
  "3_contractor_pay_percentage",
  "team_size_assigned",
  "estimated_duration_hrs",
]);

function buildCustomFieldsArray(
  fieldMap: Record<string, string>,
  byKey?: Record<string, string | number | boolean | null | undefined>,
  options?: { clearableKeys?: Set<string> },
): Array<{ id: string; field_value: string }> {
  if (!byKey) return [];
  const clearable = options?.clearableKeys;
  const expanded = expandGhlCustomFieldKeys(fieldMap, byKey);
  const out: Array<{ id: string; field_value: string }> = [];
  const seenIds = new Set<string>();

  for (const [key, raw] of Object.entries(expanded)) {
    const forceEmpty = isClearableEmptyField(key, raw, clearable);
    if ((raw === undefined || raw === null || raw === "") && !forceEmpty) continue;
    const id = resolveGhlFieldId(fieldMap, key) ?? fieldMap[key] ?? fieldMap[`contact.${key}`];
    if (!id) {
      if (!GHL_FIELD_KEY_ALIASES_SKIP_LOG.has(key)) {
        log("custom-field key not found in GHL — skipping", { key });
      }
      continue;
    }
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    out.push({ id, field_value: forceEmpty ? "" : String(raw) });
  }
  return out;
}

const GHL_FIELD_KEY_ALIASES_SKIP_LOG = new Set(
  Object.values(GHL_FIELD_KEY_ALIASES).flat().filter((k) => k.includes(".") || k.includes(" ")),
);

function isClearableEmptyField(
  key: string,
  raw: string | number | boolean | null | undefined,
  clearable?: Set<string>,
): boolean {
  if (!clearable || (raw !== "" && raw !== null)) return false;
  if (clearable.has(key)) return true;
  for (const [canonical, aliases] of Object.entries(GHL_FIELD_KEY_ALIASES)) {
    if (!clearable.has(canonical)) continue;
    if (canonical === key || aliases.includes(key)) return true;
  }
  return false;
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
    const usesOpsClear = Object.keys(input.customFieldsByKey || {}).some((k) =>
      GHL_OPS_CLEARABLE_KEYS.has(k)
    );
    const customFields = buildCustomFieldsArray(
      fieldMap,
      input.customFieldsByKey,
      usesOpsClear ? { clearableKeys: GHL_OPS_CLEARABLE_KEYS } : undefined,
    );

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

    const phoneE164 = toE164US(input.phone) || undefined;

    let tagsForUpsert: string[] | undefined;
    if (input.tags && input.tags.length > 0 && !input.mergeTags) {
      const policy = enforceTagPolicy(input.tags);
      if (policy.dropped.length > 0) {
        log("tags dropped by policy", {
          kept: policy.tags,
          dropped: policy.dropped.map((d) => `${d.tag} (${d.reason})`),
        });
      }
      tagsForUpsert = policy.tags.length > 0 ? policy.tags : undefined;
    }

    const body: Json = {
      locationId: cfg.locationId,
      email: input.email || undefined,
      phone: phoneE164,
      firstName: input.firstName || undefined,
      lastName: input.lastName || undefined,
      name: input.name || undefined,
      address1: finalStreet,
      city: finalCity,
      state: finalState,
      postalCode: finalZip,
      country: input.country || "US",
      source: input.source || "Novara Booking",
      // The tag policy is enforced HERE, at the one place nearly every write
      // passes through, rather than trusted to twenty call sites. /contacts/
      // upsert REPLACES the tag array, so whatever survives the policy is the
      // contact's complete tag set — which is exactly why the policy has to
      // produce a coherent set rather than a fragment.
      tags: tagsForUpsert,
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

    // Merge mode: the upsert deliberately carried no tags (so nothing was
    // replaced); assert them against what the contact already has.
    if (input.mergeTags && id && input.tags && input.tags.length > 0) {
      await reconcileContactTags(id, input.tags);
    }

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
  // sales-preferring auto-discovery third. We intentionally do NOT fall
  // back to the Job Dispatch pipeline here — dispatch placement is always
  // supplied explicitly by syncBookingLifecycle({ dispatchStage }). And
  // auto-discovery now refuses to ever return the hiring pipeline, so a
  // customer/sales opportunity can never be filed under recruiting.
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
    log("createOpportunity skipped — could not resolve a non-hiring pipelineId");
    return null;
  }

  try {
    const fieldMap = await loadCustomFieldMap(cfg);
    const usesOpsClear = Object.keys(input.customFieldsByKey || {}).some((k) =>
      GHL_OPS_CLEARABLE_KEYS.has(k)
    );
    const customFields = buildCustomFieldsArray(
      fieldMap,
      input.customFieldsByKey,
      usesOpsClear ? { clearableKeys: GHL_OPS_CLEARABLE_KEYS } : undefined,
    );

    const ownerId = input.assignedTo || (await resolveOwnerUserId()) || undefined;
    const body: Json = {
      locationId: cfg.locationId,
      contactId: input.contactId,
      pipelineId,
      pipelineStageId: pipelineStageId || undefined,
      name: input.name,
      status: input.status || "open",
      monetaryValue: input.monetaryValue,
      source: input.source || "Novara Booking",
      assignedTo: ownerId,
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
    if (id && input.followers && input.followers.length > 0) {
      await addOpportunityFollowers(id, input.followers);
    }
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
/**
 * Find the most-recent opportunity for a contact in a specific pipeline.
 */
export async function findOpportunityForContactInPipeline(
  contactId: string,
  pipelineId: string,
): Promise<{ id: string; name?: string; status?: string } | null> {
  const cfg = readConfig();
  if (!cfg || !contactId || !pipelineId) return null;
  try {
    const url =
      `/opportunities/search?location_id=${encodeURIComponent(cfg.locationId)}` +
      `&contact_id=${encodeURIComponent(contactId)}` +
      `&pipeline_id=${encodeURIComponent(pipelineId)}&limit=10`;
    const res = await ghlFetch(cfg, url);
    if (!res.ok) {
      log("findOpportunityForContactInPipeline failed", { status: res.status });
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
    log("findOpportunityForContactInPipeline error", {
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ─── Sales-pipeline fulfillment-stage resolution (by NAME) ─────────────────
//
// The opportunity should visibly move through the fulfillment cycle even when
// there's no dedicated Job Dispatch pipeline configured. Since stage UUIDs vary
// per account, we resolve the configured Sales pipeline's stages by NAME and
// pick the one that matches the booking's current state. Returns undefined when
// nothing sensible matches (caller then leaves the stage unchanged).

const SALES_STAGE_PATTERNS: Record<string, RegExp[]> = {
  // Order matters for selection, not matching.
  paid: [/\bpaid\b/i],
  won: [/\bwon\b/i, /closed[\s-]*won/i, /\bcomplete/i, /\bfinished\b/i],
  lost: [/\blost\b/i, /closed[\s-]*lost/i, /\bcancel/i, /\bdead\b/i],
  in_progress: [/in[\s-]*progress/i, /\bcleaning\b/i, /\bservicing\b/i, /\bon[\s-]*site\b/i, /\ben[\s-]*route\b/i, /\bactive\b/i, /\bstarted\b/i],
  scheduled: [/\bschedul/i, /\bassigned\b/i, /\bconfirmed\b/i, /\bdispatch/i, /\bupcoming\b/i],
  booked: [/\bbooked\b/i, /\bnew\b/i, /\blead\b/i, /\bdeposit\b/i, /\bopen\b/i, /\bquote/i],
};

let salesStagesCache: Record<string, Record<string, string>> = {};

async function loadPipelineStagesByName(pipelineId: string): Promise<Record<string, string>> {
  if (salesStagesCache[pipelineId]) return salesStagesCache[pipelineId];
  const cfg = readConfig();
  if (!cfg || !pipelineId) return {};
  try {
    const res = await ghlFetch(
      cfg,
      `/opportunities/pipelines?locationId=${encodeURIComponent(cfg.locationId)}`,
    );
    if (!res.ok) return {};
    const json = (await res.json()) as {
      pipelines?: Array<{ id?: string; stages?: Array<{ id?: string; name?: string }> }>;
    };
    const pipe = (json.pipelines || []).find((p) => p.id === pipelineId);
    const map: Record<string, string> = {};
    for (const stage of pipe?.stages || []) {
      if (stage.id && stage.name) map[stage.name] = stage.id;
    }
    salesStagesCache[pipelineId] = map;
    return map;
  } catch {
    return {};
  }
}

export interface SalesStageContext {
  bookingStatus?: string | null;
  payoutStatus?: string | null;
  cleanerId?: string | null;
  serviceDate?: string | null;
}

/**
 * Resolve the Sales-pipeline stage id that matches a booking's current
 * fulfillment state, matching the pipeline's stage NAMES. Returns undefined
 * when no stage matches (caller leaves the stage as-is).
 */
export async function resolveSalesStageForBooking(
  pipelineId: string,
  ctx: SalesStageContext,
): Promise<string | undefined> {
  const stagesByName = await loadPipelineStagesByName(pipelineId);
  if (Object.keys(stagesByName).length === 0) return undefined;

  // name → key resolution
  const idForKey: Partial<Record<string, string>> = {};
  for (const [name, id] of Object.entries(stagesByName)) {
    for (const [key, patterns] of Object.entries(SALES_STAGE_PATTERNS)) {
      if (idForKey[key]) continue;
      if (patterns.some((re) => re.test(name))) idForKey[key] = id;
    }
  }

  const status = String(ctx.bookingStatus || "").toLowerCase();
  const payout = String(ctx.payoutStatus || "").toLowerCase();

  // Desired key by fulfillment state, with graceful fallbacks.
  const want: string[] = [];
  if (status === "cancelled") want.push("lost");
  else if (payout === "completed" || payout === "paid") want.push("paid", "won");
  else if (status === "completed" || status === "pending_review") want.push("won", "in_progress", "scheduled");
  else if (status === "in_progress") want.push("in_progress", "scheduled", "booked");
  else if (ctx.cleanerId && (status === "assigned" || status === "confirmed")) want.push("scheduled", "booked");
  else if (status === "confirmed" || status === "pending_details") want.push("booked", "scheduled");

  for (const key of want) {
    if (idForKey[key]) return idForKey[key];
  }
  return undefined;
}

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
  followers?: string[];
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
    const usesOpsClear = Object.keys(patch.customFieldsByKey || {}).some((k) =>
      GHL_OPS_CLEARABLE_KEYS.has(k)
    );
    const customFields = buildCustomFieldsArray(
      fieldMap,
      patch.customFieldsByKey,
      usesOpsClear ? { clearableKeys: GHL_OPS_CLEARABLE_KEYS } : undefined,
    );
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
    if (patch.followers && patch.followers.length > 0) {
      await addOpportunityFollowers(opportunityId, patch.followers);
    }
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
  /** Stored bookings.ghl_opportunity_id — preferred when still valid. */
  opportunityId?: string | null;
  /** When set, moves the opportunity on the Job Dispatch pipeline. */
  dispatchStage?: DispatchStageContext;
  /** GHL user ids to add as opportunity followers (e.g. the booking VA). */
  followers?: string[];
}): Promise<{ contactId: string | null; opportunityId: string | null; updated: boolean }> {
  const contactId = await upsertContact(args.contact);
  if (!contactId) return { contactId: null, opportunityId: null, updated: false };

  const ownerId = args.opportunity.assignedTo || (await resolveOwnerUserId()) || undefined;

  const cfg = readConfig();
  let pipelineId: string | undefined;
  let pipelineStageId: string | undefined;

  if (cfg && args.dispatchStage) {
    const dispatchCfg = await resolveJobDispatchPipeline(cfg, ghlFetch);
    if (dispatchCfg) {
      pipelineId = dispatchCfg.pipelineId;
      const stageKey = inferDispatchStage(args.dispatchStage);
      pipelineStageId = stageIdForKey(dispatchCfg, stageKey);
      log("dispatch stage resolved", { stageKey, pipelineStageId });
    } else {
      // We were asked to sync the Job Dispatch pipeline but couldn't
      // resolve it. Do NOT fall through to creating/updating some other
      // (e.g. sales or hiring) opportunity with dispatch data — that's how
      // bookings ended up on the wrong pipeline. The Sales Pipeline is kept
      // current separately via syncBookingSalesPipeline.
      log("dispatch sync skipped — Job Dispatch pipeline not resolved (set GHL_DISPATCH_PIPELINE_ID)");
      return { contactId, opportunityId: args.opportunityId ?? null, updated: false };
    }
  }

  let existing: { id: string } | null = null;

  // Job Dispatch sync must never hijack a Sales Pipeline opportunity.
  // Only look up / create opportunities on the dispatch pipeline.
  if (args.dispatchStage && pipelineId) {
    existing = await findOpportunityForContactInPipeline(contactId, pipelineId);
  } else {
    if (args.opportunityId) {
      existing = { id: args.opportunityId };
    } else if (pipelineId) {
      existing = await findOpportunityForContactInPipeline(contactId, pipelineId);
    }
    if (!existing) {
      existing = await findLatestOpportunityForContact(contactId);
    }
  }

  if (existing) {
    const ok = await updateOpportunity(existing.id, {
      name: args.opportunity.name,
      status: args.opportunity.status,
      monetaryValue: args.opportunity.monetaryValue,
      customFieldsByKey: args.opportunity.customFieldsByKey,
      assignedTo: ownerId,
      followers: args.followers,
      pipelineId,
      pipelineStageId,
    });
    return { contactId, opportunityId: existing.id, updated: ok };
  }

  const newOppId = await createOpportunity({
    ...args.opportunity,
    contactId,
    assignedTo: args.opportunity.assignedTo || ownerId,
    followers: args.followers,
    pipelineId: pipelineId || args.opportunity.pipelineId,
    pipelineStageId: pipelineStageId || args.opportunity.pipelineStageId,
  });
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
