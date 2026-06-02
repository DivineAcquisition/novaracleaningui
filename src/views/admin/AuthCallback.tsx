"use client";

// ─── Admin-portal Google OAuth callback ────────────────────────────────
// Strictly admin-only. Lives at /admin/auth/callback on
// admin.novaracleaning.com.
//
// Hard rules (per the strict-portal-separation contract):
//   * NEVER inspect `customers` or `cleaners` here.
//   * NEVER redirect to /account, /cleaner/*, or /portal/*.
//   * Verify the signed-in user has the 'admin' role via has_role RPC.
//     - admin → /admin/dashboard
//     - not admin → toast "Access denied" + sign-out + back to /admin/auth.

import { RiLoader4Line } from "@remixicon/react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SEO } from "@/components/SEO";

export default function AdminAuthCallback() {
  const router = useRouter();

  useEffect(() => {
    void handleCallback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCallback = async () => {
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error || !session?.user) {
        toast.error("Authentication failed. Please try again.");
        router.replace("/admin/auth");
        return;
      }

      // Admin console accepts both admin and VA (virtual assistant) roles.
      const { data: hasPortalAccess, error: roleError } = await (supabase.rpc as any)(
        "is_admin_or_va",
        { _uid: session.user.id },
      );

      if (roleError) {
        toast.error("Failed to verify access", {
          description: roleError.message,
        });
        router.replace("/admin/auth");
        return;
      }

      if (hasPortalAccess === true) {
        toast.success("Welcome back.");
        router.replace("/admin/dashboard");
        return;
      }

      // Strict separation: this signed-in user MIGHT be a customer or
      // cleaner, but we don't care here. We sign them out of the admin
      // session and send them to /admin/auth. They can re-enter via
      // their own portal.
      toast.error("Access denied", {
        description: "This account doesn't have admin permissions.",
      });
      await supabase.auth.signOut();
      router.replace("/admin/auth");
    } catch (err) {
      console.error("[admin/auth/callback] error", err);
      toast.error("Something went wrong. Please try again.");
      router.replace("/admin/auth");
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
      <SEO title="Admin Sign-in" noindex />
      <div className="text-center space-y-4">
        <RiLoader4Line className="w-10 h-10 animate-spin text-violet-700 mx-auto" />
        <p className="text-sm text-slate-600">Verifying admin access…</p>
      </div>
    </div>
  );
}
