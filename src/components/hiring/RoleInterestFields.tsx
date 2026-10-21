"use client";

import { useId } from "react";
import { wordingById } from "@/lib/contractor-intake/wording";
import {
  ROLE_DESCRIPTION_CONFIRMATION,
  payLine,
  questionsForRole,
  roleById,
  type ContractorRoleId,
  type QuestionCopy,
  type RoleAccess,
  type RoleAnswerDraft,
  type RoleCatalog,
  type RoleInterestDraft,
  type RolePaySettings,
} from "@/lib/contractor-roles";
import { cn } from "@/lib/utils";

const ADDABLE: ContractorRoleId[] = ["recurring_home_cleaner", "turnover_cleaner", "lead_field_cleaner"];

export function RoleInterestFields({
  mode,
  interests,
  access,
  catalog,
  pay,
  onChange,
  onlyRole,
  closedNotice,
}: {
  mode: "application" | "add_one";
  interests: RoleInterestDraft;
  access: RoleAccess;
  catalog: RoleCatalog;
  pay: RolePaySettings;
  onChange: (next: RoleInterestDraft) => void;
  onlyRole?: ContractorRoleId;
  closedNotice?: string | null;
}) {
  const extraRoles = ADDABLE.filter((id) => interests.additional.includes(id));
  const roles = mode === "application"
    ? (["field_cleaner", ...extraRoles] as ContractorRoleId[])
    : (onlyRole ? [onlyRole] : interests.additional.slice(0, 1));

  function confirm(roleId: ContractorRoleId, checked: boolean) {
    onChange({ ...interests, confirmed: { ...interests.confirmed, [roleId]: checked } });
  }

  function answer(item: QuestionCopy, next: RoleAnswerDraft) {
    onChange({ ...interests, answers: { ...interests.answers, [item.id]: next } });
  }

  function toggleRole(roleId: ContractorRoleId) {
    const on = interests.additional.includes(roleId);
    const additional = on
      ? interests.additional.filter((id) => id !== roleId)
      : [...interests.additional, roleId];
    onChange({ ...interests, additional });
  }

  const sections = roles.map((roleId) => {
        const copy = roleById(catalog, roleId);
        if (!copy) return null;
        return (
          <section key={roleId} className="rounded-2xl border border-slate-300 p-4" aria-label={copy.name}>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-violet-700">{copy.tag}</p>
            <h2 className="mt-1 font-heading text-2xl font-semibold text-slate-900">{copy.name}</h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-700">{copy.shortDescription}</p>
            <h3 className="mt-4 text-sm font-semibold text-slate-900">What you'll do</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
              {copy.whatYoullDo.map((line) => <li key={line}>{line}</li>)}
            </ul>
            <h3 className="mt-4 text-sm font-semibold text-slate-900">What you'll need</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
              {copy.whatYoullNeed.map((line) => <li key={line}>{line}</li>)}
            </ul>
            <p className="mt-4 text-sm font-semibold text-slate-900">Pay: {payLine(roleId, pay)}</p>
            <Confirm
              checked={Boolean(interests.confirmed[roleId])}
              onChange={(checked) => confirm(roleId, checked)}
            />
            <div className="mt-6 space-y-6">
              {questionsForRole(catalog, roleId).map((item) => (
                <QuestionField
                  key={item.id}
                  item={item}
                  value={interests.answers[item.id] || { choices: [], text: "" }}
                  onChange={(next) => answer(item, next)}
                />
              ))}
            </div>
            <aside className="mt-6 space-y-3 text-sm leading-relaxed text-slate-700">
              <p>{wordingById("application_privacy")?.body}</p>
              <p>
                If you need an accommodation to complete this application, email{" "}
                <a className="font-semibold text-slate-900 underline" href="mailto:operations@novaracleaning.com">operations@novaracleaning.com</a>.
              </p>
            </aside>
          </section>
        );
  });

  const picker = mode === "application" ? (
    <div>
      <h2 className="text-lg font-semibold text-slate-900">I am also interested in these roles.</h2>
      <p className="mt-1 text-sm text-slate-600">You can add either, both, or neither. Field Cleaner stays either way.</p>
      <div className="mt-3 space-y-2">
        {ADDABLE.map((roleId) => {
          const copy = roleById(catalog, roleId);
          if (!copy) return null;
          if (roleId === "lead_field_cleaner" && !access.leadCanApply) {
            return (
              <p key={roleId} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                {closedNotice || "Grow into Lead Field Cleaner (current Novara cleaners first)"}
              </p>
            );
          }
          if (roleId !== "lead_field_cleaner" && !copy.publicEnabled) return null;
          const on = interests.additional.includes(roleId);
          return (
            <label key={roleId} className={cn("flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3", on ? "border-violet-700 bg-violet-50" : "border-slate-300")}>
              <input type="checkbox" className="mt-1 h-5 w-5" checked={on} onChange={() => toggleRole(roleId)} />
              <span>
                <span className="block font-semibold">{copy.name}</span>
                <span className="mt-0.5 block text-sm text-slate-600">{copy.tag}</span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  ) : null;

  if (mode === "application") {
    return (
      <div className="space-y-8">
        {sections[0]}
        {picker}
        {sections.slice(1)}
      </div>
    );
  }
  return <div className="space-y-8">{sections}</div>;
}

function Confirm({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  const id = useId();
  return (
    <label htmlFor={id} className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-300 bg-white p-4 text-sm font-semibold text-slate-900">
      <input id={id} type="checkbox" className="mt-0.5 h-5 w-5" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{ROLE_DESCRIPTION_CONFIRMATION}</span>
    </label>
  );
}

function QuestionField({
  item,
  value,
  onChange,
}: {
  item: QuestionCopy;
  value: RoleAnswerDraft;
  onChange: (next: RoleAnswerDraft) => void;
}) {
  const showYesText = item.kind === "single_choice_text" && value.choices.some((choice) => choice.startsWith("Yes"));
  const showText = item.kind === "long_text" || item.kind === "multi_choice_text" || showYesText;
  return (
    <fieldset className="space-y-3">
      <legend className="text-base font-semibold text-slate-900">
        {item.prompt}
        <span className="ml-2 text-xs font-medium uppercase tracking-wide text-slate-500">{item.required ? "Required" : "Optional"}</span>
      </legend>
      <p className="text-sm text-slate-600">Why we ask: {item.why}</p>
      {item.kind === "single_choice_text" && (
        <div className="space-y-2" role="radiogroup" aria-label={item.prompt}>
          {item.options.map((option) => {
            const on = value.choices[0] === option;
            return (
              <button key={option} type="button" role="radio" aria-checked={on} onClick={() => onChange({ ...value, choices: [option] })} className={cn("block w-full rounded-2xl border px-4 py-3 text-left font-semibold", on ? "border-violet-700 bg-violet-50" : "border-slate-300")}>
                {option}
              </button>
            );
          })}
        </div>
      )}
      {item.kind === "multi_choice_text" && (
        <div className="space-y-2">
          {item.options.map((option) => {
            const on = value.choices.includes(option);
            const choices = on ? value.choices.filter((choice) => choice !== option) : [...value.choices, option];
            return (
              <button key={option} type="button" aria-pressed={on} onClick={() => onChange({ ...value, choices })} className={cn("block w-full rounded-2xl border px-4 py-3 text-left font-semibold", on ? "border-violet-700 bg-violet-50" : "border-slate-300")}>
                {option}
              </button>
            );
          })}
        </div>
      )}
      {showText && (
        <label className="block text-sm font-semibold text-slate-800">
          {item.kind === "long_text" ? "Your answer" : item.helper}
          <textarea
            value={value.text}
            rows={item.kind === "long_text" ? 5 : 3}
            maxLength={4000}
            onChange={(event) => onChange({ ...value, text: event.target.value })}
            className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 text-base font-normal text-slate-900"
          />
        </label>
      )}
    </fieldset>
  );
}
