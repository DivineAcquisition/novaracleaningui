"use client";

import { useCallback, useEffect, useState } from "react";
import {
  RiAlertLine,
  RiBuilding2Line,
  RiCalendarCheckLine,
  RiFileTextLine,
  RiLoader4Line,
  RiMoneyDollarCircleLine,
  RiShieldCheckLine,
} from "@remixicon/react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CompanyCoiDownloadLink } from "@/components/commercial/CompanyCoiDownloadLink";
import { cn } from "@/lib/utils";

const PURPLE = "linear-gradient(135deg,#5C0FFE 0%,#8F7BFD 100%)";

interface Site {
  id: string;
  nickname: string;
  address: string | null;
  city: string | null;
  facilityType: string | null;
  scopeLevel: string | null;
  sqft: number | null;
  serviceWindowStart: string | null;
  serviceWindowEnd: string | null;
  upcomingCount: number;
  lastVisit?: string | null;
  zones?: Array<{
    id: string;
    name: string;
    description: string;
    status: "complete" | "partial" | "not_done" | null;
    note: string;
    before: string[];
    after: string[];
  }>;
}
interface Visit {
  id: string;
  serviceDate: string | null;
  status: string | null;
  timeSlot: string | null;
  arrivalWindow: string | null;
  address: string | null;
  city: string | null;
  amountCents: number | null;
  invoiceUrl: string | null;
  isRecurring: boolean | null;
  frequency: string | null;
  beforePhotos: string[];
  afterPhotos: string[];
  completedAt: string | null;
  siteId: string | null;
}
interface Data {
  account: {
    businessName: string;
    status: string;
    accountType: string;
    facilityType: string | null;
    frequency: string | null;
    siteCount: number;
    upcomingThisPeriod: number;
    upcomingTotal: number;
    agreementSigned: boolean;
    billingConfigured: boolean;
    contractValueCents: number | null;
    term: string | null;
  };
  billing: {
    method: "auto_pay" | "invoiced";
    cardOnFile: boolean;
    netTerms: string | null;
    invoiceCycle: string | null;
    invoices: Array<{ id: string; date: string; amountCents: number; url: string | null; status: string; dueDate: string }>;
    charges: Array<{ id: string; date: string; amountCents: number; url: string | null; status: string; dueDate: string }>;
  };
  coi: { status: "current" | "expiring" | "expired"; expiresLabel: string; href: string };
  sites: Site[];
  visits: Visit[];
  documents: Array<{ label: string; url: string | null; date: string }>;
}

const qs = () => {
  if (typeof window === "undefined") return "";
  const p = new URLSearchParams(window.location.search).get("preview");
  return p ? `?preview=${p}` : "";
};
const money = (c: number | null | undefined) => (c != null ? `$${(Number(c) / 100).toFixed(2)}` : "—");
const fmt = (d?: string | null) => {
  if (!d) return "—";
  return new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
};

