"use client";

// ─── The commercial proposal page ──────────────────────────────────────────
//
// Sales-facing, not legal. A decision-maker opens this to see what the work
// costs and what they get, and leaves having either agreed in principle or
// told us what to change.
//
// THERE IS NO SIGNATURE FIELD AND NO PAYMENT FIELD ON THIS PAGE, and that is
// the point rather than an omission. A contract in front of somebody who
// hasn't agreed to the shape of the deal yet is what stalls commercial sales.
// Signing happens afterwards, on the agreement's own link, against a document
// generated from exactly what was accepted here.

import {
  RiAlertLine,
  RiArrowRightLine,
  RiBuilding4Line,
  RiCheckboxCircleFill,
  RiCheckLine,
  RiEdit2Line,
  RiLoader4Line,
  RiShieldCheckLine,
} from "@remixicon/react";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";

import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  BILLING_METHOD_LABELS,
  INVOICE_CYCLE_LABELS,
  NET_TERMS_LABELS,
  TERM_LABELS,
  money,
  titleCase,
  type InvoiceCycle,
  type NetTerms,
  type ProposalSite,
  type ValueStackItem,
} from "@/lib/commercial-proposal";

interface Payload {
  ok: true;
  proposal: {
    id: string;
    version: number;
    recipientName: string | null;
    proposedFrequency: string | null;
    term: string;
    billingMethod: "auto_pay" | "invoiced";
    billingMethodLocked: boolean;
    invoiceCycle: string | null;
    netTerms: string | null;
    coverNote: string | null;
    totalPerVisitCents: number;
    estimatedMonthlyCents: number | null;
    expiresAt: string | null;
    preparedBy: string | null;
  };
  account: { business_name: string; contact_name: string | null } | null;
  sites: ProposalSite[];
  valueStack: ValueStackItem[];
}

