/**
 * The public site module must stay locked to the booking code.
 * Run: npx tsx scripts/verify-public-site.ts
 */
import {
  CANCEL_SHORT_NOTICE_FEE_CENTS,
  RESCHEDULE_SHORT_NOTICE_FEE_CENTS,
  SHORT_NOTICE_WINDOW_HOURS,
  SUPPORT_PHONE_DISPLAY,
  SUPPORT_PHONE_E164,
} from "../supabase/functions/_shared/booking-policy";
import { DEFAULT_GUARANTEE_WINDOW_HOURS } from "../supabase/functions/_shared/reclean";
import { DEPOSIT_PERCENT, SERVICE_DISCOUNT_RATES } from "../src/lib/pricing";
import {
  ADMIN_GAPS,
  DRAFT_REVIEW_LABEL,
  LATE_CANCEL_FEE_CENTS,
  NOTICE_WINDOW_HOURS,
  OFFER_SUMMARY,
  PHONE_DISPLAY,
  PHONE_E164,
  PROMISE_SUMMARY,
  PUBLIC_SITE,
  RECLEAN_WINDOW_HOURS,
  RESCHEDULE_FEE_CENTS,
  visitorSitePayload,
} from "../src/lib/public-site";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

assert(PHONE_DISPLAY === SUPPORT_PHONE_DISPLAY, "phone display drifted from booking-policy");
assert(PHONE_E164 === SUPPORT_PHONE_E164, "phone e164 drifted from booking-policy");
assert(NOTICE_WINDOW_HOURS === SHORT_NOTICE_WINDOW_HOURS, "notice window drifted");
assert(LATE_CANCEL_FEE_CENTS === CANCEL_SHORT_NOTICE_FEE_CENTS, "cancel fee drifted");
assert(RESCHEDULE_FEE_CENTS === RESCHEDULE_SHORT_NOTICE_FEE_CENTS, "reschedule fee drifted");
assert(RECLEAN_WINDOW_HOURS === DEFAULT_GUARANTEE_WINDOW_HOURS, "re-clean window drifted");
assert(PUBLIC_SITE.depositPercent === Math.round(DEPOSIT_PERCENT * 100), "deposit percent drifted");
assert(PUBLIC_SITE.offerLines[0].percentOff === Math.round(SERVICE_DISCOUNT_RATES.standard * 100), "standard discount drifted");
assert(PUBLIC_SITE.offerLines[1].percentOff === Math.round(SERVICE_DISCOUNT_RATES.deep * 100), "deep discount drifted");
assert(!OFFER_SUMMARY.includes("\u2014"), "offer summary uses an em dash");
assert(!PROMISE_SUMMARY.includes("\u2014"), "promise uses an em dash");
assert(!JSON.stringify(visitorSitePayload()).includes(DRAFT_REVIEW_LABEL), "draft label leaked to visitors");
assert(ADMIN_GAPS.length > 0, "admin gaps missing");
assert(!visitorSitePayload().approvedClaims.some((claim) => /bonded|background-checked|google guaranteed/i.test(claim)), "unapproved claim is public");

console.log("public site facts match the booking code");
