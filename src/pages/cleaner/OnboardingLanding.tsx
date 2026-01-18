import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  CheckCircle2,
  Mail,
  Lock,
  Eye,
  EyeOff
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  // Check if user is already authenticated
  useEffect(() => {
    checkExistingSession();
  }, []);

  const checkExistingSession = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (session?.user) {
        console.log("[ONBOARDING] User already authenticated:", session.user.email);
        
        const { data: cleaner } = await supabase
          .from("cleaners")
          .select("id, onboarding_complete")
          .eq("user_id", session.user.id)
          .maybeSingle();
        
        if (cleaner?.onboarding_complete) {
          navigate("/cleaner/dashboard");
          return;
        }
        
        navigate("/cleaner/onboarding");
        return;
      }
    } catch (error) {
      console.error("[ONBOARDING] Session check error:", error);
    } finally {
      setCheckingAuth(false);
    }
  };

  const validateEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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
    } catch (error) {
      console.error("[ONBOARDING] Google sign-in exception:", error);
      toast.error("An error occurred. Please try again.");
      setIsLoading(false);
    }
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !validateEmail(email)) {
      toast.error("Please enter a valid email address");
      return;
    }

    setIsLoading(true);

    try {
      const redirectUrl = `${window.location.origin}/cleaner/onboarding`;
      
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: {
          emailRedirectTo: redirectUrl,
          data: {
            is_cleaner: true,
          }
        },
      });

      if (error) {
        console.error("[ONBOARDING] Magic link error:", error);
        toast.error(error.message || "Failed to send magic link. Please try again.");
      } else {
        setMagicLinkSent(true);
        toast.success("Check your email for the login link!");
      }
    } catch (error) {
      console.error("[ONBOARDING] Magic link exception:", error);
      toast.error("An error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmailSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !validateEmail(email)) {
      toast.error("Please enter a valid email address");
      return;
    }

    if (!password || password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }

    setIsLoading(true);

    try {
      const redirectUrl = `${window.location.origin}/cleaner/onboarding`;
      
      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          emailRedirectTo: redirectUrl,
          data: {
            is_cleaner: true,
          }
        },
      });

      if (error) {
        console.error("[ONBOARDING] Sign up error:", error);
        if (error.message.includes("already registered")) {
          toast.error("This email is already registered. Try signing in instead.");
        } else {
          toast.error(error.message || "Failed to create account. Please try again.");
        }
      } else if (data.user) {
        if (data.user.identities?.length === 0) {
          toast.error("This email is already registered. Try signing in instead.");
        } else if (data.session) {
          // User was created and logged in directly
          toast.success("Account created! Completing setup...");
          navigate("/cleaner/onboarding");
        } else {
          // Email confirmation required
          setMagicLinkSent(true);
          toast.success("Check your email to confirm your account!");
        }
      }
    } catch (error) {
      console.error("[ONBOARDING] Sign up exception:", error);
      toast.error("An error occurred. Please try again.");
    } finally {
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

      <div className="container mx-auto px-4 py-8 md:py-12">
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
                  Create your account to begin
                </p>
              </div>

              <CardContent className="p-6 space-y-6">
                {magicLinkSent ? (
                  // Success State
                  <div className="text-center py-8 space-y-4">
                    <div className="w-16 h-16 rounded-full bg-[#5500FF]/10 flex items-center justify-center mx-auto">
                      <Mail className="w-8 h-8 text-[#5500FF]" />
                    </div>
                    <h3 className="text-xl font-semibold">Check Your Email</h3>
                    <p className="text-muted-foreground">
                      We sent a link to <strong>{email}</strong>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Click the link in the email to continue setting up your account.
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => setMagicLinkSent(false)}
                      className="mt-4"
                    >
                      Use a different email
                    </Button>
                  </div>
                ) : (
                  <>
                    {/* Google Sign In Button */}
                    <Button
                      onClick={handleGoogleSignIn}
                      disabled={isLoading}
                      className="w-full h-12 bg-white hover:bg-gray-50 text-gray-900 border-2 border-gray-200 shadow-sm"
                    >
                      {isLoading ? (
                        <Loader2 className="mr-3 h-5 w-5 animate-spin" />
                      ) : (
                        <svg className="mr-3 h-5 w-5" viewBox="0 0 24 24">
                          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                        </svg>
                      )}
                      Continue with Google
                    </Button>

                    {/* Divider */}
                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t border-border" />
                      </div>
                      <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-card px-2 text-muted-foreground">Or continue with email</span>
                      </div>
                    </div>

                    {/* Email Options Tabs */}
                    <Tabs defaultValue="magic-link" className="w-full">
                      <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="magic-link">Email Link</TabsTrigger>
                        <TabsTrigger value="password">Password</TabsTrigger>
                      </TabsList>
                      
                      {/* Magic Link Tab */}
                      <TabsContent value="magic-link" className="space-y-4 mt-4">
                        <form onSubmit={handleMagicLink} className="space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="magic-email">Email Address</Label>
                            <div className="relative">
                              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                              <Input
                                id="magic-email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="your.email@example.com"
                                className="pl-10 h-12"
                                disabled={isLoading}
                              />
                            </div>
                            <p className="text-xs text-muted-foreground">
                              We'll send you a secure login link
                            </p>
                          </div>
                          <Button
                            type="submit"
                            disabled={isLoading || !email}
                            className="w-full h-12 bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] hover:opacity-90"
                          >
                            {isLoading ? (
                              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                            ) : (
                              <Mail className="mr-2 h-5 w-5" />
                            )}
                            {isLoading ? "Sending..." : "Send Login Link"}
                          </Button>
                        </form>
                      </TabsContent>

                      {/* Password Tab */}
                      <TabsContent value="password" className="space-y-4 mt-4">
                        <form onSubmit={handleEmailSignUp} className="space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="signup-email">Email Address</Label>
                            <div className="relative">
                              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                              <Input
                                id="signup-email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="your.email@example.com"
                                className="pl-10 h-12"
                                disabled={isLoading}
                              />
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="signup-password">Password</Label>
                            <div className="relative">
                              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                              <Input
                                id="signup-password"
                                type={showPassword ? "text" : "password"}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Create a password"
                                className="pl-10 pr-10 h-12"
                                disabled={isLoading}
                              />
                              <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                              >
                                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                              </button>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              At least 6 characters
                            </p>
                          </div>
                          <Button
                            type="submit"
                            disabled={isLoading || !email || !password}
                            className="w-full h-12 bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] hover:opacity-90"
                          >
                            {isLoading ? (
                              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                            ) : null}
                            {isLoading ? "Creating Account..." : "Create Account"}
                          </Button>
                        </form>
                      </TabsContent>
                    </Tabs>

                    {/* What Happens Next */}
                    <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                      <h4 className="font-semibold text-sm">What happens next?</h4>
                      <ul className="space-y-1.5 text-xs text-muted-foreground">
                        <li className="flex items-center gap-2">
                          <CheckCircle2 className="w-3.5 h-3.5 text-[#5500FF] flex-shrink-0" />
                          <span>Verify your email</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <CheckCircle2 className="w-3.5 h-3.5 text-[#5500FF] flex-shrink-0" />
                          <span>Complete your profile (5 min)</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <CheckCircle2 className="w-3.5 h-3.5 text-[#5500FF] flex-shrink-0" />
                          <span>Start accepting jobs!</span>
                        </li>
                      </ul>
                    </div>

                    {/* Sign In Link */}
                    <div className="text-center text-sm">
                      <span className="text-muted-foreground">Already have an account? </span>
                      <button
                        onClick={() => navigate("/cleaner/auth")}
                        className="text-[#5500FF] hover:underline font-medium"
                      >
                        Sign In
                      </button>
                    </div>
                  </>
                )}

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
