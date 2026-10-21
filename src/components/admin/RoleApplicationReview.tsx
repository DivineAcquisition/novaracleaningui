"use client";

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  answerPrompt,
  type RoleDecisionKind,
  type SavedRoleSection,
} from "@/lib/contractor-roles";

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  return { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token || ""}` };
}

export function RoleApplicationReview({
  applicantId,
  cleanerId,
  firstName,
  sections,
  onSaved,
}: {
  applicantId?: string | null;
  cleanerId?: string | null;
  firstName?: string | null;
  sections: SavedRoleSection[];
  onSaved?: (sections: SavedRoleSection[]) => void;
}) {
  const [rows, setRows] = useState(sections);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  if (!rows.length) return null;

  async function decide(roleId: SavedRoleSection["roleId"], decision: RoleDecisionKind) {
    setError("");
    setMessage("");
    const res = await fetch("/api/admin/contractor-intake", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({
        action: "role_decision",
        applicantId,
        cleanerId,
        firstName,
        roleId,
        decision,
        note: notes[roleId] || "",
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || "Could not record the decision.");
      return;
    }
    const next = (json.sections || rows) as SavedRoleSection[];
    setRows(next);
    setMessage(json.message || "Decision recorded.");
    onSaved?.(next);
  }

  return (
    <div className="space-y-4">
      {rows.map((section) => (
        <article key={section.roleId} className="rounded-xl border border-slate-200 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-slate-900">{section.name}</h3>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">{section.tag}</span>
          </div>
          <p className="mt-2 text-sm text-slate-700">{section.shortDescription}</p>
          <p className="mt-1 text-xs text-slate-500">
            Description version {section.descriptionVersion}, confirmed {section.descriptionConfirmedAt ? new Date(section.descriptionConfirmedAt).toLocaleString() : "—"}.
          </p>
          <div className="mt-3 space-y-3">
            {section.answers.map((answer) => (
              <div key={answer.questionId} className="grid gap-3 rounded-lg bg-slate-50 p-3 md:grid-cols-2">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{answerPrompt(answer)}</p>
                  <p className="mt-1 text-xs text-slate-500">Question version {answer.version}</p>
                  <p className="mt-2 text-sm text-slate-800">
                    {answer.choices.length ? answer.choices.join(", ") : ""}
                    {answer.choices.length && answer.text ? " — " : ""}
                    {answer.text || (answer.choices.length ? "" : "No answer")}
                  </p>
                </div>
                <p className="text-sm text-slate-600">
                  <span className="font-semibold text-slate-800">Reviewer guide. </span>
                  {answer.reviewerGuide}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-2">
            {section.decision ? (
              <p className="text-sm text-slate-800">
                {decisionLabel(section.decision.decision)} by {section.decision.reviewer} at {new Date(section.decision.at).toLocaleString()}.
                {section.decision.note ? ` Note: ${section.decision.note}` : ""}
                {section.nextStep ? ` Next step: ${nextStepLabel(section.nextStep.kind)}.` : ""}
              </p>
            ) : (
              <>
                <label className="block text-sm font-semibold text-slate-800">
                  Note
                  <textarea
                    value={notes[section.roleId] || ""}
                    rows={3}
                    onChange={(event) => setNotes((current) => ({ ...current, [section.roleId]: event.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="rounded-full bg-slate-900 px-3 py-2 text-sm font-semibold text-white" onClick={() => void decide(section.roleId, "approve")}>
                    Approve for this role
                  </button>
                  <button type="button" className="rounded-full border border-slate-300 px-3 py-2 text-sm font-semibold" onClick={() => void decide(section.roleId, "approve_later")}>
                    Approve later
                  </button>
                  <button type="button" className="rounded-full border border-slate-300 px-3 py-2 text-sm font-semibold" onClick={() => void decide(section.roleId, "decline")}>
                    Decline for this role
                  </button>
                </div>
              </>
            )}
          </div>
        </article>
      ))}
      {error && <p className="text-sm text-red-700">{error}</p>}
      {message && <p className="text-sm text-slate-700">{message}</p>}
    </div>
  );
}

function decisionLabel(decision: RoleDecisionKind): string {
  if (decision === "approve") return "Approved for this role";
  if (decision === "approve_later") return "Approve later";
  return "Declined for this role";
}

function nextStepLabel(kind: string): string {
  if (kind === "addendum") return "addendum";
  if (kind === "trial_job") return "trial job";
  if (kind === "turnover_jobs") return "turnover jobs";
  if (kind === "field_onboarding") return "Field Cleaner onboarding";
  return kind;
}
