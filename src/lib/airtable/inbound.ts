// ─── Inbound: Airtable → workspace, near-real-time ────────────────────────────
//
// Makes remote (Airtable-side) changes reach the workspace within seconds:
//
//   1. WEBHOOK (preferred): we register an Airtable webhook on the Revenue Ops
//      base pointing at /api/airtable/webhook. Airtable pings on every change;
//      we fetch the change payloads (cursor-based, at-least-once) and:
//        • bump the remote-change marker so Airtable-reading views (partner
//          admin Host Accounts, dashboards) refresh their snapshot immediately
//          instead of serving up-to-5-minute-old data;
//        • detect CONFLICTS: a human editing (in Airtable) a field whose source
//          of truth is the workspace gets flagged for review — the workspace
//          value wins on the next sync, and the overwrite is never silent;
//        • detect identity-key edits (Email / Job ID / nicknames / Run ID) —
//          those risk duplicate records on the next upsert, so they're flagged
//          as identity issues;
//        • detect remote deletions of app-owned rows (the workspace copy is
//          the durable one; the row reappears on the next sync — flagged, not
//          mirrored);
//        • flag edits to fields outside the known mapping (never guessed).
//      Webhooks expire after 7 days; listing payloads (our 5-min poll cron)
//      and the daily ensure pass keep it alive indefinitely.
//
//   2. POLL FALLBACK: when no webhook can be registered (PAT lacks
//      webhook:manage, or the PAT owner isn't the base creator) a 5-minute
//      LAST_MODIFIED_TIME() probe detects that the base changed and bumps the
//      marker — freshness holds, just without field-level conflict detail.
//
// Direction rules are NOT changed here: Airtable keeps owning what it owns
// (STR pricing/lifecycle/status); the workspace keeps owning operational data.
// This file only detects and reports — it never writes into Supabase business
// tables and never writes to Airtable.

import crypto from "crypto";

import { airtableRequest, getBaseId, listBaseTables, listRecords } from "./client";
import { getAdminSupabase } from "./sources/admin-client";
import {
  CLIENT_FIELDS,
  COMMERCIAL_ACCOUNT_FIELDS,
  JOB_FIELDS,
  PAYROLL_RUN_FIELDS,
  PROPERTY_FIELDS,
  SITE_FIELDS,
  TABLES,
} from "./schema";
import {
  bumpRemoteChangeMarker,
  flagForReview,
  getInboundState,
  stampInboundChecked,
} from "./telemetry";

// ─── Field ownership: who is the source of truth for each mapped field ───────
// Straight from the existing mappers — nothing invented. "app" fields are
// pushed by the workspace (a remote edit = conflict, workspace wins next
// sync); "airtable" fields are managed in Airtable (partner-admin writes them
// there deliberately); "key" fields are the upsert merge keys (a remote edit
// risks a duplicate record).

interface TableOwnership {
  /** Human-readable table name for flags. */
  name: string;
  /** Health flow this table reports under. */
  flow: string;
  /** Merge-key field ids — remote edits are identity-critical. */
  keyFieldIds: string[];
  /** Field ids the WORKSPACE owns (remote edits conflict). */
  appFieldIds: string[];
  /** Field NAMES the workspace owns (link/QC fields written by name). */
  appFieldNames: string[];
  /** Field ids Airtable legitimately owns — remote edits are expected. */
  airtableFieldIds: string[];
}

