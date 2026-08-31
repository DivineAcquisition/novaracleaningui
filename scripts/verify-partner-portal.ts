// Offline verification of the type-aware partner portal.
//
//   npm run partner-portal:verify

import { computeCancelFee, serviceInstantMs } from "../src/lib/partner-portal/cancel-fee";
import { kindsOf } from "../src/lib/partner-portal/identity";
import { publicStatusLabel, publicTurnoverStatus, stripCrewContact } from "../src/lib/partner-portal/sanitize";
import { DEFAULT_PORTAL_SETTINGS } from "../src/lib/partner-portal/settings";
import { previewKindFromToken, previewMe, previewCommercialOverview, previewHostOverview } from "../src/lib/partner-portal/preview";
import { requestMagicLink } from "../src/lib/partner-portal/magic-link";
import { portalCallbackUrl } from "../src/lib/partner-portal/origins";
import {
  facingInvoiceStatus,
  netTermsDueDate,
  netTermsLabel,
  portalCanUpdatePayment,
} from "../src/lib/partner-portal/stripe-billing";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

const noon = (ymd: string) => new Date(`${ymd}T12:00:00`).getTime();

console.log("Section 9 cancellation tiers:");
const far = computeCancelFee({ requestedDate: "2026-09-10", windowStart: "11:00", priceCents: 20000, nowMs: noon("2026-09-01") });
check("48+ hours is credit-eligible", far.tier, "credit_eligible");
check("48+ hours fee is $0", far.feeCents, 0);
check("48+ hours credit is full rate", far.creditCents, 20000);

const mid = computeCancelFee({ requestedDate: "2026-09-03", windowStart: "11:00", priceCents: 20000, nowMs: noon("2026-09-01") });
check("24–48 hours is 50%", mid.tier, "fifty_percent");
check("24–48 hours fee is half", mid.feeCents, 10000);

const close = computeCancelFee({ requestedDate: "2026-09-02", windowStart: "18:00", priceCents: 20000, nowMs: noon("2026-09-02") });
check("under 24 hours is 100%", close.tier, "full");
check("under 24 hours fee is full rate", close.feeCents, 20000);

check("service instant uses window start", serviceInstantMs("2026-09-02", "18:30") > serviceInstantMs("2026-09-02", "11:00"), true);

console.log("\nSession defaults:");
check("default persistence is 30 days", DEFAULT_PORTAL_SETTINGS.sessionDays, 30);

console.log("\nMixed accounts stay distinct:");
check(
  "both kinds listed separately",
  kindsOf({
    hosts: [{ id: "h1" } as never],
    accounts: [{ id: "a1" } as never],
  }),
  ["host", "commercial"],
);
check("host-only", kindsOf({ hosts: [{ id: "h1" } as never], accounts: [] }), ["host"]);
check("commercial-only", kindsOf({ hosts: [], accounts: [{ id: "a1" } as never] }), ["commercial"]);

console.log("\nNo cleaner/crew contact in portal payloads:");
const scrubbed = stripCrewContact({
  status: "assigned",
  assigned_cleaner_id: "clr_1",
  cleaner_name: "Alex",
  cleaner_phone: "555-0100",
  price: 165,
  crew: [{ firstName: "Alex", phone: "555-0100" }],
});
check("cleaner id stripped", "assigned_cleaner_id" in scrubbed, false);
check("cleaner name stripped", "cleaner_name" in scrubbed, false);
check("cleaner phone stripped", "cleaner_phone" in scrubbed, false);
check("crew array stripped", "crew" in scrubbed, false);
check("price kept", scrubbed.price, 165);
check("cleaner_confirmed becomes confirmed", publicTurnoverStatus("cleaner_confirmed"), "confirmed");
check("unassigned_alert becomes assigning", publicTurnoverStatus("unassigned_alert"), "assigning");
check("status label has no cleaner word", publicStatusLabel("cleaner_confirmed").toLowerCase().includes("cleaner"), false);

console.log("\nLocalhost preview tokens:");
check("preview-host", previewKindFromToken("preview-host"), "host");
check("preview-mixed", previewKindFromToken("preview-mixed"), "mixed");
check("mixed preview lists both kinds", previewMe("mixed").kinds, ["host", "commercial"]);
check("host preview has no commercial account", previewMe("host").accounts.length, 0);

