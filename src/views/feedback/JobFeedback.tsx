"use client";

// Tokenized post-job feedback page (/feedback/[token]).
//
// Three questions, the first one gates:
//   overall >= threshold → thank you → optional tip → Google review nudge
//   below threshold      → private QC report into the existing QC hub
//
// All three answers are saved BEFORE routing, so the data is captured even
// if the customer abandons the review/tip/report step. The token resolves
// the job, crew, and customer — no manual entry.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  RiCheckLine,
  RiErrorWarningLine,
  RiGoogleFill,
  RiHeart3Fill,
  RiLoader4Line,
  RiShieldCheckLine,
  RiStarFill,
  RiTimeLine,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

// ─── Types ───────────────────────────────────────────────────────────────

interface CrewMember {
  id: string;
  name: string;
}

interface FeedbackMeta {
  status: string;
  path: "positive" | "qc" | null;
  overallRating: number | null;
  cleanerRating: number | null;
  qualityRating: number | null;
  hasQcIssue: boolean;
}

interface GetResponse {
  ok: boolean;
  error?: string;
  feedback?: FeedbackMeta;
  booking?: {
    id: string;
    bookingNumber: number | null;
    firstName: string | null;
    serviceDate: string | null;
    serviceType: string | null;
    city: string | null;
    state: string | null;
  };
  crew?: CrewMember[];
  positiveMinRating?: number;
  googleReviewUrl?: string;
}

type Step =
  | "loading"
  | "invalid"
  | "expired"
  | "questions"
  | "positive" // tip offer + Google nudge
  | "google" // tip done/skipped → Google CTA
  | "qc" // QC report form
  | "qc_done";

const QUESTIONS = [
  {
    key: "overall" as const,
    title: "How was your overall experience?",
    hint: "1 = terrible · 5 = excellent",
  },
  {
    key: "cleaner" as const,
    title: "How would you rate your cleaner's work and professionalism?",
    hint: "This feeds your cleaner's rating directly",
  },
  {
    key: "quality" as const,
    title: "Was your home cleaned to your expectations?",
    hint: "1 = not at all · 5 = spotless",
  },
];

const ISSUE_TYPE_OPTIONS = [
  { value: "quality_flag", label: "Areas were missed / not clean enough" },
  { value: "reclean", label: "I'd like a re-clean" },
  { value: "damage", label: "Something was damaged" },
  { value: "late", label: "The crew was late" },
  { value: "complaint", label: "Something else went wrong" },
];

const TIP_PRESETS = [1000, 2000, 3000];

// ─── Star input ──────────────────────────────────────────────────────────

function StarRow({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={disabled}
          onClick={() => onChange(n)}
          aria-label={`${n} star${n === 1 ? "" : "s"}`}
          className="p-1 rounded-lg transition-transform hover:scale-110 disabled:opacity-50"
        >
          <RiStarFill
            className={`w-8 h-8 ${n <= value ? "text-amber-400" : "text-slate-200"}`}
          />
        </button>
      ))}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────

