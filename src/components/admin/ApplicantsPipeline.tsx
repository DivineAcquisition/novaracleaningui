"use client";

// ─── Applicants pipeline (cleaner hub) ─────────────────────────────────
//
// The Applicants queue inside the admin cleaner hub: talent-acquisition
// submissions synced ONE-WAY from Airtable (Fillout → Airtable → here) into
// public.cleaner_applicants. The whole lifecycle lives in this one area:
//
//   Applicant → Screening → Onboarding → Agreement Signed → Active
//   (+ Rejected / Withdrawn)
//
// "Agreement Signed" is derived live from the linked cleaners row
// (ob_agreement_signed) rather than stored — the existing systems stay the
// source of truth for onboarding progress. Stalled onboarding (launched
// days ago, still unsigned) surfaces as needs-attention with one-click
// re-send. All admin actions go through /api/talent/actions (audited).

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RiSearchLine,
  RiRefreshLine,
  RiAlertLine,
  RiCheckboxCircleFill,
  RiCircleLine,
  RiSendPlaneLine,
  RiUserAddLine,
  RiCloseCircleLine,
  RiTimeLine,
  RiLoader4Line,
} from "@remixicon/react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// Onboarding is considered stalled when launched this long ago without a
// signed agreement.
const STALL_DAYS = 3;

interface ApplicantRow {
  id: string;
  airtable_record_id: string;
  email: string | null;
  phone: string | null;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  address: string | null;
  zip_code: string | null;
  state: string | null;
  zone: string | null;
  role: string | null;
  department: string | null;
  contractor_type: string | null;
  experience: string | null;
  availability: string | null;
  preferred_days: string[] | null;
  transportation: string | null;
  authorized_to_work: string | null;
  consent_1099: boolean | null;
  background_check_consent: boolean | null;
  pay_consent: boolean | null;
  reliability_note: string | null;
  reason_note: string | null;
  stage: string;
  rejection_reason: string | null;
  stage_changed_at: string | null;
  stage_changed_by: string | null;
  cleaner_id: string | null;
  onboarding_launched_at: string | null;
  onboarding_last_nudge_at: string | null;
  applied_at: string | null;
  synced_at: string | null;
}

interface LinkedCleaner {
  id: string;
  user_id: string | null;
  status: string | null;
  approved: boolean | null;
  ob_agreement_signed: boolean | null;
  ob_agreement_signed_at: string | null;
  ob_payouts_setup: boolean | null;
  payouts_enabled: boolean | null;
  stripe_account_id: string | null;
  onboarding_complete: boolean | null;
}

type EffectiveStage =
  | "applicant"
  | "screening"
  | "onboarding"
  | "agreement_signed"
  | "active"
  | "rejected"
  | "withdrawn";

const STAGE_FILTERS: Array<{ id: "all" | EffectiveStage | "attention"; label: string }> = [
  { id: "all", label: "All" },
  { id: "applicant", label: "Applicants" },
  { id: "screening", label: "Screening" },
  { id: "onboarding", label: "Onboarding" },
  { id: "agreement_signed", label: "Agreement signed" },
  { id: "active", label: "Active" },
  { id: "rejected", label: "Rejected" },
  { id: "attention", label: "Needs attention" },
];

