"use client";

// ─── try.novaracleaning.com/str ────────────────────────────────────────────
//
// The self-serve front door for short-term-rental hosts. No login.
//
// 1. Enter one or more properties (address, bed/bath, linen, restock).
// 2. Instant quote from the Part Two reference bands — never a second model.
// 3. Claim This Rate (typical) or Book a Call (5+ BR, too many properties,
//    or flagged non-standard).
//
// Claiming continues straight into the EXISTING tokenized host onboarding
// session in this same browser; the link is also sent by SMS and email.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RiAddLine,
  RiArrowRightLine,
  RiCameraLine,
  RiCheckboxCircleLine,
  RiDeleteBinLine,
  RiHome4Line,
  RiLoader4Line,
  RiPhoneLine,
  RiShieldCheckLine,
} from "@remixicon/react";
import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { PortfolioCalEmbed } from "@/components/portfolio/PortfolioCalEmbed";
import { formatPhoneNumber } from "@/lib/input-formatters";
import { cn } from "@/lib/utils";
import {
  ENTITY_CHOICES,
  ENTITY_QUESTION,
  HERO_HEADLINE,
  STR_URL,
  VALUE_STACK,
  claimContactError,
  type StrEstimateResult,
} from "@/lib/str-landing/landing";
import { RATE_BANDS, formatRate } from "@/lib/host-onboarding/rate-bands";
import type { EntityType } from "@/lib/host-onboarding/types";

interface PropertyRow {
  key: string;
  nickname: string;
  address: string;
  bedrooms: string;
  bathrooms: string;
  linen: boolean;
  restock: boolean;
  flaggedNonStandard: boolean;
}

const newRow = (): PropertyRow => ({
  key: Math.random().toString(36).slice(2),
  nickname: "",
  address: "",
  bedrooms: "",
  bathrooms: "",
  linen: false,
  restock: false,
  flaggedNonStandard: false,
});

function toPayload(rows: PropertyRow[]) {
  return rows.map((r) => ({
    nickname: r.nickname || null,
    address: r.address,
    bedrooms: r.bedrooms === "" ? null : Number(r.bedrooms),
    bathrooms: r.bathrooms === "" ? null : Number(r.bathrooms),
    linen: r.linen,
    restock: r.restock,
    flaggedNonStandard: r.flaggedNonStandard,
  }));
}

