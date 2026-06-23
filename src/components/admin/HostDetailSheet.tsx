"use client";

// ─── HostDetailSheet — STR host account page (spec §4 + §5 admin actions) ─────
//
// Opens from the host list. Shows the full account: editable summary, the
// host's properties (where the admin SETS pricing and flips status — the
// Pending Pricing → Active gate), turnover history, the computed revenue
// snapshot, notes + the who/when audit trail, and every admin-only action
// (approve live, pause, offboard, adjust intro, resend links, manual turnover).
//
// All writes go through /api/partner-admin/actions, which re-enforces the
// guardrails server-side and returns the refreshed host so the panel stays live.

import { useEffect, useState } from "react";
import * as React from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  RiLoader4Line, RiCheckLine, RiPauseCircleLine, RiLogoutCircleRLine, RiSendPlaneLine,
  RiBankCard2Line, RiPriceTag3Line, RiAddLine, RiSaveLine, RiHistoryLine,
  RiMoneyDollarCircleLine, RiStickyNoteLine, RiUser3Line, RiBuilding2Line,
} from "@remixicon/react";

import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  fetchHostDetail, runAction, type HostDetail, type PropertyView,
} from "@/lib/partner-admin-api";

const LIFECYCLE_OPTIONS = ["Lead", "Onboarding", "Active", "Paused", "Churned"];
const ONBOARDING_OPTIONS = ["Pending Pricing", "Agreement Sent", "Signed", "Live"];
const PROPERTY_STATUS_OPTIONS = ["Pending Pricing", "Active", "Paused"];

