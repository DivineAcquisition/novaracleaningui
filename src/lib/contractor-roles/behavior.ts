// How role selection, answers, review, and pay lines behave.
// Role answers are for a person to read. Nothing here scores, ranks, or rejects.

import { usesForbiddenApplicantLanguage } from "@/lib/contractor-intake/decide";
import type { IntakeSettings } from "@/lib/contractor-intake/settings";
import { TIER_REVENUE_SHARE } from "@/lib/payroll";
import {
  LEAD_CLOSED_NOTICE,
  questionsForRole,
  roleById,
  type ContractorRoleId,
  type QuestionCopy,
  type RoleCatalog,
} from "./catalog";

export interface RolePaySettings {
  fieldMinPercent: number;
  fieldMaxPercent: number;
  leadPayPercent: number;
  recurringMinPercent: number;
  recurringMaxPercent: number;
  turnoverPayPercent: number;
}

export function rolePaySettings(settings: Pick<IntakeSettings, "leadPayPercent" | "turnoverPayPercent">): RolePaySettings {
  return {
    fieldMinPercent: TIER_REVENUE_SHARE.foundation,
    fieldMaxPercent: TIER_REVENUE_SHARE.elite,
    leadPayPercent: settings.leadPayPercent,
    recurringMinPercent: TIER_REVENUE_SHARE.foundation,
    recurringMaxPercent: TIER_REVENUE_SHARE.elite,
    turnoverPayPercent: settings.turnoverPayPercent,
  };
}

export function payLine(roleId: ContractorRoleId, pay: RolePaySettings): string {
  switch (roleId) {
    case "field_cleaner":
      return `${pay.fieldMinPercent}–${pay.fieldMaxPercent}% of the job`;
    case "lead_field_cleaner":
      return `${pay.leadPayPercent}% of lead jobs`;
    case "recurring_home_cleaner":
      return `${pay.recurringMinPercent}–${pay.recurringMaxPercent}% of each recurring home visit`;
    case "turnover_cleaner":
      return `${pay.turnoverPayPercent}% of each turnover`;
  }
}

export interface RoleAccess {
  leadCanApply: boolean;
  recurringPublic: boolean;
  turnoverPublic: boolean;
  fieldPublic: boolean;
}

export function accessFromCatalog(
  catalog: RoleCatalog,
  input: { leadRoleOpenToPublic: boolean; eligibleOrInvited: boolean },
): RoleAccess {
  const enabled = (id: ContractorRoleId) => roleById(catalog, id)?.publicEnabled !== false;
  return {
    fieldPublic: enabled("field_cleaner"),
    recurringPublic: enabled("recurring_home_cleaner"),
    turnoverPublic: enabled("turnover_cleaner"),
    leadCanApply: enabled("lead_field_cleaner") && (input.leadRoleOpenToPublic || input.eligibleOrInvited),
  };
}

export function roleCanBeSelected(roleId: ContractorRoleId, access: RoleAccess): boolean {
  if (roleId === "field_cleaner") return true;
  if (roleId === "recurring_home_cleaner") return access.recurringPublic;
  if (roleId === "turnover_cleaner") return access.turnoverPublic;
  return access.leadCanApply;
}

export interface PublicRoleCard {
  id: ContractorRoleId;
  name: string;
  tag: string;
  shortDescription: string;
  whatYoullDo: string[];
  whatYoullNeed: string[];
  payLine: string;
  descriptionVersion: number;
  detailPath: string;
  applyQuery: string | null;
  closedNotice: string | null;
}

const DETAIL_PATH: Record<ContractorRoleId, string> = {
  field_cleaner: "/hiring/field-tech",
  lead_field_cleaner: "/hiring/lead-cleaner",
  recurring_home_cleaner: "/hiring/recurring-home-cleaner",
  turnover_cleaner: "/hiring/turnover-cleaner",
};

const APPLY_QUERY: Record<ContractorRoleId, string> = {
  field_cleaner: "field-tech",
  lead_field_cleaner: "lead-cleaner",
  recurring_home_cleaner: "recurring-home-cleaner",
  turnover_cleaner: "turnover-cleaner",
};

