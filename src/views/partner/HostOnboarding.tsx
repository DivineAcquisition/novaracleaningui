"use client";

// ─── partner.novaracleaning.com/partner/onboarding — Host onboarding ──────
//
// Mobile-first, premium multi-step application for STR / Airbnb hosts. Captures
// identity (with the individual-vs-entity branch that drives the contract),
// one or more properties, and click-wrap consent. Submits to
// /api/host-onboarding which fans out to GHL (CRM + contract) and Airtable.
//
// Hosts do NOT set rates here — the Company sets per-turnover pricing after
// review (shown as "Pending Pricing").

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  RiLoader4Line, RiUser3Line, RiMailLine, RiPhoneLine, RiBuilding2Line,
  RiHome4Line, RiAddLine, RiDeleteBinLine, RiArrowRightLine, RiArrowLeftLine,
  RiCheckboxCircleLine, RiShieldCheckLine, RiKey2Line, RiMapPinLine,
  RiSparklingLine, RiFlashlightFill,
} from "@remixicon/react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SEO } from "@/components/SEO";
import { cn } from "@/lib/utils";
import {
  ACCESS_TYPES, SERVICE_ZONES,
  type EntityType, type OnboardingPropertyInput, type OnboardingFormPayload,
} from "@/lib/host-onboarding/types";

const PURPLE_GRADIENT = "linear-gradient(135deg,#4F38FF 0%,#6A57FF 100%)";
const INPUT_CLS =
  "h-11 pl-10 bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 " +
  "focus-visible:border-[#6A57FF] focus-visible:ring-2 focus-visible:ring-[#6A57FF]/25";
const PLAIN_INPUT =
  "h-11 bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 " +
  "focus-visible:border-[#6A57FF] focus-visible:ring-2 focus-visible:ring-[#6A57FF]/25";

const AGREEMENT_URL = "https://partner.novaracleaning.com/host-partnership-agreement";

const FEATURES = [
  { icon: RiShieldCheckLine, label: "Vetted cleaners", desc: "Background-checked and rated after every clean." },
  { icon: RiFlashlightFill, label: "Auto dispatch", desc: "Matched to your preferred crew the moment you book." },
  { icon: RiKey2Line, label: "Secure access", desc: "Lockbox & gate codes stored safely, shared only on the job." },
];

const digits = (s: string) => s.replace(/\D/g, "");

function emptyProperty(): OnboardingPropertyInput {
  return {
    nickname: "", address: "", bedrooms: undefined, bathrooms: undefined, sqft: undefined,
    linen: false, restock: false, accessType: "", accessInstructions: "", stagingNotes: "",
  };
}

type Step = 1 | 2 | 3;

