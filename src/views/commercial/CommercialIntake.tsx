"use client";

// ─── commercial.novaracleaning.com — public partnership intake ──────────────
//
// Front-of-funnel for three relationship types: Commercial, Office, STR/Airbnb.
// The first question routes everything; each type sees only its own fields.
// Captures interest — NEVER prices (admin sets rates later). Submissions become
// typed leads in the Partnerships Hub, deduped on email, and notify the team.
//
// Two things this page has to do at once, which is why it is shaped the way it
// is:
//
//   1. ANSWER THE QUESTIONS A BUYER ACTUALLY HAS before asking for their
//      details. A facilities manager comparing vendors wants to know how
//      pricing is arrived at, whether we're insured, what happens after they
//      hit submit, and whether they're signing something they can't get out
//      of. Opening on a bare form asks them to trust us before we have told
//      them anything.
//   2. NOT PRICE. Commercial rates come from a walkthrough and a firm price
//      set by a human. So the page explains the PROCESS in detail and quotes
//      no numbers — the honest version of "how much?" is "here is exactly how
//      we work it out, and when you'll know."
//
// Everything stated below about the process is what the system actually does:
// the 5,000 sq ft walkthrough threshold, the firm price (not an estimate), the
// certificate of insurance before the first clean, month-to-month or annual
// term, invoiced or auto-pay, and photo-documented visits.
//
// Visual language follows the Novara/Coss shell used across the app: brand
// atmosphere wash, hairline borders, panel surfaces, Plus Jakarta headings.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  RiArrowLeftLine,
  RiArrowRightLine,
  RiBuilding2Line,
  RiBuilding4Line,
  RiCheckboxCircleFill,
  RiCheckLine,
  RiHomeSmile2Line,
  RiLoader4Line,
  RiMailLine,
  RiPhoneLine,
  RiShieldCheckLine,
  RiCameraLine,
  RiFileTextLine,
  RiCalendarCheckLine,
  RiMapPin2Line,
  RiUserFollowLine,
  RiUserLine,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatPhoneNumber } from "@/lib/input-formatters";
import { SEO } from "@/components/SEO";
import { BrandAtmosphere } from "@/components/brand/atmosphere";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";
import { CompanyCoiDownloadLink } from "@/components/commercial/CompanyCoiDownloadLink";

const PURPLE_GRADIENT = BRAND.gradient;

type PartnerType = "commercial" | "office" | "str";

const TYPES: Array<{
  id: PartnerType;
  title: string;
  desc: string;
  examples: string;
  icon: typeof RiBuilding2Line;
}> = [
  {
    id: "commercial",
    title: "Commercial cleaning",
    desc: "Recurring service for a business your customers walk into.",
    examples: "Retail · Medical & dental · Gyms · Restaurants · Warehouses · Churches",
    icon: RiBuilding2Line,
  },
  {
    id: "office",
    title: "Office cleaning",
    desc: "Scheduled cleaning around your team's hours, including after-hours.",
    examples: "Single offices · Multi-floor suites · Coworking · Professional practices",
    icon: RiBuilding4Line,
  },
  {
    id: "str",
    title: "Airbnb / STR turnovers",
    desc: "Same-day turnovers between guests, with photo proof every time.",
    examples: "Single properties · Portfolios · Property managers",
    icon: RiHomeSmile2Line,
  },
];

