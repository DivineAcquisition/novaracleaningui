"use client";

// ─── Admin Cleaners (v2 — 2026-05-22) ──────────────────────────────────
//
// Combined directory + management. One screen, no separate "directory" tab.
// - Searchable table of every contractor in public.cleaners
// - Filter by status (active / pending / inactive) and ZIP
// - Click a row → side sheet with:
//     * Profile (name, phone, email, home zip, pay tier)
//     * Onboarding progress (phone verified + Stripe) + intro profile fields
//     * Performance metrics (accept rate, on-time, rating, completed)
//     * Actions: approve, deactivate, terminate, reactivate, resync to GHL,
//                resend onboarding link, flag
// - All actions hit the existing cleaner-admin-action edge fn.
// - Zero hardcoded data. Realtime row updates via Supabase channel.

import { useEffect, useMemo, useState } from "react";
import {
  RiSearchLine,
  RiUserStarLine,
  RiCheckLine,
  RiEdit2Line,
  RiTimeLine,
  RiCloseCircleLine,
  RiPhoneLine,
  RiMailLine,
  RiMapPinLine,
  RiRefreshLine,
  RiAlertLine,
  RiLoader4Line,
  RiCheckboxCircleFill,
  RiCircleLine,
  RiUserAddLine,
  RiArrowGoBackLine,
  RiCloseLine,
  RiSendPlaneLine,
  RiLoginBoxLine,
  RiSmartphoneLine,
  RiBriefcaseLine,
  RiCameraLine,
  RiLoginCircleLine,
  RiCalendarCheckLine,
} from "@remixicon/react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { describeEdgeError } from "@/lib/edge-invoke";
import TerminateCleanerDialog from "@/components/admin/TerminateCleanerDialog";
import AdminCrews from "@/views/admin/Crews";
import ApplicantsPipeline from "@/components/admin/ApplicantsPipeline";
import CleanerAccountability from "@/components/admin/CleanerAccountability";
import AccountabilityWatchlist from "@/components/admin/AccountabilityWatchlist";
import UnsignedAgreements from "@/components/admin/UnsignedAgreements";
import { useAdminRole } from "@/hooks/use-admin-role";

const REHIRE_BADGE: Record<string, { label: string; cls: string }> = {
  rehireable: { label: "Rehireable", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  no_rehire: { label: "No-hire", cls: "bg-amber-50 text-amber-800 border-amber-200" },
  under_review: { label: "Rehire: under review", cls: "bg-sky-50 text-sky-700 border-sky-200" },
  blacklist: { label: "Blacklisted", cls: "bg-rose-100 text-rose-800 border-rose-300" },
};

const CLEANER_STATUSES = [
  { value: "pending", label: "Pending" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "terminated", label: "Terminated" },
] as const;

interface CleanerRow {
  id: string;
  user_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  approved: boolean | null;
  available_for_bookings: boolean | null;
  home_zip: string | null;
  state: string | null;
  pay_tier: string | null;
  pay_percentage: number | null;
  completed_bookings: number | null;
  total_bookings: number | null;
  acceptance_rate: number | null;
  on_time_rate: number | null;
  average_rating: number | null;
  weighted_score: number | null;
  workload_score: number | null;
  novara_score: number | null;
  quality_score: number | null;
  overall_score: number | null;
  scores_computed_at: string | null;
  constraints: { no_work_after?: string; no_work_before?: string; notes?: string } | null;
  jobs_assigned_last_7d: number | null;
  onboarding_complete: boolean | null;
  phone_verified: boolean | null;
  ob_payouts_setup: boolean | null;
  ob_agreement_signed?: boolean | null;
  ob_agreement_signed_at?: string | null;
  payouts_enabled: boolean | null;
  stripe_account_id: string | null;
  home_address: string | null;
  home_city: string | null;
  service_zip_codes: string[] | null;
  max_travel_miles: number | null;
  preferred_work_days: string[] | null;
  skillset: string[] | null;
  ghl_synced_at: string | null;
  ghl_sync_error: string | null;
  created_at: string;
  activated_at: string | null;
  rehire_status: string | null;
  termination_reason: string | null;
  terminated_at: string | null;
}

const STATUS_FILTERS = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "pending", label: "Pending" },
  { id: "suspended", label: "Suspended" },
  { id: "inactive", label: "Inactive" },
  { id: "terminated", label: "Terminated" },
] as const;

const STATUS_BADGE: Record<string, string> = {
  active: "bg-violet-100 text-violet-800 border-violet-200",
  pending: "bg-amber-100 text-amber-800 border-amber-200",
  suspended: "bg-orange-100 text-orange-800 border-orange-200",
  inactive: "bg-slate-100 text-slate-600 border-slate-200",
  terminated: "bg-rose-100 text-rose-800 border-rose-200",
};

