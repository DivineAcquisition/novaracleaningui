// Stripe dispute evidence budgets.
// Reconfirmed 2026-10-13 against https://docs.stripe.com/disputes/best-practices
// and https://docs.stripe.com/disputes/api:
//   - one file per evidence type (combine documents into that file)
//   - PDF, JPEG, and PNG only
//   - combined file size no more than 4.5 MB
//   - combined page count must be less than 50, and Mastercard is 19 pages
//   - text fields share 150,000 characters
//   - evidence can be staged, and submission is a single opportunity
// There is no 17-file cap. Numbers stay here so they can be overridden.
// 19 pages is the budget for every card network because it is the strictest.

export interface DisputeEvidenceLimits {
  confirmedAt: string;
  combinedBytes: number;
  /** Strictest network page budget. Applied to every card network. */
  combinedPages: number;
  /** Stripe also requires the combined page count to be under 50. */
  singleFilePages: number;
  textCharacters: number;
  formats: string[];
  packetPages: {
    service_documentation: number;
    customer_communication: number;
    customer_signature: number;
    policy: number;
    receipt: number;
    uncategorized_file: number;
  };
  /** Displayed photo size. Photos are dropped, never shrunk below this, to fit more. */
  minPhotoHeightPt: number;
  minPhotoWidthPt: number;
  photoMaxHeightPt: number;
  /** Months to keep a client's prepared evidence. Card networks allow disputes long after a charge. */
  retentionMonths: number;
  /** How far back a one-time backfill will look. */
  lookbackDays: number;
}

export const STRIPE_EVIDENCE_LIMITS: DisputeEvidenceLimits = {
  confirmedAt: "2026-10-13",
  combinedBytes: 4_500_000,
  combinedPages: 19,
  singleFilePages: 50,
  textCharacters: 150_000,
  formats: ["pdf", "png", "jpg", "jpeg"],
  packetPages: {
    service_documentation: 6,
    customer_communication: 4,
    customer_signature: 2,
    policy: 2,
    receipt: 1,
    uncategorized_file: 2,
  },
  minPhotoHeightPt: 220,
  minPhotoWidthPt: 200,
  photoMaxHeightPt: 300,
  retentionMonths: 24,
  lookbackDays: 730,
};

/** Approx body lines that fit on one letter page under the identification strip. */
export const LINES_PER_PAGE = 36;

export function lineBudget(pages: number): number {
  return Math.max(1, pages) * LINES_PER_PAGE;
}
