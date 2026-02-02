"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function CleanerAuthCallback() {
  const router = useRouter();
  const [status, setStatus] = useState("Verifying authentication...");

  useEffect(() => {
    handleCallback();
  }, []);

  const handleCallback = async () => {
    try {
      // Get session from URL hash
      const { data: { session }, error } = await supabase.auth.getSession();

      if (error) {
        console.error("Auth callback error:", error);
        toast.error("Authentication failed");
        router.replace("/cleaner/auth");
        return;
      }

      if (!session) {
        setStatus("Waiting for authentication...");
        // Wait a moment and try again (OAuth redirect can be slow)
        setTimeout(async () => {
          const { data: { session: retrySession } } = await supabase.auth.getSession();
          if (retrySession?.user) {
            await processUser(retrySession.user.id);
          } else {
            toast.error("Authentication failed");
            router.replace("/cleaner/auth");
          }
        }, 1000);
        return;
      }

      await processUser(session.user.id);
    } catch (error) {
      console.error("Callback error:", error);
      toast.error("Something went wrong");
      router.replace("/cleaner/auth");
    }
  };

  const processUser = async (userId: string) => {
    setStatus("Checking your profile...");

    try {
      // Check if cleaner profile exists
      const { data: cleaner, error } = await supabase
        .from("cleaners")
        .select("id, onboarding_complete")
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        console.error("Error checking cleaner profile:", error);
      }

      if (cleaner?.onboarding_complete) {
        setStatus("Welcome back! Redirecting to dashboard...");
        toast.success("Welcome back!");
        router.replace("/cleaner/dashboard");
      } else {
        setStatus("Setting up your profile...");
        toast.success("Let's complete your profile!");
        router.replace("/cleaner/onboarding");
      }
    } catch (error) {
      console.error("Process user error:", error);
      router.replace("/cleaner/onboarding");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/10 flex items-center justify-center">
      <div className="text-center space-y-4">
        <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto" />
        <p className="text-muted-foreground">{status}</p>
      </div>
    </div>
  );
}