export default function JobFeedbackPage({ token }: { token: string }) {
  const searchParams = useSearchParams();
  const tipped = searchParams.get("tipped") === "1";
  const tipSessionId = searchParams.get("session_id") || "";

  const [step, setStep] = useState<Step>("loading");
  const [meta, setMeta] = useState<GetResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Q answers
  const [overall, setOverall] = useState(0);
  const [cleaner, setCleaner] = useState(0);
  const [quality, setQuality] = useState(0);

  // Tip state
  const [tipAmount, setTipAmount] = useState<number | null>(null);
  const [customTip, setCustomTip] = useState("");
  const [directedCleanerId, setDirectedCleanerId] = useState<string>("");
  const [tipConfirmed, setTipConfirmed] = useState(false);

  // QC state
  const [issueType, setIssueType] = useState("quality_flag");
  const [description, setDescription] = useState("");

  const crew = meta?.crew || [];
  const googleUrl = meta?.googleReviewUrl || "https://g.page/r/Cc8fVvoYgXkaEAI/review";
  const firstName = meta?.booking?.firstName?.trim() || "";

  const invokeFeedback = useCallback(
    async (body: Record<string, unknown>) => {
      const { data, error: fnErr } = await supabase.functions.invoke("job-feedback", {
        body: { token, ...body },
      });
      if (fnErr) {
        // Non-2xx responses carry the useful message in the response body.
        const ctx = (fnErr as { context?: Response }).context;
        if (ctx && typeof ctx.json === "function") {
          try {
            const parsed = await ctx.json();
            if (parsed?.error) return parsed as Record<string, unknown>;
          } catch {
            /* fall through */
          }
        }
        throw fnErr;
      }
      return data as Record<string, unknown>;
    },
    [token],
  );

  // Initial load — resolve the token, resume where the customer left off.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = (await invokeFeedback({ action: "get" })) as unknown as GetResponse;
        if (cancelled) return;
        if (!data?.ok) {
          setStep(data?.error === "expired" ? "expired" : "invalid");
          return;
        }
        setMeta(data);
        const fb = data.feedback!;
        if (fb.status === "pending") {
          setStep("questions");
        } else if (fb.path === "qc") {
          setStep(fb.hasQcIssue ? "qc_done" : "qc");
        } else if (fb.path === "positive") {
          // Returning from Stripe? Confirm the tip first, then Google CTA.
          setStep(tipped && tipSessionId ? "google" : fb.status === "positive_complete" ? "google" : "positive");
        } else {
          setStep("questions");
        }
      } catch {
        if (!cancelled) setStep("invalid");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Confirm the tip when Stripe bounces the customer back here.
  useEffect(() => {
    if (!tipped || !tipSessionId) return;
    void (async () => {
      try {
        const { data } = await supabase.functions.invoke("tip-cleaner", {
          body: { action: "confirm", sessionId: tipSessionId },
        });
        if ((data as { ok?: boolean })?.ok) setTipConfirmed(true);
      } catch {
        // The team reconciles every tip — don't block the Google step.
      }
    })();
  }, [tipped, tipSessionId]);

  const submitAnswers = async () => {
    setError(null);
    if (!overall || !cleaner || !quality) {
      setError("Please answer all three questions.");
      return;
    }
    setBusy(true);
    try {
      const data = await invokeFeedback({
        action: "submit_answers",
        overallRating: overall,
        cleanerRating: cleaner,
        qualityRating: quality,
      });
      if (!data?.ok) throw new Error(String(data?.error || "Could not save your answers"));
      setStep((data.path as string) === "positive" ? "positive" : "qc");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong — please try again.");
    } finally {
      setBusy(false);
    }
  };

  const effectiveTipCents = useMemo(() => {
    if (tipAmount) return tipAmount;
    const custom = Math.round(parseFloat(customTip) * 100);
    return Number.isFinite(custom) && custom > 0 ? custom : 0;
  }, [tipAmount, customTip]);

  const startTip = async () => {
    setError(null);
    if (effectiveTipCents < 100) {
      setError("Tips start at $1.");
      return;
    }
    setBusy(true);
    try {
      const data = await invokeFeedback({
        action: "tip_checkout",
        amountCents: effectiveTipCents,
        ...(directedCleanerId ? { directedCleanerId } : {}),
      });
      if (!data?.ok || !data?.url) throw new Error(String(data?.error || "Could not start the tip checkout"));
      window.location.href = String(data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the tip checkout.");
      setBusy(false);
    }
  };

  const skipTip = () => {
    setError(null);
    setStep("google");
  };

  const goToGoogle = async () => {
    setBusy(true);
    try {
      await invokeFeedback({ action: "mark_google" });
    } catch {
      /* best effort — never block the redirect */
    }
    window.location.href = googleUrl;
  };

  const submitQc = async () => {
    setError(null);
    if (description.trim().length < 8) {
      setError("Please tell us what went wrong — a short note is fine.");
      return;
    }
    setBusy(true);
    try {
      const data = await invokeFeedback({
        action: "submit_qc",
        issueType,
        description: description.trim(),
      });
      if (!data?.ok) throw new Error(String(data?.error || "Could not file your report"));
      setStep("qc_done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong — please try again.");
    } finally {
      setBusy(false);
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────

  if (step === "loading") {
    return (
      <Shell>
        <div className="text-center py-16">
          <RiLoader4Line className="w-8 h-8 animate-spin text-violet-500 mx-auto" />
        </div>
      </Shell>
    );
  }

  if (step === "invalid" || step === "expired") {
    return (
      <Shell>
        <Card className="text-center">
          <CardContent className="pt-8 pb-8 space-y-3">
            {step === "expired" ? (
              <RiTimeLine className="w-10 h-10 text-amber-500 mx-auto" />
            ) : (
              <RiErrorWarningLine className="w-10 h-10 text-amber-500 mx-auto" />
            )}
            <h1 className="text-xl font-bold text-slate-900">
              {step === "expired" ? "This link has expired" : "Link not found"}
            </h1>
            <p className="text-sm text-slate-500">
              {step === "expired"
                ? "Feedback links are only valid for a short window after your clean."
                : "This feedback link is invalid."}{" "}
              Need anything? Email{" "}
              <a className="text-violet-600 underline" href="mailto:hello@novaracleaning.com">
                hello@novaracleaning.com
              </a>{" "}
              and we&apos;ll take care of you.
            </p>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  if (step === "questions") {
    const values = { overall, cleaner, quality };
    const setters = { overall: setOverall, cleaner: setCleaner, quality: setQuality };
    return (
      <Shell>
        <Header
          title={`Hi ${firstName || "there"} — how did we do?`}
          subtitle="3 quick questions, under a minute. Your answers go straight to our quality team."
        />
        <Card>
          <CardContent className="pt-6 space-y-7">
            {QUESTIONS.map((q, i) => (
              <div key={q.key} className="space-y-2">
                <p className="font-semibold text-slate-900">
                  {i + 1}. {q.title}
                </p>
                <StarRow value={values[q.key]} onChange={setters[q.key]} disabled={busy} />
                <p className="text-xs text-slate-400">{q.hint}</p>
              </div>
            ))}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button className="w-full" size="lg" onClick={submitAnswers} disabled={busy}>
              {busy ? <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" /> : null}
              Continue
            </Button>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  if (step === "positive") {
    return (
      <Shell>
        <Header
          title="Thank you! 💜"
          subtitle={
            crew.length > 1
              ? "Your crew will be thrilled. Want to leave them a tip? 100% goes to them, split across the crew."
              : `${crew[0]?.name || "Your cleaner"} will be thrilled. Want to leave a tip? 100% goes to them.`
          }
        />
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <RiHeart3Fill className="w-5 h-5 text-violet-600" />
              Tip your {crew.length > 1 ? "crew" : "cleaner"} (optional)
            </CardTitle>
            <CardDescription>
              100% pass-through — Novara takes nothing, and tips never affect pay or scoring.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-3 gap-2">
              {TIP_PRESETS.map((cents) => (
                <button
                  key={cents}
                  type="button"
                  onClick={() => {
                    setTipAmount(cents);
                    setCustomTip("");
                  }}
                  className={`rounded-xl border-2 py-3 font-bold text-lg transition-colors ${
                    tipAmount === cents
                      ? "border-violet-600 bg-violet-50 text-violet-700"
                      : "border-slate-200 text-slate-700 hover:border-violet-300"
                  }`}
                >
                  ${cents / 100}
                </button>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="custom-tip">Custom amount</Label>
              <Input
                id="custom-tip"
                type="number"
                inputMode="decimal"
                min={1}
                max={500}
                placeholder="$"
                value={customTip}
                onChange={(e) => {
                  setCustomTip(e.target.value);
                  setTipAmount(null);
                }}
              />
            </div>

            {crew.length > 1 && (
              <div className="space-y-1.5">
                <Label>Who is this for?</Label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setDirectedCleanerId("")}
                    className={`rounded-full border px-3 py-1.5 text-sm ${
                      !directedCleanerId
                        ? "border-violet-600 bg-violet-50 text-violet-700 font-semibold"
                        : "border-slate-200 text-slate-600"
                    }`}
                  >
                    Split across the crew
                  </button>
                  {crew.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setDirectedCleanerId(c.id)}
                      className={`rounded-full border px-3 py-1.5 text-sm ${
                        directedCleanerId === c.id
                          ? "border-violet-600 bg-violet-50 text-violet-700 font-semibold"
                          : "border-slate-200 text-slate-600"
                      }`}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="space-y-2">
              <Button
                className="w-full"
                size="lg"
                onClick={startTip}
                disabled={busy || effectiveTipCents < 100}
              >
                {busy ? <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" /> : null}
                {effectiveTipCents >= 100
                  ? `Tip $${(effectiveTipCents / 100).toFixed(2)}`
                  : "Tip"}
              </Button>
              <Button variant="ghost" className="w-full" onClick={skipTip} disabled={busy}>
                No thanks — continue
              </Button>
            </div>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  if (step === "google") {
    return (
      <Shell>
        <Card className="text-center">
          <CardContent className="pt-8 pb-8 space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-violet-100 flex items-center justify-center mx-auto">
              <RiCheckLine className="w-8 h-8 text-violet-600" />
            </div>
            <h1 className="text-xl font-bold text-slate-900">
              {tipConfirmed ? "Tip received — thank you!" : "You're the best!"}
            </h1>
            <p className="text-sm text-slate-600">
              {tipConfirmed
                ? "100% of it goes to your crew — they've been notified. One last favor?"
                : "One last favor?"}{" "}
              A quick Google review helps neighbors find us and means the world to our small team.
            </p>
            <Button className="w-full" size="lg" onClick={goToGoogle} disabled={busy}>
              <RiGoogleFill className="w-5 h-5 mr-2" />
              Leave a Google review
            </Button>
            <p className="text-xs text-slate-400">Takes about 30 seconds. Thank you! 💜</p>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  if (step === "qc") {
    return (
      <Shell>
        <Header
          title="We're sorry we missed the mark."
          subtitle="Tell us what went wrong and our quality team will make it right — that's our Spotless Guarantee."
        />
        <Card>
          <CardContent className="pt-6 space-y-5">
            <div className="space-y-1.5">
              <Label>What happened?</Label>
              <div className="space-y-2">
                {ISSUE_TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setIssueType(opt.value)}
                    className={`w-full text-left rounded-xl border-2 px-4 py-3 text-sm transition-colors ${
                      issueType === opt.value
                        ? "border-violet-600 bg-violet-50 text-violet-800 font-semibold"
                        : "border-slate-200 text-slate-700 hover:border-violet-300"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qc-description">Tell us more</Label>
              <Textarea
                id="qc-description"
                rows={5}
                placeholder="Which rooms or areas? What did you notice? The more detail, the faster we can fix it."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button className="w-full" size="lg" onClick={submitQc} disabled={busy}>
              {busy ? <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" /> : null}
              Send to our quality team
            </Button>
            <p className="text-xs text-slate-400 text-center">
              This goes straight to our QC team — not a public review. We&apos;ll follow up personally.
            </p>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  // qc_done
  return (
    <Shell>
      <Card className="text-center">
        <CardContent className="pt-8 pb-8 space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-emerald-100 flex items-center justify-center mx-auto">
            <RiShieldCheckLine className="w-8 h-8 text-emerald-600" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">We&apos;re on it.</h1>
          <p className="text-sm text-slate-600">
            Your report is with our quality team and covered by our{" "}
            <strong>Spotless Guarantee</strong> — if something wasn&apos;t cleaned to standard,
            we&apos;ll make it right, including a free re-clean of the missed areas. Expect to
            hear from us shortly.
          </p>
          <p className="text-xs text-slate-400">
            Questions in the meantime?{" "}
            <a className="text-violet-600 underline" href="mailto:hello@novaracleaning.com">
              hello@novaracleaning.com
            </a>
          </p>
        </CardContent>
      </Card>
    </Shell>
  );
}

// ─── Layout helpers ──────────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-50 to-background py-10 px-4">
      <div className="max-w-md mx-auto space-y-6">
        {children}
        <p className="text-center text-xs text-slate-400">Novara Cleaning · novaracleaning.com</p>
      </div>
    </div>
  );
}

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="text-center space-y-2">
      <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
      <p className="text-sm text-slate-500">{subtitle}</p>
    </div>
  );
}