// The real pipeline, in the client's language. Sites at or above the
// walkthrough threshold cannot be priced without a visit, so promising a
// number over the phone would be a promise the system won't keep.
const HOW_IT_WORKS: Array<{ title: string; body: string; icon: typeof RiFileTextLine }> = [
  {
    icon: RiFileTextLine,
    title: "You tell us what you need",
    body:
      "The form below takes about a minute. No pricing is shown, because we haven't seen your space yet — and a number invented before we have is a number that changes later.",
  },
  {
    icon: RiMapPin2Line,
    title: "We walk the site",
    body:
      "For anything from about 5,000 sq ft up, we visit before quoting: square footage, floor types, restrooms, obstacle density, access and your service window. Smaller spaces can often be priced without a visit.",
  },
  {
    icon: RiCheckboxCircleFill,
    title: "You get a firm price",
    body:
      "Not a range, and not an estimate that moves after the first month. One rate per location, per visit, based on what we measured — with the reasoning behind it if you want to see it.",
  },
  {
    icon: RiShieldCheckLine,
    title: "Proposal, agreement, insurance",
    body:
      "You review the proposal and can ask for changes before anything is binding. When you're happy, everything else — signature, billing setup, your portal login — happens on one page in one sitting.",
  },
  {
    icon: RiCalendarCheckLine,
    title: "First clean",
    body:
      "We schedule once your certificate of insurance is on file and billing is set up. From then on you can see every visit, and request extra service, from your portal.",
  },
];

const ASSURANCES: Array<{ title: string; body: string; icon: typeof RiShieldCheckLine }> = [
  {
    icon: RiShieldCheckLine,
    title: "Insured, and we prove it",
    body:
      "Our certificate of insurance is on this page, and the same file goes to you automatically when you sign — you don't have to chase it. If your building needs us named as an additional insured, tell us on the form.",
  },
  {
    icon: RiCameraLine,
    title: "Every visit is documented",
    body:
      "Crews photograph before and after and work from a published checklist for your site. If something is missed you have evidence, not a debate.",
  },
  {
    icon: RiUserFollowLine,
    title: "Vetted contractors",
    body:
      "Background check and insurance are verified before anyone is assigned, and they're re-checked — an expired document takes a cleaner off the schedule automatically.",
  },
  {
    icon: RiFileTextLine,
    title: "Terms that aren't a trap",
    body:
      "Month-to-month is the default. A 12-month term is available if you'd rather lock the rate. Invoiced with Net terms, or auto-pay — your choice, agreed before you sign.",
  },
];

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "Why isn't there a price on this page?",
    a: "Because we can't know it yet. Commercial pricing depends on square footage, how the space is used, floor types, how much furniture a crew works around, and the window you need us in. Two 4,000 sq ft spaces can differ by a wide margin. We measure first and give you one firm number rather than a range that drifts upward once we're on site.",
  },
  {
    q: "How long until I hear back?",
    a: "A person reviews every request, usually within one business day. If your site needs a walkthrough we'll offer times then — the visit itself is typically under an hour and you don't need to do anything to prepare.",
  },
  {
    q: "Do I have to sign a long contract?",
    a: "No. Month-to-month is the default and you can cancel with notice. A 12-month term exists only for clients who want their rate locked for the year.",
  },
  {
    q: "Can you clean outside business hours?",
    a: "Yes — most office and commercial work happens before or after hours, or overnight. Tell us your window on the form and it becomes part of how the job is staffed and priced, rather than something we negotiate afterwards.",
  },
  {
    q: "We have several locations. Can they be on one account?",
    a: "Yes. Each location is priced on its own, because they're rarely alike, but they sit under one agreement, one invoice and one portal. You can add locations later without redoing anything — a new site just needs its own walkthrough.",
  },
  {
    q: "What if a clean isn't right?",
    a: "Tell us within 48 hours and we'll come back and put it right at no charge. The before-and-after photos mean we're usually looking at the same thing you are.",
  },
  {
    q: "Do you supply everything?",
    a: "Yes, unless you'd rather we use your products — some medical and food-service clients do. Either way it's agreed up front and written into your scope.",
  },
  {
    q: "Can I see your insurance certificate?",
    a: "Yes — download it from this page. We carry commercial general liability with Spinnaker Insurance Company (policy CSG-00519113-00), current through July 21, 2027. The same certificate is emailed to you automatically when you sign.",
  },
];

