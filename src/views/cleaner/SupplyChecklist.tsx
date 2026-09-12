"use client";

import { RiLoader4Line } from "@remixicon/react";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";

import UrgentHireReturnLink from "@/components/cleaner/UrgentHireReturnLink";
import { SupplyChecklistForm } from "@/components/cleaner/SupplyChecklistForm";
import type { SupplyInventory, SupplyItem } from "@/lib/cleaner-supplies";

type Payload = {
  ok: true;
  cleaner: { firstName: string; name: string };
  items: SupplyItem[];
  inventory: SupplyInventory;
  submittedAt: string | null;
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
          <p className="text-xs text-muted-foreground">Supply checklist</p>
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

export default function SupplyChecklist() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token || "");
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  const load = useCallback(async () => {
    if (!token) {
      setState({ kind: "blocked", message: "This supply link isn't valid." });
      return;
    }
    try {
      const res = await fetch(`/api/cleaner/supplies/${encodeURIComponent(token)}`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as Partial<Payload> & { error?: string };
      if (!res.ok || !json.ok) {
        setState({ kind: "blocked", message: json.error || "This supply link isn't valid." });
        return;
      }
      setState({ kind: "ready", data: json as Payload });
    } catch {
      setState({ kind: "blocked", message: "Couldn't load this checklist. Try again." });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (owned: SupplyInventory): Promise<SupplyInventory> => {
    const res = await fetch(`/api/cleaner/supplies/${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ owned }),
    });
    const json = (await res.json().catch(() => ({}))) as Partial<Payload> & { error?: string };
    if (!res.ok || !json.ok) {
      throw new Error(json.error || "Couldn't save your checklist.");
    }
    return json.inventory || owned;
  };

  if (state.kind === "loading") {
    return (
      <Shell>
        <Card>
          <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
            <RiLoader4Line className="h-5 w-5 animate-spin" />
            Loading checklist…
          </div>
        </Card>
      </Shell>
    );
  }

  if (state.kind === "blocked") {
    return (
      <Shell>
        <Card>
          <p className="text-sm font-medium text-foreground">Link unavailable</p>
          <p className="mt-2 text-sm text-muted-foreground">{state.message}</p>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <SupplyChecklistForm
        items={state.data.items}
        inventory={state.data.inventory || {}}
        submittedAt={state.data.submittedAt}
        firstName={state.data.cleaner.firstName || "there"}
        onSave={save}
      />
    </Shell>
  );
}
