// Offline checks for the Google Ads lead form webhook mapper.
//
//   Run:  npm run google-ads-webhook:verify

import {
  googleAdsKeyMatches,
  isGoogleAdsLeadPayload,
  mapGoogleAdsLead,
} from "../supabase/functions/google-ads-webhook/google-ads-lead.ts";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}\n      expected: ${e}\n      actual:   ${a}`);
  }
}

const sample = {
  lead_id: "TeSter-123",
  user_column_data: [
    { column_name: "Full Name", string_value: "Ada Lovelace", column_id: "FULL_NAME" },
    { column_name: "User Email", string_value: "ada@example.com", column_id: "EMAIL" },
    { column_name: "User Phone", string_value: "+14105550123", column_id: "PHONE_NUMBER" },
    { column_name: "Postal Code", string_value: "21201", column_id: "POSTAL_CODE" },
    { column_name: "City", string_value: "Baltimore", column_id: "CITY" },
    { column_name: "How often?", string_value: "Weekly", column_id: "CUSTOM_FREQ" },
  ],
  form_id: 11,
  campaign_id: 22,
  gcl_id: "gclid-abc",
  google_key: "secret-key",
  is_test: false,
};

check("recognizes a Google lead form body", isGoogleAdsLeadPayload(sample), true);
check("rejects a normal lead-intake body", isGoogleAdsLeadPayload({ source: "website", phone: "301" }), false);
check("key match", googleAdsKeyMatches("secret-key", "secret-key"), true);
check("key mismatch", googleAdsKeyMatches("secret-key", "other-key"), false);
check("empty expected key never matches", googleAdsKeyMatches("secret-key", ""), false);

const mapped = mapGoogleAdsLead(sample);
check("name", mapped.firstName, "Ada");
check("last name", mapped.lastName, "Lovelace");
check("email", mapped.email, "ada@example.com");
check("phone", mapped.phone, "+14105550123");
check("zip", mapped.zipCode, "21201");
check("city", mapped.city, "Baltimore");
check("source", mapped.source, "google_ads");
check("score", mapped.leadScore, "hot");
check("gclid", mapped.gclid, "gclid-abc");
check("campaign", mapped.utmCampaign, "22");
check("custom answer is kept", mapped.notes.includes("How often?: Weekly"), true);
check("lead id is kept", mapped.notes.includes("google_lead_id: TeSter-123"), true);
check("test flag", mapGoogleAdsLead({ ...sample, is_test: true }).isTest, true);
check("first and last columns win over full name", mapGoogleAdsLead({
  ...sample,
  user_column_data: [
    { column_id: "FULL_NAME", string_value: "Wrong Name" },
    { column_id: "FIRST_NAME", string_value: "Grace" },
    { column_id: "LAST_NAME", string_value: "Hopper" },
  ],
}).firstName, "Grace");

if (failures) {
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log("\ngoogle-ads-webhook:verify ok");
