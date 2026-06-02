"use client";

import { useEffect, useState, useCallback } from "react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { RiAlertLine, RiShieldCheckLine, RiCalendarLine, RiTrophyLine, RiCloseCircleLine, RiUserUnfollowLine, RiUserFollowLine } from "@remixicon/react";

interface Scorecard {
  cleaner_id: string;
  name: string;
  status: string;
  pay_tier: string;
  pay_percentage: number | null;
  total_jobs_completed: number;
  average_rating: number | null;
  total_ratings: number | null;
  on_time_rate: number | null;
  acceptance_rate: number | null;
  cancellation_rate_pct: number;
  no_show_count: number;
  open_flags: number;
  months_of_service: number | null;
  weighted_score: number | null;
  workload_score: number | null;
  background_check_status: string;
  background_check_expires_at: string | null;
  insurance_verified: boolean;
  insurance_expires_at: string | null;
}

interface Tier {
  current_tier: string;
  foundation_to_proven: any;
  proven_to_elite: any;
}

interface Compliance {
  background_check_flag: string;
  background_check_days_left: number | null;
  insurance_flag: string;
  insurance_days_left: number | null;
}

interface Flag {
  id: string;
  issue_type: string;
  severity: string;
  details: string | null;
  created_at: string;
  resolved: boolean;
  resolved_at: string | null;
}

interface CalendarDay {
  date: string;
  weekday: string;
  jobs: any[];
  job_count: number;
  total_hours: number;
  estimated_pay_cents: number;
  exceptions: any[];
}

interface Props {
  cleanerId: string | null;
  onClose: () => void;
  onChanged?: () => void;
}

const DEACTIVATION_REASONS = ["personal_request", "performance_issue", "no_show_pattern", "compliance_failure", "low_rating", "customer_complaint", "other"];
const TERMINATION_REASONS = ["misconduct", "compliance_failure", "persistent_no_show", "contract_violation", "abandoned_role", "other"];
const FLAG_TYPES = ["background_check_expiring", "insurance_expiring", "low_rating", "attendance_problem", "customer_complaint", "quality_issue", "policy_violation", "no_show", "other"];

