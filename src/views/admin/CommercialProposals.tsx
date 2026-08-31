"use client";

// ─── Commercial deals — Partnerships Hub → Proposals ───────────────────────
//
// The pipeline from a priced site to a dispatchable account, in the order it
// actually happens:
//
//   Firm price ready → Proposal sent → Accepted → Agreement signed →
//   Billing configured → Dispatch-eligible
//
// Two things this screen exists to make un-missable:
//
//   * A deal that cannot be proposed says WHY, per site, rather than the
//     "Build proposal" button being quietly disabled.
//   * "Signed but billing never finished" gets its own stage. Those accounts
//     believe they are customers, and nothing can be dispatched for them.
//
// Every prior proposal version stays readable here with the change the client
// asked for attached, because a negotiation that only shows its latest state
// cannot answer why the price moved.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RiAlertLine,
  RiArrowRightLine,
  RiBankCardLine,
  RiBuilding4Line,
  RiCheckboxCircleFill,
  RiEdit2Line,
  RiFileCopyLine,
  RiFileTextLine,
  RiLoader4Line,
  RiMailSendLine,
  RiRefreshLine,
  RiSearch2Line,
  RiShieldCheckLine,
} from "@remixicon/react";
import { format } from "date-fns";
import { toast } from "sonner";

import { commercialProposalApi } from "@/lib/commercial-proposal-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  BILLING_METHOD_LABELS,
  INVOICE_CYCLE_LABELS,
  NET_TERMS_LABELS,
  PROPOSAL_STATUS_LABELS,
  STAGE_LABELS,
  money,
  proposalPrefillFromWalkthrough,
  titleCase,
  commercialTab,
  type InvoiceCycle,
  type NetTerms,
  type PipelineStage,
  type ProposalSite,
  type ProposalStatus,
} from "@/lib/commercial-proposal";
import { COMPANY_COI_PUBLIC_HREF } from "@/lib/company-coi-public";

interface Deal {
  account_id: string;
  business_name: string;
  account_type: string;
  account_status: string;
  email: string | null;
  contact_name: string | null;
  assigned_va_email: string | null;
  active_sites: number;
  priced_sites: number;
  excluded_sites: number;
  proposal_id: string | null;
  proposal_version: number | null;
  proposal_status: ProposalStatus | null;
  proposal_sent_at: string | null;
  proposal_expires_at: string | null;
  proposal_accepted_at: string | null;
  changes_requested_at: string | null;
  change_request_note: string | null;
  total_per_visit_cents: number | null;
  agreement_id: string | null;
  agreement_status: string | null;
  agreement_signed_at: string | null;
  billing_method: string | null;
  billing_configured: boolean | null;
  coi_blocked: boolean | null;
  company_coi_sent_at: string | null;
  requires_coi_on_file: boolean | null;
  stage: PipelineStage;
}

interface ProposalRow {
  id: string;
  version: number;
  status: ProposalStatus;
  recipient_name: string | null;
  recipient_email: string | null;
  proposed_frequency: string | null;
  billing_method: string;
  invoice_cycle: string | null;
  net_terms: string | null;
  cover_note: string | null;
  total_per_visit_cents: number;
  estimated_monthly_cents: number | null;
  sent_at: string | null;
  send_count: number;
  first_viewed_at: string | null;
  view_count: number;
  accepted_at: string | null;
  accepted_by_name: string | null;
  accepted_billing_method: string | null;
  changes_requested_at: string | null;
  change_request_note: string | null;
  change_request_by_name: string | null;
  change_request_ack_at: string | null;
  expires_at: string | null;
  created_at: string;
  prepared_by_name: string | null;
  sites: ProposalSite[];
  link: string | null;
}

interface AgreementRow {
  id: string;
  status: string;
  signer_name: string | null;
  signer_email: string | null;
  billing_method: string;
  total_per_visit_cents: number;
  exhibit_a_text: string | null;
  sent_at: string | null;
  signed_at: string | null;
  signed_by_name: string | null;
  countersigned_at: string | null;
  document_path: string | null;
  created_at: string;
  link: string | null;
}

interface Readiness {
  can_propose: boolean;
  reason: string | null;
  ready_count: number;
  blocked: string[];
  sites: Array<Record<string, unknown>>;
}

interface Detail {
  account: Record<string, any>;
  readiness: Readiness | null;
  proposals: ProposalRow[];
  agreements: AgreementRow[];
  billing: Record<string, any> | null;
  coiDeliveries: Array<Record<string, any>>;
  onboarding: Record<string, any> | null;
  onboardingSubmissions: Array<Record<string, any>>;
}

