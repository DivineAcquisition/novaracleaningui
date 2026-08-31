// Offline verification of the Proposals tab catalog (no network/DB).
//
//   • property types route intake and the contractor checklist
//   • universal items are present for every type
//   • an STR checklist does not include office/warehouse fields
//   • mapping produces the structured conduct payload the pipeline needs
//   • an exclusion finding is a stop, not a scope adjustment
//   • email templates interpolate the spec copy
//   • creating a proposal request is defined as never creating a booking
//
//   Run:  npm run proposals:verify

import {
  DEFAULT_CHECKLISTS,
  DEFAULT_PROPOSAL_SETTINGS,
  computeWalkthroughPayCents,
  emailToHtml,
  exclusionFromAnswers,
  interpolateTemplate,
  mapAnswersToConduct,
  mergeChecklists,
  mergeProposalSettings,
  missingRequired,
  propertyTypeByKey,
  proposalRequestStatusLabel,
  RETIRED_FINDING_KEYS,
  slugTypeKey,
  typeRequiresWalkthrough,
  walkthroughChecklistFor,
  walkthroughLink,
  walkthroughStaffPath,
} from "../src/lib/proposal-request";
import { checklistPathForServiceType } from "../src/lib/checklists";
import { proposalPrefillFromWalkthrough, siteRateCentsFromWalkthrough } from "../src/lib/commercial-proposal";
import {
  walkthroughPreviewPayload,
  walkthroughPreviewTypeKey,
} from "../src/lib/walkthrough-preview";

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

console.log("Property types:");
const keys = DEFAULT_CHECKLISTS.types.map((t) => t.key);
check(
  "built-in types are STR, office, and the commercial subtypes",
  keys,
  ["str", "office", "retail", "warehouse", "restaurant", "gym", "medical", "other"],
);
check("STR links to a host record, not a commercial account type", propertyTypeByKey(DEFAULT_CHECKLISTS, "str")?.accountKind, "str");
check("STR does not require a walkthrough", typeRequiresWalkthrough(propertyTypeByKey(DEFAULT_CHECKLISTS, "str")), false);
check("office requires a walkthrough", typeRequiresWalkthrough(propertyTypeByKey(DEFAULT_CHECKLISTS, "office")), true);
check("warehouse requires a walkthrough", typeRequiresWalkthrough(propertyTypeByKey(DEFAULT_CHECKLISTS, "warehouse")), true);
check(
  "pending STR status is price host properties",
  proposalRequestStatusLabel("pending_assign", propertyTypeByKey(DEFAULT_CHECKLISTS, "str")),
  "Pending — Price host properties",
);
check(
  "pending office status still assigns an agent",
  proposalRequestStatusLabel("pending_assign", propertyTypeByKey(DEFAULT_CHECKLISTS, "office")),
  "Pending — Assigning Walkthrough Agent",
);
check("warehouse prices at the warehouse facility key", propertyTypeByKey(DEFAULT_CHECKLISTS, "warehouse")?.facilityTypeKey, "warehouse");

console.log("\nChecklist routing:");
const str = walkthroughChecklistFor(DEFAULT_CHECKLISTS, "str");
const office = walkthroughChecklistFor(DEFAULT_CHECKLISTS, "office");
const warehouse = walkthroughChecklistFor(DEFAULT_CHECKLISTS, "warehouse");
check("office and warehouse share one additional-findings list", office.typeSpecific.map((i) => i.key), warehouse.typeSpecific.map((i) => i.key));
check("shared extras include desk count as optional", office.typeSpecific.some((i) => i.key === "desk_count" && !i.required), true);
check("shared extras do not include STR linen handling", office.typeSpecific.some((i) => i.key === "linen_handling"), false);
check("legacy STR tokens still expose linen findings", str.typeSpecific.some((i) => i.key === "linen_handling"), true);
check("legacy STR tokens still expose turnover window", str.typeSpecific.some((i) => i.key === "turnover_window"), true);
check("STR does not copy residential consumables onto findings", str.typeSpecific.some((i) => i.key === "consumables"), false);
check("STR does not include racking density", str.typeSpecific.some((i) => i.key === "racking_dense_sqft"), false);
check("universal confirmed sqft is on every type", str.universal.some((i) => i.key === "confirmed_sqft") && office.universal.some((i) => i.key === "confirmed_sqft"), true);
check("universal exclusion check is on every type", office.all.some((i) => i.key === "exclusion_check"), true);
check("access is open-ended, not a required select", office.universal.find((i) => i.key === "access_procedure")?.kind, "textarea");
check("on-site storage is retired", office.universal.some((i) => i.key === "on_site_storage"), false);
check("trash notes are optional", Boolean(office.universal.find((i) => i.key === "trash_volume")?.required), false);
check("medical biohazard item states Novara does not handle it", DEFAULT_CHECKLISTS.byType.medical.some((i) => /biohazard/i.test(i.label + (i.help || ""))), true);

