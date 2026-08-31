// ─── Host Partnership Agreement (Part One + §6.2 payment copy) ─────────────
//
// The in-session document. Part Two (the per-property rate schedule) is
// rendered from the proposal snapshot on Page 2 and attached as Section 17
// of the signed PDF. Hosts review and sign; they never type a rate.

export const COMPANY_LEGAL_NAME = "Novara Cleaning LLC";
export const COMPANY_DBA = "NovaraCleaning";

export const IMPORTANT_NOTICE =
  "IMPORTANT NOTICE. This Host Partnership Agreement is a binding contract. " +
  "By signing you acknowledge and agree to the non-circumvention, chargeback, " +
  "and arbitration provisions in Sections 10, 11 and 15. Those provisions " +
  "survive termination. Do not sign unless you have read them.";

export const BINDING_ACKNOWLEDGMENTS = [
  {
    key: "non_circumvention" as const,
    label: "Non-circumvention (Section 10)",
    text:
      "I will not hire, engage, or pay Novara personnel assigned to my properties " +
      "other than through the Company, during the term and for twelve (12) months after.",
  },
  {
    key: "chargebacks" as const,
    label: "Chargebacks (Section 11)",
    text:
      "I understand that a chargeback or payment dispute for completed work is a " +
      "material breach. I will raise service issues with the Company first, and I " +
      "remain responsible for amounts properly charged under this Agreement.",
  },
  {
    key: "arbitration" as const,
    label: "Arbitration (Section 15)",
    text:
      "I agree that disputes arising from this Agreement will be resolved by " +
      "binding individual arbitration as stated in Section 15, and that I waive " +
      "a jury trial and class proceedings to the extent permitted by law.",
  },
];

export type PaymentOptionKey = "full" | "split" | "pay_after";

/** Split Payment is the only STR option that places a Stripe Pre-Auth hold. */
export type HostPaymentSetupMode = "hold" | "setup";

export function hostPaymentSetupMode(option: PaymentOptionKey): HostPaymentSetupMode {
  return option === "split" ? "hold" : "setup";
}

/** Agreement §6.2 — the three options, in the document's own wording. */
export const PAYMENT_OPTIONS: Record<
  PaymentOptionKey,
  { key: PaymentOptionKey; title: string; summary: string; body: string }
> = {
  full: {
    key: "full",
    title: "Pay in Full",
    summary: "The full per-turnover rate is charged when the turnover is booked.",
    body:
      "Pay in Full. The Host authorizes the Company to charge the payment method " +
      "on file for the full per-turnover rate at the time a turnover is booked. " +
      "The turnover is confirmed once the charge succeeds, and the Company then " +
      "assigns a crew.",
  },
  split: {
    key: "split",
    title: "Split Payment",
    summary: "Pay half now. The remaining amount is paid on service completion.",
    body:
      "Split Payment. The Host authorizes the Company to charge fifty percent (50%) " +
      "of the per-turnover rate as a deposit when the turnover is booked, and to " +
      "charge the remaining balance automatically when the turnover is completed.",
  },
  pay_after: {
    key: "pay_after",
    title: "Pay After (Card on File)",
    summary: "Nothing is charged at booking; the full rate is charged on completion.",
    body:
      "Pay After (Card on File). Available at the Company's discretion to Hosts in " +
      "good standing. The Host places a payment method on file. Nothing is charged " +
      "when the turnover is booked. The Company charges the full per-turnover rate " +
      "when the cleaner completes the turnover and uploads completion photos.",
  },
};

export const PAY_AFTER_DISCRETION =
  "Pay After is available at the Company's discretion to Hosts in good standing.";

