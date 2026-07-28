"use client";

// ─── eod.novaracleaning.com ───────────────────────────────────────────────────
//
// Sign in, then one adaptive form for the day. Identity comes from the session
// and is never typed — the server maps the signed-in user to their VA record
// and will only ever read or write that person's day.

import {
  RiArrowRightLine,
  RiCalendarCheckLine,
  RiLoader4Line,
  RiLockLine,
  RiLogoutBoxRLine,
  RiMailLine,
  RiShieldCheckLine,
  RiSpeedUpLine,
  RiTimerFlashLine,
} from "@remixicon/react";
import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { AuthCard, AuthScaffold, AUTH_GRADIENT, AUTH_INPUT_CLS } from "@/components/auth/AuthScaffold";
import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

import EodForm from "./EodForm";
import type { BootstrapPayload } from "./types";

const FEATURES = [
  {
    icon: RiShieldCheckLine,
    label: "Pre-filled, not re-typed",
    desc: "Hours, calls, bookings and screens are already recorded.",
  },
  {
    icon: RiTimerFlashLine,
    label: "Under five minutes",
    desc: "Only the questions matching today's work appear.",
  },
  {
    icon: RiSpeedUpLine,
    label: "Your context matters",
    desc: "Blockers and notes are never scored — say what's real.",
  },
];

/**
 * `token` comes from /eod/[token] — the personal link emailed to the VA. It is
 * the credential, so when it's present we skip sign-in entirely: most VAs have
 * no workspace login, and requiring one is what made this form unreachable.
 *
 * Without a token we fall back to the workspace session, which is how an admin
 * (or a VA who does have a login) reaches /eod directly.
 */
export default function EodReport({ token }: { token?: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    if (token) {
      setCheckingSession(false);
      return;
    }
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setCheckingSession(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [token]);

  if (checkingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FAFAFC]">
        <RiLoader4Line className="h-6 w-6 animate-spin text-[#5C0FFE]" />
      </div>
    );
  }

  if (!token && !session) return <SignIn />;
  return <Report token={token} sessionEmail={session?.user.email ?? null} />;
}

// ─── Sign-in ──────────────────────────────────────────────────────────────────

