"use client";

import { useCallback, useEffect, useState } from "react";
import {
  RiAddLine,
  RiCalendarEventLine,
  RiFileTextLine,
  RiHome4Line,
  RiImage2Line,
  RiLoader4Line,
  RiMoneyDollarCircleLine,
  RiAlertLine,
} from "@remixicon/react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmbeddedCardForm } from "@/components/token/EmbeddedCardForm";
import { cn } from "@/lib/utils";

const PURPLE = "linear-gradient(135deg,#5C0FFE 0%,#8F7BFD 100%)";

type Tab = "overview" | "properties" | "turnovers" | "payment" | "documents" | "issue";

interface Property {
  id: string;
  nickname: string | null;
  address: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  turnoverPrice: number | null;
  rateEditable: false;
}
interface Fee {
  tier: string;
  hoursOut: number;
  feeCents: number;
  creditCents: number;
  feePercent: number;
  label: string;
  summary: string;
}
interface Turnover {
  id: string;
  propertyId: string;
  requestedDate: string;
  windowStart: string | null;
  windowEnd: string | null;
  price: number;
  status: string;
  statusLabel: string;
  paymentOption: string;
  beforePhotos: string[];
  afterPhotos: string[];
  invoiceUrl: string | null;
  cancelFee: Fee | null;
  completedAt: string | null;
}
interface HostData {
  host: {
    name: string | null;
    status: string;
    paymentOption: string | null;
    cardOnFile: boolean;
    paymentBrand?: string | null;
    paymentLast4?: string | null;
    canUpdatePayment?: boolean;
  };
  properties: Property[];
  turnovers: Turnover[];
  documents: Array<{ label: string; url: string | null; date: string }>;
}

const qs = () =>
  typeof window !== "undefined" && new URLSearchParams(window.location.search).get("preview")
    ? `?preview=${new URLSearchParams(window.location.search).get("preview")}`
    : "";

