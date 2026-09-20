// Offline lock: abandoned-checkout SMS/email must not fire once the
// customer already has a booking or a completed job, and leftover
// past-date carts must not mint a new pending row.
//
//   Run:  npm run checkout-nudge:verify

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  etYmd as srcEtYmd,
  isPastServiceDate as srcIsPast,
} from "../src/lib/checkout-funnel-guard.ts";
import {
  CHECKOUT_NUDGE_SKIP_COPY,
  CHECKOUT_NUDGE_SUPPRESSED_CODE,
  etYmd,
  evaluateCheckoutNudgeGuard,
  extractCartServiceDate,
  isBookedOrDone,
  isCompletedStatus,
  isPastServiceDate,
  isPublicCheckoutPending,
  isVoidCheckoutStatus,
  PAST_SERVICE_DATE_CODE,
  type CheckoutNudgeBooking,
} from "../supabase/functions/_shared/checkout-nudge-guard.ts";

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

function fileContains(rel: string, needle: string | RegExp, name: string) {
  const text = readFileSync(resolve(rel), "utf8");
  const ok = typeof needle === "string" ? text.includes(needle) : needle.test(text);
  check(name, ok, true);
}

function fileLacks(rel: string, needle: string | RegExp, name: string) {
  const text = readFileSync(resolve(rel), "utf8");
  const hit = typeof needle === "string" ? text.includes(needle) : needle.test(text);
  check(name, hit, false);
}

const now = new Date("2026-09-20T16:00:00Z"); // Saturday afternoon UTC / midday ET

const nikkiaCompleted: CheckoutNudgeBooking = {
  id: "9a193388-nvc-0096",
  status: "completed",
  service_date: "2026-09-09",
  payment_received_at: "2026-09-01T18:00:00Z",
};

const leftoverSep4: CheckoutNudgeBooking = {
  id: "ebda05cd-nvc-117",
  status: "pending_payment",
  service_date: "2026-09-04",
  payment_received_at: null,
};

console.log("Nikkia leftover cart vs completed job:");
{
  const v = evaluateCheckoutNudgeGuard({
    pendingServiceDate: leftoverSep4.service_date,
    otherBookings: [nikkiaCompleted],
    now,
  });
  check("does not send", v.send, false);
  check("skip reason is completed_booking", v.skipReason, "completed_booking");
  check("matches NVC-0096", v.match?.id, nikkiaCompleted.id);
}

console.log("\nExisting confirmed booking (not yet completed):");
{
  const v = evaluateCheckoutNudgeGuard({
    pendingServiceDate: "2026-09-22",
    otherBookings: [{
      id: "confirmed-1",
      status: "confirmed",
      service_date: "2026-09-22",
      payment_received_at: "2026-09-18T12:00:00Z",
    }],
    now,
  });
  check("does not send", v.send, false);
  check("skip reason is existing_booking", v.skipReason, "existing_booking");
}

console.log("\nAssigned / in progress / pending_details still count as booked:");
for (const status of ["assigned", "in_progress", "pending_details", "no_show"]) {
  const v = evaluateCheckoutNudgeGuard({
    pendingServiceDate: "2026-09-25",
    otherBookings: [{ id: status, status }],
    now,
  });
  check(`${status} suppresses nudges`, v.send, false);
  check(`${status} is existing_booking`, v.skipReason, "existing_booking");
}

console.log("\nCancelled-only history still allows a new-cart nudge:");
{
  const v = evaluateCheckoutNudgeGuard({
    pendingServiceDate: "2026-09-25",
    otherBookings: [
      { id: "c1", status: "cancelled" },
      { id: "c2", status: "canceled" },
      { id: "c3", status: "abandoned" },
    ],
    now,
  });
  check("cancelled-only still sends", v.send, true);
  check("no skip reason", v.skipReason, null);
}

console.log("\nPast service date with no other booking:");
{
  const v = evaluateCheckoutNudgeGuard({
    pendingServiceDate: "2026-09-04",
    otherBookings: [],
    now,
  });
  check("does not send", v.send, false);
  check("skip reason is past_service_date", v.skipReason, "past_service_date");
}

console.log("\nToday and future dates still send when there is no booking:");
{
  const today = etYmd(now);
  check(
    "today is not past",
    evaluateCheckoutNudgeGuard({ pendingServiceDate: today, otherBookings: [], now }).send,
    true,
  );
  check(
    "future date sends",
    evaluateCheckoutNudgeGuard({
      pendingServiceDate: "2026-12-01",
      otherBookings: [],
      now,
    }).send,
    true,
  );
}

console.log("\npayment_received_at counts even if status is still pending_payment:");
{
  const v = evaluateCheckoutNudgeGuard({
    pendingServiceDate: "2026-09-25",
    otherBookings: [{
      id: "paid-lag",
      status: "pending_payment",
      payment_received_at: "2026-09-19T12:00:00Z",
    }],
    now,
  });
  check("paid lag suppresses", v.send, false);
  check("paid lag is existing_booking", v.skipReason, "existing_booking");
  check("isBookedOrDone on paid pending", isBookedOrDone({
    id: "paid-lag",
    status: "pending_payment",
    payment_received_at: "2026-09-19T12:00:00Z",
  }), true);
}

