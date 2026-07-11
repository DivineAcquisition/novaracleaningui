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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface AccountRow {
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

export function attentionFlags(a: AccountRow): string[] {
  const flags: string[] = [];
  if (a.status === "offboarded") return flags;
  if (!a.agreement_signed_at) flags.push("No signed agreement");
  if (!a.stripe_customer_id) flags.push("No payment on file");
  if (a.account_type !== "partnership" && !a.coi_sent_at && a.status === "active") flags.push("COI not sent");
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

// ─── Account detail / edit sheet ─────────────────────────────────────────────

function AccountSheet({ account, onClose, reload }: { account: AccountRow; onClose: () => void; reload: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(account.status);
  const [rateDollars, setRateDollars] = useState(account.default_rate_cents != null ? String(account.default_rate_cents / 100) : "");
  const [frequency, setFrequency] = useState(account.recurring_frequency || "");
  const [notes, setNotes] = useState(account.notes || "");
  const [agreementSigned, setAgreementSigned] = useState(Boolean(account.agreement_signed_at));
  const [stripeId, setStripeId] = useState(account.stripe_customer_id || "");
  const [autopay, setAutopay] = useState(account.autopay_enabled);
  const [coiSent, setCoiSent] = useState(Boolean(account.coi_sent_at));

  const canGoActive = agreementSigned && stripeId.trim() !== "";

  const save = async () => {
    if (status === "active" && !canGoActive) {
      toast.error("Can't set Active — a signed agreement AND a payment method (Stripe customer) are required first.");
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
                <RiErrorWarningLine className="w-3.5 h-3.5" /> Active is locked until agreement + Stripe customer are set.
              </p>
            )}
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
