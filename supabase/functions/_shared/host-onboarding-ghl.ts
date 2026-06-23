// ─── STR Host Onboarding → GoHighLevel ────────────────────────────────────
//
// The GHL side of the host onboarding form (spec §3.1, §3.2, §4, §5).
// Reuses the battle-tested ghl-client plumbing. Everything is best-effort and
// never throws — a CRM hiccup can't break a host's application.
//
// Contract sending uses the robust GHL pattern: we set custom fields + an
// opportunity, then apply a TAG that a GHL Workflow listens for to send the
// correct Document/Contract template (with vs. without the personal-guarantee
// block). The entity branch (spec §4) is enforced here by choosing the tag —
// an Individual can never receive the entity-guarantee template.
//
// GHL Workflows to configure (documented for the operator):
//   • Tag `send-host-agreement-individual` → send the standard Host Agreement.
//   • Tag `send-host-agreement-entity`     → send the Host Agreement WITH the
//     personal-guarantee block; merges {{contact.entity_name}}.
//   • On "document signed" → POST to /api/host-onboarding/signed.

import {
  addContactTags,
  createOpportunity,
  ghlIsConfigured,
  updateOpportunity,
  upsertContact,
} from "./ghl-client.ts";
import { hostIdentityFields } from "./ghl-partner-field-map.ts";

const log = (step: string, details?: unknown) => {
  const tail = details === undefined ? "" : ` ${JSON.stringify(details)}`;
  console.log(`[GHL-HOST-ONB] ${step}${tail}`);
};

function splitName(name?: string | null): { firstName?: string; lastName?: string } {
  const n = (name || "").trim();
  if (!n) return {};
  const parts = n.split(/\s+/);
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") || undefined };
}

export interface HostOnboardingContactInput {
  fullName: string;
  email: string;
  phone: string;
  entityType: "individual" | "entity";
  entityName?: string;
  serviceZone?: string;
  propertyCount: number;
}

/**
 * Upsert the host as an "STR Host" GHL contact with the onboarding custom
 * fields (spec §3.1 + §4). Unknown custom-field keys are silently skipped by
 * the client, so this is safe even before every field exists in GHL.
 */
export async function upsertHostOnboardingContact(
  input: HostOnboardingContactInput,
): Promise<string | null> {
  if (!ghlIsConfigured()) {
    log("skipped — GHL not configured");
    return null;
  }
  const { firstName, lastName } = splitName(input.fullName);
  const isEntity = input.entityType === "entity";
  return upsertContact({
    email: input.email || undefined,
    phone: input.phone || undefined,
    firstName,
    lastName,
    name: input.fullName || undefined,
    source: "Novara Host Onboarding",
    tags: [
      "partner - host",
      "str host",
      "host onboarding",
      isEntity ? "host-entity" : "host-individual",
    ],
    customFieldsByKey: hostIdentityFields({
      entityType: input.entityType,
      entityName: input.entityName,
      propertyCount: input.propertyCount,
      serviceZone: input.serviceZone,
      partnerStatus: "Onboarding",
      onboardingStage: "Agreement Pending",
    }),
  });
}

/** File the onboarding opportunity on the host contact (spec §3.1). */
export async function createHostOnboardingOpportunity(
  contactId: string,
  input: { fullName: string; email: string },
): Promise<string | null> {
  if (!ghlIsConfigured() || !contactId) return null;
  return createOpportunity({
    contactId,
    name: `STR Host Onboarding — ${(input.fullName || input.email).trim()}`,
    status: "open",
    source: "Novara Host Onboarding",
    customFieldsByKey: {
      partner_status: "Onboarding",
      onboarding_stage: "Agreement Pending",
    },
  });
}

/**
 * Send the partnership agreement for signature (spec §3.2 + §4 + §5.3).
 * Applies the entity-aware tag that triggers the correct GHL document
 * Workflow, and advances stage to "Agreement Sent". A short rate summary is
 * stored on a custom field so the merged document reflects the actual rates.
 */
export async function sendHostAgreement(input: {
  contactId: string;
  email: string;
  entityType: "individual" | "entity";
  entityName?: string;
  rateSummary?: string;
  opportunityId?: string | null;
}): Promise<boolean> {
  if (!ghlIsConfigured() || !input.contactId) return false;
  const isEntity = input.entityType === "entity";
  const tag = isEntity ? "send-host-agreement-entity" : "send-host-agreement-individual";

  await addContactTags(input.contactId, [tag, "host-agreement-sent"]);
  await upsertContact({
    email: input.email,
    customFieldsByKey: {
      onboarding_stage: "Agreement Sent",
      host_entity_type: isEntity ? "Entity" : "Individual",
      entity_name: isEntity ? (input.entityName || "") : "",
      rate_schedule_summary: input.rateSummary || "",
    },
  });
  if (input.opportunityId) {
    await updateOpportunity(input.opportunityId, {
      customFieldsByKey: { onboarding_stage: "Agreement Sent" },
    });
  }
  log("agreement send triggered", { contactId: input.contactId, tag });
  return true;
}

/** On signature (spec §5.4): mark Signed + Active in GHL. */
export async function markHostAgreementSigned(input: {
  contactId?: string | null;
  email: string;
  opportunityId?: string | null;
}): Promise<boolean> {
  if (!ghlIsConfigured()) return false;
  if (input.contactId) {
    await addContactTags(input.contactId, ["host-agreement-signed"]);
  }
  await upsertContact({
    email: input.email,
    customFieldsByKey: {
      onboarding_stage: "Signed",
      partner_status: "Active",
    },
  });
  if (input.opportunityId) {
    await updateOpportunity(input.opportunityId, {
      status: "won",
      customFieldsByKey: { onboarding_stage: "Signed", partner_status: "Active" },
    });
  }
  log("agreement signed recorded", { email: input.email });
  return true;
}
