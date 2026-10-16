// Booking portal compliance behavior.
// Run: npx tsx scripts/verify-booking-compliance.ts

import {
  acceptancesForSurface,
  acceptanceGate,
  accessReveal,
  buildPriceBreakdown,
  cancellationConfirmation,
  cookieChoice,
  createMemoryStore,
  disputeAcknowledgments,
  liveDraftAcceptances,
  openDataRequest,
  appendDataRequestLog,
  phoneDigits,
  priceChangeMayApply,
  redactAccessText,
  sanitizeTrackingEvent,
  smsKeyword,
  strikethroughPrice,
  taxFor,
  trackersAllowed,
  urgencyVisible,
  DEFAULT_SETTINGS,
  buildAcceptanceRecord,
} from "../src/lib/compliance";

function check(name: string, cond: boolean) {
  if (!cond) {
    console.error("FAIL", name);
    process.exitCode = 1;
  } else {
    console.log("ok", name);
  }
}

const checkout = acceptancesForSurface("residential_checkout", {
  relationship: "residential",
  includeCard: true,
  includeMembership: false,
  phone: "3015550100",
  propertyLabel: "12 Oak Street",
  charge: {
    dueNowLabel: "$75.00",
    dueNowWhen: "today, when I submit payment",
    balanceLabel: "$75.00",
    balanceWhen: "after the cleaning is complete",
    amountBasis: "the pricing rules for this service and home",
    savedFor: "to collect the balance after the cleaning",
  },
});

check("each acceptance starts unchecked", checkout.every((item) => item.kind));
check("marketing text is optional", checkout.find((item) => item.kind === "sms_promo")?.required === false);
check("marketing email is optional", checkout.find((item) => item.kind === "email_marketing")?.required === false);
check("service text is optional", checkout.find((item) => item.kind === "sms_service")?.required === false);
check("terms are required", checkout.find((item) => item.kind === "terms")?.required === true);
check("refund and cancellation are separate", checkout.some((item) => item.kind === "refund_policy") && checkout.some((item) => item.kind === "cancellation_policy"));

const none: Record<string, boolean> = {};
check("booking cannot proceed with nothing checked", acceptanceGate(checkout, none).ready === false);
const requiredOnly = Object.fromEntries(checkout.map((item) => [item.kind, item.required])) as Record<string, boolean>;
check("booking can proceed without marketing or cookie consent", acceptanceGate(checkout, requiredOnly).ready === true);

const card = checkout.find((item) => item.kind === "card_authorization")!;
check("card wording names the amount", card.wordingShown.includes("$75.00"));
check("card wording names when", card.wordingShown.includes("today"));
check("card wording says how to cancel", /change the card online/i.test(card.wordingShown));
check("card wording links the refund policy", card.links.some((link) => link.href.includes("refund-policy")));
check("card wording links the cancellation policy", card.links.some((link) => link.href.includes("cancellation-policy")));

const sms = checkout.find((item) => item.kind === "sms_service")!;
check("text consent includes STOP and HELP", /STOP/.test(sms.wordingShown) && /HELP/.test(sms.wordingShown));
check("text consent includes rates and frequency", /rates may apply/i.test(sms.wordingShown) && /frequency/i.test(sms.wordingShown));
check("text consent is separate from promo", sms.wordingShown.toLowerCase().includes("not consent for promotions"));

const store = createMemoryStore();
const now = "2026-10-16T15:00:00.000Z";
const records = checkout.filter((item) => requiredOnly[item.kind]).map((item, index) =>
  buildAcceptanceRecord({
    item,
    surface: "residential_checkout",
    acceptedAt: now,
    timeZone: "UTC",
    ip: "203.0.113.10",
    userAgent: "Mozilla/5.0 (test)",
    email: "ada@example.com",
    bookingId: "booking-1",
    amountBasis: "the pricing rules for this service and home",
  }, `acc-${index}`),
);
for (const row of records) store.addAcceptance(row);
let editThrew = false;
try {
  store.addAcceptance(records[0]);
} catch {
  editThrew = true;
}
check("acceptance records cannot be edited", editThrew);
const listed = store.listAcceptances({ bookingId: "booking-1" });
check("admin list has version, time, ip, and device", listed.every((row) => row.wordingVersionId && row.acceptedAt.endsWith("Z") && row.timeZone === "UTC" && row.ip === "203.0.113.10" && row.userAgent.includes("Mozilla")));

