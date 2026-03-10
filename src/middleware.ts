import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/integrations/supabase/middleware';

export async function middleware(request: NextRequest) {
  const response = await updateSession(request);
  const hostname = request.headers.get('host') || '';
  const pathname = request.nextUrl.pathname;

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
