// Role descriptions and role questions. Every line starts as Draft pending
// legal review. Editing the wording creates a new version. Turning a role
// off for the public hiring page does not delete it.

import { WORDING_STATUS_LABEL, type WordingStatus } from "@/lib/contractor-intake/wording";

export const ROLE_COPY_KEY = "contractor_role_copy";
export const ROLE_DESCRIPTION_CONFIRMATION = "I have read the description of this role.";
export const CONTRACTOR_ROLE_TAG = "Independent Contractor";
export const LEAD_CLOSED_NOTICE = "Grow into Lead Field Cleaner (current Novara cleaners first)";

export type ContractorRoleId =
  | "field_cleaner"
  | "lead_field_cleaner"
  | "recurring_home_cleaner"
  | "turnover_cleaner";

export type QuestionKind = "long_text" | "single_choice_text" | "multi_choice_text";

export interface RoleCopy {
  id: ContractorRoleId;
  version: number;
  status: WordingStatus;
  publicEnabled: boolean;
  name: string;
  tag: string;
  shortDescription: string;
  whatYoullDo: string[];
  whatYoullNeed: string[];
}

export interface QuestionCopy {
  id: string;
  roleId: ContractorRoleId;
  kind: QuestionKind;
  required: boolean;
  version: number;
  status: WordingStatus;
  prompt: string;
  why: string;
  helper: string;
  reviewerGuide: string;
  options: string[];
}

export interface RoleCatalog {
  roles: RoleCopy[];
  questions: QuestionCopy[];
}

export const DRAFT_WORDING_LABEL = WORDING_STATUS_LABEL;

function role(
  id: ContractorRoleId,
  name: string,
  shortDescription: string,
  whatYoullDo: string[],
  whatYoullNeed: string[],
): RoleCopy {
  return {
    id,
    version: 1,
    status: "draft",
    publicEnabled: true,
    name,
    tag: CONTRACTOR_ROLE_TAG,
    shortDescription,
    whatYoullDo,
    whatYoullNeed,
  };
}

function question(
  id: string,
  roleId: ContractorRoleId,
  kind: QuestionKind,
  required: boolean,
  prompt: string,
  why: string,
  reviewerGuide: string,
  helper = "",
  options: string[] = [],
): QuestionCopy {
  return {
    id,
    roleId,
    kind,
    required,
    version: 1,
    status: "draft",
    prompt,
    why,
    helper,
    reviewerGuide,
    options,
  };
}