export const AGREEMENT_CLAUSES: Array<[string, string]> = [
  [
    "1. Parties and Appointment",
    "This Host Partnership Agreement (the \"Agreement\") is between Novara Cleaning LLC " +
      "d/b/a NovaraCleaning (the \"Company\") and the host or entity identified on the " +
      "signature page (the \"Host\"). The Host appoints the Company as its independent " +
      "contractor to provide short-term-rental turnover cleaning at the properties listed " +
      "in Section 17 (the \"Properties\").",
  ],
  [
    "2. Scope of Services",
    "The Company will perform guest-ready turnover cleaning at each Property on the dates " +
      "the Host books through the Host Portal. Scope for each visit is the Company's " +
      "standard short-term-rental turnover checklist, plus linen and restock only where " +
      "the Property schedule states they are included. The Company supplies labour, " +
      "standard chemicals and equipment. Consumables the Host wants restocked are supplied " +
      "by the Host unless the schedule says otherwise.",
  ],
  [
    "3. Host Responsibilities",
    "The Host will keep access instructions current, provide working lockbox or smart-lock " +
      "access, and book turnovers with enough window between checkout and the next check-in " +
      "for the work to be done. The Host is responsible for guest-caused damage, missing " +
      "inventory, and conditions outside ordinary turnover cleaning.",
  ],
  [
    "4. Company Responsibilities",
    "The Company will assign background-checked personnel, document the visit against the " +
      "turnover checklist with photographs, and remain responsible for scheduling, " +
      "supervision and payment of its personnel. The Company does not become the Host's " +
      "employee, property manager, or guest-communications agent.",
  ],
  [
    "5. Rates and Pricing",
    "5.1 Each Property has its own per-turnover rate. There is no account-level blended " +
      "rate. 5.2 Rates are set by the Company after review of the Property (bedroom and " +
      "bathroom count, size, linen/restock, and access). The Host reviews and confirms " +
      "the schedule in Section 17; the Host does not set, negotiate, or edit a rate from " +
      "this Agreement. A Host who believes a listed detail is wrong may flag that Property " +
      "for review. Flagging does not change the rate and does not add or remove a Property. " +
      "5.3 An additional Property the Host later requests is priced by the Company under " +
      "this Section 5 before it is added to the schedule. It is never auto-added or " +
      "auto-priced from a request alone. 5.4 The Company may adjust a rate on thirty (30) " +
      "days' written notice, or sooner if the Property's size, bedrooms, bathrooms, or " +
      "included extras change materially.",
  ],
  [
    "6. Payment",
    "6.1 The Host will keep a valid payment method on file. Charges follow the option " +
      "the Host selects below and apply to each booked turnover at that Property's " +
      "then-current rate. 6.2 Payment options. The Host selects one of the following, " +
      "which then governs each turnover unless the parties agree otherwise in writing: " +
      "(a) Pay in Full — the full per-turnover rate is charged when the turnover is booked; " +
      "the turnover is confirmed once the charge succeeds. " +
      "(b) Split Payment — fifty percent (50%) is charged as a deposit when the turnover " +
      "is booked; the remaining balance is charged automatically when the turnover is " +
      "completed. " +
      "(c) Pay After (Card on File) — available at the Company's discretion to Hosts in " +
      "good standing. Nothing is charged when the turnover is booked; the full " +
      "per-turnover rate is charged when the cleaner completes the turnover and uploads " +
      "completion photos. If the Company has not enabled Pay After for this Host, that " +
      "option is not offered. 6.3 Failed charges may pause booking and assignment until " +
      "the payment method is updated.",
  ],
  [
    "7. Access and Keys",
    "The Host grants the Company and its assigned personnel access to each Property for " +
      "booked turnovers and for a reasonable reclean. Access codes are stored for dispatch " +
      "and shared only with the assigned crew for that visit. The Host will rotate codes " +
      "when a listing requires it and will tell the Company promptly.",
  ],
  [
    "8. Insurance",
    "The Company maintains commercial general liability insurance and will furnish a " +
      "current certificate upon request. Each party is responsible for its own workers' " +
      "compensation coverage as required by law. The Host maintains property insurance " +
      "on each Property. The Company's insurance does not replace the Host's property or " +
      "landlord policy.",
  ],
  [
    "9. Quality and Reclean",
    "If work is missed or deficient, the Host may notify the Company within twenty-four " +
      "(24) hours of the visit. The Company will return to correct covered items at no " +
      "additional charge when the notice is timely and the Property is accessible. " +
      "Guest-caused issues, items outside the booked scope, and notice after the next " +
      "check-in are not a reclean.",
  ],
  [
    "10. Non-Circumvention",
    "During the term and for twelve (12) months after it ends, the Host will not directly " +
      "or indirectly hire, engage, solicit, or pay any Company personnel who were assigned " +
      "to a Property, other than through the Company. A breach of this Section is a " +
      "material breach. The Host agrees the Company would be irreparably harmed and that " +
      "the Company may seek injunctive relief in addition to damages, including (without " +
      "limitation) the fees the Company would have earned on the circumvented work.",
  ],
  [
    "11. Chargebacks and Payment Disputes",
    "A chargeback, payment reversal, or card-network dispute for work the Company " +
      "performed under this Agreement is a material breach. The Host will contact the " +
      "Company first to resolve a billing or service question. The Host remains " +
      "responsible for amounts properly charged, plus any card-network fees the Company " +
      "incurs defending an unsuccessful dispute. The Company may pause service, require " +
      "prepayment, or terminate this Agreement after a chargeback.",
  ],
  [
    "12. Confidentiality",
    "Each party will keep the other's non-public information confidential, including " +
      "access codes, guest schedules, rates, and the terms of this Agreement, and will " +
      "use that information only to perform this Agreement.",
  ],
  [
    "13. Term and Termination",
    "This Agreement begins on the date the Host signs and continues until terminated. " +
      "Either party may terminate on thirty (30) days' written notice. The Company may " +
      "suspend or terminate immediately for non-payment, a chargeback, a safety issue, " +
      "or a material breach. Sections 10, 11, 12, 14 and 15 survive termination. " +
      "Turnovers already booked remain payable.",
  ],
  [
    "14. Indemnification and Limitation",
    "Each party will indemnify the other against third-party claims arising from its " +
      "own negligence or willful misconduct. The Company's total liability under this " +
      "Agreement for a given turnover is limited to the fees paid for that turnover, " +
      "except for bodily injury caused by the Company's negligence or any liability " +
      "that cannot be limited by law. The Company is not liable for lost bookings, " +
      "guest claims, or indirect or consequential damages.",
  ],
  [
    "15. Dispute Resolution and Arbitration",
    "The parties will first try to resolve a dispute in good faith. If they cannot, " +
      "any dispute arising out of or relating to this Agreement will be resolved by " +
      "binding individual arbitration administered by the American Arbitration " +
      "Association under its Commercial Arbitration Rules, in Maryland, except that " +
      "either party may seek injunctive relief in court to protect access credentials " +
      "or to enforce Section 10. The Host waives any right to a jury trial and to " +
      "participate in a class or representative proceeding to the extent permitted by " +
      "law. This Section is governed by the Federal Arbitration Act.",
  ],
  [
    "16. General Provisions",
    "This Agreement, including Section 17, is the entire agreement on its subject and " +
      "supersedes prior proposals and discussions. Amendments must be in writing. The " +
      "Host may not assign this Agreement without the Company's consent. Maryland law " +
      "governs, without regard to conflict-of-law rules. If a provision is unenforceable, " +
      "the rest remains in effect. Independent-contractor status is not changed by this " +
      "Agreement. Notices may be sent to the emails on file.",
  ],
  [
    "17. Property & Rate Schedule (Part Two)",
    "The Properties and per-turnover rates attached to this Agreement — and reviewed " +
      "by the Host on the rate-schedule page of the onboarding session — are the " +
      "schedule for Section 5. Each Property is listed as its own block (nickname, " +
      "address, bedrooms, bathrooms, and the Company-set per-turnover rate). A Host " +
      "flag or an additional-property request is a note to the Company; it does not " +
      "amend this schedule until the Company prices and confirms the change.",
  ],
];

export function formatTurnoverRate(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(Number(amount))) return "—";
  return `$${Number(amount).toFixed(0)}`;
}

export function bedsBathsLabel(bedrooms?: number | null, bathrooms?: number | null): string {
  const beds = bedrooms == null ? "—" : String(bedrooms);
  const baths = bathrooms == null ? "—" : String(bathrooms);
  return `${beds} bed · ${baths} bath`;
}
