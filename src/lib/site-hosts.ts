// The public application lives only on the hiring host.
// Onboarding lives only on the contractor host.

export const HIRING_HOST = "hiring.novaracleaning.com";
export const CONTRACTOR_HOST = "contractor.novaracleaning.com";
export const HIRING_ORIGIN = `https://${HIRING_HOST}`;
export const CONTRACTOR_ORIGIN = `https://${CONTRACTOR_HOST}`;

export function requestHost(req: Request): string {
  const raw = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  return raw.split(",")[0].trim().split(":")[0].toLowerCase();
}

export function isLocalOrPreviewHost(host: string): boolean {
  return (
    !host
    || host === "localhost"
    || host === "127.0.0.1"
    || host.endsWith(".vercel.app")
    || host.endsWith(".lovable.app")
    || host.endsWith(".lovableproject.com")
    || host.endsWith(".onrender.com")
  );
}

export function isProductionNovaraHost(host: string): boolean {
  const name = host.toLowerCase();
  return name === "novaracleaning.com" || name.endsWith(".novaracleaning.com");
}

/** Production application requests are accepted only on the hiring host. */
export function applicationHostAllowed(host: string): boolean {
  if (isLocalOrPreviewHost(host)) return true;
  return host.toLowerCase() === HIRING_HOST;
}

/** Production onboarding requests are accepted only on the contractor host. */
export function onboardingHostAllowed(host: string): boolean {
  if (isLocalOrPreviewHost(host)) return true;
  return host.toLowerCase() === CONTRACTOR_HOST;
}

export function hiringApplyUrl(path = ""): string {
  if (!path) return `${HIRING_ORIGIN}/hiring/apply`;
  if (path.startsWith("?") || path.startsWith("/")) return `${HIRING_ORIGIN}/hiring/apply${path}`;
  return `${HIRING_ORIGIN}/hiring/apply/${path}`;
}

export function contractorOnboardingUrl(inviteToken: string): string {
  return `${CONTRACTOR_ORIGIN}/cleaner/auth?invite=${encodeURIComponent(inviteToken)}`;
}
