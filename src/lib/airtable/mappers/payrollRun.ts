import { updateRecords, upsertOne } from "../client";
import { JOB_FIELDS, PAYROLL_RUN_FIELDS, PAYROLL_STATUS, TABLES } from "../schema";
import type { Fields } from "../client";
import type { PayrollRunInput } from "./types";

const knownOptions = {
  [PAYROLL_RUN_FIELDS.status]: Object.values(PAYROLL_STATUS),
};

/**
 * Upsert a payroll run (merge on Run ID) and link the Jobs that rolled into it.
 * The cleaner is stored as text (cross-base — not a link). Money fields are in
 * dollars; the caller converts from the source's cents.
 */
export async function syncPayrollRun(run: PayrollRunInput): Promise<string | null> {
  if (!run.runId) throw new Error("syncPayrollRun: runId is required (it's the merge key).");

  const fields: Fields = {
    [PAYROLL_RUN_FIELDS.runId]: run.runId,
    [PAYROLL_RUN_FIELDS.cleanerName]: run.cleanerName,
    [PAYROLL_RUN_FIELDS.periodStart]: run.periodStart,
    [PAYROLL_RUN_FIELDS.periodEnd]: run.periodEnd,
    [PAYROLL_RUN_FIELDS.totalJobs]: run.totalJobs,
    [PAYROLL_RUN_FIELDS.grossPay]: run.grossPay,
    [PAYROLL_RUN_FIELDS.bonus]: run.bonus,
    [PAYROLL_RUN_FIELDS.deduction]: run.deduction,
    [PAYROLL_RUN_FIELDS.netPay]: run.netPay,
    [PAYROLL_RUN_FIELDS.paymentMethod]: run.paymentMethod,
    [PAYROLL_RUN_FIELDS.status]: run.status,
    [PAYROLL_RUN_FIELDS.sentAt]: run.sentAt,
    [PAYROLL_RUN_FIELDS.stripeTransferId]: run.stripeTransferId,
    [PAYROLL_RUN_FIELDS.notes]: run.notes,
  };

  const runRecordId = await upsertOne(TABLES.payrollRuns, [PAYROLL_RUN_FIELDS.runId], fields, {
    knownOptions,
  });

  // Link the run's jobs from the Job side ("Payroll Run" link field on Jobs),
  // which we know exists. Airtable mirrors it onto the run's reverse field.
  if (runRecordId && run.jobRecordIds && run.jobRecordIds.length) {
    await updateRecords(
      TABLES.jobs,
      run.jobRecordIds.map((id) => ({ id, fields: { [JOB_FIELDS.payrollRun]: [runRecordId] } })),
    );
  }

  return runRecordId;
}