const STATIC_OWNERSHIP: Record<string, TableOwnership> = {
  [TABLES.clients]: {
    name: "Clients",
    flow: "client",
    keyFieldIds: [CLIENT_FIELDS.email],
    appFieldIds: [
      CLIENT_FIELDS.clientName,
      CLIENT_FIELDS.clientType,
      CLIENT_FIELDS.company,
      CLIENT_FIELDS.phone,
      CLIENT_FIELDS.serviceZone,
      CLIENT_FIELDS.leadSource,
      CLIENT_FIELDS.agreementSigned,
      CLIENT_FIELDS.agreementType,
      CLIENT_FIELDS.stripeCustomerId,
      CLIENT_FIELDS.smsOptIn,
    ],
    appFieldNames: [],
    // Admin-managed in Airtable (partner-admin console writes these there).
    airtableFieldIds: [
      CLIENT_FIELDS.lifecycleStage,
      CLIENT_FIELDS.onboardingStage,
      CLIENT_FIELDS.paymentMethodOnFile,
      CLIENT_FIELDS.notes,
      CLIENT_FIELDS.propertiesCount,
    ],
  },
  [TABLES.jobs]: {
    name: "Jobs",
    flow: "job",
    keyFieldIds: [JOB_FIELDS.jobId],
    appFieldIds: [
      JOB_FIELDS.dateCompleted,
      JOB_FIELDS.serviceType,
      JOB_FIELDS.customerPaid,
      JOB_FIELDS.cleanerName,
      JOB_FIELDS.numberOfCleaners,
      JOB_FIELDS.tierPctLocked,
      JOB_FIELDS.cleanerPayPool,
      JOB_FIELDS.payPerCleaner,
      JOB_FIELDS.payPeriod,
      JOB_FIELDS.paymentStatus,
      JOB_FIELDS.entrySource,
      JOB_FIELDS.clientLinkId,
    ],
    appFieldNames: ["Property", "Payroll Run", "Drive Folder", "Documented"],
    airtableFieldIds: [],
  },
  [TABLES.properties]: {
    name: "Properties",
    flow: "partner",
    keyFieldIds: [PROPERTY_FIELDS.propertyNickname],
    appFieldIds: [
      PROPERTY_FIELDS.address,
      PROPERTY_FIELDS.bedrooms,
      PROPERTY_FIELDS.bathrooms,
      PROPERTY_FIELDS.hostLinkId,
    ],
    appFieldNames: [],
    // Airtable owns pricing / status / access — the whole point of the
    // partner-admin console.
    airtableFieldIds: [
      PROPERTY_FIELDS.sqft,
      PROPERTY_FIELDS.standardTurnoverRate,
      PROPERTY_FIELDS.introRate,
      PROPERTY_FIELDS.introRateEndDate,
      PROPERTY_FIELDS.linenIncluded,
      PROPERTY_FIELDS.restockIncluded,
      PROPERTY_FIELDS.accessType,
      PROPERTY_FIELDS.accessInstructions,
      PROPERTY_FIELDS.stagingNotes,
      PROPERTY_FIELDS.propertyStatus,
      PROPERTY_FIELDS.turnoverFrequency,
    ],
  },
  [TABLES.commercialAccounts]: {
    name: "Commercial Accounts",
    flow: "commercial",
    keyFieldIds: [COMMERCIAL_ACCOUNT_FIELDS.businessName],
    appFieldIds: [
      COMMERCIAL_ACCOUNT_FIELDS.accountType,
      COMMERCIAL_ACCOUNT_FIELDS.accountStatus,
      COMMERCIAL_ACCOUNT_FIELDS.serviceFrequency,
      COMMERCIAL_ACCOUNT_FIELDS.monthlyContractValue,
      COMMERCIAL_ACCOUNT_FIELDS.stripeCustomerId,
    ],
    appFieldNames: ["Decision Maker"],
    airtableFieldIds: [
      COMMERCIAL_ACCOUNT_FIELDS.cleaningWindow,
      COMMERCIAL_ACCOUNT_FIELDS.perVisitRate,
      COMMERCIAL_ACCOUNT_FIELDS.contractStart,
      COMMERCIAL_ACCOUNT_FIELDS.contractTerm,
      COMMERCIAL_ACCOUNT_FIELDS.billingCycle,
    ],
  },
  [TABLES.sites]: {
    name: "Sites",
    flow: "commercial",
    keyFieldIds: [SITE_FIELDS.siteNickname],
    appFieldIds: [
      SITE_FIELDS.address,
      SITE_FIELDS.sqft,
      SITE_FIELDS.facilityType,
      SITE_FIELDS.restrooms,
      SITE_FIELDS.floors,
      SITE_FIELDS.accessMethod,
    ],
    appFieldNames: ["Commercial Account"],
    airtableFieldIds: [SITE_FIELDS.floorTypes, SITE_FIELDS.addOnServices],
  },
  [TABLES.payrollRuns]: {
    name: "Payroll Runs",
    flow: "payroll_runs",
    keyFieldIds: [PAYROLL_RUN_FIELDS.runId],
    appFieldIds: [
      PAYROLL_RUN_FIELDS.cleanerName,
      PAYROLL_RUN_FIELDS.periodStart,
      PAYROLL_RUN_FIELDS.periodEnd,
      PAYROLL_RUN_FIELDS.totalJobs,
      PAYROLL_RUN_FIELDS.grossPay,
      PAYROLL_RUN_FIELDS.bonus,
      PAYROLL_RUN_FIELDS.deduction,
      PAYROLL_RUN_FIELDS.netPay,
      PAYROLL_RUN_FIELDS.paymentMethod,
      PAYROLL_RUN_FIELDS.status,
      PAYROLL_RUN_FIELDS.sentAt,
      PAYROLL_RUN_FIELDS.stripeTransferId,
      PAYROLL_RUN_FIELDS.notes,
    ],
    appFieldNames: [],
    airtableFieldIds: [],
  },
};

