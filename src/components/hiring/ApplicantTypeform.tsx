"use client";

// One question at a time, in the style of a Typeform, for the Airtable
// Applicants intake. Gates (no car, no work authorization, declined consent,
// unwilling to get supplies) stop the application instead of creating a row.

import { useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  RiArrowLeftLine,
  RiCheckLine,
  RiCheckboxCircleFill,
  RiLoader4Line,
} from "@remixicon/react";
import { SEO } from "@/components/SEO";
import {
  AGE_18_COPY,
  APPLICANT_ROLES,
  APPLICANT_STATES,
  AUTO_INSURED_COPY,
  AVAILABILITY_OPTIONS,
  BACKGROUND_CONSENT_COPY,
  BACKGROUND_DISCLOSURE,
  CONSENT_1099_INTRO,
  CONSENT_1099_LABEL,
  CONFIDENTIALITY_EXPECTATION,
  CONTRACTOR_TYPES,
  DAY_LABEL,
  EXPERIENCE_OPTIONS,
  ID_CONFIRM_COPY,
  ID_PURPOSE_COPY,
  INSURANCE_EXPECTATION,
  LICENSE_COPY,
  NON_SOLICIT_EXPECTATION,
  OPEN_APPLICANT_ROLE,
  PAY_CONSENT_COPY,
  PREFERRED_DAYS,
  PRIVACY_POLICY_URL,
  SMS_CONSENT_COPY,
  TRANSPORTATION_CAR,
  TRANSPORTATION_NONE,
  TRUTHFULNESS_COPY,
  applicantStateFromAddress,
  availabilityLabel,
  experienceLabel,
  gateCopy,
  hiringIntentNote,
  isApplicationIssue,
  isOpenApplicantRole,
  issuesForStep,
  presetRoleForHiringPage,
  savedApplicationNote,
  validateHiringApplication,
  roleLabel,
  visibleSteps,
  type ApplicationStep,
  type HiringApplicationDraft,
} from "@/lib/hiring/application";
import { AddressSuggestionMenu } from "@/components/booking/AddressSuggestionMenu";
import { useAddressAutocomplete } from "@/hooks/use-address-autocomplete";
import type { AddressSuggestion } from "@/lib/google-places-loader";
import { formatPhoneNumber } from "@/lib/input-formatters";
import { HIRING_GRADIENT } from "@/components/hiring/HiringChrome";
import { MagicCard } from "@/components/magicui/magic-card";
import { ShimmerButton } from "@/components/magicui/shimmer-button";
import { Checkbox } from "@/components/ui/checkbox";
import { SUPPLY_CATEGORY_LABEL, SUPPLY_ITEMS, type SupplyCategory } from "@/lib/cleaner-supplies";
import type { PublicHiringSession } from "@/lib/hiring/session";
import { cn } from "@/lib/utils";

const PAGE_TITLE =
  "font-heading text-[1.65rem] font-semibold leading-snug tracking-tight text-slate-900 outline-none focus-visible:!ring-0 focus-visible:!ring-offset-0 sm:text-[1.85rem]";

const SUPPLY_GROUPS: SupplyCategory[] = ["solutions", "tools", "safety", "optional", "commercial_equipment"];

const LOGO = "/novara-logo.png";

type Answers = {
  role: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  zipCode: string;
  state: string;
  suppliesOwned: string[];
  contractorType: string;
  transportation: string;
  authorizedToWork: string;
  experience: string;
  availability: string;
  preferredDays: string[];
  consent1099: boolean;
  backgroundCheckConsent: boolean;
  payConsent: boolean;
  age18: boolean;
  validDriversLicense: boolean;
  autoInsured: boolean;
  smsConsent: boolean;
  answersAccurate: boolean;
  willingToGetSupplies: string;
  suppliesOnHand: string;
  reliabilityNote: string;
  reasonNote: string;
  idConfirmed: boolean;
  idFile: File | null;
};

type Choice = { value: string; label: string; hint?: string; disabled?: boolean };

function toDraft(answers: Answers, hiringRole: string | null): HiringApplicationDraft {
  return {
    ...answers,
    idFile: answers.idFile
      ? { name: answers.idFile.name, type: answers.idFile.type, size: answers.idFile.size }
      : null,
    hiringRole,
  };
}

function emailForForm(saved: string | undefined, sessionEmail: string | undefined): string {
  const value = (saved || "").trim();
  const onFile = (sessionEmail || "").trim().toLowerCase();
  if (!value || (onFile && value.toLowerCase() === onFile)) return "";
  return value;
}

function blankAnswers(hiringRole: string | null, session?: PublicHiringSession | null): Answers {
  const saved = session?.answers || {};
  return {
    role: isOpenApplicantRole(saved.role) ? saved.role : presetRoleForHiringPage(hiringRole),
    firstName: saved.firstName || session?.firstName || "",
    lastName: saved.lastName || session?.lastName || "",
    email: emailForForm(saved.email, session?.email),
    phone: saved.phone || session?.phone || "",
    address: saved.address || "",
    city: saved.city || "",
    zipCode: saved.zipCode || "",
    state: saved.state || "",
    suppliesOwned: saved.suppliesOwned || [],
    contractorType: saved.contractorType || "",
    transportation: saved.transportation || "",
    authorizedToWork: saved.authorizedToWork || "",
    experience: saved.experience || "",
    availability: saved.availability || "",
    preferredDays: saved.preferredDays || [],
    consent1099: Boolean(saved.consent1099),
    backgroundCheckConsent: Boolean(saved.backgroundCheckConsent),
    payConsent: Boolean(saved.payConsent),
    age18: Boolean(saved.age18),
    validDriversLicense: Boolean(saved.validDriversLicense),
    autoInsured: Boolean(saved.autoInsured),
    smsConsent: Boolean(saved.smsConsent),
    answersAccurate: Boolean(saved.answersAccurate),
    willingToGetSupplies: saved.willingToGetSupplies || "",
    suppliesOnHand: saved.suppliesOnHand || "",
    reliabilityNote: saved.reliabilityNote || "",
    reasonNote: saved.reasonNote || "",
    idConfirmed: Boolean(saved.idConfirmed),
    idFile: null,
  };
}