const STAGE_BADGE: Record<EffectiveStage, { label: string; cls: string }> = {
  applicant: { label: "Applicant", cls: "bg-sky-50 text-sky-700 border-sky-200" },
  screening: { label: "Screening", cls: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  onboarding: { label: "Onboarding", cls: "bg-amber-50 text-amber-800 border-amber-200" },
  agreement_signed: { label: "Agreement signed", cls: "bg-teal-50 text-teal-700 border-teal-200" },
  active: { label: "Active", cls: "bg-violet-100 text-violet-800 border-violet-200" },
  rejected: { label: "Rejected", cls: "bg-rose-50 text-rose-700 border-rose-200" },
  withdrawn: { label: "Withdrawn", cls: "bg-slate-100 text-slate-600 border-slate-200" },
};

const applicantName = (a: ApplicantRow) =>
  a.full_name || [a.first_name, a.last_name].filter(Boolean).join(" ") || a.email || "—";

const payoutsReady = (c: LinkedCleaner | undefined): boolean =>
  Boolean(c && (c.payouts_enabled || c.ob_payouts_setup || c.stripe_account_id));

function effectiveStage(a: ApplicantRow, c: LinkedCleaner | undefined): EffectiveStage {
  if (a.stage === "onboarding" && c?.ob_agreement_signed) return "agreement_signed";
  return (a.stage as EffectiveStage) || "applicant";
}

function isStalled(a: ApplicantRow, c: LinkedCleaner | undefined): boolean {
  if (a.stage !== "onboarding" || c?.ob_agreement_signed) return false;
  const launched = a.onboarding_launched_at ? new Date(a.onboarding_launched_at).getTime() : 0;
  if (!launched) return false;
  const ref = a.onboarding_last_nudge_at
    ? Math.max(launched, new Date(a.onboarding_last_nudge_at).getTime())
    : launched;
  return Date.now() - ref > STALL_DAYS * 24 * 60 * 60 * 1000;
}

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

async function callAction(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const { data: sessionData } = await supabase.auth.getSession();
  const res = await fetch("/api/talent/actions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionData.session?.access_token || ""}`,
    },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: j?.error || `Failed (${res.status})` };
  return { ok: true };
}