// Tables the app creates lazily via the Meta API — resolved by NAME at run
// time. They are full app-pushed mirrors, so any remote human edit conflicts.
const DYNAMIC_TABLE_NAMES: Record<string, { flow: string; keyFieldName: string }> = {
  Contractors: { flow: "contractors", keyFieldName: "Email" },
  VAs: { flow: "vas", keyFieldName: "Email" },
  "QC Issues": { flow: "qc_issue", keyFieldName: "Issue ID" },
};

// Tables whose content shows up in workspace views straight from Airtable —
// any change to them makes cached snapshots stale.
const VIEW_TABLE_IDS = new Set<string>([TABLES.clients, TABLES.properties, TABLES.jobs]);

// ─── Airtable Webhooks API types ──────────────────────────────────────────────

interface WebhookInfo {
  id: string;
  notificationUrl?: string | null;
  expirationTime?: string | null;
  isHookEnabled?: boolean;
  cursorForNextPayload?: number;
}

interface WebhookRecordChange {
  current?: { cellValuesByFieldId?: Record<string, unknown> };
  previous?: { cellValuesByFieldId?: Record<string, unknown> };
}

interface WebhookTableChange {
  changedRecordsById?: Record<string, WebhookRecordChange>;
  createdRecordsById?: Record<string, unknown>;
  destroyedRecordIds?: string[];
}

interface WebhookPayload {
  timestamp?: string;
  actionMetadata?: { source?: string };
  changedTablesById?: Record<string, WebhookTableChange>;
}

export interface WebhookStateRow {
  id: string;
  base_id: string;
  mac_secret_b64: string;
  cursor_position: number;
  notification_url: string | null;
  expiration_time: string | null;
}

// ─── State helpers ────────────────────────────────────────────────────────────

export async function getWebhookState(webhookId?: string): Promise<WebhookStateRow | null> {
  const supabase = getAdminSupabase();
  let query = supabase
    .from("airtable_webhook_state")
    .select("id, base_id, mac_secret_b64, cursor_position, notification_url, expiration_time")
    .eq("base_id", getBaseId());
  if (webhookId) query = query.eq("id", webhookId);
  const { data } = await query.order("updated_at", { ascending: false }).limit(1);
  return (data?.[0] as WebhookStateRow) || null;
}

/** Resolve where Airtable should ping us — derived from the configured app URL. */
async function resolveNotificationUrl(): Promise<string | null> {
  const candidates: string[] = [];
  const fromEnv = (process.env.AIRTABLE_SYNC_URL || "").trim();
  if (fromEnv) candidates.push(fromEnv);
  try {
    const supabase = getAdminSupabase();
    const { data } = await supabase
      .from("app_secrets")
      .select("key, value")
      .in("key", ["AIRTABLE_SYNC_URL", "AIRTABLE_WORKER_URL"]);
    for (const row of data || []) {
      if (row.value) candidates.push(String(row.value).trim());
    }
  } catch {
    /* fall through */
  }
  for (const c of candidates) {
    try {
      const origin = new URL(c).origin;
      return `${origin}/api/airtable/webhook`;
    } catch {
      /* try next */
    }
  }
  return null;
}

