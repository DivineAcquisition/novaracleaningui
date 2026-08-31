// ─── Novara's own certificate of insurance (client-safe) ───────────────────
//
// The ACORD 25 on file: Novara Cleaning LLC dba NovaraCleaning, issued
// 08/31/2026, Spinnaker CSG-00519113-00, in force 07/21/2026–07/21/2027.
//
// The PDF lives at a commercial-owned public path so a facilities manager
// can open it from intake, the proposal, the agreement and onboarding
// without an admin session. Signature-time delivery still attaches the
// bytes; this path is the copy they can pull themselves.
//
// Distinct from commercial_coi_documents (certificates belonging to an
// account). This is OUR certificate.

export const COMPANY_COI_PUBLIC_PATH = "commercial/novara-certificate-of-insurance.pdf";
export const COMPANY_COI_PUBLIC_HREF = `/${COMPANY_COI_PUBLIC_PATH}`;
export const COMPANY_COI_DOCUMENT_PATH = `public:${COMPANY_COI_PUBLIC_PATH}`;
export const COMPANY_COI_FILENAME = "NovaraCleaning Certificate of Insurance.pdf";
export const COMPANY_COI_BYTES = 96_407;

export const COMPANY_COI_EFFECTIVE_DATE = "2026-07-21";
export const COMPANY_COI_EXPIRATION_DATE = "2027-07-21";
export const COMPANY_COI_CARRIER = "Spinnaker Insurance Company";
export const COMPANY_COI_POLICY_NUMBER = "CSG-00519113-00";
export const COMPANY_COI_NAIC = "24376";
export const COMPANY_COI_COVERAGE_NOTES =
  "Commercial general liability: $2,000,000 each occurrence; $4,000,000 general aggregate; " +
  "$4,000,000 products-completed operations; $50,000 damage to rented premises; $5,000 medical expense. " +
  "Insurer NAIC 24376.";

const PUBLIC_PREFIX = "public:";

export function isPublicCompanyCoiPath(path: string | null | undefined): boolean {
  if (!path) return false;
  return path.startsWith(PUBLIC_PREFIX) || path === COMPANY_COI_PUBLIC_PATH;
}

export function companyCoiPublicHref(path?: string | null): string {
  if (path?.startsWith(PUBLIC_PREFIX)) {
    const rest = path.slice(PUBLIC_PREFIX.length).replace(/^\/+/, "");
    return rest ? `/${rest}` : COMPANY_COI_PUBLIC_HREF;
  }
  return COMPANY_COI_PUBLIC_HREF;
}

export function companyCoiFileUrl(
  path: string | null | undefined,
  signedUrl?: string | null,
): string | null {
  if (isPublicCompanyCoiPath(path)) return companyCoiPublicHref(path);
  return signedUrl || null;
}

export function companyCoiExpiresLabel(): string {
  return new Date(`${COMPANY_COI_EXPIRATION_DATE}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
