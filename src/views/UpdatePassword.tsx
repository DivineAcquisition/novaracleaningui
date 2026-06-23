"use client";

import {
  RiCheckboxCircleLine,
  RiEyeLine,
  RiEyeOffLine,
  RiLoader4Line,
  RiLockLine,
  RiShieldKeyholeLine,
  RiBankCardLine,
} from "@remixicon/react";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { SEO } from "@/components/SEO";
import { AuthScaffold, AuthCard, AUTH_INPUT_CLS, AUTH_GRADIENT } from "@/components/auth/AuthScaffold";

const SECURITY_FEATURES = [
  { icon: RiShieldKeyholeLine, label: "Encrypted by default", desc: "Passwords are hashed — never stored in plain text." },
  { icon: RiBankCardLine, label: "Protects your account", desc: "Keeps your bookings and saved cards secure." },
];

const passwordSchema = z.string().min(6, "Password must be at least 6 characters");

export default function UpdatePassword() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordUpdated, setPasswordUpdated] = useState(false);
  // `checking` covers the PKCE exchange window that happens on first
  // mount. Previously we redirected away the instant getSession()
  // returned null — which is normal during the URL-hash exchange and
  // made the "Invalid or expired reset link" toast fire almost every
  // time, even with a perfectly valid recovery email.
  const [checking, setChecking] = useState(true);

  // Validate the reset link by waiting for either:
  //   1. supabase to fire onAuthStateChange('PASSWORD_RECOVERY' | 'SIGNED_IN')
  //      after consuming the URL token,
  //   2. an existing session to already be present, or
  //   3. a token in the URL hash that we can verify directly.
  // Falls back to a 3-second deadline before declaring the link bad,
  // which is well above the typical PKCE exchange latency (~200 ms).
  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const finish = (ok: boolean) => {
      if (cancelled) return;
      setChecking(false);
      if (!ok) {
        toast.error("Invalid or expired reset link. Please request a new one.");
        router.push("/reset-password");
      }
    };

    // 1) Listen for the auth state event that fires once the PKCE
    //    exchange (or hash token) is consumed.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session)) {
        finish(true);
      }
    });

    // 2) Some links arrive with the session ALREADY established —
    //    poll briefly so we don't miss them.
    let attempts = 0;
    const poll = async () => {
      if (cancelled) return;
      const { data } = await supabase.auth.getSession();
      if (data.session) return finish(true);
      attempts += 1;
      if (attempts < 12) timeoutId = setTimeout(poll, 250); // up to 3 s total
      else finish(false);
    };
    void poll();

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [router]);

  const getPasswordStrength = (pwd: string) => {
    if (pwd.length === 0) return { strength: 0, label: "", color: "" };
    if (pwd.length < 6) return { strength: 25, label: "Weak", color: "bg-red-500" };
    if (pwd.length < 8) return { strength: 50, label: "Fair", color: "bg-orange-500" };
    if (pwd.length < 12) return { strength: 75, label: "Good", color: "bg-amber-500" };
    return { strength: 100, label: "Strong", color: "bg-emerald-500" };
  };

  const passwordStrength = getPasswordStrength(password);

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      passwordSchema.parse(password);
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast.error(error.errors[0].message);
        return;
      }
    }

    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    
    setIsLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    
    if (error) {
      toast.error(error.message || "Failed to update password");
      setIsLoading(false);
    } else {
      setPasswordUpdated(true);
      toast.success("Password updated successfully!");
      setTimeout(() => router.push("/account"), 2000);
    }
  };

  // While the PKCE token exchange is in flight, show a neutral spinner
  // so the user doesn't see "Invalid link" flash + redirect.
  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FAFAFC] px-4">
        <SEO title="Verifying reset link" description="Verifying your password reset link." noindex />
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <RiLoader4Line className="h-7 w-7 animate-spin text-[#5C0FFE]" />
          <p className="text-sm">Verifying your reset link…</p>
        </div>
      </div>
    );
  }

  if (passwordUpdated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FAFAFC] px-4 py-6">
        <SEO title="Password updated" noindex />
        <AuthCard className="w-full max-w-sm text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-lg shadow-[#5C0FFE]/25" style={{ background: AUTH_GRADIENT }}>
            <RiCheckboxCircleLine className="h-7 w-7" />
          </div>
          <h2 className="mt-4 font-jakarta text-xl font-bold tracking-tight text-slate-900">Password updated!</h2>
          <p className="mt-1 text-sm text-slate-500">Redirecting to your account…</p>
          <RiLoader4Line className="mx-auto mt-4 h-5 w-5 animate-spin text-[#5C0FFE]" />
        </AuthCard>
      </div>
    );
  }

  return (
    <AuthScaffold
      eyebrow="Account Security"
      headline={<>Secure your<br />account.</>}
      subline="Choose a new password to protect your Novara account."
      features={SECURITY_FEATURES}
    >
      <SEO title="Update Password" description="Choose a new password for your Novara Cleaning account." noindex />
      <AuthCard>
        <div className="space-y-1.5">
          <h1 className="font-jakarta text-[26px] font-bold leading-tight tracking-tight text-slate-900">Update password</h1>
          <p className="text-sm text-slate-500">Choose a new password for your account.</p>
        </div>

        <form onSubmit={handleUpdatePassword} className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-slate-700">New password</Label>
            <div className="relative">
              <RiLockLine className="absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="Enter new password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={cn(AUTH_INPUT_CLS, "pr-10")}
                disabled={isLoading}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-700"
              >
                {showPassword ? <RiEyeOffLine className="h-4 w-4" /> : <RiEyeLine className="h-4 w-4" />}
              </button>
            </div>
            {password && (
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">Strength</span>
                  <span className={cn(
                    "font-medium",
                    passwordStrength.strength <= 25 && "text-red-500",
                    passwordStrength.strength === 50 && "text-orange-500",
                    passwordStrength.strength === 75 && "text-amber-500",
                    passwordStrength.strength === 100 && "text-emerald-500",
                  )}>{passwordStrength.label}</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-slate-100">
                  <div className={cn("h-1.5 rounded-full transition-all duration-300", passwordStrength.color)} style={{ width: `${passwordStrength.strength}%` }} />
                </div>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirm-password" className="text-slate-700">Confirm password</Label>
            <div className="relative">
              <RiLockLine className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                id="confirm-password"
                type={showPassword ? "text" : "password"}
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={AUTH_INPUT_CLS}
                disabled={isLoading}
                required
              />
            </div>
            {confirmPassword && password !== confirmPassword && (
              <p className="text-xs text-red-500">Passwords do not match</p>
            )}
          </div>

          <Button
            type="submit"
            className="h-11 w-full font-semibold text-white shadow-lg shadow-[#5C0FFE]/25 transition hover:opacity-95"
            style={{ background: AUTH_GRADIENT }}
            disabled={isLoading || password !== confirmPassword}
          >
            {isLoading ? <><RiLoader4Line className="mr-2 h-4 w-4 animate-spin" />Updating…</> : "Update password"}
          </Button>
          <p className="text-center text-[11px] text-slate-400">Minimum 6 characters.</p>
        </form>
      </AuthCard>
    </AuthScaffold>
  );
}
