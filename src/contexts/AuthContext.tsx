"use client";

import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

interface SubscriptionData {
  subscribed: boolean;
  hasCustomer: boolean;
  product_id?: string;
  subscription_end?: string;
  subscription_status?: string;
  plan_name?: string;
  has_payment_method?: boolean;
  customer_id?: string;
  subscription_id?: string;
  is_paused?: boolean;
  resumes_at?: string;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  subscription: SubscriptionData | null;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signUp: (email: string, password: string) => Promise<{ data: any; error: any }>;
  signInWithGoogle: (redirectPath?: string) => Promise<void>;
  signOut: () => Promise<void>;
  checkSubscription: () => Promise<void>;
  openCustomerPortal: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: any }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null);

  const checkSubscription = async () => {
    if (!session) {
      setSubscription(null);
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke('check-subscription');
      
      if (error) {
        console.error('Subscription check error:', error);
        return;
      }

      setSubscription(data);
    } catch (error) {
      console.error('Subscription check failed:', error);
    }
  };

  const openCustomerPortal = async () => {
    // Cross-browser popup-blocker workaround. Safari + several Chrome
    // configurations refuse to honor `window.open(url, '_blank')` when
    // it's called AFTER an `await` because the call is no longer
    // considered "user-initiated". We work around it by opening a
    // placeholder tab synchronously inside the click handler and then
    // rewriting its location once the Edge Function returns. If the
    // browser refuses to open the placeholder (popup-blocked entirely)
    // we fall back to a same-tab redirect so the customer still lands
    // in the Stripe Billing Portal.
    const placeholder = typeof window !== 'undefined' ? window.open('', '_blank') : null;
    try {
      const { data, error } = await supabase.functions.invoke('customer-portal');
      if (error) throw error;
      const url = data?.url as string | undefined;
      if (!url) throw new Error('No portal URL returned from customer-portal');

      if (placeholder && !placeholder.closed) {
        placeholder.location.href = url;
      } else {
        // Popup was blocked or we're on a runtime without window.open
        // — fall back to same-tab redirect so the customer is never
        // stranded on a click that did nothing.
        window.location.href = url;
      }
    } catch (error: any) {
      console.error('Customer portal error:', error);
      // Clean up the empty popup so the user isn't left with a blank tab
      if (placeholder && !placeholder.closed) {
        try { placeholder.close(); } catch (_) { /* ignore */ }
      }
      throw error;
    }
  };

  useEffect(() => {
    // Set up auth state listener
    const { data: { subscription: authSubscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        console.log('Auth state changed:', event);
        setSession(session);
        setUser(session?.user ?? null);
        
        // Check subscription when user logs in
        if (session?.user && event === 'SIGNED_IN') {
          setTimeout(() => {
            checkSubscription();
          }, 0);
        }
      }
    );

    // Check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      if (session?.user) {
        setTimeout(() => {
          checkSubscription();
        }, 0);
      }
    });

    return () => authSubscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error };
  };

  const signUp = async (email: string, password: string) => {
    // Route every signup through our `send-auth-email` edge function so
    // (a) the user gets a branded green-themed Novara email (Supabase's
    // default mailer is rate-limited and unbranded) and (b) the function
    // uses admin.generateLink({type:'signup'}) which both creates the
    // user AND returns the confirmation link in one call — no second
    // round-trip to Supabase's default SMTP. The function never reveals
    // whether the email exists (returns {ok:true} regardless) so the UI
    // simply shows "check your email" either way.
    try {
      const { error } = await supabase.functions.invoke("send-auth-email", {
        body: { kind: "signup_customer", email, password },
      });
      if (error) {
        return { data: null, error: { message: error.message || "Failed to start signup" } as any };
      }
      return { data: { user: null, session: null }, error: null };
    } catch (e) {
      return { data: null, error: { message: (e as Error).message } as any };
    }
  };

  // Per-portal Google OAuth. Each portal MUST pass its own callback path
  // (`/auth/callback` for customer, `/admin/auth/callback` for admin,
  //  `/cleaner/auth/callback` for cleaner) so a Google sign-in started
  //  on one subdomain can NEVER land on another portal's dashboard.
  //  The default '/auth/callback' is the customer fallback — the admin
  //  and cleaner views always pass their explicit path.
  const signInWithGoogle = async (redirectPath: string = "/auth/callback") => {
    const safePath = redirectPath.startsWith("/") ? redirectPath : `/${redirectPath}`;
    const redirectUrl = `${window.location.origin}${safePath}`;
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: redirectUrl,
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    });
  };

  const resetPassword = async (email: string) => {
    // Bypass Supabase Auth's default mailer entirely and send the recovery
    // link through our own `send-auth-email` edge function. That function
    // (a) generates the recovery link via admin.generateLink, (b) renders
    // a brand-styled green email matching the rest of our transactional
    // mail, and (c) returns {ok:true} regardless of whether the email is
    // on file (no enumeration). The redirect URL is pinned to
    // app.novaracleaning.com/update-password by the edge function.
    try {
      const { error } = await supabase.functions.invoke("send-auth-email", {
        body: { kind: "password_reset_customer", email },
      });
      if (error) return { error: { message: error.message || "Failed to send reset email" } as any };
      return { error: null };
    } catch (e) {
      return { error: { message: (e as Error).message } as any };
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setSubscription(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        subscription,
        signIn,
        signUp,
        signInWithGoogle,
        signOut,
        checkSubscription,
        openCustomerPortal,
        resetPassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