export default function CommercialPortal() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [tab, setTab] = useState<"account" | "visits" | "billing" | "documents" | "requests">("account");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      const preview = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("preview") : null;
      if (preview) params.set("preview", preview);
      if (siteId) params.set("siteId", siteId);
      const res = await fetch(`/api/partner-portal/commercial${params.toString() ? `?${params}` : ""}`);
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "Couldn't load your account.");
      setData(json as Data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load your account.");
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) {
    return (
      <div className="flex justify-center py-16">
        <RiLoader4Line className="h-8 w-8 animate-spin text-[#5C0FFE]" />
      </div>
    );
  }
  if (!data) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-slate-500">
          No commercial account is linked to this login.
        </CardContent>
      </Card>
    );
  }

  const selected = data.sites.find((s) => s.id === siteId) || null;
  const visits = selected ? data.visits.filter((v) => v.siteId === selected.id) : data.visits;
  const upcoming = visits.filter((v) => (v.serviceDate || "") >= new Date().toISOString().slice(0, 10) && v.status !== "cancelled");
  const past = visits.filter((v) => v.status === "completed" || (v.serviceDate || "") < new Date().toISOString().slice(0, 10));

  return (
    <div className="space-y-5">
      <div className="rounded-2xl p-6 text-white" style={{ background: PURPLE }}>
        <p className="text-xs uppercase tracking-wide text-white/70">
          {data.account.accountType === "office" ? "Office partner" : "Commercial partner"}
        </p>
        <h1 className="mt-1 text-2xl font-bold">{data.account.businessName}</h1>
        <p className="mt-1 text-sm text-white/80">
          {data.account.siteCount} site{data.account.siteCount === 1 ? "" : "s"} · {data.account.upcomingThisPeriod} visits
          this period · {data.account.frequency || "scheduled from your agreement"}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge className="border-0 bg-white/20 text-white">{data.account.status}</Badge>
          <Badge className="border-0 bg-white/20 text-white">
            COI {data.coi.status === "current" ? "current" : data.coi.status}
          </Badge>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto">
        {(
          [
            ["account", "Account"],
            ["visits", "Scheduled visits"],
            ["billing", "Billing"],
            ["documents", "Documents"],
            ["requests", "Requests"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium",
              tab === id ? "bg-[#5C0FFE] text-white" : "bg-white text-slate-600 border border-slate-200",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "account" && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Commercial service is contract-based. Visits are generated from your signed agreement&apos;s frequency —
            you don&apos;t request each one the way a host requests a turnover.
          </p>
          {data.sites.length > 1 && (
            <div className="grid gap-2 sm:grid-cols-2">
              {data.sites.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    setSiteId(s.id);
                    setTab("visits");
                  }}
                  className="rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-violet-300"
                >
                  <p className="font-semibold flex items-center gap-1.5">
                    <RiBuilding2Line className="h-4 w-4 text-[#5C0FFE]" />
                    {s.nickname}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {s.facilityType || "—"} · {s.scopeLevel || "scope on file"}
                    {s.sqft ? ` · ${s.sqft.toLocaleString()} sqft` : ""}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {s.address}
                    {s.city ? `, ${s.city}` : ""} · {s.upcomingCount} upcoming
                  </p>
                  <ZoneStrip zones={s.zones} />
                </button>
              ))}
            </div>
          )}
          {data.sites.length === 1 && (
            <Card>
              <CardContent className="p-4">
                <p className="font-semibold">{data.sites[0].nickname}</p>
                <p className="text-xs text-slate-500">
                  {data.sites[0].facilityType} · {data.sites[0].scopeLevel}
                  {data.sites[0].serviceWindowStart
                    ? ` · window ${data.sites[0].serviceWindowStart}–${data.sites[0].serviceWindowEnd}`
                    : ""}
                </p>
                <ZoneStrip zones={data.sites[0].zones} />
              </CardContent>
            </Card>
          )}
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <RiShieldCheckLine className="h-5 w-5 text-emerald-500" />
              <div>
                <p className="text-sm font-semibold">Certificate of Insurance</p>
                <p className="text-xs text-slate-500">
                  {data.coi.status === "current"
                    ? `Current — through ${data.coi.expiresLabel}`
                    : data.coi.status === "expiring"
                      ? `Expiring ${data.coi.expiresLabel}`
                      : "Needs attention"}
                </p>
              </div>
              <div className="ml-auto">
                <CompanyCoiDownloadLink>Download</CompanyCoiDownloadLink>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "visits" && (
        <section className="space-y-3">
          {data.sites.length > 1 && (
            <div className="flex flex-wrap gap-2">
              <button
                className={cn("rounded-full px-3 py-1 text-xs", !siteId ? "bg-[#5C0FFE] text-white" : "border")}
                onClick={() => setSiteId(null)}
              >
                All sites
              </button>
              {data.sites.map((s) => (
                <button
                  key={s.id}
                  className={cn("rounded-full px-3 py-1 text-xs", siteId === s.id ? "bg-[#5C0FFE] text-white" : "border")}
                  onClick={() => setSiteId(s.id)}
                >
                  {s.nickname}
                </button>
              ))}
            </div>
          )}
          <h2 className="font-bold flex items-center gap-1.5">
            <RiCalendarCheckLine className="h-4 w-4 text-[#5C0FFE]" /> Upcoming (already scheduled)
          </h2>
          {upcoming.length === 0 && (
            <Card>
              <CardContent className="p-6 text-center text-sm text-slate-500">
                No upcoming visits on the calendar yet.
              </CardContent>
            </Card>
          )}
          {upcoming.map((v) => (
            <VisitRow key={v.id} v={v} />
          ))}
          <h2 className="font-bold">Past visits</h2>
          {past.slice(0, 12).map((v) => (
            <VisitRow key={v.id} v={v} />
          ))}
        </section>
      )}

      {tab === "billing" && (
        <section className="space-y-3">
          <Card>
            <CardContent className="p-5">
              <p className="font-semibold flex items-center gap-1.5">
                <RiMoneyDollarCircleLine className="h-4 w-4 text-[#5C0FFE]" />
                {data.billing.method === "invoiced" ? "Invoiced account" : "Stripe Pre-Auth / Auto-Pay"}
              </p>
              {data.billing.method === "auto_pay" ? (
                <p className="mt-1 text-sm text-slate-500">
                  Payment method on file: {data.billing.cardOnFile ? "Yes" : "Not yet"}. Charge history below is per
                  completed visit.
                </p>
              ) : (
                <p className="mt-1 text-sm text-slate-500">
                  Net terms {data.billing.netTerms || "on file"}
                  {data.billing.invoiceCycle ? ` · ${data.billing.invoiceCycle}` : ""}.
                </p>
              )}
              {data.account.contractValueCents != null && (
                <p className="mt-2 text-sm">Contract per-visit value: {money(data.account.contractValueCents)}</p>
              )}
            </CardContent>
          </Card>
          {(data.billing.method === "invoiced" ? data.billing.invoices : data.billing.charges).map((row) => (
            <Card key={row.id}>
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <p className="text-sm font-medium">{fmt(row.date)}</p>
                  <p className="text-xs text-slate-500">{money(row.amountCents)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge className="border-0 bg-slate-100">{row.status}</Badge>
                  {row.url && (
                    <a href={row.url} className="text-xs font-semibold text-[#5C0FFE]" target="_blank" rel="noreferrer">
                      Invoice
                    </a>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {tab === "documents" && (
        <section className="space-y-2">
          {data.documents.map((d, i) => (
            <Card key={i}>
              <CardContent className="flex items-center gap-3 p-4">
                <RiFileTextLine className="h-4 w-4 text-[#5C0FFE]" />
                <span className="text-sm">{d.label}</span>
                {d.url && (
                  <a href={d.url} className="ml-auto text-xs font-semibold text-[#5C0FFE]" target="_blank" rel="noreferrer">
                    Download
                  </a>
                )}
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {tab === "requests" && <CommercialRequests sites={data.sites} onDone={load} />}
    </div>
  );
}

function ZoneStrip({ zones }: { zones?: Site["zones"] }) {
  if (!zones?.length) return null;
  return (
    <div className="mt-3 space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-700">Zone-by-zone</p>
      {zones.map((z) => (
        <div key={z.id} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-800">{z.name}</p>
            <span
              className={cn(
                "text-[10px] font-semibold uppercase tracking-wide",
                z.status === "complete"
                  ? "text-emerald-700"
                  : z.status === "partial"
                    ? "text-amber-700"
                    : z.status === "not_done"
                      ? "text-rose-700"
                      : "text-slate-400",
              )}
            >
              {z.status === "complete"
                ? "complete"
                : z.status === "partial"
                  ? "partial"
                  : z.status === "not_done"
                    ? "not done"
                    : "awaiting visit"}
            </span>
          </div>
          {(z.before.length > 0 || z.after.length > 0) && (
            <div className="mt-1.5 grid grid-cols-4 gap-1">
              {z.before.slice(0, 2).map((u) => (
                <a key={u} href={u} target="_blank" rel="noreferrer" className="relative">
                  <img src={u} alt={`${z.name} before`} className="h-12 w-full object-cover rounded border border-slate-200" />
                  <span className="absolute bottom-0.5 left-0.5 text-[8px] font-bold bg-black/60 text-white px-1 rounded">Before</span>
                </a>
              ))}
              {z.after.slice(0, 2).map((u) => (
                <a key={u} href={u} target="_blank" rel="noreferrer" className="relative">
                  <img src={u} alt={`${z.name} after`} className="h-12 w-full object-cover rounded border border-slate-200" />
                  <span className="absolute bottom-0.5 left-0.5 text-[8px] font-bold bg-black/60 text-white px-1 rounded">After</span>
                </a>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function VisitRow({ v }: { v: Visit }) {
  const photos = (v.beforePhotos?.length || 0) + (v.afterPhotos?.length || 0);
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-semibold">{fmt(v.serviceDate)}</p>
            <p className="text-xs text-slate-500">
              {v.timeSlot || v.arrivalWindow || ""} · {v.address}
              {v.city ? `, ${v.city}` : ""}
            </p>
          </div>
          <Badge className="border-0 bg-violet-100 text-violet-700">{v.status}</Badge>
        </div>
        {v.isRecurring && <p className="mt-1 text-xs text-slate-400">Generated from agreement frequency ({v.frequency})</p>}
        {photos > 0 && <p className="mt-2 text-xs text-slate-500">{photos} documentation photo{photos === 1 ? "" : "s"} on file</p>}
        {v.invoiceUrl && (
          <a href={v.invoiceUrl} className="mt-2 inline-block text-xs font-semibold text-[#5C0FFE]" target="_blank" rel="noreferrer">
            Invoice
          </a>
        )}
      </CardContent>
    </Card>
  );
}

function CommercialRequests({ sites, onDone }: { sites: Site[]; onDone: () => void }) {
  const [kind, setKind] = useState<"additional_site" | "additional_service" | "schedule_change" | "report_issue">(
    "schedule_change",
  );
  const [message, setMessage] = useState("");
  const [address, setAddress] = useState("");
  const [title, setTitle] = useState("");
  const [siteId, setSiteId] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const action =
        kind === "report_issue"
          ? "report_issue"
          : kind === "additional_site"
            ? "request_additional_site"
            : kind === "additional_service"
              ? "request_additional_service"
              : "request_schedule_change";
      const res = await fetch(`/api/partner-portal/commercial${qs()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, message, address, title, siteId: siteId || undefined }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      toast.success(json.message || "Sent to our team.");
      setMessage("");
      setAddress("");
      setTitle("");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't send that.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <p className="font-semibold">Ask the team — nothing here auto-prices or auto-schedules</p>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["schedule_change", "Schedule change"],
              ["additional_service", "One-time extra visit"],
              ["additional_site", "Additional site"],
              ["report_issue", "Report an issue"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setKind(id)}
              className={cn("rounded-full px-3 py-1 text-xs", kind === id ? "bg-[#5C0FFE] text-white" : "border")}
            >
              {label}
            </button>
          ))}
        </div>
        {sites.length > 0 && kind !== "additional_site" && (
          <select className="w-full rounded-lg border px-3 py-2 text-sm" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
            <option value="">Account / any site</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nickname}
              </option>
            ))}
          </select>
        )}
        {kind === "additional_site" && (
          <Input placeholder="New site address" value={address} onChange={(e) => setAddress(e.target.value)} />
        )}
        {kind === "report_issue" && (
          <Input placeholder="Short title" value={title} onChange={(e) => setTitle(e.target.value)} />
        )}
        <Textarea
          rows={4}
          placeholder={
            kind === "additional_site"
              ? "Anything we should know before walkthrough / pricing"
              : kind === "report_issue"
                ? "What happened, and where"
                : "Describe the change. This does not alter your rate or add a priced visit."
          }
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <Button className="text-white" style={{ background: PURPLE }} disabled={busy} onClick={() => void submit()}>
          {busy ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : kind === "report_issue" ? (
            <span className="inline-flex items-center gap-1">
              <RiAlertLine className="h-4 w-4" /> Send to QC
            </span>
          ) : (
            "Send to admin"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
