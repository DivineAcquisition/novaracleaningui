// Service-role Supabase client for server-side Airtable sync (route + scripts).
//
// SERVER ONLY. Requires SUPABASE_SERVICE_ROLE_KEY — never import this from
// client components. The service role bypasses RLS so we can read every row
// needed to build a complete Airtable record.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function getAdminSupabase(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY for the Airtable sync (server-side only).",
    );
  }
  cached = createClient(url, key, {
    auth: { persistSession: false },
    global: {
      // Next 14 patches global fetch and CACHES GET requests in the Data
      // Cache — which persists across deployments on Vercel. Without
      // no-store, service-role READS (app_secrets, bookings, …) can return
      // stale rows indefinitely. Live data must never be cached.
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  });
  return cached;
}
