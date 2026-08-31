"use client";

// ─── Commercial hub → Send Proposal ────────────────────────────────────────
//
// The commercial analogue of Internal Booking. Same shape: numbered sections
// on the left, a sticky live-quote rail on the right, one Send click that
// emails a tokenized link.
//
// Differences that are the point of this path, not bugs:
//   • The number comes from a walkthrough (or the rate engine under the
//     threshold) — there is no "estimate range" to send.
//   • The link is /proposal/[token], which cannot accept a signature or a
//     payment identifier. Accept / Request Changes only.
//   • Every active site on the account goes on the proposal. Omitting one
//     silently is how a client accepts a schedule that is missing a building.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RiArrowRightLine,
  RiBuilding2Line,
  RiCheckboxCircleLine,
  RiFileCopyLine,
  RiFileTextLine,
  RiInformationLine,
  RiLoader4Line,
  RiMailLine,
  RiMailSendLine,
  RiSaveLine,
  RiSearchLine,
  RiSparklingLine,
  RiUserLine,
} from "@remixicon/react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { commercialProposalApi } from "@/lib/commercial-proposal-api";
import {
  BILLING_METHOD_LABELS,
  BILLING_METHOD_OPTIONS,
  FREQUENCY_OPTIONS,
  INVOICE_CYCLE_LABELS,
  NET_TERMS_LABELS,
  STAGE_LABELS,
  TERM_OPTIONS,
  commercialTab,
  estimatedMonthlyCents,
  money,
  proposalPrefillFromWalkthrough,
  siteRateCentsFromWalkthrough,
  titleCase,
  totalPerVisitCents,
  type BillingMethod,
  type InvoiceCycle,
  type NetTerms,
  type PipelineStage,
} from "@/lib/commercial-proposal";

interface Deal {
  account_id: string;
  business_name: string;
  account_type: string;
  account_status: string;
  email: string | null;
  contact_name: string | null;
  active_sites: number;
  priced_sites: number;
  excluded_sites: number;
  proposal_id: string | null;
  proposal_version: number | null;
  proposal_status: string | null;
  total_per_visit_cents: number | null;
  stage: PipelineStage;
}

interface ReadySite {
  site_id: string;
  nickname: string;
  address?: string | null;
  facility_type?: string | null;
  scope_level?: string | null;
  sqft?: number | null;
  crew_size?: number | null;
  firm_price_cents?: number | null;
  formula_price_cents?: number | null;
  price_source?: string | null;
  ready: boolean;
  reason?: string | null;
  stage?: string | null;
  walkthrough_status?: string | null;
}

interface SendResult {
  proposalId: string;
  version: number;
  link: string | null;
  emailed: boolean;
  emailError: string | null;
  expiresAt: string | null;
  totalPerVisitCents: number;
  estimatedMonthlyCents: number | null;
  sent: boolean;
}

function centsToDollars(cents: number | null | undefined): string {
  const n = Number(cents || 0) / 100;
  return n > 0 ? n.toFixed(2) : "";
}

