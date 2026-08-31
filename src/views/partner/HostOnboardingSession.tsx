"use client";

// ─── Host onboarding session ───────────────────────────────────────────────
//
// One token, three pages in fixed order: Legal & Signature → Property & Rate
// Schedule → Payment Setup. The server decides the step. Reopening the same
// link resumes; prior pages show as completed.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RiBankCardLine,
  RiCheckLine,
  RiExternalLinkLine,
  RiFileTextLine,
  RiFlagLine,
  RiHome4Line,
  RiLoader4Line,
  RiMapPin2Line,
  RiShieldCheckLine,
} from "@remixicon/react";

import { SignaturePad } from "@/components/booking/SignaturePad";
import { buildHostAgreementBase64 } from "@/lib/host-onboarding/agreement-pdf";
import {
  AGREEMENT_CLAUSES,
  BINDING_ACKNOWLEDGMENTS,
  IMPORTANT_NOTICE,
  PAY_AFTER_DISCRETION,
  bedsBathsLabel,
  formatTurnoverRate,
  type PaymentOptionKey,
} from "@/lib/host-onboarding/agreement";
import type { HostOnboardingProgress } from "@/lib/host-onboarding/progress";
import type { SnapshotProperty } from "@/lib/host-onboarding/session";

type Row = Record<string, unknown>;

interface Payload {
  session: {
    id: string;
    status: string;
    recipientName: string | null;
    expiresAt: string | null;
    completedAt: string | null;
    paymentOption: string | null;
    payAfterEnabled: boolean;
  };
  progress: HostOnboardingProgress;
  host: {
    id: string;
    name: string | null;
    email: string | null;
    entityType: string | null;
    entityName: string | null;
    hasPortal: boolean;
    cardOnFile: boolean;
  };
  properties: Array<
    SnapshotProperty & {
      decision: "confirmed" | "flagged" | null;
      flagNote: string | null;
      rateEditable: false;
    }
  >;
  additionalRequests: Row[];
  paymentOptions: Array<{ key: PaymentOptionKey; title: string; summary: string; body: string }>;
  portalUrl: string;
  handoffUrl?: string;
  agreementSignedAt: string | null;
  signerName: string | null;
}

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: Payload };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">{children}</div>
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 ${className}`}>
      {children}
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-violet-500";

export default function HostOnboardingSession({ token }: { token: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const qs = typeof window !== "undefined" ? window.location.search : "";
      const res = await fetch(`/api/partner/host-onboarding/${token}${qs}`);
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

  const returningFromStripe = useMemo(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("payment") === "done";
  }, []);

  useEffect(() => {
    if (!returningFromStripe) return;
    void (async () => {
      await fetch(`/api/partner/host-onboarding/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "payment_status" }),
      });
      await load();
      window.history.replaceState({}, "", window.location.pathname);
    })();
  }, [returningFromStripe, token, load]);

  const post = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/partner/host-onboarding/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setError(json?.message || "Something went wrong. Please try again.");
        return null;
      }
      if (json.outcome === "redirect" && json.url) {
        window.location.href = json.url as string;
        return null;
      }
      if (json.message) setNotice(json.message as string);
      if (typeof window !== "undefined") {
        const next = new URL(window.location.href);
        next.searchParams.delete("step");
        window.history.replaceState({}, "", next.pathname + (next.search || ""));
      }
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
      <Shell>
        <div className="flex items-center justify-center py-24 text-slate-400">
          <RiLoader4Line className="h-8 w-8 animate-spin" />
        </div>
      </Shell>
    );
  }

  if (state.kind === "error") {
    return (
      <Shell>
        <Card className="text-center">
          <h1 className="text-lg font-semibold">We couldn&apos;t open this link</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{state.message}</p>
        </Card>
      </Shell>
    );
  }

  const d = state.data;
  const step = d.progress.current_step;
  const hostName = d.host.name || d.session.recipientName || "there";

  return (
    <Shell>
      <header className="mb-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-violet-600">
          Novara Cleaning · Host partnership
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Getting you set up</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Hi {hostName.split(" ")[0]}. One link, three steps. You can close this and come back — we
          pick up exactly where you left off.
        </p>
      </header>

      <ProgressBar progress={d.progress} />

      <div ref={noticeRef}>
        {notice && (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            {notice}
          </div>
        )}
        {error && (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
            {error}
          </div>
        )}
      </div>

      <div className="mt-6 space-y-5">
        {step === "legal" && <LegalStep data={d} busy={busy} onPost={post} onError={setError} />}
        {step === "rates" && <RatesStep data={d} busy={busy} onPost={post} />}
        {step === "payment" && <PaymentStep data={d} busy={busy} onPost={post} />}
        {step === "done" && <DoneCard data={d} />}
      </div>
    </Shell>
  );
}

