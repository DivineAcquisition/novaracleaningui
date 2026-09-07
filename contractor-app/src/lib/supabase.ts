import "react-native-url-polyfill/auto";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import Constants from "expo-constants";

// Same Supabase project the web app and edge functions already use — this app
// is a second client on the existing backend, not a new one. The anon key is
// publishable by design; every table is behind RLS.
const extra = (Constants.expoConfig?.extra ?? {}) as {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? extra.supabaseUrl;
// `eas integrations:supabase:connect` writes EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.
// Keep the anon-key name too so existing .env / EAS profiles keep working.
const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  extra.supabaseAnonKey;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Supabase config missing. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY, or expo.extra in app.json.",
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // AsyncStorage rather than localStorage: there is no browser storage in a
    // bare React Native runtime, and without this the session is lost on every
    // cold start.
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // No URL to parse on native; leaving this on makes auth hang on boot.
    detectSessionInUrl: false,
  },
});
