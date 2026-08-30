import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import type { Database } from "@/integrations/supabase/types";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/integrations/supabase/public-env";

type PendingCookie = { name: string; value: string; options: CookieOptions };

/**
 * Route-handler client that buffers Set-Cookie onto the redirect response.
 * NextResponse.redirect() does not automatically pick up cookies().set()
 * from next/headers, so a successful OAuth exchange would otherwise lose
 * the session before the browser landed on /docs.
 */
export function createDocsRouteClient(request: NextRequest) {
  const pending: PendingCookie[] = [];

  const supabase = createServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          pending.push({ name, value, options });
        });
      },
    },
  });

  const redirect = (path: string, status: 303 | 307 = 307) => {
    const res = NextResponse.redirect(new URL(path, request.nextUrl.origin), status);
    for (const { name, value, options } of pending) {
      res.cookies.set(name, value, options);
    }
    return res;
  };

  return { supabase, redirect };
}
