import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

interface OAuthCodeHandlerProps {
  children: React.ReactNode;
}

/**
 * This component handles OAuth redirect codes that arrive on any page.
 * When Supabase OAuth redirects back with a ?code= parameter, this component
 * intercepts it, exchanges the code for a session, and redirects appropriately.
 */
export function OAuthCodeHandler({ children }: OAuthCodeHandlerProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    const handleOAuthCode = async () => {
      const params = new URLSearchParams(location.search);
      const code = params.get("code");
      const error = params.get("error");
      const errorDescription = params.get("error_description");

      // If there's an error from OAuth
      if (error) {
        console.error("[OAUTH] Error from provider:", error, errorDescription);
        navigate("/cleaner/auth?error=" + encodeURIComponent(errorDescription || error));
        return;
      }

      // If there's no code, nothing to do
      if (!code) {
        return;
      }

      console.log("[OAUTH] Detected OAuth code, processing...");
      setIsProcessing(true);

      try {
        // Exchange the code for a session
        const { data, error: sessionError } = await supabase.auth.exchangeCodeForSession(code);

        if (sessionError) {
          console.error("[OAUTH] Error exchanging code:", sessionError);
          navigate("/cleaner/auth?error=" + encodeURIComponent(sessionError.message));
          return;
        }

        if (!data.session) {
          console.error("[OAUTH] No session returned");
          navigate("/cleaner/auth?error=no_session");
          return;
        }

        console.log("[OAUTH] Session established:", {
          userId: data.session.user.id,
          email: data.session.user.email,
        });

        // Check if user is a cleaner
        const userMetadata = data.session.user.user_metadata || {};
        const isCleaner = userMetadata.is_cleaner || userMetadata.onboarding;

        // Check for cleaner profile
        const { data: cleanerData } = await supabase
          .from("cleaners")
          .select("id, onboarding_complete, payouts_enabled")
          .or(`user_id.eq.${data.session.user.id},email.eq.${data.session.user.email}`)
          .maybeSingle();

        console.log("[OAUTH] Cleaner check:", { isCleaner, cleanerData });

        if (cleanerData) {
          // User is a cleaner - update user_id if needed
          if (!cleanerData.onboarding_complete) {
            console.log("[OAUTH] Redirecting to cleaner onboarding");
            navigate("/cleaner/onboarding");
          } else if (!cleanerData.payouts_enabled) {
            console.log("[OAUTH] Redirecting to dashboard with Stripe pending");
            navigate("/cleaner/dashboard?stripe=pending");
          } else {
            console.log("[OAUTH] Redirecting to cleaner dashboard");
            navigate("/cleaner/dashboard");
          }
          return;
        }

        if (isCleaner) {
          // User has cleaner metadata but no profile - go to onboarding
          console.log("[OAUTH] Cleaner metadata found, redirecting to onboarding");
          navigate("/cleaner/onboarding");
          return;
        }

        // Check if this looks like a contractor domain
        const hostname = window.location.hostname;
        if (hostname.includes("contractor")) {
          // Assume they want to be a cleaner
          console.log("[OAUTH] On contractor domain, redirecting to onboarding");
          navigate("/cleaner/onboarding");
          return;
        }

        // Default: regular customer
        console.log("[OAUTH] Regular customer, redirecting to account");
        navigate("/account");

      } catch (err) {
        console.error("[OAUTH] Unexpected error:", err);
        navigate("/cleaner/auth?error=unexpected_error");
      } finally {
        setIsProcessing(false);
      }
    };

    handleOAuthCode();
  }, [location.search, navigate]);

  // Show loading state while processing OAuth code
  if (isProcessing) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#5500FF]/5 via-background to-[#8F7BFD]/10 flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="w-12 h-12 animate-spin text-[#5500FF] mx-auto" />
          <p className="text-muted-foreground">Completing sign in...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
