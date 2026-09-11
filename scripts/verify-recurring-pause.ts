// Offline lock on recurring-schedule pause copy (SMS + email).
//
//   Run:  npm run recurring-pause:verify

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildRecurringPauseReason,
  buildRecurringPauseSms,
  CUSTOMER_SELF_PAUSE_REASON,
  CUSTOMER_SELF_PAUSE_REASON_CODE,
  customerSelfPauseFields,
  DEFAULT_RECURRING_PAUSE_REASON,
  RECURRING_PAUSE_EMAIL_SUBJECT,
  RECURRING_PAUSE_PHONE,
  recurringResumeClearFields,
} from "../src/lib/recurring-pause";
import {
  buildRecurringPauseReason as denoReason,
  buildRecurringPauseSms as denoSms,
  CUSTOMER_SELF_PAUSE_REASON as denoSelfReason,
  CUSTOMER_SELF_PAUSE_REASON_CODE as denoSelfCode,
  customerSelfPauseFields as denoSelfPause,
  RECURRING_PAUSE_EMAIL_SUBJECT as denoSubject,
  recurringResumeClearFields as denoResumeClear,
} from "../supabase/functions/_shared/recurring-pause.ts";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}\n      expected: ${e}\n      actual:   ${a}`);
  }
}

console.log("Recurring pause copy:");
const laure = buildRecurringPauseReason("cleaner_unavailable", "Laure");
check("default reason is cleaner unavailable", DEFAULT_RECURRING_PAUSE_REASON, "cleaner_unavailable");
check(
  "Laure cleaner-unavailable reason",
  laure,
  "Laure, your cleaning is paused until we find a replacement because your previous cleaner is no longer available.",
);
check("names the customer", laure.startsWith("Laure,"), true);
check("says paused until replacement", laure.includes("paused until we find a replacement"), true);
check("says previous cleaner unavailable", laure.includes("previous cleaner is no longer available"), true);

const sms = buildRecurringPauseSms(laure);
check("SMS names Novara", sms.startsWith("Novara:"), true);
check("SMS includes the reason", sms.includes("previous cleaner is no longer available"), true);
check("SMS points to the office", sms.includes(RECURRING_PAUSE_PHONE), true);
check("SMS stays short", sms.length < 320, true);
check("email subject is paused", RECURRING_PAUSE_EMAIL_SUBJECT.includes("paused"), true);

check("other with custom uses that wording", buildRecurringPauseReason("other", "Laure", "Closed for renovations."), "Closed for renovations.");
check("other without custom is empty", buildRecurringPauseReason("other", "Laure"), "");
check("Deno reason matches src", denoReason("cleaner_unavailable", "Laure"), laure);
check("Deno SMS matches src", denoSms(laure), sms);
check("Deno subject matches src", denoSubject, RECURRING_PAUSE_EMAIL_SUBJECT);

check("customer self-pause copy", CUSTOMER_SELF_PAUSE_REASON, "Paused by the customer.");
check("customer self-pause code is not an admin picker id", CUSTOMER_SELF_PAUSE_REASON_CODE, "customer_self");
check("Deno customer self-pause copy matches src", denoSelfReason, CUSTOMER_SELF_PAUSE_REASON);
check("Deno customer self-pause code matches src", denoSelfCode, CUSTOMER_SELF_PAUSE_REASON_CODE);
check("resume clears pause_reason", recurringResumeClearFields().pause_reason, null);
check("resume clears pause_reason_code", recurringResumeClearFields().pause_reason_code, null);
check("resume clears paused_at", recurringResumeClearFields().paused_at, null);
check("Deno resume clear matches src", denoResumeClear(), recurringResumeClearFields());
const selfPause = customerSelfPauseFields();
check("customer pause overwrites reason", selfPause.pause_reason, CUSTOMER_SELF_PAUSE_REASON);
check("customer pause stamps customer_self", selfPause.pause_reason_code, CUSTOMER_SELF_PAUSE_REASON_CODE);
check("customer pause stamps paused_at", typeof selfPause.paused_at === "string" && selfPause.paused_at.length > 0, true);
const denoPause = denoSelfPause();
check("Deno customer pause reason matches src", denoPause.pause_reason, selfPause.pause_reason);
check("Deno customer pause code matches src", denoPause.pause_reason_code, selfPause.pause_reason_code);

console.log("\nWired through pause + email:");
const wired: Array<[string, string]> = [
  ["supabase/functions/admin-recurring-pause/index.ts", "buildRecurringPauseSms"],
  ["supabase/functions/send-membership-email/index.ts", "recurring_paused"],
  ["src/components/admin/PauseRecurringDialog.tsx", "admin-recurring-pause"],
  ["src/views/admin/RecurringSchedules.tsx", "PauseRecurringDialog"],
  ["src/views/admin/RecurringSchedules.tsx", "recurringResumeClearFields"],
  ["supabase/functions/manage-recurring-schedule/index.ts", "recurringResumeClearFields"],
  ["supabase/functions/manage-recurring-schedule/index.ts", "customerSelfPauseFields"],
  ["supabase/functions/customer-manage-recurring/index.ts", "recurringResumeClearFields"],
  ["supabase/functions/customer-manage-recurring/index.ts", "customerSelfPauseFields"],
];
for (const [file, needle] of wired) {
  const src = readFileSync(resolve(file), "utf8");
  check(`${file} includes ${needle}`, src.includes(needle), true);
}

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll recurring-pause checks passed.");