function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    setBusy(false);
    if (error) {
      toast.error(
        error.message.includes("Invalid login credentials")
          ? "That email and password don't match."
          : error.message,
      );
    }
  };

  return (
    <AuthScaffold
      eyebrow="End of Day"
      headline={
        <>
          Review what we
          <br />
          recorded.
        </>
      }
      subline="Your EOD is mostly filled in already. Confirm the numbers, add the context we can't see, and you're done."
      features={FEATURES}
    >
      <SEO title="End of Day Report" noindex />
      <AuthCard>
        <div className="space-y-1.5">
          <h1 className="font-jakarta text-[26px] font-bold leading-tight tracking-tight text-slate-900">
            End of day
          </h1>
          <p className="text-sm text-slate-500">Sign in with your Novara work email.</p>
        </div>

        <form onSubmit={signIn} className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="eod-email" className="text-slate-700">
              Work email
            </Label>
            <div className="relative">
              <RiMailLine className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                id="eod-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@novaracleaning.com"
                className={AUTH_INPUT_CLS}
                disabled={busy}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="eod-password" className="text-slate-700">
              Password
            </Label>
            <div className="relative">
              <RiLockLine className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                id="eod-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className={AUTH_INPUT_CLS}
                disabled={busy}
              />
            </div>
          </div>
          <Button
            type="submit"
            disabled={busy}
            className="h-11 w-full font-semibold text-white shadow-lg shadow-[#5C0FFE]/25 transition hover:opacity-95"
            style={{ background: AUTH_GRADIENT }}
          >
            {busy ? (
              <>
                <RiLoader4Line className="mr-2 h-4 w-4 animate-spin" />
                Signing in…
              </>
            ) : (
              <>
                Sign in
                <RiArrowRightLine className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
        </form>

        <p className="mt-4 text-center text-xs text-slate-500">
          Same login as the workspace. Lost access?{" "}
          <a className="text-[#5C0FFE] hover:underline" href="mailto:support@novaracleaning.com">
            support@novaracleaning.com
          </a>
        </p>
      </AuthCard>
    </AuthScaffold>
  );
}

// ─── The report ───────────────────────────────────────────────────────────────

function Report({ token, sessionEmail }: { token?: string; sessionEmail: string | null }) {
  const [boot, setBoot] = useState<BootstrapPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const api = useCallback(
    async (body: Record<string, unknown>) => {
      // With a token the request carries its own identity; otherwise fall back
      // to the workspace session.
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (!token) {
        const { data } = await supabase.auth.getSession();
        headers.Authorization = `Bearer ${data.session?.access_token || ""}`;
      }
      const res = await fetch("/api/va/eod", {
        method: "POST",
        headers,
        body: JSON.stringify(token ? { ...body, token } : body),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return { ok: res.ok && json.ok !== false, data: json };
    },
    [token],
  );

  const load = useCallback(
    async (workDate?: string) => {
      setLoading(true);
      const res = await api({ action: "bootstrap", workDate });
      setLoading(false);
      if (!res.ok) {
        setError(
          String(
            res.data.error ||
              "Something went wrong on our end. Try again in a moment — nothing you've typed is lost.",
          ),
        );
        setBoot(null);
        return;
      }
      setError(null);
      setBoot(res.data as unknown as BootstrapPayload);
    },
    [api],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <div className="min-h-screen bg-[#FAFAFC]">
      <SEO title="End of Day Report" noindex />
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4 sm:px-6">
          <span
            className="flex h-7 w-7 items-center justify-center rounded-lg text-white"
            style={{ background: AUTH_GRADIENT }}
            aria-hidden
          >
            <RiCalendarCheckLine className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h1 className="font-jakarta text-sm font-semibold tracking-tight text-slate-900">
              End of day
            </h1>
            {boot && <p className="truncate text-[11px] text-slate-500">{boot.va.name}</p>}
          </div>
          {token ? (
            <span className="ml-auto truncate text-xs text-slate-400">{boot?.va.email}</span>
          ) : (
            <button
              onClick={signOut}
              className="ml-auto flex items-center gap-1.5 text-xs text-slate-500 transition-colors hover:text-slate-900"
            >
              <RiLogoutBoxRLine className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{sessionEmail}</span>
              <span className="sm:hidden">Sign out</span>
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        {error ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
            <p className="font-semibold">We couldn&apos;t open your EOD.</p>
            <p className="mt-1 leading-relaxed">{error}</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : loading && !boot ? (
          <div className="space-y-4">
            <Skeleton className="h-9 w-48" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : boot ? (
          <>
            <DatePicker boot={boot} onPick={(d) => void load(d)} loading={loading} />
            <div className="mt-5">
              <EodForm boot={boot} onReload={load} api={api} />
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}

function DatePicker({
  boot,
  onPick,
  loading,
}: {
  boot: BootstrapPayload;
  onPick: (date: string) => void;
  loading: boolean;
}) {
  const label = (date: string) => {
    const today = boot.allowedDates[0];
    if (date === today) return "Today";
    if (date === boot.allowedDates[1]) return "Yesterday";
    return new Date(`${date}T12:00:00.000Z`).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  };

  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-1 self-start rounded-lg bg-slate-100 p-1">
        {boot.allowedDates.map((date) => (
          <button
            key={date}
            onClick={() => onPick(date)}
            disabled={loading}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60",
              boot.workDate === date
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900",
            )}
          >
            {label(date)}
          </button>
        ))}
      </div>
      {loading && <RiLoader4Line className="h-4 w-4 animate-spin text-slate-400" />}
    </div>
  );
}
