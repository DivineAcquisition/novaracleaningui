import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export default function AuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        console.log("[AUTH CALLBACK] Starting auth callback processing");
        
        // Get the session from the URL hash
        const { data: { session }, error } = await supabase.auth.getSession();

        if (error) {
          console.error("[AUTH CALLBACK] Session error:", error);
          toast.error("Authentication failed. Please try again.");
          navigate("/auth");
          return;
        }

        if (!session) {
          console.log("[AUTH CALLBACK] No session found");
          toast.error("No session found. Please sign in again.");
          navigate("/auth");
          return;
        }

        console.log("[AUTH CALLBACK] Session found:", {
          userId: session.user.id,
          email: session.user.email,
          provider: session.user.app_metadata?.provider,
        });

        // Check URL params for type indicator
        const typeParam = searchParams.get('type');
        
        // Check hash params for recovery type
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const hashType = hashParams.get('type');
        
        // Check user metadata for cleaner indicators
        const userMetadata = session.user.user_metadata || {};
        const isCleaner = userMetadata.is_cleaner || userMetadata.onboarding;
        const provider = session.user.app_metadata?.provider;

        console.log("[AUTH CALLBACK] Auth type info:", {
          typeParam,
          hashType,
          isCleaner,
          provider,
        });

        // Handle password recovery
        if (hashType === 'recovery') {
          console.log("[AUTH CALLBACK] Password recovery flow");
          navigate("/update-password");
          return;
        }

        // Handle cleaner signup (from email verification link)
        if (typeParam === 'cleaner_signup' || typeParam === 'cleaner') {
          console.log("[AUTH CALLBACK] Cleaner signup/login flow detected via URL param");
          await handleCleanerRouting(session);
          return;
        }

        // Handle cleaner detected from user metadata
        if (isCleaner) {
          console.log("[AUTH CALLBACK] Cleaner detected via user metadata");
          await handleCleanerRouting(session);
          return;
        }

        // Handle Google OAuth - check if user has cleaner profile
        if (provider === 'google') {
          console.log("[AUTH CALLBACK] Google OAuth flow");
          
          // First check if user has a cleaner profile by email
          const { data: cleanerData } = await supabase
            .from('cleaners')
            .select('id, onboarding_complete, payouts_enabled')
            .eq('email', session.user.email)
            .maybeSingle();

          if (cleanerData) {
            console.log("[AUTH CALLBACK] User is a cleaner:", cleanerData);
            await handleCleanerRouting(session, cleanerData);
            return;
          }

          // Check if cleaner profile exists by user_id
          const { data: cleanerByUserId } = await supabase
            .from('cleaners')
            .select('id, onboarding_complete, payouts_enabled')
            .eq('user_id', session.user.id)
            .maybeSingle();

          if (cleanerByUserId) {
            console.log("[AUTH CALLBACK] User is a cleaner (by user_id):", cleanerByUserId);
            await handleCleanerRouting(session, cleanerByUserId);
            return;
          }

          // Regular customer - create customer record if needed
          console.log("[AUTH CALLBACK] Regular customer flow");
          const { data: customerData } = await supabase
            .from('customers')
            .select('id')
            .eq('email', session.user.email)
            .maybeSingle();

          if (!customerData) {
            await supabase.from('customers').insert({
              email: session.user.email || '',
              first_name: session.user.user_metadata?.full_name?.split(' ')[0] || '',
              last_name: session.user.user_metadata?.full_name?.split(' ').slice(1).join(' ') || '',
            });
          }

          toast.success("Welcome!");
          navigate("/account");
          return;
        }

        // Handle magic link for cleaners
        if (hashType === 'magiclink') {
          if (isCleaner) {
            console.log("[AUTH CALLBACK] Cleaner magic link flow");
            await handleCleanerRouting(session);
            return;
          }
          
          toast.success("Email verified successfully!");
          navigate("/account");
          return;
        }

        // Handle email signup verification
        if (hashType === 'signup') {
          if (isCleaner) {
            console.log("[AUTH CALLBACK] Cleaner email verification flow");
            toast.success("Email verified! Complete your profile.");
            navigate("/cleaner/onboarding");
            return;
          }
          
          toast.success("Email verified successfully!");
          navigate("/account");
          return;
        }

        // Default: check if cleaner exists for this user
        const { data: existingCleaner } = await supabase
          .from('cleaners')
          .select('id, onboarding_complete, payouts_enabled')
          .or(`user_id.eq.${session.user.id},email.eq.${session.user.email}`)
          .maybeSingle();

        if (existingCleaner) {
          console.log("[AUTH CALLBACK] Found existing cleaner profile");
          await handleCleanerRouting(session, existingCleaner);
          return;
        }

        // Default fallback for regular customers
        console.log("[AUTH CALLBACK] Default customer fallback");
        toast.success("Welcome!");
        navigate("/account");

      } catch (error) {
        console.error("[AUTH CALLBACK] Unexpected error:", error);
        toast.error("Something went wrong. Please try again.");
        navigate("/auth");
      }
    };

    // Helper function to handle cleaner routing based on profile status
    const handleCleanerRouting = async (
      session: any, 
      cleanerData?: { id: string; onboarding_complete: boolean; payouts_enabled: boolean } | null
    ) => {
      // If we don't have cleaner data, try to fetch it
      if (!cleanerData) {
        const { data } = await supabase
          .from('cleaners')
          .select('id, onboarding_complete, payouts_enabled')
          .or(`user_id.eq.${session.user.id},email.eq.${session.user.email}`)
          .maybeSingle();
        cleanerData = data;
      }

      if (!cleanerData) {
        // No cleaner profile exists - go to onboarding
        console.log("[AUTH CALLBACK] No cleaner profile - redirecting to onboarding");
        toast.success("Welcome! Complete your profile to get started.");
        navigate("/cleaner/onboarding");
        return;
      }

      // Update user_id if not set (for cleaners created via admin)
      if (cleanerData.id) {
        await supabase
          .from('cleaners')
          .update({ user_id: session.user.id })
          .eq('id', cleanerData.id)
          .is('user_id', null);
      }

      if (!cleanerData.onboarding_complete) {
        // Profile exists but onboarding incomplete
        console.log("[AUTH CALLBACK] Cleaner onboarding incomplete");
        toast.success("Welcome back! Please complete your profile.");
        navigate("/cleaner/onboarding");
        return;
      }

      if (!cleanerData.payouts_enabled) {
        // Profile complete but Stripe not set up
        console.log("[AUTH CALLBACK] Cleaner needs Stripe setup");
        toast.success("Welcome back! Please complete your payment setup.");
        navigate("/cleaner/dashboard?stripe=pending");
        return;
      }

      // Fully onboarded cleaner
      console.log("[AUTH CALLBACK] Cleaner fully onboarded");
      toast.success("Welcome back!");
      navigate("/cleaner/dashboard");
    };

    handleAuthCallback();
  }, [navigate, searchParams]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#5500FF]/5 via-background to-[#8F7BFD]/10 flex items-center justify-center">
      <div className="text-center space-y-4">
        <Loader2 className="w-12 h-12 animate-spin text-[#5500FF] mx-auto" />
        <p className="text-muted-foreground">Processing authentication...</p>
      </div>
    </div>
  );
}
