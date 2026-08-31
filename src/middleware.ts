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
//   eod.novaracleaning.com        — the VA end-of-day report. Authenticated
//                                    (VA or admin); one adaptive form that
//                                    pre-fills what the system already
//                                    observed and asks only for what it
//                                    can't see.
//   partner.novaracleaning.com    — Airbnb/STR host turnover portal:
//                                    host signup/login, properties, turnover
//                                    requests, weekly schedule, dashboard,
//                                    and its own auth callback. Owns ONLY
//                                    /partner/* — everything else 308s away,
//                                    and /partner/* is served ONLY here.
//
// hiring.novaracleaning.com — public careers site (open roles + apply).
// Owned paths: /hiring/*. DNS points here; Framer is no longer the front door.
//
// docs.novaracleaning.com — internal workspace guides ("how the tool works").
//                    UNLIKE commercial.* and partners.*, this host is NOT
//                    public: it carries pricing formulas, the cleaner-pay
//                    floor, override bands and every hard stop in the admin
//                    workspace. Access is gated server-side by the same
//                    admin/VA check the workspace uses (see
//                    src/lib/docs/auth.ts), and this file adds defence in
//                    depth: a noindex header on every response and a
//                    Disallow-all robots.txt served only for this host.
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
  team: "team.novaracleaning.com",
  commercial: "commercial.novaracleaning.com",
  eod: "eod.novaracleaning.com",
  hiring: "hiring.novaracleaning.com",
  docs: "docs.novaracleaning.com",
} as const;

type SubdomainKey = keyof typeof HOSTS;

// Path-prefix → owning subdomain. Order matters — longer/more specific
// prefixes first. Anything not matched falls through to `try`
// (the marketing host).
const ROUTE_OWNER: Array<[string, SubdomainKey]> = [
  ["/admin", "admin"],

  // Contractor portal: the entire cleaner journey lives here.
  // - /cleaner/onboarding, /cleaner/ob-portal, /ob-portal: application
  //   funnel (post-hiring-site hand-off from hiring.novaracleaning.com)
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
  // Tokenized recurring-plan self-service (link texted to the customer —
  // no login; the token in the URL is the credential).
  ["/manage-recurring", "app"],
  ["/update-password", "app"],
  ["/reset-password", "app"],
  ["/sms-consent", "app"],
  ["/auth", "app"],
  ["/membership/success", "app"],
  // Tip checkout return (Stripe redirects here; confirms + records the tip).
  ["/tip", "app"],
  // Tokenized tip-only invite (link texted/emailed to the customer — no login).
  ["/leave-tip", "try"],

  // Partner (Airbnb/STR host + commercial/office) portal — its own subdomain.
  // Owns the whole /partner/* tree, including its auth callback
  // (/partner/auth/callback). partners.* is an alias of partner.*.
  // Listed before the try.* marketing prefixes so it can never fall through.
  ["/partner", "partner"],

  // Public commercial / office / STR partnership intake funnel — no login.
  // Lead capture only (never prices); feeds the internal Partnerships Hub.
  //
  // /commercial-agreement is listed FIRST: ownerOf() matches on prefix
  // boundaries, so "/commercial-agreement" would not be caught by the
  // "/commercial" entry, but keeping them adjacent and ordered makes the
  // relationship obvious rather than incidental.
  //
  // Both tokenized commercial pages live here so a prospect only ever opens
  // one host: the proposal (review, accept or request changes — no signature,
  // no payment) and then the agreement itself (e-sign, then billing setup).
  ["/commercial-agreement", "commercial"],
  ["/proposal", "commercial"],
  // The consolidated onboarding session: one tokenized link carrying a
  // commercial client from pricing review through signature, billing and
  // portal creation. Lives beside /proposal and /commercial-agreement (which
  // it supersedes for new accounts) so a client only ever opens one host.
  ["/onboarding", "commercial"],
  ["/commercial", "commercial"],

  // Public marketing + booking funnel (try.*). /book/confirmation stays
  // on try so the entire Stripe-checkout-return flow keeps a single host.
  ["/book", "try"],
  ["/membership", "try"], // /membership and /membership/[planId] browse
  ["/checklist", "try"],  // /checklist and /checklist/[slug] public scope sheets
  ["/demo", "try"],
  ["/pricing-sheet", "try"],

  // Open before/after photo gallery (tokenized public link sent to
  // customers + partner hosts). Lives on the marketing host so a single
  // shareable URL works for everyone without a portal login.
  ["/photos", "try"],

  // Final-balance page (tokenized link sent after the clean). Shows what was
  // actually done — add-ons performed, any scope adjustment — then collects the
  // remaining balance. Sits next to /pay on try.* for the same reason: the link
  // has to work with no login.
  ["/pay-balance", "try"],

  // Custom deposit checkout for internal bookings (tokenized link sent to
  // the customer). Sign the service agreement → pay the deposit + save the
  // card. Lives on try.* so the link works without any login.
  ["/pay", "try"],

  // Membership sign-then-pay hosted page (tokenized link). Review + e-sign the
  // Membership / Recurring Service Agreement → the Stripe subscription pay link
  // unlocks. Lives on try.* so the link works without any login.
  ["/membership-pay", "try"],

  // Tokenized monthly ad spend log (no login). Lives on try.* so the emailed
  // link works the same way as /pay and /photos.
  ["/ad-spend", "try"],

  // VA end-of-day report (eod.novaracleaning.com). Signed-in VAs only —
  // identity comes from the session, never from the form.
  ["/eod", "eod"],

  // VA onboarding (team.novaracleaning.com): agreement signing + onboarding
  // form + pending status. Access provisioning happens only in the admin
  // workspace after approval.
  ["/team", "team"],

  // Public careers site (hiring.novaracleaning.com).
  ["/hiring", "hiring"],

  // Internal workspace guides (docs.novaracleaning.com). Admin/VA sign-in
  // required; the route itself enforces that before rendering anything.
  // /docs/auth and /docs/auth/callback stay under this prefix so they are
  // served on the docs host (where the session cookie has to live).
  ["/docs", "docs"],
];

