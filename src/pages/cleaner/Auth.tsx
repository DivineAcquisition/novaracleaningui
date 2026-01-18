import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Loader2, ArrowRight, Shield, Mail, Lock, Eye, EyeOff } from "lucide-react";
import logo from "@/assets/logo.png";

export default function CleanerAuth() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  useEffect(() => {
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
        navigate("/cleaner/dashboard");
      } else if (data) {
        navigate("/cleaner/onboarding");
      } else {
        navigate("/cleaner/onboarding");
      }
    } catch (error: any) {
      console.error("Error checking cleaner profile:", error);
      setCheckingAuth(false);
    }
  };

  const validateEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    try {
      const redirectUrl = `${window.location.origin}/cleaner/dashboard`;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          queryParams: { access_type: 'offline', prompt: 'consent' },
        },
      });
      if (error) {
        toast.error("Failed to sign in with Google. Please try again.");
        setLoading(false);
      }
    } catch (error: any) {
      toast.error("An error occurred. Please try again.");
      setLoading(false);
    }
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !validateEmail(email)) {
      toast.error("Please enter a valid email address");
      return;
    }

    setLoading(true);
    try {
      const redirectUrl = `${window.location.origin}/cleaner/dashboard`;
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: { emailRedirectTo: redirectUrl },
      });

      if (error) {
        toast.error(error.message || "Failed to send login link.");
      } else {
        setMagicLinkSent(true);
        toast.success("Check your email for the login link!");
      }
    } catch (error) {
      toast.error("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !validateEmail(email)) {
      toast.error("Please enter a valid email address");
      return;
    }
    if (!password) {
      toast.error("Please enter your password");
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (error) {
        if (error.message.includes("Invalid login credentials")) {
          toast.error("Invalid email or password.");
        } else if (error.message.includes("Email not confirmed")) {
          toast.error("Please confirm your email first.");
        } else {
          toast.error(error.message);
        }
      } else if (data.user) {
        // Check cleaner profile
        const { data: cleaner } = await supabase
          .from("cleaners")
          .select("id, onboarding_complete")
          .eq("user_id", data.user.id)
          .maybeSingle();

        if (cleaner?.onboarding_complete) {
          toast.success("Welcome back!");
          navigate("/cleaner/dashboard");
        } else {
          toast.success("Please complete your profile.");
          navigate("/cleaner/onboarding");
        }
      }
    } catch (error) {
      toast.error("An error occurred. Please try again.");
    } finally {
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
          <img src={logo} alt="NovaraCleaning Logo" className="mx-auto w-20 h-20 rounded-2xl mb-6 shadow-lg" />
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
            {magicLinkSent ? (
              <div className="text-center py-6 space-y-4">
                <div className="w-14 h-14 rounded-full bg-[#5500FF]/10 flex items-center justify-center mx-auto">
                  <Mail className="w-7 h-7 text-[#5500FF]" />
                </div>
                <h3 className="text-lg font-semibold">Check Your Email</h3>
                <p className="text-sm text-muted-foreground">
                  We sent a login link to <strong>{email}</strong>
                </p>
                <Button variant="outline" onClick={() => setMagicLinkSent(false)} className="mt-2">
                  Use a different email
                </Button>
              </div>
            ) : (
              <>
                {/* Google Sign In */}
                <Button
                  onClick={handleGoogleSignIn}
                  disabled={loading}
                  className="w-full h-12 bg-white hover:bg-gray-50 text-gray-900 border-2 border-gray-200"
                >
                  {loading ? (
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  ) : (
                    <svg className="mr-2 w-5 h-5" viewBox="0 0 24 24">
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
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">Or</span>
                  </div>
                </div>

                {/* Email Tabs */}
                <Tabs defaultValue="password" className="w-full">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="password">Password</TabsTrigger>
                    <TabsTrigger value="magic-link">Email Link</TabsTrigger>
                  </TabsList>
                  
                  {/* Password Tab */}
                  <TabsContent value="password" className="space-y-4 mt-4">
                    <form onSubmit={handlePasswordSignIn} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <div className="relative">
                          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                          <Input
                            id="email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="your.email@example.com"
                            className="pl-9 h-11"
                            disabled={loading}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="password">Password</Label>
                        <div className="relative">
                          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                          <Input
                            id="password"
                            type={showPassword ? "text" : "password"}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                            className="pl-9 pr-9 h-11"
                            disabled={loading}
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          >
                            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                      <Button
                        type="submit"
                        disabled={loading}
                        className="w-full h-11 bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] hover:opacity-90"
                      >
                        {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        {loading ? "Signing in..." : "Sign In"}
                      </Button>
                    </form>
                    <div className="text-center">
                      <Link to="/cleaner/reset-password" className="text-sm text-[#5500FF] hover:underline">
                        Forgot password?
                      </Link>
                    </div>
                  </TabsContent>

                  {/* Magic Link Tab */}
                  <TabsContent value="magic-link" className="space-y-4 mt-4">
                    <form onSubmit={handleMagicLink} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="magic-email">Email</Label>
                        <div className="relative">
                          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                          <Input
                            id="magic-email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="your.email@example.com"
                            className="pl-9 h-11"
                            disabled={loading}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          We'll send a secure login link to your email
                        </p>
                      </div>
                      <Button
                        type="submit"
                        disabled={loading || !email}
                        className="w-full h-11 bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] hover:opacity-90"
                      >
                        {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
                        {loading ? "Sending..." : "Send Login Link"}
                      </Button>
                    </form>
                  </TabsContent>
                </Tabs>
              </>
            )}
          </CardContent>
          
          <CardFooter className="flex flex-col gap-4 pt-0">
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

            <div className="text-center text-sm w-full">
              <Link to="/" className="text-muted-foreground hover:text-[#5500FF]">
                ← Back to Customer Booking
              </Link>
            </div>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