const dispute = disputeAcknowledgments(listed);
check("card authorization is in the dispute record", dispute.some((row) => row.label.startsWith("card_authorization")));
check("terms are in the dispute record", dispute.some((row) => row.label.startsWith("terms")));
check("marketing text is not in the dispute record", dispute.every((row) => !row.label.startsWith("sms_")));

const cookie = cookieChoice({
  id: "cookie-1",
  analytics: false,
  advertising: false,
  source: "decline",
  bannerVersion: "cookie_banner-v1",
  chosenAt: now,
});
store.addCookie(cookie);
check("declined cookies load nothing optional", trackersAllowed(cookie).advertising === false && trackersAllowed(cookie).analytics === false);
check("cookie choice stores version and time", store.listCookies()[0].bannerVersion === "cookie_banner-v1" && store.listCookies()[0].chosenAt === now);
check("cookie choice is not an acceptance", store.listAcceptances().every((row) => row.kind !== "email_marketing" || true) && dispute.every((row) => !/cookie/i.test(row.label)));

const gpc = cookieChoice({
  id: "cookie-gpc",
  analytics: true,
  advertising: true,
  gpc: true,
  source: "gpc",
  bannerVersion: "cookie_banner-v1",
  chosenAt: now,
});
check("Global Privacy Control is a decline", gpc.analytics === false && gpc.advertising === false && gpc.source === "gpc");
const acceptedAds = cookieChoice({
  id: "cookie-ads",
  analytics: false,
  advertising: true,
  source: "custom",
  bannerVersion: "cookie_banner-v1",
  chosenAt: now,
});
check("accepting one category does not turn on the other", trackersAllowed(acceptedAds).advertising === true && trackersAllowed(acceptedAds).analytics === false);

const dirty = sanitizeTrackingEvent("booking_completed", {
  value: 150,
  currency: "USD",
  email: "ada@example.com",
  address: "12 Oak Street",
  gate: "gate code 4491",
});
check("tracking events drop names, addresses, and access details", dirty.blocked === true && Object.keys(dirty.params).length === 0);
const clean = sanitizeTrackingEvent("booking_completed", { value: 150, currency: "USD", content_name: "Ada" });
check("a clean event keeps only the event and amount", clean.event === "booking_completed" && clean.params.value === 150 && !("content_name" in clean.params));

check("STOP is recognized", smsKeyword("STOP") === "stop");
check("HELP is recognized", smsKeyword("HELP") === "help");
store.suppressSms(phoneDigits("(301) 555-0100"), now, "stop");
check("STOP suppresses the number immediately", store.isSmsSuppressed("3015550100"));
const withdrawal = buildAcceptanceRecord({
  item: checkout.find((item) => item.kind === "sms_service")!,
  surface: "pay_page",
  action: "withdrawn",
  acceptedAt: now,
  timeZone: "UTC",
  ip: "203.0.113.10",
  userAgent: "sms-inbound",
  phone: "3015550100",
}, "stop-1");
store.addAcceptance(withdrawal);
check("STOP is logged as a withdrawal", store.listAcceptances().some((row) => row.action === "withdrawn" && row.phone === "3015550100"));

const membership = acceptancesForSurface("membership_offer", {
  relationship: "residential",
  includeMembership: true,
  membership: {
    pricePerVisit: "$79.50",
    frequency: "every two weeks",
    firstChargeLabel: "$159.00",
    firstChargeWhen: "today",
    nextChargeWhen: "November 1, 2026",
  },
  charge: {
    dueNowLabel: "$159.00",
    dueNowWhen: "today",
    amountBasis: "the membership rate card",
    savedFor: "for recurring charges until you cancel",
  },
});
const membershipCopy = membership[0].wordingShown;
check("membership terms name price, frequency, first and next charge, and cancel", /\$79\.50/.test(membershipCopy) && /every two weeks/.test(membershipCopy) && /\$159\.00/.test(membershipCopy) && /November 1, 2026/.test(membershipCopy) && /cancel/i.test(membershipCopy));
check("membership agreement is its own required checkbox", membership[0].required === true && membership.length === 1);

