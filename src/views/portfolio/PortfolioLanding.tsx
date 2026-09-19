"use client";

// ─── try.novaracleaning.com/portfolio ──────────────────────────────────────
//
// One public page for everyone renting out long-term property — one unit
// through a full portfolio. No login. No email gate on the VSL. Messaging
// never switches persona; the calculator is what personalizes. Typical units
// Claim This Rate into existing onboarding; unusual ones Book a Call.

import { useEffect, useMemo, useState } from "react";
import {
  RiAddLine,
  RiArrowRightLine,
  RiBuilding2Line,
  RiCalendarCheckLine,
  RiCameraLine,
  RiCheckboxCircleLine,
  RiDeleteBinLine,
  RiFileList3Line,
  RiLoader4Line,
  RiMapPin2Line,
  RiPhoneLine,
  RiShieldCheckLine,
  RiStarLine,
} from "@remixicon/react";
import { SEO } from "@/components/SEO";
import { BrandAtmosphere } from "@/components/brand/atmosphere";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { BlurFade } from "@/components/magicui/blur-fade";
import { BorderBeam } from "@/components/magicui/border-beam";
import { Marquee } from "@/components/magicui/marquee";
import { Particles } from "@/components/magicui/particles";
import { PortfolioVsl } from "@/components/portfolio/PortfolioVsl";
import { PortfolioCalEmbed } from "@/components/portfolio/PortfolioCalEmbed";
import { formatPhoneNumber } from "@/lib/input-formatters";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";
import {
  DEFAULT_VOLUME_DISCOUNTS,
  PM_SERVICE_LABELS,
  resolveVolumeDiscount,
  type PmServiceType,
} from "@/lib/property-manager/pricing";
import {
  ESTIMATE_DISCLAIMER,
  PM_QUOTE_LOCK_HOURS,
  PORTFOLIO_URL,
  VALUE_STACK,
  expandEstimateUnits,
  formatServiceRange,
  portfolioCtaFor,
  type PortfolioCta,
  type PortfolioMode,
  type ServiceRange,
} from "@/lib/property-manager/landing";

const logo = "/novara-logo.png";
const PURPLE = BRAND.gradient;

const VALUE_ICONS = {
  standing: RiBuilding2Line,
  photos: RiCameraLine,
  volume: RiCheckboxCircleLine,
  invoice: RiFileList3Line,
} as const;

const TESTIMONIALS = [
  {
    name: "Priya S.",
    location: "Silver Spring, MD · 1 rental",
    text: "It's one basement apartment. Same Move-Out rate every turnover — I don't run a portfolio, I just needed someone who shows up.",
    rating: 5,
  },
  {
    name: "Daniel K.",
    location: "Arlington, VA · 2 rentals",
    text: "Two condos. Standing rates meant I wasn't getting a new quote every time a tenant left. Before/after photos made the deposit conversation straightforward.",
    rating: 5,
  },
  {
    name: "Marcus W.",
    location: "Bethesda, MD · 18 units",
    text: "Eighteen doors, one invoice, itemized by unit. The volume tier showed up in the calculator before we even signed.",
    rating: 5,
  },
  {
    name: "Elena R.",
    location: "Alexandria, VA · 40 units",
    text: "Forty ordinary apartments. We claimed the rate and finished onboarding the same afternoon — nobody from their office had to price us first.",
    rating: 5,
  },
];

type EstimateUnit = {
  label: string;
  sqft: string;
  bedrooms: string;
  bathrooms: string;
  zipCode: string;
  address: string;
  city: string;
  state: string;
};

type EstimatePayload = {
  ok: boolean;
  cta: PortfolioCta;
  estimate: boolean;
  disclaimer: string;
  unitCount: number;
  units: Array<{
    label?: string | null;
    sqft: number | null;
    bedrooms: number | null;
    bathrooms: number | null;
    zipCode?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
  }>;
  discount: { percent: number; label: string | null; unitsToNextTier: number | null; nextPercent: number | null };
  ranges: ServiceRange[];
  lockHours?: number;
  reasons: Array<{ reason: string; message: string }>;
  message?: string;
  error?: string;
};