export default function ApplicantsPipeline() {
  const [loading, setLoading] = useState(true);
  const [applicants, setApplicants] = useState<ApplicantRow[]>([]);
  const [cleaners, setCleaners] = useState<Map<string, LinkedCleaner>>(new Map());
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<(typeof STAGE_FILTERS)[number]["id"]>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actioning, setActioning] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true);
    // cleaner_applicants is newer than the generated Database types.
    const { data, error } = await (supabase.from as any)("cleaner_applicants")
      .select("*")
      .order("applied_at", { ascending: false, nullsFirst: false })
      .limit(500);
    if (error) {
      if (!opts.silent) toast.error("Couldn't load applicants", { description: error.message });
      if (!opts.silent) setLoading(false);
      return;
    }
    const rows = (data || []) as ApplicantRow[];
    setApplicants(rows);

    const cleanerIds = Array.from(new Set(rows.map((r) => r.cleaner_id).filter(Boolean))) as string[];
    if (cleanerIds.length > 0) {
      const { data: linked } = await supabase
        .from("cleaners")
        .select(
          "id,user_id,status,approved,ob_agreement_signed,ob_agreement_signed_at,ob_payouts_setup,payouts_enabled,stripe_account_id,onboarding_complete",
        )
        .in("id", cleanerIds);
      setCleaners(new Map(((linked || []) as unknown as LinkedCleaner[]).map((c) => [c.id, c])));
    } else {
      setCleaners(new Map());
    }
    if (!opts.silent) setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel("admin-cleaner-applicants")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cleaner_applicants" },
        () => void load({ silent: true }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  const selected = useMemo(
    () => applicants.find((a) => a.id === selectedId) || null,
    [applicants, selectedId],
  );
  const selectedCleaner = selected?.cleaner_id ? cleaners.get(selected.cleaner_id) : undefined;

  const counts = useMemo(() => {
    const c = { applicant: 0, onboarding: 0, attention: 0 };
    for (const a of applicants) {
      const cl = a.cleaner_id ? cleaners.get(a.cleaner_id) : undefined;
      const st = effectiveStage(a, cl);
      if (st === "applicant") c.applicant += 1;
      if (st === "onboarding" || st === "agreement_signed") c.onboarding += 1;
      if (isStalled(a, cl)) c.attention += 1;
    }
    return c;
  }, [applicants, cleaners]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return applicants.filter((a) => {
      const cl = a.cleaner_id ? cleaners.get(a.cleaner_id) : undefined;
      const st = effectiveStage(a, cl);
      if (stageFilter === "attention") {
        if (!isStalled(a, cl)) return false;
      } else if (stageFilter !== "all" && st !== stageFilter) {
        return false;
      }
      if (!q) return true;
      return [a.full_name, a.email, a.phone, a.zip_code, a.state, a.role]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [applicants, cleaners, search, stageFilter]);

  const runAction = async (action: string, extra: Record<string, unknown> = {}) => {
    if (!selected) return;
    setActioning(true);
    const res = await callAction({ action, applicantId: selected.id, ...extra });
    setActioning(false);
    if (!res.ok) {
      toast.error("Action failed", { description: res.error });
      return false;
    }
    await load({ silent: true });
    return true;
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const res = await fetch("/api/talent/sync", {
        method: "POST",
        headers: { Authorization: `Bearer ${sessionData.session?.access_token || ""}` },
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Sync failed (${res.status})`);
      toast.success(`Synced from Airtable — ${j.created ?? 0} new, ${j.updated ?? 0} updated.`);
      await load({ silent: true });
    } catch (err) {
      toast.error("Sync failed", { description: (err as Error).message });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-sky-50 text-sky-700 border border-sky-200">
            <RiUserAddLine className="w-3 h-3" /> {counts.applicant} awaiting review
          </span>
          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
            <RiTimeLine className="w-3 h-3" /> {counts.onboarding} onboarding
          </span>
          {counts.attention > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
              <RiAlertLine className="w-3 h-3" /> {counts.attention} need attention
            </span>
          )}
        </div>
        <Button variant="outline" className="border-slate-200 text-slate-700" onClick={() => void syncNow()} disabled={syncing}>
          <RiRefreshLine className={cn("w-4 h-4 mr-1.5", syncing && "animate-spin")} />
          Sync from Airtable
        </Button>
      </div>

      <Card className="border-slate-200">
        <CardContent className="p-3 sm:p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <RiSearchLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search applicants by name, email, phone, ZIP…"
                className="pl-10"
              />
            </div>
            <div className="flex flex-wrap gap-1 bg-slate-100 rounded-lg p-1 self-start">
              {STAGE_FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setStageFilter(f.id)}
                  className={cn(
                    "px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors",
                    stageFilter === f.id
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Applicant</th>
                <th className="text-left px-4 py-3 font-semibold hidden md:table-cell">Contact</th>
                <th className="text-left px-4 py-3 font-semibold hidden lg:table-cell">Fit</th>
                <th className="text-left px-4 py-3 font-semibold">Stage</th>
                <th className="text-left px-4 py-3 font-semibold hidden lg:table-cell">Onboarding</th>
                <th className="text-left px-4 py-3 font-semibold hidden md:table-cell">Applied</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={6} className="px-4 py-3">
                      <Skeleton className="h-8 w-full" />
                    </td>
                  </tr>
                ))
              ) : visible.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-slate-500">
                    <RiAlertLine className="w-7 h-7 mx-auto text-slate-300 mb-2" />
                    No applicants match this filter.
                  </td>
                </tr>
              ) : (
                visible.map((a) => {
                  const cl = a.cleaner_id ? cleaners.get(a.cleaner_id) : undefined;
                  const st = effectiveStage(a, cl);
                  const stalled = isStalled(a, cl);
                  const badge = STAGE_BADGE[st];
                  return (
                    <tr
                      key={a.id}
                      onClick={() => setSelectedId(a.id)}
                      className="hover:bg-slate-50 cursor-pointer"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{applicantName(a)}</div>
                        <div className="text-xs text-slate-500">
                          {[a.role, a.state, a.zip_code].filter(Boolean).join(" · ") || "—"}
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <div className="text-slate-700 text-xs">{a.email || "—"}</div>
                        <div className="text-slate-500 text-xs">{a.phone || ""}</div>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <div className="text-xs text-slate-600">
                          {[a.experience, a.availability].filter(Boolean).join(" · ") || "—"}
                        </div>
                        <div className="text-xs text-slate-400">{a.transportation || ""}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge variant="outline" className={cn("text-[11px]", badge.cls)}>
                            {badge.label}
                          </Badge>
                          {stalled && (
                            <Badge variant="outline" className="text-[11px] bg-rose-50 text-rose-700 border-rose-200">
                              Stalled
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        {a.stage === "onboarding" || st === "agreement_signed" || st === "active" ? (
                          <div className="flex items-center gap-2 text-xs text-slate-600">
                            <ProgressDot ok={Boolean(cl?.ob_agreement_signed)} label="Agreement" />
                            <ProgressDot ok={payoutsReady(cl)} label="Payouts" />
                            <ProgressDot ok={Boolean(cl?.user_id)} label="Portal" />
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell text-xs text-slate-500">
                        {fmtDate(a.applied_at)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── Detail sheet ── */}
      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelectedId(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  {applicantName(selected)}
                  <Badge
                    variant="outline"
                    className={cn("text-[11px]", STAGE_BADGE[effectiveStage(selected, selectedCleaner)].cls)}
                  >
                    {STAGE_BADGE[effectiveStage(selected, selectedCleaner)].label}
                  </Badge>
                </SheetTitle>
                <SheetDescription>
                  Applied {fmtDate(selected.applied_at)} · synced from Airtable{" "}
                  {selected.synced_at ? `· last sync ${fmtDate(selected.synced_at)}` : ""}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-4 space-y-5">
                {isStalled(selected, selectedCleaner) && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-sm">
                    <RiAlertLine className="w-4 h-4 mt-0.5 shrink-0" />
                    <div>
                      Onboarding launched {fmtDate(selected.onboarding_launched_at)} and the agreement
                      still isn&apos;t signed. Re-send the onboarding email/SMS below.
                    </div>
                  </div>
                )}

                {/* Contact + submission */}
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Contact</h3>
                  <DetailGrid
                    rows={[
                      ["Email", selected.email],
                      ["Phone", selected.phone],
                      ["Address", selected.address],
                      ["ZIP / State", [selected.zip_code, selected.state].filter(Boolean).join(" · ")],
                      ["Zone", selected.zone],
                    ]}
                  />
                </section>

                <Separator />

                <section className="space-y-2">
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Application</h3>
                  <DetailGrid
                    rows={[
                      ["Role", selected.role],
                      ["Department", selected.department],
                      ["Type", selected.contractor_type],
                      ["Experience", selected.experience],
                      ["Availability", selected.availability],
                      ["Preferred days", (selected.preferred_days || []).join(", ")],
                      ["Transportation", selected.transportation],
                      ["Authorized to work", selected.authorized_to_work],
                      ["1099 consent", selected.consent_1099 == null ? null : selected.consent_1099 ? "Yes" : "No"],
                      ["BG check consent", selected.background_check_consent == null ? null : selected.background_check_consent ? "Yes" : "No"],
                      ["Pay consent", selected.pay_consent == null ? null : selected.pay_consent ? "Yes" : "No"],
                    ]}
                  />
                  {selected.reliability_note && (
                    <p className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                      <span className="font-medium text-slate-700">On reliability: </span>
                      {selected.reliability_note}
                    </p>
                  )}
                  {selected.reason_note && (
                    <p className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                      <span className="font-medium text-slate-700">Why Novara: </span>
                      {selected.reason_note}
                    </p>
                  )}
                </section>

                {/* Onboarding progress (live from existing systems) */}
                {(selected.stage === "onboarding" ||
                  effectiveStage(selected, selectedCleaner) === "agreement_signed" ||
                  selected.stage === "active") && (
                  <>
                    <Separator />
                    <section className="space-y-2">
                      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        Onboarding progress
                      </h3>
                      <div className="space-y-1.5">
                        <ChecklistRow
                          ok={Boolean(selectedCleaner?.ob_agreement_signed)}
                          label="Agreement signed"
                          detail={selectedCleaner?.ob_agreement_signed_at ? fmtDate(selectedCleaner.ob_agreement_signed_at) : undefined}
                        />
                        <ChecklistRow ok={payoutsReady(selectedCleaner)} label="Payout setup (Stripe Connect / W-9)" />
                        <ChecklistRow ok={Boolean(selectedCleaner?.user_id)} label="Portal account created" />
                      </div>
                      <p className="text-xs text-slate-400">
                        Launched {fmtDate(selected.onboarding_launched_at)}
                        {selected.onboarding_last_nudge_at
                          ? ` · last re-send ${fmtDate(selected.onboarding_last_nudge_at)}`
                          : ""}
                      </p>
                    </section>
                  </>
                )}

                {selected.stage === "rejected" && selected.rejection_reason && (
                  <>
                    <Separator />
                    <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2.5">
                      <span className="font-medium">Rejected: </span>
                      {selected.rejection_reason}
                    </p>
                  </>
                )}

                <Separator />

                {/* Actions */}
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</h3>
                  <div className="flex flex-wrap gap-2">
                    {selected.stage === "applicant" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={actioning}
                        onClick={() => void runAction("advance_screening")}
                      >
                        {actioning ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiTimeLine className="w-4 h-4 mr-1.5" />}
                        Advance to screening
                      </Button>
                    )}
                    {(selected.stage === "applicant" || selected.stage === "screening") && (
                      <Button
                        size="sm"
                        className="bg-violet-600 hover:bg-violet-700 text-white"
                        disabled={actioning}
                        onClick={async () => {
                          const ok = await runAction("launch_onboarding");
                          if (ok) toast.success("Onboarding launched — email + SMS sent.");
                        }}
                      >
                        <RiSendPlaneLine className="w-4 h-4 mr-1.5" />
                        Launch onboarding
                      </Button>
                    )}
                    {selected.stage === "onboarding" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={actioning}
                        onClick={async () => {
                          const ok = await runAction("resend_onboarding");
                          if (ok) toast.success("Onboarding email + SMS re-sent.");
                        }}
                      >
                        <RiSendPlaneLine className="w-4 h-4 mr-1.5" />
                        Re-send onboarding
                      </Button>
                    )}
                    {(selected.stage === "onboarding" ||
                      effectiveStage(selected, selectedCleaner) === "agreement_signed") && (
                      <Button
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-700 text-white"
                        disabled={actioning || !selectedCleaner?.ob_agreement_signed || !payoutsReady(selectedCleaner)}
                        title={
                          !selectedCleaner?.ob_agreement_signed
                            ? "Blocked until the agreement is signed"
                            : !payoutsReady(selectedCleaner)
                              ? "Blocked until payout setup is complete"
                              : undefined
                        }
                        onClick={async () => {
                          const ok = await runAction("activate");
                          if (ok) toast.success("Activated — they're now an active contractor.");
                        }}
                      >
                        <RiCheckboxCircleFill className="w-4 h-4 mr-1.5" />
                        Activate contractor
                      </Button>
                    )}
                    {selected.stage !== "rejected" && selected.stage !== "active" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-rose-200 text-rose-700 hover:bg-rose-50"
                        disabled={actioning}
                        onClick={() => {
                          setRejectReason("");
                          setRejectOpen(true);
                        }}
                      >
                        <RiCloseCircleLine className="w-4 h-4 mr-1.5" />
                        Reject
                      </Button>
                    )}
                  </div>
                  {selected.stage_changed_at && (
                    <p className="text-xs text-slate-400">
                      Last stage change {fmtDate(selected.stage_changed_at)}
                      {selected.stage_changed_by ? ` by ${selected.stage_changed_by}` : ""}
                    </p>
                  )}
                </section>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* ── Reject dialog ── */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject applicant</DialogTitle>
            <DialogDescription>
              {selected ? `Reject ${applicantName(selected)}? A reason is required (audited).` : ""}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="e.g. No transportation, out of zone, failed phone screen…"
            rows={3}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-rose-600 hover:bg-rose-700 text-white"
              disabled={actioning || !rejectReason.trim()}
              onClick={async () => {
                const ok = await runAction("reject", { reason: rejectReason.trim() });
                if (ok) {
                  toast.success("Applicant rejected.");
                  setRejectOpen(false);
                }
              }}
            >
              Reject
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProgressDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {ok ? (
        <RiCheckboxCircleFill className="w-3.5 h-3.5 text-emerald-500" />
      ) : (
        <RiCircleLine className="w-3.5 h-3.5 text-slate-300" />
      )}
      {label}
    </span>
  );
}

function ChecklistRow({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {ok ? (
        <RiCheckboxCircleFill className="w-4 h-4 text-emerald-500 shrink-0" />
      ) : (
        <RiCircleLine className="w-4 h-4 text-slate-300 shrink-0" />
      )}
      <span className={cn(ok ? "text-slate-700" : "text-slate-500")}>{label}</span>
      {detail && <span className="text-xs text-slate-400">· {detail}</span>}
    </div>
  );
}

function DetailGrid({ rows }: { rows: Array<[string, string | null | undefined]> }) {
  const filled = rows.filter(([, v]) => v);
  if (filled.length === 0) return <p className="text-sm text-slate-400">No details captured.</p>;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
      {filled.map(([k, v]) => (
        <div key={k} className="text-sm">
          <span className="text-slate-400 text-xs block">{k}</span>
          <span className="text-slate-700 break-words">{v}</span>
        </div>
      ))}
    </div>
  );
}