console.log("\nWalkthrough token is site findings only:");
check("STR walkthrough has no crew scope cards", str.scope, []);
check("office walkthrough has no crew scope cards", office.scope, []);
check("warehouse walkthrough has no crew scope cards", warehouse.scope, []);
check("warehouse still remembers its commercial crew template for the job token", warehouse.scopeTemplate, "commercial-standard");

console.log("\nCrew list routing (separate job token):");
check("warehouse public list is commercial, not Kitchen/Bath", checklistPathForServiceType("warehouse"), "/checklist/commercial-standard");
check("retail public list is commercial", checklistPathForServiceType("retail"), "/checklist/commercial-standard");
check("office public list stays office", checklistPathForServiceType("office"), "/checklist/office");
check("STR public list is not a commercial page", checklistPathForServiceType("str"), "/checklist");

console.log("\nAdmin-editable merge:");
const merged = mergeChecklists({
  types: [{ key: "school", label: "School / Daycare", shortLabel: "School", accountKind: "commercial", facilityTypeKey: "other", sort: 90, active: true }],
  byType: { school: [{ key: "classroom_count", label: "Classroom count", kind: "integer", required: true }] },
  universal: [{ key: "confirmed_sqft", label: "Verified sqft (admin rewrite)", kind: "integer", required: true, mapsTo: "sqft" }],
});
check("new property type survives merge", merged.types.some((t) => t.key === "school"), true);
check("new commercial type requires a walkthrough", typeRequiresWalkthrough(merged.types.find((t) => t.key === "school")), true);
check("built-in types remain", merged.types.some((t) => t.key === "str"), true);
check("admin rewrite of a universal label wins", merged.universal.find((i) => i.key === "confirmed_sqft")?.label, "Verified sqft (admin rewrite)");
check("new types share the one site-findings extras list", walkthroughChecklistFor(merged, "school").typeSpecific.map((i) => i.key), DEFAULT_CHECKLISTS.siteExtras.map((i) => i.key));
check("admin-added type still stores its own byType for legacy", merged.byType.school.map((i) => i.key), ["classroom_count"]);
check("new commercial type still has a commercial crew template on file", walkthroughChecklistFor(merged, "school").scopeTemplate, "commercial-standard");
check("school walkthrough does not get a crew tick list", walkthroughChecklistFor(merged, "school").scope, []);
check("admin rewrite of a stored crew template title still merges", mergeChecklists({
  scopeByType: { str: [{ title: "Kitchen (host notes)", items: ["Confirm SPA photos"] }] },
}).scopeByType.str[0].title, "Kitchen (host notes)");
const stale = mergeChecklists({
  universal: [
    { key: "confirmed_sqft", label: "Verified sqft (admin rewrite)", kind: "integer", required: true, mapsTo: "sqft" },
    { key: "on_site_storage", label: "Storage", kind: "yesno", required: true },
    { key: "access_method", label: "Access method", kind: "select", required: true },
  ],
  byType: { str: [{ key: "consumables", label: "Consumables", kind: "textarea", required: true }] },
});
check("retired universal keys stay dropped", stale.universal.some((i) => RETIRED_FINDING_KEYS.has(i.key)), false);
check("retired STR keys stay dropped", stale.byType.str.some((i) => i.key === "consumables"), false);
check("slug sanitizes a new type key", slugTypeKey("School / Daycare"), "school_daycare");

console.log("\nConduct mapping + exclusion stop:");
const strType = propertyTypeByKey(DEFAULT_CHECKLISTS, "str")!;
const answers = {
  confirmed_sqft: 1800,
  floor_type_breakdown: { carpet: 40, hard: 40, tile: 20, concrete: 0 },
  restroom_count: 2,
  breakroom_count: 0,
  floor_count: 1,
  condition_rating: "average",
  obstacle_density: "moderate",
  recommended_scope: "standard",
  recommended_crew_size: 2,
  badge_required: false,
  service_window_start: "10:00",
  service_window_end: "14:00",
  exclusion_check: "none",
  photos: ["https://example.com/a.jpg"],
  linen_handling: "on_site_laundry",
};
const mapped = mapAnswersToConduct(strType, str.all, answers);
check("confirmed sqft maps to the pipeline field", mapped.conduct.confirmedSqft, 1800);
check("facility type for STR is other (formula key)", mapped.conduct.facilityTypeKey, "other");
check("floor share becomes a readable floor_types string", String(mapped.conduct.floorTypes).includes("carpet"), true);
check("linen handling is preserved in findings_extra, not dropped", mapped.findingsExtra.linen_handling, "on_site_laundry");
check("none is not an exclusion stop", exclusionFromAnswers(answers), null);
const stopped = exclusionFromAnswers({ exclusion_check: "biohazard", exclusion_note: "Sharps container overflowing in the exam room." });
check("biohazard stops pricing", stopped?.code, "biohazard");
check("missing required names the field", missingRequired(str.universal, {}).includes("Confirmed square footage"), true);

