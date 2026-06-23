// ─── STR Host Onboarding → Airtable ───────────────────────────────────────
//
// Orchestrates the Airtable side of the host onboarding form (spec §3.3):
//   1. Upsert the host into Clients (merge on Email) as an "STR Host".
//   2. Capture the Client record id.
//   3. Upsert each property into Properties (merge on Nickname), linked to the
//      host, at "Pending Pricing" with NO rates (admin sets them later).
//
// Plus the lifecycle helpers used by the sequencing routes (spec §5):
//   • markHostAgreementSent  — flips Onboarding Stage to "Agreement Sent".
//   • markHostAgreementSigned — Onboarding Stage "Signed", Agreement Signed,
//     and flips every linked property to "Active".
//   • readPropertyRates       — gate that blocks sending a blank-rate contract.
//
// All writes are idempotent (upsert on natural key) so re-submitting updates
// rather than duplicating.

import { getRecords, updateRecords, upsertOne } from "./client";
import { syncClient, syncProperty } from "./mappers";
import {
  CLIENT_FIELDS,
  CLIENT_TYPE,
  PROPERTY_FIELDS,
  TABLES,
} from "./schema";

export interface HostOnboardingProperty {
  nickname: string;
  address?: string;
  bedrooms?: number;
  bathrooms?: number;
  sqft?: number;
  linen?: boolean;
  restock?: boolean;
  accessType?: string;
  accessInstructions?: string;
  stagingNotes?: string;
}

export interface HostOnboardingInput {
  fullName: string;
  email: string;
  phone: string;
  entityType: "individual" | "entity";
  entityName?: string;
  serviceZone?: string;
  properties: HostOnboardingProperty[];
}

export interface HostOnboardingAirtableResult {
  clientRecordId: string | null;
  propertyRecordIds: string[];
}

const PROPERTY_STATUS_PENDING = "Pending Pricing";
const PROPERTY_STATUS_ACTIVE = "Active";

/**
 * Create/refresh the Client + Properties for a host submission. Returns the
 * Airtable record ids so the caller can persist them for later patching.
 */
export async function syncHostOnboardingToAirtable(
  input: HostOnboardingInput,
): Promise<HostOnboardingAirtableResult> {
  const clientRecordId = await syncClient({
    email: input.email,
    name: input.fullName,
    type: CLIENT_TYPE.strHost,
    company: input.entityType === "entity" ? input.entityName : undefined,
    phone: input.phone,
    serviceZone: input.serviceZone,
    leadSource: "Host Onboarding Form",
    lifecycleStage: "Onboarding",
    onboardingStage: "Pending Pricing",
    agreementType: "STR Partnership",
  });

  const propertyRecordIds: string[] = [];
  for (const p of input.properties) {
    if (!p.nickname?.trim()) continue;
    const id = await syncProperty({
      nickname: p.nickname.trim(),
      address: p.address,
      bedrooms: p.bedrooms,
      bathrooms: p.bathrooms,
      sqft: p.sqft,
      linenIncluded: p.linen,
      restockIncluded: p.restock,
      accessType: p.accessType,
      accessInstructions: p.accessInstructions,
      stagingNotes: p.stagingNotes,
      propertyStatus: PROPERTY_STATUS_PENDING,
      // Rates intentionally omitted — admin applies them later.
      hostRecordId: clientRecordId ?? undefined,
      hostEmail: clientRecordId ? undefined : input.email,
    });
    if (id) propertyRecordIds.push(id);
  }

  return { clientRecordId, propertyRecordIds };
}

/** Flip the host's Client record to a given Onboarding Stage (merge on email). */
export async function setHostOnboardingStage(email: string, stage: string): Promise<void> {
  await upsertOne(TABLES.clients, [CLIENT_FIELDS.email], {
    [CLIENT_FIELDS.email]: email,
    [CLIENT_FIELDS.onboardingStage]: stage,
  });
}

/** Onboarding Stage → "Agreement Sent" once rates are applied (spec §5.3). */
export async function markHostAgreementSent(email: string): Promise<void> {
  await setHostOnboardingStage(email, "Agreement Sent");
}

/**
 * On signature (spec §5.4): Onboarding Stage "Signed", Agreement Signed = true,
 * and every linked property flipped to "Active".
 */
export async function markHostAgreementSigned(
  email: string,
  propertyRecordIds: string[],
): Promise<void> {
  await upsertOne(TABLES.clients, [CLIENT_FIELDS.email], {
    [CLIENT_FIELDS.email]: email,
    [CLIENT_FIELDS.onboardingStage]: "Signed",
    [CLIENT_FIELDS.agreementSigned]: true,
  });
  const ids = (propertyRecordIds || []).filter(Boolean);
  if (ids.length) {
    await updateRecords(
      TABLES.properties,
      ids.map((id) => ({ id, fields: { [PROPERTY_FIELDS.propertyStatus]: PROPERTY_STATUS_ACTIVE } })),
    );
  }
}

export interface PropertyRate {
  recordId: string;
  nickname: string;
  standardTurnoverRate: number | null;
  introRate: number | null;
}

/**
 * Read back the admin-set rates for the host's properties. The send-contract
 * route uses this to BLOCK sending a blank-rate schedule (spec §5 guardrail).
 */
export async function readPropertyRates(propertyRecordIds: string[]): Promise<PropertyRate[]> {
  const records = await getRecords(TABLES.properties, propertyRecordIds);
  return records.map((r) => {
    const f = r.fields as Record<string, unknown>;
    const rate = f[PROPERTY_FIELDS.standardTurnoverRate];
    const intro = f[PROPERTY_FIELDS.introRate];
    return {
      recordId: r.id,
      nickname: String(f[PROPERTY_FIELDS.propertyNickname] ?? ""),
      standardTurnoverRate: typeof rate === "number" ? rate : rate ? Number(rate) : null,
      introRate: typeof intro === "number" ? intro : intro ? Number(intro) : null,
    };
  });
}
