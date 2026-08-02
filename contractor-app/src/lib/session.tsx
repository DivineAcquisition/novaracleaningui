// Session + resolved-cleaner context. Everything gated behind sign-in reads
// the cleaner from here so we resolve (and email-link) the cleaner row once
// per session rather than on every screen.

import { Session } from "@supabase/supabase-js";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { ResolvedCleaner, resolveCleanerAuth } from "./cleaner-auth";
import { registerForPush } from "./push";
import { supabase } from "./supabase";

interface SessionState {
  loading: boolean;
  session: Session | null;
  cleaner: ResolvedCleaner | null;
  /** True while a session exists but no cleaner row is linked to it yet. */
  needsOnboarding: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionState | undefined>(undefined);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [cleaner, setCleaner] = useState<ResolvedCleaner | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  const resolve = useCallback(async () => {
    const result = await resolveCleanerAuth();
    setCleaner(result.cleaner);
    setNeedsOnboarding(result.routing === "onboarding");
    return result;
  }, []);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      if (data.session) await resolve();
      if (active) setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, next) => {
      if (!active) return;
      setSession(next);
      if (next) {
        await resolve();
      } else {
        setCleaner(null);
        setNeedsOnboarding(false);
      }
      if (active) setLoading(false);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [resolve]);

  // Register for push once we know who the cleaner is. Failures are logged
  // inside registerForPush and must never block the app.
  useEffect(() => {
    if (!session?.user?.id) return;
    void registerForPush(session.user.id, cleaner?.id ?? null);
  }, [session?.user?.id, cleaner?.id]);

  const value = useMemo<SessionState>(
    () => ({
      loading,
      session,
      cleaner,
      needsOnboarding,
      refresh: async () => {
        await resolve();
      },
      signOut: async () => {
        await supabase.auth.signOut();
      },
    }),
    [loading, session, cleaner, needsOnboarding, resolve],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}
