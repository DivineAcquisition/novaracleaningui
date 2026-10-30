"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { RiCheckboxCircleLine } from "@remixicon/react";
import { HiringMotionStyle } from "@/components/hiring/HiringChrome";
import { BlurFade } from "@/components/magicui/blur-fade";
import { MagicCard } from "@/components/magicui/magic-card";
import { ShimmerButton } from "@/components/magicui/shimmer-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface Step {
  id: string;
  name: string;
  detail: string;
  minutes: number;
  waitsOnNovara: boolean;
}

interface PageModel {
  expired: boolean;
  countsAsRejection: boolean;
  deadline: string;
  answer: "yes" | "not_yet" | null;
  title: string;
  intro: string;
  question: string;
  notYet: string;
  safety: string[];
  steps: Step[];
  ready: string[];
  contactEmail: string;
  contactPhone: string;
  privacyUrl: string;
}

const LOGO = "/novara-logo.png";

function BeforeYouStart() {
  const params = useSearchParams();
  const invite = params.get("invite") || "";
  const [page, setPage] = useState<PageModel | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!invite) {
      setError("This link is not valid.");
      return;
    }
    void fetch(`/api/hiring/before-you-start?invite=${encodeURIComponent(invite)}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) setError(data.error || "This link is not valid.");
        else setPage(data as PageModel);
      })
      .catch(() => setError("This page is unavailable right now."));
  }, [invite]);

  async function choose(answer: "yes" | "not_yet") {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/hiring/before-you-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invite, answer }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not save that answer.");
        if (data.expired) setPage((current) => current ? { ...current, expired: true } : current);
        return;
      }
      if (data.nextUrl) {
        window.location.assign(data.nextUrl);
        return;
      }
      setNote(data.message || "");
      setPage((current) => current ? { ...current, answer } : current);
    } finally {
      setBusy(false);
    }
  }

  async function requestLink() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/hiring/before-you-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invite, request: "new_link" }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || "Could not send that request.");
      else setNote(data.message || "A person at Novara will send a new link.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="min-h-dvh text-slate-900"
      style={{
        background:
          "radial-gradient(80% 46% at 50% -12%, rgba(143,123,253,0.22), transparent 58%), linear-gradient(180deg, #FFFFFF 0%, #F7F5FC 100%)",
      }}
    >
      <HiringMotionStyle />
      <header className="mx-auto flex w-full max-w-lg items-center justify-between px-5 py-4">
        <Link href="/hiring" className="flex items-center gap-2.5 transition hover:opacity-80">
          <img src={LOGO} alt="" className="h-8 w-8 rounded-lg" />
          <span className="font-heading text-[15px] font-bold tracking-tight">
            Novara<span className="text-primary">Cleaning</span>
          </span>
        </Link>
        <Badge variant="secondary">Field Cleaner</Badge>
      </header>

      {!page && !error && (
        <main className="mx-auto max-w-lg space-y-4 px-5 py-8" aria-busy="true">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
        </main>
      )}

      {error && !page && (
        <main className="mx-auto max-w-lg px-5 py-10">
          <MagicCard className="rounded-2xl border border-violet-200 bg-white p-6">
            <h1 className="font-heading text-2xl font-semibold">Link unavailable</h1>
            <p className="mt-3 text-base leading-relaxed text-slate-700">{error}</p>
          </MagicCard>
        </main>
      )}

      {page && (
        <main className="mx-auto max-w-lg px-5 pb-16">
          <BlurFade>
            <h1 className="font-heading text-2xl font-semibold leading-snug sm:text-3xl">{page.title}</h1>
            <p className="mt-3 text-base leading-relaxed text-slate-700">{page.intro}</p>
            <p className="mt-3 text-base font-semibold leading-relaxed text-slate-900">
              Get fully onboarded in less than 10 minutes. You can stop and come back.
            </p>
          </BlurFade>

          <section className="mt-8" aria-labelledby="steps-heading">
            <h2 id="steps-heading" className="font-heading text-lg font-semibold">The steps</h2>
            <ol className="mt-4 space-y-3">
              {page.steps.map((step, index) => (
                <li key={step.id}>
                  <MagicCard className="rounded-2xl border border-violet-200/80 bg-white p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{index + 1}</Badge>
                      <p className="text-base font-semibold">{step.name}</p>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-slate-700">{step.detail}</p>
                    {step.waitsOnNovara && (
                      <div className="mt-3">
                        <Badge variant="outline">Waits on a person at Novara</Badge>
                      </div>
                    )}
                  </MagicCard>
                </li>
              ))}
            </ol>
          </section>

          <section className="mt-8" aria-labelledby="ready-heading">
            <h2 id="ready-heading" className="font-heading text-lg font-semibold">Have these ready</h2>
            <MagicCard className="mt-3 rounded-2xl border border-violet-200/80 bg-white p-4">
              <ul className="space-y-3">
                {page.ready.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-base leading-relaxed text-slate-800">
                    <RiCheckboxCircleLine className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </MagicCard>
          </section>

          <section className="mt-8" aria-labelledby="safety-heading">
            <h2 id="safety-heading" className="font-heading text-lg font-semibold">Safety and privacy</h2>
            <MagicCard className="mt-3 space-y-3 rounded-2xl border border-violet-200/80 bg-white p-4 text-base leading-relaxed text-slate-700">
              {page.safety.map((line) => <p key={line}>{line}</p>)}
              <p>
                <a className="font-semibold text-primary underline underline-offset-4" href={page.privacyUrl}>Privacy Notice</a>
                {" · "}
                <a className="font-semibold text-primary underline underline-offset-4" href={`mailto:${page.contactEmail}`}>{page.contactEmail}</a>
                {" · "}
                <a className="font-semibold text-primary underline underline-offset-4" href={`tel:${page.contactPhone.replace(/[^\d+]/g, "")}`}>{page.contactPhone}</a>
              </p>
            </MagicCard>
          </section>

          <section className="mt-8" aria-labelledby="ready-now">
            <h2 id="ready-now" className="font-heading text-lg font-semibold">{page.question}</h2>
            {page.answer && (
              <p className="mt-2 text-sm text-slate-600">
                Your last answer: {page.answer === "yes" ? "Yes, start onboarding" : "Not yet, remind me"}. You can change it.
              </p>
            )}
            {note && (
              <Alert className="mt-3">
                <AlertDescription>{note}</AlertDescription>
              </Alert>
            )}
            {error && (
              <Alert variant="destructive" className="mt-3">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {page.expired ? (
              <Button
                type="button"
                size="lg"
                disabled={busy}
                onClick={() => void requestLink()}
                className="mt-4 min-h-12 w-full text-base"
              >
                Request a new link
              </Button>
            ) : (
              <div className="mt-4 grid gap-3">
                <ShimmerButton
                  type="button"
                  disabled={busy}
                  background="#5C0FFE"
                  borderRadius="0.75rem"
                  onClick={() => void choose("yes")}
                  className="h-12 w-full text-base font-semibold disabled:opacity-60"
                >
                  Yes, start onboarding
                </ShimmerButton>
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  disabled={busy}
                  onClick={() => void choose("not_yet")}
                  className="min-h-12 w-full text-base"
                >
                  Not yet, remind me
                </Button>
              </div>
            )}
          </section>
        </main>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<main className="mx-auto min-h-dvh max-w-lg px-5 py-10 text-slate-600">Opening your next step…</main>}>
      <BeforeYouStart />
    </Suspense>
  );
}