export function seedRoleCatalog(): RoleCatalog {
  return {
    roles: [
      role(
        "field_cleaner",
        "Field Cleaner",
        "Field Cleaners clean residential homes on the Novara network. You accept the jobs that fit your days, bring your own supplies, and finish the checklist. You can accept or decline any job.",
        [
          "Clean residential homes and follow each job's checklist",
          "Check in through the app and photograph the finished work",
          "Bring your own supplies to each job",
        ],
        [
          "A personal vehicle you can drive to jobs",
          "A cleaning supply kit",
          "A smartphone that can run the Novara app and take photos",
          "You are 18 or older",
        ],
      ),
      role(
        "lead_field_cleaner",
        "Lead Field Cleaner",
        "Lead Field Cleaners take on larger and team jobs, complete the final walkthrough with photos, show new cleaners the work on trial jobs, and receive first offers on urgent and backup jobs. You can accept or decline any lead job.",
        [
          "Lead 2-person and team jobs such as deep cleans, move-ins and move-outs",
          "Complete the walkthrough checklist and photos before a lead job closes",
          "Show new cleaners the work on trial jobs and submit a factual report",
          "Receive first offers on urgent, same-day and dropped jobs",
        ],
        [
          "Experience leading or working as the lead on a team job",
          "A verified vehicle and a full supply kit, including supplies for a helper",
          "A strong record with Novara (reviewed from our records)",
          "Comfort recording facts and photos accurately",
        ],
      ),
      role(
        "recurring_home_cleaner",
        "Recurring Home Cleaner",
        "Recurring Home Cleaners clean the same residential homes on a regular schedule (weekly, bi-weekly or monthly membership homes). You get to know a home and its household and build steady repeat work. Residential only. You choose which recurring homes to accept.",
        [
          "Clean the same homes on a regular schedule and follow each home's checklist",
          "Work in lived-in homes, including homes with pets, children, or people working from home",
          "Handle home keys and access codes carefully",
        ],
        [
          "A record of arriving on time and finishing the checklist",
          "Comfort in occupied homes",
          "A willingness to give notice before you stop servicing a home so clients are not left without service (the notice period is set in your Recurring Home addendum)",
        ],
      ),
      role(
        "turnover_cleaner",
        "Turnover Cleaner",
        "Turnover Cleaners clean rental and Airbnb properties between guests, in the window between checkout and the next check-in. You restock supplies, handle linens, photograph each unit when you finish, and report any damage. You choose which turnovers to accept.",
        [
          "Clean rental properties in a set window between guests, including some same-day turnovers and weekends",
          "Reset beds, handle linens, and restock supplies",
          "Photograph each unit when you finish and report damage or low supplies",
        ],
        [
          "Dependable arrival and finish times in tight windows",
          "Careful handling of lockbox and smart-lock codes",
          "A vehicle and your own supplies",
          "Comfort taking clear completion photos",
        ],
      ),
    ],
    questions: [
      question(
        "L1",
        "lead_field_cleaner",
        "long_text",
        true,
        "Tell us about a time you led, or worked as the lead on, a job with two or more cleaners. What did you do to make sure it finished on time and met the checklist?",
        "Lead jobs involve coordinating with a second cleaner and finishing to the same standard.",
        "Looks for a specific example, clear steps for dividing the work and checking the result, and ownership of the outcome. If the applicant has not led before, a thoughtful plan is acceptable and noted.",
      ),
      question(
        "L2",
        "lead_field_cleaner",
        "long_text",
        true,
        "At the final walkthrough you find a checklist item the helper missed, and the helper has already left. What do you do, and who do you tell?",
        "Lead Field Cleaners complete the walkthrough, so we want to understand how you handle a miss.",
        "Looks for fixing it or documenting it, telling Novara through the app, recording facts and photos, and keeping the client informed accurately. A good answer does not blame the helper.",
      ),
      question(
        "R1",
        "recurring_home_cleaner",
        "long_text",
        true,
        "Regular clients expect the same quality and the same arrival window every visit. Tell us about regular clients you have cleaned for, or, if you have not, how you would keep each home consistent from visit to visit.",
        "Recurring work depends on consistency and showing up the same way each time.",
        "Looks for specific habits such as following a checklist, noting each home's preferences, communicating in advance about changes, and arriving within the window.",
      ),
      question(
        "R2",
        "recurring_home_cleaner",
        "multi_choice_text",
        false,
        "Recurring homes are lived in. Which of these are you comfortable with? Choose all that apply, and tell us anything you would want to know before starting at a home.",
        "We match recurring homes to cleaners who are comfortable with the household.",
        "Informational. Used for matching homes, not for approving or declining. A cleaner who selects few options is still eligible for homes that fit them.",
        "Tell us anything you would want to know before starting at a home.",
        [
          "Dogs",
          "Cats",
          "Children at home",
          "Someone working from home",
          "Handling a home key or lockbox code",
          "Homes where some areas are off limits",
        ],
      ),
      question(
        "T1",
        "turnover_cleaner",
        "single_choice_text",
        false,
        "Have you cleaned short-term rentals or Airbnbs between guests?",
        "Turnovers have steps beyond a normal clean, and experience helps with training and matching.",
        "Informational. \"No, but I want to learn\" is acceptable and may be routed to a trial turnover with a Lead Field Cleaner. A specific list of steps is a good sign.",
        "About how many properties, and what did you do between guests (linens, restocking, photos, reporting damage)?",
        ["Yes, regularly", "Yes, a few times", "No, but I want to learn"],
      ),
      question(
        "T2",
        "turnover_cleaner",
        "multi_choice_text",
        false,
        "Turnovers happen between checkout and the next check-in, often late morning to mid-afternoon, including weekends and same-day. Which of these can you reliably do?",
        "Missing a check-in time causes real problems for hosts, so we match turnovers to cleaners who can reliably cover the window.",
        "Informational for matching. No answer is a knockout. Looks for a concrete method for timing, communicating early if running behind, and asking for help.",
        "What do you do to make sure you finish by the guest's check-in time when the window is tight?",
        [
          "Weekday late mornings to afternoons",
          "Weekend late mornings to afternoons",
          "Same-day turnovers with short notice",
          "Back-to-back turnovers on the same day",
        ],
      ),
    ],
  };
}