const FACILITY_TYPES = ["Office", "Retail", "Medical", "Gym / Fitness", "Restaurant", "Warehouse", "School / Daycare", "Church", "Other"];
const FREQUENCIES = ["Daily", "Several times a week", "Weekly", "Bi-weekly", "Monthly", "Not sure yet"];
const TURNOVER_FREQUENCIES = ["Multiple per week", "Weekly", "A few per month", "Seasonal / varies"];
const TIMINGS = ["As soon as possible", "Within 2 weeks", "Within a month", "Just exploring"];

interface FormState {
  type: PartnerType | null;
  businessName: string;
  contactName: string;
  role: string;
  email: string;
  phone: string;
  city: string;
  numLocations: string;
  facilityType: string;
  sqft: string;
  frequency: string;
  currentSituation: string;
  numProperties: string;
  bedsBaths: string;
  turnoverFrequency: string;
  entityType: string;
  timing: string;
}

const EMPTY: FormState = {
  type: null, businessName: "", contactName: "", role: "", email: "", phone: "",
  city: "", numLocations: "", facilityType: "", sqft: "", frequency: "",
  currentSituation: "", numProperties: "", bedsBaths: "", turnoverFrequency: "",
  entityType: "", timing: "",
};

export default function CommercialIntake() {
  const router = useRouter();
  const [step, setStep] = useState(0); // 0 type · 1 details · 2 contact
  const [form, setForm] = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));
  const isStr = form.type === "str";
  const progress = ((step + 1) / 3) * 100;

  const detailsValid = useMemo(() => {
    if (!form.type) return false;
    if (isStr) return form.numProperties !== "" && form.turnoverFrequency !== "";
    return form.businessName.trim() !== "" && form.facilityType !== "" && form.frequency !== "";
  }, [form, isStr]);

  const contactValid = useMemo(() =>
    form.contactName.trim() !== "" &&
    /.+@.+\..+/.test(form.email) &&
    form.phone.replace(/\D/g, "").length >= 10,
  [form]);

  const chosen = TYPES.find((t) => t.id === form.type);

  const submit = async () => {
    if (!contactValid || !form.type) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/commercial-intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) throw new Error(data?.error || "Something went wrong — please try again.");
      router.push(`/commercial/success?type=${form.type}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong — please try again.");
      setSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-background text-foreground font-sans">
      <BrandAtmosphere />
      <SEO
        title="Commercial, Office & STR Cleaning — Novara Cleaning"
        description="Commercial and office cleaning and Airbnb/STR turnovers across Maryland, DC and Northern Virginia. On-site walkthrough, one firm price per location, month-to-month terms, fully insured."
      />

      {/* ─── Header. The progress bar only appears once they're in the form,
          so the landing view reads as a page rather than a checkout. ───── */}
      <header className="sticky top-0 z-40 border-b border-[color:var(--hairline)] bg-background/85 backdrop-blur-xl hairline-glow">
        <div className="relative z-10 mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <img src="/novara-email-logo.png" alt="Novara Cleaning" className="h-[22px] w-auto" />
            <span className="hidden rounded-md bg-brand-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-primary sm:inline">
              Commercial
            </span>
          </div>
          {step === 0 ? (
            <a
              href="#request"
              className="text-xs font-semibold text-primary hover:underline"
            >
              Request a quote
            </a>
          ) : (
            <span className="text-xs font-semibold text-muted-foreground">Step {step + 1} of 3</span>
          )}
        </div>
        {step > 0 && (
          <div className="h-1 bg-muted">
            <div className="h-1 transition-all duration-500" style={{ width: `${progress}%`, background: PURPLE_GRADIENT }} />
          </div>
        )}
      </header>

      <main className="relative z-10 mx-auto max-w-5xl px-4 pb-28 pt-8 md:pt-12">
        {/* ─── Step 1: the landing + type selection ────────────────────── */}
        {step === 0 && (
          <div className="animate-in fade-in slide-in-from-bottom-2 space-y-14 duration-300">
            {/* Hero */}
            <section className="mx-auto max-w-3xl text-center">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-primary">
                <RiMapPin2Line className="h-3.5 w-3.5" />
                Maryland · DC · Northern Virginia
              </span>
              <h1 className="mt-4 font-heading text-3xl font-bold tracking-tight sm:text-4xl">
                Cleaning your building manager doesn&apos;t have to chase
              </h1>
              <p className="mx-auto mt-4 max-w-2xl text-[15px] leading-relaxed text-muted-foreground sm:text-base">
                We clean offices, commercial spaces and short-term rentals on a schedule, with the
                same crew, documented every visit. Tell us about your space and a person gets back
                to you — usually within one business day.
              </p>

              <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
                {[
                  "Fully insured",
                  "Photo-documented visits",
                  "Month-to-month",
                  "One firm price per location",
                ].map((t) => (
                  <span key={t} className="inline-flex items-center gap-1.5">
                    <RiCheckLine className="h-3.5 w-3.5 text-primary" />
                    {t}
                  </span>
                ))}
              </div>
            </section>

            {/* Type selection — the actual entry point */}
            <section id="request" className="mx-auto max-w-3xl scroll-mt-20">
              <div className="mb-5 text-center">
                <h2 className="font-heading text-xl font-bold tracking-tight sm:text-2xl">
                  What are you looking for?
                </h2>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Pick the closest fit — we&apos;ll only ask what&apos;s relevant to it.
                </p>
              </div>

              <div className="grid gap-3">
                {TYPES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => { set({ type: t.id }); setStep(1); }}
                    className={cn(
                      "group panel panel-hover rounded-2xl p-5 text-left transition-all",
                      form.type === t.id && "ring-1 ring-primary/30",
                    )}
                  >
                    <div className="flex items-start gap-4">
                      <div
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl shadow-[0_2px_8px_-2px_rgba(92,15,254,0.45)]"
                        style={{ background: PURPLE_GRADIENT }}
                      >
                        <t.icon className="h-5 w-5 text-white" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-heading font-bold tracking-tight">{t.title}</p>
                        <p className="mt-0.5 text-sm text-muted-foreground">{t.desc}</p>
                        <p className="mt-1.5 text-xs text-muted-foreground/80">{t.examples}</p>
                      </div>
                      <RiArrowRightLine className="ml-auto mt-2 h-5 w-5 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                    </div>
                  </button>
                ))}
              </div>
            </section>

            {/* How it works — the part that answers "how much?" honestly */}
            <section className="mx-auto max-w-3xl">
              <div className="mb-5 text-center">
                <h2 className="font-heading text-xl font-bold tracking-tight sm:text-2xl">
                  How we get to a number
                </h2>
                <p className="mx-auto mt-1.5 max-w-xl text-sm text-muted-foreground">
                  No pricing on this page is deliberate. Here&apos;s exactly what happens instead,
                  and when you&apos;ll know what it costs.
                </p>
              </div>

              <ol className="space-y-3">
                {HOW_IT_WORKS.map((s, i) => (
                  <li key={s.title} className="panel flex gap-4 rounded-2xl p-4 sm:p-5">
                    <div className="flex flex-col items-center">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 font-heading text-sm font-bold text-primary">
                        {i + 1}
                      </span>
                      {i < HOW_IT_WORKS.length - 1 && (
                        <span aria-hidden className="mt-1 w-px flex-1 bg-[color:var(--hairline)]" />
                      )}
                    </div>
                    <div className="min-w-0 pb-1">
                      <p className="flex items-center gap-2 font-heading font-semibold tracking-tight">
                        <s.icon className="h-4 w-4 text-primary" />
                        {s.title}
                      </p>
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            {/* Assurances */}
            <section className="mx-auto max-w-3xl">
              <h2 className="mb-5 text-center font-heading text-xl font-bold tracking-tight sm:text-2xl">
                What you get either way
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {ASSURANCES.map((a) => (
                  <div key={a.title} className="panel rounded-2xl p-5">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-primary">
                      <a.icon className="h-4.5 w-4.5" />
                    </span>
                    <p className="mt-3 font-heading font-semibold tracking-tight">{a.title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{a.body}</p>
                    {a.title === "Insured, and we prove it" && (
                      <div className="mt-3">
                        <CompanyCoiDownloadLink showMeta />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* FAQ */}
            <section className="mx-auto max-w-3xl">
              <h2 className="mb-5 text-center font-heading text-xl font-bold tracking-tight sm:text-2xl">
                Questions people ask before they call
              </h2>
              <div className="divide-y divide-[color:var(--hairline)] overflow-hidden rounded-2xl border border-[color:var(--hairline)] bg-card">
                {FAQ.map((f) => (
                  <details key={f.q} className="group">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 text-sm font-semibold hover:bg-muted/40 sm:p-5">
                      {f.q}
                      <span
                        aria-hidden
                        className="shrink-0 text-lg leading-none text-muted-foreground transition-transform group-open:rotate-45"
                      >
                        +
                      </span>
                    </summary>
                    <p className="px-4 pb-5 text-sm leading-relaxed text-muted-foreground sm:px-5">
                      {f.a}
                    </p>
                  </details>
                ))}
              </div>
            </section>

            {/* Close */}
            <section className="mx-auto max-w-2xl text-center">
              <div className="panel rounded-2xl p-6 sm:p-8">
                <h2 className="font-heading text-xl font-bold tracking-tight">
                  Ready when you are
                </h2>
                <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                  About a minute to fill in, no obligation, and no card. A person reads it and comes
                  back to you.
                </p>
                <a
                  href="#request"
                  className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-xl px-6 text-sm font-semibold text-white shadow-[0_2px_10px_-2px_rgba(92,15,254,0.5)]"
                  style={{ background: PURPLE_GRADIENT }}
                >
                  Start your request
                  <RiArrowRightLine className="h-4 w-4" />
                </a>
              </div>

              <p className="mt-6 text-xs text-muted-foreground">
                <CompanyCoiDownloadLink tone="quiet">
                  Current certificate of insurance
                </CompanyCoiDownloadLink>
                {" · "}
                See exactly what&apos;s included —{" "}
                <a href="https://try.novaracleaning.com/checklist/commercial-standard" className="font-semibold text-primary hover:underline">
                  commercial checklists
                </a>
                {" · "}
                Looking for home cleaning instead?{" "}
                <a href="https://try.novaracleaning.com/book/zip" className="font-semibold text-primary hover:underline">
                  Book residential
                </a>
              </p>
            </section>
          </div>
        )}

        {/* ─── Step 2: type-specific details ───────────────────────────── */}
        {step === 1 && form.type && (
          <div className="mx-auto max-w-3xl animate-in fade-in slide-in-from-bottom-2 space-y-6 duration-300">
            <div className="space-y-2 text-center">
              {chosen && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-primary">
                  <chosen.icon className="h-3.5 w-3.5" />
                  {chosen.title}
                </span>
              )}
              <h1 className="font-heading text-2xl font-bold tracking-tight sm:text-3xl">
                {isStr ? "Tell us about your rentals" : "Tell us about your space"}
              </h1>
              <p className="mx-auto max-w-lg text-sm text-muted-foreground">
                Rough numbers are fine — this is what we use to work out whether your site needs a
                walkthrough, and to come prepared if it does.
              </p>
            </div>

            <Card className="panel border-0">
              <CardContent className="space-y-4 p-5">
                {!isStr ? (
                  <>
                    <div>
                      <Label>Business name *</Label>
                      <Input value={form.businessName} onChange={(e) => set({ businessName: e.target.value })} placeholder="Acme Dental Group" className="mt-1" />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <Label>Facility type *</Label>
                        <Select value={form.facilityType} onValueChange={(v) => set({ facilityType: v })}>
                          <SelectTrigger className="mt-1"><SelectValue placeholder="Select…" /></SelectTrigger>
                          <SelectContent>
                            {(form.type === "office" ? ["Office", ...FACILITY_TYPES.filter((f) => f !== "Office")] : FACILITY_TYPES).map((f) => (
                              <SelectItem key={f} value={f}>{f}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>How often? *</Label>
                        <Select value={form.frequency} onValueChange={(v) => set({ frequency: v })}>
                          <SelectTrigger className="mt-1"><SelectValue placeholder="Select…" /></SelectTrigger>
                          <SelectContent>{FREQUENCIES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div>
                        <Label># of locations</Label>
                        <Input type="number" min={1} value={form.numLocations} onChange={(e) => set({ numLocations: e.target.value })} placeholder="1" className="mt-1" />
                      </div>
                      <div>
                        <Label>Approx. sq ft</Label>
                        <Input type="number" min={0} value={form.sqft} onChange={(e) => set({ sqft: e.target.value })} placeholder="5000" className="mt-1" />
                        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                          A guess is fine — we confirm it on site.
                        </p>
                      </div>
                      <div>
                        <Label>City</Label>
                        <Input value={form.city} onChange={(e) => set({ city: e.target.value })} placeholder="Columbia" className="mt-1" />
                      </div>
                    </div>
                    <div>
                      <Label>Anything we should know?</Label>
                      <Textarea
                        value={form.currentSituation}
                        onChange={(e) => set({ currentSituation: e.target.value })}
                        placeholder="Switching providers, a new space opening in August, after-hours access only, we need to be named as additional insured…"
                        rows={3}
                        className="mt-1"
                      />
                      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                        Access restrictions, security requirements and insurance wording are worth
                        mentioning now — they affect how the job is staffed.
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <Label># of properties *</Label>
                        <Input type="number" min={1} value={form.numProperties} onChange={(e) => set({ numProperties: e.target.value })} placeholder="3" className="mt-1" />
                      </div>
                      <div>
                        <Label>Turnover frequency *</Label>
                        <Select value={form.turnoverFrequency} onValueChange={(v) => set({ turnoverFrequency: v })}>
                          <SelectTrigger className="mt-1"><SelectValue placeholder="Select…" /></SelectTrigger>
                          <SelectContent>{TURNOVER_FREQUENCIES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <Label>Typical size (beds/baths)</Label>
                        <Input value={form.bedsBaths} onChange={(e) => set({ bedsBaths: e.target.value })} placeholder="2 bed / 2 bath" className="mt-1" />
                      </div>
                      <div>
                        <Label>Individual or entity?</Label>
                        <Select value={form.entityType} onValueChange={(v) => set({ entityType: v })}>
                          <SelectTrigger className="mt-1"><SelectValue placeholder="Select…" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="individual">Individual host</SelectItem>
                            <SelectItem value="entity">LLC / business entity</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <Label>City / area</Label>
                      <Input value={form.city} onChange={(e) => set({ city: e.target.value })} placeholder="Columbia" className="mt-1" />
                    </div>
                    <div>
                      <Label>Anything we should know?</Label>
                      <Textarea
                        value={form.currentSituation}
                        onChange={(e) => set({ currentSituation: e.target.value })}
                        placeholder="Same-day turnaround between guests, lockbox access, linens provided…"
                        rows={3}
                        className="mt-1"
                      />
                    </div>
                  </>
                )}
                <div>
                  <Label>Timing</Label>
                  <Select value={form.timing} onValueChange={(v) => set({ timing: v })}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="When do you need service?" /></SelectTrigger>
                    <SelectContent>{TIMINGS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            <p className="text-center text-xs text-muted-foreground">
              Still no pricing here, and nothing is committed. The next step is just where to reach
              you.
            </p>
          </div>
        )}

        {/* ─── Step 3: contact ─────────────────────────────────────────── */}
        {step === 2 && (
          <div className="mx-auto max-w-3xl animate-in fade-in slide-in-from-bottom-2 space-y-6 duration-300">
            <div className="space-y-2 text-center">
              <h1 className="font-heading text-2xl font-bold tracking-tight sm:text-3xl">
                Where should we reach you?
              </h1>
              <p className="mx-auto max-w-lg text-sm text-muted-foreground">
                A person on our partnerships team reads every request and replies with next steps —
                usually within one business day.
              </p>
            </div>

            <Card className="panel border-0">
              <CardContent className="space-y-4 p-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label>Your name *</Label>
                    <div className="relative mt-1">
                      <RiUserLine className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input className="pl-9" value={form.contactName} onChange={(e) => set({ contactName: e.target.value })} placeholder="Jordan Smith" />
                    </div>
                  </div>
                  {!isStr && (
                    <div>
                      <Label>Your role</Label>
                      <Input value={form.role} onChange={(e) => set({ role: e.target.value })} placeholder="Office manager, owner…" className="mt-1" />
                    </div>
                  )}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label>Email *</Label>
                    <div className="relative mt-1">
                      <RiMailLine className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input className="pl-9" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} placeholder="you@company.com" />
                    </div>
                  </div>
                  <div>
                    <Label>Phone *</Label>
                    <div className="relative mt-1">
                      <RiPhoneLine className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input className="pl-9" type="tel" value={form.phone} onChange={(e) => set({ phone: formatPhoneNumber(e.target.value) })} placeholder="(410) 555-0123" />
                    </div>
                  </div>
                </div>
                {error && <p className="text-sm text-rose-600">{error}</p>}
                <p className="text-[11px] text-muted-foreground">
                  By submitting you agree to be contacted about your request. We never share your
                  info, and this doesn&apos;t sign you up for anything.
                </p>
              </CardContent>
            </Card>

            {/* What happens next — the last thing they read before submitting. */}
            <div className="surface-sunken rounded-2xl p-5">
              <p className="font-heading text-sm font-semibold tracking-tight">What happens next</p>
              <ol className="mt-2.5 space-y-2 text-sm text-muted-foreground">
                {[
                  "A person reviews your request — usually within one business day.",
                  "If your site needs a walkthrough, we offer times that suit you.",
                  "You get one firm price per location, in writing.",
                  "Nothing is binding until you've reviewed it and said yes.",
                ].map((t, i) => (
                  <li key={t} className="flex gap-2.5">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-bold text-primary">
                      {i + 1}
                    </span>
                    {t}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </main>

      {/* ─── Sticky footer nav ─────────────────────────────────────────── */}
      {step > 0 && (
        <footer className="fixed inset-x-0 bottom-0 z-40 border-t border-[color:var(--hairline)] bg-background/95 backdrop-blur-xl">
          <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
            <Button variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={submitting}>
              <RiArrowLeftLine className="mr-1 h-4 w-4" /> Back
            </Button>
            {step === 1 ? (
              <Button className="h-11 flex-1 font-semibold text-white" style={{ background: PURPLE_GRADIENT }} disabled={!detailsValid} onClick={() => setStep(2)}>
                Continue <RiArrowRightLine className="ml-1 h-4 w-4" />
              </Button>
            ) : (
              <Button className="h-11 flex-1 font-semibold text-white" style={{ background: PURPLE_GRADIENT }} disabled={!contactValid || submitting} onClick={() => void submit()}>
                {submitting ? <RiLoader4Line className="mr-2 h-4 w-4 animate-spin" /> : <RiCheckboxCircleFill className="mr-2 h-4 w-4" />}
                Submit request
              </Button>
            )}
          </div>
        </footer>
      )}
    </div>
  );
}
