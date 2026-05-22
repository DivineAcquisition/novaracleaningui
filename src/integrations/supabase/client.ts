import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

// Default to the custom Supabase domain (api.novaracleaning.com) so a
// missing build-time env doesn't accidentally pin clients to the raw
// project subdomain. The original sxdraeptzuamsgjcvfeg.supabase.co host
// keeps working — Supabase serves both — this just makes the custom
// domain the canonical one for cookies + CORS.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://api.novaracleaning.com";
const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4ZHJhZXB0enVhbXNnamN2ZmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNzYzMzMsImV4cCI6MjA3NDk1MjMzM30.g7Ipg_qYJiC7uASufDsDqIMtRGPg_dJbSZClJCuAa5I";

// IMPORTANT: do NOT add custom global headers here.
//
// supabase-js attaches `global.headers` to EVERY fetch the client
// makes, including `supabase.functions.invoke(...)`. Any header that
// isn't already on the standard CORS allowlist (`authorization,
// x-client-info, apikey, content-type`) forces the browser to do a
// preflight that the Edge Function's OPTIONS handler must explicitly
// echo back in `Access-Control-Allow-Headers`. If the function doesn't,
// the browser silently blocks the actual POST after the OPTIONS 200,
// which is exactly the "OPTIONS 200 but no POST in the function logs"
// pattern we hit with cancel-booking, reschedule-booking, customer-
// portal, and finalize-booking. We previously sent
// `x-session-expiry: 259200` here and most Edge Functions did NOT
// list it on their Allow-Headers — every browser-initiated invoke
// was being dropped.
export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
});