export function roleById(catalog: RoleCatalog, id: ContractorRoleId): RoleCopy | null {
  return catalog.roles.find((row) => row.id === id) || null;
}

export function questionsForRole(catalog: RoleCatalog, id: ContractorRoleId): QuestionCopy[] {
  return catalog.questions.filter((row) => row.roleId === id);
}

export function questionById(catalog: RoleCatalog, id: string): QuestionCopy | null {
  return catalog.questions.find((row) => row.id === id) || null;
}

function asStatus(value: unknown): WordingStatus {
  return value === "reviewed" ? "reviewed" : "draft";
}

function asLines(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const lines = value.map((item) => String(item).trim()).filter(Boolean);
  return lines.length ? lines : fallback;
}

function mergeRole(seed: RoleCopy, raw: unknown): RoleCopy {
  if (!raw || typeof raw !== "object") return { ...seed, whatYoullDo: [...seed.whatYoullDo], whatYoullNeed: [...seed.whatYoullNeed] };
  const row = raw as Partial<RoleCopy>;
  return {
    ...seed,
    version: Number.isFinite(Number(row.version)) ? Number(row.version) : seed.version,
    status: asStatus(row.status),
    publicEnabled: typeof row.publicEnabled === "boolean" ? row.publicEnabled : seed.publicEnabled,
    name: typeof row.name === "string" && row.name.trim() ? row.name.trim() : seed.name,
    tag: typeof row.tag === "string" && row.tag.trim() ? row.tag.trim() : seed.tag,
    shortDescription: typeof row.shortDescription === "string" && row.shortDescription.trim() ? row.shortDescription.trim() : seed.shortDescription,
    whatYoullDo: asLines(row.whatYoullDo, seed.whatYoullDo),
    whatYoullNeed: asLines(row.whatYoullNeed, seed.whatYoullNeed),
  };
}

function mergeQuestion(seed: QuestionCopy, raw: unknown): QuestionCopy {
  if (!raw || typeof raw !== "object") return { ...seed, options: [...seed.options] };
  const row = raw as Partial<QuestionCopy>;
  const options = Array.isArray(row.options) ? row.options.map((item) => String(item).trim()).filter(Boolean) : seed.options;
  return {
    ...seed,
    version: Number.isFinite(Number(row.version)) ? Number(row.version) : seed.version,
    status: asStatus(row.status),
    prompt: typeof row.prompt === "string" && row.prompt.trim() ? row.prompt.trim() : seed.prompt,
    why: typeof row.why === "string" && row.why.trim() ? row.why.trim() : seed.why,
    helper: typeof row.helper === "string" ? row.helper.trim() : seed.helper,
    reviewerGuide: typeof row.reviewerGuide === "string" && row.reviewerGuide.trim() ? row.reviewerGuide.trim() : seed.reviewerGuide,
    options: options.length ? options : [...seed.options],
  };
}

