"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

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
  totalMinutes: number;
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

  if (error && !page) {
    return (
      <main className="mx-auto min-h-dvh max-w-lg px-5 py-10 text-slate-900">
        <h1 className="font-heading text-2xl font-semibold">Link unavailable</h1>
        <p className="mt-3 text-base leading-relaxed text-slate-700">{error}</p>
      </main>
    );
  }
  if (!page) {
    return <main className="mx-auto min-h-dvh max-w-lg px-5 py-10 text-slate-600">Opening your next step…</main>;
  }

  return (
    <main className="mx-auto min-h-dvh max-w-lg px-5 py-8 text-slate-900">
      <p className="text-sm font-semibold text-violet-800">Field Cleaner</p>
      <h1 className="mt-2 font-heading text-2xl font-semibold leading-snug">{page.title}</h1>
      <p className="mt-3 text-base leading-relaxed text-slate-700">{page.intro}</p>

      <section className="mt-8" aria-labelledby="steps-heading">
        <h2 id="steps-heading" className="text-lg font-semibold">The steps</h2>
        <p className="mt-2 text-base text-slate-700">About {page.totalMinutes} minutes. You can stop and come back. Times are estimates.</p>
        <ol className="mt-4 space-y-3">
          {page.steps.map((step, index) => (
            <li key={step.id} className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-base font-semibold">{index + 1}. {step.name}</p>
              <p className="mt-1 text-sm leading-relaxed text-slate-700">{step.detail}</p>
              <p className="mt-1 text-sm text-slate-600">
                {step.waitsOnNovara ? "Waits on a person at Novara. " : ""}
                About {step.minutes} minutes.
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-8" aria-labelledby="ready-heading">
        <h2 id="ready-heading" className="text-lg font-semibold">Have these ready</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-base leading-relaxed text-slate-700">
          {page.ready.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </section>

      <section className="mt-8 space-y-3 text-base leading-relaxed text-slate-700" aria-labelledby="safety-heading">
        <h2 id="safety-heading" className="text-lg font-semibold text-slate-900">Safety and privacy</h2>
        {page.safety.map((line) => <p key={line}>{line}</p>)}
        <p>
          <a className="font-semibold text-violet-800 underline" href={page.privacyUrl}>Privacy Notice</a>
          {" · "}
          <a className="font-semibold text-violet-800 underline" href={`mailto:${page.contactEmail}`}>{page.contactEmail}</a>
          {" · "}
          <a className="font-semibold text-violet-800 underline" href={`tel:${page.contactPhone.replace(/[^\d+]/g, "")}`}>{page.contactPhone}</a>
        </p>
      </section>

      <section className="mt-8" aria-labelledby="ready-now">
        <h2 id="ready-now" className="text-lg font-semibold">{page.question}</h2>
        {page.answer && (
          <p className="mt-2 text-sm text-slate-600">Your last answer: {page.answer === "yes" ? "Yes, start onboarding" : "Not yet, remind me"}. You can change it.</p>
        )}
        {note && <p className="mt-3 rounded-2xl bg-violet-50 p-4 text-base text-slate-800">{note}</p>}
        {error && <p className="mt-3 text-sm text-rose-700" role="alert">{error}</p>}
        {page.expired ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void requestLink()}
            className="mt-4 min-h-12 w-full rounded-2xl bg-violet-700 px-4 text-base font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-700 disabled:opacity-60"
          >
            Request a new link
          </button>
        ) : (
          <div className="mt-4 grid gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void choose("yes")}
              className="min-h-12 rounded-2xl bg-violet-700 px-4 text-base font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-700 disabled:opacity-60"
            >
              Yes, start onboarding
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void choose("not_yet")}
              className="min-h-12 rounded-2xl border border-slate-300 bg-white px-4 text-base font-semibold text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-700 disabled:opacity-60"
            >
              Not yet, remind me
            </button>
          </div>
        )}
      </section>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<main className="mx-auto min-h-dvh max-w-lg px-5 py-10 text-slate-600">Opening your next step…</main>}>
      <BeforeYouStart />
    </Suspense>
  );
}
