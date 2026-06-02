"use client";

// Admin auth — brand-aligned (emerald), light theme, working.
// Email/password sign-in only. On success: checks has_role('admin')
// and redirects to /admin/dashboard or signs out + toasts.

import {
  RiLoader4Line,
  RiLockLine,
  RiMailLine,
  RiShieldStarLine,
  RiArrowRightLine,
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
import { Card, CardContent } from "@/components/ui/card";
import { SEO } from "@/components/SEO";

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
    <div
      className="min-h-screen flex items-center justify-center p-4 bg-slate-50"
      style={{
        backgroundImage:
          "radial-gradient(circle at top left, rgba(22,163,74,0.10), transparent 55%), radial-gradient(circle at bottom right, rgba(14,124,58,0.08), transparent 55%)",
      }}
    >
      <SEO title="Admin Login" noindex />

      <div className="w-full max-w-[400px]">
        {/* Brand + heading */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-violet-700 shadow-md shadow-violet-700/20 mb-4">
            <RiShieldStarLine className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-[22px] font-bold text-slate-900">Novara Admin</h1>
          <p className="text-sm text-slate-500 mt-1">
            Internal console &middot; sign in with your work email
          </p>
        </div>

        <Card className="border border-slate-200 shadow-sm">
          <CardContent className="p-6 sm:p-7">
            <Button
              type="button"
              variant="outline"
              className="w-full h-11 mb-4 font-medium bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
              onClick={handleGoogleSignIn}
              disabled={isLoading}
            >
              <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Continue with Google
            </Button>
            <div className="relative mb-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200" />
              </div>
              <div className="relative flex justify-center text-[11px] uppercase tracking-wider">
                <span className="bg-card px-2 text-slate-400">or work email</span>
              </div>
            </div>
            <form onSubmit={handleSignIn} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="admin-email" className="text-sm font-medium text-slate-700">
                  Work email
                </Label>
                <div className="relative">
                  <RiMailLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    id="admin-email"
                    type="email"
                    placeholder="you@novaracleaning.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10 h-11 bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus-visible:ring-violet-500/30 focus-visible:border-violet-500"
                    disabled={isLoading}
                    autoComplete="email"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="admin-password" className="text-sm font-medium text-slate-700">
                  Password
                </Label>
                <div className="relative">
                  <RiLockLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    id="admin-password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10 h-11 bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus-visible:ring-violet-500/30 focus-visible:border-violet-500"
                    disabled={isLoading}
                    autoComplete="current-password"
                    required
                  />
                </div>
              </div>

              <Button
                type="submit"
                className="w-full h-11 bg-gradient-to-br from-violet-500 to-violet-700 hover:from-violet-600 hover:to-violet-800 text-white font-semibold shadow-sm shadow-violet-700/20 border-0"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <RiLoader4Line className="mr-2 w-4 h-4 animate-spin" />
                    Verifying…
                  </>
                ) : (
                  <>
                    Sign in
                    <RiArrowRightLine className="ml-2 w-4 h-4" />
                  </>
                )}
              </Button>
            </form>

            <p className="mt-5 text-xs text-center text-slate-500">
              Admin access only · Lost access? Email{" "}
              <a className="text-violet-700 underline" href="mailto:support@novaracleaning.com">
                support@novaracleaning.com
              </a>
            </p>
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-[11px] uppercase tracking-wider text-slate-400">
          Novara Cleaning · Admin Console
        </p>
      </div>
    </div>
  );
}
