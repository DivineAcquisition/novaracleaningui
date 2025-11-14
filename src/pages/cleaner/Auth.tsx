import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { z } from "zod";
import logo from "@/assets/logo.png";

const emailSchema = z.string().trim().email({ message: "Invalid email address" });
const passwordSchema = z.string().min(6, { message: "Password must be at least 6 characters" });

export default function CleanerAuth() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);

  useEffect(() => {
    // If user is already logged in, redirect to cleaner dashboard
    if (user) {
      checkCleanerProfile();
    }
  }, [user, navigate]);

  const checkCleanerProfile = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from("cleaners")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        navigate("/cleaner/dashboard");
      } else {
        toast({
          title: "Access Denied",
          description: "You don't have a cleaner account. Please contact admin.",
          variant: "destructive",
        });
        await supabase.auth.signOut();
      }
    } catch (error: any) {
      console.error("Error checking cleaner profile:", error);
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Validate inputs
      const emailValidation = emailSchema.safeParse(email);
      if (!emailValidation.success) {
        toast({
          title: "Invalid Email",
          description: emailValidation.error.errors[0].message,
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      const passwordValidation = passwordSchema.safeParse(password);
      if (!passwordValidation.success) {
        toast({
          title: "Invalid Password",
          description: passwordValidation.error.errors[0].message,
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: emailValidation.data,
        password: passwordValidation.data,
      });

      if (error) {
        if (error.message.includes("Invalid login credentials")) {
          toast({
            title: "Sign In Failed",
            description: "Invalid email or password. Please try again.",
            variant: "destructive",
          });
        } else if (error.message.includes("Email not confirmed")) {
          toast({
            title: "Email Not Confirmed",
            description: "Please check your email and confirm your account.",
            variant: "destructive",
          });
        } else {
          toast({
            title: "Sign In Failed",
            description: error.message,
            variant: "destructive",
          });
        }
        return;
      }

      if (data.user) {
        // Check if user has a cleaner profile and if onboarding is complete
        const { data: cleanerData, error: cleanerError } = await supabase
          .from("cleaners")
          .select("id, email, onboarding_complete")
          .eq("user_id", data.user.id)
          .maybeSingle();

        if (cleanerError) throw cleanerError;

        if (!cleanerData) {
          toast({
            title: "Access Denied",
            description: "You don't have a cleaner account. Please contact admin.",
            variant: "destructive",
          });
          await supabase.auth.signOut();
          return;
        }

        // Check if onboarding is complete
        if (!cleanerData.onboarding_complete) {
          toast({
            title: "Complete Your Profile",
            description: "Please complete your onboarding to access the dashboard.",
          });
          navigate("/cleaner/onboarding");
          return;
        }

        toast({
          title: "Welcome back!",
          description: "Successfully signed in to your cleaner account.",
        });
        navigate("/cleaner/dashboard");
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "An unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Validate inputs
      const emailValidation = emailSchema.safeParse(email);
      if (!emailValidation.success) {
        toast({
          title: "Invalid Email",
          description: emailValidation.error.errors[0].message,
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      const passwordValidation = passwordSchema.safeParse(password);
      if (!passwordValidation.success) {
        toast({
          title: "Invalid Password",
          description: passwordValidation.error.errors[0].message,
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      // Create auth account - no pre-checks needed, onboarding will handle profile creation
      const redirectUrl = `${window.location.origin}/cleaner/onboarding`;
      const { data, error } = await supabase.auth.signUp({
        email: emailValidation.data,
        password: passwordValidation.data,
        options: {
          emailRedirectTo: redirectUrl,
          data: {
            is_cleaner: true, // Tag this as a cleaner account
          },
        },
      });

      if (error) {
        if (error.message.includes("User already registered")) {
          toast({
            title: "Account Exists",
            description: "This email is already registered. Please sign in instead.",
            variant: "destructive",
          });
        } else {
          toast({
            title: "Sign Up Failed",
            description: error.message,
            variant: "destructive",
          });
        }
        return;
      }

      if (data.user) {
        toast({
          title: "Account Created!",
          description: "Please complete your profile to get started.",
        });
        
        // Redirect to onboarding to complete profile
        navigate("/cleaner/onboarding");
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "An unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-secondary/5 px-4 py-12">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <img src={logo} alt="NovaraCleaning Logo" className="mx-auto w-20 h-20 rounded-2xl mb-6 shadow-lavender" />
          <h1 className="text-4xl font-bold mb-2">Novara Cleaning</h1>
          <p className="text-muted-foreground text-lg">Cleaner Portal</p>
        </div>

        <Card className="shadow-xl border-primary/20">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-2xl">Welcome Back</CardTitle>
            <CardDescription className="text-base">
              Sign in to access your cleaner dashboard
            </CardDescription>
          </CardHeader>
          <Tabs defaultValue="signin" className="w-full">
            <TabsList className="grid w-full grid-cols-2 mx-6">
              <TabsTrigger value="signin">Sign In</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
            </TabsList>

            <TabsContent value="signin">
              <form onSubmit={handleSignIn}>
                <CardContent className="space-y-4 pt-6">
                  <div className="space-y-2">
                    <Label htmlFor="signin-email">Email</Label>
                    <Input
                      id="signin-email"
                      type="email"
                      placeholder="your.email@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      disabled={loading}
                      className="h-11"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signin-password">Password</Label>
                    <Input
                      id="signin-password"
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      disabled={loading}
                      className="h-11"
                    />
                  </div>
                  <div className="flex items-center space-x-2 pt-2">
                    <input
                      type="checkbox"
                      id="remember-me"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                      disabled
                    />
                    <Label htmlFor="remember-me" className="text-sm font-normal text-muted-foreground cursor-default">
                      Sessions are automatically saved securely
                    </Label>
                  </div>
                </CardContent>
                <CardFooter className="flex flex-col gap-4 pb-6">
                  <Button 
                    type="submit" 
                    className="w-full h-11 bg-gradient-primary hover:opacity-90 shadow-lavender" 
                    disabled={loading}
                  >
                    {loading && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
                    Sign In
                  </Button>
                  <div className="flex items-center justify-between text-sm w-full">
                    <Link to="/cleaner/reset-password" className="text-primary hover:underline font-medium">
                      Forgot password?
                    </Link>
                    <Link to="/auth" className="text-muted-foreground hover:text-primary font-medium">
                      Customer Login
                    </Link>
                  </div>
                </CardFooter>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={handleSignUp}>
                <CardContent className="space-y-4 pt-6">
                  <div className="bg-primary/10 border border-primary/20 p-4 rounded-lg text-sm">
                    <p className="font-medium text-foreground">
                      📋 Admin Invitation Required
                    </p>
                    <p className="text-muted-foreground mt-1">
                      You must be invited by an admin before creating an account.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-email">Email</Label>
                    <Input
                      id="signup-email"
                      type="email"
                      placeholder="your.email@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      disabled={loading}
                      className="h-11"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-password">Password</Label>
                    <Input
                      id="signup-password"
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      disabled={loading}
                      className="h-11"
                    />
                    <p className="text-xs text-muted-foreground">
                      Must be at least 6 characters long
                    </p>
                  </div>
                </CardContent>
                <CardFooter className="pb-6">
                  <Button 
                    type="submit" 
                    className="w-full h-11 bg-gradient-primary hover:opacity-90 shadow-lavender" 
                    disabled={loading}
                  >
                    {loading && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
                    Create Account
                  </Button>
                </CardFooter>
              </form>
            </TabsContent>
          </Tabs>
        </Card>

        <div className="text-center mt-6 text-sm text-muted-foreground">
          <Link to="/" className="text-primary hover:underline">
            ← Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
