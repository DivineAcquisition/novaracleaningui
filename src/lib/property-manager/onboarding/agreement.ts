// ─── Property Management Services Agreement ────────────────────────────────
//
// The in-session document for the Property Manager relationship. Part Two —
// the unit registry and its standing rates — is rendered on Page 2 from the
// session snapshot and attaches as Section 16.
//
// The clause that defines this type is Section 5: rates are set once per unit
// by the Company and stand until the Company changes them. The property
// manager confirms the registry; they never set or negotiate a rate, and they
// never re-quote a unit to book a turnover on it.

export const COMPANY_LEGAL_NAME = "Novara Cleaning LLC";
export const COMPANY_DBA = "NovaraCleaning";

export const IMPORTANT_NOTICE =
  "IMPORTANT NOTICE. This Property Management Services Agreement is a binding " +
  "contract. By signing you acknowledge and agree to the non-circumvention, " +
  "chargeback, and arbitration provisions in Sections 9, 10 and 14. Those " +
  "provisions survive termination. Do not sign unless you have read them.";

export const BINDING_ACKNOWLEDGMENTS = [
  {
    key: "non_circumvention" as const,
    label: "Non-circumvention (Section 9)",
    text:
      "I will not hire, engage, or pay Novara personnel assigned to units in my " +
      "portfolio other than through the Company, during the term and for twelve " +
      "(12) months after.",
  },
  {
    key: "chargebacks" as const,
    label: "Chargebacks (Section 10)",
    text:
      "I understand that a chargeback or payment dispute for completed work is a " +
      "material breach. I will raise service issues with the Company first, and I " +
      "remain responsible for amounts properly invoiced under this Agreement.",
  },
  {
    key: "arbitration" as const,
    label: "Arbitration (Section 14)",
    text:
      "I agree that disputes arising from this Agreement will be resolved by " +
      "binding individual arbitration as stated in Section 14, and that I waive " +
      "a jury trial and class proceedings to the extent permitted by law.",
  },
];

export type PmBillingMethod = "invoiced" | "auto_pay";

/**
 * Section 6 billing options.
 *
 * Invoiced is first and default. A manager running a portfolio reconciles a
 * period across many units; billing them per turnover would hand them the
 * paperwork this relationship exists to remove.
 */
export const PM_BILLING_OPTIONS: Record<
  PmBillingMethod,
  { key: PmBillingMethod; title: string; summary: string; body: string; recommended: boolean }
> = {
  invoiced: {
    key: "invoiced",
    title: "Invoiced (recommended)",
    summary:
      "One consolidated invoice per billing period covering every unit serviced, itemized by unit.",
    body:
      "Invoiced. The Company issues one consolidated invoice per billing period " +
      "covering all turnovers performed across the Manager's portfolio during that " +
      "period, itemized by unit. Payment is due on the Net terms stated on the " +
      "invoice. The Company does not issue a separate invoice per turnover.",
    recommended: true,
  },
  auto_pay: {
    key: "auto_pay",
    title: "Auto-Pay",
    summary:
      "Same consolidated statement each period, charged automatically to the payment method on file.",
    body:
      "Auto-Pay. The Manager keeps a payment method on file and authorizes the " +
      "Company to charge the consolidated period statement automatically when it " +
      "issues. The statement is itemized by unit exactly as it is for Invoiced " +
      "accounts; only the collection method differs.",
    recommended: false,
  },
};

