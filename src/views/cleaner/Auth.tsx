"use client";

import {
  RiBriefcaseLine,
  RiLoader4Line,
  RiLockLine,
  RiMailLine,
  RiSparklingLine,
  RiWallet3Line,
  RiCalendarCheckLine,
} from "@remixicon/react";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

import { z } from "zod";
import { SEO } from "@/components/SEO";
import { resolveCleanerAuth } from "@/lib/cleaner-auth";
import { AuthScaffold, AuthCard, GoogleIcon, AUTH_INPUT_CLS, AUTH_GRADIENT } from "@/components/auth/AuthScaffold";

const CLEANER_FEATURES = [
  { icon: RiBriefcaseLine, label: "Steady work", desc: "Get matched to cleaning jobs near you." },
  { icon: RiWallet3Line, label: "Fast payouts", desc: "Stripe direct deposit after every job." },
  { icon: RiCalendarCheckLine, label: "Your schedule", desc: "Accept the jobs that fit your week." },
];
const CLEANER_STATS = [
  { value: "45%", label: "Top tier share" },
  { value: "24h", label: "Payouts" },
  { value: "4.9", label: "Crew rating" },
];

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
      // Auto-confirm contractor signup: contractor-signup creates the
      // auth user ALREADY email-confirmed (email_confirm: true), so we can
      // sign them in immediately with no confirmation email. This removes
      // the dependency on email deliverability for cleaner onboarding.
      const { data, error } = await supabase.functions.invoke("contractor-signup", {
        body: { email, password },
      });
      const fnErr = error || (data as { error?: string } | null)?.error;
      if (fnErr) {
        toast.error(typeof fnErr === "string" ? fnErr : "Failed to create your account");
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        toast.error("An account with this email already exists — please sign in with your password.");
        return;
      }

      toast.success("Account created!");
      await handlePostAuth();
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
      <div className="flex min-h-screen items-center justify-center bg-[#FAFAFC]">
        <div className="text-center">
          <RiLoader4Line className="mx-auto mb-4 h-8 w-8 animate-spin text-[#4F38FF]" />
          <p className="text-sm text-slate-500">Checking session…</p>
        </div>
      </div>
    );
  }

  return (
    <AuthScaffold
      eyebrow="Cleaner Portal"
      headline={<>Your next job,<br />one tap away.</>}
      subline="Sign in to manage jobs, track earnings, and get paid fast."
      features={CLEANER_FEATURES}
      stats={CLEANER_STATS}
    >
      <SEO title="Contractor Login" noindex />
      <AuthCard>
        <div className="space-y-1.5">
          <h1 className="font-jakarta text-[26px] font-bold leading-tight tracking-tight text-slate-900">Cleaner Portal</h1>
          <p className="text-sm text-slate-500">Manage your jobs and earnings.</p>
        </div>

        <div className="mt-6 space-y-4">
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full gap-2.5 border-slate-200 font-semibold text-slate-700 hover:bg-slate-50"
            onClick={handleGoogleSignIn}
            disabled={isLoading}
          >
            <GoogleIcon className="h-5 w-5" />
            Continue with Google
          </Button>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">or with email</span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          <Tabs defaultValue="signin" className="w-full">
            <TabsList className="mb-4 grid h-10 w-full grid-cols-2 rounded-xl bg-slate-100 p-1">
              <TabsTrigger value="signin" className="rounded-lg text-sm font-medium data-[state=active]:bg-white data-[state=active]:shadow-sm">Sign In</TabsTrigger>
              <TabsTrigger value="signup" className="rounded-lg text-sm font-medium data-[state=active]:bg-white data-[state=active]:shadow-sm">Join Us</TabsTrigger>
            </TabsList>

            <TabsContent value="signin" className="mt-0">
              <form onSubmit={handleSignIn} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="signin-email" className="text-slate-700">Email</Label>
                  <div className="relative">
                    <RiMailLine className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input id="signin-email" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className={AUTH_INPUT_CLS} disabled={isLoading} required />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="signin-password" className="text-slate-700">Password</Label>
                    <Link href="/cleaner/reset-password" className="text-xs font-medium text-[#4F38FF] hover:underline">Forgot password?</Link>
                  </div>
                  <div className="relative">
                    <RiLockLine className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input id="signin-password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} className={AUTH_INPUT_CLS} disabled={isLoading} required />
                  </div>
                </div>
                <Button type="submit" className="h-11 w-full font-semibold text-white shadow-lg shadow-[#4F38FF]/25 transition hover:opacity-95" style={{ background: AUTH_GRADIENT }} disabled={isLoading}>
                  {isLoading ? <><RiLoader4Line className="mr-2 h-4 w-4 animate-spin" />Signing in…</> : "Sign In"}
                </Button>
                <p className="text-center text-xs text-slate-500">
                  Joined via invite link?{" "}
                  <Link href="/cleaner/reset-password" className="text-[#4F38FF] hover:underline">Set your password</Link>{" "}or use Google.
                </p>
              </form>
            </TabsContent>

            <TabsContent value="signup" className="mt-0">
              <form onSubmit={handleSignUp} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="signup-email" className="text-slate-700">Email</Label>
                  <div className="relative">
                    <RiMailLine className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input id="signup-email" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className={AUTH_INPUT_CLS} disabled={isLoading} required />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="signup-password" className="text-slate-700">Password</Label>
                  <div className="relative">
                    <RiLockLine className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input id="signup-password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} className={AUTH_INPUT_CLS} disabled={isLoading} required />
                  </div>
                  <p className="text-xs text-slate-400">Must be at least 6 characters</p>
                </div>
                <Button type="submit" className="h-11 w-full font-semibold text-white shadow-lg shadow-[#4F38FF]/25 transition hover:opacity-95" style={{ background: AUTH_GRADIENT }} disabled={isLoading}>
                  {isLoading ? <><RiLoader4Line className="mr-2 h-4 w-4 animate-spin" />Creating account…</> : <><RiSparklingLine className="mr-2 h-4 w-4" />Join Our Team</>}
                </Button>
                <p className="text-center text-xs text-slate-500">You'll complete your profile after signing up.</p>
              </form>
            </TabsContent>
          </Tabs>
        </div>
      </AuthCard>

      <p className="text-center text-xs text-slate-500">
        Looking to book a cleaning?{" "}
        <Link href="/auth" className="font-medium text-[#4F38FF] hover:underline">Customer Portal →</Link>
      </p>
    </AuthScaffold>
  );
}
