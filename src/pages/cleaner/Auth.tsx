import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Loader2, Mail, Lock } from "lucide-react";
import logo from "@/assets/logo.png";
import { z } from "zod";

const emailSchema = z.string().email("Please enter a valid email address");
const passwordSchema = z.string().min(6, "Password must be at least 6 characters");

export default function CleanerAuth() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Check for existing session on mount
  useEffect(() => {
    checkExistingSession();
  }, []);

  const checkExistingSession = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (session?.user) {
        // User is already logged in, check if they have a cleaner profile
        await handlePostAuth(session.user.id);
      }
    } catch (error) {
      console.error("Session check error:", error);
    } finally {
      setIsCheckingSession(false);
    }
  };

  const handlePostAuth = async (userId: string) => {
    try {
      // Check if user has a cleaner profile
      const { data: cleaner, error } = await supabase
        .from("cleaners")
        .select("id, onboarding_complete")
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        console.error("Error checking cleaner profile:", error);
        return;
      }

      if (cleaner) {
        // Has cleaner profile
        if (cleaner.onboarding_complete) {
          navigate("/cleaner/dashboard", { replace: true });
        } else {
          navigate("/cleaner/onboarding", { replace: true });
        }
      } else {
        // No cleaner profile - redirect to onboarding to create one
        navigate("/cleaner/onboarding", { replace: true });
      }
    } catch (error) {
      console.error("Post-auth error:", error);
    }
  };

  const validateInputs = () => {
    try {
      emailSchema.parse(email);
      passwordSchema.parse(password);
      return true;
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast.error(error.errors[0].message);
      }
      return false;
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateInputs()) return;
    
    setIsLoading(true);
    
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      
      if (error) {
        if (error.message.includes("Invalid login credentials")) {
          toast.error("Invalid email or password");
        } else if (error.message.includes("Email not confirmed")) {
          toast.error("Please check your email and confirm your account.");
        } else {
          toast.error(error.message || "Failed to sign in");
        }
        return;
      }

      if (data.user) {
        toast.success("Welcome back!");
        await handlePostAuth(data.user.id);
      }
    } catch (error: any) {
      toast.error(error.message || "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateInputs()) return;
    
    setIsLoading(true);
    
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          // Redirect to cleaner onboarding after email verification
          emailRedirectTo: `${window.location.origin}/cleaner/onboarding`,
          data: {
            is_cleaner: true,
          },
        },
      });
      
      if (error) {
        if (error.message.includes("already registered")) {
          toast.error("This email is already registered. Please sign in instead.");
        } else {
          toast.error(error.message || "Failed to sign up");
        }
        return;
      }

      if (data?.user?.identities?.length === 0) {
        toast.error("This email is already registered. Please sign in or reset your password.");
      } else if (data?.user && !data?.session) {
        toast.success("Account created! Please check your email to verify your account.");
      } else if (data?.session) {
        toast.success("Account created! Complete your profile to get started.");
        navigate("/cleaner/onboarding", { replace: true });
      }
    } catch (error: any) {
      toast.error(error.message || "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          // IMPORTANT: Redirect to cleaner-specific callback, not customer callback
          redirectTo: `${window.location.origin}/cleaner/auth/callback`,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });

      if (error) {
        toast.error(error.message || "Failed to sign in with Google");
      }
    } catch (error: any) {
      toast.error(error.message || "An error occurred");
    }
  };

  // Show loading while checking session
  if (isCheckingSession) {
    return (
      <div className="min-h-screen bg-gradient-hero flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Checking session...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-hero flex items-center justify-center px-4 py-6">
      <Card className="max-w-sm w-full shadow-xl border-primary/20">
        <CardHeader className="text-center space-y-1 pb-3 pt-5">
          <img src={logo} alt="NovaraCleaning Logo" className="mx-auto w-12 h-12 rounded-xl mb-2 shadow-lavender" />
          <CardTitle className="text-2xl font-bold">Cleaner Portal</CardTitle>
          <CardDescription className="text-sm">
            Sign in to manage your jobs
          </CardDescription>
        </CardHeader>
        
        <CardContent className="px-5 pb-5">
          <Button
            type="button"
            variant="outline"
            className="w-full h-10 mb-4"
            onClick={handleGoogleSignIn}
            disabled={isLoading}
          >
            <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </Button>
          
          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">Or</span>
            </div>
          </div>

          <Tabs defaultValue="signin" className="space-y-4">
            <TabsList className="grid w-full grid-cols-2 h-9">
              <TabsTrigger value="signin" className="text-sm">Sign In</TabsTrigger>
              <TabsTrigger value="signup" className="text-sm">Sign Up</TabsTrigger>
            </TabsList>
            
            <TabsContent value="signin">
              <form onSubmit={handleSignIn} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="signin-email" className="text-sm">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="signin-email"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-9 h-10"
                      disabled={isLoading}
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="signin-password" className="text-sm">Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="signin-password"
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-9 h-10"
                      disabled={isLoading}
                      required
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <Link to="/cleaner/reset-password" className="text-primary hover:underline">
                    Forgot Password?
                  </Link>
                  <Link to="/auth" className="text-muted-foreground hover:text-primary">
                    Customer Login
                  </Link>
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  size="lg"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 w-4 h-4 animate-spin" />
                      Signing in...
                    </>
                  ) : (
                    "Sign In"
                  )}
                </Button>
              </form>
            </TabsContent>
            
            <TabsContent value="signup">
              <form onSubmit={handleSignUp} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="signup-email" className="text-sm">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="signup-email"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-9 h-10"
                      disabled={isLoading}
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="signup-password" className="text-sm">Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="signup-password"
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-9 h-10"
                      disabled={isLoading}
                      required
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Min. 6 characters
                  </p>
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  size="lg"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 w-4 h-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    "Create Account"
                  )}
                </Button>

                <p className="text-xs text-center text-muted-foreground">
                  You'll complete your profile after signing up
                </p>
              </form>
            </TabsContent>
          </Tabs>

          <div className="mt-4 text-center">
            <Link to="/" className="text-xs text-muted-foreground hover:text-primary">
              ← Back to Home
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
