// Clauses already stored against bookings in qc-case-file / qc-drive-mirror.
// A dated full-text snapshot of the website policy is not stored on the
// booking. Packets must say that, and must not invent fees or windows.

export interface PolicyClause {
  text: string;
  cite: string;
}

export const RECORDED_POLICY_CLAUSES: PolicyClause[] = [
  {
    text: "Booking is binding acceptance of all policies.",
    cite: "Terms of Service 1.2, 1.4",
  },
  {
    text: "All sales are final once service is rendered. Completed-service payments are non-refundable outside the stated exceptions.",
    cite: "Terms of Service 6.3; Refund Policy 1.1",
  },
  {
    text: "The primary remedy for a legitimate quality concern is a complimentary re-clean, not a refund. Declining the re-clean waives further refund eligibility.",
    cite: "Terms of Service 7.1, 7.3; Refund Policy 1.2, 2.1, 2.5",
  },
  {
    text: "Concerns must be reported in writing within 24 hours of completion, with specific itemized areas and timestamped photos. The property must be undisturbed.",
    cite: "Terms of Service 7.1; Refund Policy 3.1-3.4",
  },
  {
    text: "Subjective dissatisfaction, buyer's remorse, and work performed to the checklist standard are not refundable.",
    cite: "Terms of Service 6.4; Refund Policy 5.1-5.2, 6; Disclaimer 1.3",
  },
  {
    text: "Tasks outside the purchased package, including inside the fridge or oven and add-ons that were never booked, are not refundable events.",
    cite: "Refund Policy 5.7",
  },
  {
    text: "Cancellations require 24-hour notice. A same-day cancellation, no-show, or access failure caused by the customer forfeits 100 percent of the service amount.",
    cite: "Cancellation Policy 1.1, 2.1-2.3, 10; Terms of Service 6.1",
  },
  {
    text: "Before a chargeback the customer must complete written dispute resolution and allow 72 hours for investigation.",
    cite: "Terms of Service 10.1-10.4; Refund Policy 8.2-8.5",
  },
  {
    text: "The customer consented to before-and-after photographs, service records, checklists, and communication logs, kept at least four years, for dispute resolution.",
    cite: "Terms of Service 13.1-13.4; Refund Policy 3.3, 9.2; Disclaimer 8.4",
  },
  {
    text: "Liability is capped at the amount paid for the service. Damage claims must be reported within 24 hours.",
    cite: "Terms of Service 11.2-11.3",
  },
  {
    text: "Membership cancellation requires 14 days' written notice before the next billing cycle.",
    cite: "Terms of Service 6.2; Refund Policy 10.1",
  },
];

export const POLICY_CITATIONS = [
  "novaracleaning.com/refund-policy",
  "novaracleaning.com/cancellation-policy",
];

export const VERSION_NOT_RECORDED =
  "A dated snapshot of the policy text in force at booking was not recorded. The clauses below are the clauses stored on the booking record. The addresses above are the published locations of the current policies. This packet does not state that the customer saw a later version.";
