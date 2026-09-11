"use client";

// ─── Property manager portal ───────────────────────────────────────────────
//
// The third view on the type-aware partner portal. Host lands on a calendar;
// a property manager lands on their portfolio, because the unit — not the
// visit — is the thing they manage. Turnovers are events under a unit.
//
// Rates are read-only everywhere here, and nothing on this screen can render
// crew contact information: the payload is sanitized server-side before it
// ever reaches this component.

import { useCallback, useEffect, useState } from "react";
import {
  RiAddLine,
  RiAlertLine,
  RiBuilding2Line,
  RiCalendarEventLine,
  RiFileTextLine,
  RiImage2Line,
  RiKey2Line,
  RiLoader4Line,
  RiTimeLine,
} from "@remixicon/react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const PURPLE = "linear-gradient(135deg,#5C0FFE 0%,#8F7BFD 100%)";
const API = "/api/partner-portal/property-manager";

type Tab = "portfolio" | "turnovers" | "invoices" | "documents" | "issue";

interface RateLine {
  service: string;
  label: string;
  standingCents: number | null;
  listCents: number | null;
}

interface Unit {
  id: string;
  label: string;
  unitLabel: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  sqft: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  zoneCode: string | null;
  rates: RateLine[];
  discountPercent: number;
  status: string;
  reviewMessage: string | null;
  bookable: boolean;
  accessOnFile: boolean;
  accessMethod: string | null;
  accessNotes: string | null;
  parkingNotes: string | null;
  notes: string | null;
  rateEditable: false;
  turnoverCount: number;
  upcomingCount: number;
  lastServicedOn: string | null;
  nextNeededBy: string | null;
}

interface Turnover {
  id: string;
  unitId: string;
  unitLabel: string | null;
  serviceType: string;
  serviceLabel: string;
  neededByDate: string;
  deadlineLabel: string;
  scheduledDate: string | null;
  status: string;
  statusLabel: string;
  priceCents: number;
  finalPriceCents: number | null;
  scopeAdjustmentCents: number;
  chargedCents: number;
  notes: string | null;
  completedAt: string | null;
  beforePhotos: string[];
  afterPhotos: string[];
}

interface InvoiceUnitLine {
  unitId: string;
  unitLabel: string;
  address: string | null;
  subtotalCents: number;
  turnovers: Array<{
    turnoverId: string;
    serviceLabel: string;
    servicedOn: string;
    amountCents: number;
    scopeAdjustmentCents: number;
  }>;
}

interface Invoice {
  id: string;
  periodLabel: string;
  amountCents: number;
  unitCount: number;
  turnoverCount: number;
  status: string;
  statusLabel: string;
  dueDate: string | null;
  url: string | null;
  units: InvoiceUnitLine[];
}

interface PmData {
  ok: boolean;
  preview?: boolean;
  account: {
    companyName: string | null;
    contactName: string | null;
    status: string;
    unitCount: number;
    pendingReviewCount: number;
    upcomingTurnovers: number;
    agreementSigned: boolean;
  };
  discount: {
    percent: number;
    label: string | null;
    unitsToNextTier: number | null;
    nextPercent: number | null;
    note: string | null;
  };
  billing: {
    method: "invoiced" | "auto_pay";
    invoiceCycle: string;
    netTermsLabel: string | null;
    cardOnFile: boolean;
    paymentBrand: string | null;
    paymentLast4: string | null;
    invoices: Invoice[];
  };
  services: Array<{ key: string; label: string; summary: string }>;
  units: Unit[];
  selectedUnitId: string | null;
  turnovers: Turnover[];
  documents: Array<{ label: string; url: string | null; date: string; kind: string }>;
  rateEditable: false;
}

function previewParam(): string {
  if (typeof window === "undefined") return "";
  const p = new URLSearchParams(window.location.search).get("preview");
  return p ? `preview=${p}` : "";
}

function query(extra?: Record<string, string>): string {
  const parts = [previewParam()];
  for (const [k, v] of Object.entries(extra || {})) if (v) parts.push(`${k}=${encodeURIComponent(v)}`);
  const joined = parts.filter(Boolean).join("&");
  return joined ? `?${joined}` : "";
}

function money(cents: number | null | undefined): string {
  const n = Number(cents);
  if (!Number.isFinite(n)) return "—";
  return `$${(n / 100).toFixed(2).replace(/\.00$/, "")}`;
}

function sizeLine(u: Unit): string {
  const parts: string[] = [];
  if (u.bedrooms != null) parts.push(`${u.bedrooms} BR`);
  if (u.bathrooms != null) parts.push(`${u.bathrooms} BA`);
  if (u.sqft) parts.push(`${Math.round(u.sqft).toLocaleString()} sq ft`);
  if (u.zoneCode) parts.push(`Zone ${u.zoneCode}`);
  return parts.join(" · ") || "Size on file";
}

const OPEN_STATUSES = ["scheduled", "assigned", "confirmed", "in_progress", "requested"];

export default function PropertyManagerPortal() {
  const [tab, setTab] = useState<Tab>("portfolio");
  const [data, setData] = useState<PmData | null>(null);
  const [loading, setLoading] = useState(true);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [bookFor, setBookFor] = useState<Unit | null>(null);
  const [accessFor, setAccessFor] = useState<Unit | null>(null);
  const [photosFor, setPhotosFor] = useState<Turnover | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async (drillTo?: string | null) => {
    setLoading(true);
    try {
      const res = await fetch(`${API}${query(drillTo ? { unitId: drillTo } : undefined)}`);
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "Couldn't load your portfolio.");
      setData(json as PmData);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load your portfolio.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(null);
  }, [load]);

  const drillInto = (id: string | null) => {
    setUnitId(id);
    setTab("turnovers");
    void load(id);
  };

  if (loading || !data) {
    return (
      <div className="flex justify-center py-16">
        <RiLoader4Line className="h-8 w-8 animate-spin text-[#5C0FFE]" />
      </div>
    );
  }

  const upcoming = data.turnovers.filter((t) => OPEN_STATUSES.includes(t.status));
  const past = data.turnovers.filter((t) => !OPEN_STATUSES.includes(t.status));
  const drilled = unitId ? data.units.find((u) => u.id === unitId) || null : null;

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "portfolio", label: "Portfolio" },
    { id: "turnovers", label: "Turnovers" },
    { id: "invoices", label: "Invoices" },
    { id: "documents", label: "Documents" },
    { id: "issue", label: "Report an issue" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex gap-1 overflow-x-auto pb-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium",
              tab === t.id ? "bg-[#5C0FFE] text-white" : "border border-slate-200 bg-white text-slate-600",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "portfolio" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label="Registered units" value={String(data.account.unitCount)} />
            <Kpi label="Upcoming turnovers" value={String(data.account.upcomingTurnovers)} />
            <Kpi
              label="Portfolio discount"
              value={data.discount.percent > 0 ? `${data.discount.percent}%` : "—"}
            />
            <Kpi
              label="Billing"
              value={data.billing.method === "auto_pay" ? "Auto-Pay" : "Invoiced"}
            />
          </div>

          {data.discount.note && (
            <Card>
              <CardContent className="p-4 text-sm text-emerald-900">
                <p>{data.discount.note}</p>
                {data.discount.unitsToNextTier != null && data.discount.nextPercent != null && (
                  <p className="mt-1 text-xs text-slate-500">
                    {data.discount.unitsToNextTier} more unit
                    {data.discount.unitsToNextTier === 1 ? "" : "s"} reaches{" "}
                    {data.discount.nextPercent}%.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-slate-600">
                Every unit below is registered with its own standing rates. Book a turnover by
                picking the unit and the date it has to be ready — no walkthrough, no quote, and the
                rate never changes between tenants.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
                  <RiAddLine className="mr-1 h-4 w-4" /> Add a unit
                </Button>
                <Button size="sm" variant="outline" onClick={() => setTab("turnovers")}>
                  <RiCalendarEventLine className="mr-1 h-4 w-4" /> All turnover activity
                </Button>
              </div>
            </CardContent>
          </Card>

          {data.account.pendingReviewCount > 0 && (
            <Card>
              <CardContent className="p-4 text-sm text-amber-900">
                {data.account.pendingReviewCount} unit
                {data.account.pendingReviewCount === 1 ? " is" : "s are"} with our team for pricing.
                The rest of your portfolio is bookable as normal.
              </CardContent>
            </Card>
          )}

          {data.units.map((u) => (
            <UnitCard
              key={u.id}
              unit={u}
              onBook={() => setBookFor(u)}
              onHistory={() => drillInto(u.id)}
              onAccess={() => setAccessFor(u)}
            />
          ))}
        </div>
      )}

      {tab === "turnovers" && (
        <section className="space-y-4">
          {drilled ? (
            <Card>
              <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                <div>
                  <p className="text-sm font-semibold">{drilled.label}</p>
                  <p className="text-xs text-slate-500">
                    {drilled.turnoverCount} turnover{drilled.turnoverCount === 1 ? "" : "s"} on this
                    unit
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => drillInto(null)}>
                  Show the whole portfolio
                </Button>
              </CardContent>
            </Card>
          ) : (
            <p className="text-sm text-slate-500">
              Every turnover across the portfolio. Open a unit from the Portfolio tab to see just
              that apartment.
            </p>
          )}

          <h2 className="font-bold">Upcoming</h2>
          {upcoming.length === 0 && (
            <Empty>No upcoming turnovers. Book one from any registered unit.</Empty>
          )}
          {upcoming.map((t) => (
            <TurnoverRow key={t.id} t={t} onPhotos={() => setPhotosFor(t)} onDone={() => load(unitId)} />
          ))}

          <h2 className="font-bold">History</h2>
          {past.length === 0 && <Empty>Completed turnovers appear here with their documentation.</Empty>}
          {past.map((t) => (
            <TurnoverRow key={t.id} t={t} onPhotos={() => setPhotosFor(t)} onDone={() => load(unitId)} />
          ))}
        </section>
      )}

      {tab === "invoices" && (
        <section className="space-y-3">
          <Card>
            <CardContent className="p-4 text-sm text-slate-600">
              One invoice per {data.billing.invoiceCycle.replace(/_/g, " ")} billing period covering
              every turnover across the portfolio, itemized by unit.{" "}
              {data.billing.method === "auto_pay"
                ? `Charged automatically to ${
                    data.billing.paymentLast4
                      ? `${data.billing.paymentBrand || "card"} ···· ${data.billing.paymentLast4}`
                      : "the card on file"
                  }.`
                : data.billing.netTermsLabel
                  ? `Payable on ${data.billing.netTermsLabel} terms.`
                  : ""}
            </CardContent>
          </Card>
          {data.billing.invoices.length === 0 && (
            <Empty>Your first consolidated invoice appears here at the end of the period.</Empty>
          )}
          {data.billing.invoices.map((inv) => (
            <InvoiceCard key={inv.id} invoice={inv} />
          ))}
        </section>
      )}

      {tab === "documents" && (
        <section className="space-y-2">
          {data.documents.length === 0 && (
            <Empty>Your signed agreement and unit registry will appear here.</Empty>
          )}
          {data.documents.map((d, i) => (
            <Card key={i}>
              <CardContent className="flex items-center gap-3 p-4">
                <RiFileTextLine className="h-4 w-4 shrink-0 text-[#5C0FFE]" />
                <span className="text-sm">{d.label}</span>
                {d.url && (
                  <a
                    href={d.url}
                    className="ml-auto shrink-0 text-xs font-semibold text-[#5C0FFE]"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Download
                  </a>
                )}
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {tab === "issue" && <IssueForm units={data.units} turnovers={data.turnovers} onDone={() => load(unitId)} />}

      {bookFor && (
        <BookModal
          unit={bookFor}
          services={data.services}
          onClose={() => setBookFor(null)}
          onDone={() => {
            setBookFor(null);
            void load(unitId);
          }}
        />
      )}
      {accessFor && (
        <AccessModal
          unit={accessFor}
          onClose={() => setAccessFor(null)}
          onDone={() => {
            setAccessFor(null);
            void load(unitId);
          }}
        />
      )}
      {photosFor && <PhotosModal turnover={photosFor} onClose={() => setPhotosFor(null)} />}
      {addOpen && (
        <AddUnitModal
          onClose={() => setAddOpen(false)}
          onDone={() => {
            setAddOpen(false);
            void load(unitId);
          }}
        />
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-slate-500">{label}</p>
        <p className="mt-1 text-xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-6 text-center text-sm text-slate-500">{children}</CardContent>
    </Card>
  );
}

function UnitCard({
  unit,
  onBook,
  onHistory,
  onAccess,
}: {
  unit: Unit;
  onBook: () => void;
  onHistory: () => void;
  onAccess: () => void;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 font-semibold">
              <RiBuilding2Line className="h-4 w-4 text-[#5C0FFE]" />
              {unit.label}
            </p>
            <p className="text-xs text-slate-500">
              {[unit.address, unit.city, unit.state, unit.zipCode].filter(Boolean).join(", ")}
            </p>
            <p className="mt-1 text-xs text-slate-500">{sizeLine(unit)}</p>
          </div>
          {unit.status === "pending_review" ? (
            <Badge className="border-0 bg-amber-100 text-amber-700">Pending Company pricing</Badge>
          ) : (
            <Badge className="border-0 bg-violet-100 text-violet-700">
              {unit.upcomingCount > 0 ? `${unit.upcomingCount} upcoming` : "Registered"}
            </Badge>
          )}
        </div>

        {unit.status === "pending_review" ? (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {unit.reviewMessage || "Our team is setting this unit's standing rates."}
          </p>
        ) : (
          <div className="mt-3 divide-y divide-slate-100 rounded-lg bg-slate-50 px-3">
            {unit.rates.map((r) => (
              <div key={r.service} className="flex items-center justify-between py-1.5">
                <span className="text-xs text-slate-600">{r.label}</span>
                <span className="text-sm font-bold text-[#5C0FFE]">{money(r.standingCents)}</span>
              </div>
            ))}
          </div>
        )}
        <p className="mt-1 text-[11px] text-slate-400">
          Standing rates are Company-set and read only. They hold for every turnover on this unit.
        </p>

        <p className="mt-2 text-xs text-slate-500">
          {unit.turnoverCount} turnover{unit.turnoverCount === 1 ? "" : "s"}
          {unit.lastServicedOn ? ` · last serviced ${unit.lastServicedOn}` : ""}
          {unit.nextNeededBy ? ` · next needed by ${unit.nextNeededBy}` : ""}
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            className="text-white"
            style={{ background: PURPLE }}
            disabled={!unit.bookable}
            onClick={onBook}
          >
            Book a turnover
          </Button>
          <Button size="sm" variant="outline" onClick={onHistory}>
            History &amp; photos
          </Button>
          <Button size="sm" variant="outline" onClick={onAccess}>
            <RiKey2Line className="mr-1 h-3.5 w-3.5" />
            {unit.accessOnFile ? "Access details" : "Add access details"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function TurnoverRow({
  t,
  onPhotos,
  onDone,
}: {
  t: Turnover;
  onPhotos: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const photos = (t.beforePhotos?.length || 0) + (t.afterPhotos?.length || 0);
  const open = OPEN_STATUSES.includes(t.status);

  const cancel = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${API}${query()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel_turnover", turnoverId: t.id }),
      });
      const json = await res.json();
      if (json.preview) {
        toast.success(json.message || "Preview only — not saved.");
        return;
      }
      if (!json.ok) throw new Error(json.error);
      toast.success(json.message || "Cancelled.");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't cancel that turnover.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-semibold">{t.unitLabel || "Unit"}</p>
            <p className="text-xs text-slate-500">
              {t.serviceLabel} · {t.deadlineLabel}
              {t.scheduledDate ? ` · scheduled ${t.scheduledDate}` : ""}
            </p>
          </div>
          <Badge className="border-0 bg-violet-100 text-violet-700">{t.statusLabel}</Badge>
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-sm font-medium">
          <RiTimeLine className="h-4 w-4 text-slate-400" />
          {money(t.chargedCents)}
          {t.scopeAdjustmentCents !== 0 && (
            <span className="text-xs font-normal text-amber-700">
              includes an approved scope adjustment of {money(t.scopeAdjustmentCents)}
            </span>
          )}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {photos > 0 && (
            <Button size="sm" variant="outline" onClick={onPhotos}>
              <RiImage2Line className="mr-1 h-3.5 w-3.5" /> Before / after
            </Button>
          )}
          {open && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void cancel()}>
              Cancel
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function InvoiceCard({ invoice }: { invoice: Invoice }) {
  const [open, setOpen] = useState(false);
  const tone =
    invoice.status === "paid"
      ? "bg-emerald-100 text-emerald-700"
      : invoice.status === "overdue"
        ? "bg-rose-100 text-rose-700"
        : "bg-amber-100 text-amber-700";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-semibold">{invoice.periodLabel}</p>
            <p className="text-xs text-slate-500">
              {invoice.turnoverCount} turnover{invoice.turnoverCount === 1 ? "" : "s"} across{" "}
              {invoice.unitCount} unit{invoice.unitCount === 1 ? "" : "s"}
              {invoice.dueDate ? ` · due ${invoice.dueDate}` : ""}
            </p>
          </div>
          <div className="text-right">
            <p className="font-bold">{money(invoice.amountCents)}</p>
            <Badge className={cn("border-0", tone)}>{invoice.statusLabel}</Badge>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-3">
          <button className="text-xs font-semibold text-[#5C0FFE]" onClick={() => setOpen((v) => !v)}>
            {open ? "Hide" : "See it itemized by unit"}
          </button>
          {invoice.url && (
            <a
              href={invoice.url}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-semibold text-[#5C0FFE]"
            >
              Open invoice
            </a>
          )}
        </div>
        {open && (
          <div className="mt-3 space-y-3">
            {invoice.units.map((u) => (
              <div key={u.unitId} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">{u.unitLabel}</p>
                  <p className="text-sm font-bold">{money(u.subtotalCents)}</p>
                </div>
                {u.address && <p className="text-[11px] text-slate-400">{u.address}</p>}
                <ul className="mt-2 space-y-1">
                  {u.turnovers.map((t) => (
                    <li key={t.turnoverId} className="flex justify-between text-xs text-slate-600">
                      <span>
                        {t.servicedOn} · {t.serviceLabel}
                        {t.scopeAdjustmentCents !== 0 ? " (scope adjusted)" : ""}
                      </span>
                      <span>{money(t.amountCents)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BookModal({
  unit,
  services,
  onClose,
  onDone,
}: {
  unit: Unit;
  services: Array<{ key: string; label: string; summary: string }>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [service, setService] = useState(services[0]?.key || "move_out");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const rate = unit.rates.find((r) => r.service === service)?.standingCents ?? null;

  const submit = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${API}${query()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "book_turnover",
          unitId: unit.id,
          serviceType: service,
          neededByDate: date,
          neededByTime: time,
          notes,
        }),
      });
      const json = await res.json();
      if (json.preview) {
        toast.success(json.message || "Preview only — not saved.");
        onDone();
        return;
      }
      if (!json.ok) throw new Error(json.error);
      toast.success(json.message || "Turnover confirmed.");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't book that turnover.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Book a turnover" onClose={onClose}>
      <p className="text-sm text-slate-500">{unit.label}</p>
      <div className="mt-3 space-y-2">
        {services.map((s) => {
          const cents = unit.rates.find((r) => r.service === s.key)?.standingCents ?? null;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setService(s.key)}
              className={cn(
                "flex w-full items-start justify-between gap-3 rounded-xl border p-3 text-left",
                service === s.key ? "border-[#5C0FFE] bg-violet-50" : "border-slate-200",
              )}
            >
              <span>
                <span className="block text-sm font-semibold">{s.label}</span>
                <span className="block text-xs text-slate-500">{s.summary}</span>
              </span>
              <span className="shrink-0 text-sm font-bold text-[#5C0FFE]">{money(cents)}</span>
            </button>
          );
        })}
      </div>

      <label className="mt-3 block text-sm">
        Needed by (the date this unit must be ready)
        <Input type="date" className="mt-1" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className="mt-2 block text-sm">
        Time, if there is one
        <Input type="time" className="mt-1" value={time} onChange={(e) => setTime(e.target.value)} />
      </label>
      <p className="mt-1 text-xs text-slate-500">
        We treat this as a hard deadline and schedule the work to finish on or before it.
      </p>
      <Textarea
        className="mt-3"
        rows={3}
        placeholder="Anything the crew should know (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      <p className="mt-3 text-sm">
        Confirms immediately at <strong>{money(rate)}</strong> — this unit&apos;s standing rate. No
        quote, no walkthrough.
      </p>
      <Button
        className="mt-3 w-full text-white"
        style={{ background: PURPLE }}
        disabled={busy || !date}
        onClick={() => void submit()}
      >
        {busy ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : "Confirm turnover"}
      </Button>
    </Modal>
  );
}

function AccessModal({ unit, onClose, onDone }: { unit: Unit; onClose: () => void; onDone: () => void }) {
  const [method, setMethod] = useState(unit.accessMethod || "");
  const [code, setCode] = useState("");
  const [notes, setNotes] = useState(unit.accessNotes || "");
  const [parking, setParking] = useState(unit.parkingNotes || "");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${API}${query()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_unit_access",
          unitId: unit.id,
          accessMethod: method,
          accessCode: code,
          accessNotes: notes,
          parkingNotes: parking,
        }),
      });
      const json = await res.json();
      if (json.preview) {
        toast.success(json.message || "Preview only — not saved.");
        onDone();
        return;
      }
      if (!json.ok) throw new Error(json.error);
      toast.success(json.message || "Access details saved.");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save those access details.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Access details" onClose={onClose}>
      <p className="text-sm text-slate-500">
        Stored on {unit.label} and reused for every turnover, so you never re-send a lockbox code.
        Only the crew assigned to a visit sees them, and only around the window of that visit.
      </p>
      <Input
        className="mt-3"
        placeholder="How we get in (lockbox, key pickup, building entry…)"
        value={method}
        onChange={(e) => setMethod(e.target.value)}
      />
      <Input
        className="mt-2"
        placeholder={unit.accessOnFile ? "Replace the code on file (leave blank to keep)" : "Code"}
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
      <Textarea
        className="mt-2"
        rows={3}
        placeholder="Anything else about getting in"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      <Textarea
        className="mt-2"
        rows={2}
        placeholder="Parking"
        value={parking}
        onChange={(e) => setParking(e.target.value)}
      />
      <Button
        className="mt-3 w-full text-white"
        style={{ background: PURPLE }}
        disabled={busy}
        onClick={() => void submit()}
      >
        {busy ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : "Save access details"}
      </Button>
    </Modal>
  );
}

function AddUnitModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({
    unitLabel: "",
    address: "",
    city: "",
    state: "",
    zipCode: "",
    sqft: "",
    bedrooms: "",
    bathrooms: "",
    notes: "",
    flagNonStandard: false,
  });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${API}${query()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_unit",
          unitLabel: form.unitLabel,
          address: form.address,
          city: form.city,
          state: form.state,
          zipCode: form.zipCode,
          sqft: form.sqft ? Number(form.sqft) : undefined,
          bedrooms: form.bedrooms ? Number(form.bedrooms) : undefined,
          bathrooms: form.bathrooms ? Number(form.bathrooms) : undefined,
          notes: form.notes,
          flagNonStandard: form.flagNonStandard,
        }),
      });
      const json = await res.json();
      if (json.preview) {
        toast.success(json.message || "Preview only — not saved.");
        onDone();
        return;
      }
      if (!json.ok) throw new Error(json.error);
      toast.success(json.message || "Unit added.");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add that unit.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Add a unit" onClose={onClose}>
      <p className="text-sm text-slate-500">
        A typical unit prices itself from its size, bedrooms, and zone and is bookable right away.
        Only a genuinely unusual one goes to our team first — we&apos;ll tell you which happened.
      </p>
      <Input
        className="mt-3"
        placeholder="Unit label (e.g. Maple St #3B)"
        value={form.unitLabel}
        onChange={(e) => setForm({ ...form, unitLabel: e.target.value })}
      />
      <Input
        className="mt-2"
        placeholder="Street address"
        value={form.address}
        onChange={(e) => setForm({ ...form, address: e.target.value })}
      />
      <div className="mt-2 grid grid-cols-3 gap-2">
        <Input placeholder="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        <Input placeholder="State" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
        <Input
          placeholder="ZIP"
          inputMode="numeric"
          value={form.zipCode}
          onChange={(e) => setForm({ ...form, zipCode: e.target.value })}
        />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <Input
          placeholder="Sq ft"
          inputMode="numeric"
          value={form.sqft}
          onChange={(e) => setForm({ ...form, sqft: e.target.value })}
        />
        <Input
          placeholder="Bedrooms"
          inputMode="numeric"
          value={form.bedrooms}
          onChange={(e) => setForm({ ...form, bedrooms: e.target.value })}
        />
        <Input
          placeholder="Bathrooms"
          inputMode="decimal"
          value={form.bathrooms}
          onChange={(e) => setForm({ ...form, bathrooms: e.target.value })}
        />
      </div>
      <Textarea
        className="mt-2"
        rows={2}
        placeholder="Notes (optional)"
        value={form.notes}
        onChange={(e) => setForm({ ...form, notes: e.target.value })}
      />
      <label className="mt-2 flex items-start gap-2 text-xs text-slate-600">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-[#5500FF]"
          checked={form.flagNonStandard}
          onChange={(e) => setForm({ ...form, flagNonStandard: e.target.checked })}
        />
        This unit is non-standard — have someone look at it before pricing.
      </label>
      <Button
        className="mt-3 w-full text-white"
        style={{ background: PURPLE }}
        disabled={busy || form.address.trim().length < 5}
        onClick={() => void submit()}
      >
        {busy ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : "Add unit"}
      </Button>
    </Modal>
  );
}

function PhotosModal({ turnover, onClose }: { turnover: Turnover; onClose: () => void }) {
  return (
    <Modal title={`${turnover.unitLabel || "Unit"} — before / after`} onClose={onClose}>
      <p className="text-sm text-slate-500">
        {turnover.serviceLabel} · {turnover.completedAt ? turnover.completedAt.slice(0, 10) : turnover.neededByDate}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Before</p>
          {(turnover.beforePhotos || []).map((u) => (
            <img key={u} src={u} alt="Before" className="mb-2 w-full rounded-lg" />
          ))}
          {!turnover.beforePhotos?.length && <p className="text-sm text-slate-400">None yet</p>}
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase text-slate-500">After</p>
          {(turnover.afterPhotos || []).map((u) => (
            <img key={u} src={u} alt="After" className="mb-2 w-full rounded-lg" />
          ))}
          {!turnover.afterPhotos?.length && <p className="text-sm text-slate-400">None yet</p>}
        </div>
      </div>
    </Modal>
  );
}

function IssueForm({
  units,
  turnovers,
  onDone,
}: {
  units: Unit[];
  turnovers: Turnover[];
  onDone: () => void;
}) {
  const [unitId, setUnitId] = useState("");
  const [turnoverId, setTurnoverId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const forUnit = unitId ? turnovers.filter((t) => t.unitId === unitId) : [];

  const submit = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${API}${query()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "report_issue",
          title,
          description,
          unitId: unitId || undefined,
          turnoverId: turnoverId || undefined,
        }),
      });
      const json = await res.json();
      if (json.preview) {
        toast.success(json.message || "Preview only — not saved.");
        return;
      }
      if (!json.ok) throw new Error(json.error);
      toast.success(json.message || "Issue sent to QC.");
      setTitle("");
      setDescription("");
      setTurnoverId("");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't file that issue.");
    } finally {
      setBusy(false);
    }
  };

  const selectCls =
    "w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#5C0FFE]";

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <p className="flex items-center gap-1.5 font-semibold">
          <RiAlertLine className="h-4 w-4 text-[#5C0FFE]" /> Report an issue
        </p>
        <p className="text-sm text-slate-500">
          This feeds the same QC queue as every other complaint channel. Tag the unit so it lands
          against that apartment&apos;s history.
        </p>
        <select
          className={selectCls}
          value={unitId}
          onChange={(e) => {
            setUnitId(e.target.value);
            setTurnoverId("");
          }}
        >
          <option value="">Which unit? (optional)</option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
            </option>
          ))}
        </select>
        {forUnit.length > 0 && (
          <select className={selectCls} value={turnoverId} onChange={(e) => setTurnoverId(e.target.value)}>
            <option value="">Which turnover? (optional)</option>
            {forUnit.map((t) => (
              <option key={t.id} value={t.id}>
                {t.neededByDate} · {t.serviceLabel}
              </option>
            ))}
          </select>
        )}
        <Input placeholder="Short title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Textarea
          rows={4}
          placeholder="What happened?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Button
          className="text-white"
          style={{ background: PURPLE }}
          disabled={busy || !title.trim()}
          onClick={() => void submit()}
        >
          {busy ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : "Send to QC"}
        </Button>
      </CardContent>
    </Card>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-start justify-between">
          <h3 className="font-bold">{title}</h3>
          <button className="text-sm text-slate-400" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
