import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './public-env';

const SUPABASE_PUBLISHABLE_KEY = SUPABASE_ANON_KEY;

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
