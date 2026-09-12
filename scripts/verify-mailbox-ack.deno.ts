// Policy tests for inbound mailbox acks.
//
// The handler may send ONLY when the receiving address is
// support@novaracleaning.com or billing@novaracleaning.com.
//
//   npm run mailbox-ack:verify
import {
  BLOCKED_CC,
  classifyKind,
  classifyParty,
  composeAck,
  decideMailboxAck,
  extractEmailAddresses,
  matchedAllowedMailbox,
  SEND_AS,
  SIGNATURE,
} from "../supabase/functions/_shared/mailbox-ack.ts";

let failed = 0;
function assert(cond: unknown, msg: string) {
  if (!cond) {
    failed++;
    console.error("FAIL:", msg);
  } else {
    console.log("ok  ", msg);
  }
}

assert(
  extractEmailAddresses('Kimberly Harper <kimberlyharperlvt@gmail.com>').includes("kimberlyharperlvt@gmail.com"),
  "extracts angle-bracket addresses",
);
assert(
  matchedAllowedMailbox({ to: "contact@novaracleaning.com" }) === null,
  "contact@ is not an allowed receiving mailbox",
);
assert(
  matchedAllowedMailbox({ to: "support@novaracleaning.com" }) === "support@novaracleaning.com",
  "support@ is allowed",
);
assert(
  matchedAllowedMailbox({ to: ["billing@novaracleaning.com"] }) === "billing@novaracleaning.com",
  "billing@ is allowed",
);
assert(
  matchedAllowedMailbox({
    to: "contact@novaracleaning.com",
    cc: "support@novaracleaning.com",
  }) === "support@novaracleaning.com",
  "support@ on CC still matches",
);

const contactOnly = decideMailboxAck({
  from: "Kimberly Harper <kimberlyharperlvt@gmail.com>",
  to: "contact@novaracleaning.com",
  subject: "Incident Report",
  text: "Your cleaner injured my cat.",
});
assert(contactOnly.action === "skip" && contactOnly.reason === "not_allowed_mailbox",
  "mail to contact@ only is skipped");

const helloOnly = decideMailboxAck({
  from: "customer@gmail.com",
  to: "hello@novaracleaning.com",
  subject: "Question",
  text: "How much for a deep clean?",
});
assert(helloOnly.action === "skip", "hello@ is skipped");

const personal = decideMailboxAck({
  from: "customer@gmail.com",
  to: BLOCKED_CC,
  subject: "Complaint",
  text: "This was terrible.",
});
assert(personal.action === "skip", "personal gmail inbox is skipped");

const loop = decideMailboxAck({
  from: "NovaraCleaning <hello@novaracleaning.com>",
  to: "support@novaracleaning.com",
  subject: "Re: your request",
  text: "We received your request",
});
assert(loop.action === "skip" && loop.reason === "company_loop",
  "does not reply to our own domain");

const noreply = decideMailboxAck({
  from: "noreply@stripe.com",
  to: "billing@novaracleaning.com",
  subject: "Receipt",
  text: "Your receipt",
});
assert(noreply.action === "skip" && noreply.reason === "automated_sender",
  "noreply senders are skipped");

const complaint = decideMailboxAck({
  from: "Kimberly Harper <kimberlyharperlvt@gmail.com>",
  to: ["support@novaracleaning.com", "contact@novaracleaning.com"],
  subject: "Re: Service on 9/10",
  text: "I am emailing you to discuss an incident with your employee Fiona yesterday.",
});
assert(complaint.action === "send", "support@ complaint is eligible");
if (complaint.action === "send") {
  assert(complaint.mailbox === "support@novaracleaning.com", "uses support mailbox");
  assert(complaint.party === "Operations", "incident complaint informs Operations");
  assert(complaint.kind === "complaint", "classified as complaint");
  assert(complaint.to === "kimberlyharperlvt@gmail.com", "replies to the customer");
  assert(complaint.replyTo === "support@novaracleaning.com", "reply-to is the receiving mailbox");
  assert(!complaint.text.includes("Malik"), "does not use a personal name");
  assert(complaint.text.endsWith("NovaraCleaning") || complaint.text.includes("\nNovaraCleaning"),
    "signs as NovaraCleaning");
  assert(complaint.text.includes("informed Operations"), "names Operations");
  assert(!complaint.text.toLowerCase().includes("refund"), "does not add extra tasks");
}

const cancel = decideMailboxAck({
  from: "Calvin Beckett <cbeckett101@gmail.com>",
  to: "support@novaracleaning.com",
  subject: "Re: Your document copy",
  text: "Good morning I need to cancel this month's service.",
});
assert(cancel.action === "send", "cancel request on support@ sends");
if (cancel.action === "send") {
  assert(cancel.party === "Dispatch", "cancel informs Dispatch");
  assert(cancel.kind === "inquiry", "cancel is an inquiry");
  assert(cancel.text.includes("informed Dispatch"), "names Dispatch");
}

const billingRefund = decideMailboxAck({
  from: "Jesse Brogan <jwbrogan004@gmail.com>",
  to: "billing@novaracleaning.com",
  subject: "Refund question",
  text: "Please refund last week's cleaning.",
});
assert(billingRefund.action === "send", "billing@ inquiry sends");
if (billingRefund.action === "send") {
  assert(billingRefund.party === "Billing", "billing@ always informs Billing");
  assert(billingRefund.replyTo === "billing@novaracleaning.com", "reply-to billing@");
}

const dispute = decideMailboxAck({
  from: "pat@example.com",
  to: "support@novaracleaning.com",
  subject: "Chargeback",
  text: "I am opening a dispute. This charge was unauthorized.",
});
assert(dispute.action === "send", "dispute on support@ sends");
if (dispute.action === "send") {
  assert(dispute.kind === "dispute", "classified as dispute");
  assert(dispute.party === "Billing", "disputes inform Billing");
}

assert(classifyKind("hi", "please send a quote") === "inquiry", "plain request is an inquiry");
assert(classifyParty("billing@novaracleaning.com", "complaint", "dirty", "awful") === "Billing",
  "billing@ mailbox wins over complaint keywords");

const composed = composeAck({
  firstName: "Kimberly",
  kind: "complaint",
  party: "Operations",
  subject: "Incident",
  body: "incident with cleaner",
});
assert(composed.text.startsWith("Kimberly,"), "personalized greeting");
assert(composed.text.includes("informed Operations"), "party line present");
assert(composed.html.includes("NovaraCleaning"), "html signed as NovaraCleaning");
assert(SEND_AS.startsWith("NovaraCleaning"), "from display is NovaraCleaning");
assert(SIGNATURE === "NovaraCleaning", "signature is NovaraCleaning");

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  // deno-lint-ignore no-explicit-any
  const exit = (globalThis as any).Deno?.exit || ((code: number) => { (globalThis as any).process?.exit(code); });
  exit(1);
}
console.log("\nall mailbox-ack checks passed");