export default function StrLanding() {
  const [rows, setRows] = useState<PropertyRow[]>([newRow()]);
  const [estimate, setEstimate] = useState<StrEstimateResult | null>(null);
  const [estimating, setEstimating] = useState(false);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [entityType, setEntityType] = useState<EntityType | null>(null);
  const [entityName, setEntityName] = useState("");
  const [notes, setNotes] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimed, setClaimed] = useState<{ onboardingUrl: string } | null>(null);
  const [callBooked, setCallBooked] = useState(false);

  const patch = (key: string, next: Partial<PropertyRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...next } : r)));

  // The page never prices in the browser — the server returns every rate.
  const refresh = useCallback(async (current: PropertyRow[]) => {
    const usable = current.filter((r) => r.bedrooms !== "");
    if (usable.length === 0) {
      setEstimate(null);
      return;
    }
    setEstimating(true);
    try {
      const res = await fetch("/api/str/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ properties: toPayload(current) }),
      });
      const json = (await res.json()) as StrEstimateResult;
      setEstimate(json);
    } catch {
      setEstimate(null);
    } finally {
      setEstimating(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void refresh(rows), 350);
    return () => clearTimeout(t);
  }, [rows, refresh]);

  // "incomplete" is not a verdict — no CTA card until the entry is finished.
  const rawCta = estimate?.cta ?? null;
  const cta = rawCta === "claim" || rawCta === "book_call" ? rawCta : null;
  const addressesOk = rows.every((r) => r.address.trim().length > 3);

  const contactError = useMemo(
    () =>
      claimContactError({
        fullName: fullName.trim(),
        email: email.trim().toLowerCase(),
        phone,
        entityType,
        entityName: entityName.trim() || null,
      }),
    [fullName, email, phone, entityType, entityName],
  );

  const submit = async (mode: "claim" | "book_call") => {
    setError(null);
    if (mode === "claim") {
      if (!addressesOk) {
        setError("Add a full address for every property.");
        return;
      }
      if (contactError) {
        setError(contactError);
        return;
      }
    }
    setBusy(true);
    try {
      const res = await fetch(mode === "claim" ? "/api/str/claim" : "/api/str/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          email,
          phone,
          entityType,
          entityName: entityName.trim() || null,
          notes,
          properties: toPayload(rows),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setError(json?.message || json?.error || "Something went wrong. Please try again.");
        return;
      }
      if (mode === "claim" && json.onboardingUrl) {
        setClaimed({ onboardingUrl: json.onboardingUrl as string });
        // Continue in-browser immediately; the link is also texted and emailed.
        window.location.assign(json.onboardingUrl as string);
        return;
      }
      setCallBooked(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="Short-Term Rental Turnover Cleaning — Instant Rate"
        description={HERO_HEADLINE}
        canonical={STR_URL}
      />

      <section className="mx-auto max-w-5xl px-4 pt-14 pb-8 sm:px-6">
        <Badge variant="secondary" className="mb-4">Short-term rental hosts</Badge>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{HERO_HEADLINE}</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Enter your property and see the per-turnover rate straight from the Property &amp; Rate
          Schedule in our Host Partnership Agreement — the same table you&apos;ll sign.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {VALUE_STACK.map((v) => (
            <Card key={v.key}>
              <CardContent className="p-4">
                <p className="text-sm font-semibold">{v.title}</p>
                <p className="mt-1 text-[13px] text-muted-foreground">{v.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* ── Property details ─────────────────────────────────────────── */}
      <section className="mx-auto max-w-5xl px-4 pb-8 sm:px-6">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2">
              <RiHome4Line className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Your properties</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Add as many as you like — each one is priced and registered separately.
            </p>

            <div className="mt-5 space-y-5">
              {rows.map((r, i) => {
                const est = estimate?.properties?.[i];
                return (
                  <div key={r.key} className="rounded-xl border p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold">Property {i + 1}</p>
                      {rows.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}
                          className="text-muted-foreground hover:text-destructive"
                          aria-label={`Remove property ${i + 1}`}
                        >
                          <RiDeleteBinLine className="h-4 w-4" />
                        </button>
                      )}
                    </div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <Label>Property address</Label>
                        <Input
                          value={r.address}
                          onChange={(e) => patch(r.key, { address: e.target.value })}
                          placeholder="123 Main Street, Baltimore, MD"
                        />
                      </div>
                      <div>
                        <Label>Nickname (optional)</Label>
                        <Input
                          value={r.nickname}
                          onChange={(e) => patch(r.key, { nickname: e.target.value })}
                          placeholder="The Fells Point condo"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label>Bedrooms</Label>
                          <Input
                            type="number"
                            min={0}
                            step={1}
                            value={r.bedrooms}
                            onChange={(e) => patch(r.key, { bedrooms: e.target.value })}
                            placeholder="2"
                          />
                        </div>
                        <div>
                          <Label>Bathrooms</Label>
                          <Input
                            type="number"
                            min={0}
                            step={0.5}
                            value={r.bathrooms}
                            onChange={(e) => patch(r.key, { bathrooms: e.target.value })}
                            placeholder="2"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-4">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-[#5500FF]"
                          checked={r.linen}
                          onChange={(e) => patch(r.key, { linen: e.target.checked })}
                        />
                        Linen &amp; laundry
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-[#5500FF]"
                          checked={r.restock}
                          onChange={(e) => patch(r.key, { restock: e.target.checked })}
                        />
                        Restocking
                      </label>
                      <label className="flex items-center gap-2 text-sm text-muted-foreground">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-[#5500FF]"
                          checked={r.flaggedNonStandard}
                          onChange={(e) => patch(r.key, { flaggedNonStandard: e.target.checked })}
                        />
                        This property is non-standard
                      </label>
                    </div>

                    {est && (
                      <div className="mt-4 rounded-lg bg-muted/60 p-3">
                        {est.quote.quotable ? (
                          <>
                            <p className="text-sm font-semibold">
                              {formatRate(est.quote.standardRate)} per turnover
                              {est.quote.introRate != null && (
                                <span className="ml-2 font-normal text-muted-foreground">
                                  (intro {formatRate(est.quote.introRate)})
                                </span>
                              )}
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {est.quote.bandLabel} base {formatRate(est.quote.baseRate)}
                              {est.quote.linenAdd > 0 && ` · linen +${formatRate(est.quote.linenAdd)}`}
                              {est.quote.restockAdd > 0 && ` · restock +${formatRate(est.quote.restockAdd)}`}
                            </p>
                          </>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            {est.quote.message || "This property is quoted by a person."}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <Button
              type="button"
              variant="outline"
              className="mt-4"
              onClick={() => setRows((prev) => [...prev, newRow()])}
            >
              <RiAddLine className="mr-1 h-4 w-4" /> Add another property
            </Button>
          </CardContent>
        </Card>
      </section>

      {/* ── Quote + CTA ──────────────────────────────────────────────── */}
      {estimate && (
        <section className="mx-auto max-w-5xl px-4 pb-8 sm:px-6">
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Your rate</h2>
                {estimating && <RiLoader4Line className="h-4 w-4 animate-spin text-muted-foreground" />}
              </div>

              {estimate.totalPerTurnover != null && estimate.properties.length > 1 && (
                <p className="mt-2 text-sm">
                  <span className="font-semibold">{formatRate(estimate.totalPerTurnover)}</span>{" "}
                  <span className="text-muted-foreground">
                    for one turnover at each of your {estimate.properties.length} properties.
                  </span>
                </p>
              )}

              {estimate.introDisclosure && (
                <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900">
                  {estimate.introDisclosure}
                </p>
              )}

              {/* §5.2 — the Company sets rates; the visitor is not naming a price. */}
              <p className="mt-3 text-[13px] text-muted-foreground">{estimate.companySetsRates}</p>
              <p className="mt-2 text-xs text-muted-foreground">{estimate.disclaimer}</p>

              {estimate.reasons.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {estimate.reasons.map((r) => (
                    <li key={r.reason} className="text-[13px] text-amber-900">
                      • {r.message}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {/* ── Claim / Book a Call ──────────────────────────────────────── */}
      {cta && !callBooked && !claimed && (
        <section className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
          <Card>
            <CardContent className="p-5">
              <h2 className="text-lg font-semibold">
                {cta === "claim" ? "Claim This Rate" : "Book a Call"}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {cta === "claim"
                  ? `Name, email, and phone. Your rate is held for ${estimate?.lockHours ?? 48} hours and you'll continue straight into setup.`
                  : "We'll price these properties with you on a short call before anything is set up."}
              </p>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Full name</Label>
                  <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
                </div>
                <div>
                  <Label>Email</Label>
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div>
                  <Label>Phone</Label>
                  <Input
                    value={phone}
                    onChange={(e) => setPhone(formatPhoneNumber(e.target.value))}
                    placeholder="(410) 555-0123"
                  />
                </div>
              </div>

              {/* Mandatory on the Claim path: it decides whether the Personal
                  Guarantee block is presented at signature. */}
              {cta === "claim" && (
                <div className="mt-5">
                  <Label>{ENTITY_QUESTION}</Label>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {ENTITY_CHOICES.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => setEntityType(c.value)}
                        className={cn(
                          "rounded-xl border p-3 text-left transition-colors",
                          entityType === c.value
                            ? "border-primary bg-primary/5"
                            : "border-border hover:bg-muted/50",
                        )}
                      >
                        <span className="block text-sm font-semibold">{c.label}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">{c.hint}</span>
                      </button>
                    ))}
                  </div>
                  {entityType === "entity" && (
                    <div className="mt-3">
                      <Label>Business entity legal name</Label>
                      <Input
                        value={entityName}
                        onChange={(e) => setEntityName(e.target.value)}
                        placeholder="Hale Property Holdings LLC"
                      />
                    </div>
                  )}
                </div>
              )}

              {cta === "book_call" && (
                <div className="mt-4">
                  <Label>Anything we should know? (optional)</Label>
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
                </div>
              )}

              {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

              <Button
                type="button"
                className="mt-5 w-full"
                disabled={busy}
                onClick={() => void submit(cta)}
              >
                {busy ? (
                  <RiLoader4Line className="mr-2 h-4 w-4 animate-spin" />
                ) : cta === "claim" ? (
                  <RiShieldCheckLine className="mr-2 h-4 w-4" />
                ) : (
                  <RiPhoneLine className="mr-2 h-4 w-4" />
                )}
                {cta === "claim" ? "Claim This Rate" : "Book a Call"}
                <RiArrowRightLine className="ml-2 h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        </section>
      )}

      {callBooked && (
        <section className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center gap-2 text-emerald-700">
                <RiCheckboxCircleLine className="h-5 w-5" />
                <h2 className="text-lg font-semibold">Pick a time</h2>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                We&apos;ll price these properties before anything is set up.
              </p>
              <div className="mt-4">
                <PortfolioCalEmbed name={fullName} email={email} notes={notes} />
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {claimed && (
        <section className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
          <Card>
            <CardContent className="p-5">
              <p className="text-sm font-semibold">Rate claimed — opening your setup…</p>
              <p className="mt-1 text-sm text-muted-foreground">
                We also texted and emailed you the same link.{" "}
                <a className="underline" href={claimed.onboardingUrl}>
                  Continue now
                </a>
                .
              </p>
            </CardContent>
          </Card>
        </section>
      )}

      {/* ── Reference bands, shown openly ────────────────────────────── */}
      <section className="mx-auto max-w-5xl px-4 pb-20 sm:px-6">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2">
              <RiCameraLine className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">The reference bands</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Part Two of the Host Partnership Agreement, &ldquo;How Rates Are Determined.&rdquo;
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2">Band</th>
                    <th className="py-2">Base</th>
                    <th className="py-2">+ Linen</th>
                    <th className="py-2">+ Restock</th>
                  </tr>
                </thead>
                <tbody>
                  {RATE_BANDS.map((b) => (
                    <tr key={b.key} className="border-b last:border-0">
                      <td className="py-2 font-medium">{b.label}</td>
                      <td className="py-2">{b.baseRate == null ? "Quote" : formatRate(b.baseRate)}</td>
                      <td className="py-2">{b.baseRate == null ? "—" : `+${formatRate(b.linenAdd)}`}</td>
                      <td className="py-2">{b.baseRate == null ? "—" : `+${formatRate(b.restockAdd)}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