export function mergeRoleCatalog(stored: unknown): RoleCatalog {
  const seed = seedRoleCatalog();
  const raw = stored && typeof stored === "object" ? stored as { roles?: unknown; questions?: unknown } : {};
  const roles = Array.isArray(raw.roles) ? raw.roles : [];
  const questions = Array.isArray(raw.questions) ? raw.questions : [];
  return {
    roles: seed.roles.map((item) => mergeRole(item, roles.find((row) => (row as RoleCopy)?.id === item.id))),
    questions: seed.questions.map((item) => mergeQuestion(item, questions.find((row) => (row as QuestionCopy)?.id === item.id))),
  };
}

export interface DraftWordingItem {
  id: string;
  kind: "role" | "question";
  label: string;
  version: number;
  onPublicPage: boolean;
}

/** Roles and questions whose current wording is still Draft. */
export function draftWording(catalog: RoleCatalog): DraftWordingItem[] {
  const items: DraftWordingItem[] = [];
  for (const row of catalog.roles) {
    if (row.status !== "reviewed") {
      items.push({
        id: row.id,
        kind: "role",
        label: row.name,
        version: row.version,
        onPublicPage: row.publicEnabled,
      });
    }
  }
  for (const row of catalog.questions) {
    if (row.status !== "reviewed") {
      const parent = roleById(catalog, row.roleId);
      items.push({
        id: row.id,
        kind: "question",
        label: `${parent?.name || row.roleId} · ${row.id}`,
        version: row.version,
        onPublicPage: parent?.publicEnabled !== false,
      });
    }
  }
  return items;
}

function bumpRole(row: RoleCopy, patch: Partial<RoleCopy>): RoleCopy {
  return {
    ...row,
    name: patch.name?.trim() || row.name,
    tag: patch.tag?.trim() || row.tag,
    shortDescription: patch.shortDescription?.trim() || row.shortDescription,
    whatYoullDo: patch.whatYoullDo ? [...patch.whatYoullDo] : [...row.whatYoullDo],
    whatYoullNeed: patch.whatYoullNeed ? [...patch.whatYoullNeed] : [...row.whatYoullNeed],
    version: row.version + 1,
    status: "draft",
  };
}

export function editRoleCopy(
  catalog: RoleCatalog,
  id: ContractorRoleId,
  patch: Partial<Pick<RoleCopy, "name" | "tag" | "shortDescription" | "whatYoullDo" | "whatYoullNeed">>,
): RoleCatalog {
  return {
    ...catalog,
    roles: catalog.roles.map((row) => row.id === id ? bumpRole(row, patch) : row),
  };
}

export function editQuestionCopy(
  catalog: RoleCatalog,
  id: string,
  patch: Partial<Pick<QuestionCopy, "prompt" | "why" | "helper" | "reviewerGuide" | "options">>,
): RoleCatalog {
  return {
    ...catalog,
    questions: catalog.questions.map((row) => {
      if (row.id !== id) return row;
      return {
        ...row,
        prompt: patch.prompt?.trim() || row.prompt,
        why: patch.why?.trim() || row.why,
        helper: patch.helper != null ? patch.helper.trim() : row.helper,
        reviewerGuide: patch.reviewerGuide?.trim() || row.reviewerGuide,
        options: patch.options ? [...patch.options] : [...row.options],
        version: row.version + 1,
        status: "draft",
      };
    }),
  };
}

export function markCopyReviewed(catalog: RoleCatalog, id: string): RoleCatalog {
  return {
    roles: catalog.roles.map((row) => row.id === id ? { ...row, status: "reviewed" } : row),
    questions: catalog.questions.map((row) => row.id === id ? { ...row, status: "reviewed" } : row),
  };
}

/** Hides or shows a role on the public hiring page. The role stays in the catalog. */
export function setRolePublic(catalog: RoleCatalog, id: ContractorRoleId, publicEnabled: boolean): RoleCatalog {
  return {
    ...catalog,
    roles: catalog.roles.map((row) => row.id === id ? { ...row, publicEnabled } : { ...row }),
  };
}
