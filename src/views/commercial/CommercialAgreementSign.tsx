"use client";

// ─── The commercial agreement page ─────────────────────────────────────────
//
// Two steps, in one session, in this order:
//
//   1. Read and sign the Commercial Cleaning Services Agreement, pre-filled
//      from the accepted proposal — including Exhibit A, which is the schedule
//      of locations and rates the client already agreed to.
//   2. Set up billing. Auto-Pay opens Stripe to save a card or bank account
//      (no charge). Invoiced confirms the billing contact and Net terms and
//      collects no payment details at all.
//
// The second step is where this differs from the residential page, which ends
// in a charge. An invoiced commercial account has no card to take and never
// was going to, so "confirm terms" is a complete ending rather than a
// half-finished one.

import {
  RiAlertLine,
  RiBankCardLine,
  RiBuilding4Line,
  RiCheckboxCircleFill,
  RiExternalLinkLine,
  RiFileTextLine,
  RiLoader4Line,
  RiMailLine,
} from "@remixicon/react";
import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

import { SEO } from "@/components/SEO";
import { SignaturePad } from "@/components/booking/SignaturePad";
import { PdfViewer } from "@/components/PdfViewer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CommercialScopePreview } from "@/components/checklists/CommercialScopePreview";
import { uniqueScopeKeysFromSites } from "@/lib/commercial-checklists";
import { CompanyCoiDownloadLink } from "@/components/commercial/CompanyCoiDownloadLink";
import {
  INVOICE_CYCLE_LABELS,
  NET_TERMS_LABELS,
  TERM_LABELS,
  money,
  titleCase,
  type InvoiceCycle,
  type NetTerms,
  type ProposalSite,
} from "@/lib/commercial-proposal";

const COMMERCIAL_AGREEMENT_PDF = "/api/commercial/agreement";

interface Payload {
  ok: true;
  agreement: {
    id: string;
    status: string;
    signerName: string | null;
    signerEmail: string | null;
    signerTitle: string | null;
    term: string;
    billingMethod: "auto_pay" | "invoiced";
    invoiceCycle: string | null;
    netTerms: string | null;
    exhibitAText: string | null;
    totalPerVisitCents: number;
    signedAt: string | null;
    signedByName: string | null;
  };
  sites: ProposalSite[];
  account: {
    business_name: string;
    contact_name: string | null;
    email: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zip_code: string | null;
  } | null;
  billing: { configured?: boolean; summary?: string; reason?: string; method?: string } | null;
}

type State =
  | { kind: "loading" }
  | { kind: "ready"; data: Payload }
  | { kind: "blocked"; message: string }
  | { kind: "complete"; data: Payload };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <div className="text-center">
          <p className="text-sm font-semibold tracking-tight text-foreground">Novara Cleaning</p>
          <p className="text-xs text-muted-foreground">Commercial Cleaning Services Agreement</p>
        </div>
        {children}
      </div>
    </div>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`token-card ${className || ""}`}>
      {children}
    </div>
  );
}

