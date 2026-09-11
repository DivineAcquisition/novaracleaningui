"use client";

// ─── Property manager onboarding session ───────────────────────────────────
//
// One token, three pages in fixed order: Legal & Signature → Unit Registry &
// Rates → Billing & Portal. The server derives the step from what is on file,
// so closing the tab and reopening the link resumes exactly here.
//
// Page 2 is the page that defines this relationship type. Every unit arrives
// with its standing rates already computed. The manager confirms; they do not
// price. A manager running twenty apartments should be able to finish this
// page with twenty clicks and never see a quote form.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RiBankCardLine,
  RiBuilding2Line,
  RiCheckLine,
  RiExternalLinkLine,
  RiFileTextLine,
  RiFlagLine,
  RiLoader4Line,
  RiMapPin2Line,
  RiShieldCheckLine,
} from "@remixicon/react";

import { SignaturePad } from "@/components/booking/SignaturePad";
import { TokenPageShell, TokenPanel } from "@/components/token/TokenPageShell";
import { EmbeddedSetupForm } from "@/components/token/EmbeddedSetupForm";
import {
  AGREEMENT_CLAUSES,
  BINDING_ACKNOWLEDGMENTS,
  IMPORTANT_NOTICE,
  type PmBillingMethod,
} from "@/lib/property-manager/onboarding/agreement";
import type { PmOnboardingProgress } from "@/lib/property-manager/onboarding/progress";
import type { PmSessionPayload } from "@/lib/property-manager/onboarding/session";
import { formatRate } from "@/lib/property-manager/pricing";

type Row = Record<string, unknown>;

type Payload = PmSessionPayload & { handoffUrl?: string };

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: Payload };

const API = "/api/partner/property-manager-onboarding";

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-violet-500";

function Shell({
  children,
  eyebrow,
  title,
  subtitle,
}: {
  children: React.ReactNode;
  eyebrow?: string;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
}) {
  return (
    <TokenPageShell eyebrow={eyebrow} title={title} subtitle={subtitle}>
      {children}
    </TokenPageShell>
  );
}

function Card({
  children,
  className = "",
  shine = false,
}: {
  children: React.ReactNode;
  className?: string;
  shine?: boolean;
}) {
  return (
    <TokenPanel className={className} shine={shine}>
      {children}
    </TokenPanel>
  );
}

function unitSizeLine(unit: {
  sqft: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
}): string {
  const parts: string[] = [];
  if (unit.bedrooms) parts.push(`${unit.bedrooms} bd`);
  if (unit.bathrooms) parts.push(`${unit.bathrooms} ba`);
  if (unit.sqft) parts.push(`${Math.round(unit.sqft).toLocaleString()} sq ft`);
  return parts.length ? parts.join(" · ") : "Size on file";
}

export default function PropertyManagerOnboardingSession({ token }: { token: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const qs = typeof window !== "undefined" ? window.location.search : "";
      const res = await fetch(`${API}/${token}${qs}`);
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setState({ kind: "error", message: json?.message || "This link isn't valid." });
        return;
      }
      setState({ kind: "ready", data: json as Payload });
    } catch {
      setState({ kind: "error", message: "We couldn't load your setup. Please try again." });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const post = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${API}/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setError(json?.message || "Something went wrong. Please try again.");
        return null;
      }
      // A card form needs to open in place; don't reload the page out from
      // under the client secret we were just handed.
      if (json.outcome === "embed") return json;
      if (json.message) setNotice(json.message as string);
      await load();
      noticeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return json;
    } catch {
      setError("Something went wrong. Please try again.");
      return null;
    } finally {
      setBusy(false);
    }
  };

  if (state.kind === "loading") {
    return (
      <Shell eyebrow="Novara Cleaning · Property management">
        <div className="flex items-center justify-center py-24 text-slate-400">
          <RiLoader4Line className="h-8 w-8 animate-spin" />
        </div>
      </Shell>
    );
  }

  if (state.kind === "error") {
    return (
      <Shell eyebrow="Novara Cleaning · Property management" title="We couldn't open this link">
        <Card className="text-center">
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{state.message}</p>
        </Card>
      </Shell>
    );
  }

  const d = state.data;
  const step = d.progress.current_step;
  const who = d.account.contactName || d.session.recipientName || "there";

  return (
    <Shell
      eyebrow="Novara Cleaning · Property management"
      title="Getting your portfolio set up"
      subtitle={`Hi ${who.split(" ")[0]}. One link, three steps. Close it and come back whenever — we pick up exactly where you left off.`}
    >
      <ProgressBar progress={d.progress} />

      <div ref={noticeRef}>
        {notice && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            {notice}
          </div>
        )}
        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
            {error}
          </div>
        )}
      </div>

      {step === "legal" && <LegalStep data={d} busy={busy} onPost={post} onError={setError} />}
      {step === "registry" && <RegistryStep data={d} busy={busy} onPost={post} />}
      {step === "billing" && <BillingStep data={d} busy={busy} onPost={post} />}
      {step === "done" && <DoneCard data={d} />}
    </Shell>
  );
}

