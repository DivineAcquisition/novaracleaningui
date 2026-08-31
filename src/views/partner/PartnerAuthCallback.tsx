"use client";

// Leftover Supabase auth-callback links (old Google / password recovery)
// never create or reset a partner password. They land on the passwordless
// magic-link screen.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { RiLoader4Line } from "@remixicon/react";
import { SEO } from "@/components/SEO";

export default function PartnerAuthCallback() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/partner");
  }, [router]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 to-background flex items-center justify-center">
      <SEO title="Signing you in…" noindex />
      <div className="text-center space-y-4">
        <RiLoader4Line className="w-10 h-10 animate-spin mx-auto" style={{ color: "#5C0FFE" }} />
        <p className="text-muted-foreground">Taking you to the partner portal…</p>
      </div>
    </div>
  );
}
