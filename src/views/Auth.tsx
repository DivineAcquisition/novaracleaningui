"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  RiLoader4Line, RiMailLine, RiLockLine, RiSparklingLine,
  RiShieldCheckLine, RiStarLine, RiCheckboxCircleLine
} from "@remixicon/react";
import { z } from "zod";
import { SEO } from "@/components/SEO";
import { AuthScaffold, AuthCard, GoogleIcon, AUTH_INPUT_CLS, AUTH_GRADIENT } from "@/components/auth/AuthScaffold";

// (accent color references below use #5C0FFE to match the brand scheme)
const CUSTOMER_FEATURES = [
  { icon: RiShieldCheckLine, label: "Google Guaranteed", desc: "Fully insured and background-checked crews." },
  { icon: RiStarLine, label: "Loved by clients", desc: "4.9 average rating across 500+ cleans." },
  { icon: RiCheckboxCircleLine, label: "Reclean guarantee", desc: "Not happy? We come back and reclean free." },
];
const CUSTOMER_STATS = [
  { value: "4.9", label: "Avg rating" },
  { value: "500+", label: "Cleans" },
  { value: "100%", label: "Guarantee" },
];

const emailSchema = z.string().email("Please enter a valid email address");
const passwordSchema = z.string().min(6, "Password must be at least 6 characters");

export default function Auth() {
  const router = useRouter();
  const { user, signIn, signUp, signInWithGoogle } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    const guestEmail = localStorage.getItem('guestBookingEmail');
    if (guestEmail) {
      setEmail(guestEmail);
      localStorage.removeItem('guestBookingEmail');
    }
  }, []);

  useEffect(() => {
    if (user) {
      router.replace("/account");
    }
  }, [user, router]);

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
    const { error } = await signIn(email, password);
    
    if (error) {
      if (error.message.includes("Invalid login credentials")) {
        toast.error("Invalid email or password");
      } else {
        toast.error(error.message || "Failed to sign in");
      }
    } else {
      toast.success("Welcome back!");
      router.push("/account");
    }
    setIsLoading(false);
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateInputs()) return;

    setIsLoading(true);
    // signUp() now routes through our send-auth-email function so the
    // confirmation always arrives in the brand template. The function
    // never reveals whether the email already exists (no enumeration),
    // so the UX is a uniform "check your email" regardless.
    const { error } = await signUp(email, password);

    if (error) {
      toast.error(error.message || "Failed to sign up");
    } else {
      toast.success("Check your email — we've sent a confirmation link.");
    }
    setIsLoading(false);
  };

  return (
    <AuthScaffold
      eyebrow="Customer Account"
      headline={<>Your home,<br />spotless on schedule.</>}
      subline="Sign in to manage bookings, membership credits, and keep your home sparkling."
      features={CUSTOMER_FEATURES}
      stats={CUSTOMER_STATS}
    >
      <SEO title="Sign In" description="Sign in to your Novara Cleaning account to manage bookings, track membership credits, and schedule cleanings." />
      <AuthCard>
        <div className="space-y-1.5">
          <h1 className="font-jakarta text-[26px] font-bold leading-tight tracking-tight text-slate-900">Welcome back</h1>
          <p className="text-sm text-slate-500">Sign in to manage your bookings and account.</p>
        </div>

        <div className="mt-6 space-y-4">
          {/* Google */}
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full gap-2.5 border-slate-200 font-semibold text-slate-700 hover:bg-slate-50"
            onClick={() => signInWithGoogle("/auth/callback")}
            disabled={isLoading}
          >
            <GoogleIcon className="h-5 w-5" />
            Continue with Google
          </Button>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">or with email</span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          {/* Tabs */}
          <Tabs defaultValue="signin" className="w-full">
            <TabsList className="mb-4 grid h-10 w-full grid-cols-2 rounded-xl bg-slate-100 p-1">
              <TabsTrigger value="signin" className="rounded-lg text-sm font-medium data-[state=active]:bg-white data-[state=active]:shadow-sm">Sign In</TabsTrigger>
              <TabsTrigger value="signup" className="rounded-lg text-sm font-medium data-[state=active]:bg-white data-[state=active]:shadow-sm">Create Account</TabsTrigger>
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
                    <Link href="/reset-password" className="text-xs font-medium text-[#5C0FFE] hover:underline">Forgot password?</Link>
                  </div>
                  <div className="relative">
                    <RiLockLine className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input id="signin-password" type="password" placeholder="Enter your password" value={password} onChange={(e) => setPassword(e.target.value)} className={AUTH_INPUT_CLS} disabled={isLoading} required />
                  </div>
                </div>
                <Button type="submit" className="h-11 w-full font-semibold text-white shadow-lg shadow-[#5C0FFE]/25 transition hover:opacity-95" style={{ background: AUTH_GRADIENT }} disabled={isLoading}>
                  {isLoading ? <><RiLoader4Line className="mr-2 h-4 w-4 animate-spin" />Signing in…</> : "Sign In"}
                </Button>
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
                    <Input id="signup-password" type="password" placeholder="Create a password" value={password} onChange={(e) => setPassword(e.target.value)} className={AUTH_INPUT_CLS} disabled={isLoading} required />
                  </div>
                  <p className="text-xs text-slate-400">Must be at least 6 characters</p>
                </div>
                <Button type="submit" className="h-11 w-full font-semibold text-white shadow-lg shadow-[#5C0FFE]/25 transition hover:opacity-95" style={{ background: AUTH_GRADIENT }} disabled={isLoading}>
                  {isLoading ? <><RiLoader4Line className="mr-2 h-4 w-4 animate-spin" />Creating account…</> : <><RiSparklingLine className="mr-2 h-4 w-4" />Create Account</>}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </div>
      </AuthCard>

      <div className="space-y-2 text-center">
        <p className="text-xs text-slate-500">
          Are you a cleaner?{" "}
          <Link href="/cleaner/auth" className="font-medium text-[#5C0FFE] hover:underline">Cleaner Portal</Link>
        </p>
        <p className="text-[11px] text-slate-400">By continuing, you agree to our Terms of Service and Privacy Policy.</p>
      </div>
    </AuthScaffold>
  );
}
