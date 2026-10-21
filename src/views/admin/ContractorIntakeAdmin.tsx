"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PIPELINE_STAGES } from "@/lib/contractor-intake/verification";
import { WORDING_STATUS_LABEL } from "@/lib/contractor-intake/wording";

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
  const wording = (data?.wording || []) as Array<{ id: string; title: string; status: string; body: string }>;
  const review = (data?.needsReview || []) as Array<{ id: string; full_name?: string; email?: string; intake_decision?: { message?: string } }>;
  const assignment = (data?.assignment || {}) as { laborPercent?: number; needsAdmin?: boolean; reason?: string | null };

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 md:p-6">
      <header>
        <h1 className="font-heading text-2xl font-semibold">Contractor intake</h1>
        <p className="mt-1 text-sm text-slate-600">Every notice is {WORDING_STATUS_LABEL} until you mark it reviewed. Thresholds are settings.</p>
      </header>
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
        <button type="button" className="mt-3 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white" onClick={() => void post({ action: "open_lead_role" })}>
          Open Lead Cleaner to new applicants
        </button>
      </section>
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Wording</h2>
        <ul className="mt-3 space-y-3">
          {wording.map((row) => (
            <li key={row.id} className="rounded-xl border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold">{row.title}</p>
                <span className="text-xs uppercase tracking-wide text-amber-800">{row.status === "reviewed" ? "Reviewed" : WORDING_STATUS_LABEL}</span>
              </div>
              <p className="mt-2 text-sm text-slate-700">{row.body}</p>
              {row.status !== "reviewed" && (
                <button type="button" className="mt-2 text-sm font-semibold underline" onClick={() => void post({ action: "mark_reviewed", id: row.id })}>
                  Mark reviewed
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