export const AGREEMENT_CLAUSES: Array<[string, string]> = [
  [
    "1. Parties and Appointment",
    "This Property Management Services Agreement (the \"Agreement\") is between Novara " +
      "Cleaning LLC d/b/a NovaraCleaning (the \"Company\") and the property management " +
      "company or owner identified on the signature page (the \"Manager\"). The Manager " +
      "appoints the Company as its independent contractor to provide turnover and " +
      "recurring cleaning at the residential rental units listed in Section 16 (the " +
      "\"Units\").",
  ],
  [
    "2. Scope of Services",
    "The Company performs Move-Out, Move-In, and Standard cleaning at a Unit on the " +
      "dates the Manager books through the Partner Portal. Each service is performed to " +
      "the Company's standard residential checklist for that service. The Company " +
      "supplies labour, standard chemicals and equipment. Repairs, painting, trash-out " +
      "of abandoned furnishings, and remediation are not cleaning services and are not " +
      "within scope.",
  ],
  [
    "3. Turnover Requests and Deadlines",
    "3.1 The Manager books a turnover by selecting a registered Unit, a service, and " +
      "the date by which the Unit must be ready (the \"Needed-By Date\"). The Needed-By " +
      "Date is typically a lease date and the Company treats it as a hard completion " +
      "deadline, scheduling the work to finish on or before it. 3.2 A turnover booked " +
      "on a registered Unit is confirmed at that Unit's standing rate at the time of " +
      "booking. No walkthrough, estimate, or quote is required. 3.3 The Manager will " +
      "give as much notice as the lease calendar allows; the Company will tell the " +
      "Manager promptly if a Needed-By Date cannot be met.",
  ],
  [
    "4. Unit Registry and Access",
    "4.1 Each Unit is registered once with its address and unit identifier, square " +
      "footage, bedroom and bathroom count, and service zone. 4.2 Access details for a " +
      "Unit — lockbox code, key pickup, building entry — are stored on the Unit and " +
      "reused for every turnover on that Unit. Access details are shared only with the " +
      "crew assigned to a specific visit and only for the window of that visit. The " +
      "Manager will keep them current and tell the Company promptly when a code " +
      "changes. 4.3 The Manager may add a Unit at any time through the Partner Portal.",
  ],
  [
    "5. Standing Rates",
    "5.1 Each Unit has its own standing rate for each service. Rates are set by the " +
      "Company from the Unit's size, bedroom count, and service zone. There is no " +
      "account-level blended rate. 5.2 The Manager reviews and confirms the registry in " +
      "Section 16; the Manager does not set, negotiate, or edit a rate from this " +
      "Agreement. A Manager who believes a listed detail is wrong may flag that Unit " +
      "for review. Flagging does not change the rate and does not remove the Unit. " +
      "5.3 A Unit added later is priced by the Company on the same basis. A Unit " +
      "materially outside the Company's normal residential size range, or one the " +
      "Manager flags as non-standard, is priced by a person before it becomes " +
      "bookable. 5.4 A standing rate holds for every turnover on that Unit until the " +
      "Company changes it. The Company may adjust a rate on thirty (30) days' written " +
      "notice, or sooner if the Unit's size, bedrooms, bathrooms, or access change " +
      "materially.",
  ],
  [
    "6. Portfolio Volume Discount",
    "Where the Company applies a portfolio volume discount based on the number of " +
      "registered Units, that discount is reflected in each Unit's standing rate and " +
      "is funded entirely from the Company's margin. It does not reduce what the " +
      "Company pays the personnel performing the work. The applicable tier is " +
      "determined by the Company and may change as the registry grows or shrinks.",
  ],
  [
    "7. Billing and Payment",
    "7.1 Unless the parties agree otherwise, the Company issues one consolidated " +
      "invoice per billing period covering all turnovers performed across the " +
      "Manager's portfolio during that period, itemized by Unit. 7.2 The Manager " +
      "selects Invoiced or Auto-Pay under Section 6 of the onboarding session; both " +
      "receive the same consolidated, unit-itemized statement. 7.3 Amounts are due on " +
      "the Net terms stated on the invoice. Late or failed payment may pause booking " +
      "and assignment until it is resolved.",
  ],
  [
    "8. Condition Beyond Normal Turnover",
    "8.1 A Unit left in a condition materially heavier than a normal turnover — " +
      "hoarding, biohazard, construction debris, extensive damage — is handled through " +
      "the Company's scope-adjustment process: the crew documents the condition with " +
      "photographs, the Company records a defined reason, and the Company notifies the " +
      "Manager of the revised value before it is billed. 8.2 The Unit's standing rate " +
      "is not changed by a scope adjustment on a single turnover. One difficult tenant " +
      "does not re-price the apartment.",
  ],
  [
    "9. Non-Circumvention",
    "During the term and for twelve (12) months after it ends, the Manager will not " +
      "directly or indirectly hire, engage, solicit, or pay any Company personnel who " +
      "were assigned to a Unit, other than through the Company. A breach of this " +
      "Section is a material breach. The Manager agrees the Company would be " +
      "irreparably harmed and that the Company may seek injunctive relief in addition " +
      "to damages, including (without limitation) the fees the Company would have " +
      "earned on the circumvented work.",
  ],
  [
    "10. Chargebacks and Payment Disputes",
    "A chargeback, payment reversal, or card-network dispute for work the Company " +
      "performed under this Agreement is a material breach. The Manager will contact " +
      "the Company first to resolve a billing or service question. The Manager remains " +
      "responsible for amounts properly invoiced, plus any card-network fees the " +
      "Company incurs defending an unsuccessful dispute.",
  ],
  [
    "11. Quality and Reclean",
    "If work is missed or deficient, the Manager may notify the Company within " +
      "twenty-four (24) hours of the visit, or before tenant possession if that is " +
      "sooner. The Company will return to correct covered items at no additional " +
      "charge when the notice is timely and the Unit is accessible. Tenant-caused " +
      "conditions and items outside the booked scope are not a reclean.",
  ],
  [
    "12. Insurance and Confidentiality",
    "The Company maintains commercial general liability insurance and will furnish a " +
      "current certificate upon request. Each party is responsible for its own " +
      "workers' compensation coverage as required by law. Each party will keep the " +
      "other's non-public information confidential, including access codes, tenant " +
      "information, rates, and the terms of this Agreement.",
  ],
  [
    "13. Term and Termination",
    "This Agreement begins on the date the Manager signs and continues until " +
      "terminated. Either party may terminate on thirty (30) days' written notice. The " +
      "Company may suspend or terminate immediately for non-payment, a chargeback, a " +
      "safety issue, or a material breach. Sections 9, 10, 12, 14 and 15 survive " +
      "termination. Turnovers already booked remain payable.",
  ],
  [
    "14. Dispute Resolution and Arbitration",
    "The parties will first try to resolve a dispute in good faith. If they cannot, " +
      "any dispute arising out of or relating to this Agreement will be resolved by " +
      "binding individual arbitration administered by the American Arbitration " +
      "Association under its Commercial Arbitration Rules, in Maryland, except that " +
      "either party may seek injunctive relief in court to protect access credentials " +
      "or to enforce Section 9. The Manager waives any right to a jury trial and to " +
      "participate in a class or representative proceeding to the extent permitted by " +
      "law. This Section is governed by the Federal Arbitration Act.",
  ],
  [
    "15. General Provisions",
    "This Agreement, including Section 16, is the entire agreement on its subject and " +
      "supersedes prior proposals and discussions. Amendments must be in writing. The " +
      "Manager may not assign this Agreement without the Company's consent. Maryland " +
      "law governs, without regard to conflict-of-law rules. If a provision is " +
      "unenforceable, the rest remains in effect. Notices may be sent to the emails " +
      "on file.",
  ],
  [
    "16. Unit Registry & Standing Rates (Part Two)",
    "The Units and standing rates attached to this Agreement — and reviewed by the " +
      "Manager on the registry page of the onboarding session — are the schedule for " +
      "Section 5. Each Unit is listed as its own block (unit identifier, address, " +
      "size, bedrooms and bathrooms, and the Company-set Move-Out, Move-In and " +
      "Standard rates). A Manager flag or an added-unit request is a note to the " +
      "Company; it does not amend this schedule until the Company prices and confirms " +
      "the change.",
  ],
];
