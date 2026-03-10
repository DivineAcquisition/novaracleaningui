"use client";

import {
  RiLoader4Line
} from "@remixicon/react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SEO } from "@/components/SEO";

export default function AuthCallback() {
  const router = useRouter();

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        // Get the session from the URL hash
        const { data: { session }, error } = await supabase.auth.getSession();

        if (error) {
          console.error("Auth callback error:", error);
          toast.error("Authentication failed. Please try again.");
          router.push("/auth");
          return;
        }

        if (!session) {
          toast.error("No session found. Please sign in again.");
          router.push("/auth");
          return;
        }

        // Check if this is a password recovery flow
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const type = hashParams.get('type');

        // Check if this is a Google OAuth sign-in
        const provider = session.user.app_metadata?.provider;
        
        if (type === 'recovery') {
          // Password reset flow - redirect to update password
          router.push("/update-password");
        } else if (provider === 'google') {
          // Google OAuth authentication
          // Check if user has a cleaner profile
          const { data: cleanerData } = await supabase
            .from('cleaners')
            .select('id, onboarding_complete')
            .eq('user_id', session.user.id)
            .maybeSingle();

          if (cleanerData) {
            // User is a cleaner
            if (!cleanerData.onboarding_complete) {
              toast.success("Welcome! Complete your profile.");
              router.push("/cleaner/onboarding");
            } else {
              toast.success("Welcome back!");
              router.push("/cleaner/dashboard");
            }
          } else {
            // Regular customer
            // Create customer record if doesn't exist
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
            router.push("/account");
          }
        } else if (type === 'magiclink') {
          // Magic link authentication - check if it's cleaner onboarding
          const isCleanerOnboarding = session.user.user_metadata?.onboarding || 
                                       session.user.user_metadata?.is_cleaner;
          
          if (isCleanerOnboarding) {
            toast.success("Email verified! Complete your profile.");
            router.push("/cleaner/onboarding");
          } else {
            toast.success("Email verified successfully!");
            router.push("/account");
          }
        } else {
          // Email verification or other auth flow
          toast.success("Email verified successfully!");
          router.push("/account");
        }
      } catch (error) {
        console.error("Unexpected error in auth callback:", error);
        toast.error("Something went wrong. Please try again.");
        router.push("/auth");
      }
    };

    handleAuthCallback();
  }, [router]);

  return (
    <div className="min-h-screen bg-gradient-hero flex items-center justify-center">
      <SEO title="Authenticating..." noindex />
      <div className="text-center space-y-4">
        <RiLoader4Line className="w-12 h-12 animate-spin text-primary mx-auto" />
        <p className="text-muted-foreground">Processing authentication...</p>
      </div>
    </div>
  );
}
