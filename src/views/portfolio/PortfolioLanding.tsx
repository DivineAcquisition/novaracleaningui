"use client";

// ─── try.novaracleaning.com/portfolio ──────────────────────────────────────
//
// Public acquisition page for property managers and rental-portfolio owners.
// No login. No email gate on the VSL. The calculator calls the live
// residential standing-rate engine. Typical portfolios open the existing
// tokenized onboarding flow with units pre-filled; unusual ones book a call.

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
  RiUserFollowLine,
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
import { formatPhoneNumber } from "@/lib/input-formatters";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";
import { PM_SERVICE_LABELS, type PmServiceType } from "@/lib/property-manager/pricing";
import {
  ESTIMATE_DISCLAIMER,
  MAX_LANDING_UNITS,
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
  invoice: RiFileList3Line,
  photos: RiCameraLine,
  volume: RiCheckboxCircleLine,
  contact: RiUserFollowLine,
} as const;

const TESTIMONIALS = [
  {
    name: "Sarah M.",
    location: "Bethesda, MD",
    text: "Novara is the first cleaning service that actually shows up when they say they will. My home has never looked better.",
    rating: 5,
  },
  {
    name: "James R.",
    location: "Rockville, MD",
    text: "I signed up for the membership and it's been a game-changer. Same team every time, and they know exactly how I like things.",
    rating: 5,
  },
  {
    name: "Michelle T.",
    location: "Silver Spring, MD",
    text: "The deep clean exceeded my expectations. Every corner was spotless. Worth every penny.",
    rating: 5,
  },
];

const TIMINGS = ["As soon as possible", "Within 2 weeks", "Within a month", "Just exploring"];

const UNIT_PRESETS = [
  { id: "1", label: "1 bed", hint: "~800 sq ft", sqft: "800", bedrooms: "1", bathrooms: "1" },
  { id: "2", label: "2 bed", hint: "~1,200 sq ft", sqft: "1200", bedrooms: "2", bathrooms: "1" },
  { id: "3", label: "3 bed", hint: "~1,600 sq ft", sqft: "1600", bedrooms: "3", bathrooms: "2" },
  { id: "4", label: "4 bed", hint: "~2,200 sq ft", sqft: "2200", bedrooms: "4", bathrooms: "2.5" },
] as const;

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

