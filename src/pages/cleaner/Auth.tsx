import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, ArrowRight, Shield, Users, DollarSign } from "lucide-react";
import logo from "@/assets/logo.png";

export default function CleanerAuth() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    // If user is already logged in, check their cleaner profile
    if (user) {
      checkCleanerProfile();
    } else {
      setCheckingAuth(false);
    }
  }, [user]);

  const checkCleanerProfile = async () => {
    if (!user) {
      setCheckingAuth(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("cleaners")
        .select("id, onboarding_complete")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) throw error;

      if (data?.onboarding_complete) {
        // Cleaner profile complete, go to dashboard
        navigate("/cleaner/dashboard");
      } else if (data) {
        // Profile exists but not complete
        navigate("/cleaner/onboarding");
      } else {
        // No cleaner profile - need to complete onboarding
        navigate("/cleaner/onboarding");
      }
    } catch (error: any) {
      console.error("Error checking cleaner profile:", error);
      setCheckingAuth(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);

    try {
      const redirectUrl = `${window.location.origin}/cleaner/dashboard`;
      
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });

      if (error) {
        console.error("Google sign-in error:", error);
        toast.error("Failed to sign in with Google. Please try again.");
        setLoading(false);
      }
      // Note: Don't set loading to false on success - page will redirect
    } catch (error: any) {
      console.error("Sign in error:", error);
      toast.error("An error occurred. Please try again.");
      setLoading(false);
    }
  };

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#5500FF]/5 via-background to-[#8F7BFD]/10 flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="w-10 h-10 animate-spin text-[#5500FF] mx-auto" />
          <p className="text-muted-foreground">Checking your account...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#5500FF]/5 via-background to-[#8F7BFD]/10 px-4 py-12">
      <div className="w-full max-w-md space-y-8">
        {/* Header */}
        <div className="text-center">
          <img 
            src={logo} 
            alt="NovaraCleaning Logo" 
            className="mx-auto w-20 h-20 rounded-2xl mb-6 shadow-lg" 
          />
          <h1 className="text-4xl font-bold mb-2">Welcome Back</h1>
          <p className="text-muted-foreground text-lg">Sign in to your cleaner account</p>
        </div>

        {/* Sign In Card */}
        <Card className="shadow-xl border-[#5500FF]/20">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-2xl">Cleaner Portal</CardTitle>
            <CardDescription className="text-base">
              Access your dashboard, jobs, and earnings
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-6">
            {/* Google Sign In Button */}
            <Button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="w-full h-12 bg-white hover:bg-gray-50 text-gray-900 border-2 border-gray-200"
            >
              {loading ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <svg className="mr-2 w-5 h-5" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
              )}
              {loading ? "Signing in..." : "Continue with Google"}
            </Button>

            {/* Features */}
            <div className="grid grid-cols-3 gap-2 pt-2">
              <div className="text-center p-3 rounded-lg bg-muted/50">
                <DollarSign className="w-5 h-5 mx-auto text-[#5500FF] mb-1" />
                <span className="text-xs text-muted-foreground">Track Earnings</span>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted/50">
                <Shield className="w-5 h-5 mx-auto text-[#5500FF] mb-1" />
                <span className="text-xs text-muted-foreground">Secure</span>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted/50">
                <Users className="w-5 h-5 mx-auto text-[#5500FF] mb-1" />
                <span className="text-xs text-muted-foreground">View Jobs</span>
              </div>
            </div>
          </CardContent>
          
          <CardFooter className="flex flex-col gap-4 pt-0">
            {/* New Cleaner Link */}
            <div className="relative w-full">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">New to Novara?</span>
              </div>
            </div>
            
            <Button
              variant="outline"
              onClick={() => navigate("/cleaner/onboarding-landing")}
              className="w-full"
              disabled={loading}
            >
              Join Our Team
              <ArrowRight className="ml-2 w-4 h-4" />
            </Button>

            <div className="flex items-center justify-center text-sm w-full pt-2">
              <Link to="/" className="text-muted-foreground hover:text-[#5500FF]">
                ← Back to Customer Booking
              </Link>
            </div>
          </CardFooter>
        </Card>

        {/* Footer */}
        <div className="text-center text-sm text-muted-foreground">
          <p>
            Need help?{" "}
            <a href="mailto:hello@novaracleaning.com" className="text-[#5500FF] hover:underline">
              Contact Support
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
