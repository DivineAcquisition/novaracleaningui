"use client";

// Public contractor application. One step at a time. A "no" on a listed
// requirement is an answer. Photo ID, work authorization, both consents,
// the street address, the supply list, reliability, and why Novara are
// required to qualify.

import { useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { RiArrowLeftLine, RiCheckLine, RiCheckboxCircleFill, RiLoader4Line } from "@remixicon/react";
import { SEO } from "@/components/SEO";
import {
  APPLICANT_STATES,
  BACKGROUND_CONSENT_COPY,
  BACKGROUND_DISCLOSURE,
  CLEANING_TYPES,
  DAY_LABEL,
  EXPERIENCE_YEARS,
  OPEN_APPLICANT_ROLE,
  PAY_CONSENT_COPY,
  PAY_RATE_SENTENCE,
  PAY_TRAVEL_SENTENCE,
  PREFERRED_DAYS,
  SUPPLY_HONESTY_COPY,
  TRUTHFULNESS_COPY,
  applicantStateFromAddress,
  applicationSupplyChoices,
  isImportantSupply,
  payTermsForRole,
  TIME_WINDOWS,
  YES_NO,
  isApplicationIssue,
  issuesForStep,
  roleLabel,
  validateHiringApplication,
  visibleSteps,
  type ApplicationStep,
  type HiringApplicationDraft,
} from "@/lib/hiring/application";
import { wordingById } from "@/lib/contractor-intake/wording";
import { DEFAULT_INTAKE_SETTINGS, type IntakeSettings } from "@/lib/contractor-intake/settings";
import { RoleInterestFields } from "@/components/hiring/RoleInterestFields";
import {
  accessFromCatalog,
  additionalFromQuery,
  emptyRoleInterest,
  parseRoleInterest,
  roleCanBeSelected,
  roleById,
  rolePaySettings,
  seedRoleCatalog,
  type RoleCatalog,
  type RoleInterestDraft,
} from "@/lib/contractor-roles";
import { AddressSuggestionMenu } from "@/components/booking/AddressSuggestionMenu";
import { useAddressAutocomplete } from "@/hooks/use-address-autocomplete";
import type { AddressSuggestion } from "@/lib/google-places-loader";
import { HIRING_HOST, HIRING_ORIGIN } from "@/lib/site-hosts";
import { StayOnHost } from "@/components/StayOnHost";
import { formatPhoneNumber } from "@/lib/input-formatters";
import { HIRING_GRADIENT } from "@/components/hiring/HiringChrome";
import type { PublicHiringSession } from "@/lib/hiring/session";
import { cn } from "@/lib/utils";

const PAGE_TITLE =
  "font-heading text-[1.65rem] font-semibold leading-snug tracking-tight text-slate-900 outline-none focus-visible:!ring-0 focus-visible:!ring-offset-0 sm:text-[1.85rem]";
const LOGO = "/novara-logo.png";
const STORAGE_KEY = "novara-contractor-application";

const REQUIREMENT_ROWS = [
  { key: "ageAnswer", title: "Are you 18 or older?", why: "This role is only open to adults. We don’t ask for your birth date." },
  { key: "hasSmartphone", title: "Do you have a smartphone that can run the Novara app and take photos?", why: "Job offers, check-in, and photos run in the Novara app on your phone." },
  { key: "hasVehicle", title: "Do you have a personal vehicle you can drive to jobs?", why: "Jobs require carrying a full supply kit between homes." },
  { key: "willHaveKit", title: "Will you have a cleaning supply kit before your first job?", why: "You supply your own products and equipment as an independent contractor." },
  { key: "understandsContractor", title: "Do you understand this is independent contractor work, and that you will provide a W-9?", why: "This is independent contractor work, not employment." },
  { key: "understandsVerification", title: "Do you understand that a pass continues only after identity, vehicle, and a background check in onboarding?", why: "This happens after a conditional approval, during onboarding." },
] as const;
const DRAFT_DAYS = 7;
const UNSAVED = ["smsConsent", "emailConsent", "backgroundCheckConsent", "payConsent", "privacyAccepted", "answersAccurate", "suppliesHonest", "idConfirmed", "authorizedToWork", "idFile"] as const;

type Answers = HiringApplicationDraft & { ageAnswer: string };

const EMPTY: Answers = {
  role: OPEN_APPLICANT_ROLE,
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  address: "",
  city: "",
  zipCode: "",
  state: "",
  contractorType: "Individual",
  transportation: "",
  authorizedToWork: "",
  experience: "",
  availability: "",
  preferredDays: [],
  consent1099: false,
  backgroundCheckConsent: false,
  payConsent: false,
  age18: false,
  validDriversLicense: false,
  autoInsured: false,
  smsConsent: false,
  answersAccurate: false,
  willingToGetSupplies: "",
  suppliesOnHand: "",
  suppliesOwned: [],
  suppliesHonest: false,
  reliabilityNote: "",
  reasonNote: "",
  idConfirmed: false,
  idFile: null,
  emailConsent: false,
  hasSmartphone: "",
  hasVehicle: "",
  willHaveKit: "",
  understandsContractor: "",
  understandsVerification: "",
  jobsPerWeek: 0,
  timeWindows: [],
  cleaningTypes: [],
  experienceYears: "",
  privacyAccepted: false,
  ageAnswer: "",
  leadRoleOpen: false,
  roleInterests: emptyRoleInterest(),
};

function why(id: string): string {
  return wordingById(id)?.body || "";
}

function hiringAccess(catalog: RoleCatalog, settings: IntakeSettings, leadOpen: boolean) {
  const access = accessFromCatalog(catalog, { leadRoleOpenToPublic: leadOpen, eligibleOrInvited: false });
  return {
    ...access,
    recurringPublic: access.recurringPublic && Boolean((settings.recurringHomeCleanerPayLabel || "").trim()),
    turnoverPublic: access.turnoverPublic && Boolean((settings.turnoverCleanerPayLabel || "").trim()),
    fieldPublic: access.fieldPublic && Boolean(settings.fieldCleanerPayLabel.trim()),
  };
}

export function ApplicantTypeform({ session }: { session?: PublicHiringSession | null }) {
  const params = useSearchParams();
  const [leadOpen, setLeadOpen] = useState(false);
  const [intakeSettings, setIntakeSettings] = useState<IntakeSettings>(DEFAULT_INTAKE_SETTINGS);
  const [catalog, setCatalog] = useState<RoleCatalog>(seedRoleCatalog);
  const [pay, setPay] = useState(rolePaySettings(DEFAULT_INTAKE_SETTINGS));
  const [answers, setAnswers] = useState<Answers>(EMPTY);
  const [stepIndex, setStepIndex] = useState(0);
  const [requirementIndex, setRequirementIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(session?.status === "submitted");
  const [result, setResult] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fax, setFax] = useState("");
  const headingId = useId();

  const steps = visibleSteps();
  const step = steps[Math.min(stepIndex, steps.length - 1)];

  useEffect(() => {
    let saved: Partial<Answers> = {};
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Partial<Answers> & { savedAt?: string };
      const savedAt = Date.parse(String(parsed.savedAt || ""));
      if (!Number.isFinite(savedAt) || Date.now() - savedAt > DRAFT_DAYS * 86_400_000) {
        localStorage.removeItem(STORAGE_KEY);
        saved = {};
      } else {
        saved = parsed;
      }
    } catch {
      saved = {};
    }
    const fromSession = session?.answers || {};
    setAnswers({
      ...EMPTY,
      ...saved,
      ...fromSession,
      role: OPEN_APPLICANT_ROLE,
      roleInterests: parseRoleInterest({
        ...emptyRoleInterest(),
        ...(saved.roleInterests || {}),
        ...(fromSession.roleInterests || {}),
      }),
      firstName: fromSession.firstName || saved.firstName || session?.firstName || "",
      lastName: fromSession.lastName || saved.lastName || session?.lastName || "",
      email: fromSession.email || saved.email || "",
      phone: fromSession.phone || saved.phone || session?.phone || "",
      idFile: null,
      leadRoleOpen: false,
      authorizedToWork: "",
      smsConsent: false,
      emailConsent: false,
      backgroundCheckConsent: false,
      payConsent: false,
      privacyAccepted: false,
      answersAccurate: false,
      suppliesHonest: false,
      idConfirmed: false,
    });
    setStepIndex(session?.stepIndex || 0);
  }, [params, session]);

  useEffect(() => {
    fetch("/api/hiring/intake")
      .then((res) => res.json())
      .then((data: { leadRoleOpenToPublic?: boolean; settings?: Partial<IntakeSettings>; catalog?: RoleCatalog; pay?: ReturnType<typeof rolePaySettings> }) => {
        const nextSettings = data.settings ? { ...DEFAULT_INTAKE_SETTINGS, ...data.settings } : DEFAULT_INTAKE_SETTINGS;
        const nextCatalog = data.catalog ? data.catalog : seedRoleCatalog();
        const open = data.leadRoleOpenToPublic === true;
        setIntakeSettings(nextSettings);
        setCatalog(nextCatalog);
        if (data.pay) setPay(data.pay);
        setLeadOpen(open);
        const access = hiringAccess(nextCatalog, nextSettings, open);
        const requested = additionalFromQuery(params.get("role"), access);
        setAnswers((current) => {
          const interests: RoleInterestDraft = current.roleInterests || emptyRoleInterest();
          const kept = (interests.additional || []).filter((id) => roleCanBeSelected(id, access));
          return {
            ...current,
            role: OPEN_APPLICANT_ROLE,
            leadRoleOpen: open,
            roleInterests: {
              ...interests,
              additional: Array.from(new Set([...kept, ...requested])),
            },
          };
        });
      })
      .catch(() => undefined);
  }, [params]);

  useEffect(() => {
    const rest = { ...answers, savedAt: new Date().toISOString() } as Record<string, unknown>;
    for (const key of UNSAVED) delete rest[key];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
    if (!session?.token || session.status === "submitted") return;
    const handle = window.setTimeout(() => {
      void fetch(`/api/hiring/session/${session.token}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: rest, stepIndex }),
      });
    }, 400);
    return () => window.clearTimeout(handle);
  }, [answers, session, stepIndex]);

  const access = useMemo(() => hiringAccess(catalog, intakeSettings, leadOpen), [catalog, intakeSettings, leadOpen]);
  const draft = useMemo(() => {
    const terms = payTermsForRole(OPEN_APPLICANT_ROLE, { ...intakeSettings, leadRoleOpenToPublic: leadOpen });
    return { ...answers, role: OPEN_APPLICANT_ROLE, leadRoleOpen: leadOpen, rolePaySet: terms.open };
  }, [answers, leadOpen, intakeSettings]);
  function goBack() {
    setError(null);
    if (step === "requirements" && requirementIndex > 0) {
      setRequirementIndex((index) => index - 1);
      return;
    }
    setStepIndex((index) => Math.max(0, index - 1));
  }

  function advance(next = draft) {
    const found = issuesForStep(step, next, { catalog, access });
    if (found) {
      setError(found.error);
      return;
    }
    setError(null);
    setStepIndex((index) => Math.min(index + 1, steps.length - 1));
  }

  async function submit() {
    const found = validateHiringApplication(draft, { catalog, access });
    if (isApplicationIssue(found)) {
      setError(found.error);
      const failing = steps.find((id) => issuesForStep(id, draft, { catalog, access }));
      if (failing) setStepIndex(steps.indexOf(failing));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body = new FormData();
      const entries: Record<string, string> = {
        role: OPEN_APPLICANT_ROLE,
        roleInterests: JSON.stringify(answers.roleInterests || emptyRoleInterest()),
        firstName: answers.firstName,
        lastName: answers.lastName,
        email: answers.email,
        phone: answers.phone,
        zipCode: answers.zipCode,
        smsConsent: String(Boolean(answers.smsConsent)),
        emailConsent: String(Boolean(answers.emailConsent)),
        age18: String(answers.ageAnswer === "yes"),
        ageAnswer: answers.ageAnswer,
        hasSmartphone: answers.hasSmartphone || "",
        hasVehicle: answers.hasVehicle || "",
        willHaveKit: answers.willHaveKit || "",
        understandsContractor: answers.understandsContractor || "",
        understandsVerification: answers.understandsVerification || "",
        jobsPerWeek: String(answers.jobsPerWeek || 0),
        preferredDays: JSON.stringify(answers.preferredDays || []),
        timeWindows: JSON.stringify(answers.timeWindows || []),
        cleaningTypes: JSON.stringify(answers.cleaningTypes || []),
        experienceYears: answers.experienceYears || "",
        privacyAccepted: String(Boolean(answers.privacyAccepted)),
        answersAccurate: String(Boolean(answers.answersAccurate)),
        leadRoleOpen: String(leadOpen),
        address: answers.address,
        city: answers.city,
        state: answers.state,
        authorizedToWork: answers.authorizedToWork,
        backgroundCheckConsent: String(Boolean(answers.backgroundCheckConsent)),
        payConsent: String(Boolean(answers.payConsent)),
        idConfirmed: String(Boolean(answers.idConfirmed)),
        suppliesOnHand: answers.suppliesOnHand,
        suppliesOwned: JSON.stringify(answers.suppliesOwned || []),
        suppliesHonest: String(Boolean(answers.suppliesHonest)),
        reliabilityNote: answers.reliabilityNote,
        reasonNote: answers.reasonNote,
        faxNumber: fax,
      };
      Object.entries(entries).forEach(([key, value]) => body.set(key, value));
      if (session?.token) body.set("sessionToken", session.token);
      const res = await fetch("/api/hiring/apply", { method: "POST", body });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        setError(data.error || "Could not submit your application.");
        return;
      }
      localStorage.removeItem(STORAGE_KEY);
      setResult(data.message || "We received your application.");
      setDone(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function continueForm() {
    if (step === "requirements") {
      const row = REQUIREMENT_ROWS[requirementIndex];
      const value = String(draft[row.key] || "");
      if (value !== "yes" && value !== "no") {
        setError("Choose yes or no.");
        return;
      }
      if (requirementIndex < REQUIREMENT_ROWS.length - 1) {
        setError(null);
        setRequirementIndex((index) => index + 1);
        return;
      }
    }
    if (step === "review") void submit();
    else advance();
  }

  const showBack = stepIndex > 0 || (step === "requirements" && requirementIndex > 0);

  return (
    <div
      className="flex min-h-dvh flex-col text-slate-900"
      style={{
        background:
          "radial-gradient(80% 46% at 50% -12%, rgba(143,123,253,0.22), transparent 58%), linear-gradient(180deg, #FFFFFF 0%, #F7F5FC 100%)",
      }}
    >
      <StayOnHost host={HIRING_HOST} origin={HIRING_ORIGIN} />
      <SEO
        title="Apply"
        description="Apply to clean with Novara. Search your address, then answer one question at a time."
        canonical="https://hiring.novaracleaning.com/hiring/apply"
      />
      <style>{`
        @keyframes nvQIn { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
        .nv-q { animation: nvQIn .45s cubic-bezier(.22,1,.36,1) both; }
        @media (prefers-reduced-motion: reduce) { .nv-q { animation: none; } }
      `}</style>
      <div className="h-1 w-full bg-slate-200/80">
        <div className="h-full transition-[width] duration-500 ease-out" style={{ width: `${Math.round(((stepIndex + 1) / steps.length) * 100)}%`, background: HIRING_GRADIENT }} />
      </div>
      <header className="mx-auto flex w-full max-w-2xl items-center justify-between px-5 py-4 sm:px-6">
        <Link href={`${HIRING_ORIGIN}/hiring`} className="flex items-center gap-2.5 transition hover:opacity-80">
          <img src={LOGO} alt="" className="h-8 w-8 rounded-lg" />
          <span className="font-heading text-[15px] font-bold tracking-tight">Novara<span className="text-primary">Cleaning</span></span>
        </Link>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{done ? "Done" : `${stepIndex + 1} of ${steps.length}`}</p>
      </header>
      <main className="flex flex-1 flex-col">
        <div className="m-auto w-full max-w-2xl px-5 py-6 sm:px-6 sm:py-10">
          {done ? (
            <div className="py-10 text-center">
              <RiCheckboxCircleFill className="mx-auto h-14 w-14 text-emerald-500" aria-hidden />
              <h1 className="mt-5 font-heading text-2xl font-semibold tracking-tight sm:text-3xl">Application received</h1>
              <p className="mx-auto mt-4 max-w-md text-base leading-relaxed text-slate-600">{result}</p>
            </div>
          ) : (
            <form
              className="nv-q"
              key={`${step}-${requirementIndex}`}
              onSubmit={(event) => {
                event.preventDefault();
                continueForm();
              }}
            >
              {showBack && (
                <button type="button" onClick={goBack} className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition hover:text-slate-800">
                  <RiArrowLeftLine className="h-4 w-4" aria-hidden />
                  Back
                </button>
              )}
              <Step
                step={step}
                stepNumber={stepIndex + 1}
                requirementIndex={requirementIndex}
                answers={draft}
                headingId={headingId}
                leadOpen={leadOpen}
                catalog={catalog}
                access={access}
                pay={pay}
                error={error}
                submitting={submitting}
                intakeSettings={intakeSettings}
                onChange={(partial) => {
                  setError(null);
                  setAnswers((current) => ({ ...current, ...partial }));
                }}
              />
              {error && <p role="alert" className="mt-4 text-sm font-medium text-red-700">{error}</p>}
              <div className="mt-6 flex flex-wrap items-center gap-4">
                <button type="submit" disabled={submitting} className="inline-flex h-11 items-center gap-2 rounded-xl px-5 text-sm font-semibold text-white disabled:opacity-60" style={{ background: "#5C0FFE" }}>
                  {submitting ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : step === "review" ? "Submit" : "OK"}
                  {!submitting && <span className="text-white/70">↵</span>}
                </button>
                <button type="button" onClick={() => { localStorage.removeItem(STORAGE_KEY); setAnswers({ ...EMPTY, leadRoleOpen: leadOpen }); setStepIndex(0); setRequirementIndex(0); setError(null); }} className="text-sm font-semibold text-slate-500 underline-offset-4 hover:text-slate-800 hover:underline">
                  Start over
                </button>
              </div>
            </form>
          )}
        </div>
      </main>
      <input tabIndex={-1} autoComplete="off" aria-hidden className="hidden" value={fax} onChange={(event) => setFax(event.target.value)} name="faxNumber" />
    </div>
  );
}

function Step({
  step, stepNumber, requirementIndex, answers, headingId, leadOpen, catalog, access, pay, error: _error, submitting: _submitting, onChange, intakeSettings,
}: {
  step: ApplicationStep;
  stepNumber: number;
  requirementIndex: number;
  answers: Answers;
  headingId: string;
  leadOpen: boolean;
  catalog: RoleCatalog;
  access: ReturnType<typeof accessFromCatalog>;
  pay: ReturnType<typeof rolePaySettings>;
  error: string | null;
  submitting: boolean;
  onChange: (partial: Partial<Answers>) => void;
  intakeSettings: IntakeSettings;
}) {
  void _error;
  void _submitting;
  void leadOpen;
  if (step === "role") {
    return (
      <section aria-labelledby={headingId}>
        <Kicker n={String(stepNumber)} />
        <h1 id={headingId} tabIndex={-1} className={PAGE_TITLE}>You are applying as a Field Cleaner</h1>
        <p className="mt-3 text-base text-slate-700">Field Cleaner is the base role. Other roles are optional, and declining one never changes the others.</p>
        <div className="mt-6">
          <RoleInterestFields
            mode="application"
            interests={answers.roleInterests || emptyRoleInterest()}
            access={access}
            catalog={catalog}
            pay={pay}
            onChange={(roleInterests) => onChange({ roleInterests, role: OPEN_APPLICANT_ROLE })}
          />
        </div>
      </section>
    );
  }
  if (step === "name") {
    return (
      <section aria-labelledby={headingId}>
        <Kicker n={String(stepNumber)} />
        <h1 id={headingId} tabIndex={-1} className={PAGE_TITLE}>What’s your name?</h1>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Field label="First name" autoComplete="given-name" value={answers.firstName} onChange={(firstName) => onChange({ firstName })} />
          <Field label="Last name" autoComplete="family-name" value={answers.lastName} onChange={(lastName) => onChange({ lastName })} />
        </div>
      </section>
    );
  }
  if (step === "email") {
    return (
      <section aria-labelledby={headingId}>
        <Kicker n={String(stepNumber)} />
        <h1 id={headingId} tabIndex={-1} className={PAGE_TITLE}>What’s your email?</h1>
        <Field label="Email" type="email" autoComplete="email" value={answers.email} onChange={(email) => onChange({ email })} />
      </section>
    );
  }
  if (step === "phone") {
    return (
      <section aria-labelledby={headingId}>
        <Kicker n={String(stepNumber)} />
        <h1 id={headingId} tabIndex={-1} className={PAGE_TITLE}>What’s your mobile number?</h1>
        <Field label="Mobile number" type="tel" autoComplete="tel" value={answers.phone} onChange={(phone) => onChange({ phone: formatPhoneNumber(phone) })} />
        <Check label={why("application_sms")} checked={Boolean(answers.smsConsent)} onChange={(smsConsent) => onChange({ smsConsent })} />
      </section>
    );
  }
  if (step === "comms") {
    return (
      <section aria-labelledby={headingId}>
        <Kicker n={String(stepNumber)} />
        <h1 id={headingId} tabIndex={-1} className={PAGE_TITLE}>How can we reach you?</h1>
        <p className="mt-3 text-base text-slate-700">Texts are optional. If you decline texts, email is required so we have one way to reach you.</p>
        <Check label={why("application_email")} checked={Boolean(answers.emailConsent)} onChange={(emailConsent) => onChange({ emailConsent })} />
      </section>
    );
  }
  if (step === "address") {
    return (
      <section aria-labelledby={headingId}>
        <Kicker n={String(stepNumber)} />
        <h1 id={headingId} tabIndex={-1} className={PAGE_TITLE}>Where do you live?</h1>
        <p className="mt-3 max-w-xl text-base leading-relaxed text-slate-500">Search once. City, ZIP, and state fill in. We hire in Maryland, Virginia, DC, and New York.</p>
        <div className="mt-8 space-y-4">
          <AddressSearchField onResolved={onChange} />
          {answers.address && (
            <p className="text-sm text-slate-600">
              Found · <span className="font-medium text-slate-900">{answers.address}</span>
            </p>
          )}
          <Field label="City" autoComplete="address-level2" value={answers.city} onChange={(city) => onChange({ city })} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="ZIP code" inputMode="numeric" autoComplete="postal-code" value={answers.zipCode} onChange={(zipCode) => onChange({ zipCode: zipCode.replace(/\D/g, "").slice(0, 5) })} />
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">State</span>
              <select
                value={answers.state}
                onChange={(event) => onChange({ state: event.target.value })}
                className="h-14 w-full rounded-2xl border border-slate-200 bg-white px-4 text-lg text-slate-900 outline-none transition focus:border-[#5C0FFE] focus:ring-4 focus:ring-[#5C0FFE]/10"
              >
                <option value="">Select a state</option>
                {APPLICANT_STATES.map((state) => (
                  <option key={state.value} value={state.value}>{state.label}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </section>
    );
  }
  if (step === "days") {
    return (
      <section aria-labelledby={headingId}>
        <h1 id={headingId} className="font-heading text-3xl font-semibold">Which days can you take jobs?</h1>
        <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PREFERRED_DAYS.map((day) => {
            const on = (answers.preferredDays || []).includes(day);
            return (
              <button key={day} type="button" aria-pressed={on} onClick={() => onChange({ preferredDays: on ? answers.preferredDays.filter((item) => item !== day) : [...(answers.preferredDays || []), day] })} className={cn("rounded-2xl border px-3 py-4 text-left", on ? "border-violet-700 bg-violet-50" : "border-slate-300 bg-white")}>
                <span className="block text-sm font-semibold">{DAY_LABEL[day]}</span>
              </button>
            );
          })}
        </div>
      </section>
    );
  }
  if (step === "windows") {
    return (
      <section aria-labelledby={headingId}>
        <h1 id={headingId} className="font-heading text-3xl font-semibold">When can you take jobs?</h1>
        <div className="mt-6 space-y-2">
          {TIME_WINDOWS.map((window) => {
            const on = (answers.timeWindows || []).includes(window.value);
            return (
              <button key={window.value} type="button" aria-pressed={on} onClick={() => onChange({ timeWindows: on ? (answers.timeWindows || []).filter((item) => item !== window.value) : [...(answers.timeWindows || []), window.value] })} className={cn("block w-full rounded-2xl border px-4 py-3 text-left font-semibold", on ? "border-violet-700 bg-violet-50" : "border-slate-300")}>
                {window.label}
              </button>
            );
          })}
        </div>
        <Field label="Jobs per week you want" inputMode="numeric" value={answers.jobsPerWeek ? String(answers.jobsPerWeek) : ""} onChange={(value) => onChange({ jobsPerWeek: Number(value.replace(/\D/g, "").slice(0, 2) || 0) })} />
      </section>
    );
  }
  if (step === "requirements") {
    const row = REQUIREMENT_ROWS[Math.min(requirementIndex, REQUIREMENT_ROWS.length - 1)];
    return (
      <section aria-labelledby={headingId}>
        <Kicker n={String(stepNumber)} />
        <h1 id={headingId} tabIndex={-1} className={PAGE_TITLE}>{row.title}</h1>
        <p className="mt-3 max-w-xl text-base leading-relaxed text-slate-500">{row.why}</p>
        <Choice
          name={row.key}
          value={String(answers[row.key] || "")}
          options={YES_NO.map((item) => ({ value: item.value, label: item.label }))}
          onPick={(value) => onChange({ [row.key]: value, ...(row.key === "ageAnswer" ? { age18: value === "yes" } : {}) })}
        />
      </section>
    );
  }
  if (step === "authorized") {
    return (
      <section aria-labelledby={headingId}>
        <h1 id={headingId} className="font-heading text-3xl font-semibold">Are you legally authorized to work in the United States?</h1>
        <p className="mt-3 text-base text-slate-700">Why we ask: We ask everyone the same question so we can follow the law. This is not an employment form and we do not ask for documents here.</p>
        <Choice name="authorizedToWork" value={answers.authorizedToWork} options={[{ value: "Yes", label: "Yes" }, { value: "No", label: "No" }]} onPick={(authorizedToWork) => onChange({ authorizedToWork })} />
      </section>
    );
  }
  if (step === "consentBg") {
    return (
      <section aria-labelledby={headingId}>
        <h1 id={headingId} className="font-heading text-3xl font-semibold">Background-check disclosure</h1>
        <p className="mt-3 text-base leading-relaxed text-slate-700">{BACKGROUND_DISCLOSURE}</p>
        <Check label={BACKGROUND_CONSENT_COPY} checked={Boolean(answers.backgroundCheckConsent)} onChange={(backgroundCheckConsent) => onChange({ backgroundCheckConsent })} />
      </section>
    );
  }
  if (step === "consentPay") {
    return (
      <section aria-labelledby={headingId}>
        <h1 id={headingId} className="font-heading text-3xl font-semibold">Pay terms</h1>
        {(() => {
          const terms = payTermsForRole(answers.role, { ...intakeSettings, leadRoleOpenToPublic: leadOpen });
          return (
            <>
              <p className="mt-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{terms.roleName}</p>
              <p className="mt-2 text-base text-slate-800">{terms.rateLine || "A pay rate is not set for this role."}</p>
              <p className="mt-2 text-base text-slate-700">{PAY_RATE_SENTENCE}</p>
              <p className="mt-2 text-base text-slate-700">{PAY_TRAVEL_SENTENCE}</p>
            </>
          );
        })()}
        <Check label={PAY_CONSENT_COPY} checked={Boolean(answers.payConsent)} onChange={(payConsent) => onChange({ payConsent })} />
      </section>
    );
  }
  if (step === "suppliesOnHand") {
    const choices = applicationSupplyChoices();
    const owned = answers.suppliesOwned || [];
    return (
      <section aria-labelledby={headingId}>
        <h1 id={headingId} className="font-heading text-3xl font-semibold">Which supplies do you already have?</h1>
        <p className="mt-3 text-base text-slate-700">Answer honestly. Every job requires you to show up prepared with the proper equipment. Mark only what you already have. Vacuum and mop are important.</p>
        <div className="mt-6 space-y-2">
          {choices.map((item) => {
            const on = owned.includes(item.id);
            return (
              <button key={item.id} type="button" aria-pressed={on} onClick={() => {
                const next = on ? owned.filter((id) => id !== item.id) : [...owned, item.id];
                const labels = choices.filter((choice) => next.includes(choice.id)).map((choice) => choice.label);
                onChange({ suppliesOwned: next, suppliesOnHand: labels.join(", ") || "none yet" });
              }} className={cn("block w-full rounded-2xl border px-4 py-3 text-left", on ? "border-violet-700 bg-violet-50" : "border-slate-300")}>
                <span className="block font-semibold">{item.label}</span>
                {isImportantSupply(item.id) && <span className="mt-0.5 block text-sm text-slate-600">Important. Jobs need this.</span>}
              </button>
            );
          })}
        </div>
        <Check label={SUPPLY_HONESTY_COPY} checked={Boolean(answers.suppliesHonest)} onChange={(suppliesHonest) => onChange({ suppliesHonest })} />
      </section>
    );
  }
  if (step === "reliability") {
    return (
      <section aria-labelledby={headingId}>
        <h1 id={headingId} className="font-heading text-3xl font-semibold">What should we know about your reliability?</h1>
        <p className="mt-3 text-base text-slate-700">This note is required to qualify.</p>
        <Area label="Reliability" value={answers.reliabilityNote} maxLength={1000} onChange={(reliabilityNote) => onChange({ reliabilityNote })} />
      </section>
    );
  }
  if (step === "reason") {
    return (
      <section aria-labelledby={headingId}>
        <h1 id={headingId} className="font-heading text-3xl font-semibold">Why Novara?</h1>
        <p className="mt-3 text-base text-slate-700">Tell us why you want to join. This is required to qualify.</p>
        <Area label="Why Novara" value={answers.reasonNote} maxLength={1000} onChange={(reasonNote) => onChange({ reasonNote })} />
      </section>
    );
  }
  if (step === "experience") {
    return (
      <section aria-labelledby={headingId}>
        <h1 id={headingId} className="font-heading text-3xl font-semibold">How many years have you cleaned professionally?</h1>
        <p className="mt-3 text-base text-slate-700">This is not a requirement. It is used to plan training and job matching.</p>
        <Choice name="experienceYears" value={answers.experienceYears || ""} options={EXPERIENCE_YEARS.map((row) => ({ value: row.value, label: row.label }))} onPick={(experienceYears) => onChange({ experienceYears })} />
      </section>
    );
  }
  if (step === "cleaningTypes") {
    return (
      <section aria-labelledby={headingId}>
        <h1 id={headingId} className="font-heading text-3xl font-semibold">Which kinds of cleaning have you done?</h1>
        <p className="mt-3 text-base text-slate-700">Choose all that apply. This is not a requirement.</p>
        <div className="mt-6 space-y-2">
          {CLEANING_TYPES.map((type) => {
            const on = (answers.cleaningTypes || []).includes(type.value);
            return (
              <button key={type.value} type="button" aria-pressed={on} onClick={() => onChange({ cleaningTypes: on ? (answers.cleaningTypes || []).filter((item) => item !== type.value) : [...(answers.cleaningTypes || []), type.value] })} className={cn("block w-full rounded-2xl border px-4 py-3 text-left font-semibold", on ? "border-violet-700 bg-violet-50" : "border-slate-300")}>
                {type.label}
              </button>
            );
          })}
        </div>
      </section>
    );
  }
  return (
    <section aria-labelledby={headingId}>
      <h1 id={headingId} className="font-heading text-3xl font-semibold">Review and submit</h1>
      <dl className="mt-6 divide-y divide-slate-200 rounded-2xl border border-slate-300">
        <Row label="Role" value={roleLabel(answers.role)} />
        <Row label="Also interested" value={(answers.roleInterests?.additional || []).map((id) => roleById(catalog, id)?.name || "").filter(Boolean).join(", ") || "None"} />
        <Row label="Name" value={`${answers.firstName} ${answers.lastName}`} />
        <Row label="Email" value={answers.email} />
        <Row label="Mobile" value={answers.phone} />
        <Row label="Address" value={[answers.address, answers.city, answers.state, answers.zipCode].filter(Boolean).join(", ")} />
        <Row label="Days" value={(answers.preferredDays || []).map((day) => DAY_LABEL[day as keyof typeof DAY_LABEL] || day).join(", ")} />
        <Row label="18 or older" value={answers.ageAnswer || "—"} />
        <Row label="Smartphone" value={answers.hasSmartphone || "—"} />
        <Row label="Vehicle" value={answers.hasVehicle || "—"} />
        <Row label="Supply kit" value={answers.willHaveKit || "—"} />
        <Row label="Work authorization" value={answers.authorizedToWork || "—"} />
        <Row label="Background disclosure" value={answers.backgroundCheckConsent ? "Accepted" : "—"} />
        <Row label="Pay terms" value={answers.payConsent ? "Accepted" : "—"} />
        <Row label="Supplies" value={answers.suppliesOnHand} />
        <Row label="Reliability" value={answers.reliabilityNote} />
        <Row label="Why Novara" value={answers.reasonNote} />
      </dl>
      <Check label="I have read the application privacy notice." checked={Boolean(answers.privacyAccepted)} onChange={(privacyAccepted) => onChange({ privacyAccepted })} />
      <p className="mt-3 text-sm text-slate-700">
        <a className="font-semibold underline" href="https://novaracleaning.com/privacy">Read the full privacy notice</a>
      </p>
      <details className="mt-3 rounded-2xl border border-slate-300 p-4 text-sm leading-relaxed text-slate-700">
        <summary className="cursor-pointer font-semibold">Application privacy notice</summary>
        <p className="mt-2">{why("application_privacy")}</p>
      </details>
      <Check label={TRUTHFULNESS_COPY} checked={Boolean(answers.answersAccurate)} onChange={(answersAccurate) => onChange({ answersAccurate })} />
    </section>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid gap-1 px-4 py-3 sm:grid-cols-[140px_1fr]">
      <dt className="text-sm font-semibold text-slate-600">{label}</dt>
      <dd className="text-sm text-slate-900">{value || "—"}</dd>
    </div>
  );
}

function Area({ label, value, onChange, maxLength }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="mt-6 block text-sm font-semibold text-slate-800">
      {label}
      <textarea id={id} value={value} maxLength={maxLength} rows={5} onChange={(event) => onChange(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 text-base font-normal text-slate-900" />
    </label>
  );
}

function Field({ label, value, onChange, type = "text", autoComplete, inputMode }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
  inputMode?: "numeric" | "tel" | "email" | "text";
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      <input id={id} type={type} autoComplete={autoComplete} inputMode={inputMode} value={value} onChange={(event) => onChange(event.target.value)} className="h-14 w-full rounded-2xl border border-slate-200 bg-white px-4 text-lg font-normal text-slate-900 outline-none transition placeholder:text-slate-300 focus:border-[#5C0FFE] focus:ring-4 focus:ring-[#5C0FFE]/10" />
    </label>
  );
}

function Kicker({ n }: { n: string }) {
  return (
    <p className="mb-3 inline-flex rounded-md border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-violet-700">
      {n}
    </p>
  );
}

function AddressSearchField({ onResolved }: { onResolved: (partial: Partial<Answers>) => void }) {
  const { suggestions, query, resolve, clear } = useAddressAutocomplete();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  async function pick(suggestion: AddressSuggestion) {
    setOpen(false);
    const parsed = await resolve(suggestion);
    clear();
    if (!parsed) return;
    const street = parsed.street || parsed.formattedAddress || text;
    const zipCode = String(parsed.zipCode || "").replace(/\D/g, "").slice(0, 5);
    const state = applicantStateFromAddress(parsed.state);
    setText("");
    onResolved({
      address: street,
      ...(parsed.city ? { city: parsed.city } : {}),
      ...(zipCode ? { zipCode } : {}),
      ...(state ? { state } : { state: "" }),
    });
  }

  return (
    <div className="relative">
      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">Search your address</span>
        <input
          type="text"
          value={text}
          placeholder="Start typing a street, city, or ZIP"
          autoComplete="off"
          role="combobox"
          aria-expanded={open && suggestions.length > 0}
          aria-autocomplete="list"
          onChange={(event) => {
            setText(event.target.value);
            query(event.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            if (text.trim().length >= 3) {
              query(text);
              setOpen(true);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              clear();
              return;
            }
            if (event.key !== "Enter") return;
            event.preventDefault();
            if (open && suggestions[0]) void pick(suggestions[0]);
          }}
          className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-base text-slate-900 outline-none transition placeholder:text-slate-300 focus:border-[#5C0FFE] focus:ring-4 focus:ring-[#5C0FFE]/10"
        />
      </label>
      {open && suggestions.length > 0 && (
        <AddressSuggestionMenu
          suggestions={suggestions}
          onPick={(suggestion) => {
            void pick(suggestion);
          }}
        />
      )}
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const id = useId();
  return (
    <label htmlFor={id} className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-300 bg-white p-4 text-sm leading-relaxed text-slate-800">
      <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-1 h-5 w-5" />
      <span>{label}</span>
    </label>
  );
}

function Choice({ name, value, options, onPick }: {
  name: string;
  value: string;
  options: Array<{ value: string; label: string; hint?: string; disabled?: boolean }>;
  onPick: (value: string) => void;
}) {
  return (
    <div className="mt-8 space-y-2.5" role="radiogroup" aria-label={name}>
      {options.map((option, index) => {
        const on = value === option.value && !option.disabled;
        const letter = String.fromCharCode(65 + index);
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={option.disabled}
            onClick={() => onPick(option.value)}
            className={cn(
              "flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition sm:gap-4 sm:px-4 sm:py-4",
              option.disabled
                ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"
                : on
                  ? "border-[#5C0FFE] bg-white shadow-[0_14px_30px_-20px_rgba(92,15,254,0.85)]"
                  : "border-slate-200 bg-white/80 hover:border-[#8F7BFD]/60 hover:bg-white",
            )}
          >
            <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-xs font-bold", on ? "border-[#5C0FFE] bg-[#5C0FFE] text-white" : "border-slate-200 text-slate-500")}>
              {on ? <RiCheckLine className="h-4 w-4" /> : letter}
            </span>
            <span className="min-w-0">
              <span className="block text-base font-semibold text-slate-900">{option.label}</span>
              {option.hint && <span className="mt-0.5 block text-sm text-slate-500">{option.hint}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