const fullName = (c: CleanerRow) =>
  [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email || "—";

const stripeOnboardingDone = (c: CleanerRow): boolean =>
  Boolean(c.payouts_enabled || c.ob_payouts_setup || c.stripe_account_id);

const onboardingProgress = (c: CleanerRow): number => {
  const flags = [c.phone_verified, stripeOnboardingDone(c)];
  const done = flags.filter(Boolean).length;
  return Math.round((done / flags.length) * 100);
};

export default function AdminCleaners() {
  const [loading, setLoading] = useState(true);
  const [cleaners, setCleaners] = useState<CleanerRow[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]["id"]>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actioning, setActioning] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  // One hub, whole lifecycle. Applicants (the talent queue), contractors (the
  // directory) and crews (how those contractors are grouped) are three views of
  // the same people, so they are sections here rather than three sidebar
  // entries that each answer a third of the question "who works for us".
  const [section, setSection] = useState<"contractors" | "applicants" | "crews">("contractors");

  const selected = useMemo(
    () => cleaners.find((c) => c.id === selectedId) || null,
    [cleaners, selectedId],
  );

  useEffect(() => {
    void load();
    const channel = supabase
      .channel("admin-cleaners")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cleaners" },
        () => void load({ silent: true }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  const load = async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true);
    const { data, error } = await supabase
      .from("cleaners")
      .select(
        "id,user_id,first_name,last_name,email,phone,status,approved,available_for_bookings,home_zip,state,pay_tier,pay_percentage,completed_bookings,total_bookings,acceptance_rate,on_time_rate,average_rating,weighted_score,workload_score,novara_score,quality_score,overall_score,scores_computed_at,constraints,jobs_assigned_last_7d,onboarding_complete,phone_verified,ob_payouts_setup,ob_agreement_signed,ob_agreement_signed_at,payouts_enabled,stripe_account_id,home_address,home_city,home_zip,service_zip_codes,max_travel_miles,preferred_work_days,skillset,ghl_synced_at,ghl_sync_error,created_at,activated_at,rehire_status,termination_reason,terminated_at",
      )
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      if (!opts.silent) toast.error("Couldn't load cleaners", { description: error.message });
    } else {
      setCleaners((data as unknown as CleanerRow[]) || []);
    }
    if (!opts.silent) setLoading(false);
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cleaners.filter((c) => {
      if (statusFilter !== "all" && (c.status || "pending").toLowerCase() !== statusFilter) {
        return false;
      }
      if (!q) return true;
      const blob = [
        c.first_name,
        c.last_name,
        c.email,
        c.phone,
        c.home_zip,
        c.state,
        c.pay_tier,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }, [cleaners, statusFilter, search]);

  const counts = useMemo(() => {
    const c = { active: 0, pending: 0, suspended: 0, inactive: 0, terminated: 0 };
    cleaners.forEach((r) => {
      const s = (r.status || "pending").toLowerCase();
      if (s in c) (c as any)[s] += 1;
    });
    return c;
  }, [cleaners]);

  const deleteCleaner = async () => {
    if (!selected) return;
    const fullName = `${selected.first_name || ""} ${selected.last_name || ""}`.trim();
    if (
      !confirm(
        `Permanently delete ${fullName} from the directory? This cannot be undone. Open jobs will be marked for reassignment.`,
      )
    ) {
      return;
    }
    const typed = window.prompt(`Type "${fullName}" to confirm deletion:`);
    if (!typed || typed.trim().toLowerCase() !== fullName.toLowerCase()) {
      toast.error("Name did not match — deletion cancelled.");
      return;
    }
    setActioning(true);
    try {
      const { data, error } = await supabase.functions.invoke("cleaner-admin-action", {
        body: { action: "delete_cleaner", cleanerId: selected.id, confirmName: typed.trim() },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Cleaner removed from directory");
      setSelectedId(null);
      await load({ silent: true });
    } catch (err: any) {
      toast.error(err?.message || "Delete failed");
    } finally {
      setActioning(false);
    }
  };

  const runAction = async (
    action:
      | "deactivate"
      | "terminate"
      | "reactivate"
      | "flag"
      | "update_compliance"
      | "set_status"
      | "advance_pay_tier"
      | "send_agreement",
    extra: Record<string, unknown> = {},
  ) => {
    if (!selected) return;
    setActioning(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not signed in");
      const { data, error } = await supabase.functions.invoke("cleaner-admin-action", {
        body: { action, cleanerId: selected.id, ...extra },
      });
      // invoke() hides the function's own message behind a generic
      // "non-2xx status code" string; read the body so the toast says what
      // actually went wrong instead of "Action failed".
      if (error) throw new Error(await describeEdgeError(error, data));
      if ((data as any)?.error) throw new Error((data as any).error);
      if (action === "advance_pay_tier") {
        const d = data as {
          toTier?: string;
          toPercentage?: number;
          emailSent?: boolean;
        };
        const tier = (d.toTier || "next").replace(/\b\w/g, (c) => c.toUpperCase());
        toast.success(
          `Promoted to ${tier} · ${d.toPercentage ?? "—"}%` +
            (d.emailSent ? " — email sent" : " — email not sent (no address)"),
        );
      } else if (action === "send_agreement") {
        const d = data as {
          emailed?: boolean;
          smsSent?: boolean;
          emailError?: string | null;
          smsError?: string | null;
          agreementUrl?: string;
        };
        const parts = [d.emailed ? "email" : null, d.smsSent ? "SMS" : null].filter(Boolean);
        toast.success(
          parts.length
            ? `Signing link sent via ${parts.join(" + ")} — opens straight onto the agreement, no login`
            : "Signing link created",
          {
            // A half-delivered link is worth saying out loud, and the URL is
            // worth handing over: the fastest fix for a dead transport is an
            // admin pasting the link into their own message.
            description: [
              !d.emailed && d.emailError ? `Email didn't go: ${d.emailError}` : null,
              !d.smsSent && d.smsError ? `SMS didn't go: ${d.smsError}` : null,
              d.agreementUrl,
            ]
              .filter(Boolean)
              .join("\n"),
            duration: parts.length === 2 ? 6000 : 20_000,
          },
        );
      } else {
        toast.success(`${action} applied`);
      }
      // Optimistic refresh.
      await load({ silent: true });
    } catch (err: any) {
      toast.error(err?.message || "Action failed");
    } finally {
      setActioning(false);
    }
  };

  const resyncToGhl = async () => {
    if (!selected) return;
    setActioning(true);
    try {
      const { error } = await supabase.functions.invoke("sync-cleaner-to-ghl", {
        body: { cleanerId: selected.id, force: true },
      });
      if (error) throw error;
      toast.success("Synced to GHL");
      await load({ silent: true });
    } catch (err: any) {
      toast.error(err?.message || "Sync failed");
    } finally {
      setActioning(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="font-jakarta text-2xl font-bold text-slate-900 tracking-tight">
            {section === "applicants" ? "Applicants" : section === "crews" ? "Crews" : "Cleaner directory"}
          </h1>
          <p className="text-sm text-slate-500">
            {section === "applicants"
              ? "Talent-acquisition submissions — review, launch onboarding, activate."
              : section === "crews"
              ? "How contractors are grouped for multi-cleaner jobs — leads, members, hand-offs."
              : "Contractors, onboarding status, performance, and quick actions."}
          </p>
          <div className="mt-2 inline-flex gap-1 bg-slate-100 rounded-lg p-1">
            {(
              [
                { id: "contractors", label: "Contractors" },
                { id: "applicants", label: "Applicants" },
                { id: "crews", label: "Crews" },
              ] as const
            ).map((s) => (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                  section === s.id
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        {section === "contractors" && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-violet-50 text-violet-700 border border-violet-200">
                <RiCheckLine className="w-3 h-3" /> {counts.active} active
              </span>
              <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                <RiTimeLine className="w-3 h-3" /> {counts.pending} pending
              </span>
              {counts.suspended > 0 && (
                <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-orange-50 text-orange-700 border border-orange-200">
                  <RiAlertLine className="w-3 h-3" /> {counts.suspended} suspended
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                <RiCloseCircleLine className="w-3 h-3" /> {counts.inactive} inactive
              </span>
            </div>
            <ScoreEngineDialog onChanged={() => void load({ silent: true })} />
            <Button
              onClick={() => setAddOpen(true)}
              className="bg-violet-600 hover:bg-violet-700 text-white"
            >
              + Add cleaner
            </Button>
          </div>
        )}
      </div>

      {section === "applicants" && <ApplicantsPipeline />}

      {section === "crews" && <AdminCrews embedded />}

      {section === "contractors" && (
        <>
      <AddCleanerDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={() => {
          // Reload the directory but DON'T close the sheet — the full-
          // account flow keeps the generated temp password visible so the
          // admin can copy it. The bypass flow closes itself on activation.
          void load({ silent: true });
        }}
      />

      {/* Contractors taking work with no signed ICA — one tap sends them a
          tokenized signing link. Hides itself once the backlog is clear. */}
      <UnsignedAgreements onSelectCleaner={(id) => setSelectedId(id)} />

      {/* Accountability review queue: suspended / active strikes / repeat offenders. */}
      <AccountabilityWatchlist onSelectCleaner={(id) => setSelectedId(id)} />

      <Card className="border-slate-200">
        <CardContent className="p-3 sm:p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <RiSearchLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, email, phone, ZIP…"
                className="pl-10"
              />
            </div>
            <div className="flex flex-wrap gap-1 bg-slate-100 rounded-lg p-1 self-start">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setStatusFilter(f.id)}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                    statusFilter === f.id
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <Button
              variant="outline"
              className="border-slate-200 text-slate-700"
              onClick={() => void load()}
              disabled={loading}
            >
              <RiRefreshLine className={cn("w-4 h-4 mr-1.5", loading && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Cleaner</th>
                <th className="text-left px-4 py-3 font-semibold hidden md:table-cell">Contact</th>
                <th className="text-left px-4 py-3 font-semibold hidden md:table-cell">ZIP / state</th>
                <th className="text-left px-4 py-3 font-semibold">Status</th>
                <th className="text-left px-4 py-3 font-semibold hidden lg:table-cell">Onboarding</th>
                <th className="text-left px-4 py-3 font-semibold hidden lg:table-cell">Performance</th>
                <th className="px-4 py-3"> </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={7} className="px-4 py-3">
                      <Skeleton className="h-8 w-full" />
                    </td>
                  </tr>
                ))
              ) : visible.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-slate-500">
                    <RiAlertLine className="w-7 h-7 mx-auto text-slate-300 mb-2" />
                    No cleaners match this filter.
                  </td>
                </tr>
              ) : (
                visible.map((c) => {
                  const progress = onboardingProgress(c);
                  return (
                    <tr
                      key={c.id}
                      className="hover:bg-slate-50 cursor-pointer"
                      onClick={() => setSelectedId(c.id)}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{fullName(c)}</div>
                        <div className="text-[11px] text-slate-500">
                          {(c.pay_tier || "foundation").charAt(0).toUpperCase() + (c.pay_tier || "foundation").slice(1)} · {c.pay_percentage ?? 35}% revenue share
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell text-slate-700">
                        <div className="truncate max-w-[200px]">{c.email || "—"}</div>
                        <div className="text-[11px] text-slate-500">{c.phone || "—"}</div>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell text-slate-700">
                        {c.home_zip || "—"}
                        <span className="text-[11px] text-slate-500 ml-1">{c.state || ""}</span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={c.status} />
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell w-[160px]">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className={cn(
                                "h-full rounded-full",
                                progress === 100 ? "bg-violet-500" : "bg-amber-400",
                              )}
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                          <span className="text-xs text-slate-600 w-8 text-right">
                            {progress}%
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <div className="text-xs text-slate-700 flex items-center gap-1.5">
                          {c.overall_score != null && (
                            <span
                              className={cn(
                                "inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-bold",
                                Number(c.overall_score) >= 70
                                  ? "bg-emerald-50 text-emerald-700"
                                  : Number(c.overall_score) >= 45
                                    ? "bg-amber-50 text-amber-700"
                                    : "bg-rose-50 text-rose-700",
                              )}
                              title={`Novara ${c.novara_score != null ? Math.round(Number(c.novara_score)) : "—"} · Rating ${c.quality_score != null ? Math.round(Number(c.quality_score)) : "—"}`}
                            >
                              {Math.round(Number(c.overall_score))}
                            </span>
                          )}
                          <span>
                            ⭐ {c.average_rating ? Number(c.average_rating).toFixed(2) : "—"} ·{" "}
                            {c.completed_bookings || 0} done
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {c.jobs_assigned_last_7d ?? 0} jobs / 7d
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" variant="ghost" className="text-violet-700">
                          View
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <CleanerSheet
        cleaner={selected}
        onClose={() => setSelectedId(null)}
        onAction={runAction}
        onDelete={deleteCleaner}
        onResyncGhl={resyncToGhl}
        onRefresh={() => load({ silent: true })}
        actioning={actioning}
      />
        </>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string | null }) {
  const s = (status || "pending").toLowerCase();
  return (
    <Badge variant="outline" className={cn("font-medium border", STATUS_BADGE[s] || STATUS_BADGE.pending)}>
      {s}
    </Badge>
  );
}

function CleanerSheet({
  cleaner,
  onClose,
  onAction,
  onDelete,
  onResyncGhl,
  onRefresh,
  actioning,
}: {
  cleaner: CleanerRow | null;
  onClose: () => void;
  onAction: (
    action:
      | "deactivate"
      | "terminate"
      | "reactivate"
      | "flag"
      | "update_compliance"
      | "set_status"
      | "advance_pay_tier"
      | "send_agreement",
    extra?: Record<string, unknown>,
  ) => void;
  onDelete: () => void;
  onResyncGhl: () => void;
  onRefresh: () => void;
  actioning: boolean;
}) {
  return (
    <Sheet open={Boolean(cleaner)} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto bg-white">
        {!cleaner ? null : (
          <>
            <SheetHeader className="space-y-1.5 pb-4 border-b border-slate-100">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <SheetTitle className="text-lg text-slate-900">{fullName(cleaner)}</SheetTitle>
                  <SheetDescription className="text-slate-500">
                    Joined {new Date(cleaner.created_at).toLocaleDateString()} ·{" "}
                    {cleaner.activated_at ? "Activated" : "Not yet activated"}
                  </SheetDescription>
                </div>
                <div className="flex items-center gap-2">
                  <EditCleanerProfileDialog cleaner={cleaner} onSaved={onRefresh} />
                  <StatusBadge status={cleaner.status} />
                </div>
              </div>
            </SheetHeader>

            <div className="py-4 space-y-5">
              <ContactSection cleaner={cleaner} />

              <Tabs defaultValue="jobs">
                <TabsList className="grid grid-cols-3 sm:grid-cols-5 h-auto bg-slate-100">
                  <TabsTrigger value="jobs" className="data-[state=active]:bg-white">
                    Jobs
                  </TabsTrigger>
                  <TabsTrigger value="onboarding" className="data-[state=active]:bg-white">
                    Onboarding
                  </TabsTrigger>
                  <TabsTrigger value="performance" className="data-[state=active]:bg-white">
                    Performance
                  </TabsTrigger>
                  <TabsTrigger value="accountability" className="data-[state=active]:bg-white">
                    Accountability
                  </TabsTrigger>
                  <TabsTrigger value="ghl" className="data-[state=active]:bg-white">
                    GHL
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="jobs" className="pt-3">
                  <CleanerJobsBlock cleaner={cleaner} onChanged={onRefresh} />
                </TabsContent>
                <TabsContent value="onboarding" className="pt-3">
                  <OnboardingChecklist
                    cleaner={cleaner}
                    onSendAgreement={() => onAction("send_agreement")}
                    actioning={actioning}
                  />
                </TabsContent>
                <TabsContent value="performance" className="pt-3">
                  <PerformanceBlock cleaner={cleaner} onRefresh={onRefresh} />
                </TabsContent>
                <TabsContent value="accountability" className="pt-3">
                  <CleanerAccountability
                    cleanerId={cleaner.id}
                    cleanerName={fullName(cleaner)}
                    onChanged={onRefresh}
                  />
                </TabsContent>
                <TabsContent value="ghl" className="pt-3">
                  <GhlBlock cleaner={cleaner} onResync={onResyncGhl} actioning={actioning} />
                </TabsContent>
              </Tabs>

              <Separator />

              <CleanerToolsBlock cleaner={cleaner} />

              <Separator />

              <ActionsBlock
                cleaner={cleaner}
                onAction={onAction}
                onDelete={onDelete}
                onRefresh={onRefresh}
                actioning={actioning}
              />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Jobs & offers: view + accept/decline on the cleaner's behalf ─────────
interface CleanerJobItem {
  assignmentId: string;
  jobId: string | null;
  bookingId: string | null;
  status: string | null;
  role: string | null;
  distance_miles: number | null;
  estimated_pay_cents: number | null;
  expires_at: string | null;
  expired: boolean;
  service_type: string | null;
  check_in_time?: string | null;
  start_datetime: string | null;
  city: string | null;
  state: string | null;
  booking: {
    booking_number: number | null;
    status: string | null;
    service_date: string | null;
    time_slot: string | null;
    customer: string;
    total_estimate_cents: number | null;
    before_sent: boolean;
    after_sent: boolean;
  } | null;
}

const jobMoney = (c?: number | null) =>
  c == null ? "—" : (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const jobDate = (d?: string | null) => {
  if (!d) return "Unscheduled";
  const dt = new Date(`${d}T12:00:00`);
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};
const slotLabel = (s?: string | null) => {
  if (!s) return "";
  const map: Record<string, string> = { "8-12": "8:00 AM – 12:00 PM", "12-16": "12:00 PM – 4:00 PM", "16-20": "4:00 PM – 8:00 PM" };
  return map[s] || s;
};

function CleanerJobsBlock({ cleaner, onChanged }: { cleaner: CleanerRow; onChanged: () => void }) {
  const [loading, setLoading] = useState(true);
  const [offers, setOffers] = useState<CleanerJobItem[]>([]);
  const [jobs, setJobs] = useState<CleanerJobItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-cleaner-jobs", {
        body: { action: "list", cleanerId: cleaner.id },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error?: string }).error);
      setOffers(((data as { offers?: CleanerJobItem[] }).offers) || []);
      setJobs(((data as { jobs?: CleanerJobItem[] }).jobs) || []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load jobs");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleaner.id]);

  const respond = async (item: CleanerJobItem, action: "accept" | "decline") => {
    if (action === "accept" && !confirm(`Accept this ${item.service_type || "clean"} for ${cleaner.first_name || "this cleaner"} on their behalf? They'll be assigned and the booking + contractor records update immediately.`)) return;
    if (action === "decline" && !confirm("Decline this offer on the cleaner's behalf? It'll be re-routed for reassignment.")) return;
    setBusy(item.assignmentId);
    try {
      const { data, error } = await supabase.functions.invoke("admin-cleaner-jobs", {
        body: { action, assignmentId: item.assignmentId },
      });
      if (error) throw error;
      const d = data as { ok?: boolean; error?: string; reason?: string };
      if (d?.ok === false || d?.error) {
        throw new Error(d.error || "Could not complete that action.");
      }
      toast.success(action === "accept" ? "Accepted on their behalf — booking & contractor synced." : "Declined on their behalf.");
      await load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  const checkIn = async (item: CleanerJobItem) => {
    if (!confirm(`Start this job for ${cleaner.first_name || "the cleaner"}? This checks them in (same as tapping Check in on their portal) and texts them the BEFORE-photos link.`)) return;
    setBusy(`${item.assignmentId}-checkin`);
    try {
      const { data, error } = await supabase.functions.invoke("admin-cleaner-jobs", {
        body: { action: "check_in", assignmentId: item.assignmentId },
      });
      if (error) throw error;
      const d = data as { ok?: boolean; error?: string; alreadyCheckedIn?: boolean };
      if (d?.ok === false || d?.error) throw new Error(d?.error || "Check-in failed");
      toast.success(d?.alreadyCheckedIn ? "Job was already checked in." : "Checked in — job started and before-photos link texted.");
      await load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Check-in failed");
    } finally {
      setBusy(null);
    }
  };

  const sendPhotoLink = async (item: CleanerJobItem, phase: "before" | "after" | "both") => {
    if (!item.bookingId) { toast.error("No booking linked to this job."); return; }
    setBusy(`${item.assignmentId}-${phase}`);
    try {
      const { data, error } = await supabase.functions.invoke("admin-cleaner-sms", {
        body: { cleanerId: cleaner.id, template: "photo_request", bookingId: item.bookingId, phase },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error?: string }).error);
      toast.success(
        phase === "before" ? "Before-photos link texted." : phase === "after" ? "After-photos link texted." : "Combined photo link texted.",
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send link");
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return <div className="py-6 flex justify-center"><RiLoader4Line className="w-5 h-5 animate-spin text-slate-400" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Pending offers */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
          <RiBriefcaseLine className="w-4 h-4 text-violet-700" /> Pending offers
          <Badge className="bg-amber-100 text-amber-800 text-[11px]">{offers.length}</Badge>
        </h3>
        {offers.length === 0 ? (
          <p className="text-xs text-slate-400">No open offers for this contractor.</p>
        ) : (
          offers.map((o) => (
            <div key={o.assignmentId} className="rounded-lg border border-amber-200 bg-amber-50/40 p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900 truncate capitalize">
                    {(o.service_type || "Clean").replace(/_/g, " ")}
                    {o.booking?.customer ? ` · ${o.booking.customer}` : ""}
                  </p>
                  <p className="text-xs text-slate-500">
                    {jobDate(o.booking?.service_date || (o.start_datetime ? o.start_datetime.slice(0, 10) : null))}
                    {o.booking?.time_slot ? ` · ${slotLabel(o.booking.time_slot)}` : ""}
                    {o.city ? ` · ${o.city}${o.state ? `, ${o.state}` : ""}` : ""}
                  </p>
                  <p className="text-xs text-slate-500">
                    {o.role || "Support"} · est. {jobMoney(o.estimated_pay_cents)} pay
                    {o.expired ? " · offer expired (admin can still accept)" : ""}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" disabled={busy !== null} onClick={() => respond(o, "accept")}>
                  {busy === o.assignmentId ? <RiLoader4Line className="w-4 h-4 animate-spin" /> : <><RiCheckLine className="w-4 h-4 mr-1.5" /> Accept for them</>}
                </Button>
                <Button size="sm" variant="outline" className="border-rose-200 text-rose-700" disabled={busy !== null} onClick={() => respond(o, "decline")}>
                  <RiCloseLine className="w-4 h-4 mr-1.5" /> Decline
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      <Separator />

      {/* Upcoming / active jobs */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
          <RiCalendarCheckLine className="w-4 h-4 text-violet-700" /> Assigned jobs
          <Badge className="bg-emerald-100 text-emerald-700 text-[11px]">{jobs.length}</Badge>
        </h3>
        {jobs.length === 0 ? (
          <p className="text-xs text-slate-400">No assigned jobs for this contractor.</p>
        ) : (
          jobs.map((j) => (
            <div key={j.assignmentId} className="rounded-lg border border-slate-200 p-3 space-y-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 truncate capitalize">
                  {(j.service_type || "Clean").replace(/_/g, " ")}
                  {j.booking?.customer ? ` · ${j.booking.customer}` : ""}
                  <span className="ml-1.5 text-[11px] font-normal text-slate-400">{j.status}</span>
                </p>
                <p className="text-xs text-slate-500">
                  {jobDate(j.booking?.service_date || (j.start_datetime ? j.start_datetime.slice(0, 10) : null))}
                  {j.booking?.time_slot ? ` · ${slotLabel(j.booking.time_slot)}` : ""}
                  {j.city ? ` · ${j.city}${j.state ? `, ${j.state}` : ""}` : ""}
                  {j.check_in_time ? " · checked in ✓" : ""}
                </p>
              </div>
              {!j.check_in_time && (
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  disabled={busy !== null}
                  onClick={() => checkIn(j)}
                >
                  {busy === `${j.assignmentId}-checkin` ? <RiLoader4Line className="w-4 h-4 animate-spin" /> : <><RiLoginCircleLine className="w-4 h-4 mr-1.5" /> Start job / check in</>}
                </Button>
              )}
              {j.bookingId && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 flex items-center gap-1">
                    <RiCameraLine className="w-3.5 h-3.5" /> Text a photo link
                    {j.booking?.before_sent ? " · before sent" : ""}{j.booking?.after_sent ? " · after sent" : ""}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => sendPhotoLink(j, "before")}>
                      {busy === `${j.assignmentId}-before` ? <RiLoader4Line className="w-4 h-4 animate-spin" /> : "Before"}
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => sendPhotoLink(j, "after")}>
                      {busy === `${j.assignmentId}-after` ? <RiLoader4Line className="w-4 h-4 animate-spin" /> : "After"}
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => sendPhotoLink(j, "both")}>
                      {busy === `${j.assignmentId}-both` ? <RiLoader4Line className="w-4 h-4 animate-spin" /> : "Combined"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// SMS workflows + admin "log in as cleaner" impersonation.
function CleanerToolsBlock({ cleaner }: { cleaner: CleanerRow }) {
  const { isAdmin } = useAdminRole();
  const [smsMsg, setSmsMsg] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const sendSms = async (template: "custom" | "mobile_dashboard") => {
    if (template === "custom" && !smsMsg.trim()) {
      toast.error("Type a message first.");
      return;
    }
    if (!cleaner.phone) {
      toast.error("This cleaner has no phone on file.");
      return;
    }
    setBusy(template);
    try {
      const { data, error } = await supabase.functions.invoke("admin-cleaner-sms", {
        body: { cleanerId: cleaner.id, template, message: template === "custom" ? smsMsg.trim() : undefined },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error?: string }).error);
      toast.success("SMS sent.");
      if (template === "custom") setSmsMsg("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send SMS");
    } finally {
      setBusy(null);
    }
  };

  const loginAs = async () => {
    if (!confirm(`Open ${fullName(cleaner)}'s contractor portal as them? You'll be able to view and submit actions in their account. This is logged.`)) return;
    setBusy("impersonate");
    try {
      const { data, error } = await supabase.functions.invoke("admin-impersonate-cleaner", {
        body: { cleanerId: cleaner.id },
      });
      if (error) throw error;
      const d = data as { url?: string; error?: string };
      if (d?.error) throw new Error(d.error);
      if (!d?.url) throw new Error("No session link returned");
      window.open(d.url, "_blank", "noopener");
      toast.success("Opening cleaner portal in a new tab…");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start session");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
        <RiSmartphoneLine className="w-4 h-4 text-violet-700" /> Contractor tools
      </h3>

      <div className="space-y-2">
        <Label className="text-xs text-slate-500">Send SMS {cleaner.phone ? `to ${cleaner.phone}` : "(no phone on file)"}</Label>
        <Textarea
          value={smsMsg}
          onChange={(e) => setSmsMsg(e.target.value)}
          placeholder="Type a message to this contractor…"
          rows={3}
          disabled={!cleaner.phone}
        />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => sendSms("custom")} disabled={busy !== null || !cleaner.phone} className="bg-violet-600 hover:bg-violet-700 text-white">
            {busy === "custom" ? <RiLoader4Line className="w-4 h-4 animate-spin" /> : <><RiSendPlaneLine className="w-4 h-4 mr-1.5" /> Send SMS</>}
          </Button>
          <Button size="sm" variant="outline" onClick={() => sendSms("mobile_dashboard")} disabled={busy !== null || !cleaner.phone}>
            {busy === "mobile_dashboard" ? <RiLoader4Line className="w-4 h-4 animate-spin" /> : "Nudge: open dashboard"}
          </Button>
        </div>
        <p className="text-[11px] text-slate-400">Photo-submission links (before / after / combined) are sent from the Jobs tab above or from a booking (Bookings → Before &amp; after photos).</p>
      </div>

      {/* Impersonation is admin-only (the edge function rejects VAs). */}
      {isAdmin && (
        <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-3 space-y-2">
          <p className="text-xs text-violet-900 font-medium">Log in as this contractor</p>
          <p className="text-[11px] text-violet-800/70">Opens their contractor portal in a new tab with a one-time, short-lived secure link. You can view and submit actions as them. Every use is logged.</p>
          <Button size="sm" variant="outline" onClick={loginAs} disabled={busy !== null || !cleaner.email} className="border-violet-300 text-violet-800">
            {busy === "impersonate" ? <RiLoader4Line className="w-4 h-4 animate-spin" /> : <><RiLoginBoxLine className="w-4 h-4 mr-1.5" /> Log in as {cleaner.first_name || "cleaner"}</>}
          </Button>
        </div>
      )}
    </div>
  );
}

function ContactSection({ cleaner }: { cleaner: CleanerRow }) {
  return (
    <div className="grid grid-cols-1 gap-2 text-sm">
      <div className="flex items-center gap-2 text-slate-700">
        <RiMailLine className="w-4 h-4 text-slate-400 shrink-0" />
        <a href={`mailto:${cleaner.email}`} className="truncate hover:text-violet-700">
          {cleaner.email || "—"}
        </a>
      </div>
      <div className="flex items-center gap-2 text-slate-700">
        <RiPhoneLine className="w-4 h-4 text-slate-400 shrink-0" />
        <a href={`tel:${cleaner.phone}`} className="hover:text-violet-700">
          {cleaner.phone || "—"}
        </a>
        {cleaner.phone_verified ? (
          <Badge variant="outline" className="bg-violet-50 text-violet-700 border-violet-200 text-[10px]">
            verified
          </Badge>
        ) : null}
      </div>
      <div className="flex items-center gap-2 text-slate-700">
        <RiMapPinLine className="w-4 h-4 text-slate-400 shrink-0" />
        {cleaner.home_zip ? `${cleaner.home_zip} ${cleaner.state || ""}` : "—"}
      </div>
    </div>
  );
}

const OB_STEPS: Array<{ done: (c: CleanerRow) => boolean; label: string; detail?: (c: CleanerRow) => string | null }> = [
  { done: (c) => Boolean(c.phone_verified), label: "Phone verified" },
  {
    done: (c) => Boolean(c.ob_agreement_signed),
    label: "Contractor agreement signed",
    detail: (c) =>
      c.ob_agreement_signed_at
        ? `Signed ${new Date(c.ob_agreement_signed_at).toLocaleDateString()}`
        : null,
  },
  { done: stripeOnboardingDone, label: "Stripe payouts connected" },
];

function OnboardingChecklist({
  cleaner,
  onSendAgreement,
  actioning,
}: {
  cleaner: CleanerRow;
  onSendAgreement: () => void;
  actioning: boolean;
}) {
  const introReady =
    Boolean(cleaner.phone_verified) && stripeOnboardingDone(cleaner);
  const agreementSigned = Boolean(cleaner.ob_agreement_signed);

  return (
    <div className="space-y-4">
      <ul className="space-y-1.5">
        {OB_STEPS.map((s) => {
          const done = s.done(cleaner);
          const detail = s.detail?.(cleaner);
          return (
            <li
              key={s.label}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm",
                done ? "bg-violet-50 text-violet-900" : "bg-slate-50 text-slate-600",
              )}
            >
              {done ? (
                <RiCheckboxCircleFill className="w-4 h-4 text-violet-600 shrink-0" />
              ) : (
                <RiCircleLine className="w-4 h-4 text-slate-400 shrink-0" />
              )}
              <span className="flex-1 min-w-0">
                {s.label}
                {detail ? (
                  <span className="block text-[11px] text-slate-500 font-normal">{detail}</span>
                ) : null}
              </span>
            </li>
          );
        })}
        <li className="text-[11px] text-slate-500 px-1 pt-2">
          Portal ready (phone + Stripe): {introReady ? "yes" : "no"}
          {cleaner.onboarding_complete ? " · DB onboarding_complete: yes" : ""}
        </li>
      </ul>

      {!agreementSigned && cleaner.status !== "terminated" ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-3 space-y-2">
          <p className="text-sm font-medium text-amber-950">Agreement not signed yet</p>
          <p className="text-xs text-amber-800">
            Sends email + SMS with a direct link to the contractor agreement signing page.
          </p>
          <Button
            type="button"
            size="sm"
            disabled={actioning || (!cleaner.email && !cleaner.phone)}
            onClick={() => {
              if (
                !confirm(
                  `Send the agreement signing link to ${cleaner.first_name || "this cleaner"} via email/SMS?`,
                )
              ) {
                return;
              }
              onSendAgreement();
            }}
            className="bg-violet-700 hover:bg-violet-800 text-white"
          >
            {actioning ? (
              <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" />
            ) : (
              <RiSendPlaneLine className="w-4 h-4 mr-1.5" />
            )}
            Send agreement link
          </Button>
        </div>
      ) : null}

      <IntroProfileSection cleaner={cleaner} />
    </div>
  );
}

function IntroProfileSection({ cleaner }: { cleaner: CleanerRow }) {
  const days = cleaner.preferred_work_days?.length
    ? cleaner.preferred_work_days.join(", ")
    : "—";
  const zips = cleaner.service_zip_codes?.length
    ? cleaner.service_zip_codes.join(", ")
    : cleaner.home_zip || "—";
  const skills = cleaner.skillset?.length ? cleaner.skillset.join(", ") : "—";
  const address = [cleaner.home_address, cleaner.home_city, cleaner.home_zip, cleaner.state]
    .filter(Boolean)
    .join(", ") || "—";

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-2">
        Intro / onboarding profile
      </p>
      <dl className="grid grid-cols-1 gap-y-2 text-sm">
        <Cell label="Home address" value={address} />
        <Cell label="Travel radius" value={cleaner.max_travel_miles != null ? `${cleaner.max_travel_miles} mi` : "—"} />
        <Cell label="Preferred days" value={days} />
        <Cell label="Service ZIPs" value={zips} />
        <Cell label="Skillset" value={skills} />
        <Cell
          label="Available for bookings"
          value={cleaner.available_for_bookings ? "Yes" : "No"}
        />
      </dl>
    </div>
  );
}

// ─── Novara scoring: two signals + one overall, admin override (logged) ─────

const SCORE_FIELDS = [
  { id: "novara_score", label: "Novara Score", hint: "Reliability — acceptance, workload, jobs completed" },
  { id: "quality_score", label: "Rating", hint: "Quality — QC cases per job + customer ratings" },
  { id: "overall_score", label: "Overall", hint: "Derived — reliability/quality split" },
] as const;

interface OverrideEntry {
  id: string;
  field: string;
  old_value: number | null;
  new_value: number | null;
  reason: string;
  active: boolean;
  created_by_name: string | null;
  created_at: string;
}

function scoreTone(v: number | null) {
  if (v == null) return "bg-slate-100 text-slate-500";
  if (v >= 70) return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
  if (v >= 45) return "bg-amber-50 text-amber-700 ring-1 ring-amber-200";
  return "bg-rose-50 text-rose-700 ring-1 ring-rose-200";
}

function PerformanceBlock({ cleaner, onRefresh }: { cleaner: CleanerRow; onRefresh: () => void }) {
  const num = (v: number | null, suffix = "") => (v == null ? "—" : `${v}${suffix}`);
  const [overrideField, setOverrideField] = useState<string | null>(null);
  const [overrideValue, setOverrideValue] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [working, setWorking] = useState(false);
  const [history, setHistory] = useState<OverrideEntry[] | null>(null);

  const loadHistory = async () => {
    const { data } = await supabase.functions.invoke("cleaner-scores-admin", {
      body: { action: "history", cleanerId: cleaner.id },
    });
    setHistory(((data as { history?: OverrideEntry[] })?.history || []) as OverrideEntry[]);
  };
  useEffect(() => { void loadHistory(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [cleaner.id]);

  const activeOverrides = new Set((history || []).filter((h) => h.active).map((h) => h.field));

  const submitOverride = async (clear = false) => {
    if (!overrideField) return;
    if (!overrideReason.trim()) { toast.error("A reason is required — overrides are logged, never silent."); return; }
    if (!clear && (overrideValue === "" || Number(overrideValue) < 0 || Number(overrideValue) > 100)) {
      toast.error("Value must be 0–100."); return;
    }
    setWorking(true);
    try {
      const { data, error } = await supabase.functions.invoke("cleaner-scores-admin", {
        body: {
          action: clear ? "clear_override" : "override",
          cleanerId: cleaner.id,
          field: overrideField,
          value: clear ? undefined : Number(overrideValue),
          reason: overrideReason.trim(),
        },
      });
      if (error) throw error;
      if ((data as { ok?: boolean; error?: string })?.ok === false) throw new Error((data as { error?: string }).error || "Failed");
      toast.success(clear ? "Override cleared — back to computed." : "Score overridden (logged).");
      setOverrideField(null);
      setOverrideValue("");
      setOverrideReason("");
      await loadHistory();
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save override");
    } finally {
      setWorking(false);
    }
  };

  const scoreOf = (field: string): number | null => {
    const v = (cleaner as unknown as Record<string, unknown>)[field];
    return v != null ? Number(v) : null;
  };

  return (
    <div className="space-y-4">
      {/* Two scores + one overall — separate signals, never collapsed. */}
      <div className="grid grid-cols-3 gap-2">
        {SCORE_FIELDS.map((f) => {
          const v = scoreOf(f.id);
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => { setOverrideField(f.id); setOverrideValue(v != null ? String(Math.round(v)) : ""); setOverrideReason(""); }}
              className={cn("rounded-xl px-3 py-2.5 text-left transition hover:opacity-80", scoreTone(v))}
              title={`${f.hint} — click to override (logged)`}
            >
              <p className="text-[10px] uppercase tracking-wide font-semibold opacity-80">{f.label}</p>
              <p className="text-xl font-bold tabular-nums leading-tight">
                {v != null ? Math.round(v) : "—"}
                {activeOverrides.has(f.id) && <span className="text-[10px] font-semibold ml-1 align-middle" title="Admin override active">✎ pinned</span>}
              </p>
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-slate-500 -mt-2">
        Computed from real data{cleaner.scores_computed_at ? ` · last run ${new Date(cleaner.scores_computed_at).toLocaleString()}` : " · not computed yet"}.
        Tips never affect any score. Click a score to override it (reason required, logged).
      </p>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <Cell label="Avg rating" value={cleaner.average_rating ? Number(cleaner.average_rating).toFixed(2) : "—"} />
        <Cell label="On-time" value={cleaner.on_time_rate != null ? `${(Number(cleaner.on_time_rate) * 100).toFixed(0)}%` : "—"} />
        <Cell label="Acceptance" value={cleaner.acceptance_rate != null ? `${(Number(cleaner.acceptance_rate) * 100).toFixed(0)}%` : "—"} />
        <Cell label="Completed jobs" value={num(cleaner.completed_bookings, "")} />
        <Cell label="Total bookings" value={num(cleaner.total_bookings, "")} />
        <Cell label="Last 7d jobs" value={num(cleaner.jobs_assigned_last_7d, "")} />
        <Cell label="Workload score" value={cleaner.workload_score != null ? Number(cleaner.workload_score).toFixed(2) : "—"} />
        <Cell
          label="Constraints"
          value={
            cleaner.constraints
              ? [
                  cleaner.constraints.no_work_after ? `No work after ${cleaner.constraints.no_work_after}` : null,
                  cleaner.constraints.no_work_before ? `No work before ${cleaner.constraints.no_work_before}` : null,
                  cleaner.constraints.notes || null,
                ].filter(Boolean).join(" · ") || "—"
              : "—"
          }
        />
      </dl>

      {/* Override audit trail — who, when, why, old → new. */}
      {history && history.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Score override history</p>
          {history.map((h) => (
            <div key={h.id} className="text-xs rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
              <span className="font-semibold text-slate-800">
                {SCORE_FIELDS.find((f) => f.id === h.field)?.label || h.field}
              </span>{" "}
              {h.new_value == null
                ? <>override cleared (was {h.old_value ?? "—"})</>
                : <>{h.old_value ?? "—"} → <span className="font-semibold">{h.new_value}</span></>}
              {h.active && h.new_value != null && <Badge variant="outline" className="ml-1.5 text-[9px] py-0 border-violet-300 text-violet-700">active</Badge>}
              <span className="text-slate-500"> — “{h.reason}”</span>
              <div className="text-[10px] text-slate-400">
                {h.created_by_name || "Admin"} · {new Date(h.created_at).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!overrideField} onOpenChange={(o) => { if (!o) setOverrideField(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Override {SCORE_FIELDS.find((f) => f.id === overrideField)?.label || "score"}
            </DialogTitle>
            <DialogDescription>
              The data won’t always tell the whole story — but every override is
              logged (who, when, why, old → new) and visible in the history. Never silent.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>New value (0–100)</Label>
              <Input
                type="number" min={0} max={100}
                value={overrideValue}
                onChange={(e) => setOverrideValue(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label>Reason (required)</Label>
              <Input
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="e.g. Family emergency caused the declines — verified"
                className="mt-1"
              />
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={() => void submitOverride(false)} disabled={working}>
                {working ? <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" /> : null}
                Pin score
              </Button>
              {overrideField && activeOverrides.has(overrideField) && (
                <Button variant="outline" className="flex-1" onClick={() => void submitOverride(true)} disabled={working}>
                  Clear override
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">{label}</dt>
      <dd className="text-slate-900 font-medium">{value}</dd>
    </div>
  );
}

function GhlBlock({
  cleaner,
  onResync,
  actioning,
}: {
  cleaner: CleanerRow;
  onResync: () => void;
  actioning: boolean;
}) {
  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Last GHL sync</p>
        <p className="text-slate-900">
          {cleaner.ghl_synced_at
            ? new Date(cleaner.ghl_synced_at).toLocaleString()
            : "Never synced"}
        </p>
      </div>
      {cleaner.ghl_sync_error ? (
        <div className="px-3 py-2 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs">
          <RiAlertLine className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />
          {cleaner.ghl_sync_error}
        </div>
      ) : null}
      <Button onClick={onResync} disabled={actioning} className="bg-violet-600 hover:bg-violet-700 text-white">
        {actioning ? <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" /> : <RiRefreshLine className="w-4 h-4 mr-2" />}
        Resync to GHL now
      </Button>
    </div>
  );
}

const PAY_TIER_LADDER = [
  { tier: "foundation", pct: 35, label: "Foundation" },
  { tier: "proven", pct: 40, label: "Proven" },
  { tier: "elite", pct: 45, label: "Elite" },
] as const;

function ActionsBlock({
  cleaner,
  onAction,
  onDelete,
  onRefresh,
  actioning,
}: {
  cleaner: CleanerRow;
  onAction: (
    action:
      | "deactivate"
      | "terminate"
      | "reactivate"
      | "flag"
      | "update_compliance"
      | "set_status"
      | "advance_pay_tier"
      | "send_agreement",
    extra?: Record<string, unknown>,
  ) => void;
  onDelete: () => void;
  onRefresh: () => void;
  actioning: boolean;
}) {
  const { isAdmin } = useAdminRole();
  const s = (cleaner.status || "pending").toLowerCase();
  const [termOpen, setTermOpen] = useState(false);
  const [statusDraft, setStatusDraft] = useState(s);
  const [statusReason, setStatusReason] = useState("");
  const [availableForBookings, setAvailableForBookings] = useState(
    Boolean(cleaner.available_for_bookings),
  );
  const [approved, setApproved] = useState(Boolean(cleaner.approved));
  const [skipCompliance, setSkipCompliance] = useState(false);

  useEffect(() => {
    setStatusDraft((cleaner.status || "pending").toLowerCase());
    setAvailableForBookings(Boolean(cleaner.available_for_bookings));
    setApproved(Boolean(cleaner.approved));
    setStatusReason("");
    setSkipCompliance(false);
  }, [cleaner.id, cleaner.status, cleaner.available_for_bookings, cleaner.approved]);

  const applyStatus = () => {
    if (statusDraft === s) {
      toast.info("Status is already set to " + statusDraft);
      return;
    }
    if (
      (statusDraft === "inactive" || statusDraft === "terminated") &&
      !statusReason.trim()
    ) {
      toast.error("Add a short reason for inactive or terminated status.");
      return;
    }
    if (
      statusDraft === "terminated" &&
      !confirm("Set status to terminated? They will lose booking eligibility.")
    ) {
      return;
    }
    onAction("set_status", {
      status: statusDraft,
      reason: statusReason.trim() || "admin_manual_status_change",
      availableForBookings: availableForBookings,
      approved,
      skipComplianceCheck: skipCompliance,
    });
  };

  const currentTierRaw = String(cleaner.pay_tier || "foundation").toLowerCase();
  const tierIdx = Math.max(
    0,
    PAY_TIER_LADDER.findIndex((t) => t.tier === currentTierRaw),
  );
  const currentTier = PAY_TIER_LADDER[tierIdx];
  const nextTier = PAY_TIER_LADDER[tierIdx + 1] ?? null;

  return (
    <div className="space-y-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
        Pay tier
      </p>
      <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">
              {currentTier.label} · {cleaner.pay_percentage ?? currentTier.pct}% revenue share
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              {nextTier
                ? `Next: ${nextTier.label} · ${nextTier.pct}%`
                : "Already at the top tier (Elite · 45%)."}
            </p>
          </div>
          <Button
            type="button"
            disabled={actioning || !nextTier || s === "terminated"}
            onClick={() => {
              if (!nextTier) return;
              if (
                !confirm(
                  `Promote ${cleaner.first_name || "this cleaner"} from ${currentTier.label} (${currentTier.pct}%) to ${nextTier.label} (${nextTier.pct}%)?\n\nThey'll get an email about the raise. Past jobs keep their old rate.`,
                )
              ) {
                return;
              }
              onAction("advance_pay_tier");
            }}
            className="bg-emerald-600 hover:bg-emerald-700 text-white shrink-0"
          >
            {actioning ? (
              <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" />
            ) : (
              <RiUserStarLine className="w-4 h-4 mr-1.5" />
            )}
            {nextTier ? `Increase to ${nextTier.pct}%` : "Max tier"}
          </Button>
        </div>
      </div>

      <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
        Status (manual)
      </p>
      <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <Label className="text-xs text-slate-600">Directory status</Label>
            <Select value={statusDraft} onValueChange={setStatusDraft} disabled={actioning}>
              <SelectTrigger className="bg-white mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {/* Suspension is managed by the Accountability tab, not the
                    manual picker — shown here (disabled) so the current
                    state renders; setting Active is the manual escape hatch. */}
                {s === "suspended" && (
                  <SelectItem value="suspended" disabled>
                    Suspended (accountability)
                  </SelectItem>
                )}
                {CLEANER_STATUSES.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-slate-600">Reason (inactive / terminated)</Label>
            <Input
              className="bg-white mt-1"
              value={statusReason}
              onChange={(e) => setStatusReason(e.target.value)}
              placeholder="e.g. seasonal pause"
              disabled={actioning}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={availableForBookings}
              onChange={(e) => setAvailableForBookings(e.target.checked)}
              disabled={actioning}
              className="rounded border-slate-300"
            />
            <span className="text-slate-700">Available for bookings</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={approved}
              onChange={(e) => setApproved(e.target.checked)}
              disabled={actioning}
              className="rounded border-slate-300"
            />
            <span className="text-slate-700">Approved</span>
          </label>
          {isAdmin && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={skipCompliance}
                onChange={(e) => setSkipCompliance(e.target.checked)}
                disabled={actioning}
                className="rounded border-slate-300"
              />
              <span className="text-slate-700">Skip compliance (admin)</span>
            </label>
          )}
        </div>
        <Button
          type="button"
          disabled={actioning || statusDraft === s}
          onClick={applyStatus}
          className="bg-indigo-600 hover:bg-indigo-700 text-white"
        >
          {actioning ? (
            <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" />
          ) : (
            <RiCheckLine className="w-4 h-4 mr-1.5" />
          )}
          Update status
        </Button>
      </div>

      <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Lifecycle shortcuts</p>
      <div className="flex flex-wrap gap-2">
        {s === "active" || s === "pending" ? (
          <Button
            variant="outline"
            disabled={actioning}
            onClick={() => {
              const choice = window.prompt(
                "Deactivate reason — pick one:\n" +
                  "  personal_request | performance_issue | no_show_pattern | compliance_failure | low_rating | customer_complaint | other",
                "personal_request",
              );
              if (!choice) return;
              onAction("deactivate", { reason: choice.trim() });
            }}
            className="border-amber-200 text-amber-800 bg-amber-50 hover:bg-amber-100"
          >
            <RiTimeLine className="w-4 h-4 mr-1.5" />
            Pause / deactivate
          </Button>
        ) : null}
        {s !== "terminated" ? (
          <Button
            variant="outline"
            disabled={actioning}
            onClick={() => setTermOpen(true)}
            className="border-rose-200 text-rose-800 bg-rose-50 hover:bg-rose-100"
          >
            <RiCloseCircleLine className="w-4 h-4 mr-1.5" />
            Terminate
          </Button>
        ) : null}
        {(s === "inactive" || s === "terminated") ? (
          <Button
            variant="outline"
            disabled={actioning}
            onClick={() => onAction("reactivate")}
            className="border-violet-200 text-violet-800 bg-violet-50 hover:bg-violet-100"
          >
            <RiArrowGoBackLine className="w-4 h-4 mr-1.5" />
            Reactivate
          </Button>
        ) : null}
        <Button
          variant="outline"
          disabled={actioning}
          onClick={() => {
            const issueType = window.prompt(
              "Flag issue type — pick one:\n" +
                "  background_check_expiring | insurance_expiring | low_rating | attendance_problem | customer_complaint | quality_issue | policy_violation | no_show | other",
              "other",
            );
            if (!issueType) return;
            const details = window.prompt("Flag note / details (optional):") || undefined;
            onAction("flag", { issueType: issueType.trim(), details });
          }}
          className="border-slate-200 text-slate-700"
        >
          <RiAlertLine className="w-4 h-4 mr-1.5" />
          Flag for review
        </Button>
        <Button
          variant="outline"
          disabled={actioning}
          onClick={async () => {
            try {
              const { data, error } = await supabase.functions.invoke("apploye-invite-cleaner", {
                body: { cleanerId: cleaner.id },
              });
              if (error) throw error;
              if (data?.error) throw new Error(data.details || data.error);
              if (data?.alreadyInvited) {
                toast.success("Cleaner already has an Apploye seat.");
              } else {
                toast.success("Apploye invite sent — they'll get an email from Apploye.");
              }
            } catch (err) {
              toast.error("Apploye invite failed: " + (err as Error).message);
            }
          }}
          className="border-sky-200 text-sky-800 bg-sky-50 hover:bg-sky-100"
        >
          <RiTimeLine className="w-4 h-4 mr-1.5" />
          Invite to Apploye
        </Button>
        {/* Hard delete is admin-only (cleaner-admin-action rejects VAs). */}
        {isAdmin && (
          <Button
            variant="outline"
            disabled={actioning}
            onClick={onDelete}
            className="border-rose-300 text-rose-900 bg-rose-50 hover:bg-rose-100"
          >
            <RiCloseLine className="w-4 h-4 mr-1.5" />
            Delete from directory
          </Button>
        )}
      </div>
      {cleaner.rehire_status && REHIRE_BADGE[cleaner.rehire_status] ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 text-xs text-slate-600 flex items-center gap-2">
          <span className="font-semibold text-slate-700">Rehire status:</span>
          <Badge variant="outline" className={REHIRE_BADGE[cleaner.rehire_status].cls}>
            {REHIRE_BADGE[cleaner.rehire_status].label}
          </Badge>
          {cleaner.termination_reason ? (
            <span className="text-slate-400">· {cleaner.termination_reason.replaceAll("_", " ")}</span>
          ) : null}
        </div>
      ) : null}

      {actioning ? (
        <p className="text-xs text-slate-500 inline-flex items-center gap-1.5">
          <RiLoader4Line className="w-3.5 h-3.5 animate-spin" /> Applying…
        </p>
      ) : null}

      <TerminateCleanerDialog
        open={termOpen}
        onOpenChange={setTermOpen}
        cleanerId={cleaner.id}
        cleanerName={`${cleaner.first_name || ""} ${cleaner.last_name || ""}`.trim() || "this contractor"}
        cleanerEmail={cleaner.email}
        onDone={onRefresh}
      />
    </div>
  );
}

// ─── Add cleaner dialog ───────────────────────────────────────────────
//
// Uses the existing `create-cleaner-account` edge function which:
//   - creates (or reuses) a Supabase auth user (auto-generated password)
//   - upserts the cleaner row with status='active', approved=true
//   - returns the temporary password so the admin can share it
//
function AddCleanerDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}) {
  const [mode, setMode] = useState<"full" | "bypass">("full");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [homeZip, setHomeZip] = useState("");
  const [serviceZips, setServiceZips] = useState("");
  const [payTier, setPayTier] = useState<"foundation" | "proven" | "elite">("foundation");
  const [busy, setBusy] = useState(false);
  const [createdPassword, setCreatedPassword] = useState<string | null>(null);

  // Bypass-onboarding state machine: send code → verify code.
  const [bypassStep, setBypassStep] = useState<"send" | "verify">("send");
  const [bypassCleanerId, setBypassCleanerId] = useState<string | null>(null);
  const [bypassCode, setBypassCode] = useState("");

  const reset = () => {
    setMode("full");
    setFirstName("");
    setLastName("");
    setEmail("");
    setPhone("");
    setHomeZip("");
    setServiceZips("");
    setPayTier("foundation");
    setCreatedPassword(null);
    setBypassStep("send");
    setBypassCleanerId(null);
    setBypassCode("");
  };

  const sendBypassCode = async () => {
    if (!phone.trim()) {
      toast.error("Phone number is required.");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("cleaner-admin-action", {
        body: {
          action: "bypass_onboarding_send_code",
          phone: phone.trim(),
          firstName: firstName.trim() || undefined,
          lastName: lastName.trim() || undefined,
          email: email.trim().toLowerCase() || undefined,
          zip: homeZip.trim() || undefined,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setBypassCleanerId(data?.cleanerId || null);
      setBypassStep("verify");
      toast.success(`Code sent to ${data?.phone || phone.trim()}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const verifyBypassCode = async () => {
    if (!bypassCleanerId) {
      toast.error("No active code session. Re-send first.");
      return;
    }
    if (bypassCode.trim().length < 4) {
      toast.error("Enter the 6-digit code from the SMS.");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("cleaner-admin-action", {
        body: {
          action: "bypass_onboarding_verify_code",
          cleanerId: bypassCleanerId,
          code: bypassCode.trim(),
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Cleaner activated — ready for dispatch.");
      onCreated();
      onOpenChange(false);
      reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !phone.trim()) {
      toast.error("First, last, email, and phone are required.");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-cleaner-account", {
        body: {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim().toLowerCase(),
          phone: phone.trim(),
          homeZip: homeZip.trim() || null,
          serviceZipCodes: serviceZips
            .split(/[,\s]+/)
            .map((z) => z.trim())
            .filter((z) => /^\d{5}$/.test(z)),
          payTier,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(
        data?.reusedExistingLogin
          ? "Existing login reused — temp password reset below."
          : `Cleaner created — share the temp password below.`,
      );
      setCreatedPassword(data?.password || null);
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-jakarta tracking-tight">Add cleaner</SheetTitle>
          <SheetDescription>
            Either create a full auth-backed cleaner account, or skip the
            onboarding flow entirely by verifying their phone number with a
            one-time code.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-5 flex rounded-xl border border-slate-200 p-1 bg-slate-50">
          <button
            type="button"
            onClick={() => { setMode("full"); setBypassStep("send"); setBypassCleanerId(null); setBypassCode(""); }}
            className={cn(
              "flex-1 text-xs font-semibold py-2 rounded-lg transition-colors",
              mode === "full" ? "bg-white shadow-sm text-violet-700" : "text-slate-600 hover:text-slate-900",
            )}
          >
            Full account
          </button>
          <button
            type="button"
            onClick={() => setMode("bypass")}
            className={cn(
              "flex-1 text-xs font-semibold py-2 rounded-lg transition-colors",
              mode === "bypass" ? "bg-white shadow-sm text-violet-700" : "text-slate-600 hover:text-slate-900",
            )}
          >
            Bypass onboarding (phone verify)
          </button>
        </div>

        {mode === "bypass" ? (
          <div className="mt-5 space-y-3">
            <p className="text-[12px] text-slate-500 leading-relaxed">
              {bypassStep === "send"
                ? "Enter their phone number. We'll text a 6-digit code via Telnyx. When they read it back to you, type it in the next step — the cleaner row becomes active, approved, and dispatch-ready (no portal walk-through required)."
                : "Type the code they read back from the SMS. The cleaner row will be activated and made available for dispatch."}
            </p>
            {bypassStep === "send" ? (
              <>
                <div>
                  <Label className="text-xs">Phone *</Label>
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 301 555 0123" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">First name (optional)</Label>
                    <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs">Last name (optional)</Label>
                    <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Email (optional)</Label>
                    <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
                  </div>
                  <div>
                    <Label className="text-xs">Home ZIP (optional)</Label>
                    <Input value={homeZip} onChange={(e) => setHomeZip(e.target.value)} maxLength={5} />
                  </div>
                </div>
                <Button
                  onClick={sendBypassCode}
                  disabled={busy}
                  className="w-full bg-violet-600 hover:bg-violet-700 text-white"
                >
                  {busy ? (
                    <>
                      <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" /> Sending code…
                    </>
                  ) : (
                    <>Send 6-digit code via SMS</>
                  )}
                </Button>
              </>
            ) : (
              <>
                <div>
                  <Label className="text-xs">6-digit code</Label>
                  <Input
                    value={bypassCode}
                    onChange={(e) => setBypassCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                    placeholder="123456"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    className="text-lg tracking-widest text-center font-mono"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => { setBypassStep("send"); setBypassCode(""); }}
                  >
                    Re-send code
                  </Button>
                  <Button
                    onClick={verifyBypassCode}
                    disabled={busy || bypassCode.length < 4}
                    className="flex-1 bg-violet-600 hover:bg-violet-700 text-white"
                  >
                    {busy ? <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" /> : null}
                    Verify + activate
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : (
        <div className="mt-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">First name *</Label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Last name *</Label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
          <div>
            <Label className="text-xs">Email *</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
          </div>
          <div>
            <Label className="text-xs">Phone *</Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 301 555 0123"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Home ZIP</Label>
              <Input value={homeZip} onChange={(e) => setHomeZip(e.target.value)} maxLength={5} />
            </div>
            <div>
              <Label className="text-xs">Pay tier</Label>
              <select
                value={payTier}
                onChange={(e) => setPayTier(e.target.value as "foundation" | "proven" | "elite")}
                className="flex h-9 w-full rounded-md border border-slate-300 bg-white px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-500"
              >
                <option value="foundation">Foundation (35%)</option>
                <option value="proven">Proven (40%)</option>
                <option value="elite">Elite (45%)</option>
              </select>
            </div>
          </div>
          <div>
            <Label className="text-xs">Service ZIPs (comma-separated)</Label>
            <Input
              value={serviceZips}
              onChange={(e) => setServiceZips(e.target.value)}
              placeholder="21230, 21201, 21209"
            />
          </div>
          <Button
            onClick={submit}
            disabled={busy}
            className="w-full bg-violet-600 hover:bg-violet-700 text-white"
          >
            {busy ? (
              <>
                <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" /> Creating…
              </>
            ) : (
              <>+ Create cleaner</>
            )}
          </Button>
          {createdPassword && (
            <div className="rounded-md border border-violet-200 bg-violet-50 p-3 text-xs">
              <p className="font-semibold text-violet-900 mb-1">
                Temporary password (share this)
              </p>
              <p className="font-mono text-sm break-all text-violet-900">{createdPassword}</p>
              <p className="text-[11px] text-violet-700 mt-2">
                Tell them to sign in at app.novaracleaning.com/contractor and change it.
              </p>
            </div>
          )}
        </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Edit cleaner personal / profile info ──────────────────────────────────
// Name, contact, home address, service area, travel radius, skills — routed
// through admin-update-cleaner (allow-listed fields only; lifecycle/status/
// pay stay with their dedicated flows). GHL re-syncs automatically on save.
// Admin-configurable composite weights + on-demand recompute for the
// Novara scoring engine (acceptance/workload/volume → Novara Score;
// reliability/quality → Overall).
function ScoreEngineDialog({ onChanged }: { onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [w, setW] = useState({ acceptance: 40, workload: 30, volume: 30, reliability: 60, quality: 40 });

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const { data } = await (supabase.from as any)("app_settings")
        .select("value").eq("key", "scoring_weights").maybeSingle();
      if (data?.value) setW((prev) => ({ ...prev, ...data.value }));
    })();
  }, [open]);

  const setKey = (k: keyof typeof w) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setW((prev) => ({ ...prev, [k]: Number(e.target.value) }));

  const save = async () => {
    setWorking(true);
    try {
      const { data, error } = await supabase.functions.invoke("cleaner-scores-admin", {
        body: { action: "set_weights", weights: w },
      });
      if (error) throw error;
      if ((data as { ok?: boolean; error?: string })?.ok === false) throw new Error((data as { error?: string }).error || "Failed");
      toast.success("Weights saved — scores recomputing.");
      setOpen(false);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save weights");
    } finally {
      setWorking(false);
    }
  };

  const recompute = async () => {
    setWorking(true);
    try {
      const { error } = await supabase.functions.invoke("cleaner-scores-admin", { body: { action: "recompute" } });
      if (error) throw error;
      toast.success("Scores recomputed from live data.");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Recompute failed");
    } finally {
      setWorking(false);
    }
  };

  const relSum = w.acceptance + w.workload + w.volume;
  const ovSum = w.reliability + w.quality;

  return (
    <>
      <Button variant="outline" className="border-slate-200 text-slate-700" onClick={() => setOpen(true)}>
        Score engine
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Novara scoring — weights</DialogTitle>
            <DialogDescription>
              Novara Score (reliability) blends acceptance, workload consistency,
              and completed volume. Overall blends reliability and quality (the
              Rating from QC cases + customer ratings). Tips never touch any score.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold text-slate-600 mb-2">
                Novara Score composite{" "}
                <span className={relSum === 100 ? "text-emerald-600" : "text-amber-600"}>({relSum}/100)</span>
              </p>
              <div className="grid grid-cols-3 gap-2">
                <div><Label className="text-[11px]">Acceptance</Label><Input type="number" min={0} max={100} value={w.acceptance} onChange={setKey("acceptance")} className="mt-1" /></div>
                <div><Label className="text-[11px]">Workload</Label><Input type="number" min={0} max={100} value={w.workload} onChange={setKey("workload")} className="mt-1" /></div>
                <div><Label className="text-[11px]">Jobs done</Label><Input type="number" min={0} max={100} value={w.volume} onChange={setKey("volume")} className="mt-1" /></div>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-600 mb-2">
                Overall split{" "}
                <span className={ovSum === 100 ? "text-emerald-600" : "text-amber-600"}>({ovSum}/100)</span>
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-[11px]">Reliability</Label><Input type="number" min={0} max={100} value={w.reliability} onChange={setKey("reliability")} className="mt-1" /></div>
                <div><Label className="text-[11px]">Quality</Label><Input type="number" min={0} max={100} value={w.quality} onChange={setKey("quality")} className="mt-1" /></div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={() => void save()} disabled={working}>
                {working ? <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" /> : null}
                Save & recompute
              </Button>
              <Button variant="outline" onClick={() => void recompute()} disabled={working}>
                Recompute only
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function EditCleanerProfileDialog({ cleaner, onSaved }: { cleaner: CleanerRow; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({
    first_name: cleaner.first_name || "",
    last_name: cleaner.last_name || "",
    email: cleaner.email || "",
    phone: cleaner.phone || "",
    home_address: cleaner.home_address || "",
    home_city: cleaner.home_city || "",
    state: cleaner.state || "",
    home_zip: cleaner.home_zip || "",
    service_zip_codes: (cleaner.service_zip_codes || []).join(", "),
    max_travel_miles: cleaner.max_travel_miles != null ? String(cleaner.max_travel_miles) : "",
    skillset: (cleaner.skillset || []).join(", "),
    preferred_work_days: (cleaner.preferred_work_days || []).join(", "),
    no_work_after: cleaner.constraints?.no_work_after || "",
    no_work_before: cleaner.constraints?.no_work_before || "",
    constraints_notes: cleaner.constraints?.notes || "",
  });

  // Re-seed the form each time the dialog opens for a (possibly different) cleaner.
  useEffect(() => {
    if (!open) return;
    setF({
      first_name: cleaner.first_name || "",
      last_name: cleaner.last_name || "",
      email: cleaner.email || "",
      phone: cleaner.phone || "",
      home_address: cleaner.home_address || "",
      home_city: cleaner.home_city || "",
      state: cleaner.state || "",
      home_zip: cleaner.home_zip || "",
      service_zip_codes: (cleaner.service_zip_codes || []).join(", "),
      max_travel_miles: cleaner.max_travel_miles != null ? String(cleaner.max_travel_miles) : "",
      skillset: (cleaner.skillset || []).join(", "),
      preferred_work_days: (cleaner.preferred_work_days || []).join(", "),
      no_work_after: cleaner.constraints?.no_work_after || "",
      no_work_before: cleaner.constraints?.no_work_before || "",
      constraints_notes: cleaner.constraints?.notes || "",
    });
  }, [open, cleaner]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  const save = async () => {
    if (!f.first_name.trim()) { toast.error("First name is required"); return; }
    setSaving(true);
    try {
      const { no_work_after, no_work_before, constraints_notes, ...rest } = f;
      const { data, error } = await supabase.functions.invoke("admin-update-cleaner", {
        body: {
          cleanerId: cleaner.id,
          fields: {
            ...rest,
            constraints: { no_work_after, no_work_before, notes: constraints_notes },
          },
        },
      });
      if (error) throw error;
      if ((data as { ok?: boolean; error?: string })?.ok === false) {
        throw new Error((data as { error?: string })?.error || "Update failed");
      }
      toast.success("Profile updated — GHL re-syncing");
      setOpen(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" className="h-8" onClick={() => setOpen(true)}>
        <RiEdit2Line className="w-3.5 h-3.5 mr-1.5" /> Edit profile
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit cleaner profile</DialogTitle>
            <DialogDescription>
              Personal & service details. Status, pay tier, and termination stay in their own flows below.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>First name *</Label><Input value={f.first_name} onChange={set("first_name")} className="mt-1" /></div>
              <div><Label>Last name</Label><Input value={f.last_name} onChange={set("last_name")} className="mt-1" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Email</Label><Input type="email" value={f.email} onChange={set("email")} className="mt-1" /></div>
              <div><Label>Phone</Label><Input type="tel" value={f.phone} onChange={set("phone")} className="mt-1" /></div>
            </div>
            <div><Label>Home address</Label><Input value={f.home_address} onChange={set("home_address")} placeholder="Street address" className="mt-1" /></div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>City</Label><Input value={f.home_city} onChange={set("home_city")} className="mt-1" /></div>
              <div><Label>State</Label><Input value={f.state} onChange={set("state")} placeholder="MD" className="mt-1" /></div>
              <div><Label>ZIP</Label><Input value={f.home_zip} onChange={set("home_zip")} className="mt-1" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Service ZIP codes</Label>
                <Input value={f.service_zip_codes} onChange={set("service_zip_codes")} placeholder="21201, 21202…" className="mt-1" />
              </div>
              <div>
                <Label>Max travel (miles)</Label>
                <Input type="number" min={1} value={f.max_travel_miles} onChange={set("max_travel_miles")} className="mt-1" />
              </div>
            </div>
            <div>
              <Label>Skills</Label>
              <Input value={f.skillset} onChange={set("skillset")} placeholder="deep clean, move-out, commercial…" className="mt-1" />
            </div>
            <div>
              <Label>Preferred work days</Label>
              <Input value={f.preferred_work_days} onChange={set("preferred_work_days")} placeholder="Monday, Tuesday…" className="mt-1" />
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                Stated constraints — surface as dispatch risk flags, never auto-restriction
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>No work after</Label><Input value={f.no_work_after} onChange={set("no_work_after")} placeholder="3pm" className="mt-1" /></div>
                <div><Label>No work before</Label><Input value={f.no_work_before} onChange={set("no_work_before")} placeholder="9am" className="mt-1" /></div>
              </div>
              <div>
                <Label>Constraint notes</Label>
                <Input value={f.constraints_notes} onChange={set("constraints_notes")} placeholder="No pets · school pickup Fridays…" className="mt-1" />
              </div>
            </div>
            <Button className="w-full" onClick={() => void save()} disabled={saving}>
              {saving ? <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" /> : <RiCheckLine className="w-4 h-4 mr-2" />}
              Save profile
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
