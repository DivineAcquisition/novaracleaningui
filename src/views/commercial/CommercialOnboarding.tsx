"use client";

// ─── Commercial onboarding session ─────────────────────────────────────────
//
// One page, one link, five things: review the pricing, sign the agreement, set
// up billing, create a portal login, see where you stand. A commercial signer
// routinely cannot finish this in one sitting — they need finance to confirm a
// billing contact, or IT to approve a login — so the page is built around
// leaving and coming back rather than around a single uninterrupted run.
//
// Two consequences for how this is written:
//
//   * THE STATUS CHECKLIST IS FIRST, always. Reopening the link shows what is
//     done and what is left before it shows any form. Someone returning after
//     four days should not have to re-read the proposal to work out where they
//     got to.
//   * THE SERVER DECIDES THE STEP. `progress.current_step` comes from the real
//     proposal/agreement/billing records on every load, so a different device,
//     a cleared cache or a forwarded link all resume identically. Nothing about
//     where you are is kept in the browser.
//
// The client is never asked how they want to be billed — that was decided when
// the account was approved, and this page renders only that method's fields.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RiCheckLine,
  RiLoader4Line,
  RiArrowRightLine,
  RiFileTextLine,
  RiBankCardLine,
  RiShieldCheckLine,
  RiUserAddLine,
  RiUploadCloud2Line,
  RiMapPin2Line,
  RiTimeLine,
  RiExternalLinkLine,
} from "@remixicon/react";

import { SignaturePad } from "@/components/booking/SignaturePad";
import { CompanyCoiDownloadLink } from "@/components/commercial/CompanyCoiDownloadLink";
import { buildCommercialAgreementBase64 } from "@/lib/commercial-agreement-pdf";
import {
  money,
  BILLING_METHOD_LABELS,
  INVOICE_CYCLE_LABELS,
  NET_TERMS_LABELS,
  TERM_LABELS,
  type ProposalSite,
} from "@/lib/commercial-proposal";

type Row = Record<string, unknown>;

interface Progress {
  current_step: "pricing" | "agreement" | "billing" | "portal" | "done" | "paused";
  paused_for_changes: boolean;
  complete: boolean;
  billing_method: "auto_pay" | "invoiced";
  steps: Array<{ key: string; label: string; done: boolean }>;
  compliance: Row | null;
  billing: Row | null;
}

interface Payload {
  session: {
    id: string;
    status: string;
    billingMethod: "auto_pay" | "invoiced";
    recipientName: string | null;
    expiresAt: string | null;
    completedAt: string | null;
  };
  progress: Progress;
  account: Row | null;
  proposal: Row | null;
  sites: ProposalSite[];
  agreement: Row | null;
  billing: Row | null;
  billingProfile: Row | null;
  valueStack: Array<{ title: string; body: string }>;
  portalUrl: string;
  submissions: Row[];
}

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: Payload };

const STEP_ICONS: Record<string, typeof RiFileTextLine> = {
  pricing: RiFileTextLine,
  agreement: RiShieldCheckLine,
  billing: RiBankCardLine,
  portal: RiUserAddLine,
};

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

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {hint && <span className="ml-2 text-xs text-slate-400">{hint}</span>}
      <div className="mt-1">{children}</div>
    </label>
  );
}

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-violet-500";

