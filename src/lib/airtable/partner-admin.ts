// ─── STR Partner Account Management (Admin) — Airtable data layer ─────────────
//
// The ADMIN side of the STR host lifecycle (spec: str-partner-management-spec).
// Hosts request turnovers in the portal; admins MANAGE here — set pricing,
// approve a property to go live, see per-host revenue, pause a non-paying host,
// offboard, and surface a daily "needs attention" queue.
//
// SERVER ONLY. Reads/writes the "NVC | Client & Revenue Ops" base via the
// rate-limited Airtable client. Computed stats are derived live from Jobs (never
// stored stale) and a base-wide snapshot is cached lightly (5 min) so we respect
// Airtable's 5 req/sec ceiling and don't recompute on every keystroke (spec §7).
//
// Guardrails enforced here (spec §8), independent of the UI:
//   • A property cannot be set "Active" without a Standard Rate.
//   • Offboarding never deletes data — it flips lifecycle to "Churned".
//   • Rate changes take effect for FUTURE turnovers only (we never touch a Job).
//   • Every status change is logged (who + when) into the host's Notes audit.

import { getRecords, listRecords, updateRecords } from "./client";
import { syncJob } from "./mappers";
import {
  CLIENT_FIELDS,
  CLIENT_TYPE,
  ENTRY_SOURCE,
  JOB_FIELDS,
  JOB_SERVICE_TYPE,
  LIFECYCLE_STAGE,
  ONBOARDING_STAGE,
  PAYMENT_STATUS,
  PROPERTY_FIELDS,
  PROPERTY_STATUS,
  TABLES,
} from "./schema";

// ─── Field coercion helpers ───────────────────────────────────────────────────

function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) return v.length ? String(v[0]) : null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
function num(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isFinite(n) ? n : null;
}
function bool(v: unknown): boolean {
  return v === true || v === "true" || v === 1 || v === "checked";
}
/** Airtable link fields (returnFieldsByFieldId) come back as arrays of record ids. */
function linkIds(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === "string" ? x : (x as { id?: string })?.id))
    .filter((x): x is string => Boolean(x));
}

// ─── Date helpers (YYYY-MM-DD, local-safe) ─────────────────────────────────────

