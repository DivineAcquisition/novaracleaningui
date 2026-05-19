import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/integrations/supabase/middleware';

// Paths on the hiring.* subdomain that we want to leave alone. Everything
// else gets rewritten to the cleaner onboarding flow so the hiring
// subdomain never accidentally exposes the customer booking funnel.
const HIRING_ALLOWED_PREFIXES = [
  '/cleaner',
  '/auth/callback',          // Supabase magic-link callback
  '/api',
  '/_next',
  '/favicon',
];

// Customer-portal paths. Authenticated UI that should ONLY be served
// from the app.* subdomain. If a customer hits one of these on try.*
// (the booking funnel) or the apex domain, we 308-redirect them to the
// same path on app.novaracleaning.com so deep links from emails / SMS
// always land in the portal — never the marketing/booking host.
const PORTAL_PATH_PREFIXES = [
  '/account',
  '/portal',
  '/manage-booking',
  '/membership',         // membership success / detail post-auth
  '/auth',               // sign-in must always be on app.*
  '/update-password',
  '/reset-password',
  '/sms-consent',
];

const APP_HOST = 'app.novaracleaning.com';

const isPortalPath = (pathname: string) =>
  PORTAL_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

export async function middleware(request: NextRequest) {
  const response = await updateSession(request);
  const hostname = (request.headers.get('host') || '').toLowerCase();
  const pathname = request.nextUrl.pathname;

  // ─── Hiring subdomain — cleaner-only microsite ──────────────────────
  // hiring.novaracleaning.com (and any *.hiring. variant) must only
  // surface the cleaner application / onboarding pages. Anything else
  // (the customer landing page, /book/*, /membership, /account, …) is
  // rewritten to /cleaner/onboarding so the URL stays branded but the
  // content is always the hiring funnel.
  if (hostname.startsWith('hiring.')) {
    const allowed = HIRING_ALLOWED_PREFIXES.some((p) => pathname.startsWith(p));
    if (!allowed) {
      const url = request.nextUrl.clone();
      url.pathname = '/cleaner/onboarding';
      return NextResponse.rewrite(url);
    }
    return response;
  }

  // ─── Customer-portal subdomain guard ────────────────────────────────
  // Customer portal (/account, /portal, /manage-booking, billing portal
  // returns, auth screens, password resets) must live on app.* only.
  // try.novaracleaning.com is the public booking funnel — if a customer
  // lands there on a portal path (typically from a stale email or hand-
  // edited URL), promote them to the app subdomain instead of serving a
  // half-broken auth flow on the marketing host.
  //
  // Skip on localhost / preview hosts so dev still works on a single
  // origin, and skip the cleaner + admin subdomains since they have
  // their own portal hosts.
  const isProdHost =
    hostname.endsWith('.novaracleaning.com') ||
    hostname === 'novaracleaning.com';
  const isPortalHost =
    hostname === APP_HOST ||
    hostname.startsWith('admin.') ||
    hostname.startsWith('contractor.') ||
    hostname.startsWith('hiring.');
  if (isProdHost && !isPortalHost && isPortalPath(pathname)) {
    const url = request.nextUrl.clone();
    url.protocol = 'https:';
    url.host = APP_HOST;
    return NextResponse.redirect(url, 308);
  }

  if (pathname === '/') {
    if (hostname.startsWith('app.')) {
      const url = request.nextUrl.clone();
      url.pathname = '/auth';
      return NextResponse.redirect(url);
    }
    if (hostname.startsWith('admin.')) {
      const url = request.nextUrl.clone();
      url.pathname = '/admin/auth';
      return NextResponse.redirect(url);
    }
    if (hostname.startsWith('contractor.')) {
      const url = request.nextUrl.clone();
      url.pathname = '/cleaner/auth';
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