const STAGE_CHIP: Record<PipelineStage, string> = {
  pricing_pending: "bg-slate-100 text-slate-600",
  firm_price_ready: "bg-sky-100 text-sky-700",
  proposal_sent: "bg-violet-100 text-violet-700",
  changes_requested: "bg-amber-100 text-amber-700",
  proposal_expired: "bg-rose-50 text-rose-600",
  proposal_accepted: "bg-indigo-100 text-indigo-700",
  agreement_sent: "bg-blue-100 text-blue-700",
  billing_pending: "bg-amber-100 text-amber-800",
  coi_blocked: "bg-rose-100 text-rose-700",
  dispatch_eligible: "bg-emerald-100 text-emerald-700",
};

// The order deals actually move through, so the board reads top-to-bottom as
// the pipeline rather than alphabetically.
const STAGE_ORDER: PipelineStage[] = [
  "changes_requested",
  "coi_blocked",
  "billing_pending",
  "proposal_expired",
  "proposal_accepted",
  "agreement_sent",
  "proposal_sent",
  "firm_price_ready",
  "pricing_pending",
  "dispatch_eligible",
];

function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return format(new Date(iso), "MMM d, yyyy");
}

interface OnboardingSessionRow {
  id: string;
  business_account_id: string;
  stalled?: boolean;
  idle_hours?: number | null;
  current_step?: string | null;
  paused_for_changes?: boolean;
  pending_submissions?: number;
  status?: string;
}

function onboardingNeedsAttention(s?: OnboardingSessionRow | null): boolean {
  if (!s) return false;
  return s.stalled === true || s.paused_for_changes === true || Number(s.pending_submissions || 0) > 0;
}