// ─── Webhook lifecycle ────────────────────────────────────────────────────────

export interface EnsureWebhookResult {
  ok: boolean;
  mode: "webhook" | "poll";
  message: string;
  webhookId?: string;
  expirationTime?: string | null;
}

/**
 * Make sure an Airtable→app webhook exists and won't expire. Creates one when
 * missing (storing the one-time MAC secret), refreshes it otherwise. When the
 * PAT can't manage webhooks the 5-minute poll fallback stays in charge.
 */
export async function ensureWebhook(): Promise<EnsureWebhookResult> {
  const baseId = getBaseId();
  const notificationUrl = await resolveNotificationUrl();
  if (!notificationUrl) {
    return { ok: false, mode: "poll", message: "No app URL configured (AIRTABLE_SYNC_URL) — cannot register a webhook." };
  }

  let existing: WebhookInfo[];
  try {
    const res = await airtableRequest<{ webhooks: WebhookInfo[] }>(`/bases/${baseId}/webhooks`);
    existing = res.webhooks || [];
  } catch (err) {
    return {
      ok: false,
      mode: "poll",
      message: `Cannot list webhooks (PAT may lack webhook:manage): ${(err as Error).message}. Poll fallback stays active.`,
    };
  }

  const supabase = getAdminSupabase();
  const ours = existing.find((w) => (w.notificationUrl || "") === notificationUrl);

  if (ours) {
    const state = await getWebhookState(ours.id);
    if (state) {
      // Alive and we hold the MAC secret — just extend its life.
      try {
        const res = await airtableRequest<{ expirationTime?: string }>(
          `/bases/${baseId}/webhooks/${ours.id}/refresh`,
          { method: "POST" },
        );
        await supabase
          .from("airtable_webhook_state")
          .update({ expiration_time: res.expirationTime || null, updated_at: new Date().toISOString() })
          .eq("id", ours.id);
        return { ok: true, mode: "webhook", message: "Webhook refreshed.", webhookId: ours.id, expirationTime: res.expirationTime || null };
      } catch (err) {
        return { ok: false, mode: "webhook", message: `Webhook refresh failed: ${(err as Error).message}` };
      }
    }
    // We can't verify pings without the MAC secret (only returned at creation)
    // — replace the orphaned webhook.
    await airtableRequest(`/bases/${baseId}/webhooks/${ours.id}`, { method: "DELETE" }).catch(() => null);
  }

  try {
    const created = await airtableRequest<{ id: string; macSecretBase64: string; expirationTime?: string }>(
      `/bases/${baseId}/webhooks`,
      {
        method: "POST",
        body: {
          notificationUrl,
          specification: { options: { filters: { dataTypes: ["tableData"] } } },
        },
      },
    );
    // One registration per base — clear stale rows, store the fresh secret.
    await supabase.from("airtable_webhook_state").delete().eq("base_id", baseId);
    await supabase.from("airtable_webhook_state").insert({
      id: created.id,
      base_id: baseId,
      mac_secret_b64: created.macSecretBase64,
      cursor_position: 1,
      notification_url: notificationUrl,
      expiration_time: created.expirationTime || null,
    });
    return { ok: true, mode: "webhook", message: "Webhook registered.", webhookId: created.id, expirationTime: created.expirationTime || null };
  } catch (err) {
    return {
      ok: false,
      mode: "poll",
      message: `Webhook creation failed (${(err as Error).message}). Poll fallback stays active.`,
    };
  }
}