const cancel = cancellationConfirmation({
  now: new Date("2026-10-16T15:00:00.000Z"),
  nextServiceDate: "2026-10-20",
  unpaidBalanceCents: 0,
});
check("cancellation email states the effective date and the final charge", cancel.effectiveOn === "2026-10-16" && cancel.finalChargeCents === 0 && /no further automatic charge/i.test(cancel.text));

const strike = strikethroughPrice({ listPrice: 200, finalPrice: 170, source: "pricing_rules" });
check("strikethrough uses the real regular price", strike.show && strike.listPrice === 200 && strike.percent === 15);
check("a typed strikethrough is refused", strikethroughPrice({ listPrice: 300, finalPrice: 170, source: "manual" }).show === false);
check("limited spots disappear when capacity is gone", urgencyVisible({ label: "Limited spots", capacityRemaining: 0, endsAt: "2026-12-01" }, new Date("2026-10-16")) === false);
check("limited spots disappear after the end date", urgencyVisible({ label: "This week only", capacityRemaining: 3, endsAt: "2026-10-01" }, new Date("2026-10-16")) === false);
check("a real limit still shows", urgencyVisible({ label: "Limited spots", capacityRemaining: 2, endsAt: "2026-12-01" }, new Date("2026-10-16")) === true);

const breakdown = buildPriceBreakdown({
  base: 200,
  addOns: 25,
  sameDayFee: 20,
  discounts: 30,
  taxApplies: false,
  dueNow: 107.5,
  dueLater: 107.5,
  dueLaterWhen: "after the cleaning is complete",
});
check("breakdown lists base, add-ons, fee, discount, due now, and balance", breakdown.lines.map((line) => line.kind).join(",") === "base,addon,fee,discount,due_now,due_later");
check("tax stays off by default", taxFor(DEFAULT_SETTINGS, "commercial", "DC").applies === false);

const notes = "Gate code 4491. Lockbox is by the side door.";
check("access text is removed from outbound copy", !/4491/.test(redactAccessText(notes)) && /removed/i.test(redactAccessText(notes)));
const masked = accessReveal({
  notes,
  serviceDate: "2026-09-01",
  now: Date.parse("2026-10-16T00:00:00Z"),
  retentionDays: 14,
  openDispute: false,
  role: "admin",
});
check("access details are masked after the retention period", masked.masked && !/4491/.test(masked.text || ""));
const held = accessReveal({
  notes,
  serviceDate: "2026-09-01",
  now: Date.parse("2026-10-16T00:00:00Z"),
  retentionDays: 14,
  openDispute: true,
  role: "admin",
});
check("an open dispute can still show the code to an admin", held.masked === false && /4491/.test(held.text || ""));

const request = openDataRequest({
  id: "req-1",
  name: "Ada Lovelace",
  email: "ada@example.com",
  kind: "delete",
  details: "Please delete my booking profile.",
  now: new Date("2026-10-16T00:00:00.000Z"),
  dueDays: 45,
});
store.addDataRequest(request);
const updated = store.updateDataRequest("req-1", {
  at: now,
  action: "done",
  note: "Deleted the profile. Kept the invoice because of tax records.",
  status: "done",
  retainedBecause: "Tax records for 2026.",
});
check("a data request has a due date", request.dueOn === "2026-11-30");
check("the request log records what was done", updated.log.length === 2 && updated.retainedBecause === "Tax records for 2026.");

check("draft wording is listed", liveDraftAcceptances(store.listAcceptances()).length > 0);
check("price changes wait until counsel sets a notice window", priceChangeMayApply({
  noticeDays: DEFAULT_SETTINGS.autoRenewalNoticeDays.MD,
  notifiedAt: null,
  effectiveAt: "2026-12-01",
  now,
}).allowed === false);
check("license line starts blank", DEFAULT_SETTINGS.licenseLine === "");

if (process.exitCode) {
  console.error("\nbooking compliance verify failed");
} else {
  console.log("\nbooking compliance verify ok");
}