export default function HostOnboarding() {
  const searchParams = useSearchParams();
  const [step, setStep] = useState<Step>(1);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // Step 1 — identity
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [entityType, setEntityType] = useState<EntityType | "">("");
  const [entityName, setEntityName] = useState("");
  const [serviceZone, setServiceZone] = useState("");

  // Step 2 — properties
  const [properties, setProperties] = useState<OnboardingPropertyInput[]>([emptyProperty()]);

  // Step 3 — consent + portal account
  const [consent, setConsent] = useState(false);

  // Prefill from an admin-generated "spin up onboarding link" (query params).
  useEffect(() => {
    if (!searchParams) return;
    const get = (k: string) => searchParams.get(k)?.trim() || "";
    const n = get("name"); if (n) setFullName(n);
    const e = get("email"); if (e) setEmail(e);
    const p = get("phone"); if (p) setPhone(p);
    const z = get("zone");
    if (z && (SERVICE_ZONES as readonly string[]).includes(z)) setServiceZone(z);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateProp = (i: number, patch: Partial<OnboardingPropertyInput>) =>
    setProperties((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  const addProp = () => setProperties((prev) => [...prev, emptyProperty()]);
  const removeProp = (i: number) => setProperties((prev) => prev.filter((_, idx) => idx !== i));

  const validateStep1 = (): boolean => {
    if (!fullName.trim()) { toast.error("Add your full name."); return false; }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { toast.error("Add a valid email."); return false; }
    if (digits(phone).length < 10) { toast.error("Add a valid phone."); return false; }
    if (!entityType) { toast.error("Tell us if you're signing as an individual or business entity."); return false; }
    if (entityType === "entity" && !entityName.trim()) { toast.error("Add your entity / business name."); return false; }
    return true;
  };
  const validateStep2 = (): boolean => {
    if (properties.length === 0) { toast.error("Add at least one property."); return false; }
    for (const [i, p] of properties.entries()) {
      if (!p.nickname.trim()) { toast.error(`Property ${i + 1}: add a nickname.`); return false; }
      if (!p.address.trim()) { toast.error(`Property ${i + 1}: add an address.`); return false; }
    }
    return true;
  };

  const next = () => {
    if (step === 1 && !validateStep1()) return;
    if (step === 2 && !validateStep2()) return;
    setStep((s) => (Math.min(3, s + 1) as Step));
  };
  const back = () => setStep((s) => (Math.max(1, s - 1) as Step));

  const submit = async () => {
    if (!consent) { toast.error("Please agree to the Host Partnership Agreement."); return; }
    setSubmitting(true);
    const cleanEmail = email.trim().toLowerCase();
    const payload: OnboardingFormPayload = {
      fullName: fullName.trim(),
      email: cleanEmail,
      phone: phone.trim(),
      entityType: entityType as EntityType,
      entityName: entityType === "entity" ? entityName.trim() : undefined,
      serviceZone: serviceZone || undefined,
      properties,
      consentAgreement: consent,
    };
    try {
      const res = await fetch("/api/host-onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Submission failed");

      // Passwordless handoff: the same onboarding token mints a portal session.
      if (data?.handoffUrl) {
        toast.success("Welcome — your Host Portal is ready.");
        window.location.assign(data.handoffUrl as string);
        return;
      }
      setDone(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not submit your application");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#FAFAFC] lg:grid lg:grid-cols-[1.05fr_1fr]">
      <SEO title="Host Onboarding" description="Apply to become a Novara STR turnover host." noindex />
      <BrandPanel />

      <div className="relative flex min-h-screen items-start justify-center px-5 py-10 sm:px-10 sm:py-14">
        <div className="relative w-full max-w-[480px] space-y-6">
          <div className="flex flex-col items-center gap-2 lg:hidden">
            <img src="/novara-email-logo.png" alt="Novara Cleaning" className="h-7 w-auto" />
            <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-slate-400">Host Onboarding</span>
          </div>

          {done ? (
            <SuccessCard email={email} />
          ) : (
            <>
              <Stepper step={step} />
              <div className="rounded-2xl border border-slate-200/70 bg-white p-6 shadow-[0_1px_3px_rgba(16,24,40,0.06),0_18px_50px_-20px_rgba(79,56,255,0.25)] sm:p-7">
                {step === 1 && (
                  <StepIdentity
                    {...{ fullName, setFullName, email, setEmail, phone, setPhone, entityType, setEntityType, entityName, setEntityName, serviceZone, setServiceZone }}
                  />
                )}
                {step === 2 && (
                  <StepProperties properties={properties} updateProp={updateProp} addProp={addProp} removeProp={removeProp} />
                )}
                {step === 3 && (
                  <StepConsent
                    consent={consent}
                    setConsent={setConsent}
                    propertyCount={properties.length}
                    email={email}
                  />
                )}

                <div className="mt-6 flex items-center gap-3">
                  {step > 1 && (
                    <Button variant="outline" className="h-11 flex-1" onClick={back} disabled={submitting}>
                      <RiArrowLeftLine className="mr-1.5 h-4 w-4" /> Back
                    </Button>
                  )}
                  {step < 3 ? (
                    <Button className="h-11 flex-1 font-semibold text-white shadow-lg shadow-[#4F38FF]/25 transition hover:opacity-95" style={{ background: PURPLE_GRADIENT }} onClick={next}>
                      Continue <RiArrowRightLine className="ml-1.5 h-4 w-4" />
                    </Button>
                  ) : (
                    <Button className="h-11 flex-1 font-semibold text-white shadow-lg shadow-[#4F38FF]/25 transition hover:opacity-95" style={{ background: PURPLE_GRADIENT }} onClick={submit} disabled={submitting}>
                      {submitting ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : "Submit application"}
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-center text-xs text-slate-400">
                Rates are set by our team after review — you'll review and sign the agreement once your per-turnover pricing is ready.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Stepper({ step }: { step: Step }) {
  const labels = ["You", "Properties", "Agree"];
  return (
    <div className="flex items-center gap-2">
      {labels.map((label, i) => {
        const n = (i + 1) as Step;
        const active = n === step;
        const done = n < step;
        return (
          <div key={label} className="flex flex-1 items-center gap-2">
            <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
              done ? "bg-[#5500FF] text-white" : active ? "bg-[#5500FF] text-white" : "bg-slate-200 text-slate-500")}>
              {done ? <RiCheckboxCircleLine className="h-4 w-4" /> : n}
            </div>
            <span className={cn("text-xs font-medium", active || done ? "text-slate-900" : "text-slate-400")}>{label}</span>
            {i < labels.length - 1 && <div className={cn("h-px flex-1", done ? "bg-[#5500FF]" : "bg-slate-200")} />}
          </div>
        );
      })}
    </div>
  );
}

function StepIdentity(props: {
  fullName: string; setFullName: (v: string) => void;
  email: string; setEmail: (v: string) => void;
  phone: string; setPhone: (v: string) => void;
  entityType: EntityType | ""; setEntityType: (v: EntityType) => void;
  entityName: string; setEntityName: (v: string) => void;
  serviceZone: string; setServiceZone: (v: string) => void;
}) {
  const { fullName, setFullName, email, setEmail, phone, setPhone, entityType, setEntityType, entityName, setEntityName, serviceZone, setServiceZone } = props;
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="font-jakarta text-2xl font-bold tracking-tight text-slate-900">Let's get you set up</h1>
        <p className="text-sm text-slate-500">Tell us who we're partnering with.</p>
      </div>

      <Field label="Full name">
        <div className="relative">
          <RiUser3Line className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your name" className={INPUT_CLS} />
        </div>
      </Field>
      <Field label="Email">
        <div className="relative">
          <RiMailLine className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" className={INPUT_CLS} />
        </div>
      </Field>
      <Field label="Phone">
        <div className="relative">
          <RiPhoneLine className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(301) 555-0100" className={INPUT_CLS} />
        </div>
      </Field>

      <Field label="Are you signing as an individual or a business entity?">
        <div className="grid grid-cols-2 gap-2">
          {(["individual", "entity"] as EntityType[]).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setEntityType(opt)}
              className={cn(
                "flex items-center justify-center gap-2 rounded-xl border p-3 text-sm font-medium transition",
                entityType === opt ? "border-[#5500FF] bg-[#5500FF]/5 text-[#5500FF]" : "border-slate-200 text-slate-600 hover:border-slate-300",
              )}
            >
              {opt === "individual" ? <RiUser3Line className="h-4 w-4" /> : <RiBuilding2Line className="h-4 w-4" />}
              {opt === "individual" ? "Individual" : "Business Entity"}
            </button>
          ))}
        </div>
      </Field>

      {entityType === "entity" && (
        <Field label="Entity / business name">
          <div className="relative">
            <RiBuilding2Line className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={entityName} onChange={(e) => setEntityName(e.target.value)} placeholder="Acme Stays LLC" className={INPUT_CLS} />
          </div>
          <p className="mt-1 text-[11px] text-slate-400">Your agreement will include the entity name and personal guarantee.</p>
        </Field>
      )}

      <Field label="Service zone">
        <select value={serviceZone} onChange={(e) => setServiceZone(e.target.value)} className={cn(PLAIN_INPUT, "w-full rounded-md border px-3")}>
          <option value="">Select your area…</option>
          {SERVICE_ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
      </Field>
    </div>
  );
}

function StepProperties({
  properties, updateProp, addProp, removeProp,
}: {
  properties: OnboardingPropertyInput[];
  updateProp: (i: number, patch: Partial<OnboardingPropertyInput>) => void;
  addProp: () => void;
  removeProp: (i: number) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="font-jakarta text-2xl font-bold tracking-tight text-slate-900">Your properties</h1>
        <p className="text-sm text-slate-500">Add each rental you'd like us to turn over.</p>
      </div>

      <div className="space-y-4">
        {properties.map((p, i) => (
          <div key={i} className="rounded-xl border border-slate-200 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-700"><RiHome4Line className="h-4 w-4 text-[#5500FF]" /> Property {i + 1}</p>
              {properties.length > 1 && (
                <button type="button" onClick={() => removeProp(i)} className="text-slate-400 hover:text-red-500">
                  <RiDeleteBinLine className="h-4 w-4" />
                </button>
              )}
            </div>

            <Field label="Nickname">
              <Input value={p.nickname} onChange={(e) => updateProp(i, { nickname: e.target.value })} placeholder="Lakehouse 2BR" className={PLAIN_INPUT} />
            </Field>
            <Field label="Address">
              <div className="relative">
                <RiMapPinLine className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input value={p.address} onChange={(e) => updateProp(i, { address: e.target.value })} placeholder="123 Lake Dr, Columbia, MD" className={INPUT_CLS} />
              </div>
            </Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Beds"><Input inputMode="numeric" value={p.bedrooms ?? ""} onChange={(e) => updateProp(i, { bedrooms: e.target.value === "" ? undefined : Number(e.target.value) })} className={PLAIN_INPUT} /></Field>
              <Field label="Baths"><Input inputMode="decimal" value={p.bathrooms ?? ""} onChange={(e) => updateProp(i, { bathrooms: e.target.value === "" ? undefined : Number(e.target.value) })} className={PLAIN_INPUT} /></Field>
              <Field label="Sq ft"><Input inputMode="numeric" value={p.sqft ?? ""} onChange={(e) => updateProp(i, { sqft: e.target.value === "" ? undefined : Number(e.target.value) })} className={PLAIN_INPUT} /></Field>
            </div>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={!!p.linen} onChange={(e) => updateProp(i, { linen: e.target.checked })} className="h-4 w-4 accent-[#5500FF]" /> Linen / laundry needed
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={!!p.restock} onChange={(e) => updateProp(i, { restock: e.target.checked })} className="h-4 w-4 accent-[#5500FF]" /> Restock consumables
              </label>
            </div>
            <Field label="Access type">
              <select value={p.accessType || ""} onChange={(e) => updateProp(i, { accessType: e.target.value })} className={cn(PLAIN_INPUT, "w-full rounded-md border px-3")}>
                <option value="">Select…</option>
                {ACCESS_TYPES.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </Field>
            <Field label="Access code / instructions">
              <Textarea rows={2} value={p.accessInstructions || ""} onChange={(e) => updateProp(i, { accessInstructions: e.target.value })} placeholder="Lockbox 1234, gate code, parking, where supplies are…" />
            </Field>
            <Field label="Staging notes (optional)">
              <Textarea rows={2} value={p.stagingNotes || ""} onChange={(e) => updateProp(i, { stagingNotes: e.target.value })} placeholder="Staging prefs, quirks…" />
            </Field>
          </div>
        ))}
      </div>

      <Button variant="outline" className="w-full" onClick={addProp}>
        <RiAddLine className="mr-1.5 h-4 w-4" /> Add another property
      </Button>
    </div>
  );
}

function StepConsent({
  consent, setConsent, propertyCount, email,
}: {
  consent: boolean; setConsent: (v: boolean) => void; propertyCount: number;
  email: string;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="font-jakarta text-2xl font-bold tracking-tight text-slate-900">Almost there</h1>
        <p className="text-sm text-slate-500">Agree to finish. You&apos;ll enter the portal without a password.</p>
      </div>

      <div className="rounded-xl bg-[#EDE9FE] p-4 text-sm text-slate-700">
        <p className="font-semibold text-slate-900">What happens next</p>
        <ol className="mt-2 list-decimal space-y-1 pl-4 text-[13px]">
          <li>You finish here and land straight in your Host Portal — no extra signup.</li>
          <li>We review your {propertyCount} propert{propertyCount === 1 ? "y" : "ies"} and set your per-turnover rate.</li>
          <li>You receive the full Host Partnership Agreement — with your rate schedule — to e-sign within 24 hours.</li>
          <li>Once signed, your properties go active and you can request turnovers.</li>
        </ol>
      </div>

      <p className="text-sm text-slate-500">
        Later visits use a magic link to {email ? <span className="font-medium text-slate-700">{email}</span> : "your email"}.
        No password is created.
      </p>

      <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-4">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#5500FF]" />
        <span className="text-sm text-slate-700">
          I agree to the{" "}
          <a href={AGREEMENT_URL} target="_blank" rel="noreferrer" className="font-semibold text-[#5500FF] hover:underline">
            NovaraCleaning Host Partnership Agreement and Property &amp; Rate Schedule
          </a>. I understand the{" "}
          <span className="font-semibold text-slate-900">full agreement will be sent to me to e-sign, and must be signed within 24 hours</span>.
        </span>
      </label>
      <p className="text-[11px] text-slate-400">By submitting, you consent to the agreement terms; we record the time and your device for the agreement record. The complete Host Partnership Agreement (with your rate schedule) will be emailed for e-signature and must be signed within 24&nbsp;hours.</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-slate-700">{label}</Label>
      {children}
    </div>
  );
}

function SuccessCard({ email }: { email: string }) {
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white p-8 text-center shadow-[0_1px_3px_rgba(16,24,40,0.06),0_18px_50px_-20px_rgba(79,56,255,0.25)]">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#5500FF]/10">
        <RiCheckboxCircleLine className="h-7 w-7 text-[#5500FF]" />
      </div>
      <h1 className="mt-4 font-jakarta text-2xl font-bold tracking-tight text-slate-900">Application received!</h1>
      <p className="mt-2 text-sm text-slate-500">
        Thanks — we've got your details{email ? <> at <span className="font-medium text-slate-700">{email}</span></> : ""}. Our team will set your per-turnover rates and send your full Host Partnership Agreement to e-sign within 24 hours. Keep an eye on your inbox.
      </p>
      <a
        href="/partner"
        className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-md font-semibold text-white shadow-lg shadow-[#4F38FF]/25 transition hover:opacity-95"
        style={{ background: PURPLE_GRADIENT }}
      >
        Go to your Host Portal
      </a>
    </div>
  );
}

// ─── Brand panel (desktop) ─────────────────────────────────────────────────
function BrandPanel() {
  return (
    <div className="relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col lg:justify-between" style={{ background: "#0B0920" }}>
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(55% 45% at 16% 12%, rgba(106,87,255,.55), transparent 60%)," +
              "radial-gradient(45% 40% at 90% 18%, rgba(154,140,255,.32), transparent 60%)," +
              "radial-gradient(70% 65% at 78% 98%, rgba(79,56,255,.5), transparent 62%)",
          }}
        />
      </div>
      <div className="relative">
        <img src="/novara-email-logo.png" alt="Novara Cleaning" className="h-8 w-auto" style={{ filter: "brightness(0) invert(1)" }} />
      </div>
      <div className="relative max-w-md">
        <h2 className="font-jakarta text-3xl font-bold leading-[1.15] tracking-tight xl:text-[2.6rem]">
          Partner with Novara,<br />grow guest-ready.
        </h2>
        <p className="mt-4 text-sm leading-relaxed text-white/70">
          List your rentals, we set a fair per-turnover rate, and a vetted crew keeps every property guest-ready by check-in.
        </p>
        <ul className="mt-9 space-y-5">
          {FEATURES.map((f) => (
            <li key={f.label} className="flex items-start gap-3.5">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15 backdrop-blur">
                <f.icon className="h-[18px] w-[18px] text-white" />
              </span>
              <div>
                <p className="text-sm font-semibold leading-tight">{f.label}</p>
                <p className="mt-0.5 text-xs leading-snug text-white/55">{f.desc}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div className="relative flex items-center gap-2 text-sm text-white/60">
        <RiSparklingLine className="h-4 w-4" /> Trusted by short-term-rental hosts across Maryland, DC &amp; NoVA.
      </div>
    </div>
  );
}
