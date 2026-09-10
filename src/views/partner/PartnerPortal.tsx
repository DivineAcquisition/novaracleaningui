"use client";

// partner.novaracleaning.com — one portal, type-aware.
// Passwordless session (onboarding handoff or magic link). Host and commercial
// stay distinct under one identity. No cleaner/crew contact. No passwords.

import { useEffect, useState } from "react";
import { RiLoader4Line, RiLogoutBoxRLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { SEO } from "@/components/SEO";
import { cn } from "@/lib/utils";
import PartnerMagicLink from "@/views/partner/PartnerMagicLink";
import HostPortalView from "@/views/partner/HostPortalView";
import CommercialPortal from "@/views/partner/CommercialPortal";
import PropertyManagerPortal from "@/views/partner/PropertyManagerPortal";

type Kind = "host" | "commercial" | "property_manager";

const KIND_LABELS: Record<Kind, string> = {
  host: "Host",
  commercial: "Commercial",
  property_manager: "Portfolio",
};

interface Me {
  ok: boolean;
  email: string;
  displayName: string | null;
  kinds: Kind[];
}

function previewFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("preview");
}

function linkNotice(): string | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("link");
  return raw ? decodeURIComponent(raw) : null;
}

export default function PartnerPortal() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<Kind>("host");

  useEffect(() => {
    const preview = previewFromLocation();
    const q = preview ? `?preview=${preview}` : "";
    void fetch(`/api/partner-portal/me${q}`)
      .then((r) => r.json())
      .then((json) => {
        if (json?.ok && (json.kinds || []).length) {
          const kinds = json.kinds as Kind[];
          const requested = previewFromLocation()
            ? null
            : ((typeof window !== "undefined" &&
                new URLSearchParams(window.location.search).get("kind")) as Kind | null) || null;
          setMe(json);
          setView(requested && kinds.includes(requested) ? requested : kinds[0]);
        } else {
          setMe(null);
        }
      })
      .catch(() => setMe(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <RiLoader4Line className="h-8 w-8 animate-spin text-[#5C0FFE]" />
      </div>
    );
  }
  if (!me) return <PartnerMagicLink notice={linkNotice()} />;

  const mixed = me.kinds.length > 1;

  const signOut = async () => {
    await fetch("/api/partner-portal/logout", { method: "POST" });
    window.location.href = "/partner";
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <SEO title="Partner portal" noindex />
      <header className="sticky top-0 z-30 text-white" style={{ background: "linear-gradient(120deg,#5C0FFE 0%,#7A3BFF 55%,#9F7BFF 100%)" }}>
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-white/70">Novara partner portal</p>
            <p className="font-bold">{me.displayName || me.email}</p>
          </div>
          <Button variant="ghost" size="sm" className="text-white hover:bg-white/15" onClick={() => void signOut()}>
            <RiLogoutBoxRLine className="mr-1 h-4 w-4" /> Sign out
          </Button>
        </div>
        {mixed && (
          <div className="mx-auto flex max-w-4xl gap-2 px-4 pb-3">
            {me.kinds.map((kind) => (
              <button
                key={kind}
                onClick={() => setView(kind)}
                className={cn(
                  "rounded-full px-4 py-1.5 text-sm font-medium",
                  view === kind ? "bg-white text-[#5C0FFE]" : "bg-white/15 text-white",
                )}
              >
                {KIND_LABELS[kind] || kind}
              </button>
            ))}
          </div>
        )}
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6">
        {view === "host" && me.kinds.includes("host") ? <HostPortalView /> : null}
        {view === "commercial" && me.kinds.includes("commercial") ? <CommercialPortal /> : null}
        {view === "property_manager" && me.kinds.includes("property_manager") ? (
          <PropertyManagerPortal />
        ) : null}
      </main>
    </div>
  );
}
