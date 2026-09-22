// Offline lock: Terminate Contractor and Log Resignation are separate
// actions. Accountability keeps its own ladder and notices.
//
//   Run:  npm run engagement-end:verify

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  CONTRACTOR_OPS_EMAIL,
  CONTRACTOR_OPS_FROM,
  CONTRACTOR_SIGNER_LINE,
  DEFAULT_NOTICES,
  abandonmentInstancesInWindow,
  evaluateW9Status,
  formatEffectiveDate,
  mergeNoticeTemplate,
  noticeWordingProblems,
  renderDepartureNotice,
  validateTerminationSelection,
} from "../src/lib/engagement-end.ts";
import {
  CONTRACTOR_OPS_FROM as denoFrom,
  DEFAULT_NOTICES as denoNotices,
  abandonmentInstancesInWindow as denoAbandonment,
  evaluateW9Status as denoW9,
  renderDepartureNotice as denoRender,
  validateTerminationSelection as denoValidate,
} from "../supabase/functions/_shared/engagement-end.ts";

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

const srcFile = readFileSync(resolve("src/lib/engagement-end.ts"), "utf8");
const denoFile = readFileSync(resolve("supabase/functions/_shared/engagement-end.ts"), "utf8");
check("edge copy matches src", denoFile, srcFile);
check("sender identity matches", denoFrom, CONTRACTOR_OPS_FROM);
check("default notices match", denoNotices, DEFAULT_NOTICES);

const now = new Date("2026-09-22T15:00:00Z");
function instance(id: string, job: string | null, daysAgo: number, issue_type = "no_show") {
  return {
    id,
    job_id: job,
    created_at: new Date(now.getTime() - daysAgo * 86_400_000).toISOString(),
    issue_type,
  };
}

const two = abandonmentInstancesInWindow([
  instance("a", "job-1", 1),
  instance("b", "job-2", 2),
], now);
check("two instances cannot use section 6.4", two.allowed, false);
check("two instances count as two", two.count, 2);
check("deno abandonment matches", denoAbandonment([
  instance("a", "job-1", 1),
  instance("b", "job-2", 2),
], now), two);

const three = abandonmentInstancesInWindow([
  instance("a", "job-1", 1),
  instance("b", "job-2", 8),
  instance("c", "job-3", 20),
], now);
check("three instances in 30 days can use section 6.4", three.allowed, true);

const spread = abandonmentInstancesInWindow([
  instance("a", "job-1", 1),
  instance("b", "job-2", 41),
  instance("c", "job-3", 82),
], now);
check("three instances outside one window cannot", spread.allowed, false);

const deduped = abandonmentInstancesInWindow([
  instance("flag", "job-1", 3, "no_show"),
  instance("qc", "job-1", 3, "no_show"),
  instance("other", "job-2", 4, "job_abandonment"),
], now);
check("same job flag and QC case count once", deduped.count, 2);
check("deduped pair is still under the threshold", deduped.allowed, false);

const ignored = abandonmentInstancesInWindow([
  instance("a", "job-1", 1, "quality_issue"),
  instance("b", null, 1, "abandonment"),
  instance("c", "job-3", 2, "abandonment"),
  instance("d", "job-4", 3, "abandonment"),
], now);
check("only abandonment issue types count", ignored.count, 3);

const blocked = validateTerminationSelection({
  basis: "job_abandonment",
  abandonmentAllowed: false,
});
check("6.4 selection is rejected under the threshold", blocked.ok, false);
if (!blocked.ok) check("threshold code", blocked.code, "ABANDONMENT_THRESHOLD");
check("deno validator matches", denoValidate({
  basis: "job_abandonment",
  abandonmentAllowed: false,
}), blocked);

const allowed = validateTerminationSelection({
  basis: "job_abandonment",
  abandonmentAllowed: true,
});
check("6.4 selection is accepted at the threshold", allowed.ok && allowed.section, "6.4");

const forCause = validateTerminationSelection({
  basis: "for_cause",
  ground: "misconduct",
  abandonmentAllowed: false,
});
check("for-cause keeps the ground off the notice path", forCause.ok && forCause.ground, "misconduct");

const missingGround = validateTerminationSelection({
  basis: "for_cause",
  abandonmentAllowed: true,
});
check("for-cause without a ground is rejected", missingGround.ok, false);

const noCause = validateTerminationSelection({
  basis: "no_cause",
  abandonmentAllowed: false,
});
check("no-cause does not need abandonment history", noCause.ok && noCause.section, "5.2");

const vars = {
  firstName: "Maya",
  effectiveDate: formatEffectiveDate("2026-09-22"),
  signoff: CONTRACTOR_SIGNER_LINE,
  operationsEmail: CONTRACTOR_OPS_EMAIL,
};
const termination = renderDepartureNotice(DEFAULT_NOTICES.termination, vars);
const resignation = renderDepartureNotice(DEFAULT_NOTICES.resignation, vars);
check("deno render matches", denoRender(DEFAULT_NOTICES.resignation, vars), resignation);
check("termination notice says terminated", /\bterminated\b/i.test(`${termination.subject}\n${termination.body}\n${termination.sms}`), true);
check("termination email says terminated", /\bterminated\b/i.test(`${termination.subject}\n${termination.body}`), true);
check("termination sms says terminated", /\bterminated\b/i.test(termination.sms), true);
check("resignation notice never says terminat", /terminat/i.test(`${resignation.subject}\n${resignation.body}\n${resignation.sms}`), false);
check("both notices cite section 5.4", /Section 5\.4/.test(termination.body) && /Section 5\.4/.test(resignation.body), true);
check("termination wording is clean", noticeWordingProblems("termination", termination, {
  internalNote: "kept off the notice on purpose",
  forbiddenPhrases: ["Misconduct or unprofessional conduct", "Job abandonment"],
}), []);
check("resignation wording is clean", noticeWordingProblems("resignation", resignation, {
  internalNote: "kept off the notice on purpose",
}), []);
check("notices are signed by Malik", termination.body.includes(CONTRACTOR_SIGNER_LINE) && resignation.body.includes(CONTRACTOR_SIGNER_LINE), true);
check("notices use the operations address", termination.sms.includes(CONTRACTOR_OPS_EMAIL) && resignation.sms.includes(CONTRACTOR_OPS_EMAIL), true);
check("from address is NVC Operations", CONTRACTOR_OPS_FROM, "NVC Operations <operations@novaracleaning.com>");

