"use client";

// ─── try.novaracleaning.com/str ────────────────────────────────────────────
//
// Public acquisition page for Airbnb / short-term-rental hosts. No login.
// No email gate on the VSL. The calculator uses Host Partnership Agreement
// Part Two (base + linen + restock by bedroom band). Typical listings Claim
// into existing host onboarding with the rate locked; unusual ones book a call.

import { useMemo, useState } from "react";
import {
  RiAddLine,
  RiArrowRightLine,
  RiCalendarCheckLine,
  RiCameraLine,
  RiCheckboxCircleLine,
  RiDeleteBinLine,
  RiLoader4Line,
  RiMapPin2Line,
  RiPhoneLine,
  RiShieldCheckLine,
  RiStarLine,
  RiTimeLine,
  RiUserFollowLine,
  RiUserUnfollowLine,
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
import { StrVsl } from "@/components/str/StrVsl";
import { StrCalEmbed } from "@/components/str/StrCalEmbed";
import { formatPhoneNumber } from "@/lib/input-formatters";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";
import {
  ESTIMATE_DISCLAIMER,
  HOST_QUOTE_LOCK_HOURS,
  MAX_TYPICAL_LISTINGS,
  STR_URL,
  VALUE_STACK,
  estimateStrLanding,
  formatDollarRange,
  formatListingRange,
  type StrCta,
  type StrMode,
} from "@/lib/host-landing/landing";

const logo = "/novara-logo.png";
const PURPLE = BRAND.gradient;

const VALUE_ICONS = {
  vetted: RiUserFollowLine,
  tracked: RiUserUnfollowLine,
  backup: RiShieldCheckLine,
  photos: RiCameraLine,
  window: RiTimeLine,
  guarantee: RiCheckboxCircleLine,
} as const;

const TESTIMONIALS = [
  {
    name: "Priya K.",
    location: "STR host · Arlington, VA",
    text: "The turnover still happened when my regular couldn't make it. That's the whole reason I switched — backup, not just a cleaner.",
    rating: 5,
  },
  {
    name: "Daniel H.",
    location: "Airbnb Superhost · Baltimore, MD",
    text: "Same-day checkout to check-in used to be a scramble. Now I get before-and-after photos before the next guest is even on the way.",
    rating: 5,
  },
  {
    name: "Lauren S.",
    location: "Two listings · Silver Spring, MD",
    text: "I claimed the rate on the page, signed the agreement, and was booking turnovers the same afternoon. No one had to 'get back to me.'",
    rating: 5,
  },
];

type ListingDraft = {
  label: string;
  bedrooms: string;
  bathrooms: string;
  linen: boolean;
  restock: boolean;
};

const emptyListing = (i: number): ListingDraft => ({
  label: `Listing ${i + 1}`,
  bedrooms: "2",
  bathrooms: "1",
  linen: false,
  restock: false,
});

function bedsValue(raw: string): number | null {
  if (raw === "5+") return 5;
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export default function StrLanding() {
  const [mode, setMode] = useState<StrMode>("uniform");
  const [listingCount, setListingCount] = useState("1");
  const [bedrooms, setBedrooms] = useState("2");
  const [bathrooms, setBathrooms] = useState("1");
  const [linen, setLinen] = useState(false);
  const [restock, setRestock] = useState(false);
  const [flaggedAtypical, setFlaggedAtypical] = useState(false);
  const [mixed, setMixed] = useState<ListingDraft[]>([emptyListing(0)]);

  const [panel, setPanel] = useState<"none" | "claim" | "call">("none");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [callDone, setCallDone] = useState<{ message: string } | null>(null);

  const estimateInput = useMemo(
    () => ({
      mode,
      listingCount: Number(listingCount) || 0,
      flaggedAtypical,
      average: {
        bedrooms: bedsValue(bedrooms),
        bathrooms: bathrooms === "" ? null : Number(bathrooms),
        linen,
        restock,
      },
      listings:
        mode === "mixed"
          ? mixed.map((l) => ({
              label: l.label,
              bedrooms: bedsValue(l.bedrooms),
              bathrooms: l.bathrooms === "" ? null : Number(l.bathrooms),
              linen: l.linen,
              restock: l.restock,
              flaggedNonStandard: flaggedAtypical,
            }))
          : [],
    }),
    [mode, listingCount, bedrooms, bathrooms, linen, restock, flaggedAtypical, mixed],
  );

  const estimate = useMemo(() => estimateStrLanding(estimateInput), [estimateInput]);
  const cta: StrCta = estimate.cta;
  const liveCount =
    mode === "mixed" ? mixed.length : Math.max(0, Math.floor(Number(listingCount) || 0));
  const showQuote = estimate.ok && estimate.listingCount === liveCount;

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
      const res = await fetch("/api/str/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...estimateInput,
          name: contactName,
          email,
          phone,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        if (json?.cta === "book_call") {
          setPanel("call");
          setFormError(json.message || "This listing needs a call rather than instant onboarding.");
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
      const res = await fetch("/api/str/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...estimateInput,
          name: contactName,
          email,
          phone,
          notes,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.message || json?.error || "Could not submit.");
      setCallDone({ message: json.message });
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Could not submit.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <BrandAtmosphere />
      <SEO
        title="Airbnb Turnover Cleaning with Backup Coverage"
        description="Guest-ready turnovers timed to checkout and check-in, with backup coverage if a cleaner can't make it. Instant per-turnover estimate for STR hosts in the DMV."
        canonical={STR_URL}
      />

      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-xl hairline-glow">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <img src={logo} alt="Novara Cleaning" className="h-9 w-9 rounded-xl" />
            <span className="font-heading text-lg font-bold tracking-tight">
              Novara<span className="text-primary">Cleaning</span>
            </span>
            <span className="hidden rounded-md bg-brand-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-primary sm:inline">
              STR hosts
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
              Instant quote
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
                    <span className="text-sm font-medium text-primary">Maryland · Virginia · D.C. · STR hosts</span>
                  </div>
                </BlurFade>
                <BlurFade delay={0.1} inView>
                  <h1 className="font-heading text-4xl font-extrabold leading-[1.1] tracking-tight md:text-5xl lg:text-[52px]">
                    The turnover still happens on time —{" "}
                    <span className="text-gradient">even when a cleaner can&apos;t make it.</span>
                  </h1>
                </BlurFade>
                <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">
                  Backup coverage, reliability we actually track, and guest-ready staging timed to
                  checkout and check-in. Not another Airbnb cleaner you hope shows up.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button size="lg" onClick={() => document.getElementById("estimate")?.scrollIntoView({ behavior: "smooth" })}>
                    Instant per-turnover quote
                    <RiArrowRightLine className="h-4 w-4" />
                  </Button>
                  <Button size="lg" variant="outline" onClick={() => openCta("call")}>
                    Book a call
                  </Button>
                </div>
              </div>
              <StrVsl />
            </div>
          </div>
        </section>

        <section className="container mx-auto px-4 py-16 md:py-20">
          <div className="mx-auto max-w-5xl">
            <div className="mb-10 text-center">
              <Badge variant="secondary" className="mb-4 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider">
                What you actually get
              </Badge>
              <h2 className="font-heading text-3xl font-bold md:text-4xl">Built for turnovers, not a weekly house clean</h2>
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
                  Instant per-turnover quote
                </Badge>
                <h2 className="font-heading text-3xl font-bold md:text-4xl">See the rate from the Host schedule</h2>
                <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
                  Base + linen + restock by bedroom band — the same Property &amp; Rate Schedule
                  you confirm at onboarding. Not a separate estimate table.
                </p>
              </div>

              <Card className="relative overflow-hidden">
                <BorderBeam size={110} duration={10} />
                <CardContent className="relative z-10 space-y-6 p-6 md:p-8">
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(
                      [
                        ["uniform", "One listing, or several similar homes", "Enter the bed/bath once. We'll copy it across the listings."],
                        ["mixed", "Listings are different", "Different bedrooms, linen, or restock on each home."],
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
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      <Field label="Number of listings">
                        <Input
                          inputMode="numeric"
                          value={listingCount}
                          onChange={(e) => setListingCount(e.target.value.replace(/\D/g, "").slice(0, 2))}
                        />
                      </Field>
                      <Field label="Bedrooms">
                        <BedroomSelect value={bedrooms} onChange={setBedrooms} />
                      </Field>
                      <Field label="Bathrooms">
                        <Input
                          inputMode="decimal"
                          value={bathrooms}
                          onChange={(e) => setBathrooms(e.target.value.replace(/[^\d.]/g, "").slice(0, 4))}
                        />
                      </Field>
                      <ToggleField
                        label="Linen / laundry service"
                        checked={linen}
                        onChange={setLinen}
                        hint="Wash, dry, and remake the beds"
                      />
                      <ToggleField
                        label="Consumable restocking"
                        checked={restock}
                        onChange={setRestock}
                        hint="Toilet paper, soap, amenities"
                      />
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {mixed.map((listing, i) => (
                        <div key={i} className="space-y-2 rounded-xl border border-border/60 p-3">
                          <div className="grid gap-2 sm:grid-cols-12">
                            <Input
                              className="sm:col-span-4"
                              placeholder="Label"
                              value={listing.label}
                              onChange={(e) =>
                                setMixed((rows) => rows.map((r, idx) => (idx === i ? { ...r, label: e.target.value } : r)))
                              }
                            />
                            <div className="sm:col-span-3">
                              <BedroomSelect
                                value={listing.bedrooms}
                                onChange={(v) =>
                                  setMixed((rows) => rows.map((r, idx) => (idx === i ? { ...r, bedrooms: v } : r)))
                                }
                              />
                            </div>
                            <Input
                              className="sm:col-span-3"
                              placeholder="Baths"
                              inputMode="decimal"
                              value={listing.bathrooms}
                              onChange={(e) =>
                                setMixed((rows) =>
                                  rows.map((r, idx) => (idx === i ? { ...r, bathrooms: e.target.value } : r)),
                                )
                              }
                            />
                            <button
                              type="button"
                              className="inline-flex h-10 items-center justify-center rounded-xl text-muted-foreground hover:text-rose-600 sm:col-span-2"
                              onClick={() => setMixed((rows) => rows.filter((_, idx) => idx !== i))}
                              aria-label="Remove listing"
                            >
                              <RiDeleteBinLine className="h-4 w-4" />
                            </button>
                          </div>
                          <div className="flex flex-wrap gap-4 text-sm">
                            <label className="inline-flex items-center gap-2">
                              <input
                                type="checkbox"
                                className="h-4 w-4 accent-[#5C0FFE]"
                                checked={listing.linen}
                                onChange={(e) =>
                                  setMixed((rows) => rows.map((r, idx) => (idx === i ? { ...r, linen: e.target.checked } : r)))
                                }
                              />
                              Linen / laundry
                            </label>
                            <label className="inline-flex items-center gap-2">
                              <input
                                type="checkbox"
                                className="h-4 w-4 accent-[#5C0FFE]"
                                checked={listing.restock}
                                onChange={(e) =>
                                  setMixed((rows) =>
                                    rows.map((r, idx) => (idx === i ? { ...r, restock: e.target.checked } : r)),
                                  )
                                }
                              />
                              Restocking
                            </label>
                          </div>
                        </div>
                      ))}
                      <Button type="button" variant="outline" size="sm" onClick={() => setMixed((rows) => [...rows, emptyListing(rows.length)])}>
                        <RiAddLine className="h-4 w-4" /> Add a listing
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
                    This isn&apos;t a standard STR home (unusually large, an unusual number of listings, or something else non-standard).
                  </label>

                  <div className="space-y-4 rounded-2xl border border-primary/15 bg-primary/[0.03] p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">
                          Estimate · not a final per-turnover rate
                        </p>
                        <p className="mt-1 font-heading text-xl font-bold">
                          {liveCount} listing{liveCount === 1 ? "" : "s"}
                          {showQuote ? ` · ${formatListingRange(estimate)}` : ""}
                        </p>
                      </div>
                      <span className="rounded-full bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-800">
                        Estimate
                      </span>
                    </div>

                    {showQuote ? (
                      <>
                        <div className="rounded-xl bg-background/80 p-4">
                          <p className="text-xs font-semibold text-muted-foreground">Claimed rate (midpoint of the band)</p>
                          <p className="mt-1 font-heading text-3xl font-bold tabular-nums">
                            ${estimate.claimed.toLocaleString("en-US")}
                            <span className="ml-2 text-base font-medium text-muted-foreground">
                              {estimate.listingCount > 1 ? "total / turnover" : "/ turnover"}
                            </span>
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Band {formatDollarRange(estimate.min, estimate.max)}. Locked for {HOST_QUOTE_LOCK_HOURS}{" "}
                            hours when you claim.
                          </p>
                        </div>
                        {estimate.listings.length > 1 && (
                          <ul className="space-y-1 text-sm text-muted-foreground">
                            {estimate.listings.map((l, i) => (
                              <li key={i}>
                                {l.label}: {formatDollarRange(l.quote.min, l.quote.max)}
                                {l.quote.ok ? ` · claim $${l.quote.claimed}` : ""}
                                {l.linen ? " · linen" : ""}
                                {l.restock ? " · restock" : ""}
                              </li>
                            ))}
                          </ul>
                        )}
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {cta === "book_call"
                          ? "This listing isn't auto-priced. Book a call and we'll set the per-turnover rate after a person reviews it."
                          : "Add a bedroom count to see the Host schedule rate."}
                      </p>
                    )}

                    <p className="text-xs leading-relaxed text-muted-foreground">{ESTIMATE_DISCLAIMER}</p>
                    {estimate.reasons.length > 0 && (
                      <ul className="space-y-1 text-xs text-amber-900">
                        {estimate.reasons.map((r) => (
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
                    {liveCount > MAX_TYPICAL_LISTINGS && (
                      <p className="text-xs text-muted-foreground">
                        More than {MAX_TYPICAL_LISTINGS} listings is reviewed on a call before onboarding is generated.
                      </p>
                    )}
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
                          Name, email, and phone. The quoted rate is locked for {HOST_QUOTE_LOCK_HOURS} hours.
                          You continue into onboarding in this same browser — Legal &amp; Signature, then
                          Property &amp; Rate Schedule (already filled), then Payment. The same link is
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
                          Unusually large homes, an unusual number of listings, or anything
                          non-standard — a person reviews before onboarding is generated.
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
                          placeholder="Large home, many listings, unusual access, etc."
                        />
                      </div>
                      {formError && <p className="text-sm text-rose-700">{formError}</p>}
                      <Button size="lg" disabled={busy} onClick={() => void submitCall()}>
                        {busy ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : null}
                        Save my details and show times
                      </Button>
                      <StrCalEmbed name={contactName} email={email} notes={notes} />
                    </CardContent>
                  </Card>
                )}

                {callDone && (
                  <Card>
                    <CardContent className="space-y-4 p-6 md:p-10">
                      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full" style={{ background: PURPLE }}>
                        <RiCheckboxCircleLine className="h-7 w-7 text-white" />
                      </div>
                      <h3 className="text-center font-heading text-2xl font-bold">Pick a time</h3>
                      <p className="text-center text-muted-foreground">{callDone.message}</p>
                      <StrCalEmbed name={contactName} email={email} notes={notes} />
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
              <h2 className="font-heading text-3xl font-bold md:text-4xl">From hosts who already run turnovers with us</h2>
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
                      If work is missed, tell us within 24 hours of the visit — or before the next
                      guest if that is sooner. We return to correct covered items at no additional
                      charge when the unit is accessible. Guest-caused conditions are not a reclean.
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
                      Maryland, Virginia, and Washington, D.C. Same-day STR turnovers in the
                      counties we already cover — not a national marketplace.
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
              <h2 className="font-heading text-3xl font-bold md:text-4xl">Typical listing? Claim the rate. Larger or unusual? Book a call.</h2>
              <p className="mt-3 text-muted-foreground">
                A standard home with one or a few listings starts onboarding immediately — signature,
                then the rate schedule already filled, then payment. Anything bigger gets a person
                before onboarding is generated.
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
        © {new Date().getFullYear()} Novara Cleaning · Maryland, Virginia, D.C. · STR turnover cleaning
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

function ToggleField({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 rounded-xl border border-border px-3 py-2">
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 accent-[#5C0FFE]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}

function BedroomSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Select…</option>
      <option value="0">Studio</option>
      <option value="1">1 bedroom</option>
      <option value="2">2 bedrooms</option>
      <option value="3">3 bedrooms</option>
      <option value="4">4 bedrooms</option>
      <option value="5+">5+ (quote)</option>
    </select>
  );
}

function ContactFields({
  contactName,
  setContactName,
  email,
  setEmail,
  phone,
  setPhone,
}: {
  contactName: string;
  setContactName: (v: string) => void;
  email: string;
  setEmail: (v: string) => void;
  phone: string;
  setPhone: (v: string) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <Label>Your name</Label>
        <Input className="mt-1" value={contactName} onChange={(e) => setContactName(e.target.value)} />
      </div>
      <div>
        <Label>Email</Label>
        <Input className="mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="sm:col-span-2">
        <Label>Phone</Label>
        <Input className="mt-1" type="tel" value={phone} onChange={(e) => setPhone(formatPhoneNumber(e.target.value))} />
      </div>
    </div>
  );
}