function dollarsToCents(raw: string): number | null {
  const n = Math.round(parseFloat(raw) * 100);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export default function CommercialProposalSend({
  initialAccountId = "",
  inProposalsHub = false,
  walkthroughsHref,
}: {
  initialAccountId?: string;
  inProposalsHub?: boolean;
  walkthroughsHref?: string;
}) {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [search, setSearch] = useState("");
  const [accountId, setAccountId] = useState(initialAccountId);
  const [detail, setDetail] = useState<Record<string, any> | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [frequency, setFrequency] = useState("weekly");
  const [customFrequency, setCustomFrequency] = useState("");
  const [term, setTerm] = useState<"month_to_month" | "annual">("month_to_month");
  const [billingMethod, setBillingMethod] = useState<BillingMethod>("invoiced");
  const [invoiceCycle, setInvoiceCycle] = useState<InvoiceCycle>("monthly");
  const [netTerms, setNetTerms] = useState<NetTerms>("net_15");
  const [coverNote, setCoverNote] = useState("");
  const [sitePrices, setSitePrices] = useState<Record<string, string>>({});
  const [priceTouched, setPriceTouched] = useState<Record<string, boolean>>({});

  const [busy, setBusy] = useState<"send" | "draft" | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);

  const loadDeals = useCallback(async () => {
    setLoadingList(true);
    try {
      const out = await commercialProposalApi("GET", undefined, "?view=pipeline");
      setDeals((out.deals || []) as Deal[]);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    void loadDeals();
  }, [loadDeals]);

  const loadAccount = useCallback(async (id: string) => {
    if (!id) {
      setDetail(null);
      return;
    }
    setLoadingDetail(true);
    try {
      const out = await commercialProposalApi("GET", undefined, `?accountId=${id}`);
      setDetail(out);
      const prefill = out.walkthroughSource?.prefill || proposalPrefillFromWalkthrough({
        account: out.account,
        request: out.walkthroughSource?.request,
      });
      setRecipientName(prefill.name);
      setRecipientEmail(prefill.email);
      setRecipientPhone(prefill.phone);
      const freq = String(prefill.frequency || "weekly");
      const known = FREQUENCY_OPTIONS.some((o) => o.id === freq);
      setFrequency(known ? freq : "custom");
      if (!known) setCustomFrequency(freq);
      const prices: Record<string, string> = {};
      for (const site of (out.readiness?.sites || []) as ReadySite[]) {
        if (String(site.stage || "") === "excluded") continue;
        const cents = siteRateCentsFromWalkthrough(site);
        if (cents) prices[site.site_id] = centsToDollars(cents);
      }
      setSitePrices(prices);
      setPriceTouched({});
    } catch (err) {
      toast.error((err as Error).message);
      setDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (initialAccountId) setAccountId(initialAccountId);
  }, [initialAccountId]);

  useEffect(() => {
    if (accountId) void loadAccount(accountId);
  }, [accountId, loadAccount]);

  const deal = useMemo(() => deals.find((d) => d.account_id === accountId) || null, [deals, accountId]);
  const filteredDeals = useMemo(() => {
    const q = search.trim().toLowerCase();
    return deals
      .filter((d) => d.account_status !== "offboarded")
      .filter((d) => !q || `${d.business_name} ${d.email || ""} ${d.contact_name || ""}`.toLowerCase().includes(q))
      .sort((a, b) => {
        const rank = (s: PipelineStage) =>
          s === "firm_price_ready" || s === "changes_requested" || s === "proposal_expired" ? 0 : 1;
        return rank(a.stage) - rank(b.stage) || a.business_name.localeCompare(b.business_name);
      });
  }, [deals, search]);

  const sites = (detail?.readiness?.sites || []) as ReadySite[];
  const excludedSites = sites.filter((s) => String(s.stage || "") === "excluded");
  const proposalSites = sites.filter((s) => String(s.stage || "") !== "excluded");
  const resolvedFrequency = frequency === "custom" ? customFrequency.trim() : frequency;

  const pricedSites = proposalSites.map((s) => ({
    ...s,
    per_visit_price_cents:
      dollarsToCents(sitePrices[s.site_id] || "")
      || siteRateCentsFromWalkthrough(s)
      || 0,
    frequency: resolvedFrequency,
  }));
  const perVisit = totalPerVisitCents(pricedSites);
  const monthly = estimatedMonthlyCents(pricedSites, resolvedFrequency);
  const liveProposal = (detail?.proposals || []).find((p: { status: string }) =>
    ["draft", "sent"].includes(p.status),
  );

  const requirements = useMemo(() => {
    const out: string[] = [];
    if (!accountId) out.push("Pick the account this proposal is for");
    if (!recipientName.trim()) out.push("Decision-maker's name (from the walkthrough, or type it)");
    if (!recipientEmail.trim() || !recipientEmail.includes("@")) {
      out.push("Decision-maker's email (from the walkthrough, or type it)");
    }
    if (!resolvedFrequency) out.push("Service frequency");
    if (accountId && proposalSites.length === 0) {
      out.push("At least one site that is not excluded");
    }
    for (const s of proposalSites) {
      if (!dollarsToCents(sitePrices[s.site_id] || "") && !siteRateCentsFromWalkthrough(s)) {
        out.push(`${s.nickname} still needs a per-visit rate — walkthrough did not set one`);
      }
    }
    return out;
  }, [accountId, recipientName, recipientEmail, resolvedFrequency, proposalSites, sitePrices]);

  const canSubmit = requirements.length === 0;

  const submit = async (send: boolean) => {
    if (!canSubmit && send) return;
    if (!accountId) return;
    setBusy(send ? "send" : "draft");
    try {
      const out = await commercialProposalApi("POST", {
        action: "create_draft",
        send,
        accountId,
        supersedesId: liveProposal?.id,
        recipientName: recipientName.trim(),
        recipientEmail: recipientEmail.trim(),
        recipientPhone: recipientPhone.trim() || undefined,
        frequency: resolvedFrequency,
        term,
        billingMethod,
        invoiceCycle,
        netTerms,
        coverNote: coverNote.trim() || undefined,
        siteOverrides: pricedSites.map((s) => ({
          siteId: s.site_id,
          perVisitPriceCents: s.per_visit_price_cents,
          frequency: resolvedFrequency,
        })),
      });
      if (send) {
        setResult({
          proposalId: out.proposalId,
          version: out.version,
          link: out.link || null,
          emailed: out.emailed === true,
          emailError: out.emailError || null,
          expiresAt: out.expiresAt || null,
          totalPerVisitCents: Number(out.totalPerVisitCents || perVisit),
          estimatedMonthlyCents: out.estimatedMonthlyCents ?? monthly,
          sent: true,
        });
        if (out.emailed === false) {
          toast.warning(out.emailError || "Proposal saved but the email did not send — copy the link.");
        } else {
          toast.success("Proposal sent.");
        }
      } else {
        toast.success(`Draft v${out.version} saved.`);
        await loadAccount(accountId);
        await loadDeals();
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const reset = () => {
    setResult(null);
    setAccountId("");
    setDetail(null);
    setRecipientName("");
    setRecipientEmail("");
    setRecipientPhone("");
    setFrequency("weekly");
    setCustomFrequency("");
    setTerm("month_to_month");
    setBillingMethod("invoiced");
    setInvoiceCycle("monthly");
    setNetTerms("net_15");
    setCoverNote("");
    setSitePrices({});
    setPriceTouched({});
    void loadDeals();
  };

  if (result) {
    return (
      <div className="max-w-2xl mx-auto">
        <Card className="border border-slate-200 shadow-[0_4px_24px_-12px_rgba(15,23,42,0.12)] rounded-2xl overflow-hidden">
          <div className="h-1.5 w-full bg-gradient-to-r from-violet-500 via-violet-400 to-teal-400" />
          <CardHeader className="text-center pt-10">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-violet-50 flex items-center justify-center ring-1 ring-violet-200">
              <RiCheckboxCircleLine className="w-7 h-7 text-violet-600" />
            </div>
            <Badge className="mx-auto mt-3 bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-50 font-medium">
              Proposal v{result.version} sent
            </Badge>
            <CardTitle className="font-jakarta text-2xl mt-3 text-slate-900 tracking-tight">
              {deal?.business_name || detail?.account?.business_name || "Proposal"} pending review
            </CardTitle>
            <CardDescription className="mt-1">
              {result.emailed
                ? `Emailed to ${recipientEmail}. Nothing to sign and no payment details requested — Accept or Request Changes only.`
                : "The link is live. The email did not send — copy it and get it to the decision-maker another way."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 pb-8">
            <div className="rounded-xl bg-slate-50 p-5 space-y-2 text-sm border border-slate-100">
              <SummaryRow label="To" value={`${recipientName} · ${recipientEmail}`} />
              <SummaryRow label="Frequency" value={titleCase(resolvedFrequency)} />
              <SummaryRow label="Billing" value={BILLING_METHOD_LABELS[billingMethod]} />
              <SummaryRow label="Sites" value={String(pricedSites.length)} />
              <div className="flex items-center justify-between text-sm pt-1">
                <span className="text-slate-500">Per visit</span>
                <span className="font-semibold text-slate-900 tabular-nums">{money(result.totalPerVisitCents)}</span>
              </div>
              {result.estimatedMonthlyCents != null && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">Est. monthly</span>
                  <span className="tabular-nums">{money(result.estimatedMonthlyCents)}</span>
                </div>
              )}
            </div>

            {result.link && (
              <div className="rounded-xl bg-slate-50 p-4 space-y-2 text-sm border border-slate-100">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Proposal link (tokenized — forwarding it is the credential)
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Input value={result.link} readOnly className="font-mono text-xs bg-white min-w-0 flex-1" />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      void navigator.clipboard.writeText(result.link!);
                      toast.success("Link copied");
                    }}
                  >
                    <RiFileCopyLine className="w-4 h-4 mr-1.5" />
                    Copy
                  </Button>
                </div>
              </div>
            )}

            {result.emailError && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                {result.emailError}
              </p>
            )}

            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1" onClick={reset}>
                Send another
              </Button>
              <Button className="flex-1 bg-violet-600 hover:bg-violet-700 text-white" asChild>
                <a href={commercialTab("pipeline")}>
                  Open pipeline
                  <RiArrowRightLine className="w-4 h-4 ml-1.5" />
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-[1240px] mx-auto">
      <header className="mb-6">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[10px] font-bold tracking-[0.12em] uppercase text-violet-700/80 bg-violet-50 border border-violet-200/70 rounded-full px-2 py-0.5">
            Workspace · {inProposalsHub ? "Proposals" : "Commercial"}
          </span>
        </div>
        <h2 className="font-jakarta text-[22px] leading-tight font-bold tracking-tight text-slate-900">
          Send a commercial proposal
        </h2>
        <p className="text-sm text-slate-500 mt-1 max-w-2xl">
          Same motion as Internal Booking: pick the account, confirm rates from the walkthrough
          (or type them), set terms, send a tokenized link. No client portal login is required
          to send. The client can accept or request changes — nothing to sign and no payment
          details on that page.
        </p>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className="xl:col-span-8 space-y-5">
          <FormSection
            number={1}
            title="Account"
            description="Who is this proposal for? Rates pull from the walkthrough; you can type any field the visit did not fill."
            icon={<RiSearchLine className="w-4 h-4" />}
          >
            <div className="relative">
              <RiSearchLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search business, contact, or email…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 bg-slate-50 border-slate-200 focus-visible:bg-white"
              />
            </div>
            <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 max-h-72 overflow-y-auto">
              {loadingList && <Skeleton className="h-10 w-full m-2" />}
              {!loadingList && filteredDeals.length === 0 && (
                <p className="text-xs text-slate-500 p-3">No matching accounts.</p>
              )}
              {filteredDeals.map((d) => {
                const selected = accountId === d.account_id;
                const ready = d.stage === "firm_price_ready" || d.stage === "changes_requested" || d.stage === "proposal_expired";
                return (
                  <button
                    key={d.account_id}
                    type="button"
                    onClick={() => {
                      setAccountId(d.account_id);
                      setRecipientName(d.contact_name || "");
                      setRecipientEmail(d.email || "");
                    }}
                    className={cn(
                      "w-full text-left p-3 hover:bg-slate-50 flex items-center justify-between gap-3 transition-colors",
                      selected && "bg-violet-50/60",
                    )}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">{d.business_name}</p>
                      <p className="text-xs text-slate-500 truncate">
                        {d.contact_name || "No contact"} · {d.email || "no email"}
                        {d.priced_sites != null ? ` · ${d.priced_sites}/${Math.max(0, d.active_sites - d.excluded_sites)} sites priced` : ""}
                      </p>
                    </div>
                    <Badge
                      className={cn(
                        "shrink-0 border-0 text-[10px]",
                        ready ? "bg-sky-100 text-sky-700" : "bg-slate-100 text-slate-600",
                      )}
                    >
                      {STAGE_LABELS[d.stage]}
                    </Badge>
                  </button>
                );
              })}
            </div>
          </FormSection>

          {accountId && (
            <>
              <FormSection
                number={2}
                title="Sites & rates"
                description="Every active site goes on the proposal. The walkthrough fills the rate when it has one; type a number to send without waiting on a firm-price step."
                icon={<RiBuilding2Line className="w-4 h-4" />}
              >
                {loadingDetail ? (
                  <Skeleton className="h-24 w-full" />
                ) : (
                  <div className="space-y-3">
                    {excludedSites.length > 0 && (
                      <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
                        <p className="font-semibold mb-1">Excluded — not on this proposal</p>
                        <ul className="space-y-1">
                          {excludedSites.map((s) => (
                            <li key={s.site_id}>
                              {s.nickname} — {s.reason || "outside what we service"}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {proposalSites.length === 0 && excludedSites.length === 0 && (
                      <p className="text-xs text-slate-500">This account has no active sites.</p>
                    )}
                    {proposalSites.some((s) => !siteRateCentsFromWalkthrough(s)) && (
                      <p className="text-[11px] text-slate-500">
                        A site has no walkthrough rate yet — type one, or{" "}
                        <a
                          href={walkthroughsHref || commercialTab("walkthroughs")}
                          className="font-semibold underline"
                        >
                          open walkthroughs
                        </a>
                        .
                      </p>
                    )}
                    {proposalSites.map((s) => {
                      const fromWalkthrough = Boolean(siteRateCentsFromWalkthrough(s));
                      return (
                        <div key={s.site_id} className="rounded-xl border border-slate-200 p-3 grid sm:grid-cols-12 gap-3 items-end">
                          <div className="sm:col-span-7 min-w-0">
                            <p className="text-sm font-semibold text-slate-900 truncate">{s.nickname}</p>
                            <p className="text-[11px] text-slate-500 truncate">
                              {[
                                s.address,
                                s.facility_type && titleCase(String(s.facility_type)),
                                s.sqft && `${Number(s.sqft).toLocaleString()} sq ft`,
                                fromWalkthrough ? "walkthrough" : (s.reason || "type a rate"),
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          </div>
                          <div className="sm:col-span-5">
                            <Field label="Per-visit rate" required>
                              <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">$</span>
                                <Input
                                  inputMode="decimal"
                                  value={sitePrices[s.site_id] || ""}
                                  onChange={(e) => {
                                    setSitePrices((prev) => ({ ...prev, [s.site_id]: e.target.value }));
                                    setPriceTouched((prev) => ({ ...prev, [s.site_id]: true }));
                                  }}
                                  placeholder={fromWalkthrough ? undefined : "Type the rate"}
                                  className="pl-7 tabular-nums"
                                />
                              </div>
                            </Field>
                            {priceTouched[s.site_id] && (
                              <p className="text-[10px] text-violet-700 mt-1">
                                {fromWalkthrough
                                  ? "Override — the walkthrough number stays on the account."
                                  : "Admin rate — no firm walkthrough price on file."}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </FormSection>

              <FormSection
                number={3}
                title="Terms"
                description="Cadence, term, and how they will be billed after they sign. The proposal itself never collects a card."
                icon={<RiFileTextLine className="w-4 h-4" />}
              >
                <p className="text-xs font-semibold text-slate-700">Frequency</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {FREQUENCY_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setFrequency(opt.id)}
                      className={cn(
                        "text-left rounded-xl border-2 bg-white p-3 transition-all",
                        frequency === opt.id ? "border-violet-500 shadow-sm" : "border-slate-200 hover:border-violet-300",
                      )}
                    >
                      <p className="text-sm font-semibold text-slate-900">{opt.label}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">{opt.sub}</p>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setFrequency("custom")}
                  className={cn(
                    "text-left rounded-xl border-2 bg-white p-3 transition-all w-full",
                    frequency === "custom" ? "border-violet-500 shadow-sm" : "border-slate-200 hover:border-violet-300",
                  )}
                >
                  <p className="text-sm font-semibold text-slate-900">Custom cadence</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">e.g. weekdays, every other Tuesday</p>
                </button>
                {frequency === "custom" && (
                  <Input
                    value={customFrequency}
                    onChange={(e) => setCustomFrequency(e.target.value)}
                    placeholder="Describe the cadence…"
                  />
                )}

                <p className="text-xs font-semibold text-slate-700 pt-2">Term</p>
                <div className="grid sm:grid-cols-2 gap-2">
                  {TERM_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setTerm(opt.id)}
                      className={cn(
                        "text-left rounded-xl border-2 bg-white p-3 transition-all",
                        term === opt.id ? "border-violet-500 shadow-sm" : "border-slate-200 hover:border-violet-300",
                      )}
                    >
                      <p className="text-sm font-semibold text-slate-900">{opt.label}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">{opt.sub}</p>
                    </button>
                  ))}
                </div>

                <p className="text-xs font-semibold text-slate-700 pt-2">Billing after they sign</p>
                <div className="grid sm:grid-cols-2 gap-2">
                  {BILLING_METHOD_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setBillingMethod(opt.id)}
                      className={cn(
                        "text-left rounded-xl border-2 bg-white p-3 transition-all",
                        billingMethod === opt.id ? "border-violet-500 shadow-sm" : "border-slate-200 hover:border-violet-300",
                      )}
                    >
                      <p className="text-sm font-semibold text-slate-900">{opt.label}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">{opt.sub}</p>
                    </button>
                  ))}
                </div>
                {billingMethod === "invoiced" && (
                  <div className="grid sm:grid-cols-2 gap-3">
                    <Field label="Invoice cycle">
                      <Select value={invoiceCycle} onValueChange={(v) => setInvoiceCycle(v as InvoiceCycle)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(Object.keys(INVOICE_CYCLE_LABELS) as InvoiceCycle[]).map((k) => (
                            <SelectItem key={k} value={k}>{INVOICE_CYCLE_LABELS[k]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Payment terms">
                      <Select value={netTerms} onValueChange={(v) => setNetTerms(v as NetTerms)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(Object.keys(NET_TERMS_LABELS) as NetTerms[]).map((k) => (
                            <SelectItem key={k} value={k}>{NET_TERMS_LABELS[k]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                )}
              </FormSection>

              <FormSection
                number={4}
                title="Recipient"
                description="Pulled from the walkthrough request when the account contact is empty. Type over any field."
                icon={<RiUserLine className="w-4 h-4" />}
              >
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Name" required>
                    <Input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="Jordan Lee" />
                  </Field>
                  <Field label="Email" required>
                    <Input type="email" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} placeholder="jordan@company.com" />
                  </Field>
                </div>
                <Field label="Phone" hint="Optional — used if we need to follow up off-email.">
                  <Input type="tel" value={recipientPhone} onChange={(e) => setRecipientPhone(e.target.value)} placeholder="+1 301-555-0199" />
                </Field>
                <Field label="Cover note" hint="Shown at the top of the proposal. Use it for what changed, or what they asked for.">
                  <Textarea
                    rows={4}
                    value={coverNote}
                    onChange={(e) => setCoverNote(e.target.value)}
                    placeholder="A line or two on the walkthrough, the cadence, or what moved since the last version."
                  />
                </Field>
              </FormSection>
            </>
          )}
        </div>

        <aside className="xl:col-span-4">
          <div className="xl:sticky xl:top-6 space-y-4">
            <Card className="border border-slate-200 rounded-2xl overflow-hidden shadow-[0_4px_24px_-12px_rgba(15,23,42,0.12)]">
              <div className="relative bg-gradient-to-br from-violet-600 via-violet-500 to-teal-500 px-5 py-5 text-white">
                <div className="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-full blur-2xl -translate-y-8 translate-x-8" />
                <div className="relative flex items-center gap-2">
                  <RiSparklingLine className="w-4 h-4" />
                  <p className="font-jakarta font-bold text-sm tracking-tight">Live proposal</p>
                </div>
                <p className="relative text-[11px] text-white/85 mt-0.5">
                  Updates as you adjust sites, cadence, and terms.
                </p>
              </div>
              <CardContent className="space-y-2.5 pt-5 pb-5">
                {deal ? (
                  <p className="text-sm font-semibold text-slate-900 truncate">{deal.business_name}</p>
                ) : (
                  <p className="text-sm text-slate-400">No account selected</p>
                )}
                <SummaryRow label="Sites on this proposal" value={String(proposalSites.length)} />
                <SummaryRow label="Frequency" value={resolvedFrequency || "—"} />
                <SummaryRow label="Billing" value={BILLING_METHOD_LABELS[billingMethod]} />
                <div className="h-px bg-slate-100 my-1.5" />
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Per visit</span>
                  <span className="font-jakarta text-2xl font-bold text-slate-900 tabular-nums">
                    {perVisit > 0 ? money(perVisit) : "—"}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div className="rounded-lg bg-slate-50 border border-slate-200 px-2.5 py-1.5">
                    <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Est. monthly</p>
                    <p className="text-sm font-bold text-slate-900 tabular-nums">
                      {monthly != null ? money(monthly) : "—"}
                    </p>
                  </div>
                  <div className="rounded-lg bg-slate-50 border border-slate-200 px-2.5 py-1.5">
                    <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Term</p>
                    <p className="text-sm font-bold text-slate-900">
                      {term === "annual" ? "12 months" : "M-to-M"}
                    </p>
                  </div>
                </div>

                {liveProposal && (
                  <div className="rounded-lg border border-violet-200 bg-violet-50 p-2.5 text-[11px] text-violet-900 mt-2">
                    Sending replaces the live {liveProposal.status} v{liveProposal.version}. The previous
                    version is kept in history; its link is retired.
                  </div>
                )}

                <Button
                  onClick={() => void submit(true)}
                  disabled={!canSubmit || busy !== null}
                  size="lg"
                  className="w-full mt-3 bg-violet-600 hover:bg-violet-700 text-white"
                >
                  {busy === "send" ? (
                    <>
                      <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" />
                      Sending…
                    </>
                  ) : (
                    <>
                      <RiMailSendLine className="w-4 h-4 mr-2" />
                      Send proposal
                      <RiArrowRightLine className="w-4 h-4 ml-2" />
                    </>
                  )}
                </Button>
                <Button
                  onClick={() => void submit(false)}
                  disabled={!accountId || proposalSites.length === 0 || busy !== null}
                  variant="outline"
                  size="sm"
                  className="w-full mt-2 text-slate-600"
                >
                  {busy === "draft" ? (
                    <>
                      <RiLoader4Line className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                      Saving draft…
                    </>
                  ) : (
                    <>
                      <RiSaveLine className="w-3.5 h-3.5 mr-1.5" />
                      Save as draft
                    </>
                  )}
                </Button>

                {!canSubmit && requirements.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-900 mt-1">
                    <div className="flex items-center gap-1.5 mb-1 font-semibold">
                      <RiInformationLine className="w-3.5 h-3.5" />
                      Still needed
                    </div>
                    <ul className="list-disc list-inside space-y-0.5">
                      {requirements.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border border-slate-200 rounded-2xl shadow-sm">
              <CardContent className="p-4 text-[11px] text-slate-500 space-y-1.5">
                <p className="flex items-center gap-1.5">
                  <RiMailLine className="w-3.5 h-3.5 text-slate-400" />
                  <span className="font-medium text-slate-700">What the client gets</span>
                </p>
                <p className="leading-relaxed">
                  A tokenized page on commercial.novaracleaning.com listing every location and the
                  per-visit rate. They can Accept or Request Changes. Signing and billing happen on a
                  separate agreement link after they accept — never on the proposal.
                </p>
              </CardContent>
            </Card>
          </div>
        </aside>
      </div>
    </div>
  );
}

function FormSection({
  number,
  title,
  description,
  icon,
  children,
}: {
  number: number;
  title: string;
  description?: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="border border-slate-200 rounded-2xl shadow-[0_1px_2px_0_rgba(15,23,42,0.04)]">
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <span className="relative shrink-0 w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-violet-700 text-white inline-flex items-center justify-center font-jakarta font-bold text-sm">
            {number}
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex items-center gap-1.5">
              <span className="text-violet-700">{icon}</span>
              <CardTitle className="font-jakarta text-base font-bold text-slate-900 tracking-tight">
                {title}
              </CardTitle>
            </div>
            {description && (
              <CardDescription className="text-xs text-slate-500 mt-0.5">{description}</CardDescription>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-1">{children}</CardContent>
    </Card>
  );
}

function Field({
  label,
  children,
  required = false,
  hint,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  required?: boolean;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold text-slate-700">
        {label}
        {required && <span className="text-violet-600 ml-0.5">*</span>}
      </Label>
      {children}
      {hint && <p className="text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm gap-3">
      <span className="text-slate-500 truncate">{label}</span>
      <span className="tabular-nums text-slate-800 shrink-0">{value}</span>
    </div>
  );
}