export function publicRoleCards(catalog: RoleCatalog, pay: RolePaySettings, access: RoleAccess): PublicRoleCard[] {
  const cards: PublicRoleCard[] = [];
  for (const row of catalog.roles) {
    if (!row.publicEnabled) continue;
    const leadClosed = row.id === "lead_field_cleaner" && !access.leadCanApply;
    const apply = row.id === "field_cleaner" || roleCanBeSelected(row.id, access);
    cards.push({
      id: row.id,
      name: row.name,
      tag: row.tag,
      shortDescription: row.shortDescription,
      whatYoullDo: [...row.whatYoullDo],
      whatYoullNeed: [...row.whatYoullNeed],
      payLine: payLine(row.id, pay),
      descriptionVersion: row.version,
      detailPath: DETAIL_PATH[row.id],
      applyQuery: apply && !leadClosed ? APPLY_QUERY[row.id] : null,
      closedNotice: leadClosed ? LEAD_CLOSED_NOTICE : null,
    });
  }
  return cards;
}

export interface RoleAnswerDraft {
  choices: string[];
  text: string;
}

export interface RoleInterestDraft {
  additional: ContractorRoleId[];
  confirmed: Partial<Record<ContractorRoleId, boolean>>;
  answers: Partial<Record<string, RoleAnswerDraft>>;
}

export function emptyRoleInterest(): RoleInterestDraft {
  return { additional: [], confirmed: {}, answers: {} };
}

const ADDITIONAL: ContractorRoleId[] = ["lead_field_cleaner", "recurring_home_cleaner", "turnover_cleaner"];

export function additionalFromQuery(role: string | null | undefined, access: RoleAccess): ContractorRoleId[] {
  if (role === "lead-cleaner" && access.leadCanApply) return ["lead_field_cleaner"];
  if (role === "recurring-home-cleaner" && access.recurringPublic) return ["recurring_home_cleaner"];
  if (role === "turnover-cleaner" && access.turnoverPublic) return ["turnover_cleaner"];
  return [];
}

export function setAdditionalRole(draft: RoleInterestDraft, roleId: ContractorRoleId, on: boolean): RoleInterestDraft {
  if (roleId === "field_cleaner") return draft;
  const additional = on
    ? ADDITIONAL.filter((id) => id === roleId || draft.additional.includes(id))
    : draft.additional.filter((id) => id !== roleId);
  return { ...draft, additional, answers: draft.answers, confirmed: draft.confirmed };
}

export function selectedRoles(draft: RoleInterestDraft, access: RoleAccess, includeField = true): ContractorRoleId[] {
  const selected: ContractorRoleId[] = includeField ? ["field_cleaner"] : [];
  for (const id of ADDITIONAL) {
    if (draft.additional.includes(id) && roleCanBeSelected(id, access)) selected.push(id);
  }
  return selected;
}

export interface SavedRoleAnswer {
  questionId: string;
  version: number;
  prompt: string;
  why: string;
  reviewerGuide: string;
  kind: QuestionCopy["kind"];
  choices: string[];
  text: string;
}

export type RoleDecisionKind = "approve" | "approve_later" | "decline";

export interface RoleDecision {
  decision: RoleDecisionKind;
  note: string | null;
  reviewer: string;
  at: string;
}

export type RoleNextStep =
  | { kind: "field_onboarding" }
  | { kind: "addendum"; wordingId: "lead_addendum" | "recurring_home_addendum" }
  | { kind: "turnover_jobs" }
  | { kind: "trial_job"; roleId: ContractorRoleId };

export interface SavedRoleSection {
  roleId: ContractorRoleId;
  name: string;
  tag: string;
  descriptionVersion: number;
  descriptionConfirmedAt: string;
  shortDescription: string;
  whatYoullDo: string[];
  whatYoullNeed: string[];
  answers: SavedRoleAnswer[];
  decision: RoleDecision | null;
  nextStep: RoleNextStep | null;
}

function cleanAnswer(raw: RoleAnswerDraft | undefined, item: QuestionCopy): RoleAnswerDraft {
  const allowed = new Set(item.options);
  const choices = (raw?.choices || []).map((choice) => choice.trim()).filter((choice) => allowed.has(choice));
  const text = String(raw?.text || "").replace(/\r\n/g, "\n").trim().slice(0, 4000);
  if (item.kind === "single_choice_text") return { choices: choices.slice(0, 1), text };
  if (item.kind === "long_text") return { choices: [], text };
  return { choices, text };
}

function answerMissing(item: QuestionCopy, answer: RoleAnswerDraft): boolean {
  if (!item.required) return false;
  if (item.kind === "long_text") return answer.text.length < 2;
  if (item.kind === "single_choice_text") return answer.choices.length !== 1;
  return answer.choices.length === 0 && answer.text.length < 2;
}

