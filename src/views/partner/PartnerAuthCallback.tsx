"use client";

// ─── Partner (host) auth callback ──────────────────────────────────────────
// Lives at /partner/auth/callback on partner.novaracleaning.com. Handles the
// landing from every host auth link (signup confirm, magic link, password
// recovery). detectSessionInUrl establishes the session; we then route:
//   recovery  → /partner?mode=reset (set a new password)
//   otherwise → ensure the host profile, then /partner/dashboard

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { RiLoader4Line } from "@remixicon/react";
import { supabase } from "@/integrations/supabase/client";
import { SEO } from "@/components/SEO";

export default function PartnerAuthCallback() {
  const router = useRouter();
  useEffect(() => {
    (async () => {
      try {
        // OAuth (Google) returns a ?code that supabase-js exchanges for a
        // session via detectSessionInUrl. That can lag the first getSession()
        // read, so retry briefly before giving up — otherwise a valid Google
        // sign-in bounces back to the login screen.
        let session = (await supabase.auth.getSession()).data.session;
        for (let i = 0; i < 5 && !session; i++) {
          await new Promise((r) => setTimeout(r, 500));
          session = (await supabase.auth.getSession()).data.session;
        }
        if (!session) { router.replace("/partner"); return; }

        const hashType = new URLSearchParams(window.location.hash.substring(1)).get("type");
        const queryType = new URLSearchParams(window.location.search).get("type");
        if (hashType === "recovery" || queryType === "recovery") {
          router.replace("/partner?mode=reset");
          return;
        }

        // First login / confirm → make sure the host profile exists.
        await supabase.functions.invoke("partner-turnover", { body: { action: "host.ensure" } }).catch(() => {});
        router.replace("/partner/dashboard");
      } catch {
        router.replace("/partner");
      }
    })();
  }, [router]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 to-background flex items-center justify-center">
      <SEO title="Signing you in…" noindex />
      <div className="text-center space-y-4">
        <RiLoader4Line className="w-10 h-10 animate-spin mx-auto" style={{ color: "#5C0FFE" }} />
        <p className="text-muted-foreground">Signing you in…</p>
      </div>
    </div>
  );
}
