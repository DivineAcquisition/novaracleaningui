// Offline checks for Facebook lead alert helpers (source detection, Meta
// Lead Ads field mapping, email/Discord copy).
//
//   Run:  npm run facebook-leads:verify

import {
  extractMetaLeadgenIds,
  facebookLeadDiscordDescription,
  isFacebookLeadSource,
  isMetaLeadWebhook,
  leadDisplayName,
  mapMetaLeadFields,
  renderFacebookLeadEmail,
  splitFullName,
} from "../supabase/functions/_shared/lead-alerts.ts";

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

console.log("Facebook lead source detection:");
check("fb_lead_ads", isFacebookLeadSource("fb_lead_ads"), true);
check("Facebook", isFacebookLeadSource("Facebook"), true);
check("FB Ads", isFacebookLeadSource("FB Ads"), true);
check("fb", isFacebookLeadSource("fb"), true);
check("instagram", isFacebookLeadSource("instagram"), true);
check("website is not facebook", isFacebookLeadSource("website"), false);
check("manual is not facebook", isFacebookLeadSource("manual"), false);
check("lsa is not facebook", isFacebookLeadSource("lsa"), false);
check("empty is not facebook", isFacebookLeadSource(""), false);

console.log("Meta field mapping:");
const mapped = mapMetaLeadFields([
  { name: "full_name", values: ["Jane Q Public"] },
  { name: "email", values: ["jane@example.com"] },
  { name: "phone_number", values: ["+1 (301) 555-0100"] },
  { name: "zip_code", values: ["20816"] },
  { name: "city", values: ["Bethesda"] },
  { name: "which_service_are_you_interested_in", values: ["Standard clean"] },
  { name: "how_did_you_hear_about_us", values: ["Instagram"] },
]);
check("first from full_name", mapped.firstName, "Jane");
check("last from full_name", mapped.lastName, "Q Public");
check("email", mapped.email, "jane@example.com");
check("phone", mapped.phone, "+1 (301) 555-0100");
check("zip", mapped.zipCode, "20816");
check("city", mapped.city, "Bethesda");
check("service", mapped.serviceType, "Standard clean");
check("extra fields land in notes", mapped.notes, "how did you hear about us: Instagram");

const split = mapMetaLeadFields([
  { name: "first_name", values: ["Sam"] },
  { name: "last_name", values: ["Lee"] },
]);
check("explicit first/last win", `${split.firstName} ${split.lastName}`, "Sam Lee");
check("splitFullName one word", splitFullName("Nikkia"), { firstName: "Nikkia", lastName: "" });

console.log("Meta webhook shape:");
const metaBody = {
  object: "page",
  entry: [
    {
      changes: [
        { field: "leadgen", value: { leadgen_id: "111" } },
        { field: "leadgen", value: { leadgen_id: "111" } },
        { field: "leadgen", value: { leadgen_id: "222" } },
      ],
    },
  ],
};
check("isMetaLeadWebhook", isMetaLeadWebhook(metaBody), true);
check("isMetaLeadWebhook rejects lead-intake json", isMetaLeadWebhook({ source: "fb_lead_ads", phone: "301" }), false);
check("extractMetaLeadgenIds dedupes", extractMetaLeadgenIds(metaBody), ["111", "222"]);
check("empty page webhook", extractMetaLeadgenIds({ object: "page", entry: [] }), []);

console.log("Staff copy:");
const lead = {
  leadId: "abc",
  source: "fb_lead_ads",
  firstName: "Jane",
  lastName: "Public",
  email: "jane@example.com",
  phone: "3015550100",
  zipCode: "20816",
  assignedVaName: "Anna",
};
check("display name", leadDisplayName(lead), "Jane Public");
const email = renderFacebookLeadEmail(lead);
check("email subject names the lead", email.subject.includes("Jane P."), true);
check("email subject has zip", email.subject.includes("20816"), true);
check("email html has tel link", email.html.includes("tel:3015550100"), true);
check("email html escapes nothing needed", email.html.includes("Jane Public"), true);
const desc = facebookLeadDiscordDescription(lead);
check("discord copy names assignee", desc.includes("Anna"), true);

const xss = renderFacebookLeadEmail({
  leadId: "x",
  source: "facebook",
  firstName: "<script>",
  lastName: "Alert",
});
check("email escapes html in name", xss.html.includes("&lt;script&gt;"), true);
check("email does not include raw script tag", xss.html.includes("<script>"), false);

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nfacebook-leads:verify ok");