/** Verify Airtable's HMAC on a notification ping (X-Airtable-Content-MAC). */
export function verifyWebhookMac(rawBody: string, macHeader: string, macSecretB64: string): boolean {
  try {
    const hmac = crypto.createHmac("sha256", Buffer.from(macSecretB64, "base64"));
    hmac.update(rawBody, "ascii");
    const expected = `hmac-sha256=${hmac.digest("hex")}`;
    const a = Buffer.from(expected);
    const b = Buffer.from(macHeader || "");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ─── Payload processing ───────────────────────────────────────────────────────

// Sources that represent HUMAN edits inside Airtable. Our own API writes come
// through as publicApi and are not conflicts; formula/automation recalcs are
// derived noise.
const HUMAN_SOURCES = new Set(["client", "anonymousUser"]);

interface FieldNameIndex {
  tableName: Map<string, string>;
  fieldName: Map<string, Map<string, string>>; // tableId → fieldId → name
}

async function buildNameIndex(): Promise<FieldNameIndex> {
  const tableName = new Map<string, string>();
  const fieldName = new Map<string, Map<string, string>>();
  try {
    const tables = await listBaseTables();
    for (const t of tables) {
      tableName.set(t.id, t.name);
      const fields = new Map<string, string>();
      for (const f of t.fields) fields.set(f.id, f.name);
      fieldName.set(t.id, fields);
    }
  } catch {
    /* names degrade to raw ids in flag messages */
  }
  return { tableName, fieldName };
}

function ownershipFor(tableId: string, index: FieldNameIndex): TableOwnership | null {
  const staticOwn = STATIC_OWNERSHIP[tableId];
  if (staticOwn) return staticOwn;
  const name = index.tableName.get(tableId);
  if (name && DYNAMIC_TABLE_NAMES[name]) {
    return {
      name,
      flow: DYNAMIC_TABLE_NAMES[name].flow,
      keyFieldIds: [],
      appFieldIds: [],
      appFieldNames: ["*"], // whole table is an app-pushed mirror
      airtableFieldIds: [],
    };
  }
  return null;
}

export interface InboundProcessResult {
  payloads: number;
  changedTables: string[];
  conflicts: number;
  flagged: number;
  cursor: number;
}

/**
 * Fetch pending webhook payloads from the stored cursor and process them.
 * At-least-once + idempotent: flags dedupe, marker bumps are monotonic — so a
 * replayed window converges to the same state.
 */
export async function processWebhookPayloads(state: WebhookStateRow): Promise<InboundProcessResult> {
  const baseId = state.base_id;
  const supabase = getAdminSupabase();
  const index = await buildNameIndex();

  let cursor = Number(state.cursor_position) || 1;
  let pages = 0;
  let payloadCount = 0;
  let conflicts = 0;
  let flagged = 0;
  const changedTables = new Set<string>();
  let sawChange = false;

  for (;;) {
    const res = await airtableRequest<{ payloads: WebhookPayload[]; cursor: number; mightHaveMore: boolean }>(
      `/bases/${baseId}/webhooks/${state.id}/payloads`,
      { query: { cursor, limit: 50 } },
    );

    for (const payload of res.payloads || []) {
      payloadCount += 1;
      const source = payload.actionMetadata?.source || "unknown";
      const tables = payload.changedTablesById || {};

      for (const [tableId, change] of Object.entries(tables)) {
        const own = ownershipFor(tableId, index);
        const tableLabel = own?.name || index.tableName.get(tableId) || tableId;
        changedTables.add(tableLabel);
        if (VIEW_TABLE_IDS.has(tableId)) sawChange = true;

        if (!own) continue; // table we don't sync — Airtable-native, nothing to review

        // Remote deletions of app-owned rows: the workspace copy stands and the
        // row reappears on the next sync — never mirrored as a delete. Payroll
        // Runs prune themselves by design, so those deletes are expected.
        const destroyed = change.destroyedRecordIds || [];
        if (destroyed.length > 0 && HUMAN_SOURCES.has(source) && tableId !== TABLES.payrollRuns) {
          flagged += 1;
          await flagForReview({
            flow: own.flow,
            reason: "deletion",
            airtableTable: tableLabel,
            recordRef: destroyed.slice(0, 10).join(", "),
            message: `${destroyed.length} record(s) deleted in Airtable "${tableLabel}". The workspace is the source of truth for this flow — the record(s) will be recreated on the next sync. If they should be gone, archive/status-flag them in the workspace.`,
            detail: { recordIds: destroyed.slice(0, 50) },
          });
        }

        if (!HUMAN_SOURCES.has(source)) continue; // our API writes / formulas / automations

        const fieldNames = index.fieldName.get(tableId) || new Map<string, string>();
        const wholeTableAppOwned = own.appFieldNames.includes("*");

        for (const [recordId, rec] of Object.entries(change.changedRecordsById || {})) {
          const changedFieldIds = Object.keys(rec.current?.cellValuesByFieldId || {});
          for (const fieldId of changedFieldIds) {
            const fName = fieldNames.get(fieldId) || fieldId;

            if (own.keyFieldIds.includes(fieldId)) {
              conflicts += 1;
              flagged += 1;
              await flagForReview({
                flow: own.flow,
                reason: "identity",
                airtableTable: tableLabel,
                recordRef: recordId,
                fieldRef: fName,
                message: `Identity key "${fName}" was edited directly in Airtable (${tableLabel} · ${recordId}). Upserts merge on this field — the next sync will create a NEW record instead of updating this one. Align the workspace value or revert the Airtable edit.`,
              });
              continue;
            }

            const appOwned =
              wholeTableAppOwned ||
              own.appFieldIds.includes(fieldId) ||
              own.appFieldNames.includes(fName);
            if (appOwned) {
              conflicts += 1;
              flagged += 1;
              await flagForReview({
                flow: own.flow,
                reason: "conflict",
                airtableTable: tableLabel,
                recordRef: recordId,
                fieldRef: fName,
                message: `"${fName}" was edited in Airtable (${tableLabel} · ${recordId}) but the workspace is the source of truth for this field — the workspace value will overwrite it on the next sync. If the Airtable edit is the correct one, change it in the workspace.`,
              });
              continue;
            }

            if (own.airtableFieldIds.includes(fieldId)) continue; // Airtable-owned — expected

            // Field outside the known mapping — surface it, never guess.
            flagged += 1;
            await flagForReview({
              flow: own.flow,
              reason: "unmapped_field",
              airtableTable: tableLabel,
              fieldRef: fName,
              message: `Field "${fName}" on "${tableLabel}" was edited in Airtable but is not part of the known field mapping — it does not sync to the workspace. Map it deliberately or ignore this flag.`,
            });
          }
        }
      }
    }

    const nextCursor = Number(res.cursor) || cursor;
    if (nextCursor !== cursor) {
      cursor = nextCursor;
      await supabase
        .from("airtable_webhook_state")
        .update({
          cursor_position: cursor,
          last_payload_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", state.id);
    }

    pages += 1;
    if (!res.mightHaveMore || pages >= 10) break;
  }

  if (sawChange || changedTables.size > 0) {
    await bumpRemoteChangeMarker();
  }
  await stampInboundChecked();

  return { payloads: payloadCount, changedTables: Array.from(changedTables), conflicts, flagged, cursor };
}

// ─── Poll fallback (no webhook available) ─────────────────────────────────────

const POLL_TABLES: { id: string; label: string }[] = [
  { id: TABLES.clients, label: "Clients" },
  { id: TABLES.properties, label: "Properties" },
  { id: TABLES.jobs, label: "Jobs" },
];

/**
 * Change detection without webhooks: probe LAST_MODIFIED_TIME() since the last
 * check on the tables workspace views read from. Detects THAT something
 * changed (freshness) — field-level conflict detail requires the webhook.
 */
export async function pollInboundFallback(): Promise<{ changed: boolean; tables: string[] }> {
  const { lastCheckedAt } = await getInboundState();
  if (!lastCheckedAt) {
    // First run: establish the cutoff; report from the next pass onward.
    await stampInboundChecked();
    return { changed: false, tables: [] };
  }

  const cutoffIso = new Date(lastCheckedAt).toISOString();
  const changedTables: string[] = [];
  for (const t of POLL_TABLES) {
    try {
      const records = await listRecords(t.id, {
        filterByFormula: `IS_AFTER(LAST_MODIFIED_TIME(), DATETIME_PARSE("${cutoffIso}"))`,
        pageSize: 1,
        maxRecords: 1,
      });
      if (records.length > 0) changedTables.push(t.label);
    } catch {
      /* probe is best-effort per table */
    }
  }

  if (changedTables.length > 0) await bumpRemoteChangeMarker();
  await stampInboundChecked();
  return { changed: changedTables.length > 0, tables: changedTables };
}