console.log("\nCompleted vs pending_review:");
check("completed is completed", isCompletedStatus("completed"), true);
check("pending_review is completed", isCompletedStatus("pending_review"), true);
check("confirmed is not completed", isCompletedStatus("confirmed"), false);

console.log("\nVoid statuses:");
for (const s of ["pending_payment", "abandoned", "cancelled", "canceled"]) {
  check(`${s} is void`, isVoidCheckoutStatus(s), true);
}
check("confirmed is not void", isVoidCheckoutStatus("confirmed"), false);

console.log("\nPublic checkout vs invoice/VA:");
check(
  "website pending is public",
  isPublicCheckoutPending({ booking_channel: "Website", booker_source: "New Lead" }),
  true,
);
check(
  "admin channel is not public",
  isPublicCheckoutPending({ booking_channel: "admin" }),
  false,
);
check(
  "invoice-backed is not public",
  isPublicCheckoutPending({ hosted_invoice_url: "https://invoice.stripe.com/x" }),
  false,
);
check(
  "va_admin source is not public",
  isPublicCheckoutPending({ booker_source: "va_admin" }),
  false,
);

console.log("\nCart booking_data date extract:");
check(
  "serviceDate field",
  extractCartServiceDate({ serviceDate: "2026-09-04", bookingId: "x" }),
  "2026-09-04",
);
check(
  "service_date field",
  extractCartServiceDate({ service_date: "2026-09-09" }),
  "2026-09-09",
);
check(
  "JSON string",
  extractCartServiceDate(JSON.stringify({ serviceDate: "2026-09-04" })),
  "2026-09-04",
);
check("empty", extractCartServiceDate(null), null);

console.log("\nClient/server date helpers stay in lockstep:");
check("etYmd matches", srcEtYmd(now), etYmd(now));
check("isPastServiceDate matches on Sep 4", srcIsPast("2026-09-04", now), isPastServiceDate("2026-09-04", now));
check("isPastServiceDate today is false", srcIsPast(etYmd(now), now), false);
check("invalid date is not past", isPastServiceDate("soon", now), false);

console.log("\nCopy + codes:");
check("past-date code", PAST_SERVICE_DATE_CODE, "PAST_SERVICE_DATE");
check("suppressed code", CHECKOUT_NUDGE_SUPPRESSED_CODE, "CHECKOUT_NUDGE_SUPPRESSED");
check("past-date copy mentions passed", CHECKOUT_NUDGE_SKIP_COPY.past_service_date.includes("passed"), true);
check("completed copy mentions complete", CHECKOUT_NUDGE_SKIP_COPY.completed_booking.includes("complete"), true);

console.log("\nWired into send/resume/cart/confirm/PI paths:");
fileContains(
  "supabase/functions/send-booking-reminder/index.ts",
  "evaluateCheckoutNudgeGuard",
  "send-booking-reminder evaluates the guard before send",
);
fileContains(
  "supabase/functions/send-booking-reminder/index.ts",
  "suppressLeftoverPublicCheckouts",
  "send-booking-reminder suppresses leftover public pending",
);
fileContains(
  "supabase/functions/get-checkout-resume/index.ts",
  "evaluateCheckoutNudgeGuard",
  "get-checkout-resume evaluates the guard",
);
fileContains(
  "supabase/functions/get-checkout-resume/index.ts",
  "PAST_SERVICE_DATE_CODE",
  "get-checkout-resume returns PAST_SERVICE_DATE",
);
fileContains(
  "supabase/functions/send-abandoned-cart-email/index.ts",
  "evaluateCheckoutNudgeGuard",
  "abandoned-cart email evaluates the guard",
);
fileContains(
  "supabase/functions/_shared/post-confirm-booking.ts",
  "suppressLeftoverPublicCheckouts",
  "post-confirm converts leftover carts",
);
fileContains(
  "supabase/functions/create-payment-intent/index.ts",
  "PAST_SERVICE_DATE_CODE",
  "create-payment-intent rejects past dates",
);
fileContains(
  "supabase/functions/create-membership-intent/index.ts",
  "PAST_SERVICE_DATE_CODE",
  "create-membership-intent rejects past dates",
);
fileLacks(
  "supabase/functions/create-payment-intent/index.ts",
  "evaluateCheckoutNudgeGuard",
  "create-payment-intent does not block a future-date rebook",
);
fileContains(
  "src/views/book/Checkout.tsx",
  "isPastServiceDate",
  "Checkout will not mint a PI for a past date",
);
fileContains(
  "src/views/book/Checkout.tsx",
  "PAST_SERVICE_DATE",
  "Checkout does not retry PAST_SERVICE_DATE",
);
fileContains(
  "src/contexts/BookingContext.tsx",
  "isPastServiceDate",
  "BookingContext drops a stale past-date cart on hydrate",
);

console.log("\nDeposit-invoice reminders stay on their own path:");
fileLacks(
  "supabase/functions/pending-deposit-reminders/index.ts",
  "checkout-nudge-guard",
  "pending-deposit-reminders does not import the checkout-nudge guard",
);
fileContains(
  "supabase/functions/pending-deposit-reminders/index.ts",
  "hosted_invoice_url",
  "pending-deposit-reminders still keys off invoices",
);

if (failures) {
  console.error(`\n${failures} checkout-nudge check(s) failed`);
  process.exit(1);
}
console.log("\nAll checkout-nudge checks passed.");
