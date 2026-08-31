"use client";

// ─── Commercial & Office accounts — Partnerships Hub tab ────────────────────
//
// Manages business_accounts (Supabase) across the commercial line of business:
// type filter (Commercial / Office / Partnership), lifecycle status, the
// agreement + payment go-live gates, rates, and needs-attention flags.
// Offboarding retains history (status change, never delete).

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RiBuilding2Line,
  RiCheckboxCircleFill,
  RiErrorWarningLine,
  RiLoader4Line,
  RiRefreshLine,
  RiSearch2Line,
} from "@remixicon/react";
import { format } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ZoneMapEditor } from "@/components/commercial/ZoneMapEditor";
import { parseSiteZones, type SiteZone } from "@/lib/site-zones";
import { cn } from "@/lib/utils";
import { commercialTab } from "@/lib/commercial-proposal";

export interface AccountRow {
  id: string;
  account_type: string;
  business_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  facility_type: string | null;
  square_footage: number | null;
  num_locations: number | null;
  recurring_frequency: string | null;
  default_rate_cents: number | null;
  billing_terms: string | null;
  status: string;
  agreement_signed_at: string | null;
  stripe_customer_id: string | null;
  autopay_enabled: boolean;
  coi_sent_at: string | null;
  coi_expires_at: string | null;
  coi_carrier: string | null;
  coi_policy_number: string | null;
  source: string | null;
  notes: string | null;
  lead_details: Record<string, unknown> | null;
  last_activity_at: string | null;
  created_at: string;
}

const STATUS_STYLE: Record<string, string> = {
  prospect: "bg-blue-100 text-blue-700",
  onboarding: "bg-amber-100 text-amber-700",
  active: "bg-emerald-100 text-emerald-700",
  paused: "bg-slate-100 text-slate-600",
  offboarded: "bg-rose-100 text-rose-600",
};
const money = (c: number | null | undefined) => (c != null ? `$${(Number(c) / 100).toFixed(2)}` : "—");

const COI_WARNING_DAYS = 30;

/**
 * How many days until the certificate of insurance lapses. Negative means it
 * already has.
 */
export function coiDaysRemaining(a: Pick<AccountRow, "coi_expires_at">): number | null {
  if (!a.coi_expires_at) return null;
  const expiry = Date.parse(`${String(a.coi_expires_at).slice(0, 10)}T23:59:59`);
  if (!Number.isFinite(expiry)) return null;
  return Math.floor((expiry - Date.now()) / 86400_000);
}

/**
 * Compliance blockers on the account — the gaps that stop work outright.
 *
 * These sit on the ACCOUNT, which is the whole point: a commercial account
 * with an expired COI cannot have work booked or dispatched at ANY of its
 * sites, not just the one someone happened to open.
 *
 * This mirrors commercial_account_compliance() in SQL, which is what actually
 * enforces the block. The two must agree — a list that says an account is fine
 * while the server refuses its bookings is worse than no list. In particular:
 * no expiry date means no cover, whether or not a certificate was once marked
 * as sent, because there is nothing to compute currency from.
 */
export function complianceBlockers(a: AccountRow): string[] {
  const blockers: string[] = [];
  if (a.status === "offboarded") return ["Account is offboarded"];
  if (!a.agreement_signed_at) blockers.push("No signed agreement");
  const days = coiDaysRemaining(a);
  if (days == null) blockers.push("No current COI on file");
  else if (days < 0) blockers.push(`COI expired ${Math.abs(days)}d ago`);
  return blockers;
}

export function attentionFlags(a: AccountRow): string[] {
  const flags: string[] = [...complianceBlockers(a)];
  if (a.status === "offboarded") return flags;
  if (!a.stripe_customer_id) flags.push("No payment on file");
  const days = coiDaysRemaining(a);
  if (days != null && days >= 0 && days <= COI_WARNING_DAYS) flags.push(`COI expires in ${days}d`);
  if (a.last_activity_at && Date.now() - new Date(a.last_activity_at).getTime() > 30 * 86400_000) flags.push("Idle 30+ days");
  return flags;
}

