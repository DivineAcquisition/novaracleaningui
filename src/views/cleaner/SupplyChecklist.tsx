"use client";

import {
  RiCheckboxCircleFill,
  RiDownloadLine,
  RiLoader4Line,
} from "@remixicon/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  SUPPLY_CATEGORY_LABEL,
  SUPPLY_CHECKLIST_PDF,
  SUPPLY_READY_PERCENT,
  type SupplyCategory,
  type SupplyItem,
} from "@/lib/cleaner-supplies";

type Score = {
  ownedNeeded: number;
  totalNeeded: number;
  percent: number;
  ready: boolean;
  threshold: number;
  requiredPercent: number;
};

type Payload = {
  ok: true;
  cleaner: { firstName: string; name: string };
  items: SupplyItem[];
  inventory: Record<string, boolean>;
  score: Score;
  submittedAt: string | null;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; data: Payload }
  | { kind: "blocked"; message: string }
  | { kind: "saved"; data: Payload };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto w-full max-w-lg space-y-4">
        <div className="text-center">
          <p className="text-sm font-semibold tracking-tight text-slate-900">Novara Cleaning</p>
          <p className="text-xs text-slate-500">Supply checklist</p>
        </div>
        {children}
      </div>
    </div>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${className || ""}`}>
      {children}
    </div>
  );
}

// Commercial equipment sits last: it never counts toward job readiness, and
// most contractors will tick none of it. Declaring a scrubber is what makes
// someone eligible for the sites whose walkthrough said one is needed.
const CATEGORY_ORDER: SupplyCategory[] = ["solutions", "tools", "safety", "optional", "commercial_equipment"];

export default function SupplyChecklist() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token || "");
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [owned, setOwned] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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
      const data = json as Payload;
      setOwned({ ...(data.inventory || {}) });
      setState({ kind: "ready", data });
    } catch {
      setState({ kind: "blocked", message: "Couldn't load this checklist. Try again." });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const items = state.kind === "ready" || state.kind === "saved" ? state.data.items : [];
  const liveScore = useMemo(() => {
    const needed = items.filter((i) => i.neededForJob);
    const ownedNeeded = needed.filter((i) => owned[i.id]).length;
    const totalNeeded = needed.length;
    const threshold = Math.ceil((totalNeeded * SUPPLY_READY_PERCENT) / 100);
    const percent = totalNeeded === 0 ? 0 : Math.round((ownedNeeded / totalNeeded) * 100);
    return {
      ownedNeeded,
      totalNeeded,
      percent,
      ready: ownedNeeded >= threshold,
      threshold,
      requiredPercent: SUPPLY_READY_PERCENT,
    };
  }, [items, owned]);

  const toggle = (id: string, next: boolean) => {
    setOwned((prev) => ({ ...prev, [id]: next }));
    setSaveError(null);
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/cleaner/supplies/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owned }),
      });
      const json = (await res.json().catch(() => ({}))) as Partial<Payload> & { error?: string };
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Couldn't save your checklist.");
      }
      const base = state.kind === "ready" || state.kind === "saved" ? state.data : null;
      if (!base) throw new Error("Session expired — reload the page.");
      setState({
        kind: "saved",
        data: {
          ...base,
          inventory: (json as Payload).inventory || owned,
          score: (json as Payload).score || liveScore,
          submittedAt: (json as { submittedAt?: string }).submittedAt || new Date().toISOString(),
        },
      });
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (state.kind === "loading") {
    return (
      <Shell>
        <Card>
          <div className="flex items-center justify-center gap-2 py-8 text-slate-500">
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
          <p className="text-sm font-medium text-slate-900">Link unavailable</p>
          <p className="mt-2 text-sm text-slate-600">{state.message}</p>
        </Card>
      </Shell>
    );
  }

  const first = state.data.cleaner.firstName || "there";
  const byCategory = CATEGORY_ORDER.map((cat) => ({
    cat,
    label: SUPPLY_CATEGORY_LABEL[cat],
    rows: items.filter((i) => i.category === cat),
  })).filter((g) => g.rows.length > 0);

  return (
    <Shell>
      <Card>
        <p className="text-lg font-semibold text-slate-900">What supplies do you have?</p>
        <p className="mt-1 text-sm text-slate-600">
          Hi {first} — check off what you already own. You don&apos;t need every essential on day one;
          we look for about {SUPPLY_READY_PERCENT}% of the job-needed items ({liveScore.threshold} of{" "}
          {liveScore.totalNeeded}). Commercial equipment at the bottom is optional — ticking it puts you in
          line for larger sites that need it.
        </p>
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="font-medium text-slate-800">
              Job-needed: {liveScore.ownedNeeded}/{liveScore.totalNeeded} ({liveScore.percent}%)
            </span>
            {liveScore.ready ? (
              <span className="inline-flex items-center gap-1 text-emerald-700 text-xs font-semibold">
                <RiCheckboxCircleFill className="h-3.5 w-3.5" />
                Ready
              </span>
            ) : (
              <span className="text-xs text-amber-700 font-medium">
                Need {Math.max(0, liveScore.threshold - liveScore.ownedNeeded)} more
              </span>
            )}
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
            <div
              className={`h-full rounded-full transition-all ${liveScore.ready ? "bg-emerald-500" : "bg-violet-600"}`}
              style={{ width: `${Math.min(100, liveScore.percent)}%` }}
            />
          </div>
        </div>
        <a
          href={SUPPLY_CHECKLIST_PDF}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-violet-700 hover:underline"
        >
          <RiDownloadLine className="h-3.5 w-3.5" />
          Download full PDF checklist
        </a>
      </Card>

      {byCategory.map((group) => (
        <Card key={group.cat}>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-3">
            {group.label}
            {group.cat === "optional" ? " (not required)" : null}
          </p>
          <ul className="space-y-2.5">
            {group.rows.map((item) => (
              <li key={item.id} className="flex items-start gap-3">
                <Checkbox
                  id={item.id}
                  checked={owned[item.id] === true}
                  onCheckedChange={(v) => toggle(item.id, v === true)}
                  className="mt-0.5"
                />
                <label htmlFor={item.id} className="text-sm text-slate-800 cursor-pointer leading-snug">
                  {item.label}
                  {item.neededForJob ? (
                    <span className="ml-1.5 text-[10px] uppercase tracking-wide text-violet-600 font-semibold">
                      needed
                    </span>
                  ) : null}
                </label>
              </li>
            ))}
          </ul>
        </Card>
      ))}

      <Card>
        {state.kind === "saved" ? (
          <p className="mb-3 text-sm text-emerald-700 font-medium">
            Saved — thanks. You can update this anytime with the same link.
          </p>
        ) : null}
        {saveError ? <p className="mb-3 text-sm text-rose-600">{saveError}</p> : null}
        <Button
          className="w-full bg-violet-700 hover:bg-violet-800"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? (
            <>
              <RiLoader4Line className="mr-2 h-4 w-4 animate-spin" />
              Saving…
            </>
          ) : (
            "Save my supplies"
          )}
        </Button>
        <p className="mt-3 text-center text-[11px] text-slate-500">
          Tip: keep bathroom supplies in a separate tote from the rest of the house.
        </p>
      </Card>
    </Shell>
  );
}
