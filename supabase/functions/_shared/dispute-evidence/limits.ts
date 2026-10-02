// Stripe dispute evidence budgets.
// Confirmed 2026-10-02 against https://docs.stripe.com/disputes/best-practices
// and the dispute evidence object (one file per evidence type; PDF/JPEG/PNG;
// combined 4.5 MB; combined under 50 pages; Mastercard 19 pages; text fields
// share 150,000 characters). Numbers stay in this object so they can be
// overridden. There is no 17-file cap in Stripe's documentation.

export interface DisputeEvidenceLimits {
  confirmedAt: string;
  combinedBytes: number;
  /** Strictest network page budget. Applied to every card network. */
  combinedPages: number;
  singleFilePages: number;
  textCharacters: number;
  formats: string[];
  packetPages: {
    service_documentation: number;
    customer_communication: number;
    customer_signature: number;
    policy: number;
    receipt: number;
  };
}

export const STRIPE_EVIDENCE_LIMITS: DisputeEvidenceLimits = {
  confirmedAt: "2026-10-02",
  combinedBytes: 4_500_000,
  combinedPages: 19,
  singleFilePages: 50,
  textCharacters: 150_000,
  formats: ["pdf", "png", "jpg", "jpeg"],
  packetPages: {
    service_documentation: 6,
    customer_communication: 6,
    customer_signature: 2,
    policy: 2,
    receipt: 1,
  },
};

/** Approx body lines that fit on one letter page at the renderer size. */
export const LINES_PER_PAGE = 42;

export function lineBudget(pages: number): number {
  return Math.max(1, pages) * LINES_PER_PAGE;
}