export default function CommercialAccountsAdmin() {
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AccountRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase.from as any)("business_accounts")
        .select("*")
        .order("last_activity_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      setAccounts((data || []) as AccountRow[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load accounts");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => accounts.filter((a) => {
    if (typeFilter !== "all" && a.account_type !== typeFilter) return false;
    if (statusFilter === "attention") return attentionFlags(a).length > 0 && a.status !== "offboarded";
    if (statusFilter !== "all" && a.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!`${a.business_name} ${a.contact_name} ${a.email} ${a.city}`.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [accounts, typeFilter, statusFilter, search]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <RiSearch2Line className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input placeholder="Search business, contact, email…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="commercial">Commercial</SelectItem>
            <SelectItem value="office">Office</SelectItem>
            <SelectItem value="partnership">Partnership</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="attention">⚠ Needs attention</SelectItem>
            <SelectItem value="prospect">Prospect</SelectItem>
            <SelectItem value="onboarding">Onboarding</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
            <SelectItem value="offboarded">Offboarded</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RiRefreshLine className={cn("w-4 h-4", loading && "animate-spin")} />
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="p-10 text-center text-sm text-slate-500">
          No accounts match. New commercial intake submissions land here automatically as prospects.
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((a) => {
            const flags = attentionFlags(a);
            return (
              <button key={a.id} onClick={() => setSelected(a)}
                className={cn(
                  "w-full text-left rounded-xl border bg-white px-4 py-3 hover:border-violet-300 hover:shadow-sm transition-all",
                  flags.length > 0 && a.status !== "prospect" ? "border-amber-300" : "border-slate-200",
                )}>
                <div className="flex flex-wrap items-center gap-2">
                  <RiBuilding2Line className="w-4 h-4 text-violet-600" />
                  <span className="font-semibold text-slate-900">{a.business_name}</span>
                  <Badge variant="outline" className="capitalize">{a.account_type}</Badge>
                  <Badge className={cn("border-0", STATUS_STYLE[a.status] || "bg-slate-100")}>{a.status}</Badge>
                  {a.default_rate_cents != null && <span className="text-xs text-slate-500">{money(a.default_rate_cents)}/mo</span>}
                  <span className="text-xs text-slate-400 ml-auto">
                    {a.last_activity_at ? format(new Date(a.last_activity_at), "MMM d") : ""}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  {a.contact_name || "—"} · {a.email || "—"} · {a.facility_type || "—"}
                  {a.square_footage ? ` · ${a.square_footage.toLocaleString()} sqft` : ""}
                  {a.num_locations ? ` · ${a.num_locations} location${a.num_locations === 1 ? "" : "s"}` : ""}
                </p>
                {flags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {flags.map((f) => (
                      <span key={f} className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">⚠ {f}</span>
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {selected && <AccountSheet account={selected} onClose={() => setSelected(null)} reload={load} />}
    </div>
  );
}

// ─── Server action helper (admin JWT attached) ───────────────────────────────

async function accountAction(body: Record<string, unknown>): Promise<Record<string, any>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch("/api/commercial-accounts/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out?.ok === false) throw new Error(out?.error || `Request failed (${res.status})`);
  return out;
}

interface SiteRow {
  id: string;
  nickname: string;
  address: string | null;
  city: string | null;
  facility_type: string | null;
  facility_type_key: string | null;
  scope_level: string | null;
  sqft: number | null;
  restrooms: number | null;
  breakrooms: number | null;
  floors: number | null;
  scope_notes: string | null;
  access_method: string | null;
  access_instructions: string | null;
  badge_required: boolean | null;
  alarm_code: string | null;
  security_contact_name: string | null;
  security_contact_phone: string | null;
  loading_dock_notes: string | null;
  after_hours_access_notes: string | null;
  service_window_start: string | null;
  service_window_end: string | null;
  photo_zones: SiteZone[] | null;
  active: boolean;
}

const FACILITY_TYPE_KEYS = [
  { key: "office", label: "Office" },
  { key: "warehouse", label: "Warehouse/Industrial" },
  { key: "retail", label: "Retail" },
  { key: "restaurant", label: "Restaurant" },
  { key: "gym", label: "Gym/Fitness" },
  { key: "medical", label: "Medical/Clinical" },
  { key: "other", label: "Other" },
];

// ─── Account detail / edit sheet ─────────────────────────────────────────────
// Exported: the unified Accounts view (PartnershipAccounts) opens the same
// sheet, so commercial/office accounts are managed identically everywhere.

export function AccountSheet({ account, onClose, reload }: { account: AccountRow; onClose: () => void; reload: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(account.status);
  const [rateDollars, setRateDollars] = useState(account.default_rate_cents != null ? String(account.default_rate_cents / 100) : "");
  const [frequency, setFrequency] = useState(account.recurring_frequency || "");
  const [notes, setNotes] = useState(account.notes || "");
  const [agreementSigned, setAgreementSigned] = useState(Boolean(account.agreement_signed_at));
  const [stripeId, setStripeId] = useState(account.stripe_customer_id || "");
  const [autopay, setAutopay] = useState(account.autopay_enabled);
  const [coiSent, setCoiSent] = useState(Boolean(account.coi_sent_at));
  const coiExpires = account.coi_expires_at ? String(account.coi_expires_at).slice(0, 10) : "";
  const coiCarrier = account.coi_carrier || "";
  const coiPolicy = account.coi_policy_number || "";
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [siteEdit, setSiteEdit] = useState<Partial<SiteRow> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await (supabase.from as any)("business_sites")
        .select("*")
        .eq("business_account_id", account.id)
        .order("created_at", { ascending: true });
      setSites((data || []) as SiteRow[]);
    })();
  }, [account.id]);

  const runAction = async (action: string, success: string, extra: Record<string, unknown> = {}) => {
    setBusy(action);
    try {
      const out = await accountAction({ action, accountId: account.id, ...extra });
      toast.success(success);
      if (action === "send_payment_link" && out.setupUrl) {
        await navigator.clipboard?.writeText(String(out.setupUrl)).catch(() => undefined);
        toast.info(out.emailed ? "Link also emailed to the contact." : "Link copied — email delivery unavailable, send it manually.");
        setStripeId(String(out.customerId || stripeId));
      }
      // Deliberately does NOT mark the agreement signed. Sending a signing
      // link is not a signature; the account flips when the client actually
      // signs on the tokenized page.
      if (action === "send_agreement" && out.link) {
        await navigator.clipboard?.writeText(String(out.link)).catch(() => undefined);
        toast.info(
          out.emailed
            ? "Signing link emailed to the contact and copied to your clipboard."
            : "Signing link copied — email delivery unavailable, send it manually.",
        );
      }
      await reload();
      return out;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
      return null;
    } finally {
      setBusy(null);
    }
  };

  const saveSite = async () => {
    if (!siteEdit?.nickname?.trim()) { toast.error("Site nickname required"); return; }
    setBusy("save_site");
    try {
      await accountAction({ action: "save_site", accountId: account.id, site: siteEdit });
      toast.success("Site saved + synced to Airtable");
      const { data } = await (supabase.from as any)("business_sites")
        .select("*").eq("business_account_id", account.id).order("created_at", { ascending: true });
      setSites((data || []) as SiteRow[]);
      setSiteEdit(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Site save failed");
    } finally {
      setBusy(null);
    }
  };

  const canGoActive = agreementSigned && stripeId.trim() !== "" && sites.some((st) => st.active);

  const coiDays = coiDaysRemaining({ coi_expires_at: coiExpires || null });
  // No expiry date means nothing to compute currency from, so it blocks —
  // matching the server rule exactly, whatever the "COI sent" checkbox says.
  const coiBlocked = coiDays == null || coiDays < 0;
  const coiExpiringSoon = coiDays != null && coiDays >= 0 && coiDays <= COI_WARNING_DAYS;
  // Compliance is an account fact. Showing it on the sites list is what stops
  // it being noticed one site at a time.
  const siteBlockers = [
    ...(agreementSigned ? [] : ["no signed agreement"]),
    ...(coiBlocked ? [coiDays != null && coiDays < 0 ? "expired COI" : "no COI on file"] : []),
  ];

  const save = async () => {
    if (status === "active" && !canGoActive) {
      toast.error("Can't set Active — signed agreement + payment method + at least one site are required first.");
      return;
    }
    setSaving(true);
    try {
      const rate = parseFloat(rateDollars);
      const { error } = await (supabase.from as any)("business_accounts").update({
        status,
        default_rate_cents: Number.isFinite(rate) && rate > 0 ? Math.round(rate * 100) : null,
        recurring_frequency: frequency || null,
        notes: notes || null,
        agreement_signed_at: agreementSigned ? (account.agreement_signed_at || new Date().toISOString()) : null,
        stripe_customer_id: stripeId.trim() || null,
        autopay_enabled: autopay,
        coi_sent_at: coiSent ? (account.coi_sent_at || new Date().toISOString()) : null,
        // coi_expires_at / carrier / policy are NOT written here: they mirror
        // the certificate on file and are maintained by the Compliance
        // console. Two places to type the same date is how it goes stale.
      }).eq("id", account.id);
      if (error) throw error;
      toast.success("Account updated");
      await reload();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const lead = account.lead_details || {};

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <RiBuilding2Line className="w-5 h-5 text-violet-600" /> {account.business_name}
          </SheetTitle>
          <SheetDescription>
            {account.contact_name} · {account.email} · {account.phone || "no phone"} · joined {format(new Date(account.created_at), "MMM d, yyyy")}
            {account.source ? ` · via ${account.source.replace(/_/g, " ")}` : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {Object.keys(lead).length > 0 && (
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600 space-y-0.5">
              <p className="font-semibold text-slate-800 mb-1">Intake details</p>
              {Object.entries(lead).filter(([k, v]) => v != null && k !== "type").map(([k, v]) => (
                <p key={k}><span className="text-slate-400">{k.replace(/_/g, " ")}:</span> {String(v)}</p>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["prospect", "onboarding", "active", "paused", "offboarded"].map((st) => (
                    <SelectItem key={st} value={st} disabled={st === "active" && !canGoActive}>
                      {st}{st === "active" && !canGoActive ? " (gated)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Monthly rate ($)</Label>
              <Input type="number" min={0} value={rateDollars} onChange={(e) => setRateDollars(e.target.value)} placeholder="—" className="mt-1" />
            </div>
          </div>
          <div>
            <Label>Service frequency</Label>
            <Input value={frequency} onChange={(e) => setFrequency(e.target.value)} placeholder="e.g. weekly, 3x/week" className="mt-1" />
          </div>

          {/* Onboarding actions */}
          <div className="rounded-lg border border-slate-200 p-3 space-y-2">
            <p className="text-xs font-bold text-slate-800">Onboarding actions</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" asChild>
                <a href={commercialTab("send", { account: account.id })}>
                  Send proposal
                </a>
              </Button>
              <Button size="sm" variant="outline" disabled={busy !== null}
                onClick={() => void runAction("send_agreement", "Signing link created.")}>
                {busy === "send_agreement" ? <RiLoader4Line className="w-3.5 h-3.5 mr-1 animate-spin" /> : null}
                Send signing link
              </Button>
              <Button size="sm" variant="outline" disabled={busy !== null}
                onClick={() => void runAction("send_payment_link", "Payment setup link created.")}>
                {busy === "send_payment_link" ? <RiLoader4Line className="w-3.5 h-3.5 mr-1 animate-spin" /> : null}
                Send payment setup link
              </Button>
              <Button size="sm" variant="outline" disabled={busy !== null}
                onClick={() => void runAction("sync_airtable", "Account + sites re-synced to Airtable.")}>
                {busy === "sync_airtable" ? <RiLoader4Line className="w-3.5 h-3.5 mr-1 animate-spin" /> : null}
                Sync to Airtable
              </Button>
            </div>
          </div>

          {/* Sites */}
          <div className="rounded-lg border border-slate-200 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-slate-800">Sites ({sites.filter((st) => st.active).length})</p>
              <Button size="sm" variant="ghost" className="h-7 text-xs text-violet-700"
                onClick={() => setSiteEdit({ nickname: "", facility_type: account.facility_type || "" })}>
                + Add site
              </Button>
            </div>
            {sites.length === 0 && !siteEdit && (
              <p className="text-xs text-amber-600">No sites yet — at least one active site is required to go Active.</p>
            )}
            {siteBlockers.length > 0 && sites.length > 0 && (
              <p className="text-[11px] font-semibold text-rose-700">
                ⚠ Every site below is blocked — {siteBlockers.join(" + ")} on the account.
              </p>
            )}
            {sites.map((st) => (
              <button key={st.id} onClick={() => setSiteEdit(st)}
                className={cn(
                  "w-full text-left rounded-md border px-2.5 py-1.5 text-xs hover:border-violet-300",
                  !st.active ? "border-slate-100 opacity-50"
                    : siteBlockers.length > 0 ? "border-rose-200 bg-rose-50/40"
                    : "border-slate-200",
                )}>
                <span className="font-semibold text-slate-800">{st.nickname}</span>
                <span className="text-slate-500"> · {st.facility_type || "—"}{st.sqft ? ` · ${st.sqft.toLocaleString()} sqft` : ""}{st.address ? ` · ${st.address}` : ""}</span>
                {st.active && siteBlockers.length > 0 && (
                  <span className="block text-rose-600 mt-0.5">Blocked: {siteBlockers.join(" + ")}</span>
                )}
              </button>
            ))}
            {siteEdit && (
              <div className="rounded-md bg-slate-50 border border-slate-200 p-2.5 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <Input placeholder="Nickname *" value={siteEdit.nickname || ""} onChange={(e) => setSiteEdit({ ...siteEdit, nickname: e.target.value })} className="h-8 text-xs" />
                  <Input placeholder="Facility type" value={siteEdit.facility_type || ""} onChange={(e) => setSiteEdit({ ...siteEdit, facility_type: e.target.value })} className="h-8 text-xs" />
                </div>
                <Input placeholder="Street address" value={siteEdit.address || ""} onChange={(e) => setSiteEdit({ ...siteEdit, address: e.target.value })} className="h-8 text-xs" />
                <div className="grid grid-cols-3 gap-2">
                  <Input placeholder="City" value={siteEdit.city || ""} onChange={(e) => setSiteEdit({ ...siteEdit, city: e.target.value })} className="h-8 text-xs" />
                  <Input placeholder="Sqft" type="number" value={siteEdit.sqft ?? ""} onChange={(e) => setSiteEdit({ ...siteEdit, sqft: e.target.value ? Number(e.target.value) : null })} className="h-8 text-xs" />
                  <Input placeholder="Restrooms" type="number" value={siteEdit.restrooms ?? ""} onChange={(e) => setSiteEdit({ ...siteEdit, restrooms: e.target.value ? Number(e.target.value) : null })} className="h-8 text-xs" />
                </div>

                {/* Pricing defaults for this building. Captured here so a
                    booking against the site never re-enters them. */}
                <div className="grid grid-cols-3 gap-2">
                  <Select value={siteEdit.facility_type_key || ""} onValueChange={(v) => setSiteEdit({ ...siteEdit, facility_type_key: v })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Pricing facility type" /></SelectTrigger>
                    <SelectContent>
                      {FACILITY_TYPE_KEYS.map((f) => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={siteEdit.scope_level || ""} onValueChange={(v) => setSiteEdit({ ...siteEdit, scope_level: v })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Usual scope" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="light">Light</SelectItem>
                      <SelectItem value="standard">Standard</SelectItem>
                      <SelectItem value="detailed">Detailed</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input placeholder="Breakrooms" type="number" value={siteEdit.breakrooms ?? ""} onChange={(e) => setSiteEdit({ ...siteEdit, breakrooms: e.target.value ? Number(e.target.value) : null })} className="h-8 text-xs" />
                </div>

                {/* Service window — many commercial sites can only be cleaned
                    before opening or after closing, and the window length is
                    what sizes the crew. */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[10px] text-slate-500">Window starts</Label>
                    <Input type="time" value={siteEdit.service_window_start?.slice(0, 5) || ""} onChange={(e) => setSiteEdit({ ...siteEdit, service_window_start: e.target.value })} className="h-8 text-xs mt-0.5" />
                  </div>
                  <div>
                    <Label className="text-[10px] text-slate-500">Window ends</Label>
                    <Input type="time" value={siteEdit.service_window_end?.slice(0, 5) || ""} onChange={(e) => setSiteEdit({ ...siteEdit, service_window_end: e.target.value })} className="h-8 text-xs mt-0.5" />
                  </div>
                </div>

                <Input placeholder="Access (lockbox, key, badge…)" value={siteEdit.access_method || ""} onChange={(e) => setSiteEdit({ ...siteEdit, access_method: e.target.value })} className="h-8 text-xs" />

                {/* Security & access complexity — badge procedure, alarm,
                    dock. All of it reaches the crew's portal on confirmation,
                    time-scoped like every other access detail. */}
                <div className="rounded-md border border-slate-200 bg-white p-2 space-y-2">
                  <label className="flex items-center gap-1.5 text-xs text-slate-700">
                    <input type="checkbox" checked={siteEdit.badge_required === true} onChange={(e) => setSiteEdit({ ...siteEdit, badge_required: e.target.checked })} className="rounded" />
                    Badge / keycard required
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <Input placeholder="Alarm code" value={siteEdit.alarm_code || ""} onChange={(e) => setSiteEdit({ ...siteEdit, alarm_code: e.target.value })} className="h-8 text-xs font-mono" />
                    <Input placeholder="Security contact" value={siteEdit.security_contact_name || ""} onChange={(e) => setSiteEdit({ ...siteEdit, security_contact_name: e.target.value })} className="h-8 text-xs" />
                    <Input placeholder="Security phone" value={siteEdit.security_contact_phone || ""} onChange={(e) => setSiteEdit({ ...siteEdit, security_contact_phone: e.target.value })} className="h-8 text-xs" />
                  </div>
                  <Textarea placeholder="After-hours building access (freight elevator, front desk, gate…)" value={siteEdit.after_hours_access_notes || ""} onChange={(e) => setSiteEdit({ ...siteEdit, after_hours_access_notes: e.target.value })} rows={2} className="text-xs" />
                  <Textarea placeholder="Loading dock procedure" value={siteEdit.loading_dock_notes || ""} onChange={(e) => setSiteEdit({ ...siteEdit, loading_dock_notes: e.target.value })} rows={2} className="text-xs" />
                </div>

                <div>
                  <Label className="text-[10px] text-slate-500">
                    Documentation zones — named at walkthrough, editable here without a re-walk
                  </Label>
                  <div className="mt-1">
                    <ZoneMapEditor
                      compact
                      zones={parseSiteZones(siteEdit.photo_zones)}
                      onChange={(next) => setSiteEdit({ ...siteEdit, photo_zones: next })}
                    />
                  </div>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    Below the zone threshold a site stays on a single before/after pair. Split, merge, rename, or add here for corrections.
                  </p>
                </div>

                <Textarea placeholder="Scope notes" value={siteEdit.scope_notes || ""} onChange={(e) => setSiteEdit({ ...siteEdit, scope_notes: e.target.value })} rows={2} className="text-xs" />
                <div className="flex gap-2 items-center">
                  <Button size="sm" className="h-7 text-xs" disabled={busy === "save_site"} onClick={() => void saveSite()}>
                    {busy === "save_site" ? <RiLoader4Line className="w-3 h-3 mr-1 animate-spin" /> : null} Save site
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSiteEdit(null)}>Cancel</Button>
                  {siteEdit.id && (
                    <label className="flex items-center gap-1.5 text-xs text-slate-600 ml-auto">
                      <input type="checkbox" checked={siteEdit.active !== false} onChange={(e) => setSiteEdit({ ...siteEdit, active: e.target.checked })} className="rounded" />
                      Active
                    </label>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Go-live gates */}
          <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-3 space-y-2">
            <p className="text-xs font-bold text-violet-800">Go-live gates — required before Active</p>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={agreementSigned} onChange={(e) => setAgreementSigned(e.target.checked)} className="rounded" />
              Agreement signed {account.agreement_signed_at && <span className="text-xs text-slate-400">({format(new Date(account.agreement_signed_at), "MMM d, yyyy")})</span>}
            </label>
            <div>
              <Label className="text-xs">Stripe customer id (payment on file)</Label>
              <Input value={stripeId} onChange={(e) => setStripeId(e.target.value)} placeholder="cus_…" className="mt-1 h-8 text-xs font-mono" />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={autopay} onChange={(e) => setAutopay(e.target.checked)} className="rounded" />
              Auto-pay enabled
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={coiSent} onChange={(e) => setCoiSent(e.target.checked)} className="rounded" />
              COI sent
            </label>
            {!canGoActive && (
              <p className="text-[11px] text-amber-700 flex items-center gap-1">
                <RiErrorWarningLine className="w-3.5 h-3.5" /> Active is locked until agreement + payment + at least one site are set.
              </p>
            )}
          </div>

          {/* Certificate of insurance — read-only here on purpose.
              Status is computed from the expiry date of the certificate on
              file, so the date is changed by recording a certificate, not by
              typing over it. Editing it here would let the two drift, which is
              the exact failure the computed status exists to prevent. */}
          <div className={cn(
            "rounded-lg border p-3 space-y-2",
            coiBlocked ? "border-rose-300 bg-rose-50/60" : coiExpiringSoon ? "border-amber-300 bg-amber-50/60" : "border-slate-200",
          )}>
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-slate-800">Certificate of insurance</p>
              <a href="/admin/commercial?tab=compliance"
                className="text-[11px] font-semibold text-violet-700 hover:underline">
                Manage in Compliance →
              </a>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <p className="text-[10px] text-slate-500">Expires</p>
                <p className="font-semibold text-slate-800">{coiExpires || "—"}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500">Carrier</p>
                <p className="font-semibold text-slate-800">{coiCarrier || "—"}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500">Policy #</p>
                <p className="font-mono text-slate-800">{coiPolicy || "—"}</p>
              </div>
            </div>
            {coiBlocked ? (
              <p className="text-[11px] text-rose-700 flex items-start gap-1">
                <RiErrorWarningLine className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                {coiDays != null && coiDays < 0
                  ? `Expired ${Math.abs(coiDays)} days ago.`
                  : "No certificate with a readable expiry date on file."}{" "}
                Commercial work at <strong>every one of this account&apos;s {sites.length} site
                {sites.length === 1 ? "" : "s"}</strong> is blocked from booking and dispatch until it&apos;s current.
              </p>
            ) : coiExpiringSoon ? (
              <p className="text-[11px] text-amber-700">
                Expires in {coiDays} days. Renew before then or every site under this account stops booking.
              </p>
            ) : !coiExpires && coiSent ? (
              <p className="text-[11px] text-amber-700">
                Marked sent but no certificate on file — record it under Compliance so the gate can tell current from
                lapsed.
              </p>
            ) : coiExpires ? (
              <p className="text-[11px] text-emerald-700">Current — all sites clear to book.</p>
            ) : null}
          </div>

          <div>
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="mt-1" />
          </div>

          <Button className="w-full" onClick={() => void save()} disabled={saving}>
            {saving ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiCheckboxCircleFill className="w-4 h-4 mr-1.5" />}
            Save account
          </Button>
          {status === "offboarded" && (
            <p className="text-[11px] text-slate-400 text-center">Offboarding keeps the record and all history — nothing is deleted.</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
