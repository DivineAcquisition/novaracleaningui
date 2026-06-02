"use client";

import { useEffect, useState } from "react";
import { RiCheckLine, RiLoader4Line, RiVideoLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

const QUESTION_FIELDS = [
  { key: "answerWhat", label: "Question 1 — Why Novara / what stood out?" },
  { key: "answerResults", label: "Question 2 — Results after your clean" },
  { key: "answerRecommend", label: "Question 3 — Would you recommend us?" },
] as const;

type FormState = Record<(typeof QUESTION_FIELDS)[number]["key"], string>;

interface FormMeta {
  ok: boolean;
  status?: string;
  firstName?: string | null;
  promoCode?: string | null;
  questions?: string[];
  bookingNumber?: number | null;
  reason?: string;
}

export default function TestimonialSubmitPage({ token }: { token: string }) {
  const [meta, setMeta] = useState<FormMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [answers, setAnswers] = useState<FormState>({
    answerWhat: "",
    answerResults: "",
    answerRecommend: "",
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error: fnErr } = await supabase.functions.invoke("get-testimonial-form", {
          body: { token },
        });
        if (fnErr) throw fnErr;
        if (!cancelled) setMeta(data as FormMeta);
      } catch (e) {
        if (!cancelled) setMeta({ ok: false, reason: "load_failed" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!videoFile) {
      setError("Please attach a short video (under 2 minutes is perfect).");
      return;
    }
    for (const q of QUESTION_FIELDS) {
      if (!answers[q.key].trim()) {
        setError("Please answer all three questions before submitting.");
        return;
      }
    }

    setSubmitting(true);
    try {
      const form = new FormData();
      form.append("token", token);
      form.append("answerWhat", answers.answerWhat.trim());
      form.append("answerResults", answers.answerResults.trim());
      form.append("answerRecommend", answers.answerRecommend.trim());
      form.append("video", videoFile);

      const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/submit-testimonial`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
        },
        body: form,
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.message || data.reason || "Submission failed");
      }
      setMeta((m) => ({
        ...m,
        ok: true,
        status: "submitted",
        promoCode: data.promoCode,
      }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <RiLoader4Line className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!meta?.ok) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center text-muted-foreground">
            This testimonial link is invalid or has expired. Contact hello@novaracleaning.com if you need help.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (meta.status === "submitted" || meta.promoCode) {
    return (
      <div className="min-h-screen bg-gradient-hero flex items-center justify-center p-6">
        <Card className="max-w-lg w-full border-primary/30">
          <CardHeader className="text-center">
            <RiCheckLine className="w-12 h-12 text-green-600 mx-auto mb-2" />
            <CardTitle>Thank you!</CardTitle>
            <CardDescription>
              Your testimonial was received. Use this code for <strong>50% off your next cleaning</strong>:
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <p className="text-2xl font-bold tracking-widest text-primary">{meta.promoCode}</p>
            <Button asChild className="w-full">
              <a href="https://try.novaracleaning.com/book/zip">Book your next clean</a>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const questions = meta.questions || [];

  return (
    <div className="min-h-screen bg-gradient-hero py-10 px-4">
      <div className="max-w-xl mx-auto space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold font-jakarta">
            Hi {meta.firstName || "there"} — share your experience
          </h1>
          <p className="text-muted-foreground">
            Record a short video answering the three questions below. We&apos;ll email you a personal code for{" "}
            <strong>50% off your next cleaning</strong>.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <RiVideoLine className="w-5 h-5 text-primary" />
              Your video testimonial
            </CardTitle>
            <CardDescription>
              {meta.bookingNumber ? `Booking #${meta.bookingNumber} · ` : ""}
              Answer all three in your video, then upload the file.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">
              <ol className="list-decimal list-inside space-y-2 text-sm bg-muted/40 rounded-lg p-4">
                {questions.map((q, i) => (
                  <li key={i} className="leading-relaxed">
                    {q}
                  </li>
                ))}
              </ol>

              {QUESTION_FIELDS.map((field, i) => (
                <div key={field.key} className="space-y-2">
                  <Label htmlFor={field.key}>{field.label}</Label>
                  <Textarea
                    id={field.key}
                    value={answers[field.key]}
                    onChange={(e) =>
                      setAnswers((a) => ({ ...a, [field.key]: e.target.value }))
                    }
                    placeholder={questions[i] || "Your answer…"}
                    rows={3}
                    required
                  />
                </div>
              ))}

              <div className="space-y-2">
                <Label htmlFor="video">Video file</Label>
                <input
                  id="video"
                  type="file"
                  accept="video/*"
                  className="block w-full text-sm"
                  onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
                />
                <p className="text-xs text-muted-foreground">MP4 or MOV, ideally under 100MB.</p>
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <Button type="submit" className="w-full" size="lg" disabled={submitting}>
                {submitting ? (
                  <>
                    <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" />
                    Uploading…
                  </>
                ) : (
                  "Submit testimonial"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
