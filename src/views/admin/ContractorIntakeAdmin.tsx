"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PIPELINE_STAGES } from "@/lib/contractor-intake/verification";
import { WORDING_STATUS_LABEL } from "@/lib/contractor-intake/wording";
import { RoleApplicationReview } from "@/components/admin/RoleApplicationReview";
import type { SavedRoleSection } from "@/lib/contractor-roles";

async function headers(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  return { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token || ""}` };
}

export default function ContractorIntakeAdmin() {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [notice, setNotice] = useState("");

  const load = async () => {
    const res = await fetch("/api/admin/contractor-intake", { headers: await headers() });
    const json = await res.json();
    if (!res.ok) setNotice(json.error || "Could not load intake.");
    else setData(json);
  };

  useEffect(() => { void load(); }, []);

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/admin/contractor-intake", { method: "POST", headers: await headers(), body: JSON.stringify(body) });
    const json = await res.json();
    setNotice(res.ok ? "Saved." : json.error || "Could not save.");
    await load();
  };

  const counts = (data?.counts || {}) as Record<string, number>;
  const dashboard = (data?.dashboard || {}) as Record<string, number>;
  const wording = (data?.wording || []) as Array<{ id: string; title: string; status: string; body: string; version?: number; reviewedAt?: string | null }>;
  const review = (data?.needsReview || []) as Array<{ id: string; full_name?: string; email?: string; intake_decision?: { message?: string } }>;
  const assignment = (data?.assignment || {}) as { laborPercent?: number; needsAdmin?: boolean; reason?: string | null };
  const draftRoles = (data?.draftRoles || []) as Array<{ id: string; kind: string; label: string; version: number; onPublicPage: boolean }>;
  const roleReviews = (data?.roleReviews || []) as Array<{ applicantId: string | null; cleanerId: string | null; name: string; email: string | null; sections: SavedRoleSection[] }>;
  const roles = ((data?.roleCatalog as { roles?: Array<{ id: string; name: string; tag: string; publicEnabled: boolean; status: string; shortDescription: string; whatYoullDo: string[]; whatYoullNeed: string[] }> } | undefined)?.roles) || [];
  const questions = ((data?.roleCatalog as { questions?: Array<{ id: string; prompt: string; why: string; helper: string; reviewerGuide: string; status: string }> } | undefined)?.questions) || [];

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 md:p-6">
      <header>
        <h1 className="font-heading text-2xl font-semibold">Contractor intake</h1>
        <p className="mt-1 text-sm text-slate-600">Thresholds and pay rates are settings. Applicants do not see the draft label.</p>
      </header>
      {wording.some((row) => row.status !== "reviewed") && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-semibold">{wording.filter((row) => row.status !== "reviewed").length} wording versions are still {WORDING_STATUS_LABEL}.</p>
          <p className="mt-1">Hiring can continue. Review each one below and mark it Reviewed after counsel signs off.</p>
        </div>
      )}
      {notice && <p className="text-sm font-medium text-slate-800">{notice}</p>}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Pipeline</h2>
        <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PIPELINE_STAGES.map((stage) => (
            <li key={stage} className="rounded-xl border border-slate-200 px-3 py-2">
              <p className="text-xs text-slate-500">{stage.replace(/_/g, " ")}</p>
              <p className="text-lg font-semibold">{counts[stage] || 0}</p>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Compliance</h2>
        <p className="mt-2 text-sm text-slate-700">Active contractors missing a compliance record: {dashboard.activeMissingCompliance ?? "—"}</p>
        <p className="text-sm text-slate-700">Images past their deletion date: {dashboard.imagesPastDeletion ?? "—"}</p>
        <p className="text-sm text-slate-700">Application photo IDs past retention: {String((data?.applicationIdsPastDeletion as number | undefined) ?? "—")}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold" onClick={() => void post({ action: "id_cleanup_preview" })}>
            Dry run ID cleanup
          </button>
          <button type="button" className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white" onClick={() => {
            if (window.confirm("Delete the application photo IDs listed by the dry run?")) void post({ action: "id_cleanup", confirm: true });
          }}>
            Delete listed IDs
          </button>
        </div>
        <p className="text-sm text-slate-700">Consents still on draft wording: {dashboard.draftConsents ?? "—"}</p>
      </section>
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Needs review</h2>
        <ul className="mt-3 space-y-2">
          {review.length === 0 && <li className="text-sm text-slate-600">Nothing is waiting.</li>}
          {review.map((row) => (
            <li key={row.id} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
              <p className="font-semibold">{row.full_name || row.email}</p>
              <p className="text-slate-600">{row.intake_decision?.message}</p>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Lead jobs</h2>
        <p className="mt-2 text-sm text-slate-700">
          Projected labor {assignment.laborPercent ?? "—"}%. {assignment.needsAdmin ? assignment.reason : "Inside the labor cap."}
        </p>
        <PayWarnings settings={(data?.settings || {}) as Record<string, unknown>} />
        <BeforeStartMinutes
          minutes={((data?.settings as { beforeStartMinutes?: Record<string, number> } | undefined)?.beforeStartMinutes) || {}}
          onSave={(beforeStartMinutes) => void post({ action: "save_settings", settings: { ...(data?.settings as object), beforeStartMinutes } })}
        />
        <button type="button" className="mt-3 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white" onClick={() => void post({ action: "open_lead_role" })}>
          Open Lead Field Cleaner to new applicants
        </button>
      </section>
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Role wording still Draft</h2>
        <ul className="mt-3 space-y-2">
          {draftRoles.length === 0 && <li className="text-sm text-slate-600">Every live role and question is Reviewed.</li>}
          {draftRoles.map((row) => (
            <li key={`${row.kind}-${row.id}`} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
              <span className="font-semibold">{row.label}</span>
              <span className="ml-2 text-amber-900">{WORDING_STATUS_LABEL}</span>
              <span className="ml-2 text-slate-600">version {row.version}{row.onPublicPage ? " · on the hiring page" : " · hidden from the hiring page"}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 space-y-3">
          {roles.map((role) => (
            <article key={role.id} className="rounded-xl border border-slate-200 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{role.name}</p>
                <button type="button" className="font-semibold underline" onClick={() => void post({ action: "set_role_public", id: role.id, publicEnabled: !role.publicEnabled })}>
                  {role.publicEnabled ? "Hide on the hiring page" : "Show on the hiring page"}
                </button>
              </div>
              <p className="mt-1 text-slate-600">{role.status === "reviewed" ? "Reviewed" : WORDING_STATUS_LABEL}</p>
              {role.status !== "reviewed" && (
                <button type="button" className="mt-2 font-semibold underline" onClick={() => void post({ action: "mark_role_reviewed", id: role.id })}>Mark reviewed</button>
              )}
              <RoleEditor
                role={role}
                onSave={(patch) => void post({ action: "save_role_copy", kind: "role", id: role.id, patch })}
              />
            </article>
          ))}
          {questions.map((question) => (
            <article key={question.id} className="rounded-xl border border-slate-200 p-3 text-sm">
              <p className="font-semibold">{question.id}</p>
              <p className="mt-1 text-slate-700">{question.prompt}</p>
              <p className="mt-1 text-slate-600">Job-related reason: {question.why}</p>
              <p className="mt-1 text-slate-500">{question.status === "reviewed" ? "Reviewed" : WORDING_STATUS_LABEL}</p>
              {question.status !== "reviewed" && (
                <button type="button" className="mt-2 font-semibold underline" onClick={() => void post({ action: "mark_role_reviewed", id: question.id })}>Mark reviewed</button>
              )}
              <QuestionEditor
                id={question.id}
                prompt={question.prompt}
                why={question.why}
                helper={question.helper || ""}
                reviewerGuide={question.reviewerGuide || ""}
                onSave={(patch) => void post({ action: "save_role_copy", kind: "question", id: question.id, patch })}
              />
            </article>
          ))}
        </div>
      </section>
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Role applications</h2>
        <div className="mt-3 space-y-6">
          {roleReviews.length === 0 && <p className="text-sm text-slate-600">No role answers are waiting.</p>}
          {roleReviews.map((row) => (
            <div key={`${row.applicantId || ""}-${row.cleanerId || ""}`}>
              <p className="mb-2 text-sm font-semibold">{row.name || row.email}</p>
              <RoleApplicationReview applicantId={row.applicantId} cleanerId={row.cleanerId} firstName={row.name} sections={row.sections} onSaved={() => void load()} />
            </div>
          ))}
        </div>
      </section>
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Wording</h2>
        <ul className="mt-3 space-y-3">
          {wording.map((row) => (
            <WordingEditor key={row.id} row={row} onSave={(body) => void post({ action: "save_wording", id: row.id, body })} onReview={() => void post({ action: "mark_reviewed", id: row.id })} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function BeforeStartMinutes({
  minutes,
  onSave,
}: {
  minutes: Record<string, number>;
  onSave: (minutes: Record<string, number>) => void;
}) {
  const [draft, setDraft] = useState(minutes);
  const keys = Object.keys(minutes);
  if (!keys.length) return null;
  return (
    <section className="mt-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Before you start, estimated minutes</h2>
      <p className="mt-1 text-sm text-slate-600">Shown as estimates. A zero means the step waits on Novara.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {keys.map((key) => (
          <label key={key} className="flex items-center justify-between gap-3 text-sm">
            <span>{key.replaceAll("_", " ")}</span>
            <input
              className="h-10 w-20 rounded-lg border border-slate-200 px-2"
              inputMode="numeric"
              value={draft[key] ?? 0}
              onChange={(event) => setDraft({ ...draft, [key]: Number(event.target.value.replace(/[^\d]/g, "") || 0) })}
            />
          </label>
        ))}
      </div>
      <button type="button" className="mt-3 text-sm font-semibold underline" onClick={() => onSave(draft)}>Save step times</button>
    </section>
  );
}

function WordingEditor({
  row,
  onSave,
  onReview,
}: {
  row: { id: string; title: string; status: string; body: string; version?: number; reviewedAt?: string | null };
  onSave: (body: string) => void;
  onReview: () => void;
}) {
  const [body, setBody] = useState(row.body);
  return (
    <li className="rounded-xl border border-slate-200 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold">{row.title}</p>
        <span className="text-xs uppercase tracking-wide text-amber-800">{row.status === "reviewed" ? `Reviewed${row.reviewedAt ? ` ${row.reviewedAt}` : ""}` : `${WORDING_STATUS_LABEL} · v${row.version || 1}`}</span>
      </div>
      <textarea className="mt-2 w-full rounded-lg border border-slate-200 p-2 text-sm" rows={3} value={body} onChange={(event) => setBody(event.target.value)} />
      <div className="mt-2 flex gap-3">
        <button type="button" className="text-sm font-semibold underline" onClick={() => onSave(body)}>Save wording</button>
        {row.status !== "reviewed" && (
          <button type="button" className="text-sm font-semibold underline" onClick={onReview}>Mark reviewed</button>
        )}
      </div>
    </li>
  );
}

function PayWarnings({ settings }: { settings: Record<string, unknown> }) {
  const rows = [
    { name: "Field Cleaner", value: settings.fieldCleanerPayLabel },
    { name: "Recurring Home Cleaner", value: settings.recurringHomeCleanerPayLabel },
    { name: "Turnover Cleaner", value: settings.turnoverCleanerPayLabel },
  ].filter((row) => !String(row.value || "").trim());
  if (!rows.length) return null;
  return (
    <ul className="mt-3 space-y-1 text-sm text-amber-900">
      {rows.map((row) => (
        <li key={row.name}>{row.name} pay rate is not set. That role stays closed on the application.</li>
      ))}
    </ul>
  );
}

function QuestionEditor({
  id,
  prompt,
  why,
  helper,
  reviewerGuide,
  onSave,
}: {
  id: string;
  prompt: string;
  why: string;
  helper: string;
  reviewerGuide: string;
  onSave: (patch: { prompt: string; why: string; helper: string; reviewerGuide: string }) => void;
}) {
  const [nextPrompt, setNextPrompt] = useState(prompt);
  const [nextWhy, setNextWhy] = useState(why);
  const [nextHelper, setNextHelper] = useState(helper);
  const [nextGuide, setNextGuide] = useState(reviewerGuide);
  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ prompt: nextPrompt, why: nextWhy, helper: nextHelper, reviewerGuide: nextGuide });
      }}
    >
      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
        Question {id}
        <textarea value={nextPrompt} onChange={(event) => setNextPrompt(event.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm font-normal" />
      </label>
      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
        Job-related reason
        <textarea value={nextWhy} onChange={(event) => setNextWhy(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm font-normal" />
      </label>
      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
        Helper text
        <textarea value={nextHelper} onChange={(event) => setNextHelper(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm font-normal" />
      </label>
      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
        Reviewer guide
        <textarea value={nextGuide} onChange={(event) => setNextGuide(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm font-normal" />
      </label>
      <button type="submit" className="rounded-full border border-slate-300 px-3 py-1.5 text-sm font-semibold">Save new version</button>
    </form>
  );
}

function RoleEditor({
  role,
  onSave,
}: {
  role: { name: string; tag: string; shortDescription: string; whatYoullDo: string[]; whatYoullNeed: string[] };
  onSave: (patch: { name: string; tag: string; shortDescription: string; whatYoullDo: string[]; whatYoullNeed: string[] }) => void;
}) {
  const [name, setName] = useState(role.name);
  const [tag, setTag] = useState(role.tag);
  const [shortDescription, setShortDescription] = useState(role.shortDescription);
  const [whatYoullDo, setWhatYoullDo] = useState((role.whatYoullDo || []).join("\n"));
  const [whatYoullNeed, setWhatYoullNeed] = useState((role.whatYoullNeed || []).join("\n"));
  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          name,
          tag,
          shortDescription,
          whatYoullDo: whatYoullDo.split("\n").map((line) => line.trim()).filter(Boolean),
          whatYoullNeed: whatYoullNeed.split("\n").map((line) => line.trim()).filter(Boolean),
        });
      }}
    >
      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
        Role name
        <input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-2 text-sm font-normal" />
      </label>
      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
        Tag
        <input value={tag} onChange={(event) => setTag(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-2 text-sm font-normal" />
      </label>
      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
        Short description
        <textarea value={shortDescription} onChange={(event) => setShortDescription(event.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm font-normal" />
      </label>
      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
        What you'll do, one line each
        <textarea value={whatYoullDo} onChange={(event) => setWhatYoullDo(event.target.value)} rows={4} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm font-normal" />
      </label>
      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
        What you'll need, one line each
        <textarea value={whatYoullNeed} onChange={(event) => setWhatYoullNeed(event.target.value)} rows={4} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm font-normal" />
      </label>
      <button type="submit" className="rounded-full border border-slate-300 px-3 py-1.5 text-sm font-semibold">Save new version</button>
    </form>
  );
}
