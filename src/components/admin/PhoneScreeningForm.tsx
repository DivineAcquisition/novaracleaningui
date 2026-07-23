"use client";

// ─── Live phone-screening form ─────────────────────────────────────────────────
//
// The VA runs the ENTIRE call from this sheet: it opens off an applicant in
// the cleaner hub pre-filled with what intake already captured, shows every
// read-aloud script inline next to its field, auto-saves continuously as a
// draft (a dropped call never loses work — reopening resumes exactly where
// it left off), and tracks per-section progress so nothing gets skipped.
//
// Behavior highlights:
//   · Hard qualifiers gate the call: a FAIL immediately offers the polite
//     decline path (short-form submit, no forcing the remaining sections);
//     a fixable qualifier marked PENDING routes to Hold with a required
//     follow-up date.
//   · Consents are captured individually (Yes/No + optional note), stamped
//     with who/when automatically, and any No blocks an Advance.
//   · Inconsistent recommendations are BLOCKED — the same validation runs
//     here and authoritatively on the server.
//   · On submit a branded screening-record PDF is generated and attached to
//     the applicant; Advance offers the existing Launch Onboarding action.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RiAlertLine,
  RiCheckboxCircleFill,
  RiCloseCircleLine,
  RiFileTextLine,
  RiLoader4Line,
  RiPauseCircleLine,
  RiPhoneLine,
  RiSendPlaneLine,
  RiStarFill,
  RiStarLine,
  RiVolumeUpLine,
} from "@remixicon/react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  CONSENT_ITEMS,
  DECLINE_REASONS,
  DECLINE_SCRIPT,
  HOLD_SCRIPT,
  SCORECARD_ITEMS,
  SCREENING_SECTIONS,
  consentsState,
  hardQualifierState,
  sectionProgress,
  validateScreeningOutcome,
  type PhoneScreeningRow,
  type Recommendation,
  type ScreeningAnswers,
  type ScreeningConsents,
  type ScreeningQuestion,
  type ScreeningScorecard,
} from "@/lib/phone-screening";

interface ScreeningApplicant {
  id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
}

interface SubmitResult {
  stage: string;
  recommendation: Recommendation;
  offerLaunchOnboarding: boolean;
  pdf: "generated" | "failed";
  pdfError?: string;
}

