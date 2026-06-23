"use client";

// Admin auth — brand-aligned (emerald), light theme, working.
// Email/password sign-in only. On success: checks has_role('admin')
// and redirects to /admin/dashboard or signs out + toasts.

import {
  RiLoader4Line,
  RiLockLine,
  RiMailLine,
  RiArrowRightLine,
  RiDashboardLine,
  RiBankCardLine,
  RiLineChartLine,
} from "@remixicon/react";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SEO } from "@/components/SEO";
import { AuthScaffold, AuthCard, GoogleIcon, AUTH_INPUT_CLS, AUTH_GRADIENT } from "@/components/auth/AuthScaffold";

const ADMIN_FEATURES = [
  { icon: RiDashboardLine, label: "Live operations", desc: "Bookings, dispatch & metrics in real time." },
  { icon: RiBankCardLine, label: "Payroll & payouts", desc: "Stripe Connect cleaner payouts in one place." },
  { icon: RiLineChartLine, label: "Sales intelligence", desc: "Per-VA leads, revenue & conversion trends." },
];

const emailSchema = z.string().email("Please enter a valid email address");
const passwordSchema = z.string().min(6, "Password must be at least 6 characters");

export default function AdminAuth() {
  const router = useRouter();
  const { user, signIn, signInWithGoogle } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // When a session lands (either from a fresh sign-in or a returning
  // visitor), verify admin role before letting them into /admin.
  useEffect(() => {
    if (!user) return;
    void verifyAdminAndRoute();
  }, [user]);

  const verifyAdminAndRoute = async () => {
    if (!user) return;
    try {
      // Admin console accepts both admin and VA (virtual assistant) roles.
      const { data, error } = await (supabase.rpc as any)("is_admin_or_va", {
        _uid: user.id,
      });
      if (error) {
        toast.error("Failed to verify access", { description: error.message });
        return;
      }
      if (data === true) {
        router.push("/admin/dashboard");
      } else {
        toast.error("Access denied", {
          description: "Your account doesn't have admin or VA permissions.",
        });
        await supabase.auth.signOut();
      }
    } catch (err: any) {
      toast.error("Verification failed", { description: err?.message || String(err) });
    }
  };

  const validate = () => {
    try {
      emailSchema.parse(email);
      passwordSchema.parse(password);
      return true;
    } catch (err) {
      if (err instanceof z.ZodError) toast.error(err.errors[0].message);
      return false;
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setIsLoading(true);
    const { error } = await signIn(email, password);
    if (error) {
      if (error.message?.includes("Invalid login credentials")) {
        toast.error("Invalid email or password");
      } else {
        toast.error(error.message || "Failed to sign in");
      }
    }
    // verifyAdminAndRoute runs from the useEffect once user is set.
    setIsLoading(false);
  };

  // Strict-portal-separation contract: Google OAuth started on the admin
  // domain MUST come back to /admin/auth/callback (not the customer
  // /auth/callback). The callback page verifies has_role('admin') before
  // letting the user into /admin/dashboard.
  const handleGoogleSignIn = async () => {
    try {
      await signInWithGoogle("/admin/auth/callback");
    } catch (err) {
      toast.error("Google sign-in failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <AuthScaffold
      eyebrow="Admin Console"
      headline={<>Run the whole<br />operation.</>}
      subline="Internal console for bookings, dispatch, payroll, and sales — sign in with your work email."
      features={ADMIN_FEATURES}
    >
      <SEO title="Admin Login" noindex />
      <AuthCard>
        <div className="space-y-1.5">
          <h1 className="font-jakarta text-[26px] font-bold leading-tight tracking-tight text-slate-900">Novara Admin</h1>
          <p className="text-sm text-slate-500">Internal console · sign in with your work email.</p>
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
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">or work email</span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          <form onSubmit={handleSignIn} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="admin-email" className="text-slate-700">Work email</Label>
              <div className="relative">
                <RiMailLine className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input id="admin-email" type="email" placeholder="you@novaracleaning.com" value={email} onChange={(e) => setEmail(e.target.value)} className={AUTH_INPUT_CLS} disabled={isLoading} autoComplete="email" required />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admin-password" className="text-slate-700">Password</Label>
              <div className="relative">
                <RiLockLine className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input id="admin-password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} className={AUTH_INPUT_CLS} disabled={isLoading} autoComplete="current-password" required />
              </div>
            </div>
            <Button type="submit" className="h-11 w-full font-semibold text-white shadow-lg shadow-[#4F38FF]/25 transition hover:opacity-95" style={{ background: AUTH_GRADIENT }} disabled={isLoading}>
              {isLoading ? <><RiLoader4Line className="mr-2 h-4 w-4 animate-spin" />Verifying…</> : <>Sign in<RiArrowRightLine className="ml-2 h-4 w-4" /></>}
            </Button>
          </form>

          <p className="text-center text-xs text-slate-500">
            Admin access only · Lost access? Email{" "}
            <a className="text-[#4F38FF] hover:underline" href="mailto:support@novaracleaning.com">support@novaracleaning.com</a>
          </p>
        </div>
      </AuthCard>
    </AuthScaffold>
  );
}
