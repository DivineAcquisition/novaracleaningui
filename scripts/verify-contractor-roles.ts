// Role descriptions, role questions, and independent role decisions.
//
//   Run: npm run roles:verify

import { DEFAULT_INTAKE_SETTINGS } from "../src/lib/contractor-intake/settings";
import { decideApplication, type ApplicationAnswers } from "../src/lib/contractor-intake/decide";
import {
  LEAD_CLOSED_NOTICE,
  ROLE_DESCRIPTION_CONFIRMATION,
  accessFromCatalog,
  additionalFromQuery,
  answerPrompt,
  buildRoleSections,
  contractorLanguageProblems,
  draftWording,
  editQuestionCopy,
  emptyRoleInterest,
  markCopyReviewed,
  payLine,
  publicRoleCards,
  questionsForRole,
  recordRoleDecision,
  reviewHasNoScore,
  roleOutcomeMessage,
  rolePaySettings,
  seedRoleCatalog,
  setAdditionalRole,
  setRolePublic,
  questionStaysOnTheWork,
  type RoleInterestDraft,
  type SavedRoleSection,
} from "../src/lib/contractor-roles";

let failures = 0;
function check(name: string, ok: boolean) {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}`);
  }
}

const catalog = seedRoleCatalog();
const pay = rolePaySettings(DEFAULT_INTAKE_SETTINGS);
const closed = accessFromCatalog(catalog, { leadRoleOpenToPublic: false, eligibleOrInvited: false });
const open = accessFromCatalog(catalog, { leadRoleOpenToPublic: true, eligibleOrInvited: false });
const invited = accessFromCatalog(catalog, { leadRoleOpenToPublic: false, eligibleOrInvited: true });

const names = catalog.roles.map((row) => row.name);
check("the four role names are exact", JSON.stringify(names) === JSON.stringify([
  "Field Cleaner",
  "Lead Field Cleaner",
  "Recurring Home Cleaner",
  "Turnover Cleaner",
]));
check("every role is tagged Independent Contractor", catalog.roles.every((row) => row.tag === "Independent Contractor"));
check("each new role has two questions", ["lead_field_cleaner", "recurring_home_cleaner", "turnover_cleaner"].every((id) => questionsForRole(catalog, id as "lead_field_cleaner").length === 2));
check("the read confirmation is not a question", catalog.questions.every((row) => row.prompt !== ROLE_DESCRIPTION_CONFIRMATION));
check("questions stay about the work", catalog.questions.every(questionStaysOnTheWork));
check("wording starts as draft", draftWording(catalog).length === catalog.roles.length + catalog.questions.length);

const closedCards = publicRoleCards(catalog, pay, closed);
const leadClosed = closedCards.find((card) => card.id === "lead_field_cleaner");
check("a closed lead role has no application link", leadClosed?.applyQuery == null && leadClosed?.closedNotice === LEAD_CLOSED_NOTICE);
check("the other roles still have application links", closedCards.filter((card) => card.id !== "lead_field_cleaner").every((card) => Boolean(card.applyQuery)));
const leadOpen = publicRoleCards(catalog, pay, open).find((card) => card.id === "lead_field_cleaner");
check("an open lead role can be applied for", leadOpen?.applyQuery === "lead-cleaner");
check("an invited contractor can apply when the public role is closed", additionalFromQuery("lead-cleaner", invited).join() === "lead_field_cleaner");
check("a public visitor cannot preselect a closed lead role", additionalFromQuery("lead-cleaner", closed).length === 0);

const hidden = setRolePublic(catalog, "turnover_cleaner", false);
check("hiding a role does not delete it", hidden.roles.some((row) => row.id === "turnover_cleaner"));
check("a hidden role leaves the public page", publicRoleCards(hidden, pay, open).every((card) => card.id !== "turnover_cleaner"));

check("lead pay comes from settings", payLine("lead_field_cleaner", pay) === "47% of lead jobs");
check("changing lead pay changes the line", payLine("lead_field_cleaner", { ...pay, leadPayPercent: 50 }) === "50% of lead jobs");
check("turnover pay comes from settings", payLine("turnover_cleaner", pay) === "70% of each turnover");
check("recurring pay comes from the tier settings", payLine("recurring_home_cleaner", pay) === "35–45% of each recurring home visit");

const copyBlob = catalog.roles.flatMap((row) => [row.name, row.tag, row.shortDescription, ...row.whatYoullDo, ...row.whatYoullNeed]).join("\n");
const questionBlob = catalog.questions.flatMap((row) => [row.prompt, row.why, row.helper, row.reviewerGuide, ...row.options]).join("\n");
check("role copy uses contractor language", contractorLanguageProblems(`${copyBlob}\n${questionBlob}`).length === 0);
for (const decision of ["approve", "approve_later", "decline"] as const) {
  const message = roleOutcomeMessage({ decision, roleName: "Turnover Cleaner", firstName: "Ada", note: "We can talk about a later trial." });
  check(`the ${decision} message uses contractor language`, contractorLanguageProblems(`${message.subject}\n${message.text}`).length === 0 && message.text.includes("NVC Operations") && message.text.includes("operations@novaracleaning.com"));
}

function interest(patch: Partial<RoleInterestDraft> = {}): RoleInterestDraft {
  return {
    ...emptyRoleInterest(),
    confirmed: { field_cleaner: true, recurring_home_cleaner: true, turnover_cleaner: true, lead_field_cleaner: true },
    answers: {
      L1: { choices: [], text: "I split the rooms and checked the list before we finished." },
      L2: { choices: [], text: "I fix the item, photograph it, and tell Novara in the app." },
      R1: { choices: [], text: "I follow the home checklist and note preferences." },
      R2: { choices: ["Dogs", "Cats"], text: "I would want the alarm code." },
      T1: { choices: ["No, but I want to learn"], text: "" },
      T2: { choices: ["Weekend late mornings to afternoons"], text: "I start with the beds and send a note if I am behind." },
    },
    ...patch,
  };
}

const both = buildRoleSections(
  interest({ additional: ["turnover_cleaner", "recurring_home_cleaner"] }),
  catalog,
  open,
  "2026-10-21T15:00:00.000Z",
);
check(
  "both added roles are saved with the base role",
  both.ok && ["field_cleaner", "turnover_cleaner", "recurring_home_cleaner"].every((id) => both.sections.some((row) => row.roleId === id)),
);
if (both.ok) {
  check("each section records the description version and time", both.sections.every((row) => row.descriptionVersion === 1 && row.descriptionConfirmedAt === "2026-10-21T15:00:00.000Z"));
  const turnover = both.sections.find((row) => row.roleId === "turnover_cleaner");
  check("turnover keeps T1 and T2 exactly", turnover?.answers.map((row) => row.questionId).join() === "T1,T2" && turnover.answers[0].choices[0] === "No, but I want to learn");
  check("the saved answer keeps the question version", turnover?.answers.every((row) => row.version === 1) === true);
}

const typed = interest({ additional: ["turnover_cleaner"] });
const hiddenAnswers = setAdditionalRole(typed, "turnover_cleaner", false);
check("deselecting keeps the typed answer", hiddenAnswers.answers.T2?.text.includes("beds") === true && !hiddenAnswers.additional.includes("turnover_cleaner"));
const submitted = buildRoleSections(hiddenAnswers, catalog, open, "2026-10-21T15:00:00.000Z");
check("a deselected role is left out of the submission", submitted.ok && submitted.sections.every((row) => row.roleId !== "turnover_cleaner"));

const short = buildRoleSections(
  { ...emptyRoleInterest(), additional: ["turnover_cleaner"], confirmed: { turnover_cleaner: true }, answers: {} },
  catalog,
  open,
  "2026-10-21T15:00:00.000Z",
  "add_one",
);
check("add a role contains only that role", short.ok && short.sections.length === 1 && short.sections[0].roleId === "turnover_cleaner" && short.sections[0].answers.length === 2);

const withLead = buildRoleSections(interest({ additional: ["lead_field_cleaner"] }), catalog, open, "2026-10-21T15:00:00.000Z");
const edited = editQuestionCopy(catalog, "L1", { prompt: "Tell us about the last team job you led." });
const savedLeadAnswer = withLead.ok ? withLead.sections.find((row) => row.roleId === "lead_field_cleaner")?.answers[0] : undefined;
check("a wording change creates a new version", edited.questions.find((row) => row.id === "L1")?.version === 2 && edited.questions.find((row) => row.id === "L1")?.status === "draft");
check("an older answer still shows the wording it was given", Boolean(savedLeadAnswer) && answerPrompt(savedLeadAnswer!).startsWith("Tell us about a time you led"));
const reviewed = markCopyReviewed(edited, "L1");
check("marking reviewed does not create another version", reviewed.questions.find((row) => row.id === "L1")?.version === 2 && reviewed.questions.find((row) => row.id === "L1")?.status === "reviewed");

let sections: SavedRoleSection[] = both.ok ? both.sections : [];
const declined = recordRoleDecision(sections, {
  roleId: "turnover_cleaner",
  decision: "decline",
  note: "The windows do not fit right now.",
  reviewer: "ada@novaracleaning.com",
  at: "2026-10-21T16:00:00.000Z",
  firstName: "Ada",
});
check("declining turnover leaves the other roles undecided", declined.ok && declined.sections.find((row) => row.roleId === "field_cleaner")?.decision == null && declined.sections.find((row) => row.roleId === "recurring_home_cleaner")?.decision == null);
check("the decline is recorded with the reviewer and time", declined.ok && declined.sections.find((row) => row.roleId === "turnover_cleaner")?.decision?.reviewer === "ada@novaracleaning.com");
check("the review has no score or recommendation", declined.ok && declined.sections.every(reviewHasNoScore));
if (declined.ok) sections = declined.sections;

const later = recordRoleDecision(sections, {
  roleId: "recurring_home_cleaner",
  decision: "approve_later",
  note: "A trial recurring home would show the routine.",
  reviewer: "ada@novaracleaning.com",
  at: "2026-10-21T16:05:00.000Z",
  firstName: "Ada",
});
check("approve later can route to a trial job", later.ok && later.nextStep?.kind === "trial_job");
check("approve later requires a note", recordRoleDecision(sections, { roleId: "recurring_home_cleaner", decision: "approve_later", note: " ", reviewer: "ada@novaracleaning.com", at: "2026-10-21T16:05:00.000Z" }).ok === false);
if (later.ok) sections = later.sections;

const reapproved = recordRoleDecision(
  sections.map((row) => row.roleId === "turnover_cleaner" ? { ...row, decision: null, nextStep: null } : row),
  { roleId: "turnover_cleaner", decision: "approve", note: "", reviewer: "ada@novaracleaning.com", at: "2026-10-21T16:10:00.000Z", firstName: "Ada" },
);
check("approving turnover opens its next step", reapproved.ok && reapproved.nextStep?.kind === "turnover_jobs");
check("approving turnover does not rewrite the Field Cleaner decision", reapproved.ok && reapproved.sections.find((row) => row.roleId === "field_cleaner")?.decision == null);
const recurringApproved = recordRoleDecision(
  sections.map((row) => row.roleId === "recurring_home_cleaner" ? { ...row, decision: null, nextStep: null } : row),
  { roleId: "recurring_home_cleaner", decision: "approve", note: "", reviewer: "ada@novaracleaning.com", at: "2026-10-21T16:12:00.000Z" },
);
check("approving recurring opens the recurring home addendum", recurringApproved.ok && recurringApproved.nextStep?.kind === "addendum" && recurringApproved.nextStep.wordingId === "recurring_home_addendum");

const leadSections = buildRoleSections(interest({ additional: ["lead_field_cleaner"] }), catalog, invited, "2026-10-21T15:00:00.000Z");
const leadDecision = leadSections.ok ? recordRoleDecision(leadSections.sections, {
  roleId: "lead_field_cleaner",
  decision: "approve",
  note: "",
  reviewer: "ada@novaracleaning.com",
  at: "2026-10-21T16:20:00.000Z",
}) : { ok: false as const, error: "missing" };
check("approving Lead Field Cleaner opens the addendum", leadDecision.ok && leadDecision.nextStep?.kind === "addendum" && leadDecision.nextStep.wordingId === "lead_addendum");

const base = decideApplication({
  role: "cleaner",
  email: "ada@example.com",
  phone: "+13015550123",
  name: "Ada Lovelace",
  zip: "21213",
  zipInServiceArea: true,
  daysAvailable: 3,
  age18: true,
  hasSmartphone: true,
  hasVehicle: true,
  willHaveKit: true,
  understandsContractorWork: true,
  understandsVerification: true,
  smsConsent: false,
  emailConsent: true,
  duplicate: false,
  incomplete: false,
} satisfies ApplicationAnswers, DEFAULT_INTAKE_SETTINGS);
check("role answers do not change the Field Cleaner decision", base.outcome === "pass" && base.leadTrack === false);

if (failures) {
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nrole checks passed");