type State =
  | { kind: "loading" }
  | { kind: "ready"; data: Payload }
  | { kind: "blocked"; message: string }
  | { kind: "accepted"; message: string; agreementUrl: string | null }
  | { kind: "changes"; message: string };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div className="text-center">
          <p className="text-sm font-semibold tracking-tight text-slate-900">Novara Cleaning</p>
          <p className="text-xs text-slate-500">Commercial service proposal</p>
        </div>
        {children}
      </div>
    </div>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${className || ""}`}>
      {children}
    </div>
  );
}

function longDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default function ProposalPage() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token || "");

  const [state, setState] = useState<State>({ kind: "loading" });
  const [mode, setMode] = useState<"review" | "accept" | "changes">("review");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [signerName, setSignerName] = useState("");
  const [signerEmail, setSignerEmail] = useState("");
  const [signerTitle, setSignerTitle] = useState("");
  const [differentSigner, setDifferentSigner] = useState(false);
  const [billingChoice, setBillingChoice] = useState<"auto_pay" | "invoiced">("invoiced");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`/api/proposal/${token}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setState({ kind: "blocked", message: json?.message || "This proposal link isn't valid." });
        return;
      }
      const data = json as Payload;
      setState({ kind: "ready", data });
      setName(data.proposal.recipientName || "");
      setBillingChoice(data.proposal.billingMethod);
    } catch {
      setState({ kind: "blocked", message: "We couldn't load this proposal. Please try again shortly." });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (action: "accept" | "request_changes") => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/proposal/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "accept"
            ? {
              action,
              name,
              email,
              billingMethod: billingChoice,
              signerName: differentSigner ? signerName : name,
              signerEmail: differentSigner ? signerEmail : email,
              signerTitle: differentSigner ? signerTitle : undefined,
            }
            : { action, name, note },
        ),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setError(json?.message || "That didn't go through. Please try again.");
        return;
      }
      if (action === "accept") {
        setState({
          kind: "accepted",
          message: json.message,
          agreementUrl: json.agreementUrl || null,
        });
      } else {
        setState({ kind: "changes", message: json.message });
      }
    } catch {
      setError("That didn't go through. Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (state.kind === "loading") {
    return (
      <Shell>
        <SEO title="Commercial proposal" noindex />
        <Card className="space-y-3">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-24 w-full" />
        </Card>
      </Shell>
    );
  }

  if (state.kind === "blocked") {
    return (
      <Shell>
        <SEO title="Commercial proposal" noindex />
        <Card className="text-center">
          <RiAlertLine className="mx-auto mb-3 h-8 w-8 text-amber-500" />
          <p className="text-sm text-slate-700">{state.message}</p>
        </Card>
      </Shell>
    );
  }

  if (state.kind === "changes") {
    return (
      <Shell>
        <SEO title="Changes requested" noindex />
        <Card className="text-center">
          <RiCheckboxCircleFill className="mx-auto mb-3 h-9 w-9 text-emerald-500" />
          <p className="text-base font-semibold text-slate-900">Thanks — we're on it</p>
          <p className="mt-2 text-sm text-slate-600">{state.message}</p>
        </Card>
      </Shell>
    );
  }

  if (state.kind === "accepted") {
    return (
      <Shell>
        <SEO title="Proposal accepted" noindex />
        <Card className="text-center">
          <RiCheckboxCircleFill className="mx-auto mb-3 h-9 w-9 text-emerald-500" />
          <p className="text-base font-semibold text-slate-900">Proposal accepted</p>
          <p className="mt-2 text-sm text-slate-600">{state.message}</p>
          {state.agreementUrl && (
            <Button className="mt-5" onClick={() => { window.location.href = state.agreementUrl!; }}>
              Review and sign the agreement
              <RiArrowRightLine className="ml-1.5 h-4 w-4" />
            </Button>
          )}
        </Card>
      </Shell>
    );
  }

  const { proposal, account, sites, valueStack } = state.data;
  const business = account?.business_name || "your facilities";

  return (
    <Shell>
      <SEO title={`Cleaning proposal — ${business}`} noindex />

      {/* Headline */}
      <div className="rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 p-6 text-white shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-white/70">
          Proposal v{proposal.version}
          {proposal.expiresAt ? ` · open until ${longDate(proposal.expiresAt)}` : ""}
        </p>
        <h1 className="mt-1 text-2xl font-semibold">{business}</h1>
        <p className="mt-1 text-sm text-white/80">
          {sites.length} location{sites.length === 1 ? "" : "s"}
          {proposal.proposedFrequency ? ` · ${titleCase(proposal.proposedFrequency)}` : ""}
        </p>
        <div className="mt-5 flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            <p className="text-xs text-white/70">Total per visit</p>
            <p className="text-2xl font-semibold">{money(proposal.totalPerVisitCents)}</p>
          </div>
          {proposal.estimatedMonthlyCents ? (
            <div>
              <p className="text-xs text-white/70">Estimated monthly</p>
              <p className="text-2xl font-semibold">{money(proposal.estimatedMonthlyCents)}</p>
            </div>
          ) : null}
        </div>
      </div>

      {proposal.coverNote && (
        <Card>
          <p className="whitespace-pre-wrap text-sm text-slate-700">{proposal.coverNote}</p>
          {proposal.preparedBy && (
            <p className="mt-3 text-xs text-slate-500">— {proposal.preparedBy}, Novara Cleaning</p>
          )}
        </Card>
      )}

      {/* The schedule */}
      <Card>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
          <RiBuilding4Line className="h-4 w-4 text-violet-600" />
          Locations and rates
        </h2>
        <div className="divide-y divide-slate-100">
          {sites.map((site, i) => (
            <div key={site.id || i} className="flex items-start justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">{site.nickname}</p>
                {site.address && <p className="truncate text-xs text-slate-500">{site.address}</p>}
                <p className="mt-1 text-xs text-slate-600">
                  {[
                    site.sqft ? `${site.sqft.toLocaleString()} sq ft` : null,
                    site.facility_type ? titleCase(site.facility_type) : null,
                    site.scope_level ? `${titleCase(site.scope_level)} scope` : null,
                    site.crew_size ? `crew of ${site.crew_size}` : null,
                    site.frequency ? titleCase(site.frequency) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold text-slate-900">
                  {money(site.per_visit_price_cents)}
                </p>
                <p className="text-xs text-slate-500">per visit</p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Terms on offer */}
      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Proposed terms</h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-slate-500">Term</dt>
            <dd className="text-sm text-slate-900">
              {TERM_LABELS[proposal.term] || titleCase(proposal.term)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Billing</dt>
            <dd className="text-sm text-slate-900">
              {BILLING_METHOD_LABELS[proposal.billingMethod]}
              {proposal.billingMethod === "invoiced" && proposal.netTerms
                ? ` — ${INVOICE_CYCLE_LABELS[(proposal.invoiceCycle || "monthly") as InvoiceCycle]}, ${
                  NET_TERMS_LABELS[proposal.netTerms as NetTerms]
                }`
                : ""}
            </dd>
          </div>
        </dl>
        <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          This proposal is an agreement in principle — nothing to sign here, and no payment details
          requested. If you accept, we'll send the service agreement pre-filled with exactly what's
          above.
        </p>
      </Card>

      {/* Why us */}
      <Card>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
          <RiShieldCheckLine className="h-4 w-4 text-violet-600" />
          What's included
        </h2>
        <div className="space-y-3">
          {valueStack.map((item) => (
            <div key={item.title} className="flex gap-2.5">
              <RiCheckLine className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              <div>
                <p className="text-sm font-medium text-slate-900">{item.title}</p>
                <p className="text-xs leading-relaxed text-slate-600">{item.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* The only two actions on this page */}
      {mode === "review" && (
        <Card className="space-y-3">
          <p className="text-sm font-semibold text-slate-900">Ready to move forward?</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button className="flex-1" onClick={() => setMode("accept")}>
              <RiCheckLine className="mr-1.5 h-4 w-4" />
              Accept this proposal
            </Button>
            <Button variant="outline" className="flex-1" onClick={() => setMode("changes")}>
              <RiEdit2Line className="mr-1.5 h-4 w-4" />
              Request changes
            </Button>
          </div>
        </Card>
      )}

      {mode === "accept" && (
        <Card className="space-y-4">
          <div>
            <p className="text-sm font-semibold text-slate-900">Accept this proposal</p>
            <p className="mt-1 text-xs text-slate-600">
              This records your agreement in principle. The service agreement follows for signature.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="name">Your name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="email">Your email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>

          {!proposal.billingMethodLocked && (
            <div>
              <Label>How would you like to be billed?</Label>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {(["invoiced", "auto_pay"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setBillingChoice(m)}
                    className={`rounded-lg border px-3 py-2.5 text-left transition ${
                      billingChoice === m
                        ? "border-violet-500 bg-violet-50"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <p className="text-sm font-medium text-slate-900">{BILLING_METHOD_LABELS[m]}</p>
                    <p className="text-xs text-slate-600">
                      {m === "invoiced"
                        ? "We invoice your billing contact on Net terms."
                        : "Card or bank account on file, charged automatically."}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-lg border border-slate-200 p-3">
            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={differentSigner}
                onChange={(e) => setDifferentSigner(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300"
              />
              <span className="text-sm text-slate-700">
                Someone else signs our contracts
              </span>
            </label>
            {differentSigner && (
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div>
                  <Label htmlFor="sn">Signer name</Label>
                  <Input id="sn" value={signerName} onChange={(e) => setSignerName(e.target.value)} className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="se">Signer email</Label>
                  <Input id="se" type="email" value={signerEmail} onChange={(e) => setSignerEmail(e.target.value)} className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="st">Title</Label>
                  <Input id="st" value={signerTitle} onChange={(e) => setSignerTitle(e.target.value)} className="mt-1" />
                </div>
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2">
            <Button
              className="flex-1"
              disabled={busy || name.trim().length < 2}
              onClick={() => void submit("accept")}
            >
              {busy ? <RiLoader4Line className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Accept proposal
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setMode("review")}>
              Back
            </Button>
          </div>
        </Card>
      )}

      {mode === "changes" && (
        <Card className="space-y-4">
          <div>
            <p className="text-sm font-semibold text-slate-900">What would you like changed?</p>
            <p className="mt-1 text-xs text-slate-600">
              This goes straight to your account manager. We'll send a revised proposal — the current
              version stays on file.
            </p>
          </div>
          <div>
            <Label htmlFor="cname">Your name</Label>
            <Input id="cname" value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="note">What needs to change</Label>
            <Textarea
              id="note"
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. We'd need Saturday service at the main campus instead of weekday evenings, and can you quote adding the annex?"
              className="mt-1"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2">
            <Button
              className="flex-1"
              disabled={busy || note.trim().length < 5}
              onClick={() => void submit("request_changes")}
            >
              {busy ? <RiLoader4Line className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Send to my account manager
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setMode("review")}>
              Back
            </Button>
          </div>
        </Card>
      )}

      <p className="pb-4 text-center text-xs text-slate-400">
        NovaraCleaning LLC · Questions? Reply to the email this link came from.
      </p>
    </Shell>
  );
}
