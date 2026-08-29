"use client";

import {
  RiCheckboxCircleFill,
  RiCircleLine,
  RiLoader4Line,
  RiShieldCheckLine,
} from "@remixicon/react";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

import { Button } from "@/components/ui/button";

type Payload = {
  ok: true;
  complete: boolean;
  cleaner: { firstName: string; name: string; email: string };
  steps: {
    phoneVerified: boolean;
    stripeReady: boolean;
    agreementSigned: boolean;
    onboardingComplete: boolean;
  };
  continueUrl: string;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; data: Payload }
  | { kind: "blocked"; message: string };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="mx-auto w-full max-w-lg space-y-4">
        <div className="text-center">
          <p className="text-sm font-semibold tracking-tight text-slate-900">Novara Cleaning</p>
          <p className="text-xs text-slate-500">Account setup</p>
        </div>
        {children}
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">{children}</div>
  );
}

function StepRow({ done, label }: { done: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2.5 text-sm text-slate-700">
      {done ? (
        <RiCheckboxCircleFill className="h-4 w-4 shrink-0 text-emerald-600" />
      ) : (
        <RiCircleLine className="h-4 w-4 shrink-0 text-slate-400" />
      )}
      <span>{label}</span>
    </li>
  );
}

export default function SetupContinue() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token || "");
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  const load = useCallback(async () => {
    if (!token) {
      setState({ kind: "blocked", message: "This setup link isn't valid." });
      return;
    }
    try {
      const res = await fetch(`/api/cleaner/setup/${encodeURIComponent(token)}`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as Partial<Payload> & { error?: string };
      if (!res.ok || !json.ok) {
        setState({
          kind: "blocked",
          message: json.error || "This setup link isn't valid.",
        });
        return;
      }
      setState({ kind: "ready", data: json as Payload });
    } catch {
      setState({ kind: "blocked", message: "Couldn't load this setup link. Try again." });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.kind === "loading") {
    return (
      <Shell>
        <Card>
          <div className="flex items-center justify-center gap-2 py-8 text-slate-500">
            <RiLoader4Line className="h-5 w-5 animate-spin" />
            Loading…
          </div>
        </Card>
      </Shell>
    );
  }

  if (state.kind === "blocked") {
    return (
      <Shell>
        <Card>
          <p className="text-sm font-medium text-slate-900">Link unavailable</p>
          <p className="mt-2 text-sm text-slate-600">{state.message}</p>
        </Card>
      </Shell>
    );
  }

  const { data } = state;
  const first = data.cleaner.firstName || "there";

  if (data.complete) {
    return (
      <Shell>
        <Card>
          <div className="flex items-start gap-3">
            <RiShieldCheckLine className="mt-0.5 h-5 w-5 text-emerald-600" />
            <div>
              <p className="text-sm font-semibold text-slate-900">You&apos;re all set, {first}</p>
              <p className="mt-1 text-sm text-slate-600">
                Phone and payouts are already connected. Sign in anytime to see jobs.
              </p>
              <Button asChild className="mt-4 bg-violet-700 hover:bg-violet-800">
                <Link href="/cleaner/auth">Open contractor portal</Link>
              </Button>
            </div>
          </div>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <Card>
        <p className="text-lg font-semibold text-slate-900">Finish your account setup</p>
        <p className="mt-1 text-sm text-slate-600">
          Hi {first} — complete the steps below so we can keep sending you jobs and pay you on time.
        </p>
        <ul className="mt-4 space-y-2">
          <StepRow done={data.steps.phoneVerified} label="Verify your phone number" />
          <StepRow done={data.steps.stripeReady} label="Connect payouts (Stripe)" />
          <StepRow done={data.steps.agreementSigned} label="Sign contractor agreement" />
        </ul>
        <Button asChild className="mt-6 w-full bg-violet-700 hover:bg-violet-800">
          <Link href={data.continueUrl}>Continue account setup</Link>
        </Button>
        <p className="mt-3 text-center text-[11px] text-slate-500">
          You&apos;ll sign in (or create your login) with {data.cleaner.email || "your email"}, then finish the remaining steps.
        </p>
      </Card>
    </Shell>
  );
}
