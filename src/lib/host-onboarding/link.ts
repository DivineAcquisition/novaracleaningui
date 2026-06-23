// ─── STR / Partnership onboarding link builder ────────────────────────────
//
// One source of truth for the host onboarding URL so the admin "spin up a
// link" tool and the host-facing form agree. The form lives on the partner
// subdomain (partner.novaracleaning.com/partner/onboarding) but is generated
// from the admin subdomain, so we can't just use window.location.origin.

export const PARTNER_ONBOARDING_PATH = "/partner/onboarding";
const PROD_PARTNER_HOST = "https://partner.novaracleaning.com";

export interface OnboardingPrefill {
  name?: string;
  email?: string;
  phone?: string;
  /** Service zone — must match SERVICE_ZONES values to prefill the select. */
  zone?: string;
  /** Attribution tag, e.g. the VA / channel that generated the link. */
  ref?: string;
}

/**
 * Resolve the partner-portal base URL. In production every Novara subdomain
 * (admin / app / partner) maps the host form to the partner subdomain. In
 * local dev we keep the current origin so links open against the dev server.
 */
export function partnerBaseUrl(origin?: string): string {
  const o = origin || (typeof window !== "undefined" ? window.location.origin : "");
  try {
    const host = new URL(o).hostname;
    if (host.endsWith("novaracleaning.com")) return PROD_PARTNER_HOST;
    if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")) return o;
  } catch {
    /* fall through to prod */
  }
  return o && o.startsWith("http") ? o : PROD_PARTNER_HOST;
}

/** Build the full, optionally-prefilled STR / Partnership onboarding link. */
export function buildOnboardingLink(prefill: OnboardingPrefill = {}, origin?: string): string {
  const base = partnerBaseUrl(origin);
  const url = new URL(PARTNER_ONBOARDING_PATH, base.endsWith("/") ? base : `${base}/`);
  const add = (k: string, v?: string) => {
    const t = (v || "").trim();
    if (t) url.searchParams.set(k, t);
  };
  add("name", prefill.name);
  add("email", prefill.email);
  add("phone", prefill.phone);
  add("zone", prefill.zone);
  add("ref", prefill.ref);
  return url.toString();
}