export function roleInterestIssue(
  draft: RoleInterestDraft,
  catalog: RoleCatalog,
  access: RoleAccess,
  mode: "application" | "add_one" = "application",
): { code: string; error: string } | null {
  const selected = mode === "add_one"
    ? draft.additional.filter((id) => roleCanBeSelected(id, access)).slice(0, 1)
    : selectedRoles(draft, access, true);
  if (mode === "add_one" && selected.length !== 1) {
    return { code: "role_not_open", error: "That role is not open for you to add right now." };
  }
  for (const roleId of selected) {
    const copy = roleById(catalog, roleId);
    if (!copy) return { code: "invalid_role", error: "That role is not open." };
    if (!draft.confirmed[roleId]) {
      return { code: "missing_role_confirmation", error: `Confirm that you have read the ${copy.name} description.` };
    }
    for (const item of questionsForRole(catalog, roleId)) {
      const answer = cleanAnswer(draft.answers[item.id], item);
      if (answerMissing(item, answer)) {
        return { code: "missing_role_answer", error: `Answer the ${copy.name} question: ${item.prompt}` };
      }
    }
  }
  return null;
}

export function buildRoleSections(
  draft: RoleInterestDraft,
  catalog: RoleCatalog,
  access: RoleAccess,
  confirmedAt: string,
  mode: "application" | "add_one" = "application",
): { ok: true; sections: SavedRoleSection[] } | { ok: false; code: string; error: string } {
  const issue = roleInterestIssue(draft, catalog, access, mode);
  if (issue) return { ok: false, ...issue };
  const selected = mode === "add_one"
    ? draft.additional.filter((id) => roleCanBeSelected(id, access)).slice(0, 1)
    : selectedRoles(draft, access, true);
  const sections: SavedRoleSection[] = [];
  for (const roleId of selected) {
    const copy = roleById(catalog, roleId);
    if (!copy) continue;
    const answers: SavedRoleAnswer[] = questionsForRole(catalog, roleId).map((item) => {
      const answer = cleanAnswer(draft.answers[item.id], item);
      return {
        questionId: item.id,
        version: item.version,
        prompt: item.prompt,
        why: item.why,
        reviewerGuide: item.reviewerGuide,
        kind: item.kind,
        choices: answer.choices,
        text: answer.text,
      };
    });
    sections.push({
      roleId,
      name: copy.name,
      tag: copy.tag,
      descriptionVersion: copy.version,
      descriptionConfirmedAt: confirmedAt,
      shortDescription: copy.shortDescription,
      whatYoullDo: [...copy.whatYoullDo],
      whatYoullNeed: [...copy.whatYoullNeed],
      answers,
      decision: null,
      nextStep: null,
    });
  }
  return { ok: true, sections };
}

export function nextStepForDecision(roleId: ContractorRoleId, decision: RoleDecisionKind): RoleNextStep | null {
  if (decision === "decline") return null;
  if (decision === "approve_later") return { kind: "trial_job", roleId };
  if (roleId === "lead_field_cleaner") return { kind: "addendum", wordingId: "lead_addendum" };
  if (roleId === "recurring_home_cleaner") return { kind: "addendum", wordingId: "recurring_home_addendum" };
  if (roleId === "turnover_cleaner") return { kind: "turnover_jobs" };
  return { kind: "field_onboarding" };
}

const NON_CONTRACTOR = /\b(employees?|staff|shifts?|supervisors?|managers?|team members?)\b/i;

export function contractorLanguageProblems(text: string): string[] {
  const problems: string[] = [];
  if (NON_CONTRACTOR.test(text)) problems.push("non_contractor_language");
  if (usesForbiddenApplicantLanguage(text)) problems.push("forbidden_applicant_language");
  return problems;
}

export function roleOutcomeMessage(input: {
  decision: RoleDecisionKind;
  roleName: string;
  firstName?: string | null;
  note?: string | null;
}): { subject: string; text: string } {
  const name = (input.firstName || "").trim() || "there";
  const note = (input.note || "").trim();
  const role = input.roleName;
  let body: string;
  if (input.decision === "approve") {
    body = `Hi ${name}, you are approved for ${role}. You can accept or decline any job in this role.`;
  } else if (input.decision === "approve_later") {
    body = `Hi ${name}, ${role} can be considered again after more experience or a trial job.`;
  } else if (role === "Field Cleaner") {
    body = `Hi ${name}, we are not moving forward with Field Cleaner. This does not change any other role.`;
  } else {
    body = `Hi ${name}, we are not moving forward with ${role}. This does not change your Field Cleaner application or any other role.`;
  }
  if (note) body = `${body} ${note}`;
  const text = `${body}\n\nNVC Operations\noperations@novaracleaning.com`;
  const problems = contractorLanguageProblems(`${role} update\n${text}`);
  if (problems.length) throw new Error(`Role message uses language that is not allowed: ${problems.join(", ")}`);
  return { subject: `${role} update`, text };
}

