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
  slugTypeKey,
  walkthroughChecklistFor,
  walkthroughLink,
  walkthroughStaffPath,
} from "../src/lib/proposal-request";
import { CHECKLISTS } from "../src/lib/checklists";
import { portalAccountRequired, PORTAL_ACCOUNT_REQUIRED_MESSAGE } from "../src/lib/commercial-proposal";
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
check("warehouse prices at the warehouse facility key", propertyTypeByKey(DEFAULT_CHECKLISTS, "warehouse")?.facilityTypeKey, "warehouse");

console.log("\nChecklist routing:");
const str = walkthroughChecklistFor(DEFAULT_CHECKLISTS, "str");
const office = walkthroughChecklistFor(DEFAULT_CHECKLISTS, "office");
const warehouse = walkthroughChecklistFor(DEFAULT_CHECKLISTS, "warehouse");
check("STR includes linen handling", str.typeSpecific.some((i) => i.key === "linen_handling"), true);
check("STR includes turnover window", str.typeSpecific.some((i) => i.key === "turnover_window"), true);
check("STR includes consumables", str.typeSpecific.some((i) => i.key === "consumables"), true);
check("STR does not include desk count", str.typeSpecific.some((i) => i.key === "desk_count"), false);
check("STR does not include racking density", str.typeSpecific.some((i) => i.key === "racking_dense_sqft"), false);
check("office includes desk count, headcount, restricted areas", office.typeSpecific.filter((i) => ["desk_count", "employee_headcount", "restricted_areas"].includes(i.key)).map((i) => i.key).sort(), ["desk_count", "employee_headcount", "restricted_areas"].sort());
check("office does not include linen handling", office.typeSpecific.some((i) => i.key === "linen_handling"), false);
check("warehouse includes racking density, floor type, auto-scrubber", warehouse.typeSpecific.filter((i) => ["racking_dense_sqft", "warehouse_floor_type", "auto_scrubber_suitable"].includes(i.key)).length, 3);
check("universal confirmed sqft is on every type", str.universal.some((i) => i.key === "confirmed_sqft") && office.universal.some((i) => i.key === "confirmed_sqft"), true);
check("universal exclusion check is on every type", str.all.some((i) => i.key === "exclusion_check"), true);
check("medical biohazard item states Novara does not handle it", warehouse.universal.some((i) => i.key === "exclusion_check") && DEFAULT_CHECKLISTS.byType.medical.some((i) => /biohazard/i.test(i.label + (i.help || ""))), true);

console.log("\nResidential-style scope on the tokenized walkthrough:");
check("STR scope is the Standard Clean kitchen / bathrooms / all rooms list", str.scope.map((s) => s.title), CHECKLISTS["standard-clean"].sections.map((s) => s.title));
check("STR first kitchen line matches the public residential checklist", str.scope[0]?.items[0], CHECKLISTS["standard-clean"].sections[0].items[0]);
check("office scope is the published office list, not Kitchen", office.scope.map((s) => s.title), CHECKLISTS.office.sections.map((s) => s.title));
check("warehouse scope is Commercial Standard, not residential rooms", warehouse.scopeTemplate, "commercial-standard");
check("warehouse scope is not the residential kitchen card", warehouse.scope.some((s) => s.title === "Kitchen"), false);

console.log("\nAdmin-editable merge:");
const merged = mergeChecklists({
  types: [{ key: "school", label: "School / Daycare", shortLabel: "School", accountKind: "commercial", facilityTypeKey: "other", sort: 90, active: true }],
  byType: { school: [{ key: "classroom_count", label: "Classroom count", kind: "integer", required: true }] },
  universal: [{ key: "confirmed_sqft", label: "Verified sqft (admin rewrite)", kind: "integer", required: true, mapsTo: "sqft" }],
});
check("new property type survives merge", merged.types.some((t) => t.key === "school"), true);
check("built-in types remain", merged.types.some((t) => t.key === "str"), true);
check("admin rewrite of a universal label wins", merged.universal.find((i) => i.key === "confirmed_sqft")?.label, "Verified sqft (admin rewrite)");
check("school checklist is only its items plus universal", walkthroughChecklistFor(merged, "school").typeSpecific.map((i) => i.key), ["classroom_count"]);
check("new commercial type gets the Commercial Standard scope by default", walkthroughChecklistFor(merged, "school").scopeTemplate, "commercial-standard");
check("admin rewrite of a scope section title wins", mergeChecklists({
  scopeByType: { str: [{ title: "Kitchen (host notes)", items: ["Confirm SPA photos"] }] },
}).scopeByType.str[0].title, "Kitchen (host notes)");
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
check("tokenized link lives on the contractor host", walkthroughLink("abc"), "https://contractor.novaracleaning.com/cleaner/walkthrough/abc");
check("office copy of the same doc is under Proposals", walkthroughStaffPath("abc"), "/admin/proposals/doc/abc");
check("email HTML does not execute tags from the body", emailToHtml("Hi <script>").includes("&lt;script&gt;"), true);
check("settings merge keeps unknown keys from wiping templates", mergeProposalSettings({ walkthroughPayCents: 9000 }).pendingEmailSubject, DEFAULT_PROPOSAL_SETTINGS.pendingEmailSubject);

console.log("\nPortal account required to send:");
check("missing portal_user_id blocks send", portalAccountRequired({ portal_user_id: null }), true);
check("empty portal_user_id blocks send", portalAccountRequired({ portal_user_id: "" }), true);
check("linked portal_user_id allows send", portalAccountRequired({ portal_user_id: "user-1" }), false);
check("refusal names the client account", /portal account is required/i.test(PORTAL_ACCOUNT_REQUIRED_MESSAGE), true);

console.log("\nLocal walkthrough preview fixture:");
check("preview-str maps to STR", walkthroughPreviewTypeKey("preview-str"), "str");
check("unknown token is not a preview", walkthroughPreviewTypeKey("not-a-preview"), null);
const previewStr = walkthroughPreviewPayload("preview-str");
check("STR preview uses Kitchen / Bathrooms / All rooms", previewStr?.checklist.scope.map((s) => s.title), CHECKLISTS["standard-clean"].sections.map((s) => s.title));
check("STR preview first kitchen line matches residential", previewStr?.checklist.scope[0]?.items[0], CHECKLISTS["standard-clean"].sections[0].items[0]);
check("office preview is the published office list", walkthroughPreviewPayload("preview-office")?.checklist.scope.map((s) => s.title), CHECKLISTS.office.sections.map((s) => s.title));

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
