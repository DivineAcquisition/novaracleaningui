"use client";

// Operations tab in the contractor sheet: the kit a contractor says they own,
// how they get paid (read from the same payout profile the Payroll tab uses),
// and a placeholder for the supplies reimbursement program.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  RiAlertLine,
  RiBankCardLine,
  RiCheckboxCircleFill,
  RiCircleLine,
  RiExternalLinkLine,
  RiHandCoinLine,
  RiShieldCheckLine,
  RiToolsLine,
} from "@remixicon/react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  SUPPLY_CATEGORY_LABEL,
  SUPPLY_ITEMS,
  scoreSupplyInventory,
  type SupplyCategory,
  type SupplyInventory,
} from "@/lib/cleaner-supplies";
import { maskPayoutIdentifier } from "@/lib/payout-methods";

type SupplyState = {
  inventory: SupplyInventory;
  submittedAt: string | null;
  viewedLegacy: boolean;
  kitConfirmed: boolean | null;
};

type PayoutProfile = {
  methodCode?: string | null;
  methodName?: string | null;
  kind?: "stripe" | "manual" | null;
  status?: string | null;
  identifier?: string | null;
  accountName?: string | null;
  changePending?: boolean;
  pendingMethodCode?: string | null;
};

type PayoutState = {
  profile: PayoutProfile | null;
  w9OnFile: boolean;
  nextPayRunDate: string | null;
  payRunWeekday: string | null;
  lastPayment: Record<string, unknown> | null;
};

const CATEGORY_ORDER: SupplyCategory[] = ["solutions", "tools", "safety", "optional", "commercial_equipment"];

const STATUS_CLS: Record<string, string> = {
  verified: "bg-emerald-50 text-emerald-700 border-emerald-200",
  pending: "bg-amber-50 text-amber-800 border-amber-200",
  on_hold: "bg-rose-50 text-rose-700 border-rose-200",
};

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";

function SectionTitle({ icon: Icon, children }: { icon: typeof RiToolsLine; children: React.ReactNode }) {
  return (
    <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
      <Icon className="h-3.5 w-3.5" />
      {children}
    </h3>
  );
}

