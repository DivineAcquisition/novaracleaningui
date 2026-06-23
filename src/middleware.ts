import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/integrations/supabase/middleware";

// ─── Strict subdomain architecture ──────────────────────────────────────
//
// Each subdomain owns an exact allowlist of path prefixes. Any request
// arriving on the wrong subdomain is 308-redirected to the owning host.
//
//   admin.novaracleaning.com      — admin portal + sign-in only
//   try.novaracleaning.com        — public marketing, booking funnel,
//                                    membership browse, demo, pricing
//   app.novaracleaning.com        — authenticated customer portal
//                                    (account, manage-booking, membership
//                                     success, billing returns, auth flows)
//   contractor.novaracleaning.com — the entire cleaner journey:
//                                    application onboarding (email
//                                    verification → ob-portal → ID/W-9/etc),
//                                    sign-in, dashboard, mobile-dashboard,
//                                    jobs, password reset
//   partner.novaracleaning.com    — Airbnb/STR host turnover portal:
//                                    host signup/login, properties, turnover
//                                    requests, weekly schedule, dashboard,
//                                    and its own auth callback. Owns ONLY
//                                    /partner/* — everything else 308s away,
//                                    and /partner/* is served ONLY here.
//
// hiring.novaracleaning.com is NOT served by this Next.js app — it is
// hosted on Framer. DNS for hiring.* points away from this project.
//
// Apex novaracleaning.com / www.* are treated as `try` (marketing root).
// localhost / *.lovableproject.com / *.vercel.app / preview hosts skip
// enforcement so dev/preview keep working on a single origin.
//
// Always-allowed everywhere: /api, /_next, /favicon, static assets,
// /auth/callback, /cleaner/auth/callback (Supabase magic-link landings).

const HOSTS = {
  admin: "admin.novaracleaning.com",
  try: "try.novaracleaning.com",
  app: "app.novaracleaning.com",
  contractor: "contractor.novaracleaning.com",
  partner: "partner.novaracleaning.com",
} as const;

type SubdomainKey = keyof typeof HOSTS;

// Path-prefix → owning subdomain. Order matters — longer/more specific
// prefixes first. Anything not matched falls through to `try`
// (the marketing host).
const ROUTE_OWNER: Array<[string, SubdomainKey]> = [
  ["/admin", "admin"],

  // Contractor portal: the entire cleaner journey lives here.
  // - /cleaner/onboarding, /cleaner/ob-portal, /ob-portal: application
  //   funnel (post-Framer hand-off from hiring.novaracleaning.com)
  // - /cleaner/auth, /cleaner/dashboard, /cleaner/mobile-dashboard,
  //   /cleaner/reset-password: signed-in cleaner portal
  // - /contractor/*: legacy contractor routes
  ["/cleaner", "contractor"],
  ["/contractor", "contractor"],
  ["/ob-portal", "contractor"],

  // Customer portal (authenticated)
  ["/account", "app"],
  ["/portal", "app"],
  ["/manage-booking", "app"],
  ["/update-password", "app"],
  ["/reset-password", "app"],
  ["/sms-consent", "app"],
  ["/auth", "app"],
  ["/membership/success", "app"],

  // Partner (Airbnb/STR host) turnover portal — its own subdomain. Owns the
  // whole /partner/* tree, including its auth callback (/partner/auth/callback).
  // Listed before the try.* marketing prefixes so it can never fall through.
  ["/partner", "partner"],

  // Public marketing + booking funnel (try.*). /book/confirmation stays
  // on try so the entire Stripe-checkout-return flow keeps a single host.
  ["/book", "try"],
  ["/membership", "try"], // /membership and /membership/[planId] browse
  ["/checklist", "try"],  // /checklist and /checklist/[slug] public scope sheets
  ["/demo", "try"],
  ["/pricing-sheet", "try"],
];

const DEFAULT_LANDING: Record<SubdomainKey, string> = {
  admin: "/admin/auth",
  try: "/",
  app: "/auth",
  contractor: "/cleaner/auth",
  partner: "/partner",
};

