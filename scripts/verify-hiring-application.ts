// ─── Offline checks for the public hiring application gates ───────────────
//
// Locks the Airtable choice strings and the qualification gates: photo ID,
// work authorization, background and pay consent, address, supply list,
// reliability, and why Novara.
//
//   Run:  npm run hiring:verify

import {
  CONSENT_VERSION,
  EXPERIENCE_SOMEWHAT,
  OPEN_APPLICANT_ROLE,
  applicationMissingQualification,
  pipelineStage,
  TRANSPORTATION_CAR,
  TRANSPORTATION_NONE,
  applicantStateFromAddress,
  buildHiringConsentRecord,
  issuesForStep,
  savedApplicationNote,
  presetRoleForHiringPage,
  PAY_TRAVEL_SENTENCE,
  applicationSupplyChoices,
  validateHiringApplication,
  visibleSteps,
  type HiringApplicationDraft,
} from "../src/lib/hiring/application";
import { parseIndeedApplicant, splitPersonName, stateFromIndeedJob } from "../src/lib/hiring/indeed";
import { hiringApplyUrl, isHiringToken, sanitizeAnswers, toPublicSession } from "../src/lib/hiring/session";
import { applicationHostAllowed, contractorOnboardingUrl, hiringApplyUrl as hiringPage, onboardingHostAllowed } from "../src/lib/site-hosts";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}\n      expected: ${e}\n      actual:   ${a}`);
  }
}

const id = { name: "license.jpg", type: "image/jpeg", size: 120_000 };

function draft(overrides: Partial<HiringApplicationDraft> = {}): HiringApplicationDraft {
  return {
    role: "Field Cleaner (Contractor)",
    firstName: "Jordan",
    lastName: "Lee",
    email: "jordan@example.com",
    phone: "(301) 555-0123",
    address: "2805 Mayfield Ave",
    city: "Baltimore",
    zipCode: "21213",
    state: "Maryland",
    contractorType: "Individual",
    transportation: TRANSPORTATION_CAR,
    authorizedToWork: "Yes",
    experience: "Yes 1yr+",
    availability: "Anytime When Need",
    preferredDays: ["Fri", "Mon"],
    consent1099: true,
    backgroundCheckConsent: true,
    payConsent: true,
    age18: true,
    validDriversLicense: true,
    autoInsured: true,
    smsConsent: true,
    answersAccurate: true,
    willingToGetSupplies: "Yes",
    suppliesOnHand: "Vacuum and all-purpose cleaner",
    suppliesHonest: true,
    reliabilityNote: "I show up when I say I will",
    reasonNote: "I want steady houses near me",
    idConfirmed: true,
    idFile: id,
    hiringRole: "field-tech",
    emailConsent: true,
    hasSmartphone: "yes",
    hasVehicle: "yes",
    willHaveKit: "yes",
    understandsContractor: "yes",
    understandsVerification: "yes",
    ageAnswer: "yes",
    jobsPerWeek: 3,
    timeWindows: ["weekday_morning"],
    cleaningTypes: ["standard"],
    experienceYears: "3_to_5",
    privacyAccepted: true,
    ...overrides,
  };
}

console.log("hiring application");
check("Somewhat choice keeps Airtable's trailing space", EXPERIENCE_SOMEWHAT.length, 9);

const good = validateHiringApplication(draft());
check("valid application passes", good.ok, true);
if (good.ok) {
  check("phone stored as E.164", good.value.phone, "+13015550123");
  check("days stay in week order", good.value.preferredDays, ["Mon", "Fri"]);
  check("department is service delivery", good.value.department, "Service Delivery");
  check("the supply list is kept", good.value.suppliesOnHand, "Vacuum and all-purpose cleaner");
  const marked = validateHiringApplication(draft({ suppliesOwned: ["vacuum", "mop_bucket"], suppliesOnHand: "" }));
  check("marked vacuum and mop are kept", marked.ok && marked.value.suppliesOnHand, "Vacuum with attachments, Mop & bucket (or spray mop)");
  check("the street address is kept", good.value.address, "2805 Mayfield Ave");
  check("the city is kept", good.value.city, "Baltimore");
  check("the state is kept", good.value.state, "Maryland");
  check("reliability is kept", good.value.reliabilityNote, "I show up when I say I will");
  check("why Novara is kept", good.value.reasonNote, "I want steady houses near me");
  check("work authorization yes is kept", good.value.authorizedToWork, "Yes");
  check("background consent is kept", good.value.backgroundCheckConsent, true);
  check("pay consent is kept", good.value.payConsent, true);
  check("a photo ID keeps its file type", good.value.idContentType, "image/jpeg");
  check("kit willingness is kept", good.value.willHaveKit, true);
  check("experience value is unchanged", good.value.experience, "Yes 1yr+");
  check("consent version is stored", good.value.consentVersion, CONSENT_VERSION);
}
const company = validateHiringApplication(draft({ contractorType: "Company" }));
check("company applications stay a company", company.ok ? company.value.contractorType : company.code, "Company");

const somewhat = validateHiringApplication(draft({ experience: EXPERIENCE_SOMEWHAT, experienceYears: "" }));
check("Somewhat experience is accepted", somewhat.ok, true);
if (somewhat.ok) check("Somewhat is not trimmed", somewhat.value.experience, EXPERIENCE_SOMEWHAT);

function codeOf(overrides: Partial<HiringApplicationDraft>) {
  const result = validateHiringApplication(draft(overrides));
  return result.ok ? "ok" : result.code;
}

check("no car stops the application", codeOf({ transportation: TRANSPORTATION_NONE, validDriversLicense: false, autoInsured: false, hasVehicle: "no" }), "no_car");
check("under 18 stops the application", codeOf({ ageAnswer: "no", age18: false }), "under_18");
check("texts about the application are required", codeOf({ smsConsent: false, emailConsent: true }), "missing_sms");
check("texts are still required when email is also declined", codeOf({ smsConsent: false, emailConsent: false }), "missing_sms");
check("a no on work authorization is still a complete answer", codeOf({ authorizedToWork: "No" }), "ok");
check("work authorization has to be answered", codeOf({ authorizedToWork: "" }), "missing_authorization");
check("background consent is required to qualify", codeOf({ backgroundCheckConsent: false }), "missing_background_consent");
check("pay consent is required to qualify", codeOf({ payConsent: false }), "missing_pay_consent");
check("a missing photo ID blocks the application", codeOf({ idFile: null, idConfirmed: false }), "missing_id");
check("the street address is required", codeOf({ address: "" }), "missing_address");
check("the city is required", codeOf({ city: "" }), "missing_city");
check("an empty supply list asks for what they have", codeOf({ suppliesOnHand: "", suppliesOwned: [], suppliesHonest: false }), "missing_supplies_list");
check("an honest empty supply list is none yet", codeOf({ suppliesOnHand: "", suppliesOwned: [], suppliesHonest: true }), "ok");
check("pay terms include surge and mileage past 35 miles", /35 miles/.test(PAY_TRAVEL_SENTENCE) && /surge pay and mileage pay/.test(PAY_TRAVEL_SENTENCE), true);
const supplyChoices = applicationSupplyChoices();
check("vacuum is the first supply", supplyChoices[0]?.id, "vacuum");
check("mop is the second supply", supplyChoices[1]?.id, "mop_bucket");
check("reliability is required", codeOf({ reliabilityNote: "" }), "missing_reliability");
check("why Novara is required", codeOf({ reasonNote: "" }), "missing_reason");
check("truthfulness is acknowledged before submit", codeOf({ answersAccurate: false }), "missing_truthfulness");
check("role outside the open choices", codeOf({ role: "Field Tech" }), "invalid_role");
check("every qualification step is on the form", applicationMissingQualification(visibleSteps("Yes")), false);

const steps = visibleSteps();
check("address collects the street, city, state, and ZIP", steps.includes("address") && !steps.includes("zip") && !steps.includes("state"), true);
check("the car question comes before work authorization", steps.indexOf("car") < steps.indexOf("authorized"), true);
check("experience comes before why Novara", steps.indexOf("experience") < steps.indexOf("reason"), true);
check("photo ID is an application step", steps.includes("id"), true);
check("photo ID comes after the car question", steps.indexOf("car") < steps.indexOf("id") && steps.indexOf("id") < steps.indexOf("authorized"), true);
check("work authorization is a step", steps.includes("authorized"), true);
check("background consent is a step", steps.includes("consentBg"), true);
check("pay consent is a step", steps.includes("consentPay"), true);
check("the supply list follows a yes on supplies", visibleSteps("Yes").includes("suppliesOnHand"), true);
check("jobs per week is not a question", steps.includes("windows"), false);
check("a review result uses a stage the table allows", pipelineStage("needs_review"), "screening");
check("a waitlist uses a stage the table allows", pipelineStage("waitlist"), "hold");
check("a pass opens onboarding", pipelineStage("conditional_approval"), "onboarding");
check("leaving jobs per week blank does not block", codeOf({ jobsPerWeek: 0, timeWindows: [] }), "ok");
check("reliability is a step", steps.includes("reliability"), true);
check("why Novara is a step", steps.includes("reason"), true);
const vehicleNo = validateHiringApplication(draft({
  hasVehicle: "no",
  transportation: TRANSPORTATION_NONE,
  validDriversLicense: false,
  autoInsured: false,
}));
check("a vehicle no stops on the car question", vehicleNo.ok === false && vehicleNo.code === "no_car", true);
check("a vehicle no is not blocked for a missing photo ID", vehicleNo.ok === false && vehicleNo.code !== "missing_id", true);
const record = buildHiringConsentRecord({
  acceptedAt: "2026-10-15T12:00:00.000Z",
  ip: " 203.0.113.4 ",
  userAgent: "TestAgent",
});
check("consent record version", record.version, CONSENT_VERSION);
check("consent record keeps the ip", record.ip, "203.0.113.4");
check("consent record names the 24-month covenant", record.texts.nonSolicitation.includes("24 months"), true);
check("consent record includes STOP", record.texts.smsConsent.includes("STOP"), true);
check("consent record discloses the driving record", record.texts.backgroundDisclosure.includes("driving record"), true);
check("consent record points at a later signed authorization", record.texts.backgroundDisclosure.includes("immediately before"), true);
check("consent record says not to upload a Social Security card", record.texts.idPurpose.includes("Do not upload a Social Security card"), true);
check("consent record states company liability coverage", record.texts.insurance.includes("commercial general liability"), true);
check("saved answers drop consent checkboxes", sanitizeAnswers({ smsConsent: true, payConsent: true, authorizedToWork: "No" }).smsConsent, undefined);
check("saved answers keep a no on age", sanitizeAnswers({ age18: false }).age18, false);
check("a bad ZIP is rejected", codeOf({ zipCode: "12" }), "invalid_zip");
check("California is not a state we can qualify", codeOf({ state: "California" }), "invalid_state");
check(
  "saved note uses the role, not the Indeed title",
  savedApplicationNote("Farryl").includes("House Cleaners"),
  false,
);
check(
  "saved note names the role",
  savedApplicationNote("Farryl"),
  "Saved for Farryl · Field Cleaner, residential homes in the DMV. You can close this and come back.",
);
check("specialty pages still start on Field Cleaner", presetRoleForHiringPage("specialized-contractors"), OPEN_APPLICANT_ROLE);
check("every hiring link starts on Field Cleaner", presetRoleForHiringPage("lead-cleaner"), OPEN_APPLICANT_ROLE);
check(
  "an application without extra roles does not ask for a role confirmation",
  codeOf({ roleInterests: { additional: [], confirmed: {}, answers: {} } }),
  "ok",
);
check(
  "Field Cleaner confirmation is enough on its own",
  codeOf({ roleInterests: { additional: [], confirmed: { field_cleaner: true }, answers: {} } }),
  "ok",
);
check(
  "a selected role needs its own confirmation",
  codeOf({ roleInterests: { additional: ["turnover_cleaner"], confirmed: { field_cleaner: true }, answers: {} } }),
  "missing_role_confirmation",
);
check("Google state MD prefills Maryland", applicantStateFromAddress("MD"), "Maryland");
check("Google state name prefills Virginia", applicantStateFromAddress("Virginia"), "Virginia");
check("Google state DC prefills DC", applicantStateFromAddress("DC"), "DC");
check("Google state California does not prefill", applicantStateFromAddress("CA"), "");
check("Google state Texas does not prefill", applicantStateFromAddress("TX"), "");
check("a state we do not hire stays blank", applicantStateFromAddress("OH"), "");
check("the address step catches an empty ZIP", issuesForStep("address", draft({ zipCode: "" }))?.code, "invalid_zip");
check("state is part of the address step", visibleSteps().includes("state"), false);
const sessionRow = {
  id: "1",
  token: "a".repeat(48),
  email: "relay@indeedemail.com",
  full_name: "Ada Lovelace",
  phone: null,
  source: "indeed",
  job_title: "House Cleaners (DMV), Baltimore, MD",
  answers: { email: "relay@indeedemail.com", firstName: "Ada" },
  step_index: 0,
  status: "open",
  expires_at: "2026-12-01T00:00:00.000Z",
  submitted_at: null,
};
check("invite email is not copied into the form", toPublicSession(sessionRow).answers.email, "");
check(
  "an email the applicant typed is kept",
  toPublicSession({ ...sessionRow, answers: { email: "ada@example.com" } }).answers.email,
  "ada@example.com",
);

const indeed = parseIndeedApplicant({
  sender: "Conversation-CassaundraWoodward-5gfay@indeedemail.com",
  subject: "[Action required] New application for House Cleaners Needed, Los Angeles, CA",
  snippet: "Cassaundra Woodward applied",
  messageId: "m1",
  threadId: "t1",
  date: "2026-10-13T16:59:44Z",
});
check("indeed relay email is kept", indeed?.email, "conversation-cassaundrawoodward-5gfay@indeedemail.com");
check("indeed name is parsed", indeed?.fullName, "Cassaundra Woodward");
check("indeed message is not an application when the subject is billing", parseIndeedApplicant({
  sender: "usbilling-no_reply@indeed.com",
  subject: "Payment declined",
  snippet: "Update billing",
  messageId: "m",
  threadId: "t",
}), null);
check("split name", splitPersonName("María Perez"), { firstName: "María", lastName: "Perez" });
check(
  "Baltimore posting is Maryland",
  stateFromIndeedJob("House Cleaners Needed – Flexible Schedule (DMV), Baltimore, MD"),
  "Maryland",
);
check(
  "Lanham posting is Maryland",
  stateFromIndeedJob("House Cleaners Needed – Flexible Schedule (Maryland), Lanham, MD"),
  "Maryland",
);
check(
  "Hyattsville posting is Maryland",
  stateFromIndeedJob("House Cleaners Needed – Flexible Schedule (DMV), Hyattsville, MD"),
  "Maryland",
);
check(
  "Beaver Creek posting is Maryland",
  stateFromIndeedJob("House Cleaners Needed – Flexible Schedule (DMV), Beaver Creek, MD"),
  "Maryland",
);
check(
  "DMV posting with no other state is Maryland",
  stateFromIndeedJob("House Cleaners Needed – Flexible Schedule (DMV)"),
  "Maryland",
);
check(
  "DMV posting across 3 locations is Maryland",
  stateFromIndeedJob("House Cleaners Needed – Flexible Schedule (DMV), 3 locations"),
  "Maryland",
);
check(
  "Arlington posting stays Virginia",
  stateFromIndeedJob("House Cleaners Needed – Flexible Schedule (DMV), Arlington, VA"),
  "Virginia",
);
check(
  "Dallas posting does not prefill a state",
  stateFromIndeedJob("House Cleaners Needed – Flexible Schedule (Dallas), Dallas, TX"),
  null,
);
check(
  "Los Angeles posting does not prefill a state",
  stateFromIndeedJob("House Cleaners Needed – Flexible Schedule (LA), Los Angeles, CA"),
  null,
);
check("session token shape", isHiringToken("a".repeat(48)), true);
check("apply url uses the hiring host", hiringApplyUrl("abc"), "https://hiring.novaracleaning.com/hiring/apply/abc");
check("apply links stay on the hiring host", hiringPage("?role=field-tech"), "https://hiring.novaracleaning.com/hiring/apply?role=field-tech");
check("onboarding links stay on the contractor host", contractorOnboardingUrl("abc"), "https://contractor.novaracleaning.com/cleaner/auth?invite=abc");
check("the application api rejects the contractor host", applicationHostAllowed("contractor.novaracleaning.com"), false);
check("onboarding rejects the hiring host", onboardingHostAllowed("hiring.novaracleaning.com"), false);
check("saved answers drop the uploaded file", sanitizeAnswers({ firstName: "Ada", idFile: { name: "x" } }), { firstName: "Ada" });

if (failures > 0) {
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nall hiring application checks passed");
