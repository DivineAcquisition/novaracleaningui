"use client";

// ─── Customer-portal auth callback ─────────────────────────────────────
// Strictly customer-only. Lives at /auth/callback on app.novaracleaning.com.
//
// Hard rules (per the strict-portal-separation contract):
//   * NEVER inspect `cleaners` or `admin_users` here.
//   * NEVER redirect to /cleaner/* or /admin/*.
//   * On a customer auth event, ensure a `customers` row exists for the
//     authenticated email and route to /account.
//   * On password recovery → /update-password.
//
// Cleaner Google OAuth uses /cleaner/auth/callback (contractor.*).
// Admin Google OAuth uses /admin/auth/callback (admin.*).
// Those two callback pages handle their own portal — not this one.

import { RiLoader4Line } from "@remixicon/react";
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SEO } from "@/components/SEO";

export default function AuthCallback() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        // Admin impersonation / magic-link token_hash: verify it FIRST so it
        // becomes the active session on this device. The
        // admin-impersonate-customer function mints a magic-link token_hash so
        // the flow never depends on the Supabase redirect allow-list.
        const tokenHash = searchParams?.get("token_hash");
        if (tokenHash) {
          let otpError: { message: string } | null = null;
          for (const type of ["email", "magiclink"] as const) {
            const { error: vErr } = await supabase.auth.verifyOtp({
              type,
              token_hash: tokenHash,
            });
            otpError = vErr;
            if (!vErr) break;
          }
          if (otpError) {
            const { data: { session: existing } } = await supabase.auth.getSession();
            if (!existing?.user) {
              toast.error(`Sign-in link invalid or expired: ${otpError.message}`);
              router.push("/auth");
              return;
            }
          }
          if (searchParams?.get("impersonated") === "1") {
            toast.success("Signed in as this customer (admin session — actions are logged).");
          }
        }

        const { data: { session }, error } = await supabase.auth.getSession();

        if (error) {
          console.error("Auth callback error:", error);
          toast.error("Authentication failed. Please try again.");
          router.push("/auth");
          return;
        }

        if (!session) {
          toast.error("No session found. Please sign in again.");
          router.push("/auth");
          return;
        }

        // Password recovery is the only branch — everything else is
        // routed to /account. Cleaner/admin paths are intentionally
        // NOT inspected here; users who hit this callback are treated
        // as customers regardless of what other roles they hold.
        const hashParams = new URLSearchParams(
          window.location.hash.substring(1),
        );
        const type = hashParams.get("type");

        if (type === "recovery") {
          router.push("/update-password");
          return;
        }

        // Ensure a customers row exists for this email (Google OAuth
        // newcomers, magic-link first-timers). This used to be wrapped
        // in a cleaner-branch detector — that's gone for strict
        // separation. The cleaners and admin_users tables are NOT
        // touched from this callback.
        const email = session.user.email || "";
        if (email) {
          const { data: customerData } = await supabase
            .from("customers")
            .select("id")
            .eq("email", email)
            .maybeSingle();

          if (!customerData) {
            const fullName =
              (session.user.user_metadata as Record<string, unknown> | null)
                ?.full_name;
            const [firstName = "", ...rest] =
              typeof fullName === "string" ? fullName.split(" ") : [""];
            await supabase
              .from("customers")
              .insert({
                email,
                first_name: firstName || "",
                last_name: rest.join(" ") || "",
              })
              .then(() => null, (err) => {
                console.warn("[AuthCallback] customer insert (non-blocking)", err);
              });
          }
        }

        toast.success("Welcome!");
        router.push("/account");
      } catch (error) {
        console.error("Unexpected error in auth callback:", error);
        toast.error("Something went wrong. Please try again.");
        router.push("/auth");
      }
    };

    handleAuthCallback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  return (
    <div className="min-h-screen bg-gradient-hero flex items-center justify-center">
      <SEO title="Authenticating..." noindex />
      <div className="text-center space-y-4">
        <RiLoader4Line className="w-12 h-12 animate-spin text-primary mx-auto" />
        <p className="text-muted-foreground">Processing authentication...</p>
      </div>
    </div>
  );
}