// Paths that ALL subdomains may serve (framework / static / crawler files).
// These are truly host-agnostic and must never be redirected or rewritten.
//
// NOTE: OAuth / magic-link callbacks are intentionally NOT global. Each
// portal's callback lives under that portal's owned prefix, so it is served
// ONLY on its owning subdomain and 308-redirected anywhere else. This keeps
// a sign-in started on one subdomain from EVER landing on another portal:
//
//   app.novaracleaning.com/auth/callback                 → customer (/account)
//   contractor.novaracleaning.com/cleaner/auth/callback  → cleaner
//   admin.novaracleaning.com/admin/auth/callback         → admin (has_role gate)
//   partner.novaracleaning.com/partner/auth/callback     → host portal
//
// (308 preserves the ?code= query and the browser preserves the URL hash, so
// a callback that somehow lands on the wrong host still completes after the
// redirect to its owner.)
const GLOBAL_ALLOWLIST = [
  "/api",
  "/_next",
  "/favicon",
  "/robots.txt",
  "/sitemap.xml",
];

function ownerOf(pathname: string): SubdomainKey {
  for (const [prefix, owner] of ROUTE_OWNER) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) return owner;
  }
  return "try";
}

function subdomainOf(hostname: string): SubdomainKey | null {
  const h = hostname.toLowerCase();
  if (h.startsWith("admin.")) return "admin";
  if (h.startsWith("try.")) return "try";
  if (h.startsWith("app.")) return "app";
  if (h.startsWith("contractor.")) return "contractor";
  if (h.startsWith("partner.")) return "partner";
  // hiring.* is hosted on Framer — if DNS still points here for any
  // reason, fall through to `try` (marketing) so we never serve broken
  // content on the hiring subdomain.
  return null;
}

function isProdHost(hostname: string): boolean {
  return hostname === "novaracleaning.com" || hostname.endsWith(".novaracleaning.com");
}

function isExemptHost(hostname: string): boolean {
  // Local dev, vercel previews, lovable previews — no enforcement.
  return (
    hostname.includes("localhost") ||
    hostname.includes("127.0.0.1") ||
    hostname.endsWith(".vercel.app") ||
    hostname.endsWith(".lovableproject.com") ||
    hostname.endsWith(".lovable.app") ||
    hostname.endsWith(".onrender.com")
  );
}

export async function middleware(request: NextRequest) {
  const response = await updateSession(request);
  const hostname = (request.headers.get("host") || "").toLowerCase();
  const pathname = request.nextUrl.pathname;

  // Skip everything for global allowlist paths (api, _next, etc).
  if (GLOBAL_ALLOWLIST.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return response;
  }

  // Skip dev / preview hosts — single-origin dev still works.
  if (!isProdHost(hostname) || isExemptHost(hostname)) {
    return response;
  }

  // Apex novaracleaning.com / www.novaracleaning.com → treat as try.*
  // (marketing root). No redirect to keep apex SEO-canonical working.
  const currentSubdomain: SubdomainKey = subdomainOf(hostname) ?? "try";

  // Special-case the root path: every subdomain owns its own root, and we
  // immediately redirect it to that subdomain's default landing. Without
  // this, `/` would always be "owned" by `try` and we'd kick visitors of
  // admin.* off to try.*.
  if (pathname === "/") {
    const landing = DEFAULT_LANDING[currentSubdomain];
    if (landing !== "/") {
      const url = request.nextUrl.clone();
      url.pathname = landing;
      return NextResponse.redirect(url, 307);
    }
    return response; // try.* root = marketing landing, serve as-is
  }

  const owner = ownerOf(pathname);

  // ─── Strict redirect: wrong subdomain ────────────────────────────────
  if (currentSubdomain !== owner) {
    const targetUrl = request.nextUrl.clone();
    targetUrl.protocol = "https:";
    targetUrl.host = HOSTS[owner];
    return NextResponse.redirect(targetUrl, 308);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
