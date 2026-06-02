"use client";

import {
  RiBriefcaseLine,
  RiLoader4Line,
  RiLockLine,
  RiMailLine,
  RiSparklingLine
} from "@remixicon/react";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

import { z } from "zod";
import { SEO } from "@/components/SEO";
import { resolveCleanerAuth } from "@/lib/cleaner-auth";

const emailSchema = z.string().email("Please enter a valid email address");
const passwordSchema = z.string().min(6, "Password must be at least 6 characters");

export default function CleanerAuth() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    checkExistingSession();
  }, []);

  const checkExistingSession = async () => {
    try {
      await handlePostAuth();
    } catch (error) {
      console.error("Session check error:", error);
    } finally {
      setIsCheckingSession(false);
    }
  };

  // Use the shared cleaner-auth resolver so admin-invited cleaners
  // (whose cleaner row exists but has user_id IS NULL) get auto-linked
  // by email on first sign-in instead of being looped back to
  // /cleaner/onboarding.
  const handlePostAuth = async () => {
    try {
      const { routing } = await resolveCleanerAuth();
      if (routing === "auth") return;
      if (routing === "dashboard") {
        router.replace("/cleaner/dashboard");
      } else {
        router.replace("/cleaner/onboarding");
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
        await handlePostAuth();
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
      // Route signup through send-auth-email so the confirmation email is
      // branded (green Novara theme) and reliably delivered via Resend.
      // The function calls admin.generateLink({type:'signup'}) which both
      // creates the auth user AND returns the confirmation link in one
      // call. The link's redirectTo is pinned to
      // contractor.novaracleaning.com/cleaner/auth/callback. We never get
      // back whether the email was already on file (no enumeration), so
      // the UX is "we sent you an email — check your inbox" regardless.
      const { error } = await supabase.functions.invoke("send-auth-email", {
        body: {
          kind: "signup_contractor",
          email,
          password,
          metadata: { is_cleaner: true },
        },
      });

      if (error) {
        toast.error(error.message || "Failed to start signup");
        return;
      }

      toast.success("Check your email — we've sent a confirmation link.");
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
          // In the native app, route OAuth back through the universal link
          // (contractor.novaracleaning.com) which the app intercepts via
          // appUrlOpen and exchanges for a session. On web, use the origin.
          redirectTo: `${
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (window as any).Capacitor?.isNativePlatform?.()
              ? "https://contractor.novaracleaning.com"
              : window.location.origin
          }/cleaner/auth/callback`,
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

  if (isCheckingSession) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/10 flex items-center justify-center">
        <div className="text-center">
          <RiLoader4Line className="w-8 h-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground text-sm">Checking session...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/10 flex items-center justify-center p-4">
      <SEO title="Contractor Login" noindex />
      <div className="w-full max-w-[380px]">
        {/* Logo & Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-primary shadow-lg mb-4">
            <RiBriefcaseLine className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Cleaner Portal</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your jobs and earnings
          </p>
        </div>

        <Card className="border-0 shadow-xl bg-card/80 backdrop-blur-sm">
          <CardContent className="p-6">
            {/* Google Button */}
            <Button
              type="button"
              variant="outline"
              className="w-full h-11 mb-5 font-medium"
              onClick={handleGoogleSignIn}
              disabled={isLoading}
            >
              <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Continue with Google
            </Button>
            
            {/* Divider */}
            <div className="relative my-5">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border/60" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-card px-3 text-xs text-muted-foreground uppercase tracking-wide">
                  or continue with email
                </span>
              </div>
            </div>

            {/* Tabs */}
            <Tabs defaultValue="signin" className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-5 h-10 p-1 bg-muted/50">
                <TabsTrigger value="signin" className="text-sm font-medium data-[state=active]:bg-background data-[state=active]:shadow-sm">
                  Sign In
                </TabsTrigger>
                <TabsTrigger value="signup" className="text-sm font-medium data-[state=active]:bg-background data-[state=active]:shadow-sm">
                  Join Us
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="signin" className="mt-0">
                <form onSubmit={handleSignIn} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signin-email" className="text-sm font-medium">
                      Email
                    </Label>
                    <div className="relative">
                      <RiMailLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="signin-email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="pl-10 h-11 bg-background/50"
                        disabled={isLoading}
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="signin-password" className="text-sm font-medium">
                        Password
                      </Label>
                      <Link 
                        href="/cleaner/reset-password" 
                        className="text-xs text-primary hover:text-primary/80 font-medium"
                      >
                        Forgot password?
                      </Link>
                    </div>
                    <div className="relative">
                      <RiLockLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="signin-password"
                        type="password"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="pl-10 h-11 bg-background/50"
                        disabled={isLoading}
                        required
                      />
                    </div>
                  </div>

                  <Button
                    type="submit"
                    className="w-full h-11"
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <>
                        <RiLoader4Line className="mr-2 w-4 h-4 animate-spin" />
                        Signing in...
                      </>
                    ) : (
                      "Sign In"
                    )}
                  </Button>

                  <p className="text-xs text-muted-foreground text-center mt-3">
                    Joined via invite link?{" "}
                    <Link href="/cleaner/reset-password" className="text-primary hover:underline">
                      Set your password
                    </Link>{" "}
                    or use Google sign-in.
                  </p>
                </form>
              </TabsContent>
              
              <TabsContent value="signup" className="mt-0">
                <form onSubmit={handleSignUp} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signup-email" className="text-sm font-medium">
                      Email
                    </Label>
                    <div className="relative">
                      <RiMailLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="signup-email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="pl-10 h-11 bg-background/50"
                        disabled={isLoading}
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="signup-password" className="text-sm font-medium">
                      Password
                    </Label>
                    <div className="relative">
                      <RiLockLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="signup-password"
                        type="password"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="pl-10 h-11 bg-background/50"
                        disabled={isLoading}
                        required
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Must be at least 6 characters
                    </p>
                  </div>

                  <Button
                    type="submit"
                    className="w-full h-11"
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <>
                        <RiLoader4Line className="mr-2 w-4 h-4 animate-spin" />
                        Creating account...
                      </>
                    ) : (
                      <>
                        <RiSparklingLine className="mr-2 w-4 h-4" />
                        Join Our Team
                      </>
                    )}
                  </Button>

                  <p className="text-xs text-center text-muted-foreground">
                    You'll complete your profile after signing up
                  </p>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Footer Links */}
        <div className="mt-6 text-center space-y-2">
          <p className="text-xs text-muted-foreground">
            Looking to book a cleaning?{" "}
            <Link href="/auth" className="text-primary hover:underline font-medium">
              Customer Portal →
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
