"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ONBOARDING_PANELS } from "@/lib/contractor-intake/onboarding";
import { wordingById, WORDING_STATUS_LABEL } from "@/lib/contractor-intake/wording";

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  return { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token || ""}` };
}

export function ContractorIntakePanel() {
  const [state, setState] = useState<Record<string, unknown> | null>(null);
  const [hidden, setHidden] = useState(false);
  const [notice, setNotice] = useState("");

  const load = async () => {
    const res = await fetch("/api/cleaner/intake", { headers: await authHeaders() });
    if (res.status === 404) {
      setHidden(true);
      return;
    }
    const json = await res.json();
    if (!res.ok) setNotice(json.error || "Could not load onboarding checks.");
    else setState(json);
  };

  useEffect(() => { void load(); }, []);

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/cleaner/intake", { method: "POST", headers: await authHeaders(), body: JSON.stringify(body) });
    const json = await res.json();
    setNotice(res.ok ? (json.message || "Saved.") : json.error || "Could not save.");
    await load();
  };

  if (hidden || state?.intakeFlow !== "automated") return null;
  const record = (state?.record || {}) as Record<string, unknown>;

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-4">
      <div>
        <h2 className="text-lg font-semibold">Verification</h2>
        <p className="text-sm text-muted-foreground">These checks replaced the screening call. {WORDING_STATUS_LABEL}.</p>
      </div>
      {notice && <p className="text-sm">{notice}</p>}
      {ONBOARDING_PANELS.map((panel) => (
        <article key={panel.step} className="rounded-xl border border-border p-3 text-sm">
          <h3 className="font-semibold capitalize">{panel.step}</h3>
          <p className="mt-1">What we collect: {panel.collects}</p>
          <p>Why: {panel.why}</p>
          <p>Who sees it: {panel.whoSees}</p>
          <p>How long: {panel.retention}</p>
          <p>Your choices: {panel.rights}</p>
          <p className="mt-1 text-xs text-muted-foreground">{wordingById(panel.wordingId)?.title}</p>
        </article>
      ))}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground" onClick={() => void post({ action: "identity_consent" })}>
          I agree to the face match
        </button>
        <button type="button" className="rounded-full border px-4 py-2 text-sm font-semibold" onClick={() => void post({ action: "identity_decline" })}>
          Review my ID manually instead
        </button>
        <button type="button" className="rounded-full border px-4 py-2 text-sm font-semibold" onClick={() => void post({ action: "vehicle_photo", source: "camera", takenAt: new Date().toISOString() })}>
          Save an in-app vehicle photo
        </button>
        <button type="button" className="rounded-full border px-4 py-2 text-sm font-semibold" onClick={() => void post({ action: "kit", complete: false })}>
          Save an incomplete kit
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Identity: {String(record.identity || "not started")}. Vehicle: {String(record.vehicle || "not started")}. Kit confirmed: {String(record.kitConfirmed === true)}.
      </p>
    </section>
  );
}
