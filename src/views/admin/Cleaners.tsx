"use client";

// ─── Admin Cleaners (v2 — 2026-05-22) ──────────────────────────────────
//
// Combined directory + management. One screen, no separate "directory" tab.
// - Searchable table of every contractor in public.cleaners
// - Filter by status (active / pending / inactive) and ZIP
// - Click a row → side sheet with:
//     * Profile (name, phone, email, home zip, pay tier)
//     * Onboarding progress (the 5 ob_* flags + phone_verified)
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
} from "@remixicon/react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

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
  pay_rate_hr: number | null;
  completed_bookings: number | null;
  total_bookings: number | null;
  acceptance_rate: number | null;
  on_time_rate: number | null;
  average_rating: number | null;
  weighted_score: number | null;
  workload_score: number | null;
  jobs_assigned_last_7d: number | null;
  onboarding_complete: boolean | null;
  phone_verified: boolean | null;
  ob_agreement_signed: boolean | null;
  ob_google_chat_joined: boolean | null;
  ob_supplies_checklist_viewed: boolean | null;
  ob_payouts_setup: boolean | null;
  ob_training_accessed: boolean | null;
  ghl_synced_at: string | null;
  ghl_sync_error: string | null;
  created_at: string;
  activated_at: string | null;
}

const STATUS_FILTERS = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "pending", label: "Pending" },
  { id: "inactive", label: "Inactive" },
] as const;

const STATUS_BADGE: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800 border-emerald-200",
  pending: "bg-amber-100 text-amber-800 border-amber-200",
  inactive: "bg-slate-100 text-slate-600 border-slate-200",
  terminated: "bg-rose-100 text-rose-800 border-rose-200",
};

