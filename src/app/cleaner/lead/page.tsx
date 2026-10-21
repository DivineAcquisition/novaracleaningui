"use client";

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LEAD_EXPERIENCE_QUESTIONS, LEAD_RUBRIC, LEAD_SCENARIOS, outsideLeadRecordLabel } from "@/lib/contractor-intake/lead-application";
import { LEAD_GUARDRAILS } from "@/lib/contractor-intake/lead";

export default function LeadCleanerPage() {
  const [note, setNote] = useState("");
  const [sent, setSent] = useState("");

  return (
    <form
      className="mx-auto max-w-2xl space-y-6 px-4 py-8 text-slate-900"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!note.trim()) {
          setSent("Add a note so the reviewer can see what you want them to know.");
          return;
        }
        const data = new FormData(event.currentTarget);
        const answers: Record<string, string> = {};
        data.forEach((value, key) => { answers[key] = String(value); });
        const { data: session } = await supabase.auth.getSession();
        const res = await fetch("/api/cleaner/intake", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.session?.access_token || ""}` },
          body: JSON.stringify({ action: "lead_application", note, answers }),
        });
        const json = await res.json();
        setSent(res.ok ? json.message : json.error || "Could not save the application.");
      }}
    >
      <h1 className="font-heading text-3xl font-semibold">Lead Cleaner</h1>
      <p className="text-base text-slate-700">A person decides every Lead Cleaner application. Nothing here is approved automatically.</p>
      <section className="rounded-2xl border border-slate-300 p-4">
        <h2 className="font-semibold">Reliability record</h2>
        <p className="mt-2 text-sm text-slate-700">Contractors who already work with Novara see their tenure, completed jobs, Novara Score, no-shows, late cancellations, complaints, and on-time arrival before they apply.</p>
        <p className="mt-2 text-sm font-semibold">{outsideLeadRecordLabel()}</p>
      </section>
      <section className="space-y-4">
        <h2 className="font-semibold">Experience</h2>
        {LEAD_EXPERIENCE_QUESTIONS.map((question) => (
          <label key={question.id} className="block text-sm font-semibold">
            {question.prompt}
            <textarea className="mt-1 w-full rounded-xl border border-slate-300 p-3 font-normal" rows={3} name={question.id} />
          </label>
        ))}
      </section>
      <section className="space-y-4">
        <h2 className="font-semibold">Scenarios</h2>
        <p className="text-sm text-slate-700">A reviewer marks each answer Meets or Does not meet. The rubric is a guide, not a score.</p>
        <ul className="list-disc pl-5 text-sm text-slate-700">
          {LEAD_RUBRIC.map((line) => <li key={line}>{line}</li>)}
        </ul>
        {LEAD_SCENARIOS.map((question) => (
          <label key={question.id} className="block text-sm font-semibold">
            {question.prompt}
            <textarea className="mt-1 w-full rounded-xl border border-slate-300 p-3 font-normal" rows={4} name={question.id} />
          </label>
        ))}
      </section>
      <section>
        <h2 className="font-semibold">Guardrails</h2>
        <ul className="mt-2 list-disc pl-5 text-sm text-slate-700">
          {LEAD_GUARDRAILS.map((line) => <li key={line}>{line}</li>)}
        </ul>
      </section>
      <label className="block text-sm font-semibold">
        Note for the reviewer
        <textarea className="mt-1 w-full rounded-xl border border-slate-300 p-3 font-normal" rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <button type="submit" className="rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white">
        Submit for review
      </button>
      {sent && <p className="text-sm text-slate-800">{sent}</p>}
    </form>
  );
}
