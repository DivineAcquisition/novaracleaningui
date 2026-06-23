import { findRecordIdByField, upsertOne } from "../client";
import { SITE_FIELDS, TABLES } from "../schema";
import type { Fields } from "../client";
import { LOOKUP_FIELD_NAMES } from "./types";
import type { SiteInput } from "./types";

/**
 * Upsert a site (merge on Site Nickname) and link it to its Commercial Account,
 * resolved from a record id or by business name.
 */
export async function syncSite(site: SiteInput): Promise<string | null> {
  if (!site.nickname) {
    throw new Error("syncSite: nickname is required (it's the merge key).");
  }

  let accountId = site.commercialAccountRecordId ?? null;
  if (!accountId && site.commercialAccountName) {
    accountId = await findRecordIdByField(
      TABLES.commercialAccounts,
      LOOKUP_FIELD_NAMES.commercialBusinessName,
      site.commercialAccountName,
    );
  }

  const fields: Fields = {
    [SITE_FIELDS.siteNickname]: site.nickname,
    [SITE_FIELDS.address]: site.address,
    [SITE_FIELDS.sqft]: site.sqft,
    [SITE_FIELDS.facilityType]: site.facilityType,
    [SITE_FIELDS.restrooms]: site.restrooms,
    [SITE_FIELDS.floors]: site.floors,
    [SITE_FIELDS.floorTypes]: site.floorTypes,
    [SITE_FIELDS.accessMethod]: site.accessMethod,
    [SITE_FIELDS.addOnServices]: site.addOnServices,
    ...(accountId ? { [SITE_FIELDS.commercialAccount]: [accountId] } : {}),
  };

  return upsertOne(TABLES.sites, [SITE_FIELDS.siteNickname], fields);
}
