import { upsertOne } from "../client";
import { CLIENT_FIELDS, CLIENT_TYPE, TABLES } from "../schema";
import type { Fields } from "../client";
import type { ClientInput } from "./types";

const knownOptions = {
  [CLIENT_FIELDS.clientType]: Object.values(CLIENT_TYPE),
};

/**
 * Upsert a client into the Clients table, merging on Email so re-running never
 * duplicates. Returns the Airtable record id (used to link Jobs / Properties /
 * Commercial Accounts back to the client).
 *
 * Carries the crucial data that also lands in GHL: lead source, lifecycle
 * stage, service zone, Stripe customer id, SMS opt-in.
 */
export async function syncClient(client: ClientInput): Promise<string | null> {
  if (!client.email) throw new Error("syncClient: email is required (it's the merge key).");

  const fields: Fields = {
    [CLIENT_FIELDS.email]: client.email,
    [CLIENT_FIELDS.clientName]: client.name,
    [CLIENT_FIELDS.clientType]: client.type,
    [CLIENT_FIELDS.company]: client.company,
    [CLIENT_FIELDS.phone]: client.phone,
    [CLIENT_FIELDS.serviceZone]: client.serviceZone,
    [CLIENT_FIELDS.leadSource]: client.leadSource,
    [CLIENT_FIELDS.lifecycleStage]: client.lifecycleStage,
    [CLIENT_FIELDS.onboardingStage]: client.onboardingStage,
    [CLIENT_FIELDS.agreementSigned]: client.agreementSigned,
    [CLIENT_FIELDS.agreementType]: client.agreementType,
    [CLIENT_FIELDS.stripeCustomerId]: client.stripeCustomerId,
    [CLIENT_FIELDS.paymentMethodOnFile]: client.paymentMethodOnFile,
    [CLIENT_FIELDS.smsOptIn]: client.smsOptIn,
  };

  return upsertOne(TABLES.clients, [CLIENT_FIELDS.email], fields, { knownOptions });
}
