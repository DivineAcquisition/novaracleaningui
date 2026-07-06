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
      // FIRST so it becomes the active session on this device.
      const tokenHash = searchParams?.get("token_hash");
      if (tokenHash) {
        setStatus("Opening contractor account...");
        const { error: otpError } = await supabase.auth.verifyOtp({
          type: "email",
          token_hash: tokenHash,
        });
        if (otpError) {
          console.error("token_hash verify error:", otpError);
          toast.error(`Sign-in link invalid or expired: ${otpError.message}`);
          router.replace("/cleaner/auth");
          return;
        }
        if (searchParams?.get("impersonated") === "1") {
          toast.success("Signed in as this contractor (admin session — actions are logged).");
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