export default function CommercialAgreementSign() {
  const params = useParams<{ token: string }>();
  const search = useSearchParams();
  const token = String(params?.token || "");
  const returningFromStripe = search?.get("billing") === "done";

  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Signing
  const [signature, setSignature] = useState<string | null>(null);
  const [legalName, setLegalName] = useState("");
  const [title, setTitle] = useState("");
  const [agreed, setAgreed] = useState(false);

  // Billing
  const [billingName, setBillingName] = useState("");
  const [billingEmail, setBillingEmail] = useState("");
  const [billingPhone, setBillingPhone] = useState("");
  const [cycle, setCycle] = useState<InvoiceCycle>("monthly");
  const [terms, setTerms] = useState<NetTerms>("net_15");
  const [poNumber, setPoNumber] = useState("");

  const applyPayload = useCallback((data: Payload) => {
    setLegalName((prev) => prev || data.agreement.signerName || "");
    setTitle((prev) => prev || data.agreement.signerTitle || "");
    setBillingName((prev) => prev || data.agreement.signerName || data.account?.contact_name || "");
    setBillingEmail((prev) => prev || data.agreement.signerEmail || data.account?.email || "");
    if (data.agreement.invoiceCycle) setCycle(data.agreement.invoiceCycle as InvoiceCycle);
    if (data.agreement.netTerms) setTerms(data.agreement.netTerms as NetTerms);

    const done = data.agreement.status === "signed" && data.billing?.configured === true;
    setState(done ? { kind: "complete", data } : { kind: "ready", data });
  }, []);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`/api/commercial-agreement/${token}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setState({ kind: "blocked", message: json?.message || "This signing link isn't valid." });
        return;
      }
      applyPayload(json as Payload);
    } catch {
      setState({ kind: "blocked", message: "We couldn't load this agreement. Please try again shortly." });
    }
  }, [token, applyPayload]);

  useEffect(() => {
    void load();
  }, [load]);

  // Coming back from Stripe: resolve the saved method before rendering the
  // billing step again, so a signer who paid attention doesn't see the form
  // they just completed.
  //
  // The completion state is built from THIS response rather than a re-fetch,
  // because configuring billing retires the link — re-loading would show the
  // signer "this link is no longer valid" at the exact moment they finished.
  useEffect(() => {
    if (!returningFromStripe || !token) return;
    void (async () => {
      setBusy(true);
      try {
        const res = await fetch(`/api/commercial-agreement/${token}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "billing_status" }),
        });
        const json = await res.json();
        if (json?.ok && json.billing?.configured) {
          setState((prev) =>
            prev.kind === "ready" || prev.kind === "complete"
              ? { kind: "complete", data: { ...prev.data, billing: json.billing } }
              : prev,
          );
          return;
        }
        await load();
      } finally {
        setBusy(false);
      }
    })();
  }, [returningFromStripe, token, load]);

  const sign = async () => {
    if (state.kind !== "ready") return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/commercial-agreement/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sign",
          signerName: legalName,
          signerTitle: title,
          agreedToTerms: agreed,
          signatureDataUrl: signature,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setError(json?.message || "We couldn't record the signature. Please try again.");
        return;
      }
      // Signing burns the signing token and issues a continuation one, so the
      // URL in the address bar is already dead. Move to the new one rather
      // than re-fetching with a token that no longer resolves.
      if (json.continuationUrl) {
        window.location.replace(String(json.continuationUrl));
        return;
      }
      await load();
    } catch (err) {
      setError((err as Error).message || "We couldn't generate the signed document. Please reload and try again.");
    } finally {
      setBusy(false);
    }
  };

  const setupBilling = async (method: "auto_pay" | "invoiced") => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/commercial-agreement/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "setup_billing",
          method,
          billingContactName: billingName,
          billingContactEmail: billingEmail,
          billingContactPhone: billingPhone,
          invoiceCycle: cycle,
          netTerms: terms,
          poNumber,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setError(json?.message || "That didn't go through. Please try again.");
        return;
      }
      if (json.outcome === "redirect" && json.url) {
        window.location.href = json.url;
        return;
      }
      // Same reason as the Stripe return above: this succeeded, and the link
      // is retired now, so complete from the response rather than re-fetching.
      if (json.outcome === "billing_configured" && json.billing?.configured) {
        setState((prev) =>
          prev.kind === "ready" || prev.kind === "complete"
            ? { kind: "complete", data: { ...prev.data, billing: json.billing } }
            : prev,
        );
        return;
      }
      await load();
    } catch {
      setError("That didn't go through. Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (state.kind === "loading") {
    return (
      <Shell>
        <SEO title="Service agreement" noindex />
        <Card className="space-y-3">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-32 w-full" />
        </Card>
      </Shell>
    );
  }

  if (state.kind === "blocked") {
    return (
      <Shell>
        <SEO title="Service agreement" noindex />
        <Card className="text-center">
          <RiAlertLine className="mx-auto mb-3 h-8 w-8 text-amber-500" />
          <p className="text-sm text-foreground/80">{state.message}</p>
        </Card>
      </Shell>
    );
  }

  const { agreement, account, sites, billing } = state.data;
  const business = account?.business_name || "your account";
  const signed = agreement.status === "signed";

  if (state.kind === "complete") {
    return (
      <Shell>
        <SEO title="All set" noindex />
        <Card className="text-center">
          <RiCheckboxCircleFill className="mx-auto mb-3 h-9 w-9 text-emerald-500" />
          <p className="text-base font-semibold text-foreground">You're all set</p>
          <p className="mt-2 text-sm text-muted-foreground">
            The agreement for {business} is signed and billing is configured.
          </p>
          {billing?.summary && (
            <p className="mt-3 rounded-lg bg-brand-50 px-3 py-2 text-xs text-muted-foreground">
              {billing.summary}
            </p>
          )}
          <p className="mt-4 text-xs text-muted-foreground">
            A copy of the executed agreement and our current certificate of insurance have been
            emailed to you.
          </p>
          <div className="mt-4 flex justify-center">
            <CompanyCoiDownloadLink tone="button" showMeta>
              Download our certificate of insurance
            </CompanyCoiDownloadLink>
          </div>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <SEO title={`Service agreement — ${business}`} noindex />

      {/* Progress */}
      <div className="flex items-center gap-2 px-1 text-xs">
        <span className={`flex items-center gap-1.5 ${signed ? "text-emerald-600" : "text-primary font-medium"}`}>
          {signed ? <RiCheckboxCircleFill className="h-4 w-4" /> : <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white">1</span>}
          Sign
        </span>
        <span className="h-px flex-1 bg-[color:var(--hairline)]" />
        <span className={`flex items-center gap-1.5 ${signed ? "text-primary font-medium" : "text-muted-foreground"}`}>
          <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold text-white ${signed ? "bg-primary" : "bg-muted-foreground/40"}`}>2</span>
          Billing setup
        </span>
      </div>

      {/* Exhibit A — always visible, signed or not */}
      <Card>
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-foreground">
          <RiBuilding4Line className="h-4 w-4 text-primary" />
          Exhibit A — schedule of sites and rates
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">
          {TERM_LABELS[agreement.term] || titleCase(agreement.term)} ·{" "}
          {agreement.billingMethod === "auto_pay"
            ? "Auto-Pay"
            : `Invoiced ${INVOICE_CYCLE_LABELS[(agreement.invoiceCycle || "monthly") as InvoiceCycle]}, ${NET_TERMS_LABELS[(agreement.netTerms || "on_receipt") as NetTerms]}`}
        </p>
        <div className="divide-y divide-[color:var(--hairline)]">
          {sites.map((site, i) => (
            <div key={i} className="flex items-start justify-between gap-4 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{site.nickname}</p>
                {site.address && <p className="truncate text-xs text-muted-foreground">{site.address}</p>}
                <p className="text-xs text-muted-foreground">
                  {[
                    site.sqft ? `${site.sqft.toLocaleString()} sq ft` : null,
                    site.scope_level ? `${titleCase(site.scope_level)} scope` : null,
                    site.frequency ? titleCase(site.frequency) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <p className="shrink-0 text-sm font-semibold text-foreground">
                {money(site.per_visit_price_cents)}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-[color:var(--hairline)] pt-3">
          <p className="text-sm font-medium text-foreground/80">Total per visit</p>
          <p className="text-base font-semibold text-primary">
            {money(agreement.totalPerVisitCents)}
          </p>
        </div>
      </Card>

      <Card>
        <h2 className="mb-1 text-sm font-semibold text-foreground">Scope checklist</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Every visit is documented against this list. It matches the public commercial checklists
          and the crew&apos;s job page.
        </p>
        <div className="space-y-3">
          {uniqueScopeKeysFromSites(sites).map((scope) => (
            <CommercialScopePreview key={scope} kind={scope} />
          ))}
        </div>
      </Card>

      {/* Step 1 — sign */}
      {!signed && (
        <Card className="space-y-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <RiFileTextLine className="h-4 w-4 text-primary" />
            Sign the agreement
          </h2>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                Scroll to read the full agreement — every page is below.
              </p>
              <a
                href={COMMERCIAL_AGREEMENT_PDF}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-semibold text-primary underline underline-offset-2 flex items-center gap-1 shrink-0"
              >
                <RiExternalLinkLine className="w-3.5 h-3.5" /> Open in new tab
              </a>
            </div>
            <PdfViewer
              url={COMMERCIAL_AGREEMENT_PDF}
              title="Commercial Cleaning Services Agreement"
              className="rounded-xl border border-[color:var(--hairline)] overflow-y-auto h-[65vh] min-h-[380px] bg-slate-100 shadow-inner"
            />
            <p className="text-[11px] text-muted-foreground">
              Company maintains commercial general liability insurance.{" "}
              <CompanyCoiDownloadLink tone="quiet">View the current certificate</CompanyCoiDownloadLink>.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="ln">Full legal name</Label>
              <Input id="ln" value={legalName} onChange={(e) => setLegalName(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="ti">Title</Label>
              <Input id="ti" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Facilities Director" className="mt-1" />
            </div>
          </div>

          <div>
            <Label>Signature</Label>
            <div className="mt-1">
              <SignaturePad onChange={setSignature} />
            </div>
          </div>

          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300"
            />
            <span className="text-sm text-foreground/80">
              I have read and agree to the Commercial Cleaning Services Agreement, including the
              schedule of sites and rates in Exhibit A, and I am authorized to sign for{" "}
              {business}.
            </span>
          </label>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <Button
            className="w-full"
            disabled={busy || !signature || !agreed || legalName.trim().length < 2}
            onClick={() => void sign()}
          >
            {busy ? <RiLoader4Line className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            Sign agreement
          </Button>
        </Card>
      )}

      {/* Step 2 — billing */}
      {signed && (
        <Card className="space-y-4">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              {agreement.billingMethod === "auto_pay" ? (
                <RiBankCardLine className="h-4 w-4 text-primary" />
              ) : (
                <RiMailLine className="h-4 w-4 text-primary" />
              )}
              {agreement.billingMethod === "auto_pay" ? "Set up Auto-Pay" : "Confirm invoicing"}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {agreement.billingMethod === "auto_pay"
                ? "Save a card or bank account for automatic payment. Nothing is charged now."
                : "Confirm where invoices go and on what terms. No payment details are collected."}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="bn">Billing contact</Label>
              <Input id="bn" value={billingName} onChange={(e) => setBillingName(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="be">Billing email</Label>
              <Input id="be" type="email" value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)} className="mt-1" />
            </div>
          </div>

          {agreement.billingMethod === "invoiced" && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Invoice cycle</Label>
                  <Select value={cycle} onValueChange={(v) => setCycle(v as InvoiceCycle)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(INVOICE_CYCLE_LABELS) as InvoiceCycle[]).map((k) => (
                        <SelectItem key={k} value={k}>{INVOICE_CYCLE_LABELS[k]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Payment terms</Label>
                  <Select value={terms} onValueChange={(v) => setTerms(v as NetTerms)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(NET_TERMS_LABELS) as NetTerms[]).map((k) => (
                        <SelectItem key={k} value={k}>{NET_TERMS_LABELS[k]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label htmlFor="po">PO number (optional)</Label>
                <Input id="po" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} className="mt-1" />
              </div>
            </>
          )}

          {agreement.billingMethod === "auto_pay" && (
            <div>
              <Label htmlFor="bp">Billing phone (optional)</Label>
              <Input id="bp" value={billingPhone} onChange={(e) => setBillingPhone(e.target.value)} className="mt-1" />
            </div>
          )}

          {billing && billing.configured === false && billing.reason && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{billing.reason}</p>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}

          <Button
            className="w-full"
            disabled={busy || billingEmail.trim().length < 5}
            onClick={() => void setupBilling(agreement.billingMethod)}
          >
            {busy ? <RiLoader4Line className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            {agreement.billingMethod === "auto_pay"
              ? "Continue to add a payment method"
              : "Confirm invoicing terms"}
          </Button>
        </Card>
      )}

      <p className="pb-4 text-center text-xs text-muted-foreground">
        NovaraCleaning LLC · A copy of the executed agreement is emailed to you.
      </p>
    </Shell>
  );
}
