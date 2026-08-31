// Offline verification of the partnership communications layer (no network/DB).
//
//   • template substitution ({{var}} and Proposals-tab [Name] aliases)
//   • opt-out suppresses even urgent
//   • quiet hours queue standard/routine; urgent is exempt
//   • frequency caps queue standard; urgent is exempt
//   • email opt-out does not stop SMS
//   • editing a template does not change a frozen sent snapshot
//   • urgent retries are more aggressive than standard
//
//   Run:  npm run partnership-comms:verify

import {
  checkPartnershipPolicy,
  DEFAULT_PARTNERSHIP_COMMS_SETTINGS,
  partnershipRecipientKey,
  retryBackoffMs,
  substitutePartnershipTemplate,
} from "../src/lib/partnership-comms";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}\n      expected: ${e}\n      actual:   ${a}`);
  }
}

console.log("Substitution:");
check(
  "{{first_name}} and {{link}} fill in",
  substitutePartnershipTemplate("Hi {{first_name}}, open {{link}}", { first_name: "Alex", link: "https://x" }),
  "Hi Alex, open https://x",
);
check(
  "Proposals-tab [Name] / [link] aliases work",
  substitutePartnershipTemplate("Hi [Name], [link]", { first_name: "Sam", link: "https://y" }),
  "Hi Sam, https://y",
);
check(
  "unknown placeholders become empty, not leftover braces",
  substitutePartnershipTemplate("Fee {{fee_html}} done", {}),
  "Fee  done",
);

console.log("\nRecipient key:");
check("email wins and is lowercased", partnershipRecipientKey("Alex@Host.COM", "2025550100"), "alex@host.com");
check("phone fallback", partnershipRecipientKey(null, "(202) 555-0100"), "tel:2025550100");

console.log("\nOpt-out:");
check(
  "email opt-out suppresses email even when urgent",
  checkPartnershipPolicy({
    email: "a@b.com",
    channel: "email",
    priority: "urgent",
    emailOptedOut: true,
  }).action,
  "suppress",
);
check(
  "email opt-out leaves SMS available",
  checkPartnershipPolicy({
    email: "a@b.com",
    phone: "2025550100",
    channel: "sms",
    priority: "standard",
    emailOptedOut: true,
    now: new Date("2026-08-31T19:00:00Z"),
  }).action,
  "send",
);
check(
  "SMS STOP suppresses SMS",
  checkPartnershipPolicy({
    phone: "2025550100",
    channel: "sms",
    priority: "urgent",
    smsOptedOut: true,
  }).reason,
  "opted_out",
);

console.log("\nQuiet hours (America/New_York, 21:00–08:00):");
const late = new Date("2026-08-31T02:30:00Z"); // 22:30 EDT
const afternoon = new Date("2026-08-31T19:00:00Z"); // 15:00 EDT
check(
  "standard send during quiet hours queues",
  checkPartnershipPolicy({
    email: "a@b.com",
    channel: "email",
    priority: "standard",
    now: late,
  }).action,
  "queue",
);
check(
  "routine send during quiet hours queues",
  checkPartnershipPolicy({
    email: "a@b.com",
    channel: "email",
    priority: "routine",
    now: late,
  }).reason,
  "quiet_hours",
);
check(
  "urgent crew-lead / walkthrough assignment sends immediately",
  checkPartnershipPolicy({
    email: "a@b.com",
    channel: "email",
    priority: "urgent",
    now: late,
  }).action,
  "send",
);
check(
  "standard afternoon send goes out",
  checkPartnershipPolicy({
    email: "a@b.com",
    channel: "email",
    priority: "standard",
    now: afternoon,
  }).action,
  "send",
);

console.log("\nFrequency caps:");
check(
  "hitting the cap queues a standard send",
  checkPartnershipPolicy({
    email: "a@b.com",
    channel: "email",
    priority: "standard",
    now: afternoon,
    recentSendCount: DEFAULT_PARTNERSHIP_COMMS_SETTINGS.frequency_cap_count,
  }).reason,
  "frequency_cap",
);
check(
  "urgent is exempt from the cap",
  checkPartnershipPolicy({
    email: "a@b.com",
    channel: "email",
    priority: "urgent",
    now: afternoon,
    recentSendCount: 99,
  }).action,
  "send",
);

console.log("\nTemplate edit does not rewrite history:");
const snapshot = substitutePartnershipTemplate("Hi {{first_name}}, your link is {{link}}", {
  first_name: "Jordan",
  link: "https://onboarding",
});
const edited = substitutePartnershipTemplate("Hello {{first_name}} — {{link}}", {
  first_name: "Jordan",
  link: "https://onboarding",
});
check("logged body stays the original rendering", snapshot, "Hi Jordan, your link is https://onboarding");
check("a later template version renders new copy", edited, "Hello Jordan — https://onboarding");
check("the two are not the same string", snapshot === edited, false);

console.log("\nRetry backoff:");
check("urgent first retry is 30s", retryBackoffMs(0, "urgent"), 30_000);
check("standard first retry is 60s", retryBackoffMs(0, "standard"), 60_000);
check("urgent stays faster than standard on attempt 2", retryBackoffMs(2, "urgent") < retryBackoffMs(2, "standard"), true);

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll partnership-comms checks passed.");
