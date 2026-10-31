"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  BEFORE_YOU_START_INK,
  BEFORE_YOU_START_PAPER,
  BeforeYouStartHero,
  OnboardingStepRail,
  PrivacyNotes,
  ReadyToStartList,
  StartDecision,
} from "@/components/hiring/BeforeYouStartPanels";
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
    <div className="min-h-dvh" style={{ background: BEFORE_YOU_START_PAPER, color: BEFORE_YOU_START_INK }}>
      <header className="mx-auto flex w-full max-w-[34rem] items-center justify-between border-b border-[#16141C]/10 px-5 py-4">
        <Link href="/hiring" className="flex items-center gap-2.5 transition hover:opacity-80">
          <img src={LOGO} alt="" className="h-8 w-8" />
          <span className="font-heading text-[15px] font-bold tracking-tight">
            Novara<span className="text-[#5C0FFE]">Cleaning</span>
          </span>
        </Link>
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#16141C]/50">Field Cleaner</p>
      </header>

      {!page && !error && (
        <main className="mx-auto max-w-[34rem] space-y-4 px-5 py-8" aria-busy="true">
          <Skeleton className="h-8 w-full bg-[#16141C]/10" />
          <Skeleton className="h-16 w-4/5 bg-[#16141C]/10" />
          <Skeleton className="h-32 w-full bg-[#16141C]/80" />
        </main>
      )}

      {error && !page && (
        <main className="mx-auto max-w-[34rem] px-5 py-12">
          <h1 className="font-heading text-3xl font-semibold tracking-tight">Link unavailable</h1>
          <p className="mt-3 max-w-prose text-base leading-relaxed text-[#16141C]/70">{error}</p>
        </main>
      )}

      {page && (
        <main className="mx-auto max-w-[34rem] px-5 pb-16 pt-8">
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
