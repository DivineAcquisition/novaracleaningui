"use client";
export const dynamic = "force-dynamic";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
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

        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const type = hashParams.get('type');
        const provider = session.user.app_metadata?.provider;
        
        if (type === 'recovery') {
          router.push("/update-password");
        } else if (provider === 'google') {
          const { data: cleanerData } = await supabase
            .from('cleaners')
            .select('id, onboarding_complete')
            .eq('email', session.user.email)
            .maybeSingle();

          if (cleanerData) {
            if (!cleanerData.onboarding_complete) {
              toast.success("Welcome! Complete your profile.");
              router.push("/cleaner/onboarding");
            } else {
              toast.success("Welcome back!");
              router.push("/cleaner/dashboard");
            }
          } else {
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
      <div className="text-center space-y-4">
        <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto" />
        <p className="text-muted-foreground">Processing authentication...</p>
      </div>
    </div>
  );
}
