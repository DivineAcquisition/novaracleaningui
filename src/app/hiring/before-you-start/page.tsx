"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  BeforeYouStartFrame,
  BeforeYouStartHeader,
  BeforeYouStartHero,
  OnboardingStepRail,
  PrivacyNotes,
  ReadyToStartList,
  StartDecision,
} from "@/components/hiring/BeforeYouStartPanels";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface Step {
  id: string;
  name: string;
  detail: string;
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
    <BeforeYouStartFrame>
      <BeforeYouStartHeader />

      {!page && !error && (
        <main className="container mx-auto max-w-xl space-y-4 px-4 py-8" aria-busy="true">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-28 w-full rounded-2xl" />
        </main>
      )}

      {error && !page && (
        <main className="container mx-auto max-w-xl px-4 py-10">
          <Card>
            <CardContent className="p-6">
              <h1 className="font-jakarta text-2xl font-extrabold tracking-tight">Link unavailable</h1>
              <p className="mt-3 text-base leading-relaxed text-muted-foreground">{error}</p>
            </CardContent>
          </Card>
        </main>
      )}

      {page && (
        <main className="container mx-auto max-w-xl px-4 pb-16 pt-8">
          <BeforeYouStartHero title={page.title} intro={page.intro} />
          <OnboardingStepRail steps={page.steps} />
          <ReadyToStartList items={page.ready} />
          <PrivacyNotes
            lines={page.safety}
            privacyUrl={page.privacyUrl}
            contactEmail={page.contactEmail}
            contactPhone={page.contactPhone}
          />
          <StartDecision
            question={page.question}
            answer={page.answer}
            note={note}
            error={error}
            expired={page.expired}
            busy={busy}
            onYes={() => void choose("yes")}
            onLater={() => void choose("not_yet")}
            onRequestLink={() => void requestLink()}
          />
        </main>
      )}
    </BeforeYouStartFrame>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<main className="mx-auto min-h-dvh max-w-lg px-5 py-10 text-slate-600">Opening your next step…</main>}>
      <BeforeYouStart />
    </Suspense>
  );
}