const fullName = (c: CleanerRow) =>
  [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email || "—";

const onboardingProgress = (c: CleanerRow): number => {
  const flags = [
    c.phone_verified,
    c.ob_agreement_signed,
    c.ob_google_chat_joined,
    c.ob_supplies_checklist_viewed,
    c.ob_payouts_setup,
    c.ob_training_accessed,
  ];
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
        "id,user_id,first_name,last_name,email,phone,status,approved,available_for_bookings,home_zip,state,pay_tier,pay_rate_hr,completed_bookings,total_bookings,acceptance_rate,on_time_rate,average_rating,weighted_score,workload_score,jobs_assigned_last_7d,onboarding_complete,phone_verified,ob_agreement_signed,ob_google_chat_joined,ob_supplies_checklist_viewed,ob_payouts_setup,ob_training_accessed,ghl_synced_at,ghl_sync_error,created_at,activated_at",
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
    const c = { active: 0, pending: 0, inactive: 0, terminated: 0 };
    cleaners.forEach((r) => {
      const s = (r.status || "pending").toLowerCase();
      if (s in c) (c as any)[s] += 1;
    });
    return c;
  }, [cleaners]);

  const runAction = async (
    action: "deactivate" | "terminate" | "reactivate" | "flag" | "update_compliance",
    extra: Record<string, unknown> = {},
  ) => {
    if (!selected) return;
    setActioning(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not signed in");
      const { data, error } = await supabase.functions.invoke("cleaner-admin-action", {
        body: { action, cleaner_id: selected.id, ...extra },
      });
      if (error) throw error;
      toast.success(`${action} applied`);
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
          <h1 className="text-xl font-semibold text-slate-900">Cleaner directory</h1>
          <p className="text-sm text-slate-500">
            Contractors, onboarding status, performance, and quick actions.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px]">
          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
            <RiCheckLine className="w-3 h-3" /> {counts.active} active
          </span>
          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
            <RiTimeLine className="w-3 h-3" /> {counts.pending} pending
          </span>
          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
            <RiCloseCircleLine className="w-3 h-3" /> {counts.inactive} inactive
          </span>
        </div>
      </div>

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
            <div className="flex gap-1 bg-slate-100 rounded-lg p-1 self-start">
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
                          {c.pay_tier || "Unassigned tier"} · ${c.pay_rate_hr || 0}/hr
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
                                progress === 100 ? "bg-emerald-500" : "bg-amber-400",
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
                        <div className="text-xs text-slate-700">
                          ⭐ {c.average_rating ? Number(c.average_rating).toFixed(2) : "—"} ·{" "}
                          {c.completed_bookings || 0} done
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {c.jobs_assigned_last_7d ?? 0} jobs / 7d
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" variant="ghost" className="text-emerald-700">
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
        onResyncGhl={resyncToGhl}
        actioning={actioning}
      />
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
  onResyncGhl,
  actioning,
}: {
  cleaner: CleanerRow | null;
  onClose: () => void;
  onAction: (
    action: "deactivate" | "terminate" | "reactivate" | "flag" | "update_compliance",
    extra?: Record<string, unknown>,
  ) => void;
  onResyncGhl: () => void;
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
                <StatusBadge status={cleaner.status} />
              </div>
            </SheetHeader>

            <div className="py-4 space-y-5">
              <ContactSection cleaner={cleaner} />

              <Tabs defaultValue="onboarding">
                <TabsList className="grid grid-cols-3 bg-slate-100">
                  <TabsTrigger value="onboarding" className="data-[state=active]:bg-white">
                    Onboarding
                  </TabsTrigger>
                  <TabsTrigger value="performance" className="data-[state=active]:bg-white">
                    Performance
                  </TabsTrigger>
                  <TabsTrigger value="ghl" className="data-[state=active]:bg-white">
                    GHL
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="onboarding" className="pt-3">
                  <OnboardingChecklist cleaner={cleaner} />
                </TabsContent>
                <TabsContent value="performance" className="pt-3">
                  <PerformanceBlock cleaner={cleaner} />
                </TabsContent>
                <TabsContent value="ghl" className="pt-3">
                  <GhlBlock cleaner={cleaner} onResync={onResyncGhl} actioning={actioning} />
                </TabsContent>
              </Tabs>

              <Separator />

              <ActionsBlock
                cleaner={cleaner}
                onAction={onAction}
                actioning={actioning}
              />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ContactSection({ cleaner }: { cleaner: CleanerRow }) {
  return (
    <div className="grid grid-cols-1 gap-2 text-sm">
      <div className="flex items-center gap-2 text-slate-700">
        <RiMailLine className="w-4 h-4 text-slate-400 shrink-0" />
        <a href={`mailto:${cleaner.email}`} className="truncate hover:text-emerald-700">
          {cleaner.email || "—"}
        </a>
      </div>
      <div className="flex items-center gap-2 text-slate-700">
        <RiPhoneLine className="w-4 h-4 text-slate-400 shrink-0" />
        <a href={`tel:${cleaner.phone}`} className="hover:text-emerald-700">
          {cleaner.phone || "—"}
        </a>
        {cleaner.phone_verified ? (
          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">
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

const OB_STEPS: Array<{ key: keyof CleanerRow; label: string }> = [
  { key: "phone_verified", label: "Phone verified" },
  { key: "ob_agreement_signed", label: "Independent contractor agreement signed" },
  { key: "ob_google_chat_joined", label: "Joined the team Google Chat" },
  { key: "ob_supplies_checklist_viewed", label: "Viewed supplies checklist" },
  { key: "ob_payouts_setup", label: "Stripe payouts connected" },
  { key: "ob_training_accessed", label: "Accessed training portal" },
];

function OnboardingChecklist({ cleaner }: { cleaner: CleanerRow }) {
  return (
    <ul className="space-y-1.5">
      {OB_STEPS.map((s) => {
        const done = Boolean((cleaner as any)[s.key]);
        return (
          <li
            key={String(s.key)}
            className={cn(
              "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm",
              done ? "bg-emerald-50 text-emerald-900" : "bg-slate-50 text-slate-600",
            )}
          >
            {done ? (
              <RiCheckboxCircleFill className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <RiCircleLine className="w-4 h-4 text-slate-400 shrink-0" />
            )}
            <span>{s.label}</span>
          </li>
        );
      })}
      <li className="text-[11px] text-slate-500 px-1 pt-2">
        Onboarding complete flag: {cleaner.onboarding_complete ? "yes" : "no"}
      </li>
    </ul>
  );
}

function PerformanceBlock({ cleaner }: { cleaner: CleanerRow }) {
  const num = (v: number | null, suffix = "") => (v == null ? "—" : `${v}${suffix}`);
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
      <Cell label="Avg rating" value={cleaner.average_rating ? Number(cleaner.average_rating).toFixed(2) : "—"} />
      <Cell label="On-time" value={cleaner.on_time_rate != null ? `${(Number(cleaner.on_time_rate) * 100).toFixed(0)}%` : "—"} />
      <Cell label="Acceptance" value={cleaner.acceptance_rate != null ? `${(Number(cleaner.acceptance_rate) * 100).toFixed(0)}%` : "—"} />
      <Cell label="Completed jobs" value={num(cleaner.completed_bookings, "")} />
      <Cell label="Total bookings" value={num(cleaner.total_bookings, "")} />
      <Cell label="Last 7d jobs" value={num(cleaner.jobs_assigned_last_7d, "")} />
      <Cell label="Weighted score" value={cleaner.weighted_score != null ? Number(cleaner.weighted_score).toFixed(2) : "—"} />
      <Cell label="Workload score" value={cleaner.workload_score != null ? Number(cleaner.workload_score).toFixed(2) : "—"} />
    </dl>
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
      <Button onClick={onResync} disabled={actioning} className="bg-emerald-600 hover:bg-emerald-700 text-white">
        {actioning ? <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" /> : <RiRefreshLine className="w-4 h-4 mr-2" />}
        Resync to GHL now
      </Button>
    </div>
  );
}

function ActionsBlock({
  cleaner,
  onAction,
  actioning,
}: {
  cleaner: CleanerRow;
  onAction: (
    action: "deactivate" | "terminate" | "reactivate" | "flag" | "update_compliance",
    extra?: Record<string, unknown>,
  ) => void;
  actioning: boolean;
}) {
  const s = (cleaner.status || "pending").toLowerCase();
  return (
    <div className="space-y-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Lifecycle</p>
      <div className="flex flex-wrap gap-2">
        {s === "active" || s === "pending" ? (
          <Button
            variant="outline"
            disabled={actioning}
            onClick={() => onAction("deactivate", { reason: "Manual pause" })}
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
            onClick={() => {
              if (!confirm("Terminate this cleaner? They will lose portal + payout access.")) return;
              onAction("terminate", { reason: "Manual termination" });
            }}
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
            className="border-emerald-200 text-emerald-800 bg-emerald-50 hover:bg-emerald-100"
          >
            <RiArrowGoBackLine className="w-4 h-4 mr-1.5" />
            Reactivate
          </Button>
        ) : null}
        <Button
          variant="outline"
          disabled={actioning}
          onClick={() => {
            const note = prompt("Flag note (visible to admin only):");
            if (!note) return;
            onAction("flag", { note });
          }}
          className="border-slate-200 text-slate-700"
        >
          <RiAlertLine className="w-4 h-4 mr-1.5" />
          Flag for review
        </Button>
      </div>
      {actioning ? (
        <p className="text-xs text-slate-500 inline-flex items-center gap-1.5">
          <RiLoader4Line className="w-3.5 h-3.5 animate-spin" /> Applying…
        </p>
      ) : null}
    </div>
  );
}
