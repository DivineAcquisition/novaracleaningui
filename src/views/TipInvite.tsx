"use client";

// Tokenized tip-only page (/leave-tip/[token]).
// Reuses the job_feedback token so the customer can tip the crew without
// going through the full feedback questionnaire.

import { useEffect, useMemo, useState } from "react";
import {
  RiErrorWarningLine,
  RiHeart3Fill,
  RiLoader4Line,
  RiTimeLine,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandAtmosphere } from "@/components/brand/atmosphere";
import { supabase } from "@/integrations/supabase/client";

const TIP_PRESETS = [500, 1000, 2000, 3000, 5000];

interface CrewMember {
  id: string;
  name: string;
}

interface InviteMeta {
  ok: boolean;
  error?: string;
  firstName?: string | null;
  bookingRef?: string | null;
  serviceLabel?: string | null;
  serviceDate?: string | null;
  city?: string | null;
  crew?: CrewMember[];
  bookingId?: string;
}

export default function TipInvite({ token }: { token: string }) {
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState<InviteMeta | null>(null);
  const [tipAmount, setTipAmount] = useState<number | null>(1000);
  const [customTip, setCustomTip] = useState("");
  const [directedCleanerId, setDirectedCleanerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data, error: invokeErr } = await supabase.functions.invoke("tip-cleaner", {
          body: { action: "resolve_token", token },
        });
        if (cancelled) return;
        if (invokeErr) throw invokeErr;
        const d = data as InviteMeta;
        if (!d?.ok) {
          setMeta({ ok: false, error: d?.error || "invalid" });
        } else {
          setMeta(d);
        }
      } catch {
        if (!cancelled) setMeta({ ok: false, error: "invalid" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const effectiveTipCents = useMemo(() => {
    if (tipAmount) return tipAmount;
    const custom = Math.round(parseFloat(customTip) * 100);
    return Number.isFinite(custom) && custom > 0 ? custom : 0;
  }, [tipAmount, customTip]);

  const crew = meta?.crew || [];

  const startTip = async () => {
    setError(null);
    if (!meta?.bookingId) return;
    if (effectiveTipCents < 100) {
      setError("Tips start at $1.");
      return;
    }
    setBusy(true);
    try {
      const origin = typeof window !== "undefined" ? window.location.origin : "https://app.novaracleaning.com";
      const { data, error: invokeErr } = await supabase.functions.invoke("tip-cleaner", {
        body: {
          action: "checkout",
          bookingId: meta.bookingId,
          amountCents: effectiveTipCents,
          ...(directedCleanerId ? { directedCleanerId } : {}),
          successUrl: `${origin.replace("try.", "app.")}/tip/success?session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: typeof window !== "undefined" ? window.location.href : undefined,
        },
      });
      if (invokeErr) throw invokeErr;
      const d = data as { ok?: boolean; url?: string; error?: string };
      if (!d?.ok || !d.url) throw new Error(d?.error || "Could not start tip checkout");
      window.location.href = d.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start tip checkout.");
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <Shell>
        <div className="text-center py-16">
          <RiLoader4Line className="w-8 h-8 animate-spin text-primary mx-auto" />
        </div>
      </Shell>
    );
  }

  if (!meta?.ok) {
    const expired = meta?.error === "expired";
    return (
      <Shell>
        <div className="rounded-3xl token-card p-8 text-center space-y-3">
          {expired ? (
            <RiTimeLine className="w-10 h-10 text-amber-500 mx-auto" />
          ) : (
            <RiErrorWarningLine className="w-10 h-10 text-amber-500 mx-auto" />
          )}
          <h1 className="text-xl font-bold text-foreground">
            {expired ? "This link has expired" : "Link not found"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Need help tipping your crew? Email{" "}
            <a className="text-primary underline" href="mailto:hello@novaracleaning.com">
              hello@novaracleaning.com
            </a>
            .
          </p>
        </div>
      </Shell>
    );
  }

  const firstName = meta.firstName?.trim() || "there";
  const crewLabel = crew.length > 1 ? "crew" : "cleaner";

  return (
    <Shell>
      <div className="rounded-3xl token-card p-6 sm:p-8 space-y-6">
        <div className="text-center space-y-2">
          <div className="w-14 h-14 rounded-2xl bg-brand-50 flex items-center justify-center mx-auto">
            <RiHeart3Fill className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Hi {firstName} — tip your {crewLabel}</h1>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            100% of your tip goes to{" "}
            {crew.length > 1
              ? "your cleaning crew, split equally unless you pick someone"
              : crew[0]?.name || "your cleaner"}
            . Novara takes nothing.
          </p>
          {(meta.bookingRef || meta.serviceDate || meta.city) && (
            <p className="text-xs text-muted-foreground">
              {[meta.bookingRef, meta.serviceLabel, meta.serviceDate, meta.city].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {TIP_PRESETS.map((cents) => (
            <button
              key={cents}
              type="button"
              onClick={() => {
                setTipAmount(cents);
                setCustomTip("");
              }}
              className={`choice-chip py-3 font-bold text-lg ${
                tipAmount === cents
                  ? "choice-chip-active"
                  : ""
              }`}
            >
              ${cents / 100}
            </button>
          ))}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="custom-tip">Custom amount</Label>
          <Input
            id="custom-tip"
            type="number"
            inputMode="decimal"
            min={1}
            max={500}
            placeholder="$"
            value={customTip}
            onChange={(e) => {
              setCustomTip(e.target.value);
              setTipAmount(null);
            }}
          />
        </div>

        {crew.length > 1 && (
          <div className="space-y-1.5">
            <Label>Who is this for?</Label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setDirectedCleanerId("")}
                className={`rounded-full border px-3 py-1.5 text-sm ${
                  !directedCleanerId
                    ? "choice-chip-active border-primary/50"
                    : "border-border text-muted-foreground"
                }`}
              >
                Split across the crew
              </button>
              {crew.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setDirectedCleanerId(c.id)}
                  className={`rounded-full border px-3 py-1.5 text-sm ${
                    directedCleanerId === c.id
                      ? "choice-chip-active border-primary/50"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button className="w-full" size="lg" onClick={startTip} disabled={busy}>
          {busy ? <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" /> : null}
          {busy ? "Opening checkout…" : `Tip $${(effectiveTipCents / 100).toFixed(0)}`}
        </Button>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen bg-background flex items-center justify-center p-6">
      <BrandAtmosphere />
      <div className="relative z-10 w-full max-w-md">{children}</div>
    </div>
  );
}