function SuppliesSection({ state }: { state: SupplyState | null }) {
  const submitted = Boolean(state?.submittedAt || state?.viewedLegacy);
  const score = useMemo(() => scoreSupplyInventory(state?.inventory), [state]);

  if (!state) return <Skeleton className="h-28 w-full" />;

  const owned = (id: string) => state.inventory[id] === true;
  const missingNeeded = SUPPLY_ITEMS.filter((i) => i.neededForJob && !owned(i.id));
  const hasAnyAnswer = Object.keys(state.inventory).length > 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {submitted ? (
          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
            Checklist submitted {fmtDate(state.submittedAt)}
          </Badge>
        ) : (
          <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200">
            Checklist not submitted
          </Badge>
        )}
        {hasAnyAnswer ? (
          <Badge
            variant="outline"
            className={cn(
              score.ready
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "bg-rose-50 text-rose-700 border-rose-200",
            )}
          >
            {score.ownedNeeded}/{score.totalNeeded} job essentials · {score.percent}%
            {score.ready ? " · ready" : ` · needs ${score.threshold}`}
          </Badge>
        ) : null}
        {state.kitConfirmed === true ? (
          <Badge variant="outline" className="bg-violet-50 text-violet-700 border-violet-200">
            Kit confirmed
          </Badge>
        ) : state.kitConfirmed === false ? (
          <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200">
            Kit not confirmed
          </Badge>
        ) : null}
      </div>

      {!hasAnyAnswer ? (
        <p className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
          {submitted
            ? "They viewed the checklist before item-level answers were saved, so there is no per-item list."
            : "Nothing selected yet. Use Send supplies on the Onboarding tab to ask them to check off what they own."}
        </p>
      ) : (
        <>
          {missingNeeded.length > 0 ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
              <RiAlertLine className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Missing job essentials: {missingNeeded.map((i) => i.label).join(", ")}.
              </span>
            </div>
          ) : null}

          <div className="space-y-3">
            {CATEGORY_ORDER.map((category) => {
              const items = SUPPLY_ITEMS.filter((i) => i.category === category);
              const have = items.filter((i) => owned(i.id));
              if (category === "commercial_equipment" && have.length === 0) return null;
              return (
                <div key={category} className="rounded-lg border border-slate-200">
                  <div className="flex items-center justify-between border-b border-slate-100 px-3 py-1.5">
                    <p className="text-xs font-semibold text-slate-700">{SUPPLY_CATEGORY_LABEL[category]}</p>
                    <p className="text-[11px] text-slate-500">
                      {have.length}/{items.length}
                    </p>
                  </div>
                  <ul className="grid gap-x-3 gap-y-1 p-3 sm:grid-cols-2">
                    {(category === "commercial_equipment" ? have : items).map((item) => (
                      <li
                        key={item.id}
                        className={cn(
                          "flex items-start gap-1.5 text-xs",
                          owned(item.id) ? "text-slate-900" : "text-slate-400",
                        )}
                      >
                        {owned(item.id) ? (
                          <RiCheckboxCircleFill className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-600" />
                        ) : (
                          <RiCircleLine className="mt-px h-3.5 w-3.5 shrink-0" />
                        )}
                        <span>{item.label}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function PayoutSection({ state, error }: { state: PayoutState | null; error: string }) {
  if (error) {
    return <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">{error}</p>;
  }
  if (!state) return <Skeleton className="h-24 w-full" />;

  const profile = state.profile;
  const status = String(profile?.status || "");
  const last = state.lastPayment;
  const masked = profile?.kind === "manual" && profile.identifier ? maskPayoutIdentifier(profile.identifier) : "";

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium text-slate-900">{profile?.methodName || "No payout method selected"}</p>
        {status ? (
          <Badge variant="outline" className={cn("capitalize", STATUS_CLS[status])}>
            {status.replace("_", " ")}
          </Badge>
        ) : (
          <Badge variant="outline">None</Badge>
        )}
      </div>
      {profile?.kind === "stripe" ? (
        <p className="text-xs text-slate-600">Stripe Connect. Paid automatically after a job is approved.</p>
      ) : null}
      {masked ? (
        <p className="text-xs text-slate-600">
          Paid to <span className="font-mono text-slate-900">{masked}</span>
          {profile?.accountName ? ` · ${profile.accountName}` : ""}
        </p>
      ) : null}
      {profile?.kind === "manual" && state.nextPayRunDate ? (
        <p className="text-xs text-slate-600">
          Next pay run {state.payRunWeekday ? `${state.payRunWeekday}, ` : ""}
          {fmtDate(state.nextPayRunDate)}
        </p>
      ) : null}
      {profile?.changePending ? (
        <p className="text-xs text-amber-700">A change to their payout details is waiting on a confirmation code.</p>
      ) : null}
      <p className="text-xs text-slate-600">{state.w9OnFile ? "W-9 on file." : "W-9 not on file. Payouts stay blocked until it is."}</p>
      <p className="text-xs text-slate-500">
        {last
          ? `Last payment ${last.paid_at ? String(last.paid_at).slice(0, 10) : ""} · $${((Number(last.amount_sent_cents ?? last.amount_cents) || 0) / 100).toFixed(2)}`
          : "No payment recorded yet."}
      </p>
      <Link
        href="/admin/payroll"
        className="inline-flex items-center gap-1 text-xs font-semibold text-violet-700 hover:underline"
      >
        Open Payroll
        <RiExternalLinkLine className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

function ReimbursementSection() {
  return (
    <div className="rounded-lg border border-dashed border-violet-200 bg-violet-50/50 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium text-slate-900">Supplies reimbursement program</p>
        <Badge variant="outline" className="bg-violet-100 text-violet-800 border-violet-200">
          Coming soon
        </Badge>
      </div>
      <p className="text-xs text-slate-600">
        Contractors will be able to request funds for the supplies they need to work. Every request goes through
        checks and balances before any money moves. Nothing here is live yet.
      </p>
      <ul className="space-y-1 text-xs text-slate-600">
        {[
          "Request tied to items on the supply checklist, with a receipt",
          "Admin review and approval before anything is paid",
          "Spending limits per contractor and per request",
          "Paid through Payroll, with every request on the record",
        ].map((line) => (
          <li key={line} className="flex items-start gap-1.5">
            <RiShieldCheckLine className="mt-px h-3.5 w-3.5 shrink-0 text-violet-500" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ContractorOperationsTab({
  cleanerId,
  cleanerName,
}: {
  cleanerId: string;
  cleanerName: string;
}) {
  const [supplies, setSupplies] = useState<SupplyState | null>(null);
  const [payout, setPayout] = useState<PayoutState | null>(null);
  const [payoutError, setPayoutError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setSupplies(null);
    setPayout(null);
    setPayoutError("");

    (async () => {
      const { data } = await (supabase.from as any)("cleaners")
        .select("supply_inventory, supply_checklist_submitted_at, ob_supplies_checklist_viewed, kit_confirmed")
        .eq("id", cleanerId)
        .maybeSingle();
      if (cancelled) return;
      setSupplies({
        inventory: ((data?.supply_inventory as SupplyInventory | null) || {}) as SupplyInventory,
        submittedAt: (data?.supply_checklist_submitted_at as string | null) || null,
        viewedLegacy: Boolean(data?.ob_supplies_checklist_viewed),
        kitConfirmed: typeof data?.kit_confirmed === "boolean" ? data.kit_confirmed : null,
      });
    })();

    (async () => {
      try {
        const { data: session } = await supabase.auth.getSession();
        const res = await fetch(`/api/admin/payout-methods?cleanerId=${cleanerId}`, {
          headers: { Authorization: `Bearer ${session.session?.access_token || ""}` },
        });
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setPayoutError(body.error || "Could not load payout details.");
          return;
        }
        setPayout({
          profile: (body.profile as PayoutProfile | null) || null,
          w9OnFile: Boolean(body.w9OnFile),
          nextPayRunDate: (body.nextPayRunDate as string | null) || null,
          payRunWeekday: (body.payRunWeekday as string | null) || null,
          lastPayment: (body.lastPayment as Record<string, unknown> | null) || null,
        });
      } catch {
        if (!cancelled) setPayoutError("Could not load payout details.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cleanerId]);

  return (
    <div className="space-y-5" aria-label={`Operations for ${cleanerName}`}>
      <section className="space-y-2">
        <SectionTitle icon={RiToolsLine}>Supplies selected</SectionTitle>
        <SuppliesSection state={supplies} />
      </section>

      <section className="space-y-2">
        <SectionTitle icon={RiBankCardLine}>Payout method</SectionTitle>
        <PayoutSection state={payout} error={payoutError} />
      </section>

      <section className="space-y-2">
        <SectionTitle icon={RiHandCoinLine}>Reimbursement</SectionTitle>
        <ReimbursementSection />
      </section>
    </div>
  );
}
