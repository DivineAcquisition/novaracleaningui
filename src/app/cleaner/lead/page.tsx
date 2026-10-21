"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/integrations/supabase/client";
import { RoleInterestFields } from "@/components/hiring/RoleInterestFields";
import { outsideLeadRecordLabel } from "@/lib/contractor-intake/lead-application";
import { LEAD_GUARDRAILS } from "@/lib/contractor-intake/lead";
import { DEFAULT_INTAKE_SETTINGS } from "@/lib/contractor-intake/settings";
import {
  accessFromCatalog,
  emptyRoleInterest,
  rolePaySettings,
  seedRoleCatalog,
  type RoleInterestDraft,
} from "@/lib/contractor-roles";

export default function LeadCleanerPage() {
  const [interests, setInterests] = useState<RoleInterestDraft>({
    ...emptyRoleInterest(),
    additional: ["lead_field_cleaner"],
  });
  const [leadCanApply, setLeadCanApply] = useState(true);
  const [sent, setSent] = useState("");
  const catalog = seedRoleCatalog();
  const access = accessFromCatalog(catalog, { leadRoleOpenToPublic: leadCanApply, eligibleOrInvited: leadCanApply });

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getSession();
      const res = await fetch("/api/cleaner/intake", { headers: { Authorization: `Bearer ${data.session?.access_token || ""}` } });
      if (!res.ok) return;
      const json = await res.json();
      setLeadCanApply(Boolean(json.leadCanApply));
    })();
  }, []);

  if (!leadCanApply) {
    return (
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-8 text-slate-900">
        <h1 className="font-heading text-3xl font-semibold">Lead Field Cleaner</h1>
        <p className="text-base text-slate-700">Grow into Lead Field Cleaner (current Novara cleaners first)</p>
        <Link href="/cleaner/add-role" className="text-sm font-semibold underline">Add another role</Link>
      </main>
    );
  }

  return (
    <form
      className="mx-auto max-w-2xl space-y-6 px-4 py-8 text-slate-900"
      onSubmit={async (event) => {
        event.preventDefault();
        const { data: session } = await supabase.auth.getSession();
        const res = await fetch("/api/cleaner/intake", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.session?.access_token || ""}` },
          body: JSON.stringify({ action: "add_role", interests }),
        });
        const json = await res.json();
        setSent(res.ok ? json.message : json.error || "Could not save the application.");
      }}
    >
      <h1 className="font-heading text-3xl font-semibold">Lead Field Cleaner</h1>
      <p className="text-base text-slate-700">A person decides every Lead Field Cleaner application. Nothing here is approved automatically.</p>
      <section className="rounded-2xl border border-slate-300 p-4">
        <h2 className="font-semibold">Reliability record</h2>
        <p className="mt-2 text-sm text-slate-700">Contractors who already work with Novara see their tenure, completed jobs, Novara Score, no-shows, late cancellations, complaints, and on-time arrival before they apply.</p>
        <p className="mt-2 text-sm font-semibold">{outsideLeadRecordLabel()}</p>
      </section>
      <section className="rounded-2xl border border-slate-300 p-4">
        <h2 className="font-semibold">Vehicle and kit</h2>
        <p className="mt-2 text-sm text-slate-700">A verified vehicle and a confirmed supply kit stay part of this review. Those checks are unchanged.</p>
      </section>
      <RoleInterestFields
        mode="add_one"
        onlyRole="lead_field_cleaner"
        interests={interests}
        access={access}
        catalog={catalog}
        pay={rolePaySettings(DEFAULT_INTAKE_SETTINGS)}
        onChange={setInterests}
      />
      <section>
        <h2 className="font-semibold">Guardrails</h2>
        <ul className="mt-2 list-disc pl-5 text-sm text-slate-700">
          {LEAD_GUARDRAILS.map((line) => <li key={line}>{line}</li>)}
        </ul>
      </section>
      <button type="submit" className="rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white">
        Submit for review
      </button>
      {sent && <p className="text-sm text-slate-800">{sent}</p>}
      <Link href="/cleaner/add-role" className="block text-sm font-semibold underline">Add a different role</Link>
    </form>
  );
}