const emptyUnit = (i: number): EstimateUnit => ({
  label: `Unit ${i + 1}`,
  sqft: "",
  bedrooms: "",
  bathrooms: "",
  zipCode: "",
  address: "",
  city: "",
  state: "",
});

function rangeFor(ranges: ServiceRange[], service: PmServiceType): string {
  return formatServiceRange(ranges.find((r) => r.service === service));
}

function numOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export default function PortfolioLanding() {
  const [mode, setMode] = useState<PortfolioMode>("uniform");
  const [unitCount, setUnitCount] = useState("1");
  const [sqft, setSqft] = useState("1200");
  const [bedrooms, setBedrooms] = useState("2");
  const [bathrooms, setBathrooms] = useState("1");
  const [portfolioZip, setPortfolioZip] = useState("");
  const [flaggedAtypical, setFlaggedAtypical] = useState(false);
  const [mixed, setMixed] = useState<EstimateUnit[]>([emptyUnit(0)]);

  const [estimating, setEstimating] = useState(false);
  const [estimate, setEstimate] = useState<EstimatePayload | null>(null);
  const [estimateError, setEstimateError] = useState<string | null>(null);

  const [panel, setPanel] = useState<"none" | "claim" | "call">("none");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [callDone, setCallDone] = useState<{ message: string; calendarUrl: string | null } | null>(null);

  const liveCount =
    mode === "mixed" ? mixed.length : Math.max(0, Math.floor(Number(unitCount) || 0));

  const estimateBody = useMemo(
    () => ({
      mode,
      unitCount: Number(unitCount) || 0,
      portfolioZip,
      flaggedAtypical,
      average: {
        sqft: numOrNull(sqft),
        bedrooms: numOrNull(bedrooms),
        bathrooms: numOrNull(bathrooms),
      },
      units:
        mode === "mixed"
          ? mixed.map((u) => ({
              label: u.label,
              sqft: numOrNull(u.sqft),
              bedrooms: numOrNull(u.bedrooms),
              bathrooms: numOrNull(u.bathrooms),
              zipCode: u.zipCode,
              address: u.address,
              city: u.city,
              state: u.state,
              flaggedNonStandard: flaggedAtypical,
            }))
          : [],
    }),
    [mode, unitCount, sqft, bedrooms, bathrooms, portfolioZip, flaggedAtypical, mixed],
  );

  const localSplit = useMemo(
    () =>
      portfolioCtaFor(expandEstimateUnits(estimateBody), { flaggedAtypical }),
    [estimateBody, flaggedAtypical],
  );

  const liveDiscount = useMemo(() => {
    if (estimate && estimate.unitCount === liveCount) return estimate.discount;
    return resolveVolumeDiscount(DEFAULT_VOLUME_DISCOUNTS, liveCount);
  }, [estimate, liveCount]);

  const runEstimate = async (opts?: { silent?: boolean }) => {
    setEstimating(true);
    if (!opts?.silent) setEstimateError(null);
    try {
      const res = await fetch("/api/portfolio/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(estimateBody),
      });
      const json = (await res.json()) as EstimatePayload;
      if (!res.ok) {
        throw new Error(json.error || json.message || "Could not compute that estimate.");
      }
      setEstimate(json);
    } catch (e) {
      if (!opts?.silent) {
        setEstimateError(e instanceof Error ? e.message : "Could not compute that estimate.");
      }
    } finally {
      setEstimating(false);
    }
  };

  useEffect(() => {
    const t = window.setTimeout(() => void runEstimate({ silent: true }), 350);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimateBody]);

  const openCta = (which: "claim" | "call") => {
    setPanel(which);
    setFormError(null);
    requestAnimationFrame(() => {
      document.getElementById("cta-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const submitClaim = async () => {
    setBusy(true);
    setFormError(null);
    try {
      const res = await fetch("/api/portfolio/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...estimateBody,
          name: contactName,
          contactName,
          email,
          phone,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        if (json?.cta === "book_call") {
          setPanel("call");
          setFormError(json.message || "This portfolio needs a call rather than instant onboarding.");
          return;
        }
        throw new Error(json?.message || json?.error || "Could not claim that rate.");
      }
      window.location.href = json.onboardingUrl;
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Could not claim that rate.");
    } finally {
      setBusy(false);
    }
  };

  const submitCall = async () => {
    setBusy(true);
    setFormError(null);
    try {
      const res = await fetch("/api/portfolio/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...estimateBody,
          name: contactName,
          contactName,
          email,
          phone,
          notes,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.message || json?.error || "Could not submit.");
      setCallDone({ message: json.message, calendarUrl: json.calendarUrl || null });
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Could not submit.");
    } finally {
      setBusy(false);
    }
  };

  const cta: PortfolioCta =
    localSplit.cta === "book_call" || estimate?.cta === "book_call" ? "book_call" : "claim";
  const ctaReasons = estimate?.reasons?.length ? estimate.reasons : localSplit.reasons;
  const estimateFresh = Boolean(estimate && estimate.unitCount === liveCount);
  const lockHours = estimate?.lockHours || PM_QUOTE_LOCK_HOURS;

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <BrandAtmosphere />
      <SEO
        title="Rental Property Cleaning — Standing Rates for One Unit or Fifty"
        description="Reliable move-in, move-out, and standard cleaning for rental properties — whether it's one unit or fifty. Instant standing-rate estimate across Maryland, D.C., and Virginia."
        canonical={PORTFOLIO_URL}
      />

      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-xl hairline-glow">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <img src={logo} alt="Novara Cleaning" className="h-9 w-9 rounded-xl" />
            <span className="font-heading text-lg font-bold tracking-tight">
              Novara<span className="text-primary">Cleaning</span>
            </span>
            <span className="hidden rounded-md bg-brand-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-primary sm:inline">
              Rentals
            </span>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="tel:+18447352070"
              className="hidden items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground sm:flex"
            >
              <RiPhoneLine className="h-4 w-4" />
              (844) 735-2070
            </a>
            <Button size="sm" className="h-9" onClick={() => document.getElementById("estimate")?.scrollIntoView({ behavior: "smooth" })}>
              Instant estimate
            </Button>
          </div>
        </div>
      </header>

      <main className="relative">
        <section className="relative overflow-hidden">
          <Particles className="absolute inset-0 z-0" quantity={42} color={BRAND.primary} ease={80} size={0.5} />
          <div className="absolute inset-0 bg-gradient-to-b from-primary/[0.04] via-background to-background" />
          <div className="relative container mx-auto px-4 pb-16 pt-12 md:pb-24 md:pt-16">
            <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[1.05fr_0.95fr]">
              <div className="space-y-6">
                <BlurFade delay={0.04} inView>
                  <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/[0.04] px-4 py-2">
                    <RiMapPin2Line className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium text-primary">Maryland · Virginia · D.C.</span>
                  </div>
                </BlurFade>
                <BlurFade delay={0.1} inView>
                  <h1 className="font-heading text-4xl font-extrabold leading-[1.1] tracking-tight md:text-5xl lg:text-[48px]">
                    Reliable move-in, move-out, and standard cleaning for your rental properties —{" "}
                    <span className="text-gradient">whether it&apos;s one unit or fifty.</span>
                  </h1>
                </BlurFade>
                <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">
                  Standing rates set once. Photos on every clean. Pricing that improves as you add
                  units — shown live in the calculator, not claimed in a brochure.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button size="lg" onClick={() => document.getElementById("estimate")?.scrollIntoView({ behavior: "smooth" })}>
                    Instant estimate
                    <RiArrowRightLine className="h-4 w-4" />
                  </Button>
                  <Button size="lg" variant="outline" onClick={() => openCta(cta === "book_call" ? "call" : "claim")}>
                    {cta === "book_call" ? "Book a Call" : "Claim This Rate"}
                  </Button>
                </div>
              </div>
              <PortfolioVsl />
            </div>
          </div>
        </section>

        <section className="container mx-auto px-4 py-16 md:py-20">
          <div className="mx-auto max-w-5xl">
            <div className="mb-10 text-center">
              <Badge variant="secondary" className="mb-4 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider">
                True at any scale
              </Badge>
              <h2 className="font-heading text-3xl font-bold md:text-4xl">The same service, from one door to a full portfolio</h2>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {VALUE_STACK.map((item) => {
                const Icon = VALUE_ICONS[item.key];
                return (
                  <Card key={item.key}>
                    <CardContent className="flex gap-4 p-5">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: PURPLE }}>
                        <Icon className="h-5 w-5 text-white" />
                      </div>
                      <div>
                        <h3 className="font-heading font-bold">{item.title}</h3>
                        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </section>

        <section id="estimate" className="scroll-mt-24 border-y border-border/40 bg-muted/20">
          <div className="container mx-auto px-4 py-16 md:py-20">
            <div className="mx-auto max-w-4xl space-y-8">
              <div className="text-center">
                <Badge variant="secondary" className="mb-4 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider">
                  Instant estimate
                </Badge>
                <h2 className="font-heading text-3xl font-bold md:text-4xl">See standing rates and the portfolio tier</h2>
                <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
                  Same residential pricing engine that prices Move-Out, Move-In, and Standard everywhere
                  else in this system. The volume tier updates live as the unit count changes.
                </p>
              </div>

              <Card className="relative overflow-hidden">
                <BorderBeam size={110} duration={10} />
                <CardContent className="relative z-10 space-y-6 p-6 md:p-8">
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(
                      [
                        ["uniform", "Most units are similar", "Enter an average size and we'll copy it across the set."],
                        ["mixed", "Enter units individually", "Different sizes, bedrooms, or a mixed building."],
                      ] as const
                    ).map(([id, title, desc]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setMode(id)}
                        className={cn(
                          "rounded-2xl border px-4 py-3 text-left transition-all",
                          mode === id ? "border-primary/40 bg-primary/[0.06]" : "border-border hover:border-primary/20",
                        )}
                      >
                        <p className="font-semibold">{title}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
                      </button>
                    ))}
                  </div>

                  {mode === "uniform" ? (
                    <div className="space-y-3">
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                        <Field label="Number of units">
                          <Input inputMode="numeric" value={unitCount} onChange={(e) => setUnitCount(e.target.value.replace(/\D/g, "").slice(0, 3))} />
                        </Field>
                        <Field label="Approx. sq ft">
                          <Input inputMode="numeric" value={sqft} onChange={(e) => setSqft(e.target.value.replace(/\D/g, "").slice(0, 5))} />
                        </Field>
                        <Field label="Bedrooms">
                          <Input inputMode="numeric" value={bedrooms} onChange={(e) => setBedrooms(e.target.value.replace(/\D/g, "").slice(0, 2))} />
                        </Field>
                        <Field label="Bathrooms">
                          <Input inputMode="decimal" value={bathrooms} onChange={(e) => setBathrooms(e.target.value.replace(/[^\d.]/g, "").slice(0, 4))} />
                        </Field>
                        <Field label="ZIP (optional)">
                          <Input inputMode="numeric" placeholder="20814" value={portfolioZip} onChange={(e) => setPortfolioZip(e.target.value.replace(/\D/g, "").slice(0, 5))} />
                        </Field>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        ZIP is optional. Without one we show the standing-rate range across served DMV zones.
                        Claiming locks the default-zone rate; final rates confirm at onboarding.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {mixed.map((unit, i) => (
                        <div key={i} className="grid gap-2 rounded-xl border border-border/60 p-3 sm:grid-cols-12">
                          <Input className="sm:col-span-3" placeholder="Label" value={unit.label} onChange={(e) => setMixed((rows) => rows.map((r, idx) => (idx === i ? { ...r, label: e.target.value } : r)))} />
                          <Input className="sm:col-span-2" placeholder="Sq ft" inputMode="numeric" value={unit.sqft} onChange={(e) => setMixed((rows) => rows.map((r, idx) => (idx === i ? { ...r, sqft: e.target.value.replace(/\D/g, "") } : r)))} />
                          <Input className="sm:col-span-2" placeholder="Beds" inputMode="numeric" value={unit.bedrooms} onChange={(e) => setMixed((rows) => rows.map((r, idx) => (idx === i ? { ...r, bedrooms: e.target.value.replace(/\D/g, "") } : r)))} />
                          <Input className="sm:col-span-2" placeholder="Baths" inputMode="decimal" value={unit.bathrooms} onChange={(e) => setMixed((rows) => rows.map((r, idx) => (idx === i ? { ...r, bathrooms: e.target.value } : r)))} />
                          <Input className="sm:col-span-2" placeholder="ZIP" inputMode="numeric" value={unit.zipCode} onChange={(e) => setMixed((rows) => rows.map((r, idx) => (idx === i ? { ...r, zipCode: e.target.value.replace(/\D/g, "").slice(0, 5) } : r)))} />
                          <button
                            type="button"
                            className="inline-flex h-10 items-center justify-center rounded-xl text-muted-foreground hover:text-rose-600 sm:col-span-1"
                            onClick={() => setMixed((rows) => (rows.length === 1 ? rows : rows.filter((_, idx) => idx !== i)))}
                            aria-label="Remove unit"
                          >
                            <RiDeleteBinLine className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                      <Button type="button" variant="outline" size="sm" onClick={() => setMixed((rows) => [...rows, emptyUnit(rows.length)])}>
                        <RiAddLine className="h-4 w-4" /> Add a unit
                      </Button>
                    </div>
                  )}

                  <label className="flex items-start gap-2 text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 accent-[#5C0FFE]"
                      checked={flaggedAtypical}
                      onChange={(e) => setFlaggedAtypical(e.target.checked)}
                    />
                    Something about these units is atypical (unusual types, mixed commercial, or sizes well outside a normal apartment).
                  </label>

                  {estimateError && <p className="text-sm text-rose-700">{estimateError}</p>}

                  <div className="space-y-4 rounded-2xl border border-primary/15 bg-primary/[0.03] p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">Estimate · not a final standing rate</p>
                        <p className="mt-1 font-heading text-xl font-bold">
                          {liveCount} unit{liveCount === 1 ? "" : "s"}
                          {liveDiscount.label ? ` · ${liveDiscount.label}` : ""}
                          {liveDiscount.percent > 0 ? ` (${liveDiscount.percent}% off)` : ""}
                        </p>
                        {liveDiscount.unitsToNextTier != null && liveDiscount.nextPercent != null && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {liveDiscount.unitsToNextTier} more unit{liveDiscount.unitsToNextTier === 1 ? "" : "s"} reaches the {liveDiscount.nextPercent}% tier.
                          </p>
                        )}
                      </div>
                      <span className="rounded-full bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-800">
                        {estimating ? "Updating…" : "Estimate"}
                      </span>
                    </div>
                    {estimateFresh && estimate && estimate.ranges.some((r) => r.minCents > 0) ? (
                      <div className="grid gap-3 sm:grid-cols-3">
                        {(["move_out", "move_in", "standard"] as PmServiceType[]).map((service) => (
                          <div key={service} className="rounded-xl bg-background/80 p-4">
                            <p className="text-xs font-semibold text-muted-foreground">{PM_SERVICE_LABELS[service]}</p>
                            <p className="mt-1 font-heading text-2xl font-bold tabular-nums">{rangeFor(estimate.ranges, service)}</p>
                            <p className="text-[11px] text-muted-foreground">per unit, standing rate</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {cta === "book_call"
                          ? "These units aren't auto-priced. Book a call and we'll set standing rates after a person reviews them."
                          : estimating
                            ? "Pricing from the live residential engine…"
                            : "Standing-rate ranges come from the same residential engine used at registration."}
                      </p>
                    )}
                    <p className="text-xs leading-relaxed text-muted-foreground">{estimate?.disclaimer || ESTIMATE_DISCLAIMER}</p>
                    {ctaReasons.length > 0 && (
                      <ul className="space-y-1 text-xs text-amber-900">
                        {ctaReasons.map((r) => (
                          <li key={`${r.reason}-${r.message}`}>• {r.message}</li>
                        ))}
                      </ul>
                    )}
                    <div className="flex flex-wrap gap-3">
                      {cta === "claim" ? (
                        <Button onClick={() => openCta("claim")}>
                          Claim This Rate
                          <RiArrowRightLine className="h-4 w-4" />
                        </Button>
                      ) : (
                        <Button onClick={() => openCta("call")}>
                          Book a Call
                          <RiCalendarCheckLine className="h-4 w-4" />
                        </Button>
                      )}
                      {cta === "claim" && (
                        <Button variant="outline" onClick={() => openCta("call")}>
                          Prefer to talk first
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div id="cta-form" className="scroll-mt-28">
                {panel === "claim" && cta === "claim" && (
                  <Card>
                    <CardContent className="space-y-5 p-6 md:p-8">
                      <div>
                        <h3 className="font-heading text-2xl font-bold">Claim This Rate</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Name, email, and phone. The quoted rate is locked for {lockHours} hours.
                          You continue into onboarding in this same browser — Legal &amp; Signature, then
                          Unit Registry &amp; Rates (already filled), then Billing. The same link is
                          texted and emailed so you can pick up later.
                        </p>
                      </div>
                      <ContactFields
                        contactName={contactName}
                        setContactName={setContactName}
                        email={email}
                        setEmail={setEmail}
                        phone={phone}
                        setPhone={setPhone}
                      />
                      {formError && <p className="text-sm text-rose-700">{formError}</p>}
                      <Button size="lg" disabled={busy} onClick={() => void submitClaim()}>
                        {busy ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : null}
                        Claim This Rate
                      </Button>
                    </CardContent>
                  </Card>
                )}

                {panel === "call" && !callDone && (
                  <Card>
                    <CardContent className="space-y-5 p-6 md:p-8">
                      <div>
                        <h3 className="font-heading text-2xl font-bold">Book a call</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Unusual or non-standard units are reviewed by a person before onboarding is
                          generated — the same typical/unusual split already used when a unit is registered.
                          Unit count does not decide this.
                        </p>
                      </div>
                      <ContactFields
                        contactName={contactName}
                        setContactName={setContactName}
                        email={email}
                        setEmail={setEmail}
                        phone={phone}
                        setPhone={setPhone}
                      />
                      <div>
                        <Label>What should we know?</Label>
                        <Textarea
                          className="mt-1"
                          rows={3}
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          placeholder="Unusual unit types, a large building, mixed commercial, etc."
                        />
                      </div>
                      {formError && <p className="text-sm text-rose-700">{formError}</p>}
                      <Button size="lg" disabled={busy} onClick={() => void submitCall()}>
                        {busy ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : null}
                        Save my details and show times
                      </Button>
                      <PortfolioCalEmbed name={contactName} email={email} notes={notes} />
                    </CardContent>
                  </Card>
                )}

                {callDone && (
                  <Card>
                    <CardContent className="space-y-4 p-6 text-center md:p-10">
                      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full" style={{ background: PURPLE }}>
                        <RiCheckboxCircleLine className="h-7 w-7 text-white" />
                      </div>
                      <h3 className="font-heading text-2xl font-bold">Pick a time</h3>
                      <p className="text-muted-foreground">{callDone.message}</p>
                      <PortfolioCalEmbed name={contactName} email={email} notes={notes} />
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="container mx-auto px-4 py-16 md:py-20">
          <div className="mx-auto max-w-5xl space-y-12">
            <div className="text-center">
              <Badge variant="secondary" className="mb-4 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider">
                Proof &amp; trust
              </Badge>
              <h2 className="font-heading text-3xl font-bold md:text-4xl">From a single rental to a full portfolio</h2>
            </div>
            <div className="relative overflow-hidden">
              <Marquee pauseOnHover className="[--duration:42s]">
                {TESTIMONIALS.map((t) => (
                  <Card key={t.name} className="w-[300px] shrink-0">
                    <CardContent className="space-y-3 p-5">
                      <div className="flex gap-0.5">
                        {Array.from({ length: t.rating }).map((_, i) => (
                          <RiStarLine key={i} className="h-4 w-4 fill-amber-400 text-amber-400" />
                        ))}
                      </div>
                      <p className="text-sm italic text-muted-foreground">&ldquo;{t.text}&rdquo;</p>
                      <p className="text-sm font-semibold">{t.name}</p>
                      <p className="text-xs text-muted-foreground">{t.location}</p>
                    </CardContent>
                  </Card>
                ))}
              </Marquee>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardContent className="flex gap-4 p-5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: PURPLE }}>
                    <RiShieldCheckLine className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <h3 className="font-heading font-bold">The Spotless Guarantee</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      If work is missed, tell us within 24 hours of the visit — or before tenant possession
                      if that is sooner. We return to correct covered items at no additional charge when
                      the unit is accessible. Tenant-caused conditions are not a reclean.
                    </p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="flex gap-4 p-5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: PURPLE }}>
                    <RiMapPin2Line className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <h3 className="font-heading font-bold">We serve the DMV</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      Maryland, Virginia, and Washington, D.C. A unit outside our current service area
                      is reviewed by our team rather than auto-priced.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.06] to-accent/[0.04]" />
          <div className="relative container mx-auto px-4 py-16 md:py-20">
            <div className="relative mx-auto max-w-2xl overflow-hidden rounded-3xl panel p-10 text-center sm:p-12">
              <BorderBeam size={120} duration={8} />
              <h2 className="font-heading text-3xl font-bold md:text-4xl">Typical units? Claim the rate. Unusual ones? Book a call.</h2>
              <p className="mt-3 text-muted-foreground">
                Ordinary apartments — one or forty — start onboarding immediately. Unusual properties
                get a person before onboarding is generated. Same split the registry already uses,
                independent of unit count.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Button size="lg" onClick={() => openCta(cta === "book_call" ? "call" : "claim")}>
                  {cta === "book_call" ? "Book a Call" : "Claim This Rate"}
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => {
                    if (cta === "book_call") {
                      document.getElementById("estimate")?.scrollIntoView({ behavior: "smooth" });
                      return;
                    }
                    openCta("call");
                  }}
                >
                  {cta === "book_call" ? "See the calculator" : "Book a Call"}
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/40 py-8 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Novara Cleaning · Maryland, Virginia, D.C. · Rental property cleaning
      </footer>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function ContactFields({
  contactName, setContactName, email, setEmail, phone, setPhone,
}: {
  contactName: string; setContactName: (v: string) => void;
  email: string; setEmail: (v: string) => void;
  phone: string; setPhone: (v: string) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Label>Your name</Label>
        <Input className="mt-1" value={contactName} onChange={(e) => setContactName(e.target.value)} />
      </div>
      <div>
        <Label>Email</Label>
        <Input className="mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <Label>Phone</Label>
        <Input className="mt-1" type="tel" value={phone} onChange={(e) => setPhone(formatPhoneNumber(e.target.value))} />
      </div>
    </div>
  );
}