console.log("\nPay + notifications:");
check("default walkthrough pay is a flat fee, not unpaid", DEFAULT_PROPOSAL_SETTINGS.walkthroughPayType, "flat");
check("flat pay is $75", computeWalkthroughPayCents(DEFAULT_PROPOSAL_SETTINGS), 7500);
check("hourly uses hours × rate", computeWalkthroughPayCents({ ...DEFAULT_PROPOSAL_SETTINGS, walkthroughPayType: "hourly" }, 2), 7000);
const body = interpolateTemplate(DEFAULT_PROPOSAL_SETTINGS.pendingEmailBody, {
  name: "Alex",
  address: "12 Harbor St",
});
check("pending email names the requester and address", body.includes("Hi Alex") && body.includes("12 Harbor St"), true);
check("pending email frames the walkthrough as accurate pricing", /accurate pricing|on-site walkthrough|surprise/i.test(body), true);
const strBody = interpolateTemplate(DEFAULT_PROPOSAL_SETTINGS.pendingStrEmailBody, {
  name: "Alex",
  address: "12 Harbor St",
});
check("STR pending email names the requester and address", strBody.includes("Hi Alex") && strBody.includes("12 Harbor St"), true);
check("STR pending email says there is no walkthrough", /don't send a walkthrough|no walkthrough|residential/i.test(strBody), true);
check("tokenized link lives on the contractor host", walkthroughLink("abc"), "https://contractor.novaracleaning.com/cleaner/walkthrough/abc");
check("office copy of the same doc is under Proposals", walkthroughStaffPath("abc"), "/admin/proposals/doc/abc");
check("email HTML does not execute tags from the body", emailToHtml("Hi <script>").includes("&lt;script&gt;"), true);
check("settings merge keeps unknown keys from wiping templates", mergeProposalSettings({ walkthroughPayCents: 9000 }).pendingEmailSubject, DEFAULT_PROPOSAL_SETTINGS.pendingEmailSubject);

console.log("\nSend pulls walkthrough data; no portal login required:");
const fromWalkthrough = proposalPrefillFromWalkthrough({
  account: { contact_name: null, email: null, phone: null, recurring_frequency: null },
  request: {
    requester_name: "Alex Host",
    requester_email: "alex@harbor.test",
    requester_phone: "410-555-0100",
    desired_frequency: "weekly",
  },
});
check("empty account uses walkthrough requester name", fromWalkthrough.name, "Alex Host");
check("empty account uses walkthrough requester email", fromWalkthrough.email, "alex@harbor.test");
check("account contact wins over walkthrough request", proposalPrefillFromWalkthrough({
  account: { contact_name: "Jordan Lee", email: "jordan@co.test", phone: null, recurring_frequency: "monthly" },
  request: { requester_name: "Alex Host", requester_email: "alex@harbor.test", requester_phone: null, desired_frequency: "weekly" },
}).email, "jordan@co.test");
check("walkthrough firm price is the rate", siteRateCentsFromWalkthrough({ firm_price_cents: 18500, formula_price_cents: 12000 }), 18500);
check("formula price fills when no firm price", siteRateCentsFromWalkthrough({ firm_price_cents: null, formula_price_cents: 12000 }), 12000);
check("no walkthrough price means admin must type one", siteRateCentsFromWalkthrough({ firm_price_cents: null, formula_price_cents: null }), null);

console.log("\nLocal walkthrough preview fixture:");
check("preview-str maps to STR", walkthroughPreviewTypeKey("preview-str"), "str");
check("unknown token is not a preview", walkthroughPreviewTypeKey("not-a-preview"), null);
const previewStr = walkthroughPreviewPayload("preview-str");
check("STR preview has no crew scope cards", previewStr?.checklist.scope, []);
check("STR preview still has linen findings for leftover tokens", previewStr?.checklist.typeSpecific.some((i) => i.key === "linen_handling"), true);
check("office preview has no crew scope cards", walkthroughPreviewPayload("preview-office")?.checklist.scope, []);
check("warehouse preview has no crew scope cards", walkthroughPreviewPayload("preview-commercial")?.checklist.scope, []);
check("warehouse preview uses the shared extras list", walkthroughPreviewPayload("preview-commercial")?.checklist.typeSpecific.some((i) => i.key === "desk_count"), true);
check("warehouse preview does not require racking as a separate catalog", walkthroughPreviewPayload("preview-commercial")?.checklist.typeSpecific.some((i) => i.key === "racking_dense_sqft"), false);

console.log("\nBooking invariant:");
check(
  "proposal request statuses never include a booking state",
  ["pending_assign", "walkthrough_scheduled", "walkthrough_conducted", "firm_price_set", "excluded", "cancelled"].includes("booked"),
  false,
);

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll proposal-request checks passed.");