export function ApplicantTypeform({ session }: { session?: PublicHiringSession | null }) {
  const params = useSearchParams();
  const hiringRole = params.get("role");
  const intent = hiringIntentNote(hiringRole);
  const [answers, setAnswers] = useState<Answers>(() => blankAnswers(hiringRole, session));
  const [stepIndex, setStepIndex] = useState(() => session?.stepIndex || 0);
  const [error, setError] = useState<string | null>(null);
  const [gate, setGate] = useState<string | null>(null);
  const [done, setDone] = useState(session?.status === "submitted");
  const [submitting, setSubmitting] = useState(false);
  const [fax, setFax] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);

  const steps = visibleSteps(answers.willingToGetSupplies);
  const index = Math.min(stepIndex, steps.length - 1);
  const step = steps[index];
  const progress = steps.length <= 1 ? 0 : index / (steps.length - 1);

  useEffect(() => {
    headingRef.current?.focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [step, gate, done]);

  const draft = useMemo(() => toDraft(answers, hiringRole), [answers, hiringRole]);

  useEffect(() => {
    if (!session?.token || session.status === "submitted") return;
    const handle = window.setTimeout(() => {
      const { idFile, ...rest } = answers;
      void idFile;
      void fetch(`/api/hiring/session/${session.token}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: rest, stepIndex }),
      });
    }, 600);
    return () => window.clearTimeout(handle);
  }, [answers, stepIndex, session?.token, session?.status]);

  function back() {
    setError(null);
    if (gate) {
      setGate(null);
      return;
    }
    setStepIndex((i) => Math.max(0, i - 1));
  }

  function advance(next: Answers) {
    setAnswers(next);
    const list = visibleSteps(next.willingToGetSupplies);
    const current = list[Math.min(stepIndex, list.length - 1)] ?? step;
    const found = issuesForStep(current, toDraft(next, hiringRole));
    if (found) {
      setError(found.gate ? null : found.error);
      setGate(found.gate ? found.code : null);
      return;
    }
    setError(null);
    setGate(null);
    const at = list.indexOf(current);
    setStepIndex(Math.min(at + 1, list.length - 1));
  }

  function patch(partial: Partial<Answers>, andAdvance = false) {
    const next = { ...answers, ...partial };
    setError(null);
    if (andAdvance) advance(next);
    else setAnswers(next);
  }

  async function submit() {
    const found = validateHiringApplication(draft);
    if (isApplicationIssue(found)) {
      setError(found.gate ? null : found.error);
      setGate(found.gate ? found.code : null);
      if (!found.gate) {
        const list = visibleSteps(answers.willingToGetSupplies);
        const failing = list.find((id) => id !== "review" && issuesForStep(id, draft));
        if (failing) setStepIndex(list.indexOf(failing));
      }
      return;
    }
    if (!answers.idFile) return;
    setSubmitting(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("role", answers.role);
      body.set("firstName", answers.firstName);
      body.set("lastName", answers.lastName);
      body.set("email", answers.email);
      body.set("phone", answers.phone);
      body.set("address", answers.address);
      body.set("city", answers.city);
      body.set("zipCode", answers.zipCode);
      body.set("state", answers.state);
      body.set("contractorType", answers.contractorType);
      body.set("transportation", answers.transportation);
      body.set("authorizedToWork", answers.authorizedToWork);
      body.set("experience", answers.experience);
      body.set("availability", answers.availability);
      body.set("preferredDays", JSON.stringify(answers.preferredDays));
      body.set("consent1099", String(answers.consent1099));
      body.set("backgroundCheckConsent", String(answers.backgroundCheckConsent));
      body.set("payConsent", String(answers.payConsent));
      body.set("age18", String(answers.age18));
      body.set("validDriversLicense", String(answers.validDriversLicense));
      body.set("autoInsured", String(answers.autoInsured));
      body.set("smsConsent", String(answers.smsConsent));
      body.set("answersAccurate", String(answers.answersAccurate));
      body.set("willingToGetSupplies", answers.willingToGetSupplies);
      body.set("suppliesOnHand", answers.suppliesOnHand);
      body.set("reliabilityNote", answers.reliabilityNote);
      body.set("reasonNote", answers.reasonNote);
      body.set("idConfirmed", String(answers.idConfirmed));
      body.set("hiringRole", hiringRole || "");
      body.set("faxNumber", fax);
      if (session?.token) body.set("sessionToken", session.token);
      body.set("idFile", answers.idFile);
      const res = await fetch("/api/hiring/apply", { method: "POST", body });
      const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string; gate?: boolean; ok?: boolean };
      if (!res.ok) {
        if (data.gate && data.code) setGate(data.code);
        else setError(data.error || "Could not submit your application.");
        return;
      }
      setDone(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="flex min-h-dvh flex-col text-slate-900"
      style={{
        background:
          "radial-gradient(80% 46% at 50% -12%, rgba(143,123,253,0.22), transparent 58%), linear-gradient(180deg, #FFFFFF 0%, #F7F5FC 100%)",
      }}
    >
      <SEO
        title="Apply"
        description="Apply to clean with Novara. One question at a time. You need to be 18 or older, with an insured car, a valid driver’s license, and a photo ID."
        canonical="https://hiring.novaracleaning.com/hiring/apply"
      />
      <style>{`
        @keyframes nvQIn { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
        .nv-q { animation: nvQIn .45s cubic-bezier(.22,1,.36,1) both; }
        @media (prefers-reduced-motion: reduce) {
          .nv-q { animation: none; }
        }
      `}</style>

      <div className="h-1 w-full bg-slate-200/80">
        <div
          className="h-full transition-[width] duration-500 ease-out"
          style={{ width: `${Math.round(progress * 100)}%`, background: HIRING_GRADIENT }}
        />
      </div>

      <header className="mx-auto flex w-full max-w-2xl items-center justify-between px-5 py-4 sm:px-6">
        <Link href="/hiring" className="flex items-center gap-2.5 transition hover:opacity-80">
          <img src={LOGO} alt="" className="h-8 w-8 rounded-lg" />
          <span className="font-heading text-[15px] font-bold tracking-tight">
            Novara<span className="text-primary">Cleaning</span>
          </span>
        </Link>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
          {done ? "Done" : gate ? "Hold" : `${index + 1} of ${steps.length}`}
        </p>
      </header>
      {session && !done && (
        <p className="mx-auto w-full max-w-2xl px-5 text-sm text-slate-500 sm:px-6">
          {session.preview
            ? "Preview link. Answers on this link are saved as you go."
            : savedApplicationNote(session.firstName)}
        </p>
      )}

      <main className="flex flex-1 flex-col">
        <div className="m-auto w-full max-w-2xl px-5 pb-20 pt-6 sm:px-6 sm:pb-24 sm:pt-10">
          {done ? (
            <Success name={answers.firstName} />
          ) : gate ? (
            <GateScreen code={gate} onBack={back} />
          ) : (
            <div key={step} className="nv-q">
              {index > 0 && (
                <button
                  type="button"
                  onClick={back}
                  className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition hover:text-slate-800"
                >
                  <RiArrowLeftLine className="h-4 w-4" />
                  Back
                </button>
              )}
              <Question
                step={step}
                index={index}
                answers={answers}
                intent={step === "role" ? intent : null}
                error={error}
                submitting={submitting}
                headingRef={headingRef}
                onPatch={patch}
                onAdvance={() => advance(answers)}
                onSubmit={submit}
                onEdit={(id) => {
                  setError(null);
                  setStepIndex(visibleSteps(answers.willingToGetSupplies).indexOf(id));
                }}
                onError={setError}
              />
            </div>
          )}
        </div>
      </main>

      <ApplyFooter />

      <input
        tabIndex={-1}
        aria-hidden
        autoComplete="off"
        value={fax}
        onChange={(e) => setFax(e.target.value)}
        className="pointer-events-none absolute left-[-9999px] h-0 w-0 opacity-0"
        name="faxNumber"
      />
    </div>
  );
}

function ApplyFooter() {
  return (
    <footer className="mt-auto border-t border-slate-200/80 px-5 py-6 text-center sm:px-6">
      <p className="text-xs leading-relaxed text-slate-500">Submitting this form is not an offer of work.</p>
      <p className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs font-medium text-slate-500">
        <span>Novara Cleaning</span>
        <a
          href={PRIVACY_POLICY_URL}
          target="_blank"
          rel="noreferrer"
          className="text-[#5C0FFE] underline-offset-2 hover:underline"
        >
          Privacy Policy
        </a>
        <a href="mailto:support@novaracleaning.com" className="text-[#5C0FFE] underline-offset-2 hover:underline">
          support@novaracleaning.com
        </a>
      </p>
    </footer>
  );
}

function Success({ name }: { name: string }) {
  return (
    <div className="nv-q py-10 text-center">
      <RiCheckboxCircleFill className="mx-auto h-14 w-14 text-emerald-500" />
      <h1 className="mt-5 font-heading text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
        Application received{name ? `, ${name}` : ""}
      </h1>
      <p className="mx-auto mt-4 max-w-md text-base leading-relaxed text-slate-600">
        Thanks for applying for Field Cleaner. We review every submission and reach out when it’s a fit.
        The other roles are opening soon.
      </p>
      <Link
        href="/hiring"
        className="mt-8 inline-flex h-12 items-center justify-center rounded-full px-6 text-sm font-semibold text-white"
        style={{ background: HIRING_GRADIENT }}
      >
        Back to careers
      </Link>
    </div>
  );
}

function GateScreen({ code, onBack }: { code: string; onBack: () => void }) {
  const copy = gateCopy(code);
  return (
    <div className="nv-q py-8">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">Not a match yet</p>
      <h1 className="mt-3 font-heading text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
        {copy.title}
      </h1>
      <p className="mt-4 max-w-lg text-base leading-relaxed text-slate-600">{copy.body}</p>
      <button
        type="button"
        onClick={onBack}
        className="mt-8 inline-flex h-12 items-center gap-2 rounded-full border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-800 transition hover:border-slate-300"
      >
        <RiArrowLeftLine className="h-4 w-4" />
        Change my answer
      </button>
    </div>
  );
}

function Question({
  step,
  index,
  answers,
  intent,
  error,
  submitting,
  headingRef,
  onPatch,
  onAdvance,
  onSubmit,
  onEdit,
  onError,
}: {
  step: ApplicationStep;
  index: number;
  answers: Answers;
  intent: string | null;
  error: string | null;
  submitting: boolean;
  headingRef: RefObject<HTMLHeadingElement>;
  onPatch: (partial: Partial<Answers>, andAdvance?: boolean) => void;
  onAdvance: () => void;
  onSubmit: () => void;
  onEdit: (step: ApplicationStep) => void;
  onError: (message: string) => void;
}) {
  const n = String(index + 1).padStart(2, "0");

  if (step === "review") {
    return (
      <div>
        <Kicker n={n} />
        <h1 ref={headingRef} tabIndex={-1} className={PAGE_TITLE}>
          Look over your application
        </h1>
        <p className="mt-3 text-base text-slate-500">Change anything before you send it.</p>
        <dl className="mt-8 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
          <ReviewRow label="Role" value={roleLabel(answers.role)} onEdit={() => onEdit("role")} />
          <ReviewRow label="Name" value={`${answers.firstName} ${answers.lastName}`.trim()} onEdit={() => onEdit("name")} />
          <ReviewRow label="Email" value={answers.email} onEdit={() => onEdit("email")} />
          <ReviewRow label="Phone" value={answers.phone} onEdit={() => onEdit("phone")} />
          <ReviewRow
            label="Address"
            value={[answers.address, answers.city, answers.zipCode, answers.state].filter(Boolean).join(", ")}
            onEdit={() => onEdit("address")}
          />
          <ReviewRow label="Applying as" value={answers.contractorType === "Individual" ? "Just me" : answers.contractorType} onEdit={() => onEdit("contractorType")} />
          <ReviewRow label="Car" value="Own car, valid license, insured" onEdit={() => onEdit("car")} />
          <ReviewRow label="Photo ID" value={answers.idFile?.name || "Uploaded"} onEdit={() => onEdit("id")} />
          <ReviewRow label="Authorized to work" value="Yes" onEdit={() => onEdit("authorized")} />
          <ReviewRow label="Age" value="18 or older" onEdit={() => onEdit("age")} />
          <ReviewRow label="Texts and calls" value="Agreed" onEdit={() => onEdit("phone")} />
          <ReviewRow label="Experience" value={experienceLabel(answers.experience)} onEdit={() => onEdit("experience")} />
          <ReviewRow label="Availability" value={availabilityLabel(answers.availability)} onEdit={() => onEdit("availability")} />
          <ReviewRow label="Days" value={answers.preferredDays.map((d) => DAY_LABEL[d as keyof typeof DAY_LABEL] || d).join(", ")} onEdit={() => onEdit("days")} />
          <ReviewRow label="1099 consent" value="Agreed" onEdit={() => onEdit("consent1099")} />
          <ReviewRow label="Background check" value="Agreed" onEdit={() => onEdit("consentBg")} />
          <ReviewRow label="Pay consent" value="Agreed" onEdit={() => onEdit("consentPay")} />
          <ReviewRow label="Willing to get supplies" value="Yes" onEdit={() => onEdit("supplies")} />
          <ReviewRow label="Supplies you have" value={answers.suppliesOnHand} onEdit={() => onEdit("suppliesOnHand")} />
          <ReviewRow label="Reliability" value={answers.reliabilityNote} onEdit={() => onEdit("reliability")} />
          <ReviewRow label="Why Novara" value={answers.reasonNote} onEdit={() => onEdit("reason")} />
        </dl>
        <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 text-base text-slate-800 shadow-sm">
          <input
            type="checkbox"
            checked={answers.answersAccurate}
            onChange={(e) => onPatch({ answersAccurate: e.target.checked })}
            className="mt-1 h-5 w-5 rounded border-slate-300 text-[#5C0FFE] focus:ring-[#8F7BFD]"
          />
          <span>{TRUTHFULNESS_COPY}</span>
        </label>
        {error && <ErrorText message={error} />}
        <div className="mt-6">
          <OkButton label={submitting ? "Submitting…" : "Submit application"} busy={submitting} onClick={onSubmit} />
        </div>
      </div>
    );
  }

  if (step === "name") {
    return (
      <TextStep
        n={n}
        title="What’s your name?"
        hint="Use the name on your ID."
        error={error}
        headingRef={headingRef}
        onOk={onAdvance}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First name" autoComplete="given-name" value={answers.firstName} onChange={(v) => onPatch({ firstName: v })} onEnter={onAdvance} />
          <Field label="Last name" autoComplete="family-name" value={answers.lastName} onChange={(v) => onPatch({ lastName: v })} onEnter={onAdvance} />
        </div>
      </TextStep>
    );
  }

  if (step === "email") {
    return (
      <TextStep n={n} title="What’s the best email to reach you?" hint="We’ll only use this to follow up on your application." error={error} headingRef={headingRef} onOk={onAdvance}>
        <Field label="Email" type="email" autoComplete="email" placeholder="you@email.com" value={answers.email} onChange={(v) => onPatch({ email: v })} onEnter={onAdvance} />
      </TextStep>
    );
  }

  if (step === "phone") {
    return (
      <TextStep n={n} title="What’s your phone number?" hint="A mobile number works best. We’ll use it for this application." error={error} headingRef={headingRef} onOk={onAdvance}>
        <Field label="Phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="(301) 555-0123" value={answers.phone} onChange={(v) => onPatch({ phone: formatPhoneNumber(v) })} onEnter={onAdvance} />
        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm leading-relaxed text-slate-800">
          <input
            type="checkbox"
            checked={answers.smsConsent}
            onChange={(e) => onPatch({ smsConsent: e.target.checked })}
            className="mt-0.5 h-5 w-5 rounded border-slate-300 text-[#5C0FFE] focus:ring-[#8F7BFD]"
          />
          <span>{SMS_CONSENT_COPY}</span>
        </label>
      </TextStep>
    );
  }

  if (step === "address") {
    return (
      <TextStep n={n} title="Where do you live?" hint="Search once. City, ZIP, and state fill in. We hire in Maryland, Virginia, DC, and New York." error={error} headingRef={headingRef} onOk={onAdvance}>
        <div className="space-y-4">
          <AddressSearchField
            onResolved={(partial) => onPatch(partial)}
          />
          {answers.address && (
            <p className="text-sm text-slate-600">
              Found · <span className="font-medium text-slate-900">{answers.address}</span>
            </p>
          )}
          <Field
            label="City"
            autoComplete="address-level2"
            placeholder="Baltimore"
            value={answers.city}
            onChange={(v) => onPatch({ city: v })}
            onEnter={onAdvance}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="ZIP code"
              autoComplete="postal-code"
              inputMode="numeric"
              placeholder="21213"
              value={answers.zipCode}
              onChange={(v) => onPatch({ zipCode: v.replace(/\D/g, "").slice(0, 5) })}
              onEnter={onAdvance}
            />
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">State</span>
              <select
                value={answers.state}
                onChange={(e) => onPatch({ state: e.target.value })}
                className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-base text-slate-900 outline-none transition focus:border-[#5C0FFE] focus:ring-4 focus:ring-[#5C0FFE]/10"
              >
                <option value="">Select a state</option>
                {APPLICANT_STATES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </TextStep>
    );
  }

  if (step === "suppliesOnHand") {
    return (
      <TextStep
        n={n}
        title="Which supplies do you already have?"
        hint="Same checklist we use in onboarding. Check what you own. Leave the rest — you’ll get those before your first job."
        error={error}
        headingRef={headingRef}
        onOk={() => onPatch({ suppliesOnHand: supplySummary(answers.suppliesOwned) }, true)}
      >
        <SupplyPicker
          owned={answers.suppliesOwned}
          onChange={(suppliesOwned) => onPatch({ suppliesOwned, suppliesOnHand: supplySummary(suppliesOwned) })}
        />
      </TextStep>
    );
  }

  if (step === "reliability") {
    return (
      <TextStep n={n} title="How would you describe your reliability?" hint="Showing up, on time, is the job. A sentence or two is plenty." error={error} headingRef={headingRef} onOk={onAdvance}>
        <Area value={answers.reliabilityNote} placeholder="I show up when I say I will…" onChange={(v) => onPatch({ reliabilityNote: v })} />
      </TextStep>
    );
  }

  if (step === "reason") {
    return (
      <TextStep n={n} title="Why do you want to join Novara?" error={error} headingRef={headingRef} onOk={onAdvance}>
        <Area value={answers.reasonNote} placeholder="I like the work, and I want a steady way to book it…" onChange={(v) => onPatch({ reasonNote: v })} />
      </TextStep>
    );
  }

  if (step === "id") {
    return (
      <IdStep
        n={n}
        answers={answers}
        error={error}
        headingRef={headingRef}
        onPatch={onPatch}
        onAdvance={onAdvance}
      />
    );
  }

  if (step === "days") {
    return (
      <div>
        <Kicker n={n} />
        <h1 ref={headingRef} tabIndex={-1} className={PAGE_TITLE}>
          Which days can you work?
        </h1>
        <p className="mt-3 text-base text-slate-500">Pick every day that’s usually open. You can change this later.</p>
        <div className="mt-8 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {PREFERRED_DAYS.map((day) => {
            const on = answers.preferredDays.includes(day);
            return (
              <button
                key={day}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const preferredDays = on
                    ? answers.preferredDays.filter((d) => d !== day)
                    : [...answers.preferredDays, day];
                  onPatch({ preferredDays });
                }}
                className={cn(
                  "rounded-2xl border px-3 py-4 text-left transition",
                  on
                    ? "border-[#5C0FFE] bg-[#5C0FFE]/8 text-slate-900 shadow-[0_10px_24px_-18px_rgba(92,15,254,0.9)]"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300",
                )}
              >
                <span className="block text-xs font-semibold uppercase tracking-wide text-slate-400">{day}</span>
                <span className="mt-1 block text-sm font-semibold">{DAY_LABEL[day]}</span>
              </button>
            );
          })}
        </div>
        {error && <ErrorText message={error} />}
        <div className="mt-6">
          <OkButton onClick={onAdvance} />
        </div>
      </div>
    );
  }

  if (step === "consent1099" || step === "consentBg" || step === "consentPay") {
    const spec = {
      consent1099: {
        title: "This is a 1099 contractor role",
        body: CONSENT_1099_INTRO,
        extra: [NON_SOLICIT_EXPECTATION, CONFIDENTIALITY_EXPECTATION, INSURANCE_EXPECTATION],
        label: CONSENT_1099_LABEL,
        checked: answers.consent1099,
        key: "consent1099" as const,
      },
      consentBg: {
        title: "Background check disclosure",
        body: BACKGROUND_DISCLOSURE,
        extra: [] as string[],
        label: BACKGROUND_CONSENT_COPY,
        checked: answers.backgroundCheckConsent,
        key: "backgroundCheckConsent" as const,
      },
      consentPay: {
        title: "Are you comfortable with how pay works?",
        body: "Everyone starts between 40% and 45% of the job’s value. Pay is weekly, for completed jobs. Travel time is not paid.",
        extra: [] as string[],
        label: PAY_CONSENT_COPY,
        checked: answers.payConsent,
        key: "payConsent" as const,
      },
    }[step];
    return (
      <div>
        <Kicker n={n} />
        <h1 ref={headingRef} tabIndex={-1} className={PAGE_TITLE}>
          {spec.title}
        </h1>
        <p className="mt-3 max-w-xl text-base leading-relaxed text-slate-500">{spec.body}</p>
        {spec.extra.length > 0 && (
          <div className="mt-4 max-w-xl space-y-3 text-base leading-relaxed text-slate-600">
            {spec.extra.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        )}
        {step === "consentPay" && <PayExample />}
        <label className="mt-8 flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 text-base text-slate-800 shadow-sm">
          <input
            type="checkbox"
            checked={spec.checked}
            onChange={(e) => onPatch({ [spec.key]: e.target.checked })}
            className="mt-1 h-5 w-5 rounded border-slate-300 text-[#5C0FFE] focus:ring-[#8F7BFD]"
          />
          <span>{spec.label}</span>
        </label>
        {error && <ErrorText message={error} />}
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <OkButton
            onClick={() => {
              if (!spec.checked) {
                onError("Check the box to continue.");
                return;
              }
              onAdvance();
            }}
          />
          <button
            type="button"
            className="text-sm font-semibold text-slate-500 underline-offset-4 hover:text-slate-800 hover:underline"
            onClick={() => onPatch({ [spec.key]: false }, true)}
          >
            I don’t agree
          </button>
        </div>
      </div>
    );
  }

  if (step === "age") {
    return (
      <div>
        <Kicker n={n} />
        <h1 ref={headingRef} tabIndex={-1} className={PAGE_TITLE}>
          Are you 18 or older?
        </h1>
        <p className="mt-3 max-w-xl text-base leading-relaxed text-slate-500">
          This role is only open to adults. We don’t ask for your birth date.
        </p>
        <label className="mt-8 flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 text-base text-slate-800 shadow-sm">
          <input
            type="checkbox"
            checked={answers.age18}
            onChange={(e) => onPatch({ age18: e.target.checked })}
            className="mt-1 h-5 w-5 rounded border-slate-300 text-[#5C0FFE] focus:ring-[#8F7BFD]"
          />
          <span>{AGE_18_COPY}</span>
        </label>
        {error && <ErrorText message={error} />}
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <OkButton
            onClick={() => {
              if (!answers.age18) {
                onError("Check the box to continue.");
                return;
              }
              onAdvance();
            }}
          />
          <button
            type="button"
            className="text-sm font-semibold text-slate-500 underline-offset-4 hover:text-slate-800 hover:underline"
            onClick={() => onPatch({ age18: false }, true)}
          >
            I am under 18
          </button>
        </div>
      </div>
    );
  }

  if (step === "car") {
    return (
      <div>
        <Kicker n={n} />
        <h1 ref={headingRef} tabIndex={-1} className={PAGE_TITLE}>
          Do you have a car you can drive to jobs?
        </h1>
        <p className="mt-3 max-w-xl text-base leading-relaxed text-slate-500">
          A car is the only transportation we accept. You need a valid driver’s license, and the car has to be insured. Rideshare doesn’t count.
        </p>
        <ChoiceList
          choices={choicesFor("car")}
          selected={answers.transportation}
          onPick={(value) => {
            if (value !== TRANSPORTATION_CAR) {
              onPatch({ transportation: value, validDriversLicense: false, autoInsured: false }, true);
              return;
            }
            onPatch({ transportation: value });
          }}
        />
        {answers.transportation === TRANSPORTATION_CAR && (
          <div className="mt-4 space-y-3">
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 text-base text-slate-800 shadow-sm">
              <input
                type="checkbox"
                checked={answers.validDriversLicense}
                onChange={(e) => onPatch({ validDriversLicense: e.target.checked })}
                className="mt-1 h-5 w-5 rounded border-slate-300 text-[#5C0FFE] focus:ring-[#8F7BFD]"
              />
              <span>{LICENSE_COPY}</span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 text-base text-slate-800 shadow-sm">
              <input
                type="checkbox"
                checked={answers.autoInsured}
                onChange={(e) => onPatch({ autoInsured: e.target.checked })}
                className="mt-1 h-5 w-5 rounded border-slate-300 text-[#5C0FFE] focus:ring-[#8F7BFD]"
              />
              <span>{AUTO_INSURED_COPY}</span>
            </label>
          </div>
        )}
        {error && <ErrorText message={error} />}
        {answers.transportation === TRANSPORTATION_CAR && (
          <div className="mt-6 flex flex-col items-start gap-3">
            <OkButton
              onClick={() => {
                if (!answers.validDriversLicense || !answers.autoInsured) {
                  onError("Check both boxes to continue.");
                  return;
                }
                onAdvance();
              }}
            />
            <button
              type="button"
              className="text-sm font-semibold text-slate-500 underline-offset-4 hover:text-slate-800 hover:underline"
              onClick={() => onPatch({ transportation: TRANSPORTATION_CAR, validDriversLicense: false }, true)}
            >
              I don’t have a valid driver’s license
            </button>
            <button
              type="button"
              className="text-sm font-semibold text-slate-500 underline-offset-4 hover:text-slate-800 hover:underline"
              onClick={() => onPatch({ transportation: TRANSPORTATION_CAR, validDriversLicense: true, autoInsured: false }, true)}
            >
              My car isn’t insured
            </button>
          </div>
        )}
      </div>
    );
  }

  const choices = choicesFor(step);
  const selected = selectedValue(step, answers);
  return (
    <div>
      <Kicker n={n} />
      <h1 ref={headingRef} tabIndex={-1} className={PAGE_TITLE}>
        {titleFor(step)}
      </h1>
      {(hintFor(step) || intent) && (
        <p className="mt-3 max-w-xl text-base leading-relaxed text-slate-500">{intent || hintFor(step)}</p>
      )}
      {step === "supplies" && <ChecklistLink />}
      <ChoiceList
        choices={choices}
        selected={selected}
        onPick={(value) => onPatch(patchFor(step, value), true)}
      />
      {error && <ErrorText message={error} />}
      {selected && (
        <div className="mt-6">
          <OkButton onClick={() => onPatch(patchFor(step, selected), true)} />
        </div>
      )}
    </div>
  );
}

function choicesFor(step: ApplicationStep): Choice[] {
  switch (step) {
    case "role":
      return APPLICANT_ROLES.map((r) => ({
        value: r.value,
        label: r.label,
        hint: r.value === OPEN_APPLICANT_ROLE ? r.hint : "Opening soon",
        disabled: r.value !== OPEN_APPLICANT_ROLE,
      }));
    case "state":
      return APPLICANT_STATES.map((s) => ({ value: s.value, label: s.label }));
    case "contractorType":
      return CONTRACTOR_TYPES.map((t) => ({ value: t.value, label: t.label, hint: t.hint }));
    case "car":
      return [
        { value: TRANSPORTATION_CAR, label: "Yes — I have my own car", hint: "I can drive myself to every job" },
        { value: TRANSPORTATION_NONE, label: "No, I don’t have a car", hint: "Rideshare, transit, or no vehicle" },
      ];
    case "authorized":
      return [
        { value: "Yes", label: "Yes" },
        { value: "No", label: "No" },
      ];
    case "experience":
      return EXPERIENCE_OPTIONS.map((o) => ({ value: o.value, label: o.label }));
    case "availability":
      return AVAILABILITY_OPTIONS.map((o) => ({ value: o.value, label: o.label }));
    case "supplies":
      return [
        { value: "Yes", label: "Yes — I’ll get what a job needs", hint: "Including anything I don’t own yet" },
        { value: "No", label: "No", hint: "I’m not able to get supplies" },
      ];
    default:
      return [];
  }
}

function titleFor(step: ApplicationStep): string {
  switch (step) {
    case "role":
      return "Which role are you applying for?";
    case "state":
      return "Which state do you live in?";
    case "contractorType":
      return "Are you applying as yourself or as a company?";
    case "car":
      return "Do you have a car you can drive to jobs?";
    case "authorized":
      return "Are you legally authorized to work in the U.S.?";
    case "experience":
      return "How much professional cleaning experience do you have?";
    case "availability":
      return "What’s your availability?";
    case "supplies":
      return "Are you willing to get the supplies a job needs?";
    default:
      return "";
  }
}

function hintFor(step: ApplicationStep): string | null {
  switch (step) {
    case "car":
      return "A car is the only transportation we accept. You need to drive yourself — rideshare doesn’t count.";
    case "supplies":
      return "Contractors bring their own supplies. You have to be willing to get whatever you don’t already own.";
    case "role":
      return "Field Cleaner is open now. The other roles are opening soon.";
    case "state":
      return "We hire in Maryland, Virginia, DC, and New York.";
    default:
      return null;
  }
}

function selectedValue(step: ApplicationStep, answers: Answers): string {
  switch (step) {
    case "role":
      return answers.role;
    case "state":
      return answers.state;
    case "contractorType":
      return answers.contractorType;
    case "car":
      return answers.transportation;
    case "authorized":
      return answers.authorizedToWork;
    case "experience":
      return answers.experience;
    case "availability":
      return answers.availability;
    case "supplies":
      return answers.willingToGetSupplies;
    default:
      return "";
  }
}

function patchFor(step: ApplicationStep, value: string): Partial<Answers> {
  switch (step) {
    case "role":
      return { role: value };
    case "state":
      return { state: value };
    case "contractorType":
      return { contractorType: value };
    case "car":
      return { transportation: value };
    case "authorized":
      return { authorizedToWork: value };
    case "experience":
      return { experience: value };
    case "availability":
      return { availability: value };
    case "supplies":
      return { willingToGetSupplies: value };
    default:
      return {};
  }
}

function ChoiceList({
  choices,
  selected,
  onPick,
  compact = false,
}: {
  choices: Choice[];
  selected: string;
  onPick: (value: string) => void;
  compact?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.key === "Enter" && selected && !choices.find((c) => c.value === selected)?.disabled) {
        e.preventDefault();
        onPick(selected);
        return;
      }
      const idx = "abcdefghijklmnopqrstuvwxyz".indexOf(e.key.toLowerCase());
      if (idx < 0 || idx >= choices.length || choices[idx].disabled) return;
      e.preventDefault();
      onPick(choices[idx].value);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [choices, onPick, selected]);

  return (
    <div className={cn(compact ? "space-y-2" : "mt-8 space-y-2.5")}>
      {choices.map((choice, i) => {
        const on = selected === choice.value && !choice.disabled;
        const letter = String.fromCharCode(65 + i);
        return (
          <button
            key={choice.value}
            type="button"
            aria-pressed={on}
            aria-disabled={choice.disabled || undefined}
            disabled={choice.disabled}
            onClick={() => {
              if (!choice.disabled) onPick(choice.value);
            }}
            className={cn(
              "flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition sm:gap-4 sm:px-4 sm:py-4",
              choice.disabled
                ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"
                : on
                  ? "border-[#5C0FFE] bg-white shadow-[0_14px_30px_-20px_rgba(92,15,254,0.85)]"
                  : "border-slate-200 bg-white/80 hover:border-[#8F7BFD]/60 hover:bg-white",
            )}
          >
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-xs font-bold",
                on ? "border-[#5C0FFE] bg-[#5C0FFE] text-white" : "border-slate-200 text-slate-500",
              )}
            >
              {on ? <RiCheckLine className="h-4 w-4" /> : letter}
            </span>
            <span className="min-w-0">
              <span className={cn("block text-base font-semibold", choice.disabled ? "text-slate-400" : "text-slate-900")}>{choice.label}</span>
              {choice.hint && (
                <span className={cn("mt-0.5 block text-sm", choice.disabled ? "font-semibold text-amber-700" : "text-slate-500")}>
                  {choice.hint}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function IdStep({
  n,
  answers,
  error,
  headingRef,
  onPatch,
  onAdvance,
}: {
  n: string;
  answers: Answers;
  error: string | null;
  headingRef: RefObject<HTMLHeadingElement>;
  onPatch: (partial: Partial<Answers>) => void;
  onAdvance: () => void;
}) {
  const inputId = useId();
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    const file = answers.idFile;
    if (!file || !file.type.startsWith("image/") || /heic|heif/i.test(file.type)) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [answers.idFile]);

  function take(file: File | null) {
    onPatch({ idFile: file, idConfirmed: file ? answers.idConfirmed : false });
  }

  return (
    <div>
      <Kicker n={n} />
      <h1 ref={headingRef} tabIndex={-1} className={PAGE_TITLE}>
        Upload a valid government-issued photo ID
      </h1>
      <p className="mt-3 max-w-xl text-base leading-relaxed text-slate-500">
        Driver’s license, state ID, or passport. It needs to be current, and the photo needs to be readable. JPG, PNG, or PDF, up to 4 MB.
      </p>
      <p className="mt-3 max-w-xl text-base leading-relaxed text-slate-600">
        {ID_PURPOSE_COPY}{" "}
        <a href={PRIVACY_POLICY_URL} target="_blank" rel="noreferrer" className="font-semibold text-[#5C0FFE] underline-offset-2 hover:underline">
          Privacy policy
        </a>
      </p>
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          take(e.dataTransfer.files?.[0] || null);
        }}
        className={cn(
          "mt-8 flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-8 text-center transition",
          dragOver ? "border-[#5C0FFE] bg-[#5C0FFE]/5" : "border-slate-300 bg-white hover:border-[#8F7BFD]",
        )}
      >
        {preview ? (
          <img src={preview} alt="" className="mb-3 max-h-40 rounded-lg object-contain" />
        ) : null}
        <span className="text-sm font-semibold text-slate-800">
          {answers.idFile ? answers.idFile.name : "Drop your ID here, or click to upload"}
        </span>
        <span className="mt-1 text-xs text-slate-500">Stored privately. Only Novara hiring staff can open it.</span>
        <input
          id={inputId}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,.heic,.heif"
          className="sr-only"
          onChange={(e) => take(e.target.files?.[0] || null)}
        />
      </label>
      <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm text-slate-800">
        <input
          type="checkbox"
          checked={answers.idConfirmed}
          onChange={(e) => onPatch({ idConfirmed: e.target.checked })}
          className="mt-0.5 h-5 w-5 rounded border-slate-300 text-[#5C0FFE] focus:ring-[#8F7BFD]"
        />
        <span>{ID_CONFIRM_COPY}</span>
      </label>
      {error && <ErrorText message={error} />}
      <div className="mt-6">
        <OkButton onClick={onAdvance} />
      </div>
    </div>
  );
}

function TextStep({
  n,
  title,
  hint,
  error,
  headingRef,
  onOk,
  children,
}: {
  n: string;
  title: string;
  hint?: string;
  error: string | null;
  headingRef: RefObject<HTMLHeadingElement>;
  onOk: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Kicker n={n} />
      <h1 ref={headingRef} tabIndex={-1} className={PAGE_TITLE}>
        {title}
      </h1>
      {hint && <p className="mt-3 max-w-xl text-base leading-relaxed text-slate-500">{hint}</p>}
      <div className="mt-8">{children}</div>
      {error && <ErrorText message={error} />}
      <div className="mt-6">
        <OkButton onClick={onOk} />
      </div>
    </div>
  );
}

function AddressSearchField({
  onResolved,
}: {
  onResolved: (partial: Partial<Answers>) => void;
}) {
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
          onChange={(e) => {
            setText(e.target.value);
            query(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            if (text.trim().length >= 3) {
              query(text);
              setOpen(true);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              clear();
              return;
            }
            if (e.key !== "Enter") return;
            e.preventDefault();
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

function Field({
  label,
  value,
  onChange,
  onEnter,
  type = "text",
  placeholder,
  autoComplete,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onEnter: () => void;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  inputMode?: "text" | "numeric" | "tel" | "email";
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        inputMode={inputMode}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onEnter();
          }
        }}
        className="h-14 w-full rounded-2xl border border-slate-200 bg-white px-4 text-lg text-slate-900 outline-none transition placeholder:text-slate-300 focus:border-[#5C0FFE] focus:ring-4 focus:ring-[#5C0FFE]/10"
      />
    </label>
  );
}

function Area({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <textarea
      value={value}
      placeholder={placeholder}
      rows={4}
      onChange={(e) => onChange(e.target.value)}
      className="w-full resize-y rounded-2xl border border-slate-200 bg-white px-4 py-3 text-lg text-slate-900 outline-none transition placeholder:text-slate-300 focus:border-[#5C0FFE] focus:ring-4 focus:ring-[#5C0FFE]/10"
    />
  );
}

function Kicker({ n }: { n: string }) {
  return (
    <p className="mb-3 inline-flex rounded-md border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-violet-700">
      {n}
    </p>
  );
}

function supplySummary(ids: string[]): string {
  const labels = SUPPLY_ITEMS.filter((item) => ids.includes(item.id)).map((item) => item.label);
  const text = labels.join(", ");
  if (!text) return "none yet";
  return text.length > 2000 ? `${text.slice(0, 1997)}...` : text;
}

function PayExample() {
  const job = 250;
  const rows = [
    { pct: 40, note: "Where everyone starts" },
    { pct: 45, note: "The top of the starting range" },
  ];
  return (
    <MagicCard className="mt-5 overflow-hidden rounded-2xl border border-violet-200 bg-white">
      <div className="relative z-[2] p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">Example · a $250 job</p>
        <div className="mt-3 space-y-3">
          {rows.map((row) => {
            const pay = (job * row.pct) / 100;
            return (
              <div key={row.pct}>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-medium text-slate-800">{row.pct}% · ${pay.toFixed(2)}</span>
                  <span className="text-xs text-slate-500">{row.note}</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-violet-100">
                  <div className="h-full rounded-full" style={{ width: `${row.pct}%`, background: HIRING_GRADIENT }} />
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-slate-500">You keep that share of the $250. Drive time between homes is not added on top.</p>
      </div>
    </MagicCard>
  );
}

function SupplyPicker({ owned, onChange }: { owned: string[]; onChange: (ids: string[]) => void }) {
  const selected = new Set(owned);
  return (
    <div className="max-h-[28rem] space-y-4 overflow-y-auto pr-1">
      {SUPPLY_GROUPS.map((category) => {
        const rows = SUPPLY_ITEMS.filter((item) => item.category === category);
        if (!rows.length) return null;
        return (
          <div key={category}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{SUPPLY_CATEGORY_LABEL[category]}</p>
            <ul className="mt-2 space-y-1.5">
              {rows.map((item) => {
                const on = selected.has(item.id);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        const next = new Set(selected);
                        if (on) next.delete(item.id);
                        else next.add(item.id);
                        onChange([...next]);
                      }}
                      className={cn("flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm", on ? "border-violet-400 bg-violet-50" : "border-slate-200 bg-white hover:border-violet-200")}
                    >
                      <Checkbox checked={on} className="pointer-events-none" tabIndex={-1} />
                      <span className="text-slate-800">{item.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function OkButton({ onClick, label = "OK", busy = false }: { onClick: () => void; label?: string; busy?: boolean }) {
  return (
    <ShimmerButton
      type="button"
      onClick={onClick}
      disabled={busy}
      background="#5C0FFE"
      borderRadius="0.75rem"
      className="h-11 px-5 text-sm font-semibold disabled:opacity-60"
    >
      {busy && <RiLoader4Line className="h-4 w-4 animate-spin" />}
      {label}
      {!busy && <span className="text-white/70">↵</span>}
    </ShimmerButton>
  );
}

function ErrorText({ message }: { message: string }) {
  return (
    <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
      {message}
    </p>
  );
}

function ReviewRow({ label, value, onEdit }: { label: string; value: string | null | undefined; onEdit: () => void }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
        <dd className="mt-0.5 whitespace-pre-wrap text-sm font-medium text-slate-800">{value || "—"}</dd>
      </div>
      <button type="button" onClick={onEdit} className="shrink-0 text-xs font-semibold text-[#5C0FFE] hover:underline">
        Edit
      </button>
    </div>
  );
}

function ChecklistLink() {
  return (
    <a
      href="/NovaraCleaning_Supply_Checklist_dd14.pdf"
      target="_blank"
      rel="noopener noreferrer"
      className="mt-3 inline-flex text-sm font-semibold text-[#5C0FFE] underline-offset-4 hover:underline"
    >
      See the starter supply checklist
    </a>
  );
}