export default function PortfolioLanding() {
  const [mode, setMode] = useState<PortfolioMode>("uniform");
  const [unitCount, setUnitCount] = useState("8");
  const [sqft, setSqft] = useState("1200");
  const [bedrooms, setBedrooms] = useState("2");
  const [bathrooms, setBathrooms] = useState("1");
  const [portfolioZip, setPortfolioZip] = useState("");
  const [flaggedAtypical, setFlaggedAtypical] = useState(false);
  const [showCustomSize, setShowCustomSize] = useState(false);
  const [mixed, setMixed] = useState<EstimateUnit[]>([
    { ...emptyUnit(0), sqft: "1200", bedrooms: "2", bathrooms: "1" },
    { ...emptyUnit(1), sqft: "1200", bedrooms: "2", bathrooms: "1" },
  ]);

  const [estimating, setEstimating] = useState(false);
  const [estimate, setEstimate] = useState<EstimatePayload | null>(null);
  const [estimateError, setEstimateError] = useState<string | null>(null);

  const [panel, setPanel] = useState<"none" | "start" | "call">("none");
  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [timing, setTiming] = useState("");
  const [unitDrafts, setUnitDrafts] = useState<EstimateUnit[]>([]);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [callDone, setCallDone] = useState<{ message: string; calendarUrl: string | null } | null>(null);

  const body = useMemo(() => {
    const base = {
      mode,
      unitCount: Number(unitCount) || 0,
      portfolioZip,
      flaggedAtypical,
      average: { sqft: Number(sqft) || null, bedrooms: Number(bedrooms) || null, bathrooms: Number(bathrooms) || 0 },
      units:
        mode === "mixed"
          ? mixed.map((u) => ({
              label: u.label,
              sqft: Number(u.sqft) || null,
              bedrooms: Number(u.bedrooms) || null,
              bathrooms: Number(u.bathrooms) || 0,
              zipCode: u.zipCode,
              address: u.address,
              city: u.city,
              state: u.state,
            }))
          : unitDrafts.map((u) => ({
              label: u.label,
              sqft: Number(u.sqft) || Number(sqft) || null,
              bedrooms: Number(u.bedrooms) || Number(bedrooms) || null,
              bathrooms: Number(u.bathrooms) || Number(bathrooms) || 0,
              zipCode: u.zipCode || portfolioZip,
              address: u.address,
              city: u.city,
              state: u.state,
            })),
    };
    return base;
  }, [mode, unitCount, sqft, bedrooms, bathrooms, portfolioZip, flaggedAtypical, mixed, unitDrafts]);

  const localSplit = useMemo(
    () =>
      portfolioCtaFor(
        expandEstimateUnits({
          mode,
          unitCount: Number(unitCount) || 0,
          flaggedAtypical,
          average: {
            sqft: Number(sqft) || null,
            bedrooms: Number(bedrooms) || null,
            bathrooms: Number(bathrooms) || 0,
          },
          units:
            mode === "mixed"
              ? mixed.map((u) => ({
                  label: u.label,
                  sqft: Number(u.sqft) || null,
                  bedrooms: Number(u.bedrooms) || null,
                  bathrooms: Number(u.bathrooms) || 0,
                  zipCode: u.zipCode,
                  flaggedNonStandard: flaggedAtypical,
                }))
              : [],
        }),
        { flaggedAtypical },
      ),
    [mode, unitCount, sqft, bedrooms, bathrooms, flaggedAtypical, mixed],
  );

  const runEstimate = async (opts?: { silent?: boolean; signal?: AbortSignal }) => {
    setEstimating(true);
    if (!opts?.silent) setEstimateError(null);
    try {
      const res = await fetch("/api/portfolio/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: opts?.signal,
        body: JSON.stringify({
          mode,
          unitCount: Number(unitCount) || 0,
          portfolioZip,
          flaggedAtypical,
          average: { sqft: Number(sqft) || null, bedrooms: Number(bedrooms) || null, bathrooms: Number(bathrooms) || 0 },
          units:
            mode === "mixed"
              ? mixed.map((u) => ({
                  label: u.label,
                  sqft: Number(u.sqft) || null,
                  bedrooms: Number(u.bedrooms) || null,
                  bathrooms: Number(u.bathrooms) || 0,
                  zipCode: u.zipCode || portfolioZip,
                }))
              : [],
        }),
      });
      const json = (await res.json()) as EstimatePayload;
      if (!res.ok) {
        throw new Error(json.error || json.message || "Could not compute that estimate.");
      }
      setEstimate(json);
      setUnitDrafts(
        (json.units || []).map((u, i) => ({
          label: u.label || `Unit ${i + 1}`,
          sqft: u.sqft != null ? String(u.sqft) : sqft,
          bedrooms: u.bedrooms != null ? String(u.bedrooms) : bedrooms,
          bathrooms: u.bathrooms != null ? String(u.bathrooms) : bathrooms,
          zipCode: u.zipCode || portfolioZip,
          address: u.address || "",
          city: u.city || "",
          state: u.state || "",
        })),
      );
    } catch (e) {
      if (opts?.signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
      if (!opts?.silent) {
        setEstimateError(e instanceof Error ? e.message : "Could not compute that estimate.");
      }
    } finally {
      if (!opts?.signal?.aborted) setEstimating(false);
    }
  };

  useEffect(() => {
    const ac = new AbortController();
    const t = window.setTimeout(() => {
      void runEstimate({ silent: true, signal: ac.signal });
    }, 280);
    return () => {
      window.clearTimeout(t);
      ac.abort();
    };
    // Price as they type — same engine, no Update click.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, unitCount, sqft, bedrooms, bathrooms, portfolioZip, flaggedAtypical, mixed]);

  const openCta = (which: "start" | "call") => {
    setPanel(which);
    setFormError(null);
    requestAnimationFrame(() => {
      document.getElementById("cta-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const submitStart = async () => {
    setBusy(true);
    setFormError(null);
    try {
      const res = await fetch("/api/portfolio/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...body,
          portfolioZip,
          units:
            mode === "mixed"
              ? mixed.map((u) => ({
                  label: u.label,
                  sqft: Number(u.sqft) || null,
                  bedrooms: Number(u.bedrooms) || null,
                  bathrooms: Number(u.bathrooms) || 0,
                  zipCode: u.zipCode || portfolioZip,
                  address: u.address,
                  city: u.city,
                  state: u.state,
                }))
              : Array.from({ length: Math.min(MAX_LANDING_UNITS, Math.max(0, Math.floor(Number(unitCount) || 0))) }, (_, i) => {
                  const d = unitDrafts[i];
                  return {
                    label: d?.label || `Unit ${i + 1}`,
                    sqft: Number(d?.sqft || sqft) || null,
                    bedrooms: Number(d?.bedrooms || bedrooms) || null,
                    bathrooms: Number(d?.bathrooms || bathrooms) || 0,
                    zipCode: d?.zipCode || portfolioZip,
                    address: d?.address || "",
                    city: d?.city || "",
                    state: d?.state || "",
                  };
                }),
          companyName,
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
        throw new Error(json?.message || json?.error || "Could not start onboarding.");
      }
      window.location.href = json.onboardingUrl;
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Could not start onboarding.");
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
          ...body,
          companyName,
          contactName,
          email,
          phone,
          notes,
          timing,
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

  const liveCount =
    mode === "mixed" ? mixed.length : Math.max(0, Math.floor(Number(unitCount) || 0));
  const quote = estimate && estimate.unitCount === liveCount ? estimate : null;
  const cta: PortfolioCta =
    localSplit.cta === "book_call" || quote?.cta === "book_call" ? "book_call" : "get_started";
  const ctaReasons = quote?.reasons?.length ? quote.reasons : localSplit.reasons;
  const selectedPreset =
    UNIT_PRESETS.find((p) => p.sqft === sqft && p.bedrooms === bedrooms && p.bathrooms === bathrooms)?.id ?? "custom";
  const unitSummary =
    mode === "mixed"
      ? `${mixed.length} unit${mixed.length === 1 ? "" : "s"} entered individually`
      : `${Math.max(0, Math.floor(Number(unitCount) || 0))} × ${bedrooms || "—"} bed · ${Number(sqft) ? Number(sqft).toLocaleString() : "—"} sq ft`;

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <BrandAtmosphere />
      <SEO
        title="Property Manager Turnover Cleaning — Standing Rates, No Re-quoting"
        description="One standing rate per rental unit, set once. Consolidated invoicing, before/after photos, and portfolio pricing across Maryland, D.C., and Virginia."
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
              Portfolio
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
              Get an estimate
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
                  <h1 className="font-heading text-4xl font-extrabold leading-[1.1] tracking-tight md:text-5xl lg:text-[52px]">
                    One standing rate per unit, set once —{" "}
                    <span className="text-gradient">no re-quoting every turnover.</span>
                  </h1>
                </BlurFade>
                <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">
                  Unreliable cleaners across multiple units. Inconsistent quality from property to
                  property. Getting re-quoted or chased down every time a unit turns over. We replace
                  that with a registry: typical units auto-price, unusual ones get a person.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button size="lg" onClick={() => document.getElementById("estimate")?.scrollIntoView({ behavior: "smooth" })}>
                    Instant portfolio estimate
                    <RiArrowRightLine className="h-4 w-4" />
                  </Button>
                  <Button size="lg" variant="outline" onClick={() => openCta("call")}>
                    Book a call
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
                What you actually get
              </Badge>
              <h2 className="font-heading text-3xl font-bold md:text-4xl">Built into the portfolio, not promised in a brochure</h2>
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
            <div className="mx-auto max-w-5xl space-y-8">
              <div className="text-center">
                <Badge variant="secondary" className="mb-4 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider">
                  Instant portfolio estimate
                </Badge>
                <h2 className="font-heading text-3xl font-bold md:text-4xl">How many units, and how big?</h2>
                <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
                  Same residential engine we use at registration. This is an estimate — not a final standing rate.
                </p>
              </div>

              <Card className="relative overflow-hidden">
                <BorderBeam size={110} duration={10} />
                <CardContent className="relative z-10 p-6 md:p-8">
                  <div className="grid items-start gap-8 lg:grid-cols-2">
                    <div className="space-y-5">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">How many units?</p>
                        {mode === "mixed" ? (
                          <p className="mt-1.5 font-heading text-2xl font-bold tabular-nums">{mixed.length}</p>
                        ) : (
                          <Input
                            className="mt-1.5 h-12 max-w-[140px] text-lg font-semibold tabular-nums"
                            inputMode="numeric"
                            value={unitCount}
                            onChange={(e) => setUnitCount(e.target.value.replace(/\D/g, "").slice(0, 3))}
                          />
                        )}
                      </div>

                      {mode === "uniform" ? (
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Typical unit</p>
                          <div className="mt-1.5 flex flex-wrap gap-2">
                            {UNIT_PRESETS.map((p) => (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => {
                                  setSqft(p.sqft);
                                  setBedrooms(p.bedrooms);
                                  setBathrooms(p.bathrooms);
                                  setShowCustomSize(false);
                                }}
                                className={cn(
                                  "rounded-xl border px-3 py-2 text-left transition-all",
                                  selectedPreset === p.id
                                    ? "border-primary/40 bg-primary/[0.06]"
                                    : "border-border hover:border-primary/20",
                                )}
                              >
                                <p className="text-sm font-semibold">{p.label}</p>
                                <p className="text-[11px] text-muted-foreground">{p.hint}</p>
                              </button>
                            ))}
                          </div>
                          {showCustomSize ? (
                          <div className="mt-3 grid gap-3 sm:grid-cols-3">
                            <Field label="Sq ft">
                              <Input inputMode="numeric" value={sqft} onChange={(e) => setSqft(e.target.value.replace(/\D/g, "").slice(0, 5))} />
                            </Field>
                            <Field label="Beds">
                              <Input inputMode="numeric" value={bedrooms} onChange={(e) => setBedrooms(e.target.value.replace(/\D/g, "").slice(0, 2))} />
                            </Field>
                            <Field label="Baths">
                              <Input inputMode="decimal" value={bathrooms} onChange={(e) => setBathrooms(e.target.value.replace(/[^\d.]/g, "").slice(0, 4))} />
                            </Field>
                          </div>
                          ) : (
                            <button
                              type="button"
                              className="mt-2 text-xs font-medium text-primary hover:underline"
                              onClick={() => setShowCustomSize(true)}
                            >
                              Adjust square footage or baths
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Each unit</p>
                          <p className="text-xs text-muted-foreground">
                            Two starter rows — add one per unit. Sizes don&apos;t need to match.
                          </p>
                          {mixed.map((unit, i) => (
                            <div key={i} className="grid grid-cols-[1fr_70px_70px_36px] gap-2">
                              <Input placeholder="Sq ft" inputMode="numeric" value={unit.sqft} onChange={(e) => setMixed((rows) => rows.map((r, idx) => (idx === i ? { ...r, sqft: e.target.value.replace(/\D/g, "") } : r)))} />
                              <Input placeholder="Beds" inputMode="numeric" value={unit.bedrooms} onChange={(e) => setMixed((rows) => rows.map((r, idx) => (idx === i ? { ...r, bedrooms: e.target.value.replace(/\D/g, "") } : r)))} />
                              <Input placeholder="Baths" inputMode="decimal" value={unit.bathrooms} onChange={(e) => setMixed((rows) => rows.map((r, idx) => (idx === i ? { ...r, bathrooms: e.target.value } : r)))} />
                              <button
                                type="button"
                                className="inline-flex h-10 items-center justify-center rounded-xl text-muted-foreground hover:text-rose-600"
                                onClick={() => setMixed((rows) => (rows.length <= 1 ? rows : rows.filter((_, idx) => idx !== i)))}
                                aria-label="Remove unit"
                              >
                                <RiDeleteBinLine className="h-4 w-4" />
                              </button>
                            </div>
                          ))}
                          {mixed.length < MAX_LANDING_UNITS && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setMixed((rows) => [
                                  ...rows,
                                  {
                                    ...emptyUnit(rows.length),
                                    sqft,
                                    bedrooms,
                                    bathrooms,
                                    zipCode: portfolioZip,
                                  },
                                ])
                              }
                            >
                              <RiAddLine className="h-4 w-4" /> Add a unit
                            </Button>
                          )}
                        </div>
                      )}

                      <Field label="ZIP (optional)">
                        <Input
                          className="max-w-[160px]"
                          inputMode="numeric"
                          placeholder="20814"
                          value={portfolioZip}
                          onChange={(e) => setPortfolioZip(e.target.value.replace(/\D/g, "").slice(0, 5))}
                        />
                        <p className="mt-1 text-[11px] text-muted-foreground">Tightens the range. Required to Get Started.</p>
                      </Field>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                        <button
                          type="button"
                          className="font-medium text-primary hover:underline"
                          onClick={() => {
                            if (mode === "uniform") {
                              setMixed([
                                { ...emptyUnit(0), sqft, bedrooms, bathrooms, zipCode: portfolioZip },
                                { ...emptyUnit(1), sqft, bedrooms, bathrooms, zipCode: portfolioZip },
                              ]);
                              setMode("mixed");
                            } else {
                              setUnitCount(String(mixed.length || 1));
                              setMode("uniform");
                            }
                          }}
                        >
                          {mode === "uniform" ? "Units aren't all the same" : "Use one typical size"}
                        </button>
                        <label className="inline-flex items-center gap-2 text-muted-foreground">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-[#5C0FFE]"
                            checked={flaggedAtypical}
                            onChange={(e) => setFlaggedAtypical(e.target.checked)}
                          />
                          Not standard homes
                        </label>
                      </div>
                    </div>

                    <div className="space-y-4 rounded-2xl border border-primary/15 bg-primary/[0.03] p-5 lg:sticky lg:top-24">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">Estimate · not a final standing rate</p>
                          <p className="mt-1 font-heading text-xl font-bold">
                            {quote
                              ? `${quote.unitCount} unit${quote.unitCount === 1 ? "" : "s"}${
                                  quote.discount.label ? ` · ${quote.discount.label}` : ""
                                }${quote.discount.percent > 0 ? ` (${quote.discount.percent}% off)` : ""}`
                              : unitSummary}
                          </p>
                        </div>
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-800">
                          {estimating ? <RiLoader4Line className="h-3.5 w-3.5 animate-spin" /> : null}
                          Estimate
                        </span>
                      </div>
                      {quote && quote.ranges.some((r) => r.minCents > 0) ? (
                        <>
                          <div className="grid gap-3 sm:grid-cols-3">
                            {(["move_out", "move_in", "standard"] as PmServiceType[]).map((service) => (
                              <div key={service} className="rounded-xl bg-background/80 p-4">
                                <p className="text-xs font-semibold text-muted-foreground">{PM_SERVICE_LABELS[service]}</p>
                                <p className="mt-1 font-heading text-xl font-bold tabular-nums sm:text-2xl">{rangeFor(quote.ranges, service)}</p>
                                <p className="text-[11px] text-muted-foreground">per unit</p>
                              </div>
                            ))}
                          </div>
                          {quote.discount.unitsToNextTier != null && quote.discount.nextPercent != null && (
                            <p className="text-xs text-muted-foreground">
                              {quote.discount.unitsToNextTier} more unit{quote.discount.unitsToNextTier === 1 ? "" : "s"} reaches {quote.discount.nextPercent}% off.
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          {cta === "book_call"
                            ? "This portfolio isn't auto-priced. Book a call and we'll set standing rates after a person reviews the units."
                            : "Enter the unit count and size — the live engine fills the range."}
                        </p>
                      )}
                      {estimateError && <p className="text-sm text-rose-700">{estimateError}</p>}
                      <p className="text-xs leading-relaxed text-muted-foreground">{quote?.disclaimer || ESTIMATE_DISCLAIMER}</p>
                      {ctaReasons.length > 0 && (
                        <ul className="space-y-1 text-xs text-amber-900">
                          {ctaReasons.map((r) => (
                            <li key={`${r.reason}-${r.message}`}>• {r.message}</li>
                          ))}
                        </ul>
                      )}
                      <div className="flex flex-wrap gap-3">
                        {cta === "get_started" ? (
                          <Button onClick={() => openCta("start")}>
                            Get Started
                            <RiArrowRightLine className="h-4 w-4" />
                          </Button>
                        ) : (
                          <Button onClick={() => openCta("call")}>
                            Book a Call
                            <RiCalendarCheckLine className="h-4 w-4" />
                          </Button>
                        )}
                        {cta === "get_started" && (
                          <Button variant="outline" onClick={() => openCta("call")}>
                            Prefer to talk first
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div id="cta-form" className="scroll-mt-28">
                {panel === "start" && (
                  <Card>
                    <CardContent className="space-y-5 p-6 md:p-8">
                      <div>
                        <h3 className="font-heading text-2xl font-bold">Get started</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Typical units go straight into onboarding. These units carry into the registry —
                          you confirm addresses and standing rates on the next page.
                        </p>
                      </div>
                      <ContactFields
                        companyName={companyName} setCompanyName={setCompanyName}
                        contactName={contactName} setContactName={setContactName}
                        email={email} setEmail={setEmail}
                        phone={phone} setPhone={setPhone}
                      />
                      <div>
                        <Label>ZIP for these units</Label>
                        <Input
                          className="mt-1 max-w-[180px]"
                          inputMode="numeric"
                          placeholder="20814"
                          value={portfolioZip}
                          onChange={(e) => setPortfolioZip(e.target.value.replace(/\D/g, "").slice(0, 5))}
                        />
                        <p className="mt-2 text-sm text-muted-foreground">{unitSummary}. Addresses are confirmed on page 2 of onboarding.</p>
                      </div>
                      {formError && <p className="text-sm text-rose-700">{formError}</p>}
                      <Button size="lg" disabled={busy} onClick={() => void submitStart()}>
                        {busy ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : null}
                        Continue to onboarding
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
                          Large or non-standard portfolios are reviewed by a person before onboarding is
                          generated — the same typical/unusual split already used when a unit is registered.
                        </p>
                      </div>
                      <ContactFields
                        companyName={companyName} setCompanyName={setCompanyName}
                        contactName={contactName} setContactName={setContactName}
                        email={email} setEmail={setEmail}
                        phone={phone} setPhone={setPhone}
                      />
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <Label>Timing</Label>
                          <select
                            className="mt-1 flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                            value={timing}
                            onChange={(e) => setTiming(e.target.value)}
                          >
                            <option value="">Select…</option>
                            {TIMINGS.map((t) => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                        </div>
                        <div className="sm:col-span-2">
                          <Label>What should we know?</Label>
                          <Textarea className="mt-1" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Unusual unit types, a large building, mixed commercial, etc." />
                        </div>
                      </div>
                      {formError && <p className="text-sm text-rose-700">{formError}</p>}
                      <Button size="lg" disabled={busy} onClick={() => void submitCall()}>
                        {busy ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : null}
                        Request a call
                      </Button>
                    </CardContent>
                  </Card>
                )}

                {callDone && (
                  <Card>
                    <CardContent className="space-y-4 p-6 text-center md:p-10">
                      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full" style={{ background: PURPLE }}>
                        <RiCheckboxCircleLine className="h-7 w-7 text-white" />
                      </div>
                      <h3 className="font-heading text-2xl font-bold">Request received</h3>
                      <p className="text-muted-foreground">{callDone.message}</p>
                      {callDone.calendarUrl && (
                        <div className="overflow-hidden rounded-xl border border-border">
                          <iframe title="Schedule a call" src={callDone.calendarUrl} className="h-[640px] w-full" />
                        </div>
                      )}
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
                Proof & trust
              </Badge>
              <h2 className="font-heading text-3xl font-bold md:text-4xl">The same standard owners already know</h2>
            </div>
            <div className="relative overflow-hidden">
              <Marquee pauseOnHover className="[--duration:42s]">
                {TESTIMONIALS.map((t) => (
                  <Card key={t.name} className="w-[280px] shrink-0">
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
              <h2 className="font-heading text-3xl font-bold md:text-4xl">Ready to stop re-quoting turnovers?</h2>
              <p className="mt-3 text-muted-foreground">
                Typical portfolios start onboarding immediately. Unusual ones get a call. Same split the
                registry already uses.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Button size="lg" onClick={() => openCta(cta === "book_call" ? "call" : "start")}>
                  {cta === "book_call" ? "Book a Call" : "Get Started"}
                </Button>
                <Button size="lg" variant="outline" onClick={() => openCta(cta === "book_call" ? "start" : "call")}>
                  {cta === "book_call" ? "Get Started" : "Book a Call"}
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/40 py-8 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Novara Cleaning · Maryland, Virginia, D.C.
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
  companyName, setCompanyName, contactName, setContactName, email, setEmail, phone, setPhone,
}: {
  companyName: string; setCompanyName: (v: string) => void;
  contactName: string; setContactName: (v: string) => void;
  email: string; setEmail: (v: string) => void;
  phone: string; setPhone: (v: string) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <Label>Company / owner</Label>
        <Input className="mt-1" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
      </div>
      <div>
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