const money = (n: number | null | undefined) =>
  `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export function HostDetailSheet({
  hostId,
  onClose,
  onMutated,
}: {
  hostId: string | null;
  onClose: () => void;
  onMutated: () => void;
}) {
  const [host, setHost] = useState<HostDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = React.useCallback(async (id: string, refresh = false) => {
    setLoading(true);
    try {
      setHost(await fetchHostDetail(id, refresh));
    } catch (err) {
      toast.error((err as Error).message || "Could not load host.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hostId) load(hostId);
    else setHost(null);
  }, [hostId, load]);

  // Run a write action, surface errors, refresh this panel + the parent list.
  const act = async (body: Record<string, unknown>, successMsg: string) => {
    if (!hostId) return;
    setBusy(true);
    try {
      const res = await runAction({ hostId, ...body });
      if (res.host) setHost(res.host);
      else await load(hostId, true);
      toast.success(successMsg);
      onMutated();
    } catch (err) {
      toast.error((err as Error).message || "Action failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={!!hostId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto p-0">
        {loading && !host ? (
          <div className="flex justify-center py-20">
            <RiLoader4Line className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : host ? (
          <div className="p-5 space-y-5">
            <SheetHeader className="space-y-1">
              <SheetTitle className="flex items-center gap-2 text-lg">
                {host.entityType === "entity" ? <RiBuilding2Line className="w-5 h-5" /> : <RiUser3Line className="w-5 h-5" />}
                {host.name || host.email || "Host"}
              </SheetTitle>
              <div className="flex flex-wrap items-center gap-1.5">
                {host.lifecycleStage && <Badge variant="secondary">{host.lifecycleStage}</Badge>}
                {host.onboardingStage && <Badge variant="outline">{host.onboardingStage}</Badge>}
                {host.agreementSigned ? (
                  <Badge className="bg-emerald-100 text-emerald-700">Agreement signed</Badge>
                ) : (
                  <Badge className="bg-amber-100 text-amber-700">Unsigned</Badge>
                )}
              </div>
            </SheetHeader>

            {/* Admin actions (spec §5) */}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy} onClick={() => act({ action: "approve_live" }, "Host approved to go live.")}>
                <RiCheckLine className="w-4 h-4 mr-1" /> Approve live
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => act({ action: "pause_host" }, "Host paused.")}>
                <RiPauseCircleLine className="w-4 h-4 mr-1" /> Pause
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => act({ action: "resend_agreement" }, "Agreement resent.")}>
                <RiSendPlaneLine className="w-4 h-4 mr-1" /> Resend agreement
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => act({ action: "resend_payment" }, "Payment-setup link resent.")}>
                <RiBankCard2Line className="w-4 h-4 mr-1" /> Resend payment
              </Button>
              <OffboardButton busy={busy} onConfirm={() => act({ action: "offboard_host" }, "Host offboarded (history retained).")} />
            </div>

            <RevenueSnapshot host={host} />
            <HostSummary host={host} busy={busy} onSave={(patch) => act({ action: "patch_host", patch }, "Host updated.")} />
            <PropertiesSection host={host} busy={busy} act={act} />
            <ManualTurnover host={host} busy={busy} act={act} />
            <TurnoverHistory host={host} />
            <NotesSection host={host} busy={busy} onSave={(notes) => act({ action: "patch_host", patch: { notes } }, "Notes saved.")} />
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

// ─── Revenue snapshot (spec §4.4) ─────────────────────────────────────────────

function RevenueSnapshot({ host }: { host: HostDetail }) {
  const s = host.stats;
  const cells = [
    { label: "Turnovers MTD", value: String(s.turnoversThisMonth) },
    { label: "Revenue MTD", value: money(s.revenueThisMonth) },
    { label: "Lifetime turns", value: String(s.lifetimeTurnovers) },
    { label: "Lifetime rev", value: money(s.lifetimeRevenue) },
    { label: "Avg / turnover", value: money(s.avgPerTurnover) },
    {
      label: "Last turnover",
      value: s.lastTurnoverDate ? `${s.daysSinceLastTurnover}d ago` : "—",
    },
  ];
  return (
    <div className="rounded-lg border bg-slate-50 p-3">
      <p className="text-xs font-semibold text-slate-500 flex items-center gap-1 mb-2">
        <RiMoneyDollarCircleLine className="w-4 h-4" /> Revenue snapshot
      </p>
      <div className="grid grid-cols-3 gap-2">
        {cells.map((c) => (
          <div key={c.label}>
            <p className="text-[11px] text-muted-foreground">{c.label}</p>
            <p className="text-sm font-semibold tabular-nums">{c.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Host summary (spec §4.1 — inline-editable) ───────────────────────────────

function HostSummary({
  host,
  busy,
  onSave,
}: {
  host: HostDetail;
  busy: boolean;
  onSave: (patch: Record<string, unknown>) => void;
}) {
  const [name, setName] = useState(host.name || "");
  const [company, setCompany] = useState(host.company || "");
  const [phone, setPhone] = useState(host.phone || "");
  const [lifecycle, setLifecycle] = useState(host.lifecycleStage || "");
  const [onboarding, setOnboarding] = useState(host.onboardingStage || "");
  const [agreementSigned, setAgreementSigned] = useState(host.agreementSigned);
  const [stripeCustomerId, setStripeCustomerId] = useState(host.stripeCustomerId || "");
  const [paymentMethod, setPaymentMethod] = useState(host.paymentMethodOnFile || "");

  useEffect(() => {
    setName(host.name || "");
    setCompany(host.company || "");
    setPhone(host.phone || "");
    setLifecycle(host.lifecycleStage || "");
    setOnboarding(host.onboardingStage || "");
    setAgreementSigned(host.agreementSigned);
    setStripeCustomerId(host.stripeCustomerId || "");
    setPaymentMethod(host.paymentMethodOnFile || "");
  }, [host]);

  const save = () =>
    onSave({
      name,
      company,
      phone,
      lifecycleStage: lifecycle,
      onboardingStage: onboarding,
      agreementSigned,
      stripeCustomerId,
      paymentMethodOnFile: paymentMethod,
    });

  return (
    <section className="rounded-lg border p-3 space-y-3">
      <h3 className="text-sm font-semibold flex items-center gap-1.5"><RiUser3Line className="w-4 h-4" /> Summary</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Company"><Input value={company} onChange={(e) => setCompany(e.target.value)} /></Field>
        <Field label="Phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Field label="Email (identity key — read-only)"><Input value={host.email || ""} disabled /></Field>
        <Field label="Lifecycle stage">
          <SimpleSelect value={lifecycle} onChange={setLifecycle} options={LIFECYCLE_OPTIONS} />
        </Field>
        <Field label="Onboarding stage">
          <SimpleSelect value={onboarding} onChange={setOnboarding} options={ONBOARDING_OPTIONS} />
        </Field>
        <Field label="Stripe customer ID"><Input value={stripeCustomerId} onChange={(e) => setStripeCustomerId(e.target.value)} placeholder="cus_…" /></Field>
        <Field label="Payment method on file"><Input value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} placeholder="e.g. Visa •4242" /></Field>
      </div>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={agreementSigned} onCheckedChange={setAgreementSigned} />
          Agreement signed
        </label>
        <Button size="sm" disabled={busy} onClick={save}>
          <RiSaveLine className="w-4 h-4 mr-1" /> Save summary
        </Button>
      </div>
    </section>
  );
}

// ─── Properties (spec §4.2 — the pricing + status gate) ───────────────────────

function PropertiesSection({
  host,
  busy,
  act,
}: {
  host: HostDetail;
  busy: boolean;
  act: (body: Record<string, unknown>, msg: string) => Promise<void>;
}) {
  return (
    <section className="rounded-lg border p-3 space-y-3">
      <h3 className="text-sm font-semibold flex items-center gap-1.5">
        <RiBuilding2Line className="w-4 h-4" /> Properties ({host.properties.length})
      </h3>
      {host.properties.length === 0 && <p className="text-sm text-muted-foreground">No properties linked.</p>}
      <div className="space-y-3">
        {host.properties.map((p) => (
          <PropertyCard key={p.id} hostId={host.id} property={p} busy={busy} act={act} />
        ))}
      </div>
    </section>
  );
}

const STATUS_TONE: Record<string, string> = {
  Active: "bg-emerald-100 text-emerald-700",
  "Pending Pricing": "bg-amber-100 text-amber-700",
  Paused: "bg-slate-100 text-slate-500",
};

function PropertyCard({
  hostId,
  property,
  busy,
  act,
}: {
  hostId: string;
  property: PropertyView;
  busy: boolean;
  act: (body: Record<string, unknown>, msg: string) => Promise<void>;
}) {
  const [std, setStd] = useState(property.standardTurnoverRate != null ? String(property.standardTurnoverRate) : "");
  const [intro, setIntro] = useState(property.introRate != null ? String(property.introRate) : "");
  const [introEnd, setIntroEnd] = useState(property.introRateEndDate || "");
  const [status, setStatus] = useState(property.propertyStatus || "Pending Pricing");

  useEffect(() => {
    setStd(property.standardTurnoverRate != null ? String(property.standardTurnoverRate) : "");
    setIntro(property.introRate != null ? String(property.introRate) : "");
    setIntroEnd(property.introRateEndDate || "");
    setStatus(property.propertyStatus || "Pending Pricing");
  }, [property]);

  const saveRates = () => {
    const stdNum = parseFloat(std);
    if (!Number.isFinite(stdNum) || stdNum <= 0) {
      toast.error("Enter a valid Standard Turnover Rate (the Active gate).");
      return;
    }
    act(
      {
        action: "set_rates",
        propertyId: property.id,
        hostId,
        standardTurnoverRate: stdNum,
        introRate: intro ? parseFloat(intro) : undefined,
        introRateEndDate: introEnd || undefined,
      },
      "Rates set — property is Active and bookable.",
    );
  };

  const changeStatus = (next: string) => {
    setStatus(next);
    act({ action: "set_property_status", propertyId: property.id, hostId, status: next }, `Property → ${next}.`);
  };

  return (
    <div className="rounded-lg border p-3 space-y-3 bg-white">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium truncate">{property.nickname || "Property"}</p>
          <p className="text-xs text-muted-foreground truncate">{property.address || "—"}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {[property.bedrooms && `${property.bedrooms} bd`, property.bathrooms && `${property.bathrooms} ba`, property.sqft && `${property.sqft} sqft`].filter(Boolean).join(" · ") || "—"}
          </p>
        </div>
        {property.propertyStatus && (
          <Badge className={cn("text-[10px] shrink-0", STATUS_TONE[property.propertyStatus] || "bg-slate-100")}>
            {property.propertyStatus}
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Field label="Standard $"><Input inputMode="decimal" value={std} onChange={(e) => setStd(e.target.value)} placeholder="per turnover" /></Field>
        <Field label="Intro $"><Input inputMode="decimal" value={intro} onChange={(e) => setIntro(e.target.value)} placeholder="optional" /></Field>
        <Field label={property.introExpiring ? "Intro ends ⚠︎" : "Intro ends"}><Input type="date" value={introEnd} onChange={(e) => setIntroEnd(e.target.value)} /></Field>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy} onClick={saveRates}>
          <RiPriceTag3Line className="w-4 h-4 mr-1" /> Save rates & activate
        </Button>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Status</span>
          <SimpleSelect value={status} onChange={changeStatus} options={PROPERTY_STATUS_OPTIONS} className="w-36" />
        </div>
      </div>

      <PropertyDetailsEditor hostId={hostId} property={property} busy={busy} act={act} />
    </div>
  );
}

function PropertyDetailsEditor({
  hostId,
  property,
  busy,
  act,
}: {
  hostId: string;
  property: PropertyView;
  busy: boolean;
  act: (body: Record<string, unknown>, msg: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [linen, setLinen] = useState(property.linenIncluded);
  const [restock, setRestock] = useState(property.restockIncluded);
  const [accessType, setAccessType] = useState(property.accessType || "");
  const [frequency, setFrequency] = useState(property.turnoverFrequency || "");

  useEffect(() => {
    setLinen(property.linenIncluded);
    setRestock(property.restockIncluded);
    setAccessType(property.accessType || "");
    setFrequency(property.turnoverFrequency || "");
  }, [property]);

  if (!open) {
    return (
      <button className="text-xs text-primary hover:underline" onClick={() => setOpen(true)}>
        Edit linen / restock / access / frequency
      </button>
    );
  }

  return (
    <div className="rounded-md border bg-slate-50 p-2.5 space-y-2">
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-1.5 text-xs"><Switch checked={linen} onCheckedChange={setLinen} /> Linen</label>
        <label className="flex items-center gap-1.5 text-xs"><Switch checked={restock} onCheckedChange={setRestock} /> Restock</label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Access type"><Input value={accessType} onChange={(e) => setAccessType(e.target.value)} placeholder="Lockbox…" /></Field>
        <Field label="Frequency"><Input value={frequency} onChange={(e) => setFrequency(e.target.value)} placeholder="Weekly…" /></Field>
      </div>
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            act(
              {
                action: "patch_property",
                propertyId: property.id,
                hostId,
                patch: { linenIncluded: linen, restockIncluded: restock, accessType, turnoverFrequency: frequency },
              },
              "Property details saved.",
            )
          }
        >
          <RiSaveLine className="w-4 h-4 mr-1" /> Save details
        </Button>
      </div>
    </div>
  );
}

// ─── Manual turnover entry (spec §5.7) ────────────────────────────────────────

function ManualTurnover({
  host,
  busy,
  act,
}: {
  host: HostDetail;
  busy: boolean;
  act: (body: Record<string, unknown>, msg: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [propertyId, setPropertyId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [cleaner, setCleaner] = useState("");

  const submit = () => {
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) { toast.error("Enter a valid amount."); return; }
    if (!date) { toast.error("Pick a date."); return; }
    act(
      {
        action: "manual_turnover",
        propertyId: propertyId || undefined,
        dateCompleted: date,
        amount: amt,
        cleanerName: cleaner || undefined,
      },
      "Manual turnover logged.",
    ).then(() => { setAmount(""); setCleaner(""); setOpen(false); });
  };

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <RiAddLine className="w-4 h-4 mr-1" /> Log manual turnover
      </Button>
    );
  }

  return (
    <section className="rounded-lg border p-3 space-y-3">
      <h3 className="text-sm font-semibold">Log manual turnover (off-system)</h3>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Property">
          <SimpleSelect
            value={propertyId}
            onChange={setPropertyId}
            options={host.properties.map((p) => ({ value: p.id, label: p.nickname || "Property" }))}
            placeholder="(optional)"
          />
        </Field>
        <Field label="Date completed"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Amount ($)"><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Cleaner (name)"><Input value={cleaner} onChange={(e) => setCleaner(e.target.value)} placeholder="optional" /></Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        <Button size="sm" disabled={busy} onClick={submit}>Log turnover</Button>
      </div>
    </section>
  );
}

// ─── Turnover history (spec §4.3) ─────────────────────────────────────────────

const PAY_TONE: Record<string, string> = {
  Paid: "bg-emerald-100 text-emerald-700",
  Pending: "bg-amber-100 text-amber-700",
  Failed: "bg-rose-100 text-rose-700",
  Refunded: "bg-slate-100 text-slate-500",
};

function TurnoverHistory({ host }: { host: HostDetail }) {
  return (
    <section className="rounded-lg border p-3 space-y-2">
      <h3 className="text-sm font-semibold flex items-center gap-1.5"><RiHistoryLine className="w-4 h-4" /> Turnover history ({host.turnovers.length})</h3>
      {host.turnovers.length === 0 && <p className="text-sm text-muted-foreground">No turnovers recorded yet.</p>}
      <div className="space-y-1">
        {host.turnovers.slice(0, 50).map((t) => (
          <div key={t.id} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
            <div className="min-w-0">
              <p className="font-medium truncate">
                {t.dateCompleted ? format(new Date(`${t.dateCompleted}T12:00:00`), "MMM d, yyyy") : "—"}
                {t.propertyNickname ? ` · ${t.propertyNickname}` : ""}
              </p>
              <p className="text-[11px] text-muted-foreground truncate">{t.cleanerName || "Unassigned"}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="tabular-nums font-semibold">{money(t.amountPaid)}</span>
              {t.paymentStatus && (
                <Badge className={cn("text-[10px]", PAY_TONE[t.paymentStatus] || "bg-slate-100")}>{t.paymentStatus}</Badge>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Notes + audit trail (spec §4.5 / §8) ─────────────────────────────────────

function NotesSection({
  host,
  busy,
  onSave,
}: {
  host: HostDetail;
  busy: boolean;
  onSave: (notes: string) => void;
}) {
  const [notes, setNotes] = useState(host.notes || "");
  useEffect(() => setNotes(host.notes || ""), [host]);
  return (
    <section className="rounded-lg border p-3 space-y-2">
      <h3 className="text-sm font-semibold flex items-center gap-1.5"><RiStickyNoteLine className="w-4 h-4" /> Notes & audit trail</h3>
      <Textarea rows={6} value={notes} onChange={(e) => setNotes(e.target.value)} className="font-mono text-xs" />
      <p className="text-[11px] text-muted-foreground">Admin status changes are auto-logged here with who + when.</p>
      <div className="flex justify-end">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onSave(notes)}>
          <RiSaveLine className="w-4 h-4 mr-1" /> Save notes
        </Button>
      </div>
    </section>
  );
}

// ─── Offboard confirmation ────────────────────────────────────────────────────

function OffboardButton({ busy, onConfirm }: { busy: boolean; onConfirm: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline" className="text-rose-600 border-rose-200 hover:bg-rose-50" disabled={busy}>
          <RiLogoutCircleRLine className="w-4 h-4 mr-1" /> Offboard
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Offboard this host?</AlertDialogTitle>
          <AlertDialogDescription>
            Sets Lifecycle to “Churned” and pauses all properties so no future turnovers run. History and the
            signed agreement are retained — nothing is deleted.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="bg-rose-600 hover:bg-rose-700">Offboard</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Shared field + select helpers ────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function SimpleSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: (string | { value: string; label: string })[];
  placeholder?: string;
  className?: string;
}) {
  const norm = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={cn("h-9", className)}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {norm.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
