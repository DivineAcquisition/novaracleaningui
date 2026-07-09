"use client";

import {
  RiLoader4Line
} from "@remixicon/react";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/integrations/supabase/client";

import { toast } from "sonner";
import { SEO } from "@/components/SEO";
import { resolveCleanerAuth } from "@/lib/cleaner-auth";

/**
 * Handles OAuth callback specifically for cleaner/contractor authentication.
 * After Google sign-in, this checks for cleaner profile and routes appropriately.
 *
 * Also handles admin impersonation deep links:
 * `?token_hash=<hashed_token>&impersonated=1` — the admin-impersonate-cleaner
 * function mints a magic-link token_hash and we verify it here directly, so
 * the flow never depends on the Supabase redirect allow-list.
 */
export default function CleanerAuthCallback() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState("Verifying authentication...");

  useEffect(() => {
    handleCallback();
  }, []);

  const handleCallback = async () => {
    try {
      // Admin impersonation / emailed magic-link token_hash: verify it
      // FIRST so it becomes the active session on this device. GoTrue
      // accepts "magiclink" tokens under type "email" on current versions
      // but older stacks require the literal "magiclink" type — try both
      // so the admin log-in-as-contractor link never dead-ends.
      const tokenHash = searchParams?.get("token_hash");
      if (tokenHash) {
        setStatus("Opening contractor account...");
        let otpError: { message: string } | null = null;
        for (const type of ["email", "magiclink"] as const) {
          const { error } = await supabase.auth.verifyOtp({
            // deno-lint-ignore no-explicit-any
            type: type as any,
            token_hash: tokenHash,
          });
          otpError = error;
          if (!error) break;
        }
        if (otpError) {
          // The token may have already been consumed (e.g. link prefetch or
          // a double navigation) — if a session exists anyway, keep going.
          const { data: { session: existing } } = await supabase.auth.getSession();
          if (!existing?.user) {
            console.error("token_hash verify error:", otpError);
            toast.error(`Sign-in link invalid or expired: ${otpError.message}`);
            router.replace("/cleaner/auth");
            return;
          }
        }
        if (searchParams?.get("impersonated") === "1") {
          toast.success("Signed in as this contractor (admin session — actions are logged).");
        }
        await processUser();
        return;
      }

      // Hosted magic-link fallback (?code=) — exchange the PKCE code for a
      // session when Supabase redirected here instead of a token_hash link.
      const code = searchParams?.get("code");
      if (code) {
        setStatus("Opening contractor account...");
        const { error: codeError } = await supabase.auth.exchangeCodeForSession(code);
        if (codeError) {
          console.error("code exchange error:", codeError);
          toast.error(`Sign-in link invalid or expired: ${codeError.message}`);
          router.replace("/cleaner/auth");
          return;
        }
        await processUser();
        return;
      }

      // Get the session from the URL hash (OAuth redirect)
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();

      if (sessionError) {
        console.error("Session error:", sessionError);
        toast.error("Authentication failed. Please try again.");
        router.replace("/cleaner/auth");
        return;
      }

      if (!session?.user) {
        // No session - might still be processing, wait a bit
        setStatus("Processing authentication...");
        
        // Wait for auth state to settle
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const { data: { session: retrySession } } = await supabase.auth.getSession();
        
        if (!retrySession?.user) {
          toast.error("Authentication failed. Please try again.");
          router.replace("/cleaner/auth");
          return;
        }
        
        await processUser();
      } else {
        await processUser();
      }
    } catch (error) {
      console.error("Callback error:", error);
      toast.error("Something went wrong. Please try again.");
      router.replace("/cleaner/auth");
    }
  };

  const processUser = async () => {
    setStatus("Checking cleaner profile...");

    try {
      // resolveCleanerAuth() centralizes the user_id lookup, the email
      // fallback that links pre-existing cleaner rows to the new auth
      // user, and the onboarding_complete auto-promote — so cleaners
      // who already filled the wizard in a previous session don't get
      // looped back to /cleaner/onboarding.
      const { cleaner, routing } = await resolveCleanerAuth();

      if (routing === "auth") {
        router.replace("/cleaner/auth");
        return;
      }

      if (routing === "dashboard") {
        toast.success(`Welcome back${cleaner?.first_name ? `, ${cleaner.first_name}` : ""}!`);
        router.replace("/cleaner/dashboard");
        return;
      }

      // routing === "onboarding"
      if (cleaner) {
        toast.info("Please complete your profile to continue.");
      } else {
        toast.success("Account connected! Complete your profile to get started.");
      }
      router.replace("/cleaner/onboarding");
    } catch (error) {
      console.error("Process user error:", error);
      router.replace("/cleaner/onboarding");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-hero flex items-center justify-center">
      <SEO title="Authenticating..." noindex />
      <div className="text-center space-y-4">
        <RiLoader4Line className="w-12 h-12 animate-spin text-primary mx-auto" />
        <p className="text-muted-foreground">{status}</p>
      </div>
    </div>
  );
}