function ProgressBar({ progress }: { progress: HostOnboardingProgress }) {
  return (
    <Card>
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
              <span className={`text-sm ${s.done ? "text-slate-400" : current ? "font-semibold" : "text-slate-500"}`}>
                {s.key === "legal" ? "Legal" : s.key === "rates" ? "Rates" : "Payment"}
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
  const [name, setName] = useState(data.host.name || data.session.recipientName || "");
  const [agreed, setAgreed] = useState(false);
  const [acks, setAcks] = useState({ non_circumvention: false, chargebacks: false, arbitration: false });
  const [signature, setSignature] = useState<string | null>(null);

  const sign = async () => {
    if (!signature) {
      onError("Please draw your signature in the box.");
      return;
    }
    try {
      const pdfBase64 = await buildHostAgreementBase64({
        signerName: name.trim(),
        signerEmail: data.host.email || "",
        entityType: data.host.entityType,
        entityName: data.host.entityName,
        properties: data.properties,
        signatureDataUrl: signature,
      });
      await onPost({
        action: "sign",
        signerName: name.trim(),
        signerEmail: data.host.email,
        entityType: data.host.entityType,
        entityName: data.host.entityName,
        agreedToTerms: agreed,
        acknowledgedNonCircumvention: acks.non_circumvention,
        acknowledgedChargebacks: acks.chargebacks,
        acknowledgedArbitration: acks.arbitration,
        signatureDataUrl: signature,
        pdfBase64,
      });
    } catch {
      onError("The signed document didn't generate. Please reload and try again.");
    }
  };

  return (
    <Card>
      <div className="flex items-center gap-2 text-violet-700">
        <RiFileTextLine className="h-5 w-5" />
        <h2 className="text-lg font-semibold text-slate-900">Legal &amp; Signature</h2>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        Part One of the Host Partnership Agreement. Signing moves you to the rate schedule in this
        same session — no new link.
      </p>

      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-950">
        <p className="font-semibold">Important Notice</p>
        <p className="mt-1">{IMPORTANT_NOTICE}</p>
      </div>

      <div className="mt-4 max-h-[28rem] space-y-4 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-4">
        {AGREEMENT_CLAUSES.map(([heading, copy]) => (
          <section key={heading}>
            <h3 className="text-sm font-semibold text-slate-900">{heading}</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-slate-600">{copy}</p>
          </section>
        ))}
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
            I have read and agree to the Host Partnership Agreement, including the Property &amp; Rate
            Schedule in Section 17.
          </span>
        </label>
      </div>

      <label className="mt-5 block">
        <span className="text-sm font-medium text-slate-700">Full legal name</span>
        <input className={`${inputCls} mt-1`} value={name} onChange={(e) => setName(e.target.value)} />
      </label>

      <div className="mt-4">
        <p className="mb-2 text-sm font-medium text-slate-700">Signature</p>
        <SignaturePad onChange={setSignature} />
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={() => void sign()}
        className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
      >
        {busy ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : <RiShieldCheckLine className="h-4 w-4" />}
        Sign &amp; continue to rates
      </button>
    </Card>
  );
}

function RatesStep({
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
  const [extraOpen, setExtraOpen] = useState(false);
  const [extra, setExtra] = useState({ nickname: "", address: "", bedrooms: "", bathrooms: "", notes: "" });

  const allDecided = data.properties.length > 0 && data.properties.every((p) => p.decision);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center gap-2 text-violet-700">
          <RiHome4Line className="h-5 w-5" />
          <h2 className="text-lg font-semibold text-slate-900">Property &amp; Rate Schedule</h2>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          Part Two — every property from your proposal, with the per-turnover rate already set by
          Novara. Confirm each as shown, or flag one if a detail is wrong. Flagging notifies us and
          does not block the rest of this session. Rates are not editable here.
        </p>
      </Card>

      {data.properties.map((p, i) => (
        <Card key={p.property_id}>
          <p className="text-[11px] font-bold uppercase tracking-wide text-violet-600">
            Property {i + 1}
          </p>
          <h3 className="mt-1 text-base font-semibold">{p.nickname || "Property"}</h3>
          <p className="mt-1 flex items-start gap-1.5 text-sm text-slate-600">
            <RiMapPin2Line className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            {p.address || "Address on file"}
          </p>
          <p className="mt-2 text-sm text-slate-600">{bedsBathsLabel(p.bedrooms, p.bathrooms)}</p>
          <div className="mt-3 flex items-center justify-between rounded-xl bg-violet-50 px-3 py-2">
            <span className="text-sm text-slate-600">Per-turnover rate (set by Novara)</span>
            <span className="text-base font-bold text-violet-800">
              {formatTurnoverRate(p.turnover_price)}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            This rate is not editable. Flag the property if the address or bed/bath count is wrong.
          </p>
          {(p.linen || p.restock) && (
            <p className="mt-2 text-xs text-slate-500">
              {[p.linen ? "Linen included" : null, p.restock ? "Restock included" : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}

          {p.decision === "confirmed" && (
            <p className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-700">
              <RiCheckLine className="h-4 w-4" /> Confirmed
            </p>
          )}
          {p.decision === "flagged" && (
            <p className="mt-3 text-sm text-amber-800">
              <RiFlagLine className="mr-1 inline h-4 w-4" />
              Flagged for review{p.flagNote ? ` — ${p.flagNote}` : ""}
            </p>
          )}

          {!p.decision && (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void onPost({ action: "decide_property", propertyId: p.property_id, decision: "confirmed" })}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
              >
                Confirm as shown
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setFlagFor(p.property_id);
                  setFlagNote("");
                }}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <RiFlagLine className="h-4 w-4" /> Flag for review
              </button>
            </div>
          )}

          {flagFor === p.property_id && (
            <div className="mt-3 space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <textarea
                className={inputCls}
                rows={3}
                placeholder="What's wrong? (address, bed count, …)"
                value={flagNote}
                onChange={(e) => setFlagNote(e.target.value)}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void onPost({
                      action: "decide_property",
                      propertyId: p.property_id,
                      decision: "flagged",
                      note: flagNote,
                    }).then(() => setFlagFor(null))
                  }
                  className="h-9 rounded-lg bg-amber-700 px-3 text-sm font-semibold text-white"
                >
                  Send flag
                </button>
                <button type="button" onClick={() => setFlagFor(null)} className="h-9 px-3 text-sm text-slate-600">
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
          onClick={() => setExtraOpen((v) => !v)}
          className="text-sm font-semibold text-violet-700 hover:underline"
        >
          {extraOpen ? "Close additional-property request" : "Request an additional property"}
        </button>
        <p className="mt-1 text-xs text-slate-500">
          Routed to Novara for pricing under Section 5. It is not added or priced from this page.
        </p>
        {extraOpen && (
          <div className="mt-3 space-y-2">
            <input
              className={inputCls}
              placeholder="Nickname"
              value={extra.nickname}
              onChange={(e) => setExtra({ ...extra, nickname: e.target.value })}
            />
            <input
              className={inputCls}
              placeholder="Address"
              value={extra.address}
              onChange={(e) => setExtra({ ...extra, address: e.target.value })}
            />
            <div className="grid grid-cols-2 gap-2">
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
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void onPost({
                  action: "request_property",
                  nickname: extra.nickname,
                  address: extra.address,
                  bedrooms: extra.bedrooms ? Number(extra.bedrooms) : undefined,
                  bathrooms: extra.bathrooms ? Number(extra.bathrooms) : undefined,
                  notes: extra.notes,
                }).then((ok) => {
                  if (ok) {
                    setExtra({ nickname: "", address: "", bedrooms: "", bathrooms: "", notes: "" });
                    setExtraOpen(false);
                  }
                })
              }
              className="h-10 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white"
            >
              Send request to Novara
            </button>
          </div>
        )}
        {data.additionalRequests.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-slate-500">
            {data.additionalRequests.map((r) => (
              <li key={String(r.id)}>
                Requested: {String(r.requested_nickname || r.requested_address || "Property")} — with our team
              </li>
            ))}
          </ul>
        )}
      </Card>

      {allDecided && (
        <p className="text-center text-sm text-slate-500">
          Every property has a decision. Payment setup is next.
        </p>
      )}
    </div>
  );
}

function PaymentStep({
  data,
  busy,
  onPost,
}: {
  data: Payload;
  busy: boolean;
  onPost: (body: Record<string, unknown>) => Promise<unknown>;
}) {
  const [option, setOption] = useState<PaymentOptionKey>(
    (data.session.paymentOption as PaymentOptionKey) || data.paymentOptions[0]?.key || "full",
  );
  const needsPortal = !data.host.hasPortal;
  const cardReady = data.host.cardOnFile || data.progress.payment_ready;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center gap-2 text-violet-700">
          <RiBankCardLine className="h-5 w-5" />
          <h2 className="text-lg font-semibold text-slate-900">Payment Setup</h2>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          The three options in Section 6.2. Saving a card does not charge you now — it authorizes
          the option you pick for each booked turnover.
        </p>
        {!data.session.payAfterEnabled && (
          <p className="mt-3 text-xs text-slate-500">{PAY_AFTER_DISCRETION} It is not offered on this account.</p>
        )}

        <div className="mt-4 grid gap-2">
          {data.paymentOptions.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setOption(o.key)}
              className={`rounded-xl border p-3 text-left transition-colors ${
                option === o.key ? "border-violet-500 bg-violet-50" : "border-slate-200 hover:bg-slate-50"
              }`}
            >
              <span className="block text-sm font-semibold">{o.title}</span>
              <span className="mt-0.5 block text-xs text-slate-500">{o.summary}</span>
              <span className="mt-2 block text-[13px] leading-relaxed text-slate-600">{o.body}</span>
            </button>
          ))}
        </div>

        {!cardReady && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void onPost({ action: "setup_payment", paymentOption: option })}
            className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
          >
            {busy ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : <RiBankCardLine className="h-4 w-4" />}
            Save a card for {data.paymentOptions.find((o) => o.key === option)?.title || "this option"}
          </button>
        )}
        {cardReady && (
          <p className="mt-4 text-sm font-medium text-emerald-700">
            <RiCheckLine className="mr-1 inline h-4 w-4" />
            Payment method on file
            {data.session.paymentOption
              ? ` · ${data.paymentOptions.find((o) => o.key === data.session.paymentOption)?.title || data.session.paymentOption}`
              : ""}
          </p>
        )}
      </Card>

      {cardReady && needsPortal && (
        <Card>
          <h3 className="text-base font-semibold">Open your portal</h3>
          <p className="mt-1 text-sm text-slate-500">
            No password. This signs you in from this same setup session and takes you to the
            host portal.
          </p>
          <p className="mt-3 text-sm text-slate-600">
            Email: <strong>{data.host.email}</strong>
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void onPost({
                action: "create_portal",
                email: data.host.email,
                fullName: data.host.name,
              }).then((res) => {
                const url = (res as { handoffUrl?: string; portalUrl?: string } | null)?.handoffUrl
                  || (res as { portalUrl?: string } | null)?.portalUrl;
                if (url) window.location.assign(url);
              })
            }
            className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : "Enter the host portal"}
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
        The Host Partnership Agreement is signed, your rate schedule is on file, and payment is
        ready. Open the host portal to book turnovers.
      </p>
      <a
        href={data.handoffUrl || data.portalUrl}
        className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 text-sm font-semibold text-white hover:bg-violet-700"
      >
        Open host portal <RiExternalLinkLine className="h-4 w-4" />
      </a>
      <p className="mt-3 text-xs text-slate-400">You&apos;re already signed in from this setup session.</p>
    </Card>
  );
}
