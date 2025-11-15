import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        // Get the session from the URL hash
        const { data: { session }, error } = await supabase.auth.getSession();

        if (error) {
          console.error("Auth callback error:", error);
          toast.error("Authentication failed. Please try again.");
          navigate("/auth");
          return;
        }

        if (!session) {
          toast.error("No session found. Please sign in again.");
          navigate("/auth");
          return;
        }

        // Check if this is a password recovery flow
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const type = hashParams.get('type');

        if (type === 'recovery') {
          // Password reset flow - redirect to update password
          navigate("/update-password");
        } else if (type === 'magiclink') {
          // Magic link authentication - check if it's cleaner onboarding
          const isCleanerOnboarding = session.user.user_metadata?.onboarding || 
                                       session.user.user_metadata?.is_cleaner;
          
          if (isCleanerOnboarding) {
            toast.success("Email verified! Complete your profile.");
            navigate("/cleaner/onboarding");
          } else {
            toast.success("Email verified successfully!");
            navigate("/account");
          }
        } else {
          // Email verification or other auth flow
          toast.success("Email verified successfully!");
          navigate("/account");
        }
      } catch (error) {
        console.error("Unexpected error in auth callback:", error);
        toast.error("Something went wrong. Please try again.");
        navigate("/auth");
      }
    };

    handleAuthCallback();
  }, [navigate]);

  return (
    <div className="min-h-screen bg-gradient-hero flex items-center justify-center">
      <div className="text-center space-y-4">
        <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto" />
        <p className="text-muted-foreground">Processing authentication...</p>
      </div>
    </div>
  );
}