export default function CommercialProposals() {
  const [loading, setLoading] = useState(true);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [sessions, setSessions] = useState<Record<string, OnboardingSessionRow>>({});
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("open");
  const [selected, setSelected] = useState<Deal | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const out = await commercialProposalApi("GET", undefined, "?view=pipeline");
      setDeals((out.deals || []) as Deal[]);
      const map: Record<string, OnboardingSessionRow> = {};
      for (const row of [...(out.onboarding || []), ...(out.onboardingAttention || [])] as OnboardingSessionRow[]) {
        if (row?.business_account_id) map[row.business_account_id] = row;
      }
      setSessions(map);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return deals
      .filter((d) => {
        if (stageFilter === "open") return d.stage !== "dispatch_eligible" && d.stage !== "pricing_pending";
        if (stageFilter === "attention") {
          return (
            ["changes_requested", "coi_blocked", "billing_pending", "proposal_expired"].includes(d.stage) ||
            onboardingNeedsAttention(sessions[d.account_id])
          );
        }
        if (stageFilter !== "all") return d.stage === stageFilter;
        return true;
      })
      .filter((d) => !q || d.business_name.toLowerCase().includes(q) || (d.email || "").toLowerCase().includes(q))
      .sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage));
  }, [deals, search, stageFilter, sessions]);

  const counts = useMemo(() => {
    const out: Partial<Record<PipelineStage, number>> = {};
    for (const d of deals) out[d.stage] = (out[d.stage] || 0) + 1;
    return out;
  }, [deals]);

  return (
    <div className="space-y-4">
      {/* Where the money is stuck */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(["changes_requested", "billing_pending", "proposal_sent", "dispatch_eligible"] as PipelineStage[]).map(
          (stage) => (
            <Card key={stage} className="cursor-pointer transition hover:shadow-sm" onClick={() => setStageFilter(stage)}>
              <CardContent className="p-4">
                <p className="text-2xl font-semibold text-slate-900">{counts[stage] || 0}</p>
                <p className="text-xs text-slate-500">{STAGE_LABELS[stage]}</p>
              </CardContent>
            </Card>
          ),
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <RiSearch2Line className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search accounts…"
            className="pl-8"
          />
        </div>
        <Select value={stageFilter} onValueChange={setStageFilter}>
          <SelectTrigger className="w-[210px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open deals</SelectItem>
            <SelectItem value="attention">Needs attention</SelectItem>
            <SelectItem value="all">All accounts</SelectItem>
            {STAGE_ORDER.map((s) => (
              <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          <RiRefreshLine className="mr-1.5 h-4 w-4" />
          Refresh
        </Button>
        <Button size="sm" asChild>
          <a href={commercialTab("send")}>
            <RiMailSendLine className="mr-1.5 h-4 w-4" />
            Send a proposal
          </a>
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-sm text-slate-500">
          No deals in this view.
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((deal) => (
            <Card
              key={deal.account_id}
              className="cursor-pointer transition hover:shadow-sm"
              onClick={() => setSelected(deal)}
            >
              <CardContent className="flex items-center gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium text-slate-900">{deal.business_name}</p>
                    <Badge className={cn("border-0 text-xs", STAGE_CHIP[deal.stage])}>
                      {STAGE_LABELS[deal.stage]}
                    </Badge>
                    {deal.proposal_version ? (
                      <span className="text-xs text-slate-400">v{deal.proposal_version}</span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {deal.priced_sites}/{Math.max(0, deal.active_sites - deal.excluded_sites)} site
                    {deal.active_sites === 1 ? "" : "s"} priced
                    {deal.excluded_sites > 0 ? ` · ${deal.excluded_sites} excluded` : ""}
                    {deal.total_per_visit_cents ? ` · ${money(deal.total_per_visit_cents)} per visit` : ""}
                  </p>
                  {deal.stage === "changes_requested" && deal.change_request_note && (
                    <p className="mt-1 truncate rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
                      “{deal.change_request_note}”
                    </p>
                  )}
                  {deal.stage === "billing_pending" && (
                    <p className="mt-1 text-xs text-amber-700">
                      Signed {shortDate(deal.agreement_signed_at)} — billing not configured, so nothing dispatches.
                    </p>
                  )}
                  {deal.stage === "coi_blocked" && (
                    <p className="mt-1 text-xs text-rose-700">
                      Signed and billable, but the certificate of insurance isn't current — fixed under Compliance.
                    </p>
                  )}
                  {sessions[deal.account_id]?.stalled && (
                    <p className="mt-1 text-xs text-amber-800">
                      Onboarding idle {Math.round(Number(sessions[deal.account_id].idle_hours || 0))}h
                      {sessions[deal.account_id].current_step
                        ? ` on ${sessions[deal.account_id].current_step}`
                        : ""}
                      . Same link still resumes.
                    </p>
                  )}
                  {Number(sessions[deal.account_id]?.pending_submissions || 0) > 0 && (
                    <p className="mt-1 text-xs text-amber-800">
                      {sessions[deal.account_id].pending_submissions} additional-info submission
                      {Number(sessions[deal.account_id].pending_submissions) === 1 ? "" : "s"} waiting for review.
                    </p>
                  )}
                </div>
                {["firm_price_ready", "changes_requested", "proposal_expired"].includes(deal.stage) ? (
                  <a
                    href={commercialTab("send", { account: deal.account_id })}
                    onClick={(e) => e.stopPropagation()}
                    className="shrink-0 text-xs font-semibold text-violet-700 hover:underline"
                  >
                    Send
                  </a>
                ) : (
                  <RiArrowRightLine className="h-4 w-4 shrink-0 text-slate-300" />
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selected && (
        <DealSheet
          deal={selected}
          onClose={() => setSelected(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}

// ─── One deal ──────────────────────────────────────────────────────────────

function DealSheet({
  deal,
  onClose,
  onChanged,
}: {
  deal: Deal;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Draft controls
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [frequency, setFrequency] = useState("");
  const [billingMethod, setBillingMethod] = useState<"auto_pay" | "invoiced">("invoiced");
  const [netTerms, setNetTerms] = useState<NetTerms>("net_15");
  const [invoiceCycle, setInvoiceCycle] = useState<InvoiceCycle>("monthly");
  const [coverNote, setCoverNote] = useState("");

  const load = useCallback(async () => {
    try {
      const out = await commercialProposalApi("GET", undefined, `?accountId=${deal.account_id}`);
      const d = out as unknown as Detail;
      setDetail(d);
      const prefill = proposalPrefillFromWalkthrough({
        account: d.account,
        request: (out as { walkthroughSource?: { request?: {
          requester_name?: string | null;
          requester_email?: string | null;
          requester_phone?: string | null;
          desired_frequency?: string | null;
        } } }).walkthroughSource?.request,
      });
      setRecipientName((p) => p || prefill.name);
      setRecipientEmail((p) => p || prefill.email);
      setFrequency((p) => p || prefill.frequency || "weekly");
    } catch (err) {
      toast.error((err as Error).message);
    }
  }, [deal.account_id]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (label: string, body: Record<string, unknown>, success: string) => {
    setBusy(label);
    try {
      const out = await commercialProposalApi("POST", body);
      toast.success(success);
      await load();
      onChanged();
      return out;
    } catch (err) {
      toast.error((err as Error).message);
      return null;
    } finally {
      setBusy(null);
    }
  };

  const readiness = detail?.readiness;
  const latest = detail?.proposals?.[0] || null;
  const openAgreement = detail?.agreements?.find((a) => a.status === "pending") || null;
  const signedAgreement = detail?.agreements?.find((a) => a.status === "signed") || null;

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{deal.business_name}</SheetTitle>
        </SheetHeader>

        {!detail ? (
          <div className="mt-6 space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <div className="mt-5 space-y-5 pb-10">
            {/* Where this deal is */}
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Stage</p>
                <Badge className={cn("border-0", STAGE_CHIP[deal.stage])}>{STAGE_LABELS[deal.stage]}</Badge>
              </div>
              <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                <Requirement
                  met={readiness?.can_propose === true}
                  label="Firm price on every site"
                  detail={readiness?.can_propose ? `${readiness.ready_count} site(s) priced` : readiness?.reason || "—"}
                />
                <Requirement
                  met={Boolean(detail.account?.agreement_signed_at)}
                  label="Signed agreement"
                  detail={detail.account?.agreement_signed_at ? shortDate(detail.account.agreement_signed_at) : "Not signed"}
                />
                <Requirement
                  met={detail.billing?.configured === true}
                  label="Billing configured"
                  detail={detail.billing?.summary || detail.billing?.reason || "Not set up"}
                />
                <Requirement
                  met={Boolean(detail.account?.company_coi_sent_at)}
                  label="Our COI sent to client"
                  detail={
                    detail.account?.requires_coi_on_file === false
                      ? "Not required by this client"
                      : detail.account?.company_coi_sent_at
                        ? shortDate(detail.account.company_coi_sent_at)
                        : "Not sent"
                  }
                />
              </div>
            </div>

            {/* ── Onboarding: the one link the client actually gets ────────── */}
            <OnboardingPanel
              detail={detail}
              busy={busy}
              run={run}
              accountId={deal.account_id}
            />

            {/* Why a proposal can't go out */}
            {readiness && !readiness.can_propose && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="flex items-center gap-1.5 text-xs font-bold text-amber-900">
                  <RiAlertLine className="h-4 w-4" />
                  No proposal can go out yet
                </p>
                <p className="mt-1 text-xs text-amber-800">{readiness.reason}</p>
                {readiness.blocked?.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {readiness.blocked.map((b, i) => (
                      <li key={i} className="text-xs text-amber-800">• {b}</li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 text-xs text-amber-700">
                  Proposing against an estimate range is the one thing this path won't do — the number
                  the client accepts has to be the number we bill.
                </p>
              </div>
            )}

            {/* Build / send */}
            {readiness?.can_propose && (!latest || ["expired", "changes_requested", "withdrawn", "superseded"].includes(latest.status)) && (
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">
                  {latest ? `Build v${latest.version + 1}` : "Build the proposal"}
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs">Decision-maker</Label>
                    <Input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} className="mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">Email</Label>
                    <Input value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} className="mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">Frequency</Label>
                    <Input value={frequency} onChange={(e) => setFrequency(e.target.value)} placeholder="weekly, 3x/week…" className="mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">Billing method</Label>
                    <Select value={billingMethod} onValueChange={(v) => setBillingMethod(v as "auto_pay" | "invoiced")}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="invoiced">{BILLING_METHOD_LABELS.invoiced}</SelectItem>
                        <SelectItem value="auto_pay">{BILLING_METHOD_LABELS.auto_pay}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Invoice cycle</Label>
                    <Select value={invoiceCycle} onValueChange={(v) => setInvoiceCycle(v as InvoiceCycle)}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(Object.keys(INVOICE_CYCLE_LABELS) as InvoiceCycle[]).map((k) => (
                          <SelectItem key={k} value={k}>{INVOICE_CYCLE_LABELS[k]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Payment terms</Label>
                    <Select value={netTerms} onValueChange={(v) => setNetTerms(v as NetTerms)}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(Object.keys(NET_TERMS_LABELS) as NetTerms[]).map((k) => (
                          <SelectItem key={k} value={k}>{NET_TERMS_LABELS[k]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="mt-3">
                  <Label className="text-xs">Cover note (optional)</Label>
                  <Textarea
                    rows={3}
                    value={coverNote}
                    onChange={(e) => setCoverNote(e.target.value)}
                    placeholder="A line or two on what changed since the last version, or what they asked for."
                    className="mt-1"
                  />
                </div>
                <Button
                  size="sm"
                  className="mt-3"
                  disabled={busy !== null}
                  onClick={() =>
                    void run(
                      "create",
                      {
                        action: "create_draft",
                        accountId: deal.account_id,
                        supersedesId: latest?.id,
                        recipientName,
                        recipientEmail,
                        frequency,
                        billingMethod,
                        invoiceCycle,
                        netTerms,
                        coverNote,
                      },
                      "Draft built from the account's priced sites.",
                    )
                  }
                >
                  {busy === "create" ? <RiLoader4Line className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                  Build draft
                </Button>
              </div>
            )}

            {/* Live proposal actions */}
            {latest && ["draft", "sent"].includes(latest.status) && (
              <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-violet-700">
                  v{latest.version} · {PROPOSAL_STATUS_LABELS[latest.status]}
                </p>
                <p className="mt-1 text-sm text-slate-800">
                  {money(latest.total_per_visit_cents)} per visit · {latest.sites?.length || 0} site
                  {latest.sites?.length === 1 ? "" : "s"}
                  {latest.estimated_monthly_cents ? ` · ~${money(latest.estimated_monthly_cents)}/mo` : ""}
                </p>
                {latest.status === "sent" && (
                  <p className="mt-1 text-xs text-slate-600">
                    Sent {shortDate(latest.sent_at)} to {latest.recipient_email} ·{" "}
                    {latest.first_viewed_at
                      ? `opened ${shortDate(latest.first_viewed_at)} (${latest.view_count}×)`
                      : "never opened"}
                    {latest.expires_at ? ` · expires ${shortDate(latest.expires_at)}` : ""}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={busy !== null}
                    onClick={() =>
                      void run(
                        "send",
                        { action: latest.status === "sent" ? "resend" : "send", proposalId: latest.id },
                        latest.status === "sent" ? "Proposal re-sent." : "Proposal sent.",
                      )
                    }
                  >
                    {busy === "send" ? <RiLoader4Line className="mr-1.5 h-4 w-4 animate-spin" /> : <RiMailSendLine className="mr-1.5 h-4 w-4" />}
                    {latest.status === "sent" ? "Resend" : "Send proposal"}
                  </Button>
                  {latest.link && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        void navigator.clipboard.writeText(latest.link!);
                        toast.success("Proposal link copied.");
                      }}
                    >
                      <RiFileCopyLine className="mr-1.5 h-4 w-4" />
                      Copy link
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy !== null}
                    onClick={() => void run("withdraw", { action: "withdraw", proposalId: latest.id }, "Proposal withdrawn.")}
                  >
                    Withdraw
                  </Button>
                </div>
              </div>
            )}

            {/* Accepted, agreement not generated */}
            {latest?.status === "accepted" && !openAgreement && !signedAgreement && (
              <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-indigo-700">Accepted</p>
                <p className="mt-1 text-xs text-slate-700">
                  {latest.accepted_by_name} accepted v{latest.version} on {shortDate(latest.accepted_at)}.
                  The agreement wasn't generated automatically — generate it now.
                </p>
                <Button
                  size="sm"
                  className="mt-3"
                  disabled={busy !== null}
                  onClick={() => void run("gen", { action: "generate_agreement", proposalId: latest.id }, "Agreement generated.")}
                >
                  {busy === "gen" ? <RiLoader4Line className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                  Generate agreement
                </Button>
              </div>
            )}

            {/* Agreement out for signature */}
            {openAgreement && (
              <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3">
                <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-blue-700">
                  <RiFileTextLine className="h-3.5 w-3.5" />
                  Out for signature
                </p>
                <p className="mt-1 text-xs text-slate-700">
                  {openAgreement.signer_name} ({openAgreement.signer_email}) ·{" "}
                  {money(openAgreement.total_per_visit_cents)} per visit ·{" "}
                  {BILLING_METHOD_LABELS[openAgreement.billing_method as "auto_pay" | "invoiced"]}
                  {openAgreement.sent_at ? ` · sent ${shortDate(openAgreement.sent_at)}` : " · not sent yet"}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => void run("sendag", { action: "send_agreement", agreementId: openAgreement.id }, "Signing link sent.")}
                  >
                    {busy === "sendag" ? <RiLoader4Line className="mr-1.5 h-4 w-4 animate-spin" /> : <RiMailSendLine className="mr-1.5 h-4 w-4" />}
                    {openAgreement.sent_at ? "Resend signing link" : "Send for signature"}
                  </Button>
                  {openAgreement.link && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        void navigator.clipboard.writeText(openAgreement.link!);
                        toast.success("Signing link copied.");
                      }}
                    >
                      <RiFileCopyLine className="mr-1.5 h-4 w-4" />
                      Copy link
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Billing */}
            {detail.account?.agreement_signed_at && detail.billing?.configured !== true && (
              <BillingBlock
                accountId={deal.account_id}
                agreementId={signedAgreement?.id || null}
                defaultEmail={detail.account?.email || ""}
                defaultName={detail.account?.contact_name || ""}
                reason={detail.billing?.reason || null}
                busy={busy}
                onSave={(body) => run("billing", body, "Billing recorded.")}
              />
            )}

            {/* Our certificate */}
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">
                <RiShieldCheckLine className="h-3.5 w-3.5" />
                Our certificate of insurance
              </p>
              <p className="mt-1 text-xs text-slate-600">
                {detail.account?.company_coi_sent_at
                  ? `Last sent ${shortDate(detail.account.company_coi_sent_at)}.`
                  : "Never sent to this client. It goes out automatically on signature."}
              </p>
              {detail.coiDeliveries?.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {detail.coiDeliveries.slice(0, 4).map((d) => (
                    <li key={d.id} className="text-xs text-slate-500">
                      {shortDate(d.sent_at)} → {d.sent_to} ({d.trigger_source.replace(/_/g, " ")})
                      {d.status !== "sent" ? ` — ${d.status}: ${d.failure_reason || ""}` : ""}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => void run("coi", { action: "send_company_coi", accountId: deal.account_id }, "Certificate sent.")}
                >
                  {busy === "coi" ? <RiLoader4Line className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                  Send our certificate
                </Button>
                <Button size="sm" variant="ghost" asChild>
                  <a href={COMPANY_COI_PUBLIC_HREF} target="_blank" rel="noopener noreferrer">
                    View certificate
                  </a>
                </Button>
              </div>
            </div>

            {/* History */}
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                Proposal history
              </p>
              {detail.proposals.length === 0 ? (
                <p className="text-xs text-slate-500">No proposals yet.</p>
              ) : (
                <div className="space-y-2">
                  {detail.proposals.map((p) => (
                    <div key={p.id} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-slate-900">
                          v{p.version} · {money(p.total_per_visit_cents)} per visit
                        </p>
                        <Badge variant="outline" className="text-xs">
                          {PROPOSAL_STATUS_LABELS[p.status]}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        Built {shortDate(p.created_at)}
                        {p.prepared_by_name ? ` by ${p.prepared_by_name}` : ""}
                        {p.sent_at ? ` · sent ${shortDate(p.sent_at)}` : ""}
                        {p.accepted_at ? ` · accepted ${shortDate(p.accepted_at)} by ${p.accepted_by_name}` : ""}
                      </p>
                      {p.change_request_note && (
                        <div className="mt-2 rounded bg-amber-50 px-2 py-1.5">
                          <p className="text-xs font-medium text-amber-900">
                            {p.change_request_by_name || "Client"} asked for changes
                            {p.changes_requested_at ? ` on ${shortDate(p.changes_requested_at)}` : ""}
                          </p>
                          <p className="mt-0.5 whitespace-pre-wrap text-xs text-amber-800">
                            {p.change_request_note}
                          </p>
                          {!p.change_request_ack_at && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="mt-1 h-6 px-2 text-xs"
                              disabled={busy !== null}
                              onClick={() =>
                                void run("ack", { action: "acknowledge_changes", proposalId: p.id }, "Marked as picked up.")
                              }
                            >
                              Mark picked up
                            </Button>
                          )}
                        </div>
                      )}
                      {p.sites?.length > 0 && (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs text-slate-500">
                            {p.sites.length} site{p.sites.length === 1 ? "" : "s"} as proposed
                          </summary>
                          <ul className="mt-1.5 space-y-1">
                            {p.sites.map((sitE, i) => (
                              <li key={i} className="flex justify-between gap-2 text-xs text-slate-600">
                                <span className="truncate">
                                  {sitE.nickname}
                                  {sitE.frequency ? ` · ${titleCase(sitE.frequency)}` : ""}
                                </span>
                                <span className="shrink-0 font-medium">
                                  {money(sitE.per_visit_price_cents)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Signed documents */}
            {detail.agreements.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Agreements</p>
                <div className="space-y-2">
                  {detail.agreements.map((a) => (
                    <div key={a.id} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm text-slate-900">
                          {a.status === "signed"
                            ? `Signed by ${a.signed_by_name} on ${shortDate(a.signed_at)}`
                            : `${titleCase(a.status)} · ${a.signer_name || "—"}`}
                        </p>
                        <Badge variant="outline" className="text-xs">{titleCase(a.status)}</Badge>
                      </div>
                      {a.countersigned_at && (
                        <p className="text-xs text-slate-500">
                          Countersigned {shortDate(a.countersigned_at)}
                        </p>
                      )}
                      {a.exhibit_a_text && (
                        <details className="mt-1.5">
                          <summary className="cursor-pointer text-xs text-slate-500">Exhibit A as signed</summary>
                          <pre className="mt-1 whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs text-slate-700">
                            {a.exhibit_a_text}
                          </pre>
                        </details>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Requirement({ met, label, detail }: { met: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-1.5">
      {met ? (
        <RiCheckboxCircleFill className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
      ) : (
        <RiAlertLine className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
      )}
      <div className="min-w-0">
        <p className={cn("font-medium", met ? "text-slate-700" : "text-amber-800")}>{label}</p>
        <p className="text-slate-500">{detail}</p>
      </div>
    </div>
  );
}

function BillingBlock({
  accountId,
  agreementId,
  defaultEmail,
  defaultName,
  reason,
  busy,
  onSave,
}: {
  accountId: string;
  agreementId: string | null;
  defaultEmail: string;
  defaultName: string;
  reason: string | null;
  busy: string | null;
  onSave: (body: Record<string, unknown>) => void;
}) {
  const [method, setMethod] = useState<"auto_pay" | "invoiced">("invoiced");
  const [email, setEmail] = useState(defaultEmail);
  const [name, setName] = useState(defaultName);
  const [cycle, setCycle] = useState<InvoiceCycle>("monthly");
  const [terms, setTerms] = useState<NetTerms>("net_15");

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-amber-800">
        <RiBankCardLine className="h-3.5 w-3.5" />
        Billing not configured
      </p>
      <p className="mt-1 text-xs text-amber-800">
        {reason || "Nothing dispatches for this account until billing is set up."}
      </p>
      <p className="mt-1 text-xs text-amber-700">
        The client normally does this on Page 3 of the onboarding session. Record it here if they
        gave you the terms directly.
        terms directly.
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div>
          <Label className="text-xs">Method</Label>
          <Select value={method} onValueChange={(v) => setMethod(v as "auto_pay" | "invoiced")}>
            <SelectTrigger className="mt-1 bg-white"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="invoiced">{BILLING_METHOD_LABELS.invoiced}</SelectItem>
              <SelectItem value="auto_pay">{BILLING_METHOD_LABELS.auto_pay}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Billing contact</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 bg-white" />
        </div>
        <div>
          <Label className="text-xs">Billing email</Label>
          <Input value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 bg-white" />
        </div>
        {method === "invoiced" && (
          <>
            <div>
              <Label className="text-xs">Invoice cycle</Label>
              <Select value={cycle} onValueChange={(v) => setCycle(v as InvoiceCycle)}>
                <SelectTrigger className="mt-1 bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(INVOICE_CYCLE_LABELS) as InvoiceCycle[]).map((k) => (
                    <SelectItem key={k} value={k}>{INVOICE_CYCLE_LABELS[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Payment terms</Label>
              <Select value={terms} onValueChange={(v) => setTerms(v as NetTerms)}>
                <SelectTrigger className="mt-1 bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(NET_TERMS_LABELS) as NetTerms[]).map((k) => (
                    <SelectItem key={k} value={k}>{NET_TERMS_LABELS[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        )}
      </div>

      {method === "auto_pay" && (
        <p className="mt-2 rounded bg-white/60 px-2 py-1.5 text-xs text-amber-800">
          Stripe Pre-Auth only counts as configured once a card or bank account is actually on file.
          Send the signer the onboarding link — Page 3 is the Stripe setup, not a charge.
        </p>
      )}

      <Button
        size="sm"
        className="mt-3"
        disabled={busy !== null || email.trim().length < 5}
        onClick={() =>
          onSave({
            action: "save_billing",
            accountId,
            agreementId,
            method,
            billingContactName: name,
            billingContactEmail: email,
            invoiceCycle: cycle,
            netTerms: terms,
          })
        }
      >
        {busy === "billing" ? <RiLoader4Line className="mr-1.5 h-4 w-4 animate-spin" /> : <RiEdit2Line className="mr-1.5 h-4 w-4" />}
        Record billing
      </Button>
    </div>
  );
}

// ─── Onboarding session panel ──────────────────────────────────────────────
//
// The billing decision and the one link the client is sent. This is the
// approval gate: there is no way to generate the link without choosing
// Invoice or Stripe Pre-Auth first, because the client's session presents
// whichever was chosen and never asks them.

function OnboardingPanel({
  detail,
  busy,
  run,
  accountId,
}: {
  detail: Detail;
  busy: string | null;
  run: (label: string, body: Record<string, unknown>, success: string) => Promise<unknown>;
  accountId: string;
}) {
  const session = detail.onboarding;
  const account = detail.account || {};
  const pending = (detail.onboardingSubmissions || []).filter((s) => s.status === "pending");

  const [method, setMethod] = useState<"auto_pay" | "invoiced" | "">(
    (account.preferred_billing_method as "auto_pay" | "invoiced") || "",
  );
  const [to, setTo] = useState<string>(String(account.email || ""));

  const live = session && session.status === "active";

  const stepLabel: Record<string, string> = {
    pricing: "reviewing the pricing",
    agreement: "signing the agreement",
    billing: "setting up billing",
    paused: "waiting on a revised proposal",
    done: "finished",
  };

  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-3">
      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-violet-700">
        <RiMailSendLine className="h-3.5 w-3.5" />
        Client onboarding
      </p>

      {!live && (
        <>
          <p className="mt-1 text-xs text-slate-700">
            One link takes them through pricing, signature, billing and their portal login. Choose
            how this account will be billed — they are not asked, so this has to be decided here.
          </p>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {(
              [
                { id: "invoiced", label: "Invoice", sub: "Confirm contact + Net terms. No card." },
                { id: "auto_pay", label: "Stripe Pre-Auth", sub: "Card or ACH saved. Verification hold, never charged at setup." },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setMethod(opt.id)}
                className={`rounded-lg border p-2.5 text-left transition-colors ${
                  method === opt.id
                    ? "border-violet-500 bg-white ring-1 ring-violet-300"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <p className="text-xs font-semibold text-slate-900">{opt.label}</p>
                <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{opt.sub}</p>
              </button>
            ))}
          </div>

          <div className="mt-2">
            <Input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="Send to…"
              className="h-8 text-xs"
            />
          </div>

          <Button
            size="sm"
            className="mt-3"
            disabled={busy !== null || !method || !to.includes("@")}
            onClick={() =>
              void run(
                "startob",
                { action: "start_onboarding", accountId, billingMethod: method, recipientEmail: to },
                "Onboarding link sent.",
              )
            }
          >
            {busy === "startob" ? (
              <RiLoader4Line className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <RiMailSendLine className="mr-1.5 h-4 w-4" />
            )}
            {method ? "Approve & send onboarding link" : "Choose a billing method first"}
          </Button>
        </>
      )}

      {live && (
        <>
          <p className="mt-1 text-xs text-slate-700">
            Sent to {String(session.recipient_email || "—")} ·{" "}
            {BILLING_METHOD_LABELS[session.billing_method as "auto_pay" | "invoiced"]} ·{" "}
            {session.complete
              ? "finished"
              : `currently ${stepLabel[String(session.current_step)] || String(session.current_step)}`}
          </p>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {(session.steps as Array<{ key: string; label: string; done: boolean }> | null)?.map((st) => (
              <span
                key={st.key}
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  st.done ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"
                }`}
              >
                {st.done ? "✓ " : ""}
                {st.label}
              </span>
            ))}
          </div>

          {session.stalled && (
            <p className="mt-2 rounded bg-amber-100 px-2 py-1.5 text-[11px] text-amber-900">
              Idle {Math.round(Number(session.idle_hours || 0))} hours. A nudge resends the same
              link — they keep their progress.
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() =>
                void run(
                  "resendob",
                  { action: "resend_onboarding", sessionId: session.id },
                  "Reminder sent.",
                )
              }
            >
              {busy === "resendob" ? (
                <RiLoader4Line className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <RiMailSendLine className="mr-1.5 h-4 w-4" />
              )}
              Nudge
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy !== null}
              onClick={() =>
                void run(
                  "cancelob",
                  { action: "cancel_onboarding", sessionId: session.id },
                  "Onboarding link retired.",
                )
              }
            >
              Retire link
            </Button>
          </div>
        </>
      )}

      {account.preferred_billing_method && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-white p-2.5">
          <p className="text-[11px] font-semibold text-slate-700">Change billing method later</p>
          <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
            Sends a targeted billing-setup link — they don&apos;t review pricing or sign again. Invoice
            accounts never see a card field.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null || method === "invoiced"}
              onClick={() => {
                setMethod("invoiced");
                void run(
                  "chgbill",
                  { action: "change_billing_method", accountId, billingMethod: "invoiced" },
                  "Switched to Invoice.",
                );
              }}
            >
              Invoice
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null || method === "auto_pay"}
              onClick={() => {
                setMethod("auto_pay");
                void run(
                  "chgbill",
                  { action: "change_billing_method", accountId, billingMethod: "auto_pay" },
                  "Switched to Stripe Pre-Auth.",
                );
              }}
            >
              Stripe Pre-Auth
            </Button>
          </div>
        </div>
      )}

      {pending.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-white p-2.5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-amber-700">
            {pending.length} thing{pending.length === 1 ? "" : "s"} the client sent
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {pending.map((sub) => (
              <li key={String(sub.id)} className="flex items-start justify-between gap-2">
                <span className="text-[11px] leading-snug text-slate-700">
                  {sub.kind === "site_request" ? (
                    <>
                      Wants a site added: <strong>{String(sub.site_address || sub.site_nickname)}</strong>
                      <span className="block text-slate-500">
                        Needs its own walkthrough — nothing was priced.
                      </span>
                    </>
                  ) : sub.kind === "document" ? (
                    <>Uploaded <strong>{String(sub.document_name)}</strong></>
                  ) : (
                    String(sub.note || "Note")
                  )}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 shrink-0 px-2 text-[11px]"
                  disabled={busy !== null}
                  onClick={() =>
                    void run(
                      `rev${sub.id}`,
                      { action: "review_submission", submissionId: sub.id, status: "reviewed" },
                      "Marked reviewed.",
                    )
                  }
                >
                  Mark reviewed
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {account.portal_user_id && (
        <p className="mt-2 text-[11px] text-slate-500">
          Portal login active since {shortDate(String(account.portal_created_at || ""))}.
        </p>
      )}
    </div>
  );
}
