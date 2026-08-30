"use client";

// Cookie-backed client for the workspace guides.
//
// The rest of the product signs in with src/integrations/supabase/client.ts,
// which stores the session in localStorage. That is enough for client-gated
// portals (admin, cleaner, customer) but not for these guides: getDocsAccess()
// reads cookies on the server, before any HTML is sent. A localStorage session
// on docs.novaracleaning.com would still look signed-out to the gate.
//
// Cookies are host-only (no Domain=.novaracleaning.com). An admin session
// must not leak onto try / app / contractor / partner, and a docs session
// must not leak onto those hosts either.

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/integrations/supabase/types";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/integrations/supabase/public-env";

export function createDocsBrowserClient() {
  return createBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookieOptions: {
      path: "/",
      sameSite: "lax",
    },
  });
}
