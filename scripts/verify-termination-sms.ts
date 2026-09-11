// Offline lock on the termination SMS sent whenever a contractor is closed.
//
//   Run:  npm run termination-sms:verify

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { pulseSmsMessage } from "../src/lib/pulse-check/send";
import { buildTerminationSms, TERMINATION_SMS_HR } from "../src/lib/termination-sms";
import { buildTerminationSms as denoBuild } from "../supabase/functions/_shared/termination-sms.ts";

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

const sms = buildTerminationSms();
console.log("Termination SMS:");
check("names Novara", sms.startsWith("Novara:"), true);
check("says engagement ended", sms.includes("ended"), true);
check("closes portal and jobs", sms.includes("Portal access") && sms.includes("new jobs"), true);
check("points to HR", sms.includes(TERMINATION_SMS_HR), true);
check("stays short", sms.length < 320, true);
check("no reason dump", /misconduct|blacklist|no-show/i.test(sms), false);
check("Deno copy matches src", denoBuild(), sms);
check(
  "pulse closed SMS uses the same notice",
  pulseSmsMessage("Maya", "https://x/p/abc", "closed"),
  sms,
);

console.log("\nEvery terminate path texts:");
const wired: Array<[string, string]> = [
  ["supabase/functions/terminate-cleaner/index.ts", "notifyContractorTerminated"],
  ["supabase/functions/cleaner-admin-action/index.ts", "notifyContractorTerminated"],
  ["supabase/functions/cleaner-accountability/index.ts", "notifyContractorTerminated"],
  ["supabase/functions/pulse-check-runner/index.ts", "notifyContractorTerminated"],
  ["src/lib/pulse-check/roster.ts", "notifyContractorTerminated"],
];
for (const [file, needle] of wired) {
  const src = readFileSync(resolve(file), "utf8");
  check(`${file} calls ${needle}`, src.includes(needle), true);
}

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll termination SMS checks passed.");
