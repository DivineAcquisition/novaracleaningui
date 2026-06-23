import { findRecordIdByField, upsertOne } from "../client";
import { PROPERTY_FIELDS, TABLES } from "../schema";
import type { Fields } from "../client";
import { LOOKUP_FIELD_NAMES } from "./types";
import type { PropertyInput } from "./types";

/**
 * Upsert a property into the Properties table (merge on Property Nickname) and
 * link it to its Host (Client). The host link is resolved from `hostRecordId`
 * if given, otherwise looked up by `hostEmail`.
 */
export async function syncProperty(property: PropertyInput): Promise<string | null> {
  if (!property.nickname) {
    throw new Error("syncProperty: nickname is required (it's the merge key).");
  }

  let hostRecordId = property.hostRecordId ?? null;
  if (!hostRecordId && property.hostEmail) {
    hostRecordId = await findRecordIdByField(
      TABLES.clients,
      LOOKUP_FIELD_NAMES.clientEmail,
      property.hostEmail,
    );
  }

  const fields: Fields = {
    [PROPERTY_FIELDS.propertyNickname]: property.nickname,
    [PROPERTY_FIELDS.address]: property.address,
    [PROPERTY_FIELDS.bedrooms]: property.bedrooms,
    [PROPERTY_FIELDS.bathrooms]: property.bathrooms,
    [PROPERTY_FIELDS.sqft]: property.sqft,
    [PROPERTY_FIELDS.standardTurnoverRate]: property.standardTurnoverRate,
    [PROPERTY_FIELDS.introRate]: property.introRate,
    [PROPERTY_FIELDS.introRateEndDate]: property.introRateEndDate,
    [PROPERTY_FIELDS.linenIncluded]: property.linenIncluded,
    [PROPERTY_FIELDS.restockIncluded]: property.restockIncluded,
    [PROPERTY_FIELDS.accessType]: property.accessType,
    [PROPERTY_FIELDS.propertyStatus]: property.propertyStatus,
    [PROPERTY_FIELDS.turnoverFrequency]: property.turnoverFrequency,
    ...(hostRecordId ? { [PROPERTY_FIELDS.host]: [hostRecordId] } : {}),
  };

  return upsertOne(TABLES.properties, [PROPERTY_FIELDS.propertyNickname], fields);
}