const leaked = noticeWordingProblems("resignation", {
  ...resignation,
  body: `${resignation.body}\nkept off the notice on purpose`,
}, { internalNote: "kept off the notice on purpose" });
check("internal note cannot ride along", leaked.includes("reason_in_notice"), true);

const badPolicy = noticeWordingProblems("termination", mergeNoticeTemplate(DEFAULT_NOTICES.termination, {
  body: "Your engagement is terminated per our policy.",
}), {});
check("per policy is rejected", badPolicy.includes("per_policy"), true);

const badResign = noticeWordingProblems("resignation", mergeNoticeTemplate(DEFAULT_NOTICES.resignation, {
  sms: "Novara: Your engagement is terminated.",
}), {});
check("resignation template cannot say terminated", badResign.includes("resignation_says_terminat"), true);

check("complete W-9", evaluateW9Status({ payouts_enabled: true, stripe_account_id: "acct_1", ob_payouts_setup: true }), "complete");
check("incomplete W-9", evaluateW9Status({ payouts_enabled: false, stripe_account_id: "acct_1", ob_payouts_setup: false }), "incomplete");
check("setup without payouts is incomplete", evaluateW9Status({ payouts_enabled: false, stripe_account_id: null, ob_payouts_setup: true }), "incomplete");
check("missing W-9", evaluateW9Status({ payouts_enabled: false, stripe_account_id: null, ob_payouts_setup: false }), "missing");
check("deno W-9 matches", denoW9({ payouts_enabled: true, stripe_account_id: "acct_1" }), "complete");

const migration = readFileSync(resolve("supabase/migrations/20260922150000_engagement_end_and_1099_prep.sql"), "utf8");
check("migration seeds the termination subject", migration.includes(DEFAULT_NOTICES.termination.subject), true);
check("migration seeds the resignation subject", migration.includes(DEFAULT_NOTICES.resignation.subject), true);
check("migration seeds the termination sms", migration.includes(DEFAULT_NOTICES.termination.sms), true);
check("migration seeds the resignation sms", migration.includes(DEFAULT_NOTICES.resignation.sms), true);
check("migration flags the 1099 batch", migration.includes("nec_1099_include"), true);

const terminateFn = readFileSync(resolve("supabase/functions/terminate-cleaner/index.ts"), "utf8");
check("terminate-cleaner does not reuse the shared closure SMS", terminateFn.includes("notifyContractorTerminated"), false);
check("terminate-cleaner does not say Human Resources", terminateFn.includes("Human Resources"), false);
check("terminate-cleaner does not mail hr@", terminateFn.includes("hr@novaracleaning.com"), false);
check("old voluntary resignation reason is gone", terminateFn.includes("voluntary_resignation"), false);
check("tax prep is called", terminateFn.includes("prepareDepartureTax"), true);
check("no 1099 document is sent", terminateFn.includes("nec_1099_sent: false"), true);
check("resignation clears a live termination reason", terminateFn.includes("patch.termination_reason = null"), true);

const adminAction = readFileSync(resolve("supabase/functions/cleaner-admin-action/index.ts"), "utf8");
check("directory shortcut cannot terminate", adminAction.includes("USE_ENGAGEMENT_END"), true);
check("directory shortcut does not text the shared SMS", adminAction.includes("notifyContractorTerminated"), false);
check("setup link does not read stripeOk", adminAction.includes("stripeOk"), false);
check("setup event records the agreement step", adminAction.includes("needs_agreement: !agreementOk"), true);

const accountability = readFileSync(resolve("supabase/functions/cleaner-accountability/index.ts"), "utf8");
check("accountability still texts the shared SMS", accountability.includes("notifyContractorTerminated"), true);
check("accountability does not import engagement-end", accountability.includes("engagement-end"), false);
check(
  "accountability from address is unchanged",
  accountability.includes('const FROM_ADDRESS = "NovaraCleaning Operations <hello@novaracleaning.com>";'),
  true,
);
check("accountability escalation copy is unchanged", accountability.includes("escalation policy"), true);

const portal = readFileSync(resolve("src/lib/cleaner-auth.ts"), "utf8");
const contractorPortal = readFileSync(resolve("contractor-app/src/lib/cleaner-auth.ts"), "utf8");
check("portal blocks resigned", portal.includes('"resigned"'), true);
check("contractor app blocks resigned", contractorPortal.includes('"resigned"'), true);

const tax = readFileSync(resolve("supabase/functions/_shared/departure-tax.ts"), "utf8");
check("tax prep does not generate a 1099", /generate1099|form_1099|CreateForm1099/i.test(tax), false);
check("disputed payroll lines are skipped", tax.includes('=== "disputed"'), true);

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll engagement-end checks passed.");
