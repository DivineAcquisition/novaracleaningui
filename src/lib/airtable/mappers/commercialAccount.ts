import { findRecordIdByField, upsertOne } from "../client";
import { COMMERCIAL_ACCOUNT_FIELDS, TABLES } from "../schema";
import type { Fields } from "../client";
import { LOOKUP_FIELD_NAMES } from "./types";
import type { CommercialAccountInput } from "./types";

/**
 * Upsert a commercial account (merge on Business Name) and link it to its
 * Decision Maker (Client), resolved from a record id or by email.
 */
export async function syncCommercialAccount(account: CommercialAccountInput): Promise<string | null> {
  if (!account.businessName) {
    throw new Error("syncCommercialAccount: businessName is required (it's the merge key).");
  }

  let decisionMakerId = account.decisionMakerRecordId ?? null;
  if (!decisionMakerId && account.decisionMakerEmail) {
    decisionMakerId = await findRecordIdByField(
      TABLES.clients,
      LOOKUP_FIELD_NAMES.clientEmail,
      account.decisionMakerEmail,
    );
  }

  const fields: Fields = {
    [COMMERCIAL_ACCOUNT_FIELDS.businessName]: account.businessName,
    [COMMERCIAL_ACCOUNT_FIELDS.accountType]: account.accountType,
    [COMMERCIAL_ACCOUNT_FIELDS.accountStatus]: account.accountStatus,
    [COMMERCIAL_ACCOUNT_FIELDS.serviceFrequency]: account.serviceFrequency,
    [COMMERCIAL_ACCOUNT_FIELDS.cleaningWindow]: account.cleaningWindow,
    [COMMERCIAL_ACCOUNT_FIELDS.monthlyContractValue]: account.monthlyContractValue,
    [COMMERCIAL_ACCOUNT_FIELDS.perVisitRate]: account.perVisitRate,
    [COMMERCIAL_ACCOUNT_FIELDS.contractStart]: account.contractStart,
    [COMMERCIAL_ACCOUNT_FIELDS.contractTerm]: account.contractTerm,
    [COMMERCIAL_ACCOUNT_FIELDS.billingCycle]: account.billingCycle,
    [COMMERCIAL_ACCOUNT_FIELDS.stripeCustomerId]: account.stripeCustomerId,
    ...(decisionMakerId ? { [COMMERCIAL_ACCOUNT_FIELDS.decisionMaker]: [decisionMakerId] } : {}),
  };

  return upsertOne(TABLES.commercialAccounts, [COMMERCIAL_ACCOUNT_FIELDS.businessName], fields);
}
