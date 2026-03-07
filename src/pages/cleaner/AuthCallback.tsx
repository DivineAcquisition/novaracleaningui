import {
  RiLoader4Line
} from "@remixicon/react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

import { toast } from "sonner";
import { SEO } from "@/components/SEO";

/**
 * Handles OAuth callback specifically for cleaner/contractor authentication.
 * After Google sign-in, this checks for cleaner profile and routes appropriately.
 */
export default function CleanerAuthCallback() {
  const navigate = useNavigate();
  const [status, setStatus] = useState("Verifying authentication...");

  useEffect(() => {
    handleCallback();
  }, []);

  const handleCallback = async () => {
    try {
      // Get the session from the URL hash (OAuth redirect)
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();

      if (sessionError) {
        console.error("Session error:", sessionError);
        toast.error("Authentication failed. Please try again.");
        navigate("/cleaner/auth", { replace: true });
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
          navigate("/cleaner/auth", { replace: true });
          return;
        }
        
        await processUser(retrySession.user.id);
      } else {
        await processUser(session.user.id);
      }
    } catch (error) {
      console.error("Callback error:", error);
      toast.error("Something went wrong. Please try again.");
      navigate("/cleaner/auth", { replace: true });
    }
  };

  const processUser = async (userId: string) => {
    setStatus("Checking cleaner profile...");

    try {
      // Check if user has a cleaner profile
      const { data: cleaner, error } = await supabase
        .from("cleaners")
        .select("id, onboarding_complete, first_name")
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        console.error("Error checking cleaner profile:", error);
        // Continue to onboarding even if check fails
      }

      if (cleaner) {
        // Has cleaner profile
        if (cleaner.onboarding_complete) {
          toast.success(`Welcome back${cleaner.first_name ? `, ${cleaner.first_name}` : ''}!`);
          navigate("/cleaner/dashboard", { replace: true });
        } else {
          toast.info("Please complete your profile to continue.");
          navigate("/cleaner/onboarding", { replace: true });
        }
      } else {
        // No cleaner profile - redirect to onboarding to create one
        toast.success("Account connected! Complete your profile to get started.");
        navigate("/cleaner/onboarding", { replace: true });
      }
    } catch (error) {
      console.error("Process user error:", error);
      // Default to onboarding if anything fails
      navigate("/cleaner/onboarding", { replace: true });
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
