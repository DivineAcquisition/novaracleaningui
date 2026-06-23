// Public surface for the Airtable "Client & Revenue Ops" integration.
export * from "./schema";
export * from "./pay";
export {
  upsertRecords,
  upsertOne,
  updateRecords,
  findRecordIdByField,
  listRecords,
  getRecords,
  createLinkField,
  listTableFields,
  listBaseTables,
  ping,
  getBaseId,
  AirtableError,
} from "./client";
export type { Fields, FieldValue, AirtableRecord, UpsertResult, MetaField, MetaTable } from "./client";
export * from "./mappers";
export * from "./host-onboarding";
export * from "./partner-admin";
