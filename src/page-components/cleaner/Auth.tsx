"use client";
import Link from "next/link";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const { user, signInWithGoogle } = useAuth();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    // If user is already logged in, redirect to cleaner dashboard
    if (user) {
      checkCleanerProfile();
    }
  }, [user, router]);

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
        router.push("/cleaner/dashboard");
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
          router.push("/cleaner/onboarding");
          return;
        }

        toast({
          title: "Welcome back!",
          description: "Successfully signed in to your cleaner account.",
        });
        router.push("/cleaner/dashboard");
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
        router.push("/cleaner/onboarding");
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
          <img src={logo.src} alt="NovaraCleaning Logo" className="mx-auto w-20 h-20 rounded-2xl mb-6 shadow-lavender" />
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
          <CardContent className="pt-6">
            <Button
              type="button"
              variant="outline"
              className="w-full h-11 mb-6"
              onClick={signInWithGoogle}
            >
              <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Continue with Google
            </Button>
            
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">Or continue with</span>
              </div>
            </div>
          </CardContent>
          <form onSubmit={handleSignIn}>
            <CardContent className="space-y-4">
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
                <Link href="/cleaner/reset-password" className="text-primary hover:underline font-medium">
                  Forgot password?
                </Link>
                <Link href="/auth" className="text-muted-foreground hover:text-primary font-medium">
                  Customer Login
                </Link>
              </div>
              <div className="text-center text-sm text-muted-foreground">
                New cleaners must be invited by an administrator
              </div>
            </CardFooter>
          </form>
        </Card>

        <div className="text-center mt-6 text-sm text-muted-foreground">
          <Link href="/" className="text-primary hover:underline">
            ← Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