async function api(body: Record<string, unknown>): Promise<{ ok: boolean; data?: any; error?: string }> {
  const { data: sessionData } = await supabase.auth.getSession();
  const res = await fetch("/api/talent/screening", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionData.session?.access_token || ""}`,
    },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: j?.error || `Failed (${res.status})`, data: j };
  return { ok: true, data: j };
}

async function callTalentAction(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
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

// Map a failed qualifier to its standardized decline reason where one exists.
const QUALIFIER_DECLINE_REASON: Record<string, string> = {
  age_work_auth: "no_work_authorization",
  vehicle: "no_vehicle",
  phone_app: "failed_hard_qualifier",
  own_products: "failed_hard_qualifier",
  photo_id: "failed_hard_qualifier",
};

export default function PhoneScreeningForm({
  applicant,
  open,
  onOpenChange,
  onFinished,
}: {
  applicant: ScreeningApplicant | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a submit (or close) so the parent can refresh. */
  onFinished?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [screening, setScreening] = useState<PhoneScreeningRow | null>(null);

  // Live form state (mirrors the draft row).
  const [answers, setAnswers] = useState<ScreeningAnswers>({});
  const [consents, setConsents] = useState<ScreeningConsents>({});
  const [scorecard, setScorecard] = useState<ScreeningScorecard>({});
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [declineReason, setDeclineReason] = useState<string>("");
  const [declineNotes, setDeclineNotes] = useState<string>("");
  const [holdPending, setHoldPending] = useState<string>("");
  const [holdDate, setHoldDate] = useState<string>("");

  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null);
  const [launching, setLaunching] = useState(false);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextAutosave = useRef(true);
  const latestPayload = useRef<Record<string, unknown> | null>(null);

  const name =
    applicant?.full_name ||
    [applicant?.first_name, applicant?.last_name].filter(Boolean).join(" ") ||
    applicant?.email ||
    "the applicant";
  const firstName = applicant?.first_name || name.split(" ")[0] || "there";

  // ── Start / resume the draft when opened ──
  useEffect(() => {
    if (!open || !applicant) return;
    let cancelled = false;
    setLoading(true);
    setSubmitResult(null);
    void (async () => {
      const res = await api({ action: "start", applicantId: applicant.id });
      if (cancelled) return;
      setLoading(false);
      if (!res.ok) {
        toast.error("Couldn't start the screening", { description: res.error });
        onOpenChange(false);
        return;
      }
      const s = res.data.screening as PhoneScreeningRow;
      skipNextAutosave.current = true;
      setScreening(s);
      setAnswers(s.answers || {});
      setConsents(s.consents || {});
      setScorecard(s.scorecard || {});
      setRecommendation(s.recommendation || null);
      setDeclineReason(s.decline_reason || "");
      setDeclineNotes(s.decline_notes || "");
      setHoldPending(s.hold_pending || "");
      setHoldDate(s.hold_follow_up_date || "");
      setSaveState("saved");
      setLastSavedAt(null);
      if (res.data.resumed) {
        toast.info("Resumed your in-progress screening — nothing was lost.");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, applicant?.id]);

  const buildPatch = useCallback(
    () => ({
      answers,
      consents,
      scorecard,
      recommendation,
      decline_reason: declineReason || null,
      decline_notes: declineNotes || null,
      hold_pending: holdPending || null,
      hold_follow_up_date: holdDate || null,
    }),
    [answers, consents, scorecard, recommendation, declineReason, declineNotes, holdPending, holdDate],
  );

  const flushSave = useCallback(async (): Promise<boolean> => {
    if (!screening || screening.status !== "draft") return true;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    setSaveState("saving");
    const res = await api({ action: "save", screeningId: screening.id, patch: latestPayload.current || buildPatch() });
    if (!res.ok) {
      setSaveState("error");
      return false;
    }
    setSaveState("saved");
    setLastSavedAt(new Date());
    return true;
  }, [screening, buildPatch]);

  // ── Continuous auto-save (debounced) — a dropped call never loses work ──
  useEffect(() => {
    if (!screening || screening.status !== "draft") return;
    latestPayload.current = buildPatch();
    if (skipNextAutosave.current) {
      skipNextAutosave.current = false;
      return;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void flushSave();
    }, 800);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildPatch]);

  // ── Derived state ──
  const hq = useMemo(() => hardQualifierState(answers), [answers]);
  const cs = useMemo(() => consentsState(consents), [consents]);
  const outcomeErrors = useMemo(
    () =>
      validateScreeningOutcome({
        answers,
        consents,
        recommendation,
        declineReason,
        holdPending,
        holdFollowUpDate: holdDate,
      }),
    [answers, consents, recommendation, declineReason, holdPending, holdDate],
  );
  const advanceBlocked = hq.failed.length > 0 || hq.pending.length > 0 || !cs.allYes;

  const setAnswer = (sectionId: string, key: string, value: unknown) => {
    setAnswers((prev) => ({ ...prev, [sectionId]: { ...(prev[sectionId] || {}), [key]: value } }));
  };

  const setConsent = (key: string, patch: Partial<ScreeningConsents[string]>) => {
    setConsents((prev) => {
      const existing = prev[key];
      const next = { ...(existing || {}), ...patch } as ScreeningConsents[string];
      if (!existing?.at && (patch.value === "yes" || patch.value === "no")) {
        next.at = new Date().toISOString(); // stamped at answer time — never typed
      }
      return { ...prev, [key]: next };
    });
  };

  const scrollToSection = (id: string) => {
    document.getElementById(`screening-section-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const useDeclinePath = () => {
    const first = hq.failed[0];
    setRecommendation("decline");
    setDeclineReason((first && QUALIFIER_DECLINE_REASON[first.key]) || "failed_hard_qualifier");
    if (hq.failed.length > 0) {
      setDeclineNotes((prev) => prev || `Failed hard qualifier: ${hq.failed.map((f) => f.label).join(", ")}`);
    }
    scrollToSection("outcome");
  };

  const useHoldPath = () => {
    setRecommendation("hold");
    setHoldPending((prev) => prev || hq.pending.map((p) => p.label).join(", "));
    scrollToSection("outcome");
  };

  const submit = async () => {
    if (!screening) return;
    setSubmitting(true);
    const savedOk = await flushSave();
    if (!savedOk) {
      setSubmitting(false);
      toast.error("Couldn't save before submitting — check your connection and try again.");
      return;
    }
    const res = await api({ action: "submit", screeningId: screening.id });
    setSubmitting(false);
    if (!res.ok) {
      toast.error("Submission blocked", { description: res.error });
      return;
    }
    setScreening((prev) => (prev ? { ...prev, status: "submitted" } : prev));
    setSubmitResult(res.data as SubmitResult);
    onFinished?.();
  };

  const retryPdf = async () => {
    if (!screening) return;
    const res = await api({ action: "retry_pdf", screeningId: screening.id });
    if (res.ok) {
      toast.success("Screening record PDF generated.");
      setSubmitResult((prev) => (prev ? { ...prev, pdf: "generated", pdfError: undefined } : prev));
      onFinished?.();
    } else {
      toast.error("PDF retry failed", { description: res.error });
    }
  };

  const launchOnboarding = async () => {
    if (!applicant) return;
    setLaunching(true);
    const res = await callTalentAction({ action: "launch_onboarding", applicantId: applicant.id });
    setLaunching(false);
    if (res.ok) {
      toast.success("Onboarding launched — email + SMS sent.");
      onFinished?.();
      onOpenChange(false);
    } else {
      toast.error("Launch failed", { description: res.error });
    }
  };

  const handleOpenChange = (o: boolean) => {
    if (!o) {
      // Flush any pending edits before the sheet closes — closing the tab or
      // the sheet never loses work.
      void flushSave();
      onFinished?.();
    }
    onOpenChange(o);
  };

  const fillScript = (script: string) =>
    script.replace(/\{name\}/g, firstName).replace(/\{screener\}/g, screening?.screener_name || "the Novara team");

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="w-full sm:max-w-3xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 flex-wrap">
            <RiPhoneLine className="w-5 h-5 text-violet-600" />
            Phone screening — {name}
            {screening && (
              <Badge
                variant="outline"
                className={cn(
                  "text-[11px]",
                  screening.status === "draft"
                    ? "bg-amber-50 text-amber-800 border-amber-200"
                    : "bg-emerald-50 text-emerald-700 border-emerald-200",
                )}
              >
                {screening.status === "draft" ? "Draft — auto-saving" : "Submitted"}
              </Badge>
            )}
          </SheetTitle>
          <SheetDescription className="flex items-center gap-2 flex-wrap">
            {screening ? (
              <>
                Screener {screening.screener_name || "—"} · started{" "}
                {new Date(screening.started_at).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
                <span
                  className={cn(
                    "text-[11px] font-medium",
                    saveState === "saved" && "text-emerald-600",
                    saveState === "saving" && "text-slate-500",
                    saveState === "error" && "text-rose-600",
                  )}
                >
                  {saveState === "saving"
                    ? "Saving…"
                    : saveState === "error"
                      ? "Save failed — will retry on next change"
                      : lastSavedAt
                        ? `Saved ${lastSavedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}`
                        : "All changes save automatically"}
                </span>
              </>
            ) : (
              "Read each script aloud — the whole call runs from this form."
            )}
          </SheetDescription>
        </SheetHeader>

        {loading || !screening ? (
          <div className="flex items-center justify-center py-24 text-slate-400">
            <RiLoader4Line className="w-6 h-6 animate-spin" />
          </div>
        ) : submitResult ? (
          <SubmitResultPanel
            result={submitResult}
            name={name}
            launching={launching}
            onLaunch={launchOnboarding}
            onRetryPdf={retryPdf}
            onClose={() => handleOpenChange(false)}
          />
        ) : (
          <div className="mt-4 space-y-5 pb-10">
            {/* ── Progress ── */}
            <div className="flex flex-wrap gap-1.5">
              {SCREENING_SECTIONS.map((s) => {
                const p = sectionProgress(s, answers, consents);
                const done = p.answered >= p.total && p.total > 0;
                return (
                  <button
                    key={s.id}
                    onClick={() => scrollToSection(s.id)}
                    className={cn(
                      "px-2 py-1 rounded-md text-[11px] font-medium border transition-colors",
                      done
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : p.answered > 0
                          ? "bg-amber-50 text-amber-800 border-amber-200"
                          : "bg-slate-50 text-slate-500 border-slate-200 hover:text-slate-800",
                    )}
                  >
                    {done ? "✓ " : ""}
                    {s.title} {p.answered}/{p.total}
                  </button>
                );
              })}
              <button
                onClick={() => scrollToSection("outcome")}
                className={cn(
                  "px-2 py-1 rounded-md text-[11px] font-medium border transition-colors",
                  recommendation
                    ? "bg-violet-50 text-violet-700 border-violet-200"
                    : "bg-slate-50 text-slate-500 border-slate-200 hover:text-slate-800",
                )}
              >
                Scorecard & recommendation
              </button>
            </div>

            {/* ── Hard-qualifier gate ── */}
            {hq.failed.length > 0 && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 space-y-2">
                <div className="flex items-start gap-2 text-sm text-rose-800">
                  <RiAlertLine className="w-4 h-4 mt-0.5 shrink-0" />
                  <div>
                    <span className="font-semibold">Hard qualifier failed:</span>{" "}
                    {hq.failed.map((f) => f.label).join(", ")}. You can end the call now — the remaining
                    sections are not required for a decline.
                  </div>
                </div>
                <ScriptBlock text={fillScript(DECLINE_SCRIPT)} />
                <Button size="sm" className="bg-rose-600 hover:bg-rose-700 text-white" onClick={useDeclinePath}>
                  <RiCloseCircleLine className="w-4 h-4 mr-1.5" />
                  Use the decline path
                </Button>
              </div>
            )}
            {hq.failed.length === 0 && hq.pending.length > 0 && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 space-y-2">
                <div className="flex items-start gap-2 text-sm text-amber-800">
                  <RiPauseCircleLine className="w-4 h-4 mt-0.5 shrink-0" />
                  <div>
                    <span className="font-semibold">Fixable qualifier pending:</span>{" "}
                    {hq.pending.map((f) => f.label).join(", ")}. This routes to <b>Hold</b> with a required
                    follow-up date instead of a decline.
                  </div>
                </div>
                <ScriptBlock text={fillScript(HOLD_SCRIPT)} />
                <Button size="sm" variant="outline" className="border-amber-300 text-amber-800" onClick={useHoldPath}>
                  Route to Hold
                </Button>
              </div>
            )}

            {/* ── Sections ── */}
            {SCREENING_SECTIONS.map((section) => (
              <Card key={section.id} id={`screening-section-${section.id}`} className="border-slate-200 scroll-mt-4">
                <CardContent className="p-4 space-y-4">
                  <h3 className="text-sm font-bold text-slate-900">{section.title}</h3>
                  {section.intro && <ScriptBlock text={fillScript(section.intro)} />}

                  {section.isConsents ? (
                    <div className="space-y-4">
                      {CONSENT_ITEMS.map((item) => {
                        const c = consents[item.key];
                        return (
                          <div key={item.key} className="space-y-1.5 border-l-2 border-slate-100 pl-3">
                            <p className="text-sm font-medium text-slate-800">{item.label}</p>
                            <ScriptBlock text={fillScript(item.script)} />
                            <div className="flex items-center gap-2 flex-wrap">
                              <YesNoToggle
                                value={c?.value}
                                onChange={(v) => setConsent(item.key, { value: v })}
                                yesLabel="Yes — consents"
                                noLabel="No"
                              />
                              {c?.at && (
                                <span className="text-[11px] text-slate-400">
                                  Recorded{" "}
                                  {new Date(c.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                                </span>
                              )}
                            </div>
                            <Input
                              value={c?.note || ""}
                              onChange={(e) => setConsent(item.key, { note: e.target.value })}
                              placeholder="Optional note (pushback, carrier they already have…)"
                              className="h-8 text-xs"
                            />
                          </div>
                        );
                      })}
                      {cs.noItems.length > 0 && (
                        <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md p-2">
                          Consent recorded as <b>No</b>: {cs.noItems.map((n) => n.label).join(", ")} — an Advance
                          recommendation is blocked; route to Hold or Decline.
                        </p>
                      )}
                    </div>
                  ) : section.id === "scenarios" ? (
                    <ScenarioFields
                      values={(answers.scenarios || {}) as Record<string, unknown>}
                      onChange={(key, v) => setAnswer("scenarios", key, v)}
                      fillScript={fillScript}
                    />
                  ) : (
                    <div className="space-y-4">
                      {section.questions.map((q) => (
                        <QuestionField
                          key={q.key}
                          question={q}
                          value={(answers[section.id] || {})[q.key]}
                          onChange={(v) => setAnswer(section.id, q.key, v)}
                          fillScript={fillScript}
                        />
                      ))}
                    </div>
                  )}

                  <div className="pt-1">
                    <Textarea
                      value={String((answers[section.id] || {})._notes || "")}
                      onChange={(e) => setAnswer(section.id, "_notes", e.target.value)}
                      placeholder={`Section notes — anything else from ${section.title.toLowerCase()}…`}
                      rows={2}
                      className="text-xs"
                    />
                  </div>
                </CardContent>
              </Card>
            ))}

            {/* ── Scorecard & recommendation ── */}
            <Card id="screening-section-outcome" className="border-violet-200 scroll-mt-4">
              <CardContent className="p-4 space-y-4">
                <h3 className="text-sm font-bold text-slate-900">Scorecard & Recommendation</h3>

                <div className="space-y-2">
                  {SCORECARD_ITEMS.map((item) => (
                    <div key={item.key} className="flex items-center justify-between gap-2">
                      <span className="text-sm text-slate-700">{item.label}</span>
                      <RatingInput
                        value={scorecard[item.key]}
                        onChange={(v) => setScorecard((prev) => ({ ...prev, [item.key]: v }))}
                      />
                    </div>
                  ))}
                  <div className="flex items-center gap-2 flex-wrap pt-1 text-[11px]">
                    <Badge
                      variant="outline"
                      className={cn(
                        hq.failed.length > 0
                          ? "bg-rose-50 text-rose-700 border-rose-200"
                          : hq.pending.length > 0
                            ? "bg-amber-50 text-amber-800 border-amber-200"
                            : hq.answered === hq.total
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : "bg-slate-50 text-slate-500 border-slate-200",
                      )}
                    >
                      Hard qualifiers:{" "}
                      {hq.failed.length > 0
                        ? "FAIL"
                        : hq.pending.length > 0
                          ? "PENDING"
                          : hq.answered === hq.total
                            ? "PASS"
                            : `${hq.answered}/${hq.total}`}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={cn(
                        cs.allYes
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : cs.noItems.length > 0
                            ? "bg-rose-50 text-rose-700 border-rose-200"
                            : "bg-slate-50 text-slate-500 border-slate-200",
                      )}
                    >
                      Consents: {cs.allYes ? "all Yes" : cs.noItems.length > 0 ? "has a No" : `${cs.answered}/${cs.total}`}
                    </Badge>
                  </div>
                </div>

                <Separator />

                <div className="space-y-2">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Recommendation</p>
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      size="sm"
                      variant={recommendation === "advance" ? "default" : "outline"}
                      className={cn(recommendation === "advance" && "bg-emerald-600 hover:bg-emerald-700 text-white")}
                      disabled={advanceBlocked}
                      title={
                        advanceBlocked
                          ? "Blocked: requires all hard qualifiers passed and every consent Yes"
                          : undefined
                      }
                      onClick={() => setRecommendation("advance")}
                    >
                      Advance
                    </Button>
                    <Button
                      size="sm"
                      variant={recommendation === "hold" ? "default" : "outline"}
                      className={cn(recommendation === "hold" && "bg-amber-600 hover:bg-amber-700 text-white")}
                      onClick={() => setRecommendation("hold")}
                    >
                      Hold
                    </Button>
                    <Button
                      size="sm"
                      variant={recommendation === "decline" ? "default" : "outline"}
                      className={cn(recommendation === "decline" && "bg-rose-600 hover:bg-rose-700 text-white")}
                      onClick={() => setRecommendation("decline")}
                    >
                      Decline
                    </Button>
                  </div>
                  {advanceBlocked && (
                    <p className="text-[11px] text-slate-500">
                      Advance is blocked until every hard qualifier passes and every consent is Yes
                      {hq.pending.length > 0 ? " (pending qualifiers route to Hold)" : ""}.
                    </p>
                  )}

                  {recommendation === "decline" && (
                    <div className="space-y-2 pt-1">
                      <select
                        value={declineReason}
                        onChange={(e) => setDeclineReason(e.target.value)}
                        className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
                      >
                        <option value="">Standardized decline reason…</option>
                        {DECLINE_REASONS.map((r) => (
                          <option key={r.code} value={r.code}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                      <Textarea
                        value={declineNotes}
                        onChange={(e) => setDeclineNotes(e.target.value)}
                        placeholder="Optional notes…"
                        rows={2}
                        className="text-xs"
                      />
                    </div>
                  )}

                  {recommendation === "hold" && (
                    <div className="space-y-2 pt-1">
                      <Input
                        value={holdPending}
                        onChange={(e) => setHoldPending(e.target.value)}
                        placeholder="What is pending? (required — e.g. ID renewal in progress)"
                        className="h-9 text-sm"
                      />
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500 whitespace-nowrap">Follow up on</span>
                        <Input
                          type="date"
                          value={holdDate}
                          onChange={(e) => setHoldDate(e.target.value)}
                          className="h-9 text-sm w-44"
                          min={new Date().toISOString().slice(0, 10)}
                        />
                        <span className="text-[11px] text-slate-400">A dated reminder resurfaces them.</span>
                      </div>
                    </div>
                  )}
                </div>

                {recommendation && outcomeErrors.length > 0 && (
                  <ul className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md p-2.5 space-y-1">
                    {outcomeErrors.map((e) => (
                      <li key={e}>• {e}</li>
                    ))}
                  </ul>
                )}

                <Button
                  className="w-full bg-violet-600 hover:bg-violet-700 text-white"
                  disabled={submitting || !recommendation || outcomeErrors.length > 0}
                  onClick={() => void submit()}
                >
                  {submitting ? (
                    <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" />
                  ) : (
                    <RiSendPlaneLine className="w-4 h-4 mr-1.5" />
                  )}
                  Submit screening & generate record
                </Button>
                <p className="text-[11px] text-slate-400 text-center">
                  Submitting freezes this screening permanently and attaches a branded PDF record to the
                  applicant. Corrections are made by running a new screening.
                </p>
              </CardContent>
            </Card>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

/** Read-aloud script — visually distinct from the capture fields. */
function ScriptBlock({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md bg-violet-50/70 border-l-2 border-violet-400 px-3 py-2">
      <RiVolumeUpLine className="w-3.5 h-3.5 text-violet-500 mt-0.5 shrink-0" />
      <p className="text-xs text-violet-900 italic leading-relaxed">
        <span className="not-italic font-semibold text-[10px] uppercase tracking-wider text-violet-500 mr-1.5">
          Read aloud
        </span>
        {text}
      </p>
    </div>
  );
}

function YesNoToggle({
  value,
  onChange,
  yesLabel = "Yes",
  noLabel = "No",
}: {
  value: string | undefined;
  onChange: (v: "yes" | "no") => void;
  yesLabel?: string;
  noLabel?: string;
}) {
  return (
    <div className="flex gap-1.5">
      <button
        type="button"
        onClick={() => onChange("yes")}
        className={cn(
          "px-3 py-1 rounded-md text-xs font-medium border transition-colors",
          value === "yes"
            ? "bg-emerald-600 text-white border-emerald-600"
            : "bg-white text-slate-600 border-slate-200 hover:border-emerald-300",
        )}
      >
        {yesLabel}
      </button>
      <button
        type="button"
        onClick={() => onChange("no")}
        className={cn(
          "px-3 py-1 rounded-md text-xs font-medium border transition-colors",
          value === "no"
            ? "bg-rose-600 text-white border-rose-600"
            : "bg-white text-slate-600 border-slate-200 hover:border-rose-300",
        )}
      >
        {noLabel}
      </button>
    </div>
  );
}

function GateToggle({
  value,
  fixable,
  onChange,
}: {
  value: string | undefined;
  fixable?: boolean;
  onChange: (v: "pass" | "fail" | "pending") => void;
}) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      <button
        type="button"
        onClick={() => onChange("pass")}
        className={cn(
          "px-3 py-1 rounded-md text-xs font-medium border transition-colors",
          value === "pass"
            ? "bg-emerald-600 text-white border-emerald-600"
            : "bg-white text-slate-600 border-slate-200 hover:border-emerald-300",
        )}
      >
        Pass
      </button>
      <button
        type="button"
        onClick={() => onChange("fail")}
        className={cn(
          "px-3 py-1 rounded-md text-xs font-medium border transition-colors",
          value === "fail"
            ? "bg-rose-600 text-white border-rose-600"
            : "bg-white text-slate-600 border-slate-200 hover:border-rose-300",
        )}
      >
        Fail
      </button>
      {fixable && (
        <button
          type="button"
          onClick={() => onChange("pending")}
          title="Fixable — routes to Hold with a follow-up date instead of a decline"
          className={cn(
            "px-3 py-1 rounded-md text-xs font-medium border transition-colors",
            value === "pending"
              ? "bg-amber-500 text-white border-amber-500"
              : "bg-white text-slate-600 border-slate-200 hover:border-amber-300",
          )}
        >
          Pending (fixable)
        </button>
      )}
    </div>
  );
}

function RatingInput({ value, onChange }: { value: number | undefined; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" onClick={() => onChange(n)} className="p-0.5">
          {value != null && n <= value ? (
            <RiStarFill className="w-4 h-4 text-violet-500" />
          ) : (
            <RiStarLine className="w-4 h-4 text-slate-300 hover:text-violet-300" />
          )}
        </button>
      ))}
    </div>
  );
}

function MultiToggle({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {options.map((opt) => {
        const on = value.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(on ? value.filter((v) => v !== opt) : [...value, opt])}
            className={cn(
              "px-2.5 py-1 rounded-md text-xs font-medium border transition-colors",
              on
                ? "bg-violet-600 text-white border-violet-600"
                : "bg-white text-slate-600 border-slate-200 hover:border-violet-300",
            )}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

function GuidanceBlock({ text }: { text: string }) {
  return (
    <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1.5 leading-relaxed">
      <span className="font-semibold text-slate-600 uppercase tracking-wider text-[10px] mr-1.5">
        Screener guide
      </span>
      {text}
    </p>
  );
}

function QuestionField({
  question,
  value,
  onChange,
  fillScript,
}: {
  question: ScreeningQuestion;
  value: unknown;
  onChange: (v: unknown) => void;
  fillScript: (s: string) => string;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium text-slate-800">
        {question.label}
        {question.optional && (
          <span className="ml-1.5 text-[10px] font-normal text-slate-400 uppercase tracking-wider">optional</span>
        )}
      </p>
      {question.script && <ScriptBlock text={fillScript(question.script)} />}
      {question.guidance && <GuidanceBlock text={question.guidance} />}
      {question.kind === "gate" && (
        <GateToggle value={value as string | undefined} fixable={question.fixable} onChange={onChange} />
      )}
      {question.kind === "yesno" && (
        <YesNoToggle
          value={value as string | undefined}
          onChange={onChange}
          yesLabel={question.key.endsWith("_ack") ? "Confirmed — understand & accept" : "Yes"}
          noLabel={question.key.endsWith("_ack") ? "Not confirmed" : "No"}
        />
      )}
      {question.kind === "multi" && (
        <MultiToggle
          options={question.options || []}
          value={Array.isArray(value) ? (value as string[]) : []}
          onChange={onChange}
        />
      )}
      {question.kind === "select" && (
        <div className="flex gap-1.5 flex-wrap">
          {(question.options || []).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => onChange(value === opt ? undefined : opt)}
              className={cn(
                "px-2.5 py-1 rounded-md text-xs font-medium border transition-colors",
                value === opt
                  ? "bg-violet-600 text-white border-violet-600"
                  : "bg-white text-slate-600 border-slate-200 hover:border-violet-300",
              )}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
      {question.kind === "rating" && (
        <RatingInput value={typeof value === "number" ? value : undefined} onChange={onChange} />
      )}
      {question.kind === "text" && (
        <Input
          value={String(value || "")}
          onChange={(e) => onChange(e.target.value)}
          placeholder={question.placeholder}
          className="h-9 text-sm"
        />
      )}
      {question.kind === "longtext" && (
        <Textarea
          value={String(value || "")}
          onChange={(e) => onChange(e.target.value)}
          placeholder={question.placeholder || "Capture their answer…"}
          rows={2}
          className="text-sm"
        />
      )}
    </div>
  );
}

function ScenarioFields({
  values,
  onChange,
  fillScript,
}: {
  values: Record<string, unknown>;
  onChange: (key: string, v: unknown) => void;
  fillScript: (s: string) => string;
}) {
  const scenarios = SCREENING_SECTIONS.find((s) => s.id === "scenarios")?.questions || [];
  const answerQs = scenarios.filter((q) => q.kind === "longtext");
  return (
    <div className="space-y-4">
      {answerQs.map((q) => {
        const ratingKey = q.key.replace(/_answer$/, "_rating");
        return (
          <div key={q.key} className="space-y-1.5 border-l-2 border-slate-100 pl-3">
            {q.script && <ScriptBlock text={fillScript(q.script)} />}
            {q.guidance && <GuidanceBlock text={q.guidance} />}
            <Textarea
              value={String(values[q.key] || "")}
              onChange={(e) => onChange(q.key, e.target.value)}
              placeholder="Their answer…"
              rows={2}
              className="text-sm"
            />
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">Screener rating</span>
              <RatingInput
                value={typeof values[ratingKey] === "number" ? (values[ratingKey] as number) : undefined}
                onChange={(v) => onChange(ratingKey, v)}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SubmitResultPanel({
  result,
  name,
  launching,
  onLaunch,
  onRetryPdf,
  onClose,
}: {
  result: SubmitResult;
  name: string;
  launching: boolean;
  onLaunch: () => void;
  onRetryPdf: () => void;
  onClose: () => void;
}) {
  return (
    <div className="mt-8 space-y-4 max-w-md mx-auto text-center">
      <RiCheckboxCircleFill className="w-10 h-10 text-emerald-500 mx-auto" />
      <h3 className="text-lg font-bold text-slate-900">Screening submitted</h3>
      <p className="text-sm text-slate-600">
        The screening for {name} is now a permanent record —{" "}
        {result.recommendation === "advance"
          ? "recommended to advance."
          : result.recommendation === "hold"
            ? "placed on Hold with a dated follow-up reminder."
            : "declined with a standardized reason, retained in history."}
      </p>

      <div
        className={cn(
          "flex items-center justify-center gap-2 text-sm rounded-lg border p-3",
          result.pdf === "generated"
            ? "bg-emerald-50 border-emerald-200 text-emerald-800"
            : "bg-amber-50 border-amber-200 text-amber-800",
        )}
      >
        <RiFileTextLine className="w-4 h-4 shrink-0" />
        {result.pdf === "generated" ? (
          "Screening-record PDF generated and attached to the applicant."
        ) : (
          <span>
            The screening is saved, but PDF generation failed and is flagged for retry.
            <Button size="sm" variant="outline" className="ml-2 h-7" onClick={onRetryPdf}>
              Retry now
            </Button>
          </span>
        )}
      </div>

      {result.offerLaunchOnboarding && (
        <Button className="w-full bg-violet-600 hover:bg-violet-700 text-white" disabled={launching} onClick={onLaunch}>
          {launching ? (
            <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" />
          ) : (
            <RiSendPlaneLine className="w-4 h-4 mr-1.5" />
          )}
          Launch onboarding now
        </Button>
      )}
      <Button variant="outline" className="w-full" onClick={onClose}>
        Back to the applicant
      </Button>
    </div>
  );
}