export default function CleanerScorecard({ cleanerId, onClose, onChanged }: Props) {
  const [scorecard, setScorecard] = useState<Scorecard | null>(null);
  const [tier, setTier] = useState<Tier | null>(null);
  const [compliance, setCompliance] = useState<Compliance | null>(null);
  const [flags, setFlags] = useState<Flag[]>([]);
  const [calendar, setCalendar] = useState<CalendarDay[]>([]);
  const [loading, setLoading] = useState(false);

  const [actionDialog, setActionDialog] = useState<null | "deactivate" | "terminate" | "reactivate" | "flag" | "compliance" | "exception">(null);
  const [reasonValue, setReasonValue] = useState("");
  const [detailsValue, setDetailsValue] = useState("");
  const [issueType, setIssueType] = useState(FLAG_TYPES[0]);
  const [severity, setSeverity] = useState("medium");
  const [compForm, setCompForm] = useState({ backgroundCheckStatus: "verified", backgroundCheckDate: "", backgroundCheckExpiresAt: "", insuranceVerified: true, insuranceCarrier: "", insurancePolicyNumber: "", insuranceExpiresAt: "" });
  const [excForm, setExcForm] = useState({ date: "", type: "day_off", reason: "" });
  const [busy, setBusy] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!cleanerId) return;
    setLoading(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const horizon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      const [scR, tR, cR, fR, calR] = await Promise.all([
        supabase.rpc("get_cleaner_scorecard" as any, { _cleaner_id: cleanerId }),
        supabase.rpc("check_tier_eligibility" as any, { _cleaner_id: cleanerId }),
        supabase.rpc("get_cleaner_compliance" as any, { _cleaner_id: cleanerId }),
        supabase.from("cleaner_flags" as any).select("*").eq("cleaner_id", cleanerId).order("created_at", { ascending: false }).limit(20),
        supabase.rpc("get_cleaner_calendar" as any, { _cleaner_id: cleanerId, _start: today, _end: horizon }),
      ]);
      setScorecard((scR.data as unknown as Scorecard) || null);
      setTier((tR.data as unknown as Tier) || null);
      setCompliance((cR.data as unknown as Compliance) || null);
      setFlags((fR.data as unknown as Flag[]) || []);
      setCalendar((calR.data as { days?: CalendarDay[] })?.days || []);
    } catch (e) {
      console.error("[scorecard] fetch error", e);
      toast.error(`Failed to load scorecard: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [cleanerId]);

  useEffect(() => {
    if (cleanerId) fetchAll();
  }, [cleanerId, fetchAll]);

  const runAction = async () => {
    if (!cleanerId || !actionDialog) return;
    setBusy(true);
    try {
      let endpoint = "cleaner-admin-action";
      let body: Record<string, unknown> = { cleanerId };
      switch (actionDialog) {
        case "deactivate":
          body.action = "deactivate"; body.reason = reasonValue;
          break;
        case "terminate":
          body.action = "terminate"; body.reason = reasonValue;
          break;
        case "reactivate":
          body.action = "reactivate";
          break;
        case "flag":
          body.action = "flag"; body.issueType = issueType; body.severity = severity; body.details = detailsValue;
          break;
        case "compliance":
          body.action = "update_compliance";
          body.compliance = {
            backgroundCheckStatus: compForm.backgroundCheckStatus,
            backgroundCheckDate: compForm.backgroundCheckDate || undefined,
            backgroundCheckExpiresAt: compForm.backgroundCheckExpiresAt || undefined,
            insuranceVerified: compForm.insuranceVerified,
            insuranceCarrier: compForm.insuranceCarrier || undefined,
            insurancePolicyNumber: compForm.insurancePolicyNumber || undefined,
            insuranceExpiresAt: compForm.insuranceExpiresAt || undefined,
          };
          break;
        case "exception":
          endpoint = "cleaner-schedule-exception";
          body = { action: "add", cleanerId, date: excForm.date, type: excForm.type, reason: excForm.reason };
          break;
      }
      const { data, error } = await supabase.functions.invoke(endpoint, { body });
      if (error) throw error;
      const resp = data as any;
      if (resp?.error) throw new Error(resp.error);
      if (actionDialog === "reactivate" && resp?.blockers) {
        toast.error(`Cannot reactivate: ${resp.blockers.join(", ")}`);
        return;
      }
      toast.success(`${actionDialog.replace(/_/g, " ")} succeeded${resp?.reassignedJobs ? ` (${resp.reassignedJobs.length} jobs to reassign)` : ""}`);
      setActionDialog(null);
      setReasonValue(""); setDetailsValue(""); setIssueType(FLAG_TYPES[0]);
      await fetchAll();
      onChanged?.();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      toast.error(`Failed: ${message}`);
    } finally {
      setBusy(false);
    }
  };

  const resolveFlag = async (flagId: string) => {
    if (!cleanerId) return;
    try {
      await supabase.functions.invoke("cleaner-admin-action", { body: { action: "resolve_flag", cleanerId, flagId } });
      toast.success("Flag resolved");
      await fetchAll();
    } catch (e) {
      toast.error(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  if (!cleanerId) return null;

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-5xl bg-slate-900 border-white/10 text-white max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RiTrophyLine className="w-5 h-5 text-amber-400" />
            {scorecard?.name || "Cleaner Scorecard"}
            {scorecard && <Badge variant="outline" className="border-amber-500/30 text-amber-300">{scorecard.pay_tier} · {scorecard.pay_percentage ?? 40}%</Badge>}
            {scorecard && <Badge variant={scorecard.status === "active" ? "default" : "destructive"} className="capitalize">{scorecard.status}</Badge>}
          </DialogTitle>
        </DialogHeader>

        {loading || !scorecard ? (
          <div className="space-y-3">
            <Skeleton className="h-24 bg-slate-800" />
            <Skeleton className="h-32 bg-slate-800" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "Total Jobs", value: scorecard.total_jobs_completed },
                { label: "Rating", value: scorecard.average_rating ? `${scorecard.average_rating} ★` : "—" },
                { label: "On-Time", value: scorecard.on_time_rate != null ? `${scorecard.on_time_rate}%` : "—" },
                { label: "Acceptance", value: scorecard.acceptance_rate != null ? `${scorecard.acceptance_rate}%` : "—" },
                { label: "Cancel %", value: `${scorecard.cancellation_rate_pct}%` },
                { label: "No-Shows", value: scorecard.no_show_count, danger: scorecard.no_show_count > 0 },
                { label: "Open Flags", value: scorecard.open_flags, danger: scorecard.open_flags > 0 },
                { label: "Months", value: scorecard.months_of_service ?? "—" },
              ].map((s) => (
                <Card key={s.label} className={`bg-slate-800/40 border ${s.danger ? "border-red-500/40" : "border-white/5"}`}>
                  <CardContent className="p-3 text-center">
                    <p className={`text-xl font-bold ${s.danger ? "text-red-400" : "text-amber-400"}`}>{s.value}</p>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wide mt-1">{s.label}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {compliance && (
              <Card className={`border ${compliance.background_check_flag !== "ok" || compliance.insurance_flag !== "ok" ? "border-amber-500/40" : "border-white/10"} bg-slate-800/40`}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2"><RiShieldCheckLine className="w-4 h-4 text-amber-400" /> Compliance</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-slate-400">Background Check</p>
                    <p className="text-white">{scorecard.background_check_status} {scorecard.background_check_expires_at ? `(exp ${format(new Date(scorecard.background_check_expires_at), "MMM d, yyyy")})` : ""}</p>
                    <Badge className={`mt-1 ${compliance.background_check_flag === "ok" ? "bg-violet-500/20 text-violet-300" : "bg-amber-500/20 text-amber-300"}`}>{compliance.background_check_flag}</Badge>
                  </div>
                  <div>
                    <p className="text-slate-400">Insurance</p>
                    <p className="text-white">{scorecard.insurance_verified ? "Verified" : "Not verified"} {scorecard.insurance_expires_at ? `(exp ${format(new Date(scorecard.insurance_expires_at), "MMM d, yyyy")})` : ""}</p>
                    <Badge className={`mt-1 ${compliance.insurance_flag === "ok" ? "bg-violet-500/20 text-violet-300" : "bg-amber-500/20 text-amber-300"}`}>{compliance.insurance_flag}</Badge>
                  </div>
                </CardContent>
              </Card>
            )}

            {tier && (
              <Card className="bg-slate-800/40 border border-white/10">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2"><RiTrophyLine className="w-4 h-4 text-amber-400" /> Tier Eligibility (current: {tier.current_tier})</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-3 text-xs">
                  {([["foundation_to_proven", "→ Proven"], ["proven_to_elite", "→ Elite"]] as const).map(([k, label]) => {
                    const t = (tier as any)[k];
                    if (!t) return null;
                    return (
                      <div key={k} className={`p-3 rounded border ${t.eligible ? "border-violet-500/40 bg-violet-500/5" : "border-white/10"}`}>
                        <p className="font-semibold text-sm mb-2">{label} {t.eligible && <span className="text-violet-400">ELIGIBLE</span>}</p>
                        {([["months_tenure", "Months"], ["jobs", "Jobs"], ["on_time", "On-Time%"], ["rating", "Rating"]] as const).map(([f, fl]) => {
                          const met = t[`${f}_met`];
                          return (
                            <div key={f} className="flex justify-between text-xs">
                              <span className={met ? "text-violet-400" : "text-slate-400"}>{met ? "✓" : "✗"} {fl}</span>
                              <span className="text-slate-400">{t[`${f}_actual` as any] ?? "—"} / {t[`${f}_required` as any] ?? t[`${f}_required_pct` as any]}</span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}

            <Card className="bg-slate-800/40 border border-white/10">
              <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm flex items-center gap-2"><RiAlertLine className="w-4 h-4 text-amber-400" /> Recent Flags</CardTitle>
                <Button size="sm" variant="outline" className="text-xs border-white/10" onClick={() => setActionDialog("flag")}>+ Add Flag</Button>
              </CardHeader>
              <CardContent>
                {flags.length === 0 ? (
                  <p className="text-xs text-slate-500">No flags on record.</p>
                ) : (
                  <div className="space-y-2">
                    {flags.map((f) => (
                      <div key={f.id} className="flex items-start justify-between text-sm border-b border-white/5 pb-2 last:border-0">
                        <div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className={`text-xs ${f.severity === "high" || f.severity === "urgent" ? "border-red-500/40 text-red-300" : "border-amber-500/30 text-amber-300"}`}>{f.severity}</Badge>
                            <span className="text-white">{f.issue_type}</span>
                            {f.resolved && <Badge className="bg-violet-500/20 text-violet-300 text-xs">resolved</Badge>}
                          </div>
                          {f.details && <p className="text-xs text-slate-400 mt-1">{f.details}</p>}
                          <p className="text-[10px] text-slate-600 mt-1">{format(new Date(f.created_at), "MMM d, yyyy h:mm a")}</p>
                        </div>
                        {!f.resolved && (
                          <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => resolveFlag(f.id)}>Resolve</Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-slate-800/40 border border-white/10">
              <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm flex items-center gap-2"><RiCalendarLine className="w-4 h-4 text-amber-400" /> Next 30 Days</CardTitle>
                <Button size="sm" variant="outline" className="text-xs border-white/10" onClick={() => setActionDialog("exception")}>+ Add Exception</Button>
              </CardHeader>
              <CardContent>
                {calendar.length === 0 ? (
                  <p className="text-xs text-slate-500">No jobs or exceptions in the next 30 days.</p>
                ) : (
                  <div className="grid grid-cols-7 gap-1 text-xs">
                    {calendar.map((d) => (
                      <div key={d.date} className={`p-1 rounded text-center ${d.exceptions?.length > 0 ? "bg-amber-500/20 text-amber-300" : d.job_count > 0 ? "bg-violet-500/20 text-violet-300" : "bg-slate-700/30 text-slate-500"}`}>
                        <div className="text-[10px] uppercase">{d.weekday?.slice(0, 3)}</div>
                        <div className="text-sm font-bold">{format(new Date(d.date + "T00:00:00"), "d")}</div>
                        {d.job_count > 0 && <div className="text-[10px]">{d.job_count}j</div>}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="flex flex-wrap gap-2 pt-2 border-t border-white/10">
              {scorecard.status === "active" ? (
                <>
                  <Button variant="outline" size="sm" onClick={() => setActionDialog("compliance")}>Update Compliance</Button>
                  <Button variant="outline" size="sm" className="border-amber-500/40 text-amber-300" onClick={() => setActionDialog("deactivate")}>
                    <RiUserUnfollowLine className="w-4 h-4 mr-1" /> Deactivate
                  </Button>
                  <Button variant="outline" size="sm" className="border-red-500/40 text-red-300" onClick={() => setActionDialog("terminate")}>
                    <RiCloseCircleLine className="w-4 h-4 mr-1" /> Terminate
                  </Button>
                </>
              ) : scorecard.status === "inactive" ? (
                <Button variant="outline" size="sm" className="border-violet-500/40 text-violet-300" onClick={() => setActionDialog("reactivate")}>
                  <RiUserFollowLine className="w-4 h-4 mr-1" /> Reactivate
                </Button>
              ) : (
                <Badge variant="destructive">Terminated — record retained for history</Badge>
              )}
            </div>
          </div>
        )}

        <Dialog open={actionDialog !== null} onOpenChange={(v) => { if (!v) setActionDialog(null); }}>
          <DialogContent className="bg-slate-900 border-white/10 text-white max-w-md">
            <DialogHeader>
              <DialogTitle className="capitalize">{actionDialog?.replace(/_/g, " ")}</DialogTitle>
            </DialogHeader>
            {actionDialog === "deactivate" || actionDialog === "terminate" ? (
              <div className="space-y-3">
                <Label>Reason</Label>
                <Select value={reasonValue} onValueChange={setReasonValue}>
                  <SelectTrigger className="bg-slate-800 border-white/10"><SelectValue placeholder="Select reason" /></SelectTrigger>
                  <SelectContent>
                    {(actionDialog === "deactivate" ? DEACTIVATION_REASONS : TERMINATION_REASONS).map((r) => (
                      <SelectItem key={r} value={r}>{r.replace(/_/g, " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {actionDialog === "terminate" && (
                  <p className="text-xs text-red-300">⚠ Termination is permanent. The cleaner cannot be reactivated. Future jobs will be marked for reassignment.</p>
                )}
              </div>
            ) : actionDialog === "reactivate" ? (
              <p className="text-sm text-slate-300">Reactivation requires current background check + verified insurance. The system will block if either is expired.</p>
            ) : actionDialog === "flag" ? (
              <div className="space-y-3">
                <div>
                  <Label>Issue Type</Label>
                  <Select value={issueType} onValueChange={setIssueType}>
                    <SelectTrigger className="bg-slate-800 border-white/10"><SelectValue /></SelectTrigger>
                    <SelectContent>{FLAG_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Severity</Label>
                  <Select value={severity} onValueChange={setSeverity}>
                    <SelectTrigger className="bg-slate-800 border-white/10"><SelectValue /></SelectTrigger>
                    <SelectContent>{["low", "medium", "high", "urgent"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Details</Label>
                  <Textarea value={detailsValue} onChange={(e) => setDetailsValue(e.target.value)} className="bg-slate-800 border-white/10" />
                </div>
              </div>
            ) : actionDialog === "compliance" ? (
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div><Label>BG Check Status</Label><Input value={compForm.backgroundCheckStatus} onChange={(e) => setCompForm({ ...compForm, backgroundCheckStatus: e.target.value })} className="bg-slate-800 border-white/10" /></div>
                  <div><Label>BG Check Expires</Label><Input type="date" value={compForm.backgroundCheckExpiresAt} onChange={(e) => setCompForm({ ...compForm, backgroundCheckExpiresAt: e.target.value })} className="bg-slate-800 border-white/10" /></div>
                  <div><Label>BG Check Date</Label><Input type="date" value={compForm.backgroundCheckDate} onChange={(e) => setCompForm({ ...compForm, backgroundCheckDate: e.target.value })} className="bg-slate-800 border-white/10" /></div>
                  <div className="flex items-end"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={compForm.insuranceVerified} onChange={(e) => setCompForm({ ...compForm, insuranceVerified: e.target.checked })} /> Insurance verified</label></div>
                  <div><Label>Carrier</Label><Input value={compForm.insuranceCarrier} onChange={(e) => setCompForm({ ...compForm, insuranceCarrier: e.target.value })} className="bg-slate-800 border-white/10" /></div>
                  <div><Label>Policy #</Label><Input value={compForm.insurancePolicyNumber} onChange={(e) => setCompForm({ ...compForm, insurancePolicyNumber: e.target.value })} className="bg-slate-800 border-white/10" /></div>
                  <div className="col-span-2"><Label>Insurance Expires</Label><Input type="date" value={compForm.insuranceExpiresAt} onChange={(e) => setCompForm({ ...compForm, insuranceExpiresAt: e.target.value })} className="bg-slate-800 border-white/10" /></div>
                </div>
              </div>
            ) : actionDialog === "exception" ? (
              <div className="space-y-3">
                <div><Label>Date</Label><Input type="date" value={excForm.date} onChange={(e) => setExcForm({ ...excForm, date: e.target.value })} className="bg-slate-800 border-white/10" /></div>
                <div>
                  <Label>Type</Label>
                  <Select value={excForm.type} onValueChange={(v) => setExcForm({ ...excForm, type: v })}>
                    <SelectTrigger className="bg-slate-800 border-white/10"><SelectValue /></SelectTrigger>
                    <SelectContent>{["day_off", "sick", "vacation", "custom"].map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Reason</Label><Textarea value={excForm.reason} onChange={(e) => setExcForm({ ...excForm, reason: e.target.value })} className="bg-slate-800 border-white/10" /></div>
              </div>
            ) : null}
            <DialogFooter>
              <Button variant="outline" onClick={() => setActionDialog(null)} disabled={busy}>Cancel</Button>
              <Button onClick={runAction} disabled={busy} className="bg-amber-500 text-slate-950 hover:bg-amber-400">{busy ? "Working..." : "Confirm"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
