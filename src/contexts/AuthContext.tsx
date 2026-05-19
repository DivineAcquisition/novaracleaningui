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
  signInWithGoogle: () => Promise<void>;
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
    const redirectUrl = `${window.location.origin}/auth/callback`;
    
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
      },
    });
    return { data, error };
  };

  const signInWithGoogle = async () => {
    const redirectUrl = `${window.location.origin}/auth/callback`;
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUrl,
      },
    });
  };

  const resetPassword = async (email: string) => {
    // ALWAYS send the password-reset link to the app subdomain. If we
    // used `window.location.origin` blindly the link would point back
    // at try.novaracleaning.com whenever the customer initiated the
    // reset from the marketing host — which the middleware then
    // bounces and the supabase auth callback fails because the URL
    // they verify the recovery token at must match the redirect URL
    // Supabase signed into the email. Pinning it to app.* removes that
    // whole class of "password reset doesn't work" failures.
    const APP_ORIGIN = 'https://app.novaracleaning.com';
    const isLocalhost = typeof window !== 'undefined' && /^(localhost|127\.|::1)/.test(window.location.hostname);
    const redirectTo = isLocalhost
      ? `${window.location.origin}/update-password`
      : `${APP_ORIGIN}/update-password`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });
    return { error };
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
