const FALLBACK_PARTNER_ORIGIN = "https://partner.novaracleaning.com";

/**
 * Canonical portal host is partner.novaracleaning.com.
 * Historical partners.* values (env, settings, emails) are rewritten here
 * so Stripe returns and handoff links never advertise the alias.
 */
export function canonicalizePartnerOrigin(raw: string): string {
  return String(raw || FALLBACK_PARTNER_ORIGIN)
    .replace(/\/+$/, "")
    .replace(/^(https?:\/\/)partners\.novaracleaning\.com/i, "$1partner.novaracleaning.com");
}

export const PARTNER_ORIGIN = canonicalizePartnerOrigin(
  process.env.NEXT_PUBLIC_PARTNER_ORIGIN ||
    process.env.PARTNER_ORIGIN ||
    process.env.NEXT_PUBLIC_PARTNERS_ORIGIN ||
    process.env.PARTNERS_ORIGIN ||
    FALLBACK_PARTNER_ORIGIN,
);

/** Alias kept so existing imports keep compiling. */
export const PARTNERS_ORIGIN = PARTNER_ORIGIN;

export function partnersOrigin(): string {
  return PARTNER_ORIGIN;
}

export function portalHomeUrl(): string {
  return `${partnersOrigin()}/partner`;
}

export function enterUrl(token: string): string {
  return `${partnersOrigin()}/partner/enter/${token}`;
}

export function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().split(":")[0];
  return (
    h.includes("localhost") ||
    h.includes("127.0.0.1") ||
    h === "::1" ||
    h === "0.0.0.0"
  );
}

/** Prefer the Host header — Next's Request URL hostname is empty in some dev setups. */
export function requestIsLocal(req: Request): boolean {
  let fromUrl = "";
  try {
    fromUrl = new URL(req.url).hostname;
  } catch {
    fromUrl = "";
  }
  const fromHeader = req.headers.get("host") || "";
  return isLocalHost(fromUrl) || isLocalHost(fromHeader);
}

/**
 * Stripe Checkout return URL on the portal the user is actually using.
 * `{CHECKOUT_SESSION_ID}` must stay a literal so Stripe can substitute it —
 * do not run this through URLSearchParams.
 */
export function portalCallbackUrl(req: Request, query: string): string {
  const url = new URL(req.url);
  const host = req.headers.get("host") || url.host;
  const origin = requestIsLocal(req)
    ? `${url.protocol === "https:" ? "https" : "http"}://${host}`
    : partnersOrigin();
  return `${origin.replace(/\/+$/, "")}/partner?${query}`;
}
