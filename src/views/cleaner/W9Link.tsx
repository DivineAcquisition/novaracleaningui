"use client";

import { RiLoader4Line } from "@remixicon/react";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";

import { W9OnboardingForm } from "@/components/cleaner/W9OnboardingForm";
import UrgentHireReturnLink from "@/components/cleaner/UrgentHireReturnLink";

type Summary = {
  legalName: string;
  tinLast4: string;
  street: string;
  city: string;
  state: string;
  zip: string;
};

type Payload = {
  ok: true;
  cleaner: { firstName: string; lastName: string };
  prefill: { legalName: string; street: string; city: string; state: string; zip: string };
  onFile: boolean;
  summary: Summary | null;
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
          <p className="text-sm font-semibold tracking-tight text-foreground">Novara Cleaning</p>
          <p className="text-xs text-muted-foreground">W-9</p>
        </div>
        {children}
        <UrgentHireReturnLink />
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">{children}</div>
  );
}

export default function W9Link() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token || "");
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  const load = useCallback(async () => {
    if (!token) {
      setState({ kind: "blocked", message: "This W-9 link isn't valid." });
      return;
    }
    try {
      const res = await fetch(`/api/cleaner/w9/${encodeURIComponent(token)}`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as Partial<Payload> & { error?: string };
      if (!res.ok || !json.ok || !json.cleaner || !json.prefill) {
        setState({ kind: "blocked", message: json.error || "This W-9 link isn't valid." });
        return;
      }
      setState({ kind: "ready", data: json as Payload });
    } catch {
      setState({ kind: "blocked", message: "Couldn't load this W-9. Try again." });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.kind === "loading") {
    return (
      <Shell>
        <Card>
          <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <RiLoader4Line className="h-4 w-4 animate-spin" />
            Opening your W-9…
          </p>
        </Card>
      </Shell>
    );
  }

  if (state.kind === "blocked") {
    return (
      <Shell>
        <Card>
          <p className="text-sm text-foreground">{state.message}</p>
        </Card>
      </Shell>
    );
  }

  const data = state.data;
  const name = data.prefill.legalName.trim().split(/\s+/);
  const firstName = data.cleaner.firstName || name[0] || "";
  const lastName = data.cleaner.lastName || name.slice(1).join(" ");

  return (
    <Shell>
      <Card>
        <h1 className="mb-3 text-lg font-semibold text-foreground">Submit your W-9</h1>
        <W9OnboardingForm
          firstName={firstName}
          lastName={lastName}
          street={data.prefill.street}
          city={data.prefill.city}
          state={data.prefill.state}
          zip={data.prefill.zip}
          done={data.onFile}
          onFile={data.summary}
          onSubmitted={async () => {}}
          saveW9={async (input) => {
            const res = await fetch(`/api/cleaner/w9/${encodeURIComponent(token)}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ certified: true, ...input }),
            });
            const json = (await res.json().catch(() => ({}))) as Partial<Summary> & { error?: string; ok?: boolean };
            if (!res.ok || !json.ok) {
              throw new Error(json.error || "Couldn't save the W-9.");
            }
            const saved: Summary = {
              legalName: String(json.legalName || input.legalName),
              tinLast4: String(json.tinLast4 || ""),
              street: String(json.street || input.street),
              city: String(json.city || input.city),
              state: String(json.state || input.state),
              zip: String(json.zip || input.zip),
            };
            setState({
              kind: "ready",
              data: { ...data, onFile: true, summary: saved, prefill: { ...data.prefill, ...saved } },
            });
            return saved;
          }}
        />
      </Card>
    </Shell>
  );
}