function todayYmd(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}
function isSameMonth(ymd: string | null, ref = new Date()): boolean {
  if (!ymd) return false;
  return ymd.slice(0, 7) === ref.toISOString().slice(0, 7);
}
function daysBetween(ymd: string, ref = new Date()): number {
  const a = new Date(`${ymd}T00:00:00Z`).getTime();
  const b = new Date(`${ref.toISOString().slice(0, 10)}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}
/** Intro window closes within the next `days` (and hasn't already passed). */
function withinDays(ymd: string | null, days: number): boolean {
  if (!ymd) return false;
  const diff = -daysBetween(ymd); // positive = in the future
  return diff >= 0 && diff <= days;
}

// ─── Normalized record shapes ──────────────────────────────────────────────────

export interface HostStats {
  turnoversThisMonth: number;
  revenueThisMonth: number;
  lifetimeTurnovers: number;
  lifetimeRevenue: number;
  avgPerTurnover: number;
  lastTurnoverDate: string | null;
  daysSinceLastTurnover: number | null;
}

export interface HostFlags {
  pendingPricing: boolean;
  missingPayment: boolean;
  agreementUnsigned: boolean;
  failedPayment: boolean;
  introExpiring: boolean;
  noRecentTurnover: boolean;
}

export interface HostListItem {
  id: string;
  name: string | null;
  company: string | null;
  phone: string | null;
  email: string | null;
  lifecycleStage: string | null;
  onboardingStage: string | null;
  agreementSigned: boolean;
  paymentMethodOnFile: string | null;
  stripeCustomerId: string | null;
  propertyCount: number;
  pendingPricingCount: number;
  stats: HostStats;
  flags: HostFlags;
  attentionScore: number;
}

export interface PropertyView {
  id: string;
  nickname: string | null;
  address: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  standardTurnoverRate: number | null;
  introRate: number | null;
  introRateEndDate: string | null;
  linenIncluded: boolean;
  restockIncluded: boolean;
  accessType: string | null;
  accessInstructions: string | null;
  stagingNotes: string | null;
  propertyStatus: string | null;
  turnoverFrequency: string | null;
  introExpiring: boolean;
}

export interface TurnoverView {
  id: string;
  jobId: string | null;
  dateCompleted: string | null;
  propertyNickname: string | null;
  amountPaid: number | null;
  cleanerName: string | null;
  paymentStatus: string | null;
}

export interface HostDetail extends HostListItem {
  entityType: "individual" | "entity";
  agreementType: string | null;
  notes: string | null;
  properties: PropertyView[];
  turnovers: TurnoverView[];
}

// ─── Raw snapshot (cached) ──────────────────────────────────────────────────────

interface RawClient {
  id: string;
  fields: Record<string, unknown>;
}
interface RawProperty {
  id: string;
  fields: Record<string, unknown>;
  hostIds: string[];
}
interface RawJob {
  id: string;
  fields: Record<string, unknown>;
  clientIds: string[];
}

interface Snapshot {
  at: number;
  clients: RawClient[];
  propertiesByHost: Map<string, RawProperty[]>;
  jobsByClient: Map<string, RawJob[]>;
  propertyNicknameById: Map<string, string>;
}

let snapshotCache: Snapshot | null = null;
const SNAPSHOT_TTL_MS = 5 * 60 * 1000; // spec §7 — cache lightly (5 min)

/** Drop the cache so the next read reflects an admin write immediately. */
export function invalidatePartnerSnapshot(): void {
  snapshotCache = null;
}

// ── Remote-change awareness ───────────────────────────────────────────────────
// The inbound sync (Airtable webhook / poll) stamps a marker whenever the base
// changes. A cached snapshot older than that marker is stale — refresh it so
// Airtable-side edits show up near-real-time instead of "within 5 minutes,
// maybe". The marker check itself is memoized briefly so hot admin reads don't
// hammer the DB.
const MARKER_CHECK_TTL_MS = 15 * 1000;
let markerCheck: { at: number; value: number | null } | null = null;

async function remoteChangedSince(snapshotAt: number): Promise<boolean> {
  try {
    if (!markerCheck || Date.now() - markerCheck.at > MARKER_CHECK_TTL_MS) {
      const { getRemoteChangeMarkerMs } = await import("./telemetry");
      markerCheck = { at: Date.now(), value: await getRemoteChangeMarkerMs() };
    }
    return markerCheck.value != null && markerCheck.value > snapshotAt;
  } catch {
    return false; // telemetry unavailable → behave exactly as before
  }
}

/**
 * Pull the STR slice of the base in three paginated reads (Clients filtered to
 * STR Hosts, all Properties, STR-Turnover Jobs) and index it for fast in-memory
 * aggregation. Cached for 5 minutes — but self-invalidating the moment the
 * inbound sync reports an Airtable-side change.
 */
async function getSnapshot(force = false): Promise<Snapshot> {
  if (!force && snapshotCache && Date.now() - snapshotCache.at < SNAPSHOT_TTL_MS) {
    if (!(await remoteChangedSince(snapshotCache.at))) {
      return snapshotCache;
    }
  }

  const [clientRecords, propertyRecords, jobRecords] = await Promise.all([
    listRecords(TABLES.clients, { filterByFormula: `{Client Type}="${CLIENT_TYPE.strHost}"` }),
    listRecords(TABLES.properties),
    listRecords(TABLES.jobs, { filterByFormula: `{Service Type}="${JOB_SERVICE_TYPE.strTurnover}"` }),
  ]);

  const clients: RawClient[] = clientRecords.map((r) => ({ id: r.id, fields: r.fields }));

  const propertiesByHost = new Map<string, RawProperty[]>();
  const propertyNicknameById = new Map<string, string>();
  for (const r of propertyRecords) {
    const hostIds = linkIds(r.fields[PROPERTY_FIELDS.hostLinkId]);
    const rp: RawProperty = { id: r.id, fields: r.fields, hostIds };
    propertyNicknameById.set(r.id, str(r.fields[PROPERTY_FIELDS.propertyNickname]) || "Property");
    for (const hid of hostIds) {
      const list = propertiesByHost.get(hid) || [];
      list.push(rp);
      propertiesByHost.set(hid, list);
    }
  }

  const jobsByClient = new Map<string, RawJob[]>();
  for (const r of jobRecords) {
    const clientIds = linkIds(r.fields[JOB_FIELDS.clientLinkId]);
    const rj: RawJob = { id: r.id, fields: r.fields, clientIds };
    for (const cid of clientIds) {
      const list = jobsByClient.get(cid) || [];
      list.push(rj);
      jobsByClient.set(cid, list);
    }
  }

  snapshotCache = { at: Date.now(), clients, propertiesByHost, jobsByClient, propertyNicknameById };
  return snapshotCache;
}

// ─── Computed stats (spec §7) ──────────────────────────────────────────────────

function computeStats(jobs: RawJob[]): HostStats {
  let turnoversThisMonth = 0;
  let revenueThisMonth = 0;
  let lifetimeTurnovers = 0;
  let lifetimeRevenue = 0;
  let lastTurnoverDate: string | null = null;

  for (const j of jobs) {
    const date = str(j.fields[JOB_FIELDS.dateCompleted]);
    const paid = num(j.fields[JOB_FIELDS.customerPaid]) || 0;
    // Lifetime = every recorded STR turnover for this host.
    lifetimeTurnovers += 1;
    lifetimeRevenue += paid;
    if (date && (!lastTurnoverDate || date > lastTurnoverDate)) lastTurnoverDate = date;
    if (isSameMonth(date)) {
      turnoversThisMonth += 1;
      revenueThisMonth += paid;
    }
  }

  const avgPerTurnover = lifetimeTurnovers > 0 ? lifetimeRevenue / lifetimeTurnovers : 0;
  const daysSinceLastTurnover = lastTurnoverDate ? daysBetween(lastTurnoverDate) : null;

  return {
    turnoversThisMonth,
    revenueThisMonth: round2(revenueThisMonth),
    lifetimeTurnovers,
    lifetimeRevenue: round2(lifetimeRevenue),
    avgPerTurnover: round2(avgPerTurnover),
    lastTurnoverDate,
    daysSinceLastTurnover,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function computeFlags(
  client: RawClient,
  properties: RawProperty[],
  jobs: RawJob[],
  stats: HostStats,
): HostFlags {
  const agreementSigned = bool(client.fields[CLIENT_FIELDS.agreementSigned]);
  const paymentMethodOnFile = str(client.fields[CLIENT_FIELDS.paymentMethodOnFile]);
  const lifecycle = str(client.fields[CLIENT_FIELDS.lifecycleStage]);

  const pendingPricing = properties.some(
    (p) =>
      str(p.fields[PROPERTY_FIELDS.propertyStatus]) === PROPERTY_STATUS.pendingPricing ||
      !(num(p.fields[PROPERTY_FIELDS.standardTurnoverRate]) ?? 0),
  );
  const introExpiring = properties.some((p) =>
    withinDays(str(p.fields[PROPERTY_FIELDS.introRateEndDate]), 7),
  );
  const failedPayment = jobs.some((j) => {
    const s = str(j.fields[JOB_FIELDS.paymentStatus]);
    return s === PAYMENT_STATUS.failed || s === PAYMENT_STATUS.pending;
  });
  const hasActiveProperty = properties.some(
    (p) => str(p.fields[PROPERTY_FIELDS.propertyStatus]) === PROPERTY_STATUS.active,
  );
  const churned = lifecycle === LIFECYCLE_STAGE.churned;
  const noRecentTurnover =
    !churned &&
    hasActiveProperty &&
    (stats.daysSinceLastTurnover === null || stats.daysSinceLastTurnover > 30);

  return {
    pendingPricing,
    missingPayment: !paymentMethodOnFile,
    agreementUnsigned: !agreementSigned,
    failedPayment,
    introExpiring,
    noRecentTurnover,
  };
}

/** Higher = more urgent. Drives the "needs attention floats to top" sort (spec §3). */
function attentionScore(flags: HostFlags): number {
  return (
    (flags.failedPayment ? 50 : 0) +
    (flags.pendingPricing ? 30 : 0) +
    (flags.missingPayment ? 20 : 0) +
    (flags.agreementUnsigned ? 15 : 0) +
    (flags.introExpiring ? 10 : 0) +
    (flags.noRecentTurnover ? 8 : 0)
  );
}

function toListItem(client: RawClient, snapshot: Snapshot): HostListItem {
  const properties = snapshot.propertiesByHost.get(client.id) || [];
  const jobs = snapshot.jobsByClient.get(client.id) || [];
  const stats = computeStats(jobs);
  const flags = computeFlags(client, properties, jobs, stats);
  const pendingPricingCount = properties.filter(
    (p) =>
      str(p.fields[PROPERTY_FIELDS.propertyStatus]) === PROPERTY_STATUS.pendingPricing ||
      !(num(p.fields[PROPERTY_FIELDS.standardTurnoverRate]) ?? 0),
  ).length;

  return {
    id: client.id,
    name: str(client.fields[CLIENT_FIELDS.clientName]),
    company: str(client.fields[CLIENT_FIELDS.company]),
    phone: str(client.fields[CLIENT_FIELDS.phone]),
    email: str(client.fields[CLIENT_FIELDS.email]),
    lifecycleStage: str(client.fields[CLIENT_FIELDS.lifecycleStage]),
    onboardingStage: str(client.fields[CLIENT_FIELDS.onboardingStage]),
    agreementSigned: bool(client.fields[CLIENT_FIELDS.agreementSigned]),
    paymentMethodOnFile: str(client.fields[CLIENT_FIELDS.paymentMethodOnFile]),
    stripeCustomerId: str(client.fields[CLIENT_FIELDS.stripeCustomerId]),
    propertyCount: properties.length,
    pendingPricingCount,
    stats,
    flags,
    attentionScore: attentionScore(flags),
  };
}

// ─── Public reads ───────────────────────────────────────────────────────────────

/** The host list (spec §3) — "needs attention" floats to the top. */
export async function listHosts(force = false): Promise<HostListItem[]> {
  const snapshot = await getSnapshot(force);
  const items = snapshot.clients.map((c) => toListItem(c, snapshot));
  items.sort((a, b) => {
    if (b.attentionScore !== a.attentionScore) return b.attentionScore - a.attentionScore;
    return (a.name || a.email || "").localeCompare(b.name || b.email || "");
  });
  return items;
}

function toPropertyView(p: RawProperty): PropertyView {
  return {
    id: p.id,
    nickname: str(p.fields[PROPERTY_FIELDS.propertyNickname]),
    address: str(p.fields[PROPERTY_FIELDS.address]),
    bedrooms: num(p.fields[PROPERTY_FIELDS.bedrooms]),
    bathrooms: num(p.fields[PROPERTY_FIELDS.bathrooms]),
    sqft: num(p.fields[PROPERTY_FIELDS.sqft]),
    standardTurnoverRate: num(p.fields[PROPERTY_FIELDS.standardTurnoverRate]),
    introRate: num(p.fields[PROPERTY_FIELDS.introRate]),
    introRateEndDate: str(p.fields[PROPERTY_FIELDS.introRateEndDate]),
    linenIncluded: bool(p.fields[PROPERTY_FIELDS.linenIncluded]),
    restockIncluded: bool(p.fields[PROPERTY_FIELDS.restockIncluded]),
    accessType: str(p.fields[PROPERTY_FIELDS.accessType]),
    accessInstructions: str(p.fields[PROPERTY_FIELDS.accessInstructions]),
    stagingNotes: str(p.fields[PROPERTY_FIELDS.stagingNotes]),
    propertyStatus: str(p.fields[PROPERTY_FIELDS.propertyStatus]),
    turnoverFrequency: str(p.fields[PROPERTY_FIELDS.turnoverFrequency]),
    introExpiring: withinDays(str(p.fields[PROPERTY_FIELDS.introRateEndDate]), 7),
  };
}

/** Full host account page data (spec §4). */
export async function getHostDetail(recordId: string, force = false): Promise<HostDetail | null> {
  const snapshot = await getSnapshot(force);
  const client = snapshot.clients.find((c) => c.id === recordId);
  if (!client) return null;

  const base = toListItem(client, snapshot);
  const properties = (snapshot.propertiesByHost.get(recordId) || []).map(toPropertyView);
  const jobs = snapshot.jobsByClient.get(recordId) || [];

  const turnovers: TurnoverView[] = jobs
    .map((j) => {
      const propIds = linkIds(j.fields[JOB_FIELDS.property]);
      const propertyNickname = propIds.length
        ? snapshot.propertyNicknameById.get(propIds[0]) || null
        : null;
      return {
        id: j.id,
        jobId: str(j.fields[JOB_FIELDS.jobId]),
        dateCompleted: str(j.fields[JOB_FIELDS.dateCompleted]),
        propertyNickname,
        amountPaid: num(j.fields[JOB_FIELDS.customerPaid]),
        cleanerName: str(j.fields[JOB_FIELDS.cleanerName]),
        paymentStatus: str(j.fields[JOB_FIELDS.paymentStatus]),
      };
    })
    .sort((a, b) => (b.dateCompleted || "").localeCompare(a.dateCompleted || ""));

  const agreementTypeRaw = str(client.fields[CLIENT_FIELDS.agreementType]) || "";
  const company = base.company;

  return {
    ...base,
    // No explicit entity flag in the base — infer from Company presence.
    entityType: company ? "entity" : "individual",
    agreementType: agreementTypeRaw || null,
    notes: str(client.fields[CLIENT_FIELDS.notes]),
    properties,
    turnovers,
  };
}

// ─── Needs Attention dashboard + portfolio totals (spec §6 / §7) ────────────────

export interface AttentionPropertyRef {
  hostId: string;
  hostName: string | null;
  propertyId: string;
  nickname: string | null;
  detail?: string | null;
}
export interface AttentionHostRef {
  hostId: string;
  hostName: string | null;
  email: string | null;
  detail?: string | null;
}

export interface DashboardData {
  portfolio: {
    totalHosts: number;
    activeHosts: number;
    totalProperties: number;
    activeProperties: number;
    pendingPricingProperties: number;
    strRevenueThisMonth: number;
    turnoversThisMonth: number;
  };
  attention: {
    pendingPricing: AttentionPropertyRef[];
    missingPayment: AttentionHostRef[];
    unsignedAgreement: AttentionHostRef[];
    failedPayment: AttentionHostRef[];
    introExpiring: AttentionPropertyRef[];
    noRecentTurnover: AttentionHostRef[];
  };
}

export async function getDashboard(force = false): Promise<DashboardData> {
  const snapshot = await getSnapshot(force);

  const pendingPricing: AttentionPropertyRef[] = [];
  const missingPayment: AttentionHostRef[] = [];
  const unsignedAgreement: AttentionHostRef[] = [];
  const failedPayment: AttentionHostRef[] = [];
  const introExpiring: AttentionPropertyRef[] = [];
  const noRecentTurnover: AttentionHostRef[] = [];

  let activeHosts = 0;
  let totalProperties = 0;
  let activeProperties = 0;
  let pendingPricingProperties = 0;
  let strRevenueThisMonth = 0;
  let turnoversThisMonth = 0;

  for (const client of snapshot.clients) {
    const item = toListItem(client, snapshot);
    const properties = snapshot.propertiesByHost.get(client.id) || [];
    const lifecycle = str(client.fields[CLIENT_FIELDS.lifecycleStage]);
    if (lifecycle === LIFECYCLE_STAGE.active) activeHosts += 1;

    totalProperties += properties.length;
    strRevenueThisMonth += item.stats.revenueThisMonth;
    turnoversThisMonth += item.stats.turnoversThisMonth;

    const hostRef: AttentionHostRef = { hostId: client.id, hostName: item.name, email: item.email };

    if (item.flags.missingPayment && lifecycle !== LIFECYCLE_STAGE.churned) {
      missingPayment.push(hostRef);
    }
    if (item.flags.agreementUnsigned && lifecycle !== LIFECYCLE_STAGE.churned) {
      unsignedAgreement.push(hostRef);
    }
    if (item.flags.failedPayment) {
      failedPayment.push(hostRef);
    }
    if (item.flags.noRecentTurnover) {
      noRecentTurnover.push({
        ...hostRef,
        detail:
          item.stats.daysSinceLastTurnover === null
            ? "No turnovers yet"
            : `${item.stats.daysSinceLastTurnover}d since last turnover`,
      });
    }

    for (const p of properties) {
      const status = str(p.fields[PROPERTY_FIELDS.propertyStatus]);
      const rate = num(p.fields[PROPERTY_FIELDS.standardTurnoverRate]) ?? 0;
      if (status === PROPERTY_STATUS.active) activeProperties += 1;
      const isPending = status === PROPERTY_STATUS.pendingPricing || !rate;
      if (isPending) {
        pendingPricingProperties += 1;
        pendingPricing.push({
          hostId: client.id,
          hostName: item.name,
          propertyId: p.id,
          nickname: str(p.fields[PROPERTY_FIELDS.propertyNickname]),
          detail: str(p.fields[PROPERTY_FIELDS.address]),
        });
      }
      const introEnd = str(p.fields[PROPERTY_FIELDS.introRateEndDate]);
      if (withinDays(introEnd, 7)) {
        introExpiring.push({
          hostId: client.id,
          hostName: item.name,
          propertyId: p.id,
          nickname: str(p.fields[PROPERTY_FIELDS.propertyNickname]),
          detail: `Intro ends ${introEnd}`,
        });
      }
    }
  }

  return {
    portfolio: {
      totalHosts: snapshot.clients.length,
      activeHosts,
      totalProperties,
      activeProperties,
      pendingPricingProperties,
      strRevenueThisMonth: round2(strRevenueThisMonth),
      turnoversThisMonth,
    },
    attention: {
      pendingPricing,
      missingPayment,
      unsignedAgreement,
      failedPayment,
      introExpiring,
      noRecentTurnover,
    },
  };
}

// ─── Audit trail (spec §8 — log every status change, who + when) ─────────────────

export interface AdminContext {
  adminEmail: string;
}

/** Prepend a timestamped audit line to the host's Notes field. Best-effort. */
async function appendHostAudit(hostRecordId: string, message: string, ctx: AdminContext): Promise<void> {
  try {
    const [rec] = await getRecords(TABLES.clients, [hostRecordId]);
    const existing = str(rec?.fields[CLIENT_FIELDS.notes]) || "";
    const line = `[${new Date().toISOString()}] ${ctx.adminEmail}: ${message}`;
    const next = existing ? `${line}\n${existing}` : line;
    await updateRecords(TABLES.clients, [{ id: hostRecordId, fields: { [CLIENT_FIELDS.notes]: next } }]);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[partner-admin] audit append failed:", (err as Error).message);
  }
}

/** Resolve the host record id that owns a property (from the cached snapshot). */
async function hostIdForProperty(propertyRecordId: string): Promise<string | null> {
  const snapshot = await getSnapshot();
  for (const [hostId, props] of snapshot.propertiesByHost) {
    if (props.some((p) => p.id === propertyRecordId)) return hostId;
  }
  // Fall back to a direct read if the cache predates the property.
  const [rec] = await getRecords(TABLES.properties, [propertyRecordId]);
  const hosts = linkIds(rec?.fields[PROPERTY_FIELDS.hostLinkId]);
  return hosts[0] || null;
}

// ─── Write actions (spec §5) ─────────────────────────────────────────────────────

export interface PropertyPatch {
  standardTurnoverRate?: number;
  introRate?: number;
  introRateEndDate?: string;
  propertyStatus?: string;
  linenIncluded?: boolean;
  restockIncluded?: boolean;
  accessType?: string;
  accessInstructions?: string;
  stagingNotes?: string;
  turnoverFrequency?: string;
}

/**
 * Patch a property. Enforces the Active gate (spec §4.2 / §8): a property cannot
 * be set "Active" unless a Standard Turnover Rate (> 0) is set — either in this
 * patch or already on the record. Never touches a completed Job, so rate changes
 * apply to FUTURE turnovers only.
 */
export async function patchProperty(
  propertyRecordId: string,
  patch: PropertyPatch,
  ctx: AdminContext,
): Promise<void> {
  const wantsActive = patch.propertyStatus === PROPERTY_STATUS.active;
  let effectiveRate = patch.standardTurnoverRate;

  if (wantsActive && (effectiveRate === undefined || effectiveRate === null)) {
    const [rec] = await getRecords(TABLES.properties, [propertyRecordId]);
    effectiveRate = num(rec?.fields[PROPERTY_FIELDS.standardTurnoverRate]) ?? undefined;
  }
  if (wantsActive && !(Number(effectiveRate) > 0)) {
    throw new Error("Cannot set a property Active without a Standard Turnover Rate.");
  }

  const fields: Record<string, unknown> = {};
  if (patch.standardTurnoverRate !== undefined) fields[PROPERTY_FIELDS.standardTurnoverRate] = patch.standardTurnoverRate;
  if (patch.introRate !== undefined) fields[PROPERTY_FIELDS.introRate] = patch.introRate;
  if (patch.introRateEndDate !== undefined) fields[PROPERTY_FIELDS.introRateEndDate] = patch.introRateEndDate;
  if (patch.propertyStatus !== undefined) fields[PROPERTY_FIELDS.propertyStatus] = patch.propertyStatus;
  if (patch.linenIncluded !== undefined) fields[PROPERTY_FIELDS.linenIncluded] = patch.linenIncluded;
  if (patch.restockIncluded !== undefined) fields[PROPERTY_FIELDS.restockIncluded] = patch.restockIncluded;
  if (patch.accessType !== undefined) fields[PROPERTY_FIELDS.accessType] = patch.accessType;
  if (patch.accessInstructions !== undefined) fields[PROPERTY_FIELDS.accessInstructions] = patch.accessInstructions;
  if (patch.stagingNotes !== undefined) fields[PROPERTY_FIELDS.stagingNotes] = patch.stagingNotes;
  if (patch.turnoverFrequency !== undefined) fields[PROPERTY_FIELDS.turnoverFrequency] = patch.turnoverFrequency;

  if (Object.keys(fields).length === 0) return;

  await updateRecords(TABLES.properties, [{ id: propertyRecordId, fields: fields as never }]);
  invalidatePartnerSnapshot();

  const hostId = await hostIdForProperty(propertyRecordId);
  if (hostId) {
    const changes = Object.keys(patch).join(", ");
    await appendHostAudit(hostId, `Updated property (${changes})`, ctx);
  }
}

/**
 * Set/update a property's rates and flip it to Active (spec §5.1 — the gate that
 * turns a "Pending Pricing" property bookable). Requires a Standard Rate.
 */
export async function setPropertyRates(
  propertyRecordId: string,
  rates: { standardTurnoverRate: number; introRate?: number; introRateEndDate?: string },
  ctx: AdminContext,
): Promise<void> {
  if (!(Number(rates.standardTurnoverRate) > 0)) {
    throw new Error("A Standard Turnover Rate greater than 0 is required.");
  }
  await patchProperty(
    propertyRecordId,
    {
      standardTurnoverRate: rates.standardTurnoverRate,
      introRate: rates.introRate,
      introRateEndDate: rates.introRateEndDate,
      propertyStatus: PROPERTY_STATUS.active,
    },
    ctx,
  );
}

/** Adjust just the intro window end date (spec §5.5). */
export async function adjustIntroWindow(
  propertyRecordId: string,
  introRateEndDate: string,
  ctx: AdminContext,
): Promise<void> {
  await patchProperty(propertyRecordId, { introRateEndDate }, ctx);
}

export interface HostPatch {
  name?: string;
  company?: string;
  phone?: string;
  lifecycleStage?: string;
  onboardingStage?: string;
  agreementSigned?: boolean;
  stripeCustomerId?: string;
  paymentMethodOnFile?: string;
  notes?: string;
}

/** Inline-edit host summary fields (spec §4.1). Email is the identity key — not editable here. */
export async function patchHost(
  hostRecordId: string,
  patch: HostPatch,
  ctx: AdminContext,
): Promise<void> {
  const fields: Record<string, unknown> = {};
  if (patch.name !== undefined) fields[CLIENT_FIELDS.clientName] = patch.name;
  if (patch.company !== undefined) fields[CLIENT_FIELDS.company] = patch.company;
  if (patch.phone !== undefined) fields[CLIENT_FIELDS.phone] = patch.phone;
  if (patch.lifecycleStage !== undefined) fields[CLIENT_FIELDS.lifecycleStage] = patch.lifecycleStage;
  if (patch.onboardingStage !== undefined) fields[CLIENT_FIELDS.onboardingStage] = patch.onboardingStage;
  if (patch.agreementSigned !== undefined) fields[CLIENT_FIELDS.agreementSigned] = patch.agreementSigned;
  if (patch.stripeCustomerId !== undefined) fields[CLIENT_FIELDS.stripeCustomerId] = patch.stripeCustomerId;
  if (patch.paymentMethodOnFile !== undefined) fields[CLIENT_FIELDS.paymentMethodOnFile] = patch.paymentMethodOnFile;
  if (patch.notes !== undefined) fields[CLIENT_FIELDS.notes] = patch.notes;

  if (Object.keys(fields).length === 0) return;
  await updateRecords(TABLES.clients, [{ id: hostRecordId, fields: fields as never }]);
  invalidatePartnerSnapshot();

  // A lifecycle change is the auditable event; plain detail edits are not noisy.
  if (patch.lifecycleStage !== undefined) {
    await appendHostAudit(hostRecordId, `Lifecycle → ${patch.lifecycleStage}`, ctx);
  }
}

/**
 * Approve a host to go live (spec §5.2). Gate: agreement signed + a payment
 * method on file + at least one priced property. Sets Lifecycle = "Active",
 * Onboarding = "Live".
 */
export async function approveHostLive(hostRecordId: string, ctx: AdminContext): Promise<void> {
  const detail = await getHostDetail(hostRecordId, true);
  if (!detail) throw new Error("Host not found.");
  if (!detail.agreementSigned) throw new Error("Cannot go live: agreement not signed.");
  if (!detail.paymentMethodOnFile) throw new Error("Cannot go live: no payment method on file.");
  const hasPriced = detail.properties.some((p) => (p.standardTurnoverRate ?? 0) > 0);
  if (!hasPriced) throw new Error("Cannot go live: price at least one property first.");

  await updateRecords(TABLES.clients, [
    {
      id: hostRecordId,
      fields: {
        [CLIENT_FIELDS.lifecycleStage]: LIFECYCLE_STAGE.active,
        [CLIENT_FIELDS.onboardingStage]: ONBOARDING_STAGE.live,
      } as never,
    },
  ]);
  invalidatePartnerSnapshot();
  await appendHostAudit(hostRecordId, "Approved to go LIVE (Lifecycle=Active, Onboarding=Live)", ctx);
}

/** Pause a single property — paused properties can't be booked (spec §5.3). */
export async function pauseProperty(propertyRecordId: string, ctx: AdminContext): Promise<void> {
  await patchProperty(propertyRecordId, { propertyStatus: PROPERTY_STATUS.paused }, ctx);
}

/**
 * Pause a whole host (spec §5.3) — Lifecycle = "Paused" and every one of their
 * properties flipped to "Paused" so nothing can be booked while paused.
 */
export async function pauseHost(hostRecordId: string, ctx: AdminContext): Promise<void> {
  const snapshot = await getSnapshot();
  const props = snapshot.propertiesByHost.get(hostRecordId) || [];
  await updateRecords(TABLES.clients, [
    { id: hostRecordId, fields: { [CLIENT_FIELDS.lifecycleStage]: LIFECYCLE_STAGE.paused } as never },
  ]);
  if (props.length) {
    await updateRecords(
      TABLES.properties,
      props.map((p) => ({ id: p.id, fields: { [PROPERTY_FIELDS.propertyStatus]: PROPERTY_STATUS.paused } as never })),
    );
  }
  invalidatePartnerSnapshot();
  await appendHostAudit(hostRecordId, `Paused host + ${props.length} propert${props.length === 1 ? "y" : "ies"}`, ctx);
}

/**
 * Offboard a host (spec §5.4 / §8): Lifecycle = "Churned", properties paused so
 * no future turnovers run. NEVER deletes — history + surviving agreement terms
 * are retained.
 */
export async function offboardHost(hostRecordId: string, ctx: AdminContext): Promise<void> {
  const snapshot = await getSnapshot();
  const props = snapshot.propertiesByHost.get(hostRecordId) || [];
  await updateRecords(TABLES.clients, [
    { id: hostRecordId, fields: { [CLIENT_FIELDS.lifecycleStage]: LIFECYCLE_STAGE.churned } as never },
  ]);
  if (props.length) {
    await updateRecords(
      TABLES.properties,
      props.map((p) => ({ id: p.id, fields: { [PROPERTY_FIELDS.propertyStatus]: PROPERTY_STATUS.paused } as never })),
    );
  }
  invalidatePartnerSnapshot();
  await appendHostAudit(hostRecordId, "Offboarded host (Lifecycle=Churned, properties paused, history retained)", ctx);
}

export interface ManualTurnoverInput {
  hostRecordId: string;
  propertyRecordId?: string;
  dateCompleted: string;
  amount: number; // DOLLARS the customer paid
  cleanerName?: string;
  numberOfCleaners?: number;
  paymentStatus?: string;
}

/**
 * Log a turnover done off-system (spec §5.7) so revenue + cleaner pay stay
 * accurate. Writes a Job (STR Turnover, entry source "Manual Admin Entry"),
 * linked to the host and (optionally) the property. Job pay is computed by the
 * shared payout engine inside syncJob.
 */
export async function logManualTurnover(input: ManualTurnoverInput, ctx: AdminContext): Promise<string | null> {
  if (!input.hostRecordId) throw new Error("hostRecordId is required.");
  if (!input.dateCompleted) throw new Error("A completion date is required.");
  if (!(Number(input.amount) > 0)) throw new Error("A turnover amount greater than 0 is required.");

  const jobId = `STR-MANUAL-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const recordId = await syncJob({
    jobId,
    dateCompleted: input.dateCompleted,
    serviceType: JOB_SERVICE_TYPE.strTurnover,
    customerPaidCents: Math.round(Number(input.amount) * 100),
    cleanerName: input.cleanerName,
    numberOfCleaners: input.numberOfCleaners ?? 1,
    paymentStatus: input.paymentStatus || PAYMENT_STATUS.paid,
    entrySource: ENTRY_SOURCE.admin,
    clientRecordId: input.hostRecordId,
    propertyRecordId: input.propertyRecordId,
  });

  invalidatePartnerSnapshot();
  await appendHostAudit(
    input.hostRecordId,
    `Manual turnover logged — $${Number(input.amount).toFixed(2)} on ${input.dateCompleted}`,
    ctx,
  );
  return recordId;
}
