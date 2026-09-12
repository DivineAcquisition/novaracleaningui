"use client";

// ─── Proposals → Send ──────────────────────────────────────────────────────
//
// Same motion as Internal Booking: type the details needed to send, or
// optionally prefill from an existing account. A saved commercial account
// is not required.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RiAddLine,
  RiArrowRightLine,
  RiBuilding2Line,
  RiCheckboxCircleLine,
  RiCloseLine,
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { commercialProposalApi } from "@/lib/commercial-proposal-api";
import { proposalSendRequirements } from "@/lib/commercial-proposal-send";
import {
  BILLING_METHOD_LABELS,
  BILLING_METHOD_OPTIONS,
  FREQUENCY_OPTIONS,
  INVOICE_CYCLE_LABELS,
  NET_TERMS_LABELS,
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
} from "@/lib/commercial-proposal";

const FACILITY_TYPES = [
  "Office", "Retail", "Medical / Dental", "Restaurant / Food", "Gym / Fitness",
  "Salon / Spa", "School / Daycare", "Warehouse / Industrial", "Church / Worship",
  "Other",
];

interface AccountHit {
  id: string;
  business_name: string;
  account_type: string;
  status: string;
  email: string | null;
  contact_name: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  facility_type: string | null;
  square_footage: number | null;
  recurring_frequency: string | null;
}

interface ReadySite {
  site_id: string;
  nickname: string;
  address?: string | null;
  facility_type?: string | null;
  sqft?: number | null;
  firm_price_cents?: number | null;
  formula_price_cents?: number | null;
  stage?: string | null;
  reason?: string | null;
}

