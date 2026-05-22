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
  const { user, signIn } = useAuth();
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
      const { data, error } = await supabase.rpc("has_role", {
        _user_id: user.id,
        _role: "admin",
      });
      if (error) {
        toast.error("Failed to verify admin access", { description: error.message });
        return;
      }
      if (data === true) {
        router.push("/admin/dashboard");
      } else {
        toast.error("Access denied", {
          description: "Your account doesn't have admin permissions.",
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
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 shadow-md shadow-emerald-700/20 mb-4">
            <RiShieldStarLine className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-[22px] font-bold text-slate-900">Novara Admin</h1>
          <p className="text-sm text-slate-500 mt-1">
            Internal console &middot; sign in with your work email
          </p>
        </div>

        <Card className="border border-slate-200 shadow-sm">
          <CardContent className="p-6 sm:p-7">
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
                    className="pl-10 h-11 bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus-visible:ring-emerald-500/30 focus-visible:border-emerald-500"
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
                    className="pl-10 h-11 bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus-visible:ring-emerald-500/30 focus-visible:border-emerald-500"
                    disabled={isLoading}
                    autoComplete="current-password"
                    required
                  />
                </div>
              </div>

              <Button
                type="submit"
                className="w-full h-11 bg-gradient-to-br from-emerald-500 to-emerald-700 hover:from-emerald-600 hover:to-emerald-800 text-white font-semibold shadow-sm shadow-emerald-700/20 border-0"
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
              <a className="text-emerald-700 underline" href="mailto:support@novaracleaning.com">
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