console.log("\nBilling is method-specific, never both:");
check("invoiced accounts cannot update a card", portalCanUpdatePayment("invoiced"), false);
check("pre-auth accounts can update a card", portalCanUpdatePayment("auto_pay"), true);
check("net 15 due date", netTermsDueDate("2026-08-01", "net_15"), "2026-08-16");
check("on receipt due date is service date", netTermsDueDate("2026-08-01", "on_receipt"), "2026-08-01");
check("net 15 label", netTermsLabel("net_15"), "Net 15");
check("open past due is overdue", facingInvoiceStatus({ status: "open", dueDate: "2026-07-01", nowDay: "2026-08-31" }), "overdue");
check("paid stays paid", facingInvoiceStatus({ status: "paid", dueDate: "2026-07-01", nowDay: "2026-08-31" }), "paid");
check("open future due is outstanding", facingInvoiceStatus({ status: "open", dueDate: "2026-09-15", nowDay: "2026-08-31" }), "outstanding");

const invoicedPreview = previewCommercialOverview("invoiced");
check("invoiced preview lists invoices", invoicedPreview.billing.invoices.length > 0, true);
check("invoiced preview has no charges", invoicedPreview.billing.charges.length, 0);
check("invoiced preview cannot update payment", invoicedPreview.billing.canUpdatePayment, false);
check("invoiced preview shows a due date", invoicedPreview.billing.invoices[0].dueDate != null, true);
const preAuthPreview = previewCommercialOverview("auto_pay");
check("pre-auth preview lists charges", preAuthPreview.billing.charges.length > 0, true);
check("pre-auth preview has no invoices", preAuthPreview.billing.invoices.length, 0);
check("pre-auth preview can update payment", preAuthPreview.billing.canUpdatePayment, true);

const hostPreview = previewHostOverview();
check("host rates are read-only", hostPreview.properties.every((p) => p.rateEditable === false), true);
check(
  "rate schedule is its own download",
  hostPreview.documents.some((d) => d.kind === "rate_schedule" && String(d.url).includes("rate_schedule")),
  true,
);
check(
  "signed agreement is not reused as the rate schedule",
  hostPreview.documents.find((d) => d.kind === "agreement")?.url !==
    hostPreview.documents.find((d) => d.kind === "rate_schedule")?.url,
  true,
);

console.log("\nPortal source never offers host-style visit requests to commercial, or cleaner contact:");
const hostUi = readFileSync(resolve("src/views/partner/HostPortalView.tsx"), "utf8");
const commercialUi = readFileSync(resolve("src/views/partner/CommercialPortal.tsx"), "utf8");
check("host can update payment method", hostUi.includes("Update payment method"), true);
check("host cannot type a rate", /turnoverPrice/.test(hostUi) && !/<Input[^>]*turnover/.test(hostUi), true);
check("commercial has no Request a turnover", commercialUi.includes("Request a turnover"), false);
check("commercial invoiced copy has no card field", commercialUi.includes("does not keep a card on file"), true);
check("host UI has no cleaner contact", /cleaner|crew member/i.test(hostUi), false);
check("commercial UI has no cleaner contact", /cleaner_phone|crew member/i.test(commercialUi), false);

const cb = portalCallbackUrl(
  new Request("https://partner.novaracleaning.com/api/partner-portal/host"),
  "payment=updated&kind=host&session_id={CHECKOUT_SESSION_ID}",
);
check("stripe return keeps CHECKOUT_SESSION_ID literal", cb.includes("{CHECKOUT_SESSION_ID}"), true);
check("stripe return lands on the portal", cb.startsWith("https://partner.novaracleaning.com/partner?"), true);
const aliasCb = portalCallbackUrl(
  new Request("https://partners.novaracleaning.com/api/partner-portal/host"),
  "kind=host&session_id={CHECKOUT_SESSION_ID}",
);
check("partners.* alias still canonicalizes to partner.*", aliasCb.startsWith("https://partner.novaracleaning.com/partner?"), true);
const localCb = portalCallbackUrl(
  new Request("http://127.0.0.1:3010/api/partner-portal/host", { headers: { host: "127.0.0.1:3010" } }),
  "kind=host",
);
check("local callback uses the request host", localCb.startsWith("http://127.0.0.1:3010/partner?"), true);

void requestMagicLink("not-an-email")
  .then((empty) => {
    console.log("\nMagic-link request never enumerates:");
    check("invalid email still returns ok", empty.ok, true);
    if (failures) {
      console.error(`\n${failures} check(s) failed.`);
      process.exit(1);
    }
    console.log("\nAll partner portal checks passed.");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