export function recordRoleDecision(
  sections: SavedRoleSection[],
  input: { roleId: ContractorRoleId; decision: RoleDecisionKind; note: string; reviewer: string; at: string; firstName?: string | null },
): { ok: true; sections: SavedRoleSection[]; nextStep: RoleNextStep | null; message: { subject: string; text: string } } | { ok: false; error: string } {
  const index = sections.findIndex((row) => row.roleId === input.roleId);
  if (index < 0) return { ok: false, error: "That role is not on this application." };
  const note = input.note.trim();
  if ((input.decision === "decline" || input.decision === "approve_later") && !note) {
    return { ok: false, error: "A note is required for this decision." };
  }
  if (!input.reviewer.trim()) return { ok: false, error: "The reviewer is required." };
  const current = sections[index];
  const nextStep = nextStepForDecision(current.roleId, input.decision);
  const updated: SavedRoleSection = {
    ...current,
    answers: current.answers.map((answer) => ({ ...answer, choices: [...answer.choices] })),
    decision: {
      decision: input.decision,
      note: note || null,
      reviewer: input.reviewer.trim(),
      at: input.at,
    },
    nextStep,
  };
  const next = sections.map((row, i) => i === index ? updated : {
    ...row,
    answers: row.answers.map((answer) => ({ ...answer, choices: [...answer.choices] })),
    decision: row.decision ? { ...row.decision } : null,
    nextStep: row.nextStep ? { ...row.nextStep } : null,
  });
  return {
    ok: true,
    sections: next,
    nextStep,
    message: roleOutcomeMessage({
      decision: input.decision,
      roleName: current.name,
      firstName: input.firstName,
      note,
    }),
  };
}

/** The wording stored on the answer, not the wording in the catalog now. */
export function answerPrompt(answer: SavedRoleAnswer): string {
  return answer.prompt;
}

export function reviewHasNoScore(section: SavedRoleSection): boolean {
  const record = section as SavedRoleSection & { score?: unknown; ranking?: unknown; recommendedDecision?: unknown };
  return record.score == null && record.ranking == null && record.recommendedDecision == null;
}

const PROTECTED_QUESTION = /\b(date of birth|birthday|married|spouse|pregnant|disability|religion|national origin|citizenship|green card|social security|your children|your pets|your family)\b/i;

export function questionStaysOnTheWork(item: QuestionCopy): boolean {
  const blob = `${item.prompt}\n${item.why}\n${item.helper}\n${item.options.join("\n")}`;
  return item.why.trim().length > 0 && !PROTECTED_QUESTION.test(blob);
}

export function parseRoleInterest(raw: unknown): RoleInterestDraft {
  const empty = emptyRoleInterest();
  if (!raw || typeof raw !== "object") return empty;
  const row = raw as { additional?: unknown; confirmed?: unknown; answers?: unknown };
  const additional = Array.isArray(row.additional)
    ? row.additional.map((id) => String(id)).filter((id): id is ContractorRoleId => ADDITIONAL.includes(id as ContractorRoleId))
    : [];
  const confirmed: RoleInterestDraft["confirmed"] = {};
  if (row.confirmed && typeof row.confirmed === "object") {
    for (const [key, value] of Object.entries(row.confirmed as Record<string, unknown>)) {
      if (value === true) confirmed[key as ContractorRoleId] = true;
    }
  }
  const answers: RoleInterestDraft["answers"] = {};
  if (row.answers && typeof row.answers === "object") {
    for (const [key, value] of Object.entries(row.answers as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const answer = value as { choices?: unknown; text?: unknown };
      answers[key] = {
        choices: Array.isArray(answer.choices) ? answer.choices.map((choice) => String(choice)).slice(0, 12) : [],
        text: typeof answer.text === "string" ? answer.text.slice(0, 4000) : "",
      };
    }
  }
  return { additional, confirmed, answers };
}

export function sectionsFromUnknown(raw: unknown): SavedRoleSection[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((row) => row && typeof row === "object" && typeof (row as SavedRoleSection).roleId === "string") as SavedRoleSection[];
}

export function upsertSection(sections: SavedRoleSection[], section: SavedRoleSection): SavedRoleSection[] {
  const rest = sections.filter((row) => row.roleId !== section.roleId);
  return [...rest, section];
}
