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
