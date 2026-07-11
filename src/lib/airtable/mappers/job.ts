import { findRecordIdByField, upsertOne } from "../client";
import { ENTRY_SOURCE, JOB_FIELDS, JOB_SERVICE_TYPE, PAYMENT_STATUS, TABLES } from "../schema";
import {
  centsToDollars,
  computeJobPay,
  normalizeTier,
  payPeriodMonday,
  TIER_PCT,
} from "../pay";
import type { Fields } from "../client";
import { LOOKUP_FIELD_NAMES } from "./types";
import type { JobInput } from "./types";

const knownOptions = {
  [JOB_FIELDS.serviceType]: Object.values(JOB_SERVICE_TYPE),
  [JOB_FIELDS.paymentStatus]: Object.values(PAYMENT_STATUS),
  [JOB_FIELDS.entrySource]: Object.values(ENTRY_SOURCE),
};

/**
 * Upsert a completed job (merge on Job ID), computing the LOCKED pay before
 * writing:
 *   • tier % from the cleaner's tier at completion (35/40/45)
 *   • pool = customer_paid × tier %
 *   • per-cleaner = pool ÷ number_of_cleaners
 *   • pay period = Monday of the week of date_completed
 *
 * Links the job to its Client (and Property for STR turnovers) and, when known,
 * its Payroll Run. The cleaner is stored as text ("Cleaner (Name)") because the
 * Contractors table lives in a separate base and Airtable links can't cross
 * bases.
 *
 * Authoritative pre-computed pay (cleanerPayPoolCents / payPerCleanerCents) wins
 * over the estimate so Airtable matches the money the cleaner is actually paid.
 */
export async function syncJob(job: JobInput): Promise<string | null> {
  if (!job.jobId) throw new Error("syncJob: jobId is required (it's the merge key).");

  const tierPct = job.tierPct ?? TIER_PCT[normalizeTier(job.tier)];
  const cleanerCount = Math.max(1, Math.floor(job.numberOfCleaners ?? 1));
  const computed = computeJobPay(job.customerPaidCents, tierPct, cleanerCount);

  const poolDollars =
    job.cleanerPayPoolCents != null
      ? centsToDollars(job.cleanerPayPoolCents)
      : computed.poolDollars;
  const perCleanerDollars =
    job.payPerCleanerCents != null
      ? centsToDollars(job.payPerCleanerCents)
      : computed.perCleanerDollars;

  const payPeriod = job.dateCompleted ? payPeriodMonday(job.dateCompleted) : undefined;

  // Resolve links.
  let clientRecordId = job.clientRecordId ?? null;
  if (!clientRecordId && job.clientEmail) {
    clientRecordId = await findRecordIdByField(
      TABLES.clients,
      LOOKUP_FIELD_NAMES.clientEmail,
      job.clientEmail,
    );
  }
  let propertyRecordId = job.propertyRecordId ?? null;
  if (!propertyRecordId && job.propertyNickname) {
    propertyRecordId = await findRecordIdByField(
      TABLES.properties,
      LOOKUP_FIELD_NAMES.propertyNickname,
      job.propertyNickname,
    );
  }

  const fields: Fields = {
    [JOB_FIELDS.jobId]: job.jobId,
    [JOB_FIELDS.dateCompleted]: job.dateCompleted,
    [JOB_FIELDS.serviceType]: job.serviceType,
    [JOB_FIELDS.customerPaid]: centsToDollars(job.customerPaidCents),
    [JOB_FIELDS.cleanerName]: job.cleanerName,
    [JOB_FIELDS.numberOfCleaners]: cleanerCount,
    [JOB_FIELDS.tierPctLocked]: computed.tierPct,
    [JOB_FIELDS.cleanerPayPool]: poolDollars,
    [JOB_FIELDS.payPerCleaner]: perCleanerDollars,
    [JOB_FIELDS.payPeriod]: payPeriod,
    [JOB_FIELDS.paymentStatus]: job.paymentStatus,
    [JOB_FIELDS.entrySource]: job.entrySource,
    // QC documentation — only written when the columns exist in Airtable
    // (sync.ts strips these if ensureQcJobFields could not create them).
    ...(job.driveFolderUrl ? { [JOB_FIELDS.driveFolder]: job.driveFolderUrl } : {}),
    ...(job.documented !== undefined ? { [JOB_FIELDS.documented]: job.documented } : {}),
    ...(clientRecordId ? { [JOB_FIELDS.client]: [clientRecordId] } : {}),
    ...(propertyRecordId ? { [JOB_FIELDS.property]: [propertyRecordId] } : {}),
    ...(job.payrollRunRecordId ? { [JOB_FIELDS.payrollRun]: [job.payrollRunRecordId] } : {}),
  };

  return upsertOne(TABLES.jobs, [JOB_FIELDS.jobId], fields, { knownOptions });
}