export default function HostPortalView() {
  const [tab, setTab] = useState<Tab>("overview");
  const [data, setData] = useState<HostData | null>(null);
  const [loading, setLoading] = useState(true);
  const [requestFor, setRequestFor] = useState<Property | null>(null);
  const [cancelFor, setCancelFor] = useState<Turnover | null>(null);
  const [photosFor, setPhotosFor] = useState<Turnover | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [cardEmbed, setCardEmbed] = useState<{ clientSecret: string; amountCents: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
      const preview = params.get("preview");
      if (!preview) {
        const sessionId = params.get("session_id");
        if (params.get("turnover") === "paid" && sessionId) {
          await fetch("/api/partner-portal/host", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "finalize_turnover", sessionId }),
          });
        }
        if (params.get("payment") === "updated" || params.get("payment_intent")) {
          await fetch("/api/partner-portal/host", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "refresh_payment",
              sessionId: params.get("payment_intent") || params.get("session_id"),
            }),
          });
          toast.success("Payment method updated.");
        }
        if (params.get("turnover") === "paid" || params.get("payment") || params.get("payment_intent")) {
          const next = new URL(window.location.href);
          next.searchParams.delete("turnover");
          next.searchParams.delete("payment");
          next.searchParams.delete("session_id");
          next.searchParams.delete("payment_intent");
          window.history.replaceState({}, "", next.pathname + (next.search ? next.search : ""));
        }
      }
      const res = await fetch(`/api/partner-portal/host${qs()}`);
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "Couldn't load your host account.");
      setData(json as HostData);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load your host account.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function startCardUpdate() {
    try {
      const res = await fetch(`/api/partner-portal/host${qs()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_payment_method" }),
      });
      const json = await res.json();
      if (json.preview) {
        toast.success(json.message || "Preview only — not saved.");
        return;
      }
      if (!json.ok || !json.clientSecret) throw new Error(json.error || "Couldn't open card setup.");
      setCardEmbed({ clientSecret: String(json.clientSecret), amountCents: Number(json.amountCents || 100) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't open card setup.");
    }
  }

  const nameOf = (id: string) =>
    data?.properties.find((p) => p.id === id)?.nickname || data?.properties.find((p) => p.id === id)?.address || "Property";

  if (loading || !data) {
    return (
      <div className="flex justify-center py-16">
        <RiLoader4Line className="h-8 w-8 animate-spin text-[#5C0FFE]" />
      </div>
    );
  }

  const upcoming = data.turnovers.filter((t) => t.status !== "cancelled" && t.status !== "completed");
  const past = data.turnovers.filter((t) => t.status === "completed" || t.status === "cancelled");
  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "properties", label: "Properties" },
    { id: "turnovers", label: "Turnovers" },
    { id: "payment", label: "Payment" },
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
              tab === t.id ? "bg-[#5C0FFE] text-white" : "bg-white text-slate-600 border border-slate-200",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label="Properties" value={String(data.properties.length)} />
            <Kpi label="Upcoming" value={String(upcoming.length)} />
            <Kpi label="Payment" value={payLabel(data.host.paymentOption)} />
            <Kpi label="Card on file" value={cardLabel(data.host)} />
          </div>
          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-slate-600">
                Host turnovers are request-based. Nothing is scheduled until you ask for one against the Company-set
                per-turnover rate.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" style={{ background: PURPLE }} className="text-white" onClick={() => setTab("turnovers")}>
                  <RiCalendarEventLine className="mr-1 h-4 w-4" /> Upcoming turnovers
                </Button>
                <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
                  <RiAddLine className="mr-1 h-4 w-4" /> Request another property
                </Button>
              </div>
            </CardContent>
          </Card>
          {upcoming.slice(0, 3).map((t) => (
            <TurnoverRow
              key={t.id}
              t={t}
              name={nameOf(t.propertyId)}
              onCancel={() => setCancelFor(t)}
              onPhotos={() => setPhotosFor(t)}
            />
          ))}
        </div>
      )}

      {tab === "properties" && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-bold">Registered properties</h2>
            <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
              Request additional property
            </Button>
          </div>
          {data.properties.map((p) => (
            <Card key={p.id}>
              <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div>
                  <p className="font-semibold flex items-center gap-1.5">
                    <RiHome4Line className="h-4 w-4 text-[#5C0FFE]" />
                    {p.nickname || "Property"}
                  </p>
                  <p className="text-xs text-slate-500">{p.address}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {p.bedrooms ?? "—"} BR · {p.bathrooms ?? "—"} BA
                  </p>
                </div>
                <div className="text-right">
                  {p.turnoverPrice != null ? (
                    <p className="font-bold text-[#5C0FFE]">
                      ${Number(p.turnoverPrice).toFixed(0)}
                      <span className="text-[11px] font-medium text-slate-400">/turnover</span>
                    </p>
                  ) : (
                    <Badge className="border-0 bg-amber-100 text-amber-700">Pending Company pricing</Badge>
                  )}
                  <p className="mt-1 text-[11px] text-slate-400">Rate is Company-set · read only</p>
                  <Button
                    size="sm"
                    className="mt-2 text-white"
                    style={{ background: PURPLE }}
                    disabled={p.turnoverPrice == null}
                    onClick={() => setRequestFor(p)}
                  >
                    Request a turnover
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {tab === "turnovers" && (
        <section className="space-y-4">
          <h2 className="font-bold">Upcoming</h2>
          {upcoming.length === 0 && <Empty>No upcoming turnovers. Request one from a priced property.</Empty>}
          {upcoming.map((t) => (
            <TurnoverRow
              key={t.id}
              t={t}
              name={nameOf(t.propertyId)}
              onCancel={() => setCancelFor(t)}
              onPhotos={() => setPhotosFor(t)}
            />
          ))}
          <h2 className="font-bold">Past</h2>
          {past.length === 0 && <Empty>No completed turnovers yet.</Empty>}
          {past.map((t) => (
            <TurnoverRow
              key={t.id}
              t={t}
              name={nameOf(t.propertyId)}
              onCancel={() => setCancelFor(t)}
              onPhotos={() => setPhotosFor(t)}
            />
          ))}
        </section>
      )}

      {tab === "payment" && (
        <section className="space-y-3">
          <Card>
            <CardContent className="p-5">
              <p className="font-semibold flex items-center gap-1.5">
                <RiMoneyDollarCircleLine className="h-4 w-4 text-[#5C0FFE]" /> Section 6.2 payment option
              </p>
              <p className="mt-1 text-sm text-slate-600">{payLabel(data.host.paymentOption)}</p>
              <p className="mt-2 text-sm text-slate-500">Payment method: {cardLabel(data.host)}</p>
              <p className="mt-1 text-xs text-slate-400">
                Rates are Company-set. Updating the card on file does not change a per-turnover rate.
              </p>
              <Button
                size="sm"
                className="mt-3 text-white"
                style={{ background: PURPLE }}
                onClick={() => void startCardUpdate()}
              >
                {data.host.cardOnFile ? "Update payment method" : "Add payment method"}
              </Button>
              {cardEmbed && (
                <div className="mt-4">
                  <EmbeddedCardForm
                    clientSecret={cardEmbed.clientSecret}
                    amountCents={cardEmbed.amountCents}
                    returnUrl={typeof window !== "undefined" ? window.location.href.split("#")[0] : ""}
                    submitLabel="Submit card and place Pre-Auth hold"
                    onConfirmed={async (paymentIntentId) => {
                      await fetch("/api/partner-portal/host", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "refresh_payment", sessionId: paymentIntentId }),
                      });
                      setCardEmbed(null);
                      toast.success("Payment method updated.");
                      await load();
                    }}
                  />
                </div>
              )}
            </CardContent>
          </Card>
          <h3 className="font-semibold">Per-turnover invoices</h3>
          {data.turnovers.filter((t) => t.invoiceUrl).length === 0 && <Empty>Invoices appear here after a turnover is billed.</Empty>}
          {data.turnovers
            .filter((t) => t.invoiceUrl)
            .map((t) => (
              <Card key={t.id}>
                <CardContent className="flex items-center justify-between p-4">
                  <span className="text-sm">
                    {t.requestedDate} · {nameOf(t.propertyId)} · ${t.price}
                  </span>
                  <a href={t.invoiceUrl!} className="text-sm font-semibold text-[#5C0FFE]" target="_blank" rel="noreferrer">
                    Receipt
                  </a>
                </CardContent>
              </Card>
            ))}
        </section>
      )}

      {tab === "documents" && (
        <section className="space-y-2">
          {data.documents.length === 0 && <Empty>Your signed agreement and rate schedule will appear here.</Empty>}
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

      {tab === "issue" && <IssueForm onDone={load} />}

      {requestFor && <RequestModal property={requestFor} onClose={() => setRequestFor(null)} onDone={() => { setRequestFor(null); void load(); }} />}
      {cancelFor && <CancelModal turnover={cancelFor} onClose={() => setCancelFor(null)} onDone={() => { setCancelFor(null); void load(); }} />}
      {photosFor && <PhotosModal turnover={photosFor} onClose={() => setPhotosFor(null)} />}
      {addOpen && <AddPropertyModal onClose={() => setAddOpen(false)} onDone={() => { setAddOpen(false); }} />}
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
function payLabel(option: string | null | undefined) {
  if (option === "split") return "Split Payment";
  if (option === "pay_after") return "Pay After (Card on File)";
  if (option === "full") return "Pay in Full";
  return "Not selected yet";
}
function cardLabel(host: HostData["host"]) {
  if (host.paymentLast4) {
    const brand = host.paymentBrand ? host.paymentBrand.charAt(0).toUpperCase() + host.paymentBrand.slice(1) : "Card";
    return `${brand} •••• ${host.paymentLast4}`;
  }
  return host.cardOnFile ? "On file" : "Not yet";
}

function TurnoverRow({
  t,
  name,
  onCancel,
  onPhotos,
}: {
  t: Turnover;
  name: string;
  onCancel: () => void;
  onPhotos: () => void;
}) {
  const photos = (t.beforePhotos?.length || 0) + (t.afterPhotos?.length || 0);
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-semibold">{name}</p>
            <p className="text-xs text-slate-500">
              {t.requestedDate}
              {t.windowStart ? ` · checkout ${t.windowStart}` : ""}
              {t.windowEnd ? ` · next check-in ${t.windowEnd}` : ""}
            </p>
          </div>
          <Badge className="border-0 bg-violet-100 text-violet-700">{t.statusLabel}</Badge>
        </div>
        <p className="mt-2 text-sm font-medium">${t.price} · {payLabel(t.paymentOption)}</p>
        {t.cancelFee && t.status !== "cancelled" && t.status !== "completed" && (
          <p className="mt-1 text-xs text-slate-500">{t.cancelFee.summary}</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {photos > 0 && (
            <Button size="sm" variant="outline" onClick={onPhotos}>
              <RiImage2Line className="mr-1 h-3.5 w-3.5" /> Before / after
            </Button>
          )}
          {t.invoiceUrl && (
            <a href={t.invoiceUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold text-[#5C0FFE] self-center">
              Invoice
            </a>
          )}
          {t.status !== "cancelled" && t.status !== "completed" && (
            <Button size="sm" variant="outline" onClick={onCancel}>
              Cancel / reschedule
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function RequestModal({ property, onClose, onDone }: { property: Property; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState("");
  const [checkout, setCheckout] = useState("");
  const [checkin, setCheckin] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/partner-portal/host${qs()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "request_turnover",
          propertyId: property.id,
          requestedDate: date,
          windowStart: checkout,
          windowEnd: checkin,
        }),
      });
      const json = await res.json();
      if (json.preview) {
        toast.success(json.message || "Preview only — not saved.");
        onDone();
        return;
      }
      if (!json.ok) throw new Error(json.error);
      if (json.checkoutUrl) {
        window.location.href = json.checkoutUrl;
        return;
      }
      if (json.needsSetup) {
        toast.error(json.error || "Save a payment method first.");
        return;
      }
      toast.success(json.scheduled ? "Turnover booked." : "Turnover requested.");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't request that turnover.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Request a turnover" onClose={onClose}>
      <p className="text-sm text-slate-500">{property.nickname || property.address}</p>
      <p className="text-sm font-medium">${property.turnoverPrice}/turnover (Company-set, read-only)</p>
      <label className="mt-3 block text-sm">
        Checkout date
        <Input type="date" className="mt-1" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="text-sm">
          Checkout time
          <Input type="time" className="mt-1" value={checkout} onChange={(e) => setCheckout(e.target.value)} />
        </label>
        <label className="text-sm">
          Next check-in
          <Input type="time" className="mt-1" value={checkin} onChange={(e) => setCheckin(e.target.value)} />
        </label>
      </div>
      <Button className="mt-4 w-full text-white" style={{ background: PURPLE }} disabled={busy || !date} onClick={() => void submit()}>
        {busy ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : "Submit request"}
      </Button>
    </Modal>
  );
}

function CancelModal({ turnover, onClose, onDone }: { turnover: Turnover; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const fee = turnover.cancelFee;
  const act = async (action: "cancel" | "reschedule") => {
    setBusy(true);
    try {
      const res = await fetch(`/api/partner-portal/host${qs()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, turnoverId: turnover.id, requestedDate: date }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      toast.success(action === "cancel" ? "Cancelled." : "Rescheduled.");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update that turnover.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Cancel or reschedule" onClose={onClose}>
      {fee && (
        <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">{fee.label}</p>
          <p className="mt-1">{fee.summary}</p>
        </div>
      )}
      <label className="mt-3 block text-sm">
        New date (reschedule)
        <Input type="date" className="mt-1" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <div className="mt-4 flex gap-2">
        <Button variant="outline" disabled={busy || !date} onClick={() => void act("reschedule")}>
          Reschedule
        </Button>
        <Button className="text-white bg-rose-600 hover:bg-rose-700" disabled={busy} onClick={() => void act("cancel")}>
          Cancel turnover
        </Button>
      </div>
    </Modal>
  );
}

function PhotosModal({ turnover, onClose }: { turnover: Turnover; onClose: () => void }) {
  return (
    <Modal title="Before / after documentation" onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
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

function AddPropertyModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [address, setAddress] = useState("");
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/partner-portal/host${qs()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request_additional_property", address, nickname }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      toast.success(json.message || "Sent to our team.");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't send that request.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Request an additional property" onClose={onClose}>
      <p className="text-sm text-slate-500">
        This goes to our team for Section 5 pricing. It is not added or priced from here.
      </p>
      <Input className="mt-3" placeholder="Nickname (optional)" value={nickname} onChange={(e) => setNickname(e.target.value)} />
      <Input className="mt-2" placeholder="Address" value={address} onChange={(e) => setAddress(e.target.value)} />
      <Button className="mt-4 w-full text-white" style={{ background: PURPLE }} disabled={busy || address.length < 5} onClick={() => void submit()}>
        {busy ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : "Send to admin"}
      </Button>
    </Modal>
  );
}

function IssueForm({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/partner-portal/host${qs()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "report_issue", title, description }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      toast.success("Issue sent to QC.");
      setTitle("");
      setDescription("");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't file that issue.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <p className="font-semibold flex items-center gap-1.5">
          <RiAlertLine className="h-4 w-4 text-[#5C0FFE]" /> Report an issue
        </p>
        <p className="text-sm text-slate-500">This feeds the same QC system as every other complaint channel.</p>
        <Input placeholder="Short title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Textarea rows={4} placeholder="What happened?" value={description} onChange={(e) => setDescription(e.target.value)} />
        <Button className="text-white" style={{ background: PURPLE }} disabled={busy || !title.trim()} onClick={() => void submit()}>
          {busy ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : "Send to QC"}
        </Button>
      </CardContent>
    </Card>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
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
