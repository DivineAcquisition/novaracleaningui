"use client";

// ─── commercial.novaracleaning.com — public partnership intake ──────────────
//
// Front-of-funnel for three relationship types: Commercial, Office, STR/Airbnb.
// The first question routes everything; each type sees only its own fields.
// Captures interest — NEVER prices (admin sets rates later). Submissions become
// typed leads in the Partnerships Hub, deduped on email, and notify the team.
//
// Visual language intentionally mirrors the residential booking funnel:
// sticky header + progress bar, card-select steps, violet gradient CTAs.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  RiArrowLeftLine,
  RiArrowRightLine,
  RiBuilding2Line,
  RiBuilding4Line,
  RiCheckboxCircleFill,
  RiHomeSmile2Line,
  RiLoader4Line,
  RiMailLine,
  RiPhoneLine,
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
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

const PURPLE_GRADIENT = BRAND.gradient;

type PartnerType = "commercial" | "office" | "str";

const TYPES: Array<{ id: PartnerType; title: string; desc: string; icon: typeof RiBuilding2Line }> = [
  {
    id: "commercial",
    title: "Commercial cleaning",
    desc: "Retail, medical, gyms, restaurants — recurring service for your business.",
    icon: RiBuilding2Line,
  },
  {
    id: "office",
    title: "Office cleaning",
    desc: "Offices and workspaces — scheduled cleaning around your team's hours.",
    icon: RiBuilding4Line,
  },
  {
    id: "str",
    title: "Airbnb / STR turnovers",
    desc: "Short-term-rental hosts — reliable same-day turnovers for your properties.",
    icon: RiHomeSmile2Line,
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
    <div className="min-h-screen bg-background">
      <SEO title="Partner with Novara Cleaning — Commercial, Office & STR" description="Commercial cleaning contracts, office cleaning, and Airbnb/STR turnover partnerships in the Baltimore area. Tell us what you need and our team will reach out." />

      {/* ─── Sticky header + progress (residential-funnel language) ────── */}
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur-xl border-b border-border hairline-glow">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <img src="/novara-logo.png" alt="Novara Cleaning" className="h-8" />
          <span className="text-xs font-semibold text-slate-500">Step {step + 1} of 3</span>
        </div>
        <div className="h-1 bg-slate-100">
          <div className="h-1 transition-all duration-500" style={{ width: `${progress}%`, background: PURPLE_GRADIENT }} />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 pb-28">
        {/* ─── Step 1: what are you looking for? ───────────────────────── */}
        {step === 0 && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="text-center space-y-2">
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">What are you looking for?</h1>
              <p className="text-slate-500 text-sm sm:text-base">Pick the partnership that fits — we'll only ask what's relevant.</p>
            </div>
            <div className="grid gap-3">
              {TYPES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => { set({ type: t.id }); setStep(1); }}
                  className={cn(
                    "text-left rounded-2xl border-2 bg-white p-5 transition-all hover:shadow-md",
                    form.type === t.id ? "border-violet-500 shadow-md" : "border-slate-200 hover:border-violet-300",
                  )}
                >
                  <div className="flex items-start gap-4">
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: PURPLE_GRADIENT }}>
                      <t.icon className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <p className="font-bold text-slate-900">{t.title}</p>
                      <p className="text-sm text-slate-500 mt-0.5">{t.desc}</p>
                    </div>
                    <RiArrowRightLine className="w-5 h-5 text-slate-300 ml-auto mt-2" />
                  </div>
                </button>
              ))}
            </div>
            <p className="text-center text-xs text-slate-400">
              See exactly what&apos;s included —{" "}
              <a href="https://try.novaracleaning.com/checklist/commercial-standard" className="text-violet-600 font-semibold hover:underline">commercial checklists</a>
              {" · "}
              Looking for home cleaning instead?{" "}
              <a href="https://try.novaracleaning.com/book/zip" className="text-violet-600 font-semibold hover:underline">Book residential</a>
            </p>
          </div>
        )}

        {/* ─── Step 2: type-specific details ───────────────────────────── */}
        {step === 1 && form.type && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="text-center space-y-2">
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">
                {isStr ? "Tell us about your rentals" : "Tell us about your space"}
              </h1>
              <p className="text-slate-500 text-sm">No pricing here — our team reviews and reaches out with next steps.</p>
            </div>

            <Card className="border-slate-200">
              <CardContent className="p-5 space-y-4">
                {!isStr ? (
                  <>
                    <div>
                      <Label>Business name *</Label>
                      <Input value={form.businessName} onChange={(e) => set({ businessName: e.target.value })} placeholder="Acme Dental Group" className="mt-1" />
                    </div>
                    <div className="grid sm:grid-cols-2 gap-4">
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
                    <div className="grid sm:grid-cols-3 gap-4">
                      <div>
                        <Label># of locations</Label>
                        <Input type="number" min={1} value={form.numLocations} onChange={(e) => set({ numLocations: e.target.value })} placeholder="1" className="mt-1" />
                      </div>
                      <div>
                        <Label>Approx. sq ft</Label>
                        <Input type="number" min={0} value={form.sqft} onChange={(e) => set({ sqft: e.target.value })} placeholder="5000" className="mt-1" />
                      </div>
                      <div>
                        <Label>City</Label>
                        <Input value={form.city} onChange={(e) => set({ city: e.target.value })} placeholder="Baltimore" className="mt-1" />
                      </div>
                    </div>
                    <div>
                      <Label>Current situation</Label>
                      <Textarea value={form.currentSituation} onChange={(e) => set({ currentSituation: e.target.value })} placeholder="e.g. switching providers, new space opening in August…" rows={2} className="mt-1" />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="grid sm:grid-cols-2 gap-4">
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
                    <div className="grid sm:grid-cols-2 gap-4">
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
                      <Input value={form.city} onChange={(e) => set({ city: e.target.value })} placeholder="Baltimore" className="mt-1" />
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
          </div>
        )}

        {/* ─── Step 3: contact ─────────────────────────────────────────── */}
        {step === 2 && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="text-center space-y-2">
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Where should we reach you?</h1>
              <p className="text-slate-500 text-sm">Our partnerships team reviews every request and reaches out with next steps — usually within one business day.</p>
            </div>
            <Card className="border-slate-200">
              <CardContent className="p-5 space-y-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <Label>Your name *</Label>
                    <div className="relative mt-1">
                      <RiUserLine className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
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
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <Label>Email *</Label>
                    <div className="relative mt-1">
                      <RiMailLine className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <Input className="pl-9" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} placeholder="you@company.com" />
                    </div>
                  </div>
                  <div>
                    <Label>Phone *</Label>
                    <div className="relative mt-1">
                      <RiPhoneLine className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <Input className="pl-9" type="tel" value={form.phone} onChange={(e) => set({ phone: formatPhoneNumber(e.target.value) })} placeholder="(410) 555-0123" />
                    </div>
                  </div>
                </div>
                {error && <p className="text-sm text-rose-600">{error}</p>}
                <p className="text-[11px] text-slate-400">
                  By submitting you agree to be contacted about your request. We never share your info.
                </p>
              </CardContent>
            </Card>
          </div>
        )}
      </main>

      {/* ─── Sticky footer nav ─────────────────────────────────────────── */}
      {step > 0 && (
        <footer className="fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-slate-200">
          <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
            <Button variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={submitting}>
              <RiArrowLeftLine className="w-4 h-4 mr-1" /> Back
            </Button>
            {step === 1 ? (
              <Button className="flex-1 h-11 text-white font-semibold" style={{ background: PURPLE_GRADIENT }} disabled={!detailsValid} onClick={() => setStep(2)}>
                Continue <RiArrowRightLine className="w-4 h-4 ml-1" />
              </Button>
            ) : (
              <Button className="flex-1 h-11 text-white font-semibold" style={{ background: PURPLE_GRADIENT }} disabled={!contactValid || submitting} onClick={() => void submit()}>
                {submitting ? <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" /> : <RiCheckboxCircleFill className="w-4 h-4 mr-2" />}
                Submit request
              </Button>
            )}
          </div>
        </footer>
      )}
    </div>
  );
}
