"use client";

// Public contractor application. One step at a time. A "no" on a listed
// requirement is an answer. Photo ID, work authorization, both consents,
// the street address, the supply list, reliability, and why Novara are
// required to qualify.

import { useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { RiArrowLeftLine, RiCheckboxCircleFill, RiLoader4Line } from "@remixicon/react";
import { SEO } from "@/components/SEO";
import {
  APPLICANT_STATES,
  BACKGROUND_CONSENT_COPY,
  BACKGROUND_DISCLOSURE,
  CLEANING_TYPES,
  DAY_LABEL,
  EXPERIENCE_YEARS,
  ID_CONFIRM_COPY,
  ID_PURPOSE_COPY,
  OPEN_APPLICANT_ROLE,
  PAY_CONSENT_COPY,
  PREFERRED_DAYS,
  TIME_WINDOWS,
  YES_NO,
  isApplicationIssue,
  issuesForStep,
  presetRoleForHiringPage,
  roleLabel,
  validateHiringApplication,
  visibleSteps,
  type ApplicationStep,
  type HiringApplicationDraft,
} from "@/lib/hiring/application";
import { wordingById } from "@/lib/contractor-intake/wording";
import { HIRING_HOST, HIRING_ORIGIN } from "@/lib/site-hosts";
import { StayOnHost } from "@/components/StayOnHost";
import { formatPhoneNumber } from "@/lib/input-formatters";
import { HIRING_GRADIENT } from "@/components/hiring/HiringChrome";
import type { PublicHiringSession } from "@/lib/hiring/session";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "novara-contractor-application";

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
};

function why(id: string): string {
  return wordingById(id)?.body || "";
}