interface FormSite {
  key: string;
  siteId: string;
  nickname: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  facilityType: string;
  sqft: string;
  rate: string;
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

function emptySite(partial?: Partial<FormSite>): FormSite {
  return {
    key: partial?.key || `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    siteId: partial?.siteId || "",
    nickname: partial?.nickname || "",
    address: partial?.address || "",
    city: partial?.city || "",
    state: partial?.state || "",
    zip: partial?.zip || "",
    facilityType: partial?.facilityType || "",
    sqft: partial?.sqft || "",
    rate: partial?.rate || "",
  };
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
  const [accountMode, setAccountMode] = useState<"new" | "existing">(initialAccountId ? "existing" : "new");
  const [accountType, setAccountType] = useState<"commercial" | "office">("commercial");
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<AccountHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [accountId, setAccountId] = useState(initialAccountId);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [liveProposal, setLiveProposal] = useState<{ id: string; status: string; version: number } | null>(null);

  const [businessName, setBusinessName] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [stateVal, setStateVal] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [frequency, setFrequency] = useState("weekly");
  const [customFrequency, setCustomFrequency] = useState("");
  const [term, setTerm] = useState<"month_to_month" | "annual">("month_to_month");
  const [billingMethod, setBillingMethod] = useState<BillingMethod>("invoiced");
  const [invoiceCycle, setInvoiceCycle] = useState<InvoiceCycle>("monthly");
  const [netTerms, setNetTerms] = useState<NetTerms>("net_15");
  const [coverNote, setCoverNote] = useState("");
  const [sites, setSites] = useState<FormSite[]>([emptySite()]);

  const [busy, setBusy] = useState<"send" | "draft" | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);

  const loadAccounts = useCallback(async (q: string) => {
    setSearching(true);
    try {
      const qs = q.trim() ? `?view=accounts&q=${encodeURIComponent(q.trim())}` : "?view=accounts";
      const out = await commercialProposalApi("GET", undefined, qs);
      setHits((out.accounts || []) as AccountHit[]);
    } catch (err) {
      toast.error((err as Error).message);
      setHits([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (accountMode !== "existing") return;
    const t = setTimeout(() => { void loadAccounts(search); }, 250);
    return () => clearTimeout(t);
  }, [accountMode, search, loadAccounts]);

  const applyAccount = (a: AccountHit) => {
    setAccountId(a.id);
    setBusinessName(a.business_name || "");
    setRecipientName(a.contact_name || "");
    setRecipientEmail(a.email || "");
    setRecipientPhone(a.phone || "");
    setAddress(a.address || "");
    setCity(a.city || "");
    setStateVal(a.state || "");
    setZipCode(a.zip_code || "");
    if (a.account_type === "office" || a.account_type === "commercial") {
      setAccountType(a.account_type);
    }
    if (a.recurring_frequency) {
      const known = FREQUENCY_OPTIONS.some((o) => o.id === a.recurring_frequency);
      setFrequency(known ? a.recurring_frequency : "custom");
      if (!known) setCustomFrequency(a.recurring_frequency);
    }
  };

  const loadAccount = useCallback(async (id: string) => {
    if (!id) return;
    setLoadingDetail(true);
    try {
      const out = await commercialProposalApi("GET", undefined, `?accountId=${id}`);
      const account = out.account as AccountHit | undefined;
      if (account) {
        applyAccount({ ...account, id });
      }
      const prefill = out.walkthroughSource?.prefill || proposalPrefillFromWalkthrough({
        account: out.account,
        request: out.walkthroughSource?.request,
      });
      if (prefill.name) setRecipientName(prefill.name);
      if (prefill.email) setRecipientEmail(prefill.email);
      if (prefill.phone) setRecipientPhone(prefill.phone);
      const freq = String(prefill.frequency || "weekly");
      const known = FREQUENCY_OPTIONS.some((o) => o.id === freq);
      setFrequency(known ? freq : "custom");
      if (!known) setCustomFrequency(freq);

      const readySites = ((out.readiness?.sites || []) as ReadySite[]).filter((s) => String(s.stage || "") !== "excluded");
      if (readySites.length) {
        setSites(readySites.map((s) => emptySite({
          key: s.site_id,
          siteId: s.site_id,
          nickname: s.nickname || "",
          address: s.address || "",
          facilityType: s.facility_type ? titleCase(String(s.facility_type)) : "",
          sqft: s.sqft ? String(s.sqft) : "",
          rate: centsToDollars(siteRateCentsFromWalkthrough(s)),
        })));
      }
      const live = (out.proposals || []).find((p: { status: string }) => ["draft", "sent"].includes(p.status));
      setLiveProposal(live ? { id: live.id, status: live.status, version: live.version } : null);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (initialAccountId) {
      setAccountMode("existing");
      setAccountId(initialAccountId);
    }
  }, [initialAccountId]);

  useEffect(() => {
    if (accountId) void loadAccount(accountId);
  }, [accountId, loadAccount]);

  const resolvedFrequency = frequency === "custom" ? customFrequency.trim() : frequency;
  const pricedSites = sites.map((s) => ({
    ...s,
    per_visit_price_cents: dollarsToCents(s.rate) || 0,
    frequency: resolvedFrequency,
  }));
  const perVisit = totalPerVisitCents(pricedSites);
  const monthly = estimatedMonthlyCents(pricedSites, resolvedFrequency);

  const requirements = useMemo(
    () => proposalSendRequirements({
      businessName,
      recipientName,
      recipientEmail,
      frequency: resolvedFrequency,
      sites: sites.map((s) => ({
        nickname: s.nickname || s.address || "Site",
        rateCents: dollarsToCents(s.rate),
      })),
    }),
    [businessName, recipientName, recipientEmail, resolvedFrequency, sites],
  );
  const canSubmit = requirements.length === 0;

  const submit = async (send: boolean) => {
    if (send && !canSubmit) return;
    setBusy(send ? "send" : "draft");
    try {
      const first = sites[0];
      const out = await commercialProposalApi("POST", {
        action: "create_draft",
        send,
        accountId: accountId || undefined,
        accountType,
        businessName: businessName.trim(),
        address: address.trim() || first?.address.trim() || undefined,
        city: city.trim() || first?.city.trim() || undefined,
        state: stateVal.trim() || first?.state.trim() || undefined,
        zip: zipCode.trim() || first?.zip.trim() || undefined,
        facilityType: first?.facilityType || undefined,
        sqft: first?.sqft ? Number(first.sqft) : undefined,
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
        sites: sites.map((s) => ({
          siteId: s.siteId || undefined,
          nickname: s.nickname.trim() || s.address.trim() || "Site",
          address: s.address.trim() || address.trim() || undefined,
          city: s.city.trim() || city.trim() || undefined,
          state: s.state.trim() || stateVal.trim() || undefined,
          zip: s.zip.trim() || zipCode.trim() || undefined,
          facilityType: s.facilityType || undefined,
          sqft: s.sqft ? Number(s.sqft) : undefined,
          perVisitPriceCents: dollarsToCents(s.rate),
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
        if (out.accountId) setAccountId(String(out.accountId));
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const reset = () => {
    setResult(null);
    setAccountMode("new");
    setAccountId("");
    setLiveProposal(null);
    setBusinessName("");
    setRecipientName("");
    setRecipientEmail("");
    setRecipientPhone("");
    setAddress("");
    setCity("");
    setStateVal("");
    setZipCode("");
    setFrequency("weekly");
    setCustomFrequency("");
    setTerm("month_to_month");
    setBillingMethod("invoiced");
    setInvoiceCycle("monthly");
    setNetTerms("net_15");
    setCoverNote("");
    setSites([emptySite()]);
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
              {businessName || "Proposal"} pending review
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
              <SummaryRow label="Sites" value={String(sites.length)} />
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
          Same motion as Internal Booking: type the business, site, rate, and recipient — then send.
          An existing account is optional prefill. No client portal login is required.
        </p>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className="xl:col-span-8 space-y-5">
          <FormSection
            number={1}
            title="Who this is for"
            description="A saved account is optional. Type the details, or pull them from an existing commercial record."
            icon={<RiSearchLine className="w-4 h-4" />}
          >
            <div className="flex gap-1 text-xs">
              <button
                type="button"
                onClick={() => { setAccountMode("new"); setAccountId(""); setLiveProposal(null); }}
                className={cn("px-2.5 py-1 rounded-md", accountMode === "new" ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-600")}
              >
                New
              </button>
              <button
                type="button"
                onClick={() => setAccountMode("existing")}
                className={cn("px-2.5 py-1 rounded-md", accountMode === "existing" ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-600")}
              >
                Existing
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {(["commercial", "office"] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setAccountType(id)}
                  className={cn(
                    "text-left rounded-xl border-2 bg-white p-3 transition-all",
                    accountType === id ? "border-violet-500 shadow-sm" : "border-slate-200 hover:border-violet-300",
                  )}
                >
                  <p className="text-sm font-semibold text-slate-900">{id === "office" ? "Office" : "Commercial"}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {id === "office" ? "Corporate and coworking" : "Retail, medical, gym, warehouse…"}
                  </p>
                </button>
              ))}
            </div>

            {accountMode === "existing" && (
              <div className="space-y-2">
                <div className="relative">
                  <RiSearchLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    placeholder="Search business, contact, or email…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9 bg-slate-50 border-slate-200 focus-visible:bg-white"
                  />
                </div>
                <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 max-h-56 overflow-y-auto">
                  {searching && <p className="text-xs text-slate-500 p-3">Searching…</p>}
                  {!searching && hits.length === 0 && (
                    <p className="text-xs text-slate-500 p-3">No matching accounts. Switch to New and type the details.</p>
                  )}
                  {hits.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => applyAccount(a)}
                      className={cn(
                        "w-full text-left p-3 hover:bg-slate-50 transition-colors",
                        accountId === a.id && "bg-violet-50/60",
                      )}
                    >
                      <p className="text-sm font-medium text-slate-900 truncate">{a.business_name}</p>
                      <p className="text-xs text-slate-500 truncate">
                        {a.contact_name || "No contact"} · {a.email || "no email"}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Business name" required>
                <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Acme Dental Group" />
              </Field>
              <Field label="Primary contact" required>
                <Input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="Jordan Lee" />
              </Field>
              <Field label="Email" required>
                <Input type="email" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} placeholder="jordan@company.com" />
              </Field>
              <Field label="Phone">
                <Input type="tel" value={recipientPhone} onChange={(e) => setRecipientPhone(e.target.value)} placeholder="+1 301-555-0199" />
              </Field>
            </div>
            <Field label="Headquarters / billing address">
              <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="123 Commerce Blvd, Suite 200" />
            </Field>
            <div className="grid sm:grid-cols-3 gap-4">
              <Field label="City"><Input value={city} onChange={(e) => setCity(e.target.value)} /></Field>
              <Field label="State"><Input value={stateVal} onChange={(e) => setStateVal(e.target.value.toUpperCase())} maxLength={2} placeholder="MD" /></Field>
              <Field label="ZIP"><Input value={zipCode} onChange={(e) => setZipCode(e.target.value)} maxLength={10} placeholder="21044" /></Field>
            </div>
          </FormSection>

          <FormSection
            number={2}
            title="Sites & rates"
            description="Type each location and the per-visit rate. Walkthrough numbers fill in when an existing account has them."
            icon={<RiBuilding2Line className="w-4 h-4" />}
          >
            {loadingDetail && <p className="text-xs text-slate-500">Loading saved sites…</p>}
            {sites.some((s) => !dollarsToCents(s.rate)) && walkthroughsHref && (
              <p className="text-[11px] text-slate-500">
                Need a firm walkthrough price?{" "}
                <a href={walkthroughsHref} className="font-semibold underline">Open firm price</a>.
              </p>
            )}
            <div className="space-y-3">
              {sites.map((site, idx) => (
                <div key={site.key} className="rounded-xl border border-slate-200 p-3 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Location {idx + 1}
                    </p>
                    {sites.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setSites((prev) => prev.filter((s) => s.key !== site.key))}
                        className="text-slate-400 hover:text-rose-600"
                        aria-label="Remove site"
                      >
                        <RiCloseLine className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <Field label="Nickname">
                      <Input
                        value={site.nickname}
                        onChange={(e) => setSites((prev) => prev.map((s) => s.key === site.key ? { ...s, nickname: e.target.value } : s))}
                        placeholder="Main office"
                      />
                    </Field>
                    <Field label="Facility type">
                      <Select
                        value={site.facilityType}
                        onValueChange={(v) => setSites((prev) => prev.map((s) => s.key === site.key ? { ...s, facilityType: v } : s))}
                      >
                        <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                        <SelectContent>{FACILITY_TYPES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
                      </Select>
                    </Field>
                  </div>
                  <Field label="Site address">
                    <Input
                      value={site.address}
                      onChange={(e) => setSites((prev) => prev.map((s) => s.key === site.key ? { ...s, address: e.target.value } : s))}
                      placeholder={address || "456 Industrial Way"}
                    />
                  </Field>
                  <div className="grid sm:grid-cols-4 gap-3">
                    <Field label="City">
                      <Input
                        value={site.city}
                        onChange={(e) => setSites((prev) => prev.map((s) => s.key === site.key ? { ...s, city: e.target.value } : s))}
                      />
                    </Field>
                    <Field label="State">
                      <Input
                        value={site.state}
                        onChange={(e) => setSites((prev) => prev.map((s) => s.key === site.key ? { ...s, state: e.target.value.toUpperCase() } : s))}
                        maxLength={2}
                      />
                    </Field>
                    <Field label="ZIP">
                      <Input
                        value={site.zip}
                        onChange={(e) => setSites((prev) => prev.map((s) => s.key === site.key ? { ...s, zip: e.target.value } : s))}
                      />
                    </Field>
                    <Field label="Sq ft">
                      <Input
                        inputMode="numeric"
                        value={site.sqft}
                        onChange={(e) => setSites((prev) => prev.map((s) => s.key === site.key ? { ...s, sqft: e.target.value } : s))}
                      />
                    </Field>
                  </div>
                  <Field label="Per-visit rate" required>
                    <div className="relative max-w-xs">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">$</span>
                      <Input
                        inputMode="decimal"
                        value={site.rate}
                        onChange={(e) => setSites((prev) => prev.map((s) => s.key === site.key ? { ...s, rate: e.target.value } : s))}
                        placeholder="450.00"
                        className="pl-7 tabular-nums"
                      />
                    </div>
                  </Field>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSites((prev) => [...prev, emptySite({
                address,
                city,
                state: stateVal,
                zip: zipCode,
              })])}
            >
              <RiAddLine className="w-4 h-4 mr-1.5" />
              Add another location
            </Button>
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
            title="Cover note"
            description="Shown at the top of the proposal. Use it for what changed, or what they asked for."
            icon={<RiUserLine className="w-4 h-4" />}
          >
            <Textarea
              rows={4}
              value={coverNote}
              onChange={(e) => setCoverNote(e.target.value)}
              placeholder="A line or two on the walkthrough, the cadence, or what moved since the last version."
            />
          </FormSection>
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
                <p className={cn("text-sm truncate", businessName ? "font-semibold text-slate-900" : "text-slate-400")}>
                  {businessName || "No business name yet"}
                </p>
                <SummaryRow label="Sites on this proposal" value={String(sites.length)} />
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
                  disabled={!canSubmit || busy !== null}
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