function ProgressBar({ progress }: { progress: PmOnboardingProgress }) {
  const shortLabel: Record<string, string> = {
    legal: "Legal",
    registry: "Units & rates",
    billing: "Billing",
  };
  return (
    <Card shine>
      <ol className="flex flex-wrap items-center justify-between gap-2">
        {progress.steps.map((s, i) => {
          const current = progress.current_step === s.key;
          return (
            <li key={s.key} className="flex min-w-[7rem] flex-1 items-center gap-2">
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  s.done
                    ? "bg-emerald-500 text-white"
                    : current
                      ? "bg-violet-600 text-white"
                      : "bg-slate-100 text-slate-400"
                }`}
              >
                {s.done ? <RiCheckLine className="h-4 w-4" /> : i + 1}
              </span>
              <span
                className={`text-sm ${s.done ? "text-slate-400" : current ? "font-semibold" : "text-slate-500"}`}
              >
                {shortLabel[s.key] || s.label}
                {current && !s.done && (
                  <span className="ml-2 hidden rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-700 sm:inline">
                    You&apos;re here
                  </span>
                )}
              </span>
              {i < progress.steps.length - 1 && (
                <span className="ml-auto hidden h-px flex-1 bg-slate-200 sm:block" />
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

// ─── Page 1 ────────────────────────────────────────────────────────────────

function LegalStep({
  data,
  busy,
  onPost,
  onError,
}: {
  data: Payload;
  busy: boolean;
  onPost: (body: Record<string, unknown>) => Promise<unknown>;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState(data.account.contactName || data.session.recipientName || "");
  const [entityName, setEntityName] = useState(data.account.companyName || "");
  const [agreed, setAgreed] = useState(false);
  const [acks, setAcks] = useState({
    non_circumvention: false,
    chargebacks: false,
    arbitration: false,
  });
  const [signature, setSignature] = useState<string | null>(null);

  const ready =
    name.trim().length >= 2 &&
    agreed &&
    acks.non_circumvention &&
    acks.chargebacks &&
    acks.arbitration &&
    Boolean(signature && signature.length > 100);

  const sign = async () => {
    if (!signature) {
      onError("Please draw your signature in the box.");
      return;
    }
    try {
      await onPost({
        action: "sign",
        signerName: name.trim(),
        signerEmail: data.account.email,
        entityName: entityName.trim() || data.account.companyName,
        entityType: "property_manager",
        agreedToTerms: agreed,
        acknowledgedNonCircumvention: acks.non_circumvention,
        acknowledgedChargebacks: acks.chargebacks,
        acknowledgedArbitration: acks.arbitration,
        signatureDataUrl: signature,
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Please reload and try again.";
      onError(`We couldn't record your signature. ${detail}`);
    }
  };

  return (
    <Card>
      <div className="flex items-center gap-2 text-violet-700">
        <RiFileTextLine className="h-5 w-5" />
        <h2 className="text-lg font-semibold text-slate-900">Legal &amp; Signature</h2>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        The Property Management Services Agreement. Signing opens your unit registry in this same
        session — no new link.
      </p>

      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-950">
        <p className="font-semibold">Important Notice</p>
        <p className="mt-1">{IMPORTANT_NOTICE}</p>
      </div>

      <div className="mt-4">
        <p className="mb-1.5 text-[11px] text-slate-500">
          Scroll to read the full agreement. Your countersigned copy lands in the portal under
          Documents.
        </p>
        <div className="h-[55vh] min-h-[340px] space-y-4 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-inner">
          {AGREEMENT_CLAUSES.map(([heading, body]) => (
            <section key={heading}>
              <h3 className="text-[13px] font-bold text-slate-900">{heading}</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-slate-600">{body}</p>
            </section>
          ))}
          <section>
            <h3 className="text-[13px] font-bold text-slate-900">Section 16 schedule</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-slate-600">
              {data.units.length} unit{data.units.length === 1 ? "" : "s"} with Company-set standing
              rates attach as the Section 16 schedule. You review them on the next page.
            </p>
          </section>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {BINDING_ACKNOWLEDGMENTS.map((ack) => (
          <label key={ack.key} className="flex items-start gap-3 rounded-xl border border-slate-200 p-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-[#5500FF]"
              checked={acks[ack.key]}
              onChange={(e) => setAcks({ ...acks, [ack.key]: e.target.checked })}
            />
            <span className="text-sm text-slate-700">
              <span className="font-semibold">{ack.label}.</span> {ack.text}
            </span>
          </label>
        ))}
        <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-[#5500FF]"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
          />
          <span className="text-sm text-slate-700">
            I have read and agree to the Property Management Services Agreement, including the Unit
            Registry &amp; Standing Rates schedule in Section 16.
          </span>
        </label>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Full legal name</span>
          <input className={`${inputCls} mt-1`} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Company / entity</span>
          <input
            className={`${inputCls} mt-1`}
            value={entityName}
            onChange={(e) => setEntityName(e.target.value)}
          />
        </label>
      </div>

      <div className="mt-4">
        <p className="mb-2 text-sm font-medium text-slate-700">Signature</p>
        <SignaturePad onChange={setSignature} />
      </div>

      <button
        type="button"
        disabled={busy || !ready}
        onClick={() => void sign()}
        className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
      >
        {busy ? (
          <RiLoader4Line className="h-4 w-4 animate-spin" />
        ) : (
          <RiShieldCheckLine className="h-4 w-4" />
        )}
        Sign &amp; continue to your unit registry
      </button>
    </Card>
  );
}

// ─── Page 2 ────────────────────────────────────────────────────────────────

function RegistryStep({
  data,
  busy,
  onPost,
}: {
  data: Payload;
  busy: boolean;
  onPost: (body: Record<string, unknown>) => Promise<unknown>;
}) {
  const [flagFor, setFlagFor] = useState<string | null>(null);
  const [flagNote, setFlagNote] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const emptyUnit = {
    unitLabel: "",
    address: "",
    city: "",
    state: "",
    zipCode: "",
    sqft: "",
    bedrooms: "",
    bathrooms: "",
    notes: "",
    flagNonStandard: false,
  };
  const [extra, setExtra] = useState(emptyUnit);

  const remaining = useMemo(
    () => data.units.filter((u) => !u.decision).length,
    [data.units],
  );
  const discount = data.account.volumeDiscountPercent;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center gap-2 text-violet-700">
          <RiBuilding2Line className="h-5 w-5" />
          <h2 className="text-lg font-semibold text-slate-900">Unit Registry &amp; Rates</h2>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          Every unit in your portfolio with its standing rates already set by Novara from the
          unit&apos;s size, bedroom count, and service zone. Confirm each one as shown, or flag it if
          a detail is wrong. Flagging notifies us and doesn&apos;t hold up the rest of this session.
          Rates aren&apos;t editable here.
        </p>
        <p className="mt-3 text-sm text-slate-600">
          These rates stand for every turnover on that unit. You book a turnover by picking the unit
          and the date it has to be ready — there is no re-quote when a tenant moves out.
        </p>
        {discount > 0 && (
          <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            Portfolio volume discount of <strong>{discount}%</strong>
            {data.account.volumeDiscountLabel ? ` (${data.account.volumeDiscountLabel})` : ""} is
            already reflected in every rate below.
          </p>
        )}
      </Card>

      {data.units.map((u, i) => (
        <Card key={u.unit_id}>
          <p className="text-[11px] font-bold uppercase tracking-wide text-violet-600">
            Unit {i + 1} of {data.units.length}
          </p>
          <h3 className="mt-1 text-base font-semibold">{u.unit_label || "Unit"}</h3>
          <p className="mt-1 flex items-start gap-1.5 text-sm text-slate-600">
            <RiMapPin2Line className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            <span>
              {u.address || "Address on file"}
              {u.city ? `, ${u.city}` : ""}
              {u.state ? `, ${u.state}` : ""}
              {u.zip_code ? ` ${u.zip_code}` : ""}
            </span>
          </p>
          <p className="mt-2 text-sm text-slate-600">
            {unitSizeLine(u)}
            {u.zone_code ? ` · Zone ${u.zone_code}` : ""}
          </p>

          <div className="mt-3 divide-y divide-violet-100 rounded-xl bg-violet-50 px-3">
            {u.rateLines.map((line) => (
              <div key={line.service} className="flex items-center justify-between py-2">
                <span className="text-sm text-slate-600">{line.label}</span>
                <span className="text-base font-bold text-violet-800">{formatRate(line.cents)}</span>
              </div>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            Set by Novara and not editable here. Flag the unit if the address, size, or bed/bath
            count is wrong.
          </p>
          {u.special_notes && <p className="mt-2 text-xs text-slate-500">{u.special_notes}</p>}

          {u.decision === "confirmed" && (
            <p className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-700">
              <RiCheckLine className="h-4 w-4" /> Confirmed
            </p>
          )}
          {u.decision === "flagged" && (
            <p className="mt-3 text-sm text-amber-800">
              <RiFlagLine className="mr-1 inline h-4 w-4" />
              Flagged for review{u.flagNote ? ` — ${u.flagNote}` : ""}
            </p>
          )}

          {!u.decision && (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void onPost({ action: "decide_unit", unitId: u.unit_id, decision: "confirmed" })
                }
                className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
              >
                Confirm as shown
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setFlagFor(u.unit_id);
                  setFlagNote("");
                }}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <RiFlagLine className="h-4 w-4" /> Flag for review
              </button>
            </div>
          )}

          {flagFor === u.unit_id && (
            <div className="mt-3 space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <textarea
                className={inputCls}
                rows={3}
                placeholder="What's wrong? (address, square footage, bed count, …)"
                value={flagNote}
                onChange={(e) => setFlagNote(e.target.value)}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy || flagNote.trim().length < 3}
                  onClick={() =>
                    void onPost({
                      action: "decide_unit",
                      unitId: u.unit_id,
                      decision: "flagged",
                      note: flagNote,
                    }).then(() => setFlagFor(null))
                  }
                  className="h-9 rounded-lg bg-amber-700 px-3 text-sm font-semibold text-white disabled:opacity-60"
                >
                  Send flag
                </button>
                <button
                  type="button"
                  onClick={() => setFlagFor(null)}
                  className="h-9 px-3 text-sm text-slate-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </Card>
      ))}

      <Card>
        <button
          type="button"
          onClick={() => setAddOpen((v) => !v)}
          className="text-sm font-semibold text-violet-700 hover:underline"
        >
          {addOpen ? "Close add-a-unit form" : "Add a unit"}
        </button>
        <p className="mt-1 text-xs text-slate-500">
          A typical unit prices itself from its size, bedrooms, and zone and joins your registry
          right away. Only a genuinely unusual one goes to our team first. Either way you can keep
          going.
        </p>
        {addOpen && (
          <div className="mt-3 space-y-2">
            <input
              className={inputCls}
              placeholder="Unit label (e.g. Maple St #3B)"
              value={extra.unitLabel}
              onChange={(e) => setExtra({ ...extra, unitLabel: e.target.value })}
            />
            <input
              className={inputCls}
              placeholder="Street address"
              value={extra.address}
              onChange={(e) => setExtra({ ...extra, address: e.target.value })}
            />
            <div className="grid grid-cols-3 gap-2">
              <input
                className={inputCls}
                placeholder="City"
                value={extra.city}
                onChange={(e) => setExtra({ ...extra, city: e.target.value })}
              />
              <input
                className={inputCls}
                placeholder="State"
                value={extra.state}
                onChange={(e) => setExtra({ ...extra, state: e.target.value })}
              />
              <input
                className={inputCls}
                placeholder="ZIP"
                inputMode="numeric"
                value={extra.zipCode}
                onChange={(e) => setExtra({ ...extra, zipCode: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <input
                className={inputCls}
                placeholder="Sq ft"
                inputMode="numeric"
                value={extra.sqft}
                onChange={(e) => setExtra({ ...extra, sqft: e.target.value })}
              />
              <input
                className={inputCls}
                placeholder="Bedrooms"
                inputMode="numeric"
                value={extra.bedrooms}
                onChange={(e) => setExtra({ ...extra, bedrooms: e.target.value })}
              />
              <input
                className={inputCls}
                placeholder="Bathrooms"
                inputMode="decimal"
                value={extra.bathrooms}
                onChange={(e) => setExtra({ ...extra, bathrooms: e.target.value })}
              />
            </div>
            <textarea
              className={inputCls}
              rows={2}
              placeholder="Notes (optional)"
              value={extra.notes}
              onChange={(e) => setExtra({ ...extra, notes: e.target.value })}
            />
            <label className="flex items-start gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-[#5500FF]"
                checked={extra.flagNonStandard}
                onChange={(e) => setExtra({ ...extra, flagNonStandard: e.target.checked })}
              />
              This unit is non-standard — have someone look at it before pricing.
            </label>
            <button
              type="button"
              disabled={busy || extra.address.trim().length < 5}
              onClick={() =>
                void onPost({
                  action: "add_unit",
                  unitLabel: extra.unitLabel,
                  address: extra.address,
                  city: extra.city,
                  state: extra.state,
                  zipCode: extra.zipCode,
                  sqft: extra.sqft ? Number(extra.sqft) : undefined,
                  bedrooms: extra.bedrooms ? Number(extra.bedrooms) : undefined,
                  bathrooms: extra.bathrooms ? Number(extra.bathrooms) : undefined,
                  notes: extra.notes,
                  flagNonStandard: extra.flagNonStandard,
                }).then((ok) => {
                  if (ok) {
                    setExtra(emptyUnit);
                    setAddOpen(false);
                  }
                })
              }
              className="h-10 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-60"
            >
              Add this unit
            </button>
          </div>
        )}
        {data.addedUnits.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-slate-500">
            {data.addedUnits.map((r: Row) => (
              <li key={String(r.id)}>
                {String(r.requested_label || r.requested_address || "Unit")} —{" "}
                {r.auto_priced ? "added and priced" : "with our team for pricing"}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {remaining > 0 ? (
        <p className="text-center text-sm text-slate-500">
          {remaining} unit{remaining === 1 ? "" : "s"} left to confirm.
        </p>
      ) : (
        <p className="text-center text-sm text-slate-500">
          Every unit has a decision. Billing is next.
        </p>
      )}
    </div>
  );
}

// ─── Page 3 ────────────────────────────────────────────────────────────────

function BillingStep({
  data,
  busy,
  onPost,
}: {
  data: Payload;
  busy: boolean;
  onPost: (body: Record<string, unknown>) => Promise<unknown>;
}) {
  const [method, setMethod] = useState<PmBillingMethod>(
    (data.session.billingMethod as PmBillingMethod) || "invoiced",
  );
  const [embed, setEmbed] = useState<{ clientSecret: string } | null>(null);
  const billingReady = data.progress.billing_ready;
  const needsPortal = !data.account.hasPortal;

  const choose = async () => {
    const json = (await onPost({
      action: "configure_billing",
      billingMethod: method,
      billingEmail: data.account.email,
    })) as { outcome?: string; clientSecret?: string } | null;
    if (json?.outcome === "embed" && json.clientSecret) {
      setEmbed({ clientSecret: json.clientSecret });
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center gap-2 text-violet-700">
          <RiBankCardLine className="h-5 w-5" />
          <h2 className="text-lg font-semibold text-slate-900">Billing</h2>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          One consolidated invoice per billing period covering every turnover across your portfolio,
          itemized by unit. Not one invoice per turnover.
        </p>

        <div className="mt-4 grid gap-2">
          {data.billingOptions.map((o) => (
            <button
              key={o.key}
              type="button"
              disabled={billingReady}
              onClick={() => setMethod(o.key)}
              className={`rounded-xl border p-3 text-left transition-colors disabled:opacity-70 ${
                method === o.key
                  ? "border-violet-500 bg-violet-50"
                  : "border-slate-200 hover:bg-slate-50"
              }`}
            >
              <span className="block text-sm font-semibold">{o.title}</span>
              <span className="mt-0.5 block text-xs text-slate-500">{o.summary}</span>
              <span className="mt-2 block text-[13px] leading-relaxed text-slate-600">{o.body}</span>
            </button>
          ))}
        </div>

        {!billingReady && !embed && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void choose()}
            className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
          >
            {busy ? (
              <RiLoader4Line className="h-4 w-4 animate-spin" />
            ) : (
              <RiBankCardLine className="h-4 w-4" />
            )}
            {method === "invoiced" ? "Bill me by invoice" : "Add a card for Auto-Pay"}
          </button>
        )}

        {!billingReady && embed && (
          <div className="mt-5">
            <EmbeddedSetupForm
              clientSecret={embed.clientSecret}
              returnUrl={typeof window !== "undefined" ? window.location.href.split("#")[0] : ""}
              submitLabel="Save this card for Auto-Pay"
              note="Nothing is charged now. We charge this card when each period's consolidated statement issues."
              onConfirmed={() => void onPost({ action: "confirm_billing" })}
            />
          </div>
        )}

        {billingReady && (
          <p className="mt-4 text-sm font-medium text-emerald-700">
            <RiCheckLine className="mr-1 inline h-4 w-4" />
            Billing set —{" "}
            {data.session.billingMethod === "auto_pay"
              ? "Auto-Pay, card on file"
              : `invoiced${data.account.netTerms ? ` · ${data.account.netTerms.replace(/_/g, " ")}` : ""}`}
            {data.account.invoiceCycle ? ` · ${data.account.invoiceCycle}` : ""}
          </p>
        )}
      </Card>

      {billingReady && needsPortal && (
        <Card>
          <h3 className="text-base font-semibold">Open your portal</h3>
          <p className="mt-1 text-sm text-slate-500">
            No password. This signs you in from this same setup session and drops you into your
            portfolio, where you book turnovers.
          </p>
          <p className="mt-3 text-sm text-slate-600">
            Email: <strong>{data.account.email}</strong>
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void onPost({
                action: "create_portal",
                email: data.account.email,
                fullName: data.account.contactName,
              }).then((res) => {
                const r = res as { handoffUrl?: string; portalUrl?: string } | null;
                const url = r?.handoffUrl || r?.portalUrl;
                if (url) window.location.assign(url);
              })
            }
            className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : "Enter the partner portal"}
          </button>
        </Card>
      )}
    </div>
  );
}

function DoneCard({ data }: { data: Payload }) {
  return (
    <Card className="text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 text-white">
        <RiCheckLine className="h-6 w-6" />
      </div>
      <h2 className="mt-4 text-xl font-semibold">You&apos;re set up</h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        The agreement is signed, your unit registry and standing rates are on file, and billing is
        set. Open the portal to book a turnover — pick the unit, pick the date it has to be ready,
        done.
      </p>
      <a
        href={data.handoffUrl || data.portalUrl}
        className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 text-sm font-semibold text-white hover:bg-violet-700"
      >
        Open partner portal <RiExternalLinkLine className="h-4 w-4" />
      </a>
      <p className="mt-3 text-xs text-slate-400">
        You&apos;re already signed in from this setup session.
      </p>
    </Card>
  );
}