export function ApplicantTypeform({ session }: { session?: PublicHiringSession | null }) {
  const params = useSearchParams();
  const [leadOpen, setLeadOpen] = useState(true);
  const [answers, setAnswers] = useState<Answers>(EMPTY);
  const [stepIndex, setStepIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(session?.status === "submitted");
  const [result, setResult] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fax, setFax] = useState("");
  const [idBlob, setIdBlob] = useState<File | null>(null);
  const headingId = useId();

  const steps = visibleSteps();
  const step = steps[Math.min(stepIndex, steps.length - 1)];

  useEffect(() => {
    let saved: Partial<Answers> = {};
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Partial<Answers>;
    } catch {
      saved = {};
    }
    const fromSession = session?.answers || {};
    const requested = params.get("role");
    setAnswers({
      ...EMPTY,
      ...saved,
      ...fromSession,
      role: requested === "lead-cleaner"
        ? presetRoleForHiringPage(requested)
        : fromSession.role || saved.role || presetRoleForHiringPage(requested),
      firstName: fromSession.firstName || saved.firstName || session?.firstName || "",
      lastName: fromSession.lastName || saved.lastName || session?.lastName || "",
      email: fromSession.email || saved.email || "",
      phone: fromSession.phone || saved.phone || session?.phone || "",
      idFile: null,
      leadRoleOpen: false,
    });
    setIdBlob(null);
    setStepIndex(session?.stepIndex || 0);
  }, [params, session]);

  useEffect(() => {
    fetch("/api/hiring/intake")
      .then((res) => res.json())
      .then((data: { leadRoleOpenToPublic?: boolean }) => {
        setLeadOpen(Boolean(data.leadRoleOpenToPublic));
        setAnswers((current) => ({ ...current, leadRoleOpen: Boolean(data.leadRoleOpenToPublic) }));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const { idFile: _file, ...rest } = answers;
    void _file;
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

  const draft = useMemo(() => ({ ...answers, leadRoleOpen: leadOpen }), [answers, leadOpen]);

  function advance(next = draft) {
    const found = issuesForStep(step, next);
    if (found) {
      setError(found.error);
      return;
    }
    setError(null);
    setStepIndex((index) => Math.min(index + 1, steps.length - 1));
  }

  async function submit() {
    const found = validateHiringApplication(draft);
    if (isApplicationIssue(found)) {
      setError(found.error);
      const failing = steps.find((id) => issuesForStep(id, draft));
      if (failing) setStepIndex(steps.indexOf(failing));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body = new FormData();
      const entries: Record<string, string> = {
        role: answers.role,
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
        leadRoleOpen: String(leadOpen),
        address: answers.address,
        city: answers.city,
        state: answers.state,
        authorizedToWork: answers.authorizedToWork,
        backgroundCheckConsent: String(Boolean(answers.backgroundCheckConsent)),
        payConsent: String(Boolean(answers.payConsent)),
        idConfirmed: String(Boolean(answers.idConfirmed)),
        suppliesOnHand: answers.suppliesOnHand,
        reliabilityNote: answers.reliabilityNote,
        reasonNote: answers.reasonNote,
        faxNumber: fax,
      };
      Object.entries(entries).forEach(([key, value]) => body.set(key, value));
      if (idBlob) body.set("idFile", idBlob);
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

  return (
    <div className="flex min-h-dvh flex-col bg-white text-slate-900">
      <StayOnHost host={HIRING_HOST} origin={HIRING_ORIGIN} />
      <SEO
        title="Apply"
        description="Apply to join the Novara contractor network. Photo ID, work authorization, and a current address are required to qualify."
        canonical="https://hiring.novaracleaning.com/hiring/apply"
      />
      <div className="h-1 w-full bg-slate-200">
        <div className="h-full" style={{ width: `${Math.round(((stepIndex + 1) / steps.length) * 100)}%`, background: HIRING_GRADIENT }} />
      </div>
      <header className="mx-auto flex w-full max-w-2xl items-center justify-between px-5 py-4">
        <Link href={`${HIRING_ORIGIN}/hiring`} className="font-heading text-[15px] font-bold">Novara<span className="text-primary">Cleaning</span></Link>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{done ? "Done" : `${stepIndex + 1} of ${steps.length}`}</p>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-5 pb-28">
        {done ? (
          <div className="py-10">
            <RiCheckboxCircleFill className="h-12 w-12 text-emerald-600" aria-hidden />
            <h1 className="mt-4 font-heading text-3xl font-semibold">Application received</h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-700">{result}</p>
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (step === "review") void submit();
              else advance();
            }}
          >
            <Step
              step={step}
              answers={draft}
              headingId={headingId}
              leadOpen={leadOpen}
              error={error}
              submitting={submitting}
              onFile={(file) => {
                setIdBlob(file);
                setAnswers((current) => ({
                  ...current,
                  idFile: file ? { name: file.name, type: file.type, size: file.size } : null,
                  idConfirmed: false,
                }));
                setError(null);
              }}
              onChange={(partial) => {
                setError(null);
                setAnswers((current) => ({ ...current, ...partial }));
              }}
            />
            {error && <p role="alert" className="mt-4 text-sm font-medium text-red-700">{error}</p>}
            <div className="mt-8 flex items-center gap-4">
              {stepIndex > 0 && (
                <button type="button" onClick={() => { setError(null); setStepIndex((index) => index - 1); }} className="inline-flex h-12 items-center gap-2 rounded-full border border-slate-300 px-4 text-sm font-semibold">
                  <RiArrowLeftLine className="h-4 w-4" aria-hidden /> Back
                </button>
              )}
              <button type="submit" disabled={submitting} className="inline-flex h-12 items-center rounded-full px-6 text-sm font-semibold text-white disabled:opacity-60" style={{ background: HIRING_GRADIENT }}>
                {submitting ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : step === "review" ? "Submit application" : "Continue"}
              </button>
            </div>
          </form>
        )}
      </main>
      <footer className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 px-5 py-3 text-sm text-slate-700">
        <div className="mx-auto max-w-2xl">
          If you need an accommodation to complete this application, email <a className="font-semibold text-slate-900 underline" href="mailto:operations@novaracleaning.com">operations@novaracleaning.com</a>.
        </div>
      </footer>
      <input tabIndex={-1} autoComplete="off" aria-hidden className="hidden" value={fax} onChange={(event) => setFax(event.target.value)} name="faxNumber" />
    </div>
  );
}

function Step({
  step, answers, headingId, leadOpen, error: _error, submitting: _submitting, onChange, onFile,
}: {
  step: ApplicationStep;
  answers: Answers;
  headingId: string;
  leadOpen: boolean;
  error: string | null;
  submitting: boolean;
  onChange: (partial: Partial<Answers>) => void;
  onFile: (file: File | null) => void;
}) {
  void _error;
  void _submitting;
  if (step === "role") {
    return (
      <section aria-labelledby={headingId}>
        <h1 id={headingId} tabIndex={-1} className="font-heading text-3xl font-semibold">Which role are you applying for?</h1>
        <Choice
          name="role"
          value={answers.role}
          options={[
            { value: OPEN_APPLICANT_ROLE, label: "Cleaner", hint: "Residential jobs on the Novara network" },
            { value: "Lead Cleaner (Contractor)", label: "Lead Cleaner", hint: leadOpen ? "Lead jobs, walkthroughs, and trial jobs" : "Not open to new applicants right now", disabled: !leadOpen },
          ]}
          onPick={(role) => onChange({ role })}
        />
      </section>
    );
  }
  if (step === "name") {
    return (
      <section aria-labelledby={headingId}>
        <h1 id={headingId} className="font-heading text-3xl font-semibold">What’s your name?</h1>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Field label="First name" autoComplete="given-name" value={answers.firstName} onChange={(firstName) => onChange({ firstName })} />
          <Field label="Last name" autoComplete="family-name" value={answers.lastName} onChange={(lastName) => onChange({ lastName })} />
        </div>
      </section>
    );
  }
  if (step === "email") {
    return (
      <section aria-labelledby={headingId}>
        <h1 id={headingId} className="font-heading text-3xl font-semibold">What’s your email?</h1>
        <Field label="Email" type="email" autoComplete="email" value={answers.email} onChange={(email) => onChange({ email })} />
      </section>
    );
  }
  if (step === "phone") {
    return (
      <section aria-labelledby={headingId}>
        <h1 id={headingId} className="font-heading text-3xl font-semibold">What’s your mobile number?</h1>
        <Field label="Mobile number" type="tel" autoComplete="tel" value={answers.phone} onChange={(phone) => onChange({ phone: formatPhoneNumber(phone) })} />
        <Check label={why("application_sms")} checked={Boolean(answers.smsConsent)} onChange={(smsConsent) => onChange({ smsConsent })} />
      </section>
    );
  }
  if (step === "comms") {
    return (
      <section aria-labelledby={headingId}>
        <h1 id={headingId} className="font-heading text-3xl font-semibold">How can we reach you?</h1>
        <p className="mt-3 text-base text-slate-700">Texts are optional. If you decline texts, email is required so we have one way to reach you.</p>
        <Check label={why("application_email")} checked={Boolean(answers.emailConsent)} onChange={(emailConsent) => onChange({ emailConsent })} />
      </section>
    );
  }
  if (step === "address") {
    return (
      <section aria-labelledby={headingId}>
        <h1 id={headingId} className="font-heading text-3xl font-semibold">Where do you live?</h1>
        <p className="mt-3 text-base text-slate-700">Street, city, state, and ZIP are required to qualify. A ZIP outside the area we cover goes on a waitlist, not a rejection.</p>
        <Field label="Street address" autoComplete="address-line1" value={answers.address} onChange={(address) => onChange({ address })} />
        <Field label="City" autoComplete="address-level2" value={answers.city} onChange={(city) => onChange({ city })} />
        <p className="mt-6 text-sm font-semibold text-slate-800">State</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {APPLICANT_STATES.map((state) => {
            const on = answers.state === state.value;
            return (
              <button key={state.value} type="button" aria-pressed={on} onClick={() => onChange({ state: state.value })} className={cn("rounded-2xl border px-3 py-4 text-left text-sm font-semibold", on ? "border-violet-700 bg-violet-50" : "border-slate-300 bg-white")}>
                {state.label}
              </button>
            );
          })}
        </div>
        <Field label="ZIP code" inputMode="numeric" autoComplete="postal-code" value={answers.zipCode} onChange={(zipCode) => onChange({ zipCode: zipCode.replace(/\D/g, "").slice(0, 5) })} />
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
    const rows = [
      { key: "ageAnswer", title: "I am 18 or older.", why: why("why_age") },
      { key: "hasSmartphone", title: "I have a smartphone that can run the Novara app and take photos.", why: why("why_phone") },
      { key: "hasVehicle", title: "I have a personal vehicle I can drive to jobs with my supplies.", why: why("why_vehicle") },
      { key: "willHaveKit", title: "I have or will have a cleaning supply kit before my first job.", why: why("why_supplies") },
      { key: "understandsContractor", title: "I understand this is independent contractor work, not employment, and that I will provide a W-9.", why: why("independent_contractor") },
      { key: "understandsVerification", title: "I understand that if I pass, I will be asked to verify my identity and vehicle and to authorize a background check.", why: "This happens after a conditional approval, during onboarding." },
    ] as const;
    return (
      <section aria-labelledby={headingId}>
        <h1 id={headingId} className="font-heading text-3xl font-semibold">Requirements</h1>
        <p className="mt-3 text-base text-slate-700">Each one is shown before you answer. A no is recorded. It is not hidden.</p>
        <div className="mt-6 space-y-6">
          {rows.map((row) => (
            <fieldset key={row.key} className="rounded-2xl border border-slate-300 p-4">
              <legend className="px-1 text-base font-semibold">{row.title}</legend>
              <p className="mt-1 text-sm leading-relaxed text-slate-700">Why we ask: {row.why}</p>
              <Choice name={row.key} value={String(answers[row.key] || "")} options={YES_NO.map((item) => ({ value: item.value, label: item.label }))} onPick={(value) => onChange({ [row.key]: value, ...(row.key === "ageAnswer" ? { age18: value === "yes" } : {}) })} />
            </fieldset>
          ))}
        </div>
      </section>
    );
  }
  if (step === "authorized") {
    return (
      <section aria-labelledby={headingId}>
        <h1 id={headingId} className="font-heading text-3xl font-semibold">Are you legally authorized to work in the United States?</h1>
        <p className="mt-3 text-base text-slate-700">This is required to qualify. We do not collect immigration documents or a Social Security number.</p>
        <Choice name="authorizedToWork" value={answers.authorizedToWork} options={[{ value: "Yes", label: "Yes" }, { value: "No", label: "No" }]} onPick={(authorizedToWork) => onChange({ authorizedToWork })} />
      </section>
    );
  }
  if (step === "id") {
    return (
      <section aria-labelledby={headingId}>
        <h1 id={headingId} className="font-heading text-3xl font-semibold">Upload your government-issued photo ID</h1>
        <p className="mt-3 text-base leading-relaxed text-slate-700">{ID_PURPOSE_COPY}</p>
        <label className="mt-6 block text-sm font-semibold text-slate-800">
          Photo or PDF
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
            className="mt-1.5 block w-full text-base font-normal"
            onChange={(event) => onFile(event.target.files?.[0] || null)}
          />
        </label>
        {answers.idFile && <p className="mt-2 text-sm text-slate-700">{answers.idFile.name}</p>}
        <Check label={ID_CONFIRM_COPY} checked={Boolean(answers.idConfirmed)} onChange={(idConfirmed) => onChange({ idConfirmed })} />
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
        <p className="mt-3 text-base text-slate-700">Accepting these terms is required to qualify.</p>
        <Check label={PAY_CONSENT_COPY} checked={Boolean(answers.payConsent)} onChange={(payConsent) => onChange({ payConsent })} />
      </section>
    );
  }
  if (step === "suppliesOnHand") {
    return (
      <section aria-labelledby={headingId}>
        <h1 id={headingId} className="font-heading text-3xl font-semibold">Which supplies do you already have?</h1>
        <p className="mt-3 text-base text-slate-700">This list is required to qualify. If you’re starting from scratch, write “none yet.”</p>
        <Area label="Supply list" value={answers.suppliesOnHand} maxLength={2000} onChange={(suppliesOnHand) => onChange({ suppliesOnHand })} />
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
        <Row label="Photo ID" value={answers.idFile?.name || "—"} />
        <Row label="Background disclosure" value={answers.backgroundCheckConsent ? "Accepted" : "—"} />
        <Row label="Pay terms" value={answers.payConsent ? "Accepted" : "—"} />
        <Row label="Supplies" value={answers.suppliesOnHand} />
        <Row label="Reliability" value={answers.reliabilityNote} />
        <Row label="Why Novara" value={answers.reasonNote} />
      </dl>
      <Check label={why("application_privacy")} checked={Boolean(answers.privacyAccepted)} onChange={(privacyAccepted) => onChange({ privacyAccepted, answersAccurate: privacyAccepted })} />
      <p className="mt-3 text-sm text-slate-700">
        <a className="font-semibold underline" href="https://novaracleaning.com/privacy">Privacy notice</a>
      </p>
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
    <label htmlFor={id} className="mt-6 block text-sm font-semibold text-slate-800">
      {label}
      <input id={id} type={type} autoComplete={autoComplete} inputMode={inputMode} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1.5 h-12 w-full rounded-xl border border-slate-300 px-3 text-base font-normal text-slate-900" />
    </label>
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
    <div className="mt-6 space-y-2" role="radiogroup" aria-label={name}>
      {options.map((option) => (
        <button key={option.value} type="button" role="radio" aria-checked={value === option.value} disabled={option.disabled} onClick={() => onPick(option.value)} className={cn("block w-full rounded-2xl border px-4 py-3 text-left", option.disabled ? "cursor-not-allowed border-slate-200 text-slate-400" : value === option.value ? "border-violet-700 bg-violet-50" : "border-slate-300")}>
          <span className="block font-semibold">{option.label}</span>
          {option.hint && <span className="mt-0.5 block text-sm text-slate-600">{option.hint}</span>}
        </button>
      ))}
    </div>
  );
}
