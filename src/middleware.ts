import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/integrations/supabase/middleware";

// ─── Strict subdomain architecture ──────────────────────────────────────
//
// Each subdomain owns an exact allowlist of path prefixes. Any request
// arriving on the wrong subdomain is 308-redirected to the owning host.
//
//   admin.novaracleaning.com  — admin portal + sign-in only
//   hiring.novaracleaning.com — hiring landing + role pages + cleaner
//                                onboarding application flow
//   try.novaracleaning.com    — public marketing, booking funnel,
//                                membership browse, demo, pricing
//   app.novaracleaning.com    — authenticated customer portal
//                                (account, manage-booking, membership
//                                 success, billing returns, auth flows)
//   contractor.novaracleaning.com — cleaner mobile portal (post-onboarding)
//
// Apex novaracleaning.com / www.* are treated as `try` (marketing root).
// localhost / *.lovableproject.com / *.vercel.app / preview hosts skip
// enforcement so dev/preview keep working on a single origin.
//
// Always-allowed everywhere: /api, /_next, /favicon, static assets,
// /auth/callback, /cleaner/auth/callback (Supabase magic-link landings).

const HOSTS = {
  admin: "admin.novaracleaning.com",
  hiring: "hiring.novaracleaning.com",
  try: "try.novaracleaning.com",
  app: "app.novaracleaning.com",
  contractor: "contractor.novaracleaning.com",
} as const;

type SubdomainKey = keyof typeof HOSTS;

// Path-prefix → owning subdomain. Order matters — longer/more specific
// prefixes first. Anything not matched falls through to `try`
// (the marketing host).
const ROUTE_OWNER: Array<[string, SubdomainKey]> = [
  ["/admin", "admin"],

  // Hiring microsite + cleaner application start
  ["/hiring", "hiring"],
  ["/cleaner/onboarding", "hiring"],
  ["/cleaner/ob-portal", "hiring"],
  ["/ob-portal", "hiring"],

  // Cleaner portal (post-onboarding) lives on contractor.*
  ["/cleaner", "contractor"],
  ["/contractor", "contractor"],

  // Customer portal (authenticated)
  ["/account", "app"],
  ["/portal", "app"],
  ["/manage-booking", "app"],
  ["/update-password", "app"],
  ["/reset-password", "app"],
  ["/sms-consent", "app"],
  ["/auth", "app"],
  ["/membership/success", "app"],

  // Public marketing + booking funnel (try.*). /book/confirmation stays
  // on try so the entire Stripe-checkout-return flow keeps a single host.
  ["/book", "try"],
  ["/membership", "try"], // /membership and /membership/[planId] browse
  ["/demo", "try"],
  ["/pricing-sheet", "try"],
];

const DEFAULT_LANDING: Record<SubdomainKey, string> = {
  admin: "/admin/auth",
  hiring: "/hiring",
  try: "/",
  app: "/auth",
  contractor: "/cleaner/auth",
};

// Paths that ALL subdomains may serve (system / OAuth callbacks /
// long-lived deep links). Never redirect or rewrite these.
const GLOBAL_ALLOWLIST = [
  "/api",
  "/_next",
  "/favicon",
  "/robots.txt",
  "/sitemap.xml",
  "/auth/callback",
  "/cleaner/auth/callback",
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
  if (h.startsWith("hiring.")) return "hiring";
  if (h.startsWith("try.")) return "try";
  if (h.startsWith("app.")) return "app";
  if (h.startsWith("contractor.")) return "contractor";
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