export default function CommercialOnboarding({ token }: { token: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/commercial-onboarding/${token}`);
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setState({ kind: "error", message: json?.message || "This link isn't valid." });
        return;
      }
      setState({ kind: "ready", data: json as Payload });
    } catch {
      setState({ kind: "error", message: "We couldn't load your onboarding. Please try again." });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  // Coming back from Stripe's setup page: resolve the saved method rather than
  // leaving the client on a screen that still says "add a payment method".
  const returningFromStripe = useMemo(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("billing") === "done";
  }, []);

  useEffect(() => {
    if (!returningFromStripe) return;
    void (async () => {
      await fetch(`/api/commercial-onboarding/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "billing_status" }),
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
      const res = await fetch(`/api/commercial-onboarding/${token}`, {
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
  const business = String(d.account?.business_name || "your account");

  return (
    <Shell>
      <header className="mb-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-violet-600">
          Novara Cleaning
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
          Getting {business} set up
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Everything happens on this one page. You can close it and come back to this same link at
          any time — we&apos;ll pick up exactly where you left off.
        </p>
      </header>

      {/* The checklist comes first, on every visit, by design. */}
      <Checklist progress={d.progress} />

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
        {d.progress.paused_for_changes && <PausedCard proposal={d.proposal} />}

        {step === "pricing" && !d.progress.paused_for_changes && (
          <PricingStep data={d} busy={busy} onPost={post} />
        )}
        {step === "agreement" && <AgreementStep data={d} busy={busy} token={token} onDone={load} onError={setError} />}
        {step === "billing" && <BillingStep data={d} busy={busy} onPost={post} />}
        {step === "portal" && <PortalStep data={d} busy={busy} onPost={post} />}
        {step === "done" && <DoneCard data={d} />}

        <SubmitInfo busy={busy} onPost={post} submissions={d.submissions} />
      </div>

      <p className="mt-8 text-center text-xs text-slate-400">
        Questions at any point? Reply to the email this link came from and it reaches your account
        manager directly.
      </p>
    </Shell>
  );
}

// ─── Status ────────────────────────────────────────────────────────────────

function Checklist({ progress }: { progress: Progress }) {
  const outstanding = (progress.compliance as { blockers?: string[] } | null)?.blockers || [];

  return (
    <Card>
      <h2 className="text-sm font-semibold text-slate-900">Where you are</h2>
      <ol className="mt-3 space-y-2">
        {progress.steps.map((s) => {
          const Icon = STEP_ICONS[s.key] || RiFileTextLine;
          const isCurrent = progress.current_step === s.key;
          return (
            <li key={s.key} className="flex items-start gap-3">
              <span
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                  s.done
                    ? "bg-emerald-500 text-white"
                    : isCurrent
                      ? "bg-violet-100 text-violet-700 ring-2 ring-violet-300"
                      : "bg-slate-100 text-slate-400"
                }`}
              >
                {s.done ? <RiCheckLine className="h-4 w-4" /> : <Icon className="h-3.5 w-3.5" />}
              </span>
              <span
                className={`text-sm leading-6 ${
                  s.done ? "text-slate-500 line-through decoration-slate-300" : isCurrent ? "font-semibold" : "text-slate-500"
                }`}
              >
                {s.label}
                {isCurrent && !s.done && (
                  <span className="ml-2 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-700">
                    You&apos;re here
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>

      {/* What is pending on US, so the client can tell the difference between
          something they owe us and something we owe them. */}
      {progress.complete && outstanding.length > 0 && (
        <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
          <p className="font-semibold text-slate-700">On our side</p>
          <p className="mt-1">
            Your part is done. We&apos;re finishing {outstanding.join(", ")} before your first
            clean can be scheduled — nothing is needed from you.
          </p>
        </div>
      )}
    </Card>
  );
}

function PausedCard({ proposal }: { proposal: Row | null }) {
  return (
    <Card className="border-amber-200 bg-amber-50">
      <h2 className="text-base font-semibold text-amber-900">We&apos;re revising your proposal</h2>
      <p className="mt-2 text-sm leading-relaxed text-amber-900">
        Your account manager has your requested changes and is putting together a revised version.
        You&apos;ll get a new link when it&apos;s ready — nothing to do until then.
      </p>
      {proposal?.changeRequestNote ? (
        <p className="mt-3 whitespace-pre-wrap border-l-2 border-amber-300 pl-3 text-sm text-amber-800">
          {String(proposal.changeRequestNote)}
        </p>
      ) : null}
    </Card>
  );
}

// ─── Step 1: pricing ───────────────────────────────────────────────────────

function PricingStep({
  data,
  busy,
  onPost,
}: {
  data: Payload;
  busy: boolean;
  onPost: (b: Record<string, unknown>) => Promise<Row | null>;
}) {
  const [name, setName] = useState(String(data.session.recipientName || ""));
  const [title, setTitle] = useState("");
  const [showChanges, setShowChanges] = useState(false);
  const [note, setNote] = useState("");

  const p = data.proposal || {};
  const monthly = Number(p.estimatedMonthlyCents || 0);

  return (
    <Card>
      <h2 className="text-base font-semibold">Step 1 — Your pricing and terms</h2>
      <p className="mt-1 text-sm text-slate-600">
        Please check this over. Nothing is binding until you sign on the next step.
      </p>

      <div className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200">
        {data.sites.map((s) => (
          <div key={s.id || s.nickname} className="flex flex-wrap items-baseline justify-between gap-2 p-3">
            <div>
              <p className="text-sm font-semibold">{s.nickname}</p>
              <p className="text-xs text-slate-500">
                {[s.address, s.sqft ? `${s.sqft.toLocaleString()} sq ft` : null, s.facility_type, s.scope_level]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {s.frequency && <p className="text-xs text-slate-500">{s.frequency}</p>}
            </div>
            <p className="text-sm font-semibold tabular-nums">
              {money(s.per_visit_price_cents)}
              <span className="ml-1 text-xs font-normal text-slate-500">per visit</span>
            </p>
          </div>
        ))}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg bg-slate-50 p-3">
          <dt className="text-xs text-slate-500">Total per visit</dt>
          <dd className="text-lg font-bold tabular-nums">{money(Number(p.totalPerVisitCents || 0))}</dd>
        </div>
        {monthly > 0 && (
          <div className="rounded-lg bg-slate-50 p-3">
            <dt className="text-xs text-slate-500">Estimated monthly</dt>
            <dd className="text-lg font-bold tabular-nums">{money(monthly)}</dd>
          </div>
        )}
      </dl>

      <p className="mt-3 text-xs text-slate-500">
        Term: {TERM_LABELS[String(p.term || "month_to_month")] || String(p.term || "")} · Billing:{" "}
        {BILLING_METHOD_LABELS[data.session.billingMethod]}
      </p>

      {p.coverNote ? (
        <p className="mt-4 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
          {String(p.coverNote)}
        </p>
      ) : null}

      {!showChanges ? (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <Field label="Your name">
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Title" hint="optional">
              <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
          </div>
          <button
            disabled={busy || name.trim().length < 2}
            onClick={() => void onPost({ action: "accept_pricing", name, signerTitle: title })}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {busy ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : null}
            Accept and continue to the agreement
            <RiArrowRightLine className="h-4 w-4" />
          </button>
          <button
            onClick={() => setShowChanges(true)}
            className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Request changes instead
          </button>
        </>
      ) : (
        <div className="mt-5">
          <Field label="What would you like changed?">
            <textarea
              rows={4}
              className={inputCls}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Rates, cadence, which sites are included — whatever needs another look."
            />
          </Field>
          <p className="mt-2 text-xs text-slate-500">
            This pauses everything and goes to your account manager. Nothing is signed or charged.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              disabled={busy || note.trim().length < 5}
              onClick={() => void onPost({ action: "request_changes", name, note })}
              className="flex-1 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              Send to my account manager
            </button>
            <button
              onClick={() => setShowChanges(false)}
              className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700"
            >
              Back
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── Step 2: signature ─────────────────────────────────────────────────────

function AgreementStep({
  data,
  busy,
  token,
  onDone,
  onError,
}: {
  data: Payload;
  busy: boolean;
  token: string;
  onDone: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const a = data.agreement || {};
  const [legalName, setLegalName] = useState(String(a.signerName || ""));
  const [title, setTitle] = useState(String(a.signerTitle || ""));
  const [agreed, setAgreed] = useState(false);
  const [signature, setSignature] = useState("");
  const [signing, setSigning] = useState(false);

  const sign = async () => {
    setSigning(true);
    onError("");
    try {
      // The executed PDF is built in the browser from the same frozen Exhibit
      // A the server holds, then posted with the signature.
      const pdfBase64 = await buildCommercialAgreementBase64({
        businessName: String(data.account?.business_name || ""),
        clientAddress:
          [data.account?.address, data.account?.city, data.account?.state, data.account?.zip_code]
            .filter(Boolean)
            .join(", ") || null,
        signerName: legalName,
        signerTitle: title || null,
        signerEmail: String(a.signerEmail || ""),
        term: String(a.term || "month_to_month"),
        billingMethod:
          (a.billingMethod as "auto_pay" | "invoiced") || data.session.billingMethod,
        invoiceCycle: (a.invoiceCycle as string) || null,
        netTerms: (a.netTerms as string) || null,
        sites: data.sites,
        totalPerVisitCents: Number(a.totalPerVisitCents || 0),
        signatureDataUrl: signature,
      });

      const res = await fetch(`/api/commercial-onboarding/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sign",
          signerName: legalName,
          signerTitle: title,
          agreedToTerms: agreed,
          signatureDataUrl: signature,
          pdfBase64,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        onError(json?.message || "We couldn't record your signature. Please try again.");
        return;
      }
      await onDone();
    } catch {
      onError("We couldn't generate the signed document. Please reload and try again.");
    } finally {
      setSigning(false);
    }
  };

  const ready = legalName.trim().length >= 2 && agreed && signature.length > 100;

  return (
    <Card>
      <h2 className="text-base font-semibold">Step 2 — Sign the services agreement</h2>
      <p className="mt-1 text-sm text-slate-600">
        Pre-filled with everything you just accepted, including the schedule of locations and rates
        in Exhibit A.
      </p>

      {a.exhibitAText ? (
        <pre className="mt-4 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-4 font-sans text-xs leading-relaxed text-slate-700">
          {String(a.exhibitAText)}
        </pre>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Full legal name">
          <input className={inputCls} value={legalName} onChange={(e) => setLegalName(e.target.value)} />
        </Field>
        <Field label="Title" hint="optional">
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
      </div>

      <div className="mt-4">
        <span className="text-sm font-medium text-slate-700">Sign below</span>
        <div className="mt-1">
          <SignaturePad onChange={setSignature} />
        </div>
      </div>

      <label className="mt-4 flex items-start gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-1"
        />
        <span>
          I have read the Commercial Cleaning Services Agreement and I&apos;m authorized to sign it
          on behalf of {String(data.account?.business_name || "my company")}.
        </span>
      </label>

      <button
        disabled={!ready || signing || busy}
        onClick={() => void sign()}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
      >
        {signing ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : null}
        Sign and continue
        <RiArrowRightLine className="h-4 w-4" />
      </button>
    </Card>
  );
}

// ─── Step 3: billing, in the pre-selected method only ──────────────────────

function BillingStep({
  data,
  busy,
  onPost,
}: {
  data: Payload;
  busy: boolean;
  onPost: (b: Record<string, unknown>) => Promise<Row | null>;
}) {
  const method = data.session.billingMethod;
  const a = data.agreement || {};
  const [contactName, setContactName] = useState(String(a.signedByName || ""));
  const [contactEmail, setContactEmail] = useState(String(data.account?.email || ""));
  const [contactPhone, setContactPhone] = useState("");
  const [poNumber, setPoNumber] = useState("");

  // Auto-Pay. A card field, and no invoicing questions.
  if (method === "auto_pay") {
    return (
      <Card>
        <h2 className="text-base font-semibold">Step 3 — Add a payment method</h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          Your account is set up for Auto-Pay, so we&apos;ll keep a card or bank account on file and
          bill it automatically. <strong>Nothing is charged now</strong> — this only saves the
          method for future invoices.
        </p>
        <button
          disabled={busy}
          onClick={() => void onPost({ action: "setup_billing" })}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {busy ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : <RiBankCardLine className="h-4 w-4" />}
          Add a card or bank account
        </button>
        <p className="mt-2 text-center text-xs text-slate-400">
          Handled by Stripe. We never see your card number.
        </p>
      </Card>
    );
  }

  // Invoiced. No card field anywhere on this path.
  return (
    <Card>
      <h2 className="text-base font-semibold">Step 3 — Confirm your billing contact</h2>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">
        Your account is set up for invoicing, so there&apos;s no payment method to add. We just need
        to know who invoices should go to.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Billing contact name">
          <input className={inputCls} value={contactName} onChange={(e) => setContactName(e.target.value)} />
        </Field>
        <Field label="Billing email">
          <input
            className={inputCls}
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
          />
        </Field>
        <Field label="Billing phone" hint="optional">
          <input className={inputCls} value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
        </Field>
        <Field label="PO number" hint="optional">
          <input className={inputCls} value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
        </Field>
      </div>

      {/* The terms come from the agreement they just signed — shown, not asked. */}
      <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
        <p className="font-medium">Already set in your signed agreement</p>
        <p className="mt-1 text-xs text-slate-600">
          Invoices {INVOICE_CYCLE_LABELS[(a.invoiceCycle as keyof typeof INVOICE_CYCLE_LABELS) || "monthly"]?.toLowerCase() || "monthly"}
          , payable {NET_TERMS_LABELS[(a.netTerms as keyof typeof NET_TERMS_LABELS) || "on_receipt"]?.toLowerCase() || "on receipt"}.
        </p>
      </div>

      <button
        disabled={busy || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)}
        onClick={() =>
          void onPost({
            action: "setup_billing",
            billingContactName: contactName,
            billingContactEmail: contactEmail,
            billingContactPhone: contactPhone,
            poNumber,
          })
        }
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
      >
        {busy ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : null}
        Confirm billing
        <RiArrowRightLine className="h-4 w-4" />
      </button>
    </Card>
  );
}

// ─── Step 4: portal login ──────────────────────────────────────────────────

function PortalStep({
  data,
  busy,
  onPost,
}: {
  data: Payload;
  busy: boolean;
  onPost: (b: Record<string, unknown>) => Promise<Row | null>;
}) {
  const [email, setEmail] = useState(String(data.account?.email || ""));
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const mismatch = confirm.length > 0 && password !== confirm;
  const ready = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && password.length >= 8 && !mismatch;

  return (
    <Card>
      <h2 className="text-base font-semibold">Step 4 — Create your portal login</h2>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">
        Last step. This gives you an account you can sign into from now on.
      </p>

      <ul className="mt-3 space-y-1.5 text-sm text-slate-600">
        {[
          "See all of your sites and what's scheduled",
          "Look back at completed cleans",
          "Request additional service",
          "View invoices and billing status",
          "Download your agreement and our certificate of insurance",
        ].map((t) => (
          <li key={t} className="flex items-start gap-2">
            <RiCheckLine className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            {t}
          </li>
        ))}
      </ul>

      <div className="mt-4 grid gap-3">
        <Field label="Email you'll sign in with">
          <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Password" hint="8+ characters">
            <input
              className={inputCls}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field label="Confirm password">
            <input
              className={inputCls}
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
        </div>
        {mismatch && <p className="text-xs text-rose-600">Those two passwords don&apos;t match.</p>}
      </div>

      <button
        disabled={busy || !ready}
        onClick={() => void onPost({ action: "create_portal", email, password })}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
      >
        {busy ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : <RiUserAddLine className="h-4 w-4" />}
        Create my login
      </button>
    </Card>
  );
}

// ─── Done ──────────────────────────────────────────────────────────────────

function DoneCard({ data }: { data: Payload }) {
  return (
    <Card className="border-emerald-200 bg-emerald-50">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
          <RiCheckLine className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-emerald-900">You&apos;re all set</h2>
          <p className="mt-1 text-sm leading-relaxed text-emerald-900">
            Pricing accepted, agreement signed, billing configured and your portal login is ready.
            We&apos;ll be in touch to confirm your first service date.
          </p>
          <a
            href={data.portalUrl}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            Open your portal
            <RiExternalLinkLine className="h-4 w-4" />
          </a>
          <div className="mt-3">
            <CompanyCoiDownloadLink showMeta>
              Download our certificate of insurance
            </CompanyCoiDownloadLink>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ─── Submit information — available throughout, and after ──────────────────

function SubmitInfo({
  busy,
  onPost,
  submissions,
}: {
  busy: boolean;
  onPost: (b: Record<string, unknown>) => Promise<Row | null>;
  submissions: Row[];
}) {
  const [open, setOpen] = useState<"none" | "site" | "doc">("none");
  const [siteAddress, setSiteAddress] = useState("");
  const [siteNickname, setSiteNickname] = useState("");
  const [siteSqft, setSiteSqft] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<{ name: string; type: string; base64: string } | null>(null);

  const readFile = (f: File) => {
    const reader = new FileReader();
    reader.onload = () =>
      setFile({ name: f.name, type: f.type, base64: String(reader.result || "") });
    reader.readAsDataURL(f);
  };

  return (
    <Card>
      <h2 className="text-sm font-semibold">Need to send us something?</h2>
      <p className="mt-1 text-sm text-slate-600">
        You can do this at any point, including after you&apos;ve finished.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => setOpen(open === "site" ? "none" : "site")}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50"
        >
          <RiMapPin2Line className="h-4 w-4" />
          Add another location
        </button>
        <button
          onClick={() => setOpen(open === "doc" ? "none" : "doc")}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50"
        >
          <RiUploadCloud2Line className="h-4 w-4" />
          Upload a document
        </button>
      </div>

      {open === "site" && (
        <div className="mt-4 space-y-3">
          <Field label="Address of the location">
            <input className={inputCls} value={siteAddress} onChange={(e) => setSiteAddress(e.target.value)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="What do you call it?" hint="optional">
              <input className={inputCls} value={siteNickname} onChange={(e) => setSiteNickname(e.target.value)} />
            </Field>
            <Field label="Approx. sq ft" hint="optional">
              <input className={inputCls} value={siteSqft} onChange={(e) => setSiteSqft(e.target.value)} />
            </Field>
          </div>
          <Field label="Anything we should know?" hint="optional">
            <textarea rows={2} className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <p className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
            <RiTimeLine className="mr-1 inline h-3.5 w-3.5" />
            A new location needs its own walkthrough before we can price it, so this won&apos;t
            change your current pricing or agreement. Your account manager will arrange a visit.
          </p>
          <button
            disabled={busy || siteAddress.trim().length < 5}
            onClick={async () => {
              const r = await onPost({
                action: "submit_info",
                kind: "site_request",
                siteAddress,
                siteNickname,
                siteSqft,
                note,
              });
              if (r) {
                setOpen("none");
                setSiteAddress("");
                setSiteNickname("");
                setSiteSqft("");
                setNote("");
              }
            }}
            className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            Send request
          </button>
        </div>
      )}

      {open === "doc" && (
        <div className="mt-4 space-y-3">
          <Field label="File" hint="up to 12 MB">
            <input
              type="file"
              className="block w-full text-sm"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) readFile(f);
              }}
            />
          </Field>
          <Field label="What is it?" hint="optional">
            <input
              className={inputCls}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="W-9, tax exemption certificate, your COI…"
            />
          </Field>
          <button
            disabled={busy || !file}
            onClick={async () => {
              if (!file) return;
              const r = await onPost({
                action: "submit_info",
                kind: "document",
                documentName: file.name,
                documentType: file.type,
                documentBase64: file.base64,
                note,
              });
              if (r) {
                setOpen("none");
                setFile(null);
                setNote("");
              }
            }}
            className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            Upload
          </button>
        </div>
      )}

      {submissions.length > 0 && (
        <ul className="mt-4 space-y-1.5 border-t border-slate-100 pt-3 text-xs text-slate-500">
          {submissions.slice(0, 5).map((s) => (
            <li key={String(s.id)} className="flex items-center justify-between gap-2">
              <span className="truncate">
                {String(s.kind) === "site_request"
                  ? `Requested: ${String(s.site_address || s.site_nickname || "a location")}`
                  : String(s.kind) === "document"
                    ? `Uploaded: ${String(s.document_name || "a document")}`
                    : "Note sent"}
              </span>
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5">
                {String(s.status) === "pending" ? "with your account manager" : String(s.status)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
