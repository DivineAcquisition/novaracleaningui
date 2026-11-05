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
import { AcceptanceChecklist, type AcceptanceGateState } from "@/components/compliance/AcceptanceChecklist";
import { submitAcceptances } from "@/lib/compliance/record-client";
import {
  RiAddLine,
  RiArrowRightLine,
  RiCheckboxCircleFill,
  RiDeleteBinLine,
  RiLoader4Line,
  RiPhoneLine,
  RiShieldCheckLine,
} from "@remixicon/react";
import { MarketingShell, PageHero } from "@/components/landing/MarketingShell";
import { Chip, Index, Section, btnOutline, btnPrimary } from "@/components/landing/primitives";
import { AddressAutocomplete } from "@/components/booking/AddressAutocomplete";
import { PortfolioCalEmbed } from "@/components/portfolio/PortfolioCalEmbed";
import { formatPhoneNumber } from "@/lib/input-formatters";
import { cn } from "@/lib/utils";
import {
  ENTITY_CHOICES,
  ENTITY_QUESTION,
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

  const [claimGate, setClaimGate] = useState<AcceptanceGateState | null>(null);
  const [showClaimErrors, setShowClaimErrors] = useState(false);
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
      if (!claimGate?.ready) {
        setShowClaimErrors(true);
        setError("Check each required agreement. Marketing texts and emails are optional.");
        return;
      }
    }
    setBusy(true);
    try {
      if (mode === "claim" && claimGate) {
        void submitAcceptances({
          surface: "str_claim",
          context: {
            relationship: "str_host",
            includeCard: false,
            phone,
            propertyLabel: rows[0]?.address || "the properties on this claim",
          },
          items: claimGate.items,
          checked: claimGate.checked,
          personName: fullName,
          email,
          phone,
        }).catch(() => undefined);
      }
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

  const field =
    "block h-11 w-full rounded-[10px] border border-line bg-white px-3.5 text-[15px] text-ink placeholder:text-ink-muted/70 focus:border-[#6810FE]/50 focus:outline-none focus:ring-[3px] focus:ring-[#6810FE]/15";
  const label = "mb-1.5 block text-[13px] font-medium text-ink";
  const check =
    "flex cursor-pointer items-center gap-2 rounded-full border border-line bg-white px-3 py-1.5 text-[13.5px] text-ink has-[:checked]:border-[#C9B6FF] has-[:checked]:bg-[#F7F4FF]";

  const rateFrame = (
    <div className="relative overflow-hidden rounded-2xl border border-line bg-white shadow-[0_0_72px_-28px_rgba(104,16,254,0.55)] lg:sticky lg:top-24">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-[#6810FE]/[0.08] to-transparent" />
      <div className="relative border-b border-line p-5">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5A1FD6]">Your rate · per turnover</p>
          {estimating ? (
            <RiLoader4Line className="h-4 w-4 animate-spin text-[#6810FE] motion-reduce:animate-none" aria-label="Pricing" />
          ) : (
            <Chip tone={estimate ? "good" : "neutral"} dot>
              {estimate ? "Priced" : "Add a property"}
            </Chip>
          )}
        </div>
      </div>
      {estimate?.properties?.length ? (
        <ul>
          {estimate.properties.map((p, i) => {
            const r = rows[i];
            const name = r?.nickname || r?.address || `Property ${i + 1}`;
            return (
              <li key={i} className="border-b border-line px-5 py-3.5 last:border-b-0">
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0 truncate text-[14.5px] text-ink">{name}</span>
                  {p.quote.quotable ? (
                    <span className="text-[15px] font-medium tabular-nums text-ink">{formatRate(p.quote.standardRate)}</span>
                  ) : (
                    <Chip tone="warn">Quoted by a person</Chip>
                  )}
                </div>
                {p.quote.quotable ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Chip tone="good">
                      {p.quote.bandLabel} · {formatRate(p.quote.baseRate)}
                    </Chip>
                    {p.quote.linenAdd > 0 ? <Chip tone="brand">Linen +{formatRate(p.quote.linenAdd)}</Chip> : null}
                    {p.quote.restockAdd > 0 ? <Chip tone="brand">Restock +{formatRate(p.quote.restockAdd)}</Chip> : null}
                    {p.quote.introRate != null ? <Chip>Intro {formatRate(p.quote.introRate)}</Chip> : null}
                  </div>
                ) : (
                  <p className="mt-1 text-[13px] text-ink-muted">{p.quote.message || "This property is quoted by a person."}</p>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-5 py-6 text-[14px] text-ink-muted">Enter bedrooms for a property and its rate appears here.</p>
      )}
      {estimate ? (
        <div className="space-y-2 border-t border-ink bg-[#FAFAFC] px-5 py-4">
          {estimate.totalPerTurnover != null && estimate.properties.length > 1 ? (
            <p className="flex items-end justify-between">
              <span className="text-[13px] text-ink-muted">One turnover at each property</span>
              <span className="text-[26px] font-medium tracking-[-0.03em] tabular-nums text-ink">{formatRate(estimate.totalPerTurnover)}</span>
            </p>
          ) : null}
          {estimate.introDisclosure ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900">{estimate.introDisclosure}</p>
          ) : null}
          {/* §5.2 — the Company sets rates; the visitor is not naming a price. */}
          <p className="text-[12.5px] leading-relaxed text-ink-muted">{estimate.companySetsRates}</p>
          <p className="text-[12px] leading-relaxed text-ink-muted">{estimate.disclaimer}</p>
          {estimate.reasons.length > 0 ? (
            <ul className="space-y-1">
              {estimate.reasons.map((r) => (
                <li key={r.reason} className="text-[13px] text-amber-900">
                  {r.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  return (
    <MarketingShell mobileBar={false}>
      <PageHero
        eyebrow="Airbnb and short-term rental hosts"
        title="A price per turnover, in seconds."
        lead="Enter your property and see its per-turnover rate from the Property & Rate Schedule in our Host Partnership Agreement. It is the same table you sign. No sales call needed to see a number."
      >
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <a href="#properties" className={btnPrimary}>
            Price my property
            <RiArrowRightLine className="h-4 w-4" aria-hidden="true" />
          </a>
          <a href="https://partner.novaracleaning.com" className={btnOutline}>
            Host sign in
          </a>
        </div>
      </PageHero>

      <Section
        id="properties"
        headline="Your properties."
        lead="Add as many as you like. Each one is priced and registered on its own."
      >
        <div className="grid items-start gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-4">
            {rows.map((r, i) => (
              <fieldset key={r.key} className="rounded-2xl border border-line bg-white p-5 shadow-[0_16px_40px_-32px_rgba(11,10,17,0.35)]">
                <div className="flex items-center justify-between">
                  <legend className="flex items-center gap-2.5 text-[17px] font-medium tracking-[-0.02em] text-ink">
                    <Index n={i + 1} />
                    {r.nickname || `Property ${i + 1}`}
                  </legend>
                  {rows.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}
                      className="rounded-md p-1.5 text-ink-muted hover:bg-[#F6F5F9] hover:text-red-600"
                      aria-label={`Remove property ${i + 1}`}
                    >
                      <RiDeleteBinLine className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <AddressAutocomplete
                      inputId={`str-landing-property-address-${r.key}`}
                      label="Property address"
                      placeholder="123 Main Street, Baltimore, MD"
                      initialValue={r.address}
                      onAddressSelect={(addr) =>
                        patch(r.key, {
                          address: [addr.street, addr.city, [addr.state, addr.zipCode].filter(Boolean).join(" ")]
                            .filter(Boolean)
                            .join(", "),
                        })
                      }
                    />
                  </div>
                  <div>
                    <label htmlFor={`nick-${r.key}`} className={label}>
                      Nickname (optional)
                    </label>
                    <input
                      id={`nick-${r.key}`}
                      className={field}
                      value={r.nickname}
                      onChange={(e) => patch(r.key, { nickname: e.target.value })}
                      placeholder="The Fells Point condo"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor={`bed-${r.key}`} className={label}>
                        Bedrooms
                      </label>
                      <input
                        id={`bed-${r.key}`}
                        type="number"
                        min={0}
                        step={1}
                        inputMode="numeric"
                        className={field}
                        value={r.bedrooms}
                        onChange={(e) => patch(r.key, { bedrooms: e.target.value })}
                        placeholder="2"
                      />
                    </div>
                    <div>
                      <label htmlFor={`bath-${r.key}`} className={label}>
                        Bathrooms
                      </label>
                      <input
                        id={`bath-${r.key}`}
                        type="number"
                        min={0}
                        step={0.5}
                        inputMode="decimal"
                        className={field}
                        value={r.bathrooms}
                        onChange={(e) => patch(r.key, { bathrooms: e.target.value })}
                        placeholder="2"
                      />
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <label className={check}>
                    <input type="checkbox" className="h-4 w-4 accent-[#6810FE]" checked={r.linen} onChange={(e) => patch(r.key, { linen: e.target.checked })} />
                    Linen and laundry
                  </label>
                  <label className={check}>
                    <input type="checkbox" className="h-4 w-4 accent-[#6810FE]" checked={r.restock} onChange={(e) => patch(r.key, { restock: e.target.checked })} />
                    Restocking
                  </label>
                  <label className={check}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[#6810FE]"
                      checked={r.flaggedNonStandard}
                      onChange={(e) => patch(r.key, { flaggedNonStandard: e.target.checked })}
                    />
                    This property is non-standard
                  </label>
                </div>
              </fieldset>
            ))}
            <button type="button" className={btnOutline} onClick={() => setRows((prev) => [...prev, newRow()])}>
              <RiAddLine className="h-4 w-4" aria-hidden="true" /> Add another property
            </button>
          </div>
          {rateFrame}
        </div>

        {cta && !callBooked && !claimed ? (
          <div className="mt-10 rounded-2xl border border-line bg-white p-5 shadow-[0_24px_50px_-30px_rgba(11,10,17,0.4)] sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-[24px] font-medium tracking-[-0.02em] text-ink">{cta === "claim" ? "Claim this rate." : "Book a call."}</h3>
              <Chip tone={cta === "claim" ? "good" : "warn"} dot>
                {cta === "claim" ? `Held for ${estimate?.lockHours ?? 48} hours` : "Priced with a person"}
              </Chip>
            </div>
            <p className="mt-2 max-w-2xl text-[14.5px] leading-relaxed text-ink-muted">
              {cta === "claim"
                ? "Name, email, and phone. You continue straight into setup, and we text and email you the same link."
                : "We price these properties with you on a short call before anything is set up."}
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor="str-name" className={label}>Full name</label>
                <input id="str-name" autoComplete="name" className={field} value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
              <div>
                <label htmlFor="str-email" className={label}>Email</label>
                <input id="str-email" type="email" autoComplete="email" className={field} value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div>
                <label htmlFor="str-phone" className={label}>Phone</label>
                <input
                  id="str-phone"
                  type="tel"
                  autoComplete="tel"
                  className={field}
                  value={phone}
                  onChange={(e) => setPhone(formatPhoneNumber(e.target.value))}
                  placeholder="(410) 555-0123"
                />
              </div>
            </div>

            {/* Mandatory on the Claim path: it decides whether the Personal
                Guarantee block is presented at signature. */}
            {cta === "claim" ? (
              <fieldset className="mt-5">
                <legend className={label}>{ENTITY_QUESTION}</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {ENTITY_CHOICES.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      aria-pressed={entityType === c.value}
                      onClick={() => setEntityType(c.value)}
                      className={cn(
                        "rounded-xl border p-3.5 text-left transition-colors",
                        entityType === c.value ? "border-[#C9B6FF] bg-[#F7F4FF]" : "border-line bg-white hover:bg-[#FAFAFC]",
                      )}
                    >
                      <span className="block text-[14.5px] font-medium text-ink">{c.label}</span>
                      <span className="mt-0.5 block text-[13px] text-ink-muted">{c.hint}</span>
                    </button>
                  ))}
                </div>
                {entityType === "entity" ? (
                  <div className="mt-3">
                    <label htmlFor="str-entity" className={label}>Business entity legal name</label>
                    <input
                      id="str-entity"
                      className={field}
                      value={entityName}
                      onChange={(e) => setEntityName(e.target.value)}
                      placeholder="Hale Property Holdings LLC"
                    />
                  </div>
                ) : null}
              </fieldset>
            ) : null}

            {cta === "book_call" ? (
              <div className="mt-4">
                <label htmlFor="str-notes" className={label}>Anything we should know? (optional)</label>
                <textarea
                  id="str-notes"
                  rows={3}
                  className={cn(field, "h-auto py-2.5")}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            ) : null}

            {cta === "claim" ? (
              <div className="mt-5">
                <AcceptanceChecklist
                  surface="str_claim"
                  showErrors={showClaimErrors}
                  onChange={setClaimGate}
                  context={{
                    relationship: "str_host",
                    includeCard: false,
                    phone,
                    propertyLabel: rows[0]?.address || "the properties on this claim",
                  }}
                />
              </div>
            ) : null}

            {error ? (
              <p className="mt-4 text-[14px] text-red-600" role="alert">
                {error}
              </p>
            ) : null}

            <button type="button" className={cn(btnPrimary, "mt-5 w-full sm:w-auto")} disabled={busy} onClick={() => void submit(cta)}>
              {busy ? (
                <RiLoader4Line className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : cta === "claim" ? (
                <RiShieldCheckLine className="h-4 w-4" aria-hidden="true" />
              ) : (
                <RiPhoneLine className="h-4 w-4" aria-hidden="true" />
              )}
              {cta === "claim" ? "Claim this rate" : "Book a call"}
              <RiArrowRightLine className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ) : null}

        {callBooked ? (
          <div className="mt-10 rounded-2xl border border-line bg-white p-5 sm:p-7">
            <p className="flex items-center gap-2 text-[20px] font-medium tracking-[-0.02em] text-ink">
              <RiCheckboxCircleFill className="h-5 w-5 text-emerald-600" aria-hidden="true" />
              Pick a time.
            </p>
            <p className="mt-1 text-[14.5px] text-ink-muted">We price these properties with you before anything is set up.</p>
            <div className="mt-4">
              <PortfolioCalEmbed name={fullName} email={email} notes={notes} />
            </div>
          </div>
        ) : null}

        {claimed ? (
          <div className="mt-10 rounded-2xl border border-emerald-200 bg-emerald-50 p-5" role="status">
            <p className="text-[16px] font-medium text-emerald-900">Rate claimed. Opening your setup.</p>
            <p className="mt-1 text-[14px] text-emerald-900/80">
              We also texted and emailed you the same link.{" "}
              <a className="underline" href={claimed.onboardingUrl}>
                Continue now
              </a>
              .
            </p>
          </div>
        ) : null}
      </Section>

      <Section id="included" headline="What every turnover includes.">
        <ul className="grid gap-3 sm:grid-cols-2">
          {VALUE_STACK.map((v, i) => (
            <li key={v.key} className="rounded-2xl border border-line bg-white p-5 shadow-[0_16px_40px_-32px_rgba(11,10,17,0.35)]">
              <Index n={i + 1} />
              <h3 className="mt-2 text-[18px] font-medium tracking-[-0.02em] text-ink">{v.title}</h3>
              <p className="mt-1 text-[14px] leading-relaxed text-ink-muted">{v.body}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        id="bands"
        headline="The rate table you sign."
        lead="Part Two of the Host Partnership Agreement, “How Rates Are Determined.” Shown in full, so nothing is hidden."
      >
        <div className="overflow-x-auto rounded-2xl border border-line bg-white shadow-[0_16px_40px_-32px_rgba(11,10,17,0.35)]">
          <table className="w-full min-w-[520px] text-left text-[14px]">
            <thead>
              <tr className="border-b border-line bg-[#FAFAFC] text-ink-muted">
                <th scope="col" className="px-5 py-3 font-medium">Band</th>
                <th scope="col" className="px-5 py-3 font-medium">Base</th>
                <th scope="col" className="px-5 py-3 font-medium">+ Linen</th>
                <th scope="col" className="px-5 py-3 font-medium">+ Restock</th>
              </tr>
            </thead>
            <tbody>
              {RATE_BANDS.map((b) => (
                <tr key={b.key} className="border-b border-line last:border-b-0">
                  <th scope="row" className="px-5 py-3 font-medium text-ink">{b.label}</th>
                  <td className="px-5 py-3 tabular-nums text-ink">{b.baseRate == null ? "Quote" : formatRate(b.baseRate)}</td>
                  <td className="px-5 py-3 tabular-nums text-ink-muted">{b.baseRate == null ? "—" : `+${formatRate(b.linenAdd)}`}</td>
                  <td className="px-5 py-3 tabular-nums text-ink-muted">{b.baseRate == null ? "—" : `+${formatRate(b.restockAdd)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </MarketingShell>
  );
}
