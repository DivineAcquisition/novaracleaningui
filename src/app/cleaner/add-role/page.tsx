"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { supabase } from "@/integrations/supabase/client";
import { RoleInterestFields } from "@/components/hiring/RoleInterestFields";
import { DEFAULT_INTAKE_SETTINGS } from "@/lib/contractor-intake/settings";
import {
  accessFromCatalog,
  emptyRoleInterest,
  roleById,
  rolePaySettings,
  seedRoleCatalog,
  type ContractorRoleId,
  type RoleInterestDraft,
} from "@/lib/contractor-roles";

const CHOICES: ContractorRoleId[] = ["recurring_home_cleaner", "turnover_cleaner", "lead_field_cleaner"];

function AddRoleForm() {
  const params = useSearchParams();
  const requested = params.get("role") as ContractorRoleId | null;
  const catalog = seedRoleCatalog();
  const [roleId, setRoleId] = useState<ContractorRoleId>(CHOICES.includes(requested as ContractorRoleId) ? requested as ContractorRoleId : "turnover_cleaner");
  const [interests, setInterests] = useState<RoleInterestDraft>({ ...emptyRoleInterest(), additional: [roleId] });
  const [sent, setSent] = useState("");
  const [leadCanApply, setLeadCanApply] = useState(false);
  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getSession();
      const res = await fetch("/api/cleaner/intake", { headers: { Authorization: `Bearer ${data.session?.access_token || ""}` } });
      if (!res.ok) return;
      const json = await res.json();
      setLeadCanApply(Boolean(json.leadCanApply));
    })();
  }, []);
  const choices = CHOICES.filter((id) => id !== "lead_field_cleaner" || leadCanApply);
  const access = useMemo(
    () => accessFromCatalog(catalog, { leadRoleOpenToPublic: leadCanApply, eligibleOrInvited: leadCanApply }),
    [catalog, leadCanApply],
  );
  const copy = roleById(catalog, roleId);

  function choose(next: ContractorRoleId) {
    setRoleId(next);
    setInterests((current) => ({ ...current, additional: [next] }));
    setSent("");
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
          body: JSON.stringify({ action: "add_role", interests: { ...interests, additional: [roleId] } }),
        });
        const json = await res.json();
        setSent(res.ok ? json.message : json.error || "Could not save the application.");
      }}
    >
      <h1 className="font-heading text-3xl font-semibold">Add a role</h1>
      <p className="text-base text-slate-700">This short application has only the description and questions for the role you choose. It goes to the same review queue. Your Field Cleaner work stays as it is.</p>
      <div className="flex flex-wrap gap-2">
        {choices.map((id) => {
          const name = roleById(catalog, id)?.name || id;
          const on = id === roleId;
          return (
            <button key={id} type="button" aria-pressed={on} onClick={() => choose(id)} className={on ? "rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white" : "rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold"}>
              {name}
            </button>
          );
        })}
      </div>
      {copy && (
        <RoleInterestFields
          mode="add_one"
          onlyRole={roleId}
          interests={{ ...interests, additional: [roleId] }}
          access={access}
          catalog={catalog}
          pay={rolePaySettings(DEFAULT_INTAKE_SETTINGS)}
          onChange={setInterests}
        />
      )}
      <button type="submit" className="rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white">Submit for review</button>
      {sent && <p className="text-sm text-slate-800">{sent}</p>}
    </form>
  );
}

export default function Page() {
  return (
    <Suspense>
      <AddRoleForm />
    </Suspense>
  );
}