const DEFAULT_LANDING: Record<SubdomainKey, string> = {
  admin: "/admin/auth",
  try: "/",
  app: "/auth",
  contractor: "/cleaner/auth",
  partner: "/partner",
  team: "/team",
  commercial: "/commercial",
  eod: "/eod",
  hiring: "/hiring",
  docs: "/docs",
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
//   docs.novaracleaning.com/docs/auth/callback           → workspace guides
//
// Docs cannot reuse the admin callback. Admin sessions live on
// admin.novaracleaning.com (and in localStorage). The guides are gated
// on cookies on docs.novaracleaning.com; a round-trip through admin
// sign-in can never unlock them.
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
  // pdf.js web worker (static asset) — must be SAME-ORIGIN on every
  // subdomain that renders PDFs (browsers refuse cross-origin workers,
  // so a 308 to try.* would break the in-page agreement viewer).
  "/pdf.worker.min.mjs",
  // Novara's own COI — commercial pages, admin Compliance, and emails all
  // link this same file. Host-agnostic so an admin on admin.* can open it
  // without a 308 to commercial.*.
  "/commercial/novara-certificate-of-insurance.pdf",
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
  // partners.* is an alias for the partner portal (check before "partner.").
  if (h.startsWith("partners.")) return "partner";
  if (h.startsWith("partner.")) return "partner";
  if (h.startsWith("commercial.")) return "commercial";
  if (h.startsWith("team.")) return "team";
  if (h.startsWith("eod.")) return "eod";
  if (h.startsWith("hiring.")) return "hiring";
  if (h.startsWith("docs.")) return "docs";
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

  // ─── docs.* is never indexed ─────────────────────────────────────────
  //
  // Handled before the global allowlist because /robots.txt is on that list,
  // and this host needs its own answer. The guides are already gated by an
  // admin sign-in; these two are defence in depth, so that a crawler which
  // somehow reached an authenticated response still has explicit
  // instructions not to keep it, and so a misconfigured page-level
  // `robots` export can't quietly re-expose the host.
  const isDocsHost = hostname.startsWith("docs.");
  if (isDocsHost && pathname === "/robots.txt") {
    return new NextResponse("User-agent: *\nDisallow: /\n", {
      status: 200,
      headers: {
        "content-type": "text/plain",
        "x-robots-tag": "noindex, nofollow",
      },
    });
  }
  if (isDocsHost) {
    response.headers.set("x-robots-tag", "noindex, nofollow, noarchive, noimageindex");
  }

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
