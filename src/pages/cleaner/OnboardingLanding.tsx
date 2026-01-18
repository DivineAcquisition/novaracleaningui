import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { 
  Sparkles, 
  Shield, 
  DollarSign, 
  Clock, 
  Users,
  Loader2,
  ArrowRight,
  CheckCircle2
} from "lucide-react";
import logo from "@/assets/logo.png";

const BENEFITS = [
  {
    icon: DollarSign,
    title: "Instant Payouts",
    description: "Get paid automatically when jobs are completed"
  },
  {
    icon: Clock,
    title: "Flexible Schedule",
    description: "Work when you want, set your own availability"
  },
  {
    icon: Shield,
    title: "Secure Platform",
    description: "Background-checked team members only"
  },
  {
    icon: Users,
    title: "Growing Network",
    description: "Join a community of professional cleaners"
  }
];

export default function OnboardingLanding() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Check if user is already authenticated
  useEffect(() => {
    checkExistingSession();
  }, []);

  const checkExistingSession = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (session?.user) {
        console.log("[ONBOARDING] User already authenticated:", session.user.email);
        
        // Check if they already have a cleaner profile
        const { data: cleaner } = await supabase
          .from("cleaners")
          .select("id, onboarding_complete")
          .eq("user_id", session.user.id)
          .maybeSingle();
        
        if (cleaner?.onboarding_complete) {
          // Already onboarded, go to dashboard
          navigate("/cleaner/dashboard");
          return;
        } else if (cleaner) {
          // Has profile but not complete, go to onboarding
          navigate("/cleaner/onboarding");
          return;
        }
        
        // Authenticated but no cleaner profile - they need to complete onboarding
        navigate("/cleaner/onboarding");
        return;
      }
    } catch (error) {
      console.error("[ONBOARDING] Session check error:", error);
    } finally {
      setCheckingAuth(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    
    try {
      const redirectUrl = `${window.location.origin}/cleaner/onboarding`;
      
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
        console.error("[ONBOARDING] Google sign-in error:", error);
        toast.error("Failed to start Google sign-in. Please try again.");
        setIsLoading(false);
      }
      // Note: Don't set loading to false on success - page will redirect
    } catch (error) {
      console.error("[ONBOARDING] Google sign-in exception:", error);
      toast.error("An error occurred. Please try again.");
      setIsLoading(false);
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
    <div className="min-h-screen bg-gradient-to-br from-[#5500FF]/5 via-background to-[#8F7BFD]/10">
      {/* Header */}
      <header className="container mx-auto px-4 py-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={logo} alt="Novara" className="w-10 h-10 rounded-xl" />
            <span className="text-xl font-bold">Novara Cleaning</span>
          </div>
          <Button 
            variant="ghost" 
            onClick={() => navigate("/cleaner/auth")}
            className="text-muted-foreground"
          >
            Already have an account?
          </Button>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 md:py-16">
        <div className="grid lg:grid-cols-2 gap-12 items-center max-w-6xl mx-auto">
          
          {/* Left Side - Hero Content */}
          <div className="space-y-8">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#5500FF]/10 text-[#5500FF] text-sm font-medium">
                <Sparkles className="w-4 h-4" />
                Join Our Growing Team
              </div>
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight">
                Start Earning as a
                <span className="block bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] bg-clip-text text-transparent">
                  Professional Cleaner
                </span>
              </h1>
              <p className="text-lg md:text-xl text-muted-foreground max-w-lg">
                Join Novara Cleaning and enjoy flexible schedules, competitive pay, and instant payouts. 
                Get started in just 5 minutes.
              </p>
            </div>

            {/* Benefits Grid */}
            <div className="grid grid-cols-2 gap-4">
              {BENEFITS.map((benefit, index) => (
                <div 
                  key={index}
                  className="flex items-start gap-3 p-4 rounded-xl bg-card/50 backdrop-blur border border-border/50"
                >
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#5500FF] to-[#8F7BFD] flex items-center justify-center flex-shrink-0">
                    <benefit.icon className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">{benefit.title}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">{benefit.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right Side - Sign Up Card */}
          <div className="lg:pl-8">
            <Card className="shadow-2xl border-[#5500FF]/20 overflow-hidden">
              {/* Card Header with Gradient */}
              <div className="bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] p-6 text-white">
                <h2 className="text-2xl font-bold mb-2">Get Started</h2>
                <p className="text-white/80">
                  Sign up with Google to begin your application
                </p>
              </div>

              <CardContent className="p-6 space-y-6">
                {/* Google Sign In Button */}
                <Button
                  onClick={handleGoogleSignIn}
                  disabled={isLoading}
                  className="w-full h-14 text-lg bg-white hover:bg-gray-50 text-gray-900 border-2 border-gray-200 shadow-sm"
                >
                  {isLoading ? (
                    <Loader2 className="mr-3 h-5 w-5 animate-spin" />
                  ) : (
                    <svg className="mr-3 h-5 w-5" viewBox="0 0 24 24">
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
                  {isLoading ? "Connecting..." : "Continue with Google"}
                </Button>

                {/* Info Text */}
                <div className="text-center space-y-2">
                  <p className="text-sm text-muted-foreground">
                    By continuing, you agree to our Terms of Service and Privacy Policy
                  </p>
                </div>

                {/* What Happens Next */}
                <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                  <h4 className="font-semibold text-sm">What happens next?</h4>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-[#5500FF] mt-0.5 flex-shrink-0" />
                      <span>Sign in securely with your Google account</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-[#5500FF] mt-0.5 flex-shrink-0" />
                      <span>Complete your profile (5 minutes)</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-[#5500FF] mt-0.5 flex-shrink-0" />
                      <span>Set up payment to receive earnings</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-[#5500FF] mt-0.5 flex-shrink-0" />
                      <span>Start accepting jobs!</span>
                    </li>
                  </ul>
                </div>

                {/* Divider */}
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-border" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">
                      Already a cleaner?
                    </span>
                  </div>
                </div>

                {/* Sign In Link */}
                <Button
                  variant="outline"
                  onClick={() => navigate("/cleaner/auth")}
                  className="w-full"
                  disabled={isLoading}
                >
                  Sign In to Your Account
                  <ArrowRight className="ml-2 w-4 h-4" />
                </Button>

                {/* Trust Badges */}
                <div className="pt-4 border-t border-border">
                  <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Shield className="w-4 h-4 text-[#5500FF]" />
                      <span>Secure</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <CheckCircle2 className="w-4 h-4 text-[#5500FF]" />
                      <span>Verified</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Users className="w-4 h-4 text-[#5500FF]" />
                      <span>500+ Cleaners</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="container mx-auto px-4 py-8 mt-auto">
        <div className="text-center text-sm text-muted-foreground">
          <p>© {new Date().getFullYear()} Novara Cleaning. All rights reserved.</p>
          <p className="mt-1">
            Questions? Contact us at{" "}
            <a href="mailto:hello@novaracleaning.com" className="text-[#5500FF] hover:underline">
              hello@novaracleaning.com
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
