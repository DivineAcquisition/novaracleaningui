import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const hostname = request.headers.get("host") || "";
  const pathname = request.nextUrl.pathname;

  // Domain detection
  const isAdminDomain = hostname.includes("admin.novaracleaning.com") || hostname.includes("admin.localhost");
  const isTryDomain = hostname.includes("try.novaracleaning.com") || hostname.includes("try.localhost");
  const isAppDomain = hostname.includes("app.novaracleaning.com") || hostname.includes("app.localhost");

  // Create response for cookie handling
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  // Create Supabase client
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: any) {
          response.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  const {
    data: { session },
  } = await supabase.auth.getSession();

  // ============================================
  // ADMIN DOMAIN: Internal dashboard (requires admin role)
  // ============================================
  if (isAdminDomain) {
    // Allow auth routes without session
    if (
      pathname.startsWith("/admin/login") ||
      pathname.startsWith("/admin/auth") ||
      pathname === "/admin/unauthorized"
    ) {
      return response;
    }

    // Check if accessing admin routes
    if (pathname.startsWith("/admin")) {
      // Require authentication
      if (!session) {
        const loginUrl = new URL("/admin/login", request.url);
        loginUrl.searchParams.set("redirect", pathname);
        return NextResponse.redirect(loginUrl);
      }

      // Verify admin role
      const { data: hasAdminRole } = await supabase.rpc("has_role", {
        _user_id: session.user.id,
        _role: "admin",
      });

      if (!hasAdminRole) {
        return NextResponse.redirect(new URL("/admin/unauthorized", request.url));
      }
    }

    // Rewrite root to admin
    if (pathname === "/") {
      return NextResponse.rewrite(new URL("/admin", request.url));
    }

    // Rewrite all paths to admin routes
    if (!pathname.startsWith("/admin") && !pathname.startsWith("/_next") && !pathname.startsWith("/api")) {
      return NextResponse.rewrite(new URL(`/admin${pathname}`, request.url));
    }

    return response;
  }

  // ============================================
  // TRY DOMAIN: New customer acquisition (no auth required)
  // ============================================
  if (isTryDomain) {
    // Rewrite root to try
    if (pathname === "/") {
      return NextResponse.rewrite(new URL("/try", request.url));
    }

    // Rewrite all paths to try routes
    if (!pathname.startsWith("/try") && !pathname.startsWith("/_next") && !pathname.startsWith("/api")) {
      return NextResponse.rewrite(new URL(`/try${pathname}`, request.url));
    }

    return response;
  }

  // ============================================
  // APP DOMAIN: Customer portal (requires auth)
  // ============================================
  if (isAppDomain) {
    // Allow auth routes without session
    if (
      pathname.startsWith("/customer/login") ||
      pathname.startsWith("/customer/signup") ||
      pathname.startsWith("/customer/reset-password") ||
      pathname.startsWith("/customer/auth") ||
      pathname.startsWith("/customer/update-password")
    ) {
      return response;
    }

    // Check if accessing customer routes
    if (pathname.startsWith("/customer")) {
      // Require authentication for all other routes
      if (!session) {
        const loginUrl = new URL("/customer/login", request.url);
        loginUrl.searchParams.set("redirect", pathname);
        return NextResponse.redirect(loginUrl);
      }
    }

    // Rewrite root to customer dashboard
    if (pathname === "/") {
      return NextResponse.rewrite(new URL("/customer", request.url));
    }

    // Rewrite all paths to customer routes
    if (!pathname.startsWith("/customer") && !pathname.startsWith("/_next") && !pathname.startsWith("/api")) {
      return NextResponse.rewrite(new URL(`/customer${pathname}`, request.url));
    }

    return response;
  }

  // Default: Allow access to main domain
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
