"use client";

// ─── Open weekly scheduler (token link, no login) ─────────────────────────────
//
// Premium, mobile-first scheduler hosts open from the SMS/email link admin
// sends. They pick which days each property needs a turnover this week, choose
// a payment option, and submit — we invoice each turnover via Stripe (the card
// is saved on payment; the turnover books + lands on the calendar once paid).

import { useEffect, useMemo, useState } from "react";
import {
  RiLoader4Line, RiCalendarCheckLine, RiCheckLine, RiMailSendLine,
  RiArrowRightLine, RiShieldCheckLine, RiHome3Line,
} from "@remixicon/react";

interface Property { id: string; nickname: string | null; address: string | null; turnover_price: number | null; }
interface Existing { property_id: string; requested_date: string; status: string; }
interface InvoiceResult { turnoverId: string; date: string; property: string; amountCents?: number; url?: string | null; error?: string }

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const RAMP = "linear-gradient(135deg,#5C0FFE 0%,#8F7BFD 100%)";

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const fmtDay = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export default function OpenScheduler({ token }: { token: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hostName, setHostName] = useState("");
  const [weekStart, setWeekStart] = useState("");
  const [properties, setProperties] = useState<Property[]>([]);
  const [existing, setExisting] = useState<Existing[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [start, setStart] = useState("11:00");
  const [end, setEnd] = useState("15:00");
  const [payOption, setPayOption] = useState<"full" | "split">("full");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState<InvoiceResult[] | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/partner-schedule/${token}`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Could not load scheduler");
        setHostName(data.host?.name || "");
        setWeekStart(data.weekStart);
        setProperties(data.properties || []);
        setExisting(data.existing || []);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const days = useMemo(() => (weekStart ? DOW.map((_, i) => addDays(weekStart, i)) : []), [weekStart]);
  const existingSet = useMemo(() => new Set(existing.map((e) => `${e.property_id}|${e.requested_date}`)), [existing]);

  const toggle = (propId: string, date: string) => {
    const key = `${propId}|${date}`;
    if (existingSet.has(key)) return;
    setSelected((s) => ({ ...s, [key]: !s[key] }));
  };

  const chosen = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);
  const total = useMemo(() => {
    let t = 0;
    for (const k of chosen) {
      const [propId] = k.split("|");
      const p = properties.find((x) => x.id === propId);
      if (p?.turnover_price) t += Number(p.turnover_price);
    }
    return t;
  }, [chosen, properties]);
  const dueNow = payOption === "split" ? total / 2 : total;

  const submit = async () => {
    if (chosen.length === 0) { setError("Pick at least one turnover."); return; }
    setSubmitting(true);
    setError(null);
    try {
      const items = chosen.map((k) => {
        const [propertyId, date] = k.split("|");
        return { propertyId, date, window_start: start, window_end: end };
      });
      const res = await fetch(`/api/partner-schedule/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, paymentOption: payOption }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not send invoices");
      setSent(data.invoices || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Loading / error / sent states ──────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <RiLoader4Line className="w-8 h-8 animate-spin text-[#5C0FFE]" />
      </div>
    );
  }
  if (error && properties.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center text-slate-600 bg-slate-50">{error}</div>
    );
  }

  if (sent) {
    const okInvoices = sent.filter((s) => !s.error);
    return (
      <div className="min-h-screen bg-slate-50">
        <Hero hostName={hostName} weekStart={weekStart} />
        <div className="max-w-2xl mx-auto px-4 -mt-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm text-center">
            <div className="mx-auto w-12 h-12 rounded-full flex items-center justify-center mb-3" style={{ background: "rgba(92,15,254,0.1)" }}>
              <RiMailSendLine className="w-6 h-6 text-[#5C0FFE]" />
            </div>
            <h2 className="text-xl font-bold">{okInvoices.length} invoice{okInvoices.length === 1 ? "" : "s"} sent</h2>
            <p className="text-sm text-slate-500 mt-1">
              We emailed an invoice for each turnover. Pay it to confirm — your card is saved for the rest of the week.
            </p>
            <div className="mt-4 space-y-2 text-left">
              {sent.map((inv) => (
                <div key={inv.turnoverId} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{inv.property} · {fmtDay(inv.date)}</p>
                    <p className="text-[11px] text-slate-500">{inv.error ? `Issue: ${inv.error}` : inv.amountCents != null ? `${money(inv.amountCents / 100)} due` : ""}</p>
                  </div>
                  {inv.url && (
                    <a href={inv.url} target="_blank" rel="noreferrer" className="shrink-0 inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ background: RAMP }}>
                      Pay <RiArrowRightLine className="w-3 h-3" />
                    </a>
                  )}
                </div>
              ))}
            </div>
            <button onClick={() => { setSent(null); setSelected({}); }} className="mt-5 text-sm font-medium text-[#5C0FFE] hover:underline">
              Schedule more
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Main scheduler ──────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50 pb-40">
      <Hero hostName={hostName} weekStart={weekStart} />

      <div className="max-w-2xl mx-auto px-4 -mt-6 space-y-4">
        {properties.length === 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
            No priced properties yet — your account manager is setting your rates. Check back soon.
          </div>
        )}

        {properties.map((p) => {
          const count = days.filter((d) => selected[`${p.id}|${d}`]).length;
          return (
            <div key={p.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(92,15,254,0.08)" }}>
                    <RiHome3Line className="w-5 h-5 text-[#5C0FFE]" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold truncate leading-tight">{p.nickname || "Property"}</p>
                    <p className="text-xs text-slate-500 truncate">{p.address}</p>
                  </div>
                </div>
                <span className="text-sm font-bold text-[#5C0FFE] shrink-0">{money(Number(p.turnover_price))}</span>
              </div>
              <div className="grid grid-cols-7 gap-1.5">
                {days.map((date, i) => {
                  const key = `${p.id}|${date}`;
                  const already = existingSet.has(key);
                  const on = !!selected[key];
                  return (
                    <button
                      key={date}
                      type="button"
                      disabled={already}
                      onClick={() => toggle(p.id, date)}
                      className={`flex flex-col items-center rounded-xl border py-2 text-xs transition-all ${
                        already
                          ? "bg-emerald-50 border-emerald-200 text-emerald-700 cursor-default"
                          : on
                            ? "border-transparent text-white shadow-[0_4px_12px_-2px_rgba(92,15,254,0.5)]"
                            : "bg-white border-slate-200 hover:border-[#5C0FFE]/40 text-slate-600"
                      }`}
                      style={on && !already ? { background: RAMP } : undefined}
                    >
                      <span className="font-semibold">{DOW[i]}</span>
                      <span className="tabular-nums">{fmtDay(date).split(" ")[1]}</span>
                      {already ? <RiCheckLine className="w-3 h-3 mt-0.5" /> : <span className="w-3 h-3 mt-0.5" />}
                    </button>
                  );
                })}
              </div>
              {count > 0 && <p className="text-[11px] text-slate-500 mt-2">{count} turnover{count === 1 ? "" : "s"} selected this week</p>}
            </div>
          );
        })}

        {properties.length > 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
            <p className="text-sm font-semibold">Timing</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-medium text-slate-600">Guest checkout time
                <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm" />
              </label>
              <label className="text-xs font-medium text-slate-600">Next check-in by
                <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm" />
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Sticky summary / submit bar */}
      {properties.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur">
          <div className="max-w-2xl mx-auto px-4 py-3 space-y-2.5">
            <div className="grid grid-cols-2 gap-2">
              {([
                { key: "full", title: "Pay in full", sub: "Invoiced 100% now" },
                { key: "split", title: "Split 50/50", sub: "50% now · 50% on completion" },
              ] as const).map((o) => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => setPayOption(o.key)}
                  className={`rounded-xl border p-2.5 text-left transition-colors ${payOption === o.key ? "border-[#5C0FFE] bg-[#5C0FFE]/5" : "border-slate-200"}`}
                >
                  <span className="block text-sm font-semibold">{o.title}</span>
                  <span className="block text-[11px] text-slate-500">{o.sub}</span>
                </button>
              ))}
            </div>
            {error && <p className="text-xs text-rose-600">{error}</p>}
            <button
              onClick={submit}
              disabled={submitting || chosen.length === 0}
              className="w-full h-12 rounded-xl text-white font-semibold disabled:opacity-50 flex items-center justify-center gap-2 shadow-[0_6px_18px_-4px_rgba(92,15,254,0.55)]"
              style={{ background: RAMP }}
            >
              {submitting
                ? <RiLoader4Line className="w-5 h-5 animate-spin" />
                : <>Send {chosen.length || ""} invoice{chosen.length === 1 ? "" : "s"} · {money(dueNow)} due now <RiArrowRightLine className="w-4 h-4" /></>}
            </button>
            <p className="text-[11px] text-center text-slate-400 flex items-center justify-center gap-1">
              <RiShieldCheckLine className="w-3.5 h-3.5" /> Secure Stripe invoices · card saved for the week
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function Hero({ hostName, weekStart }: { hostName: string; weekStart: string }) {
  const weekEnd = weekStart ? addDays(weekStart, 6) : "";
  return (
    <div className="relative overflow-hidden" style={{ background: RAMP }}>
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-20" style={{ background: "radial-gradient(80% 120% at 100% 0%, #fff, transparent 60%)" }} />
      <div className="relative max-w-2xl mx-auto px-4 pt-10 pb-10 text-white">
        <div className="flex items-center gap-2 text-white/80 text-xs font-semibold uppercase tracking-[0.14em]">
          <RiCalendarCheckLine className="w-4 h-4" /> Novara · Weekly Scheduler
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mt-2">
          {hostName ? `Hi ${hostName.split(" ")[0]}, ` : ""}plan your turnovers
        </h1>
        <p className="text-white/80 text-sm mt-1">
          {weekStart ? `Week of ${fmtDay(weekStart)} – ${fmtDay(weekEnd)}. ` : ""}Tap the days each property needs a clean.
        </p>
      </div>
    </div>
  );
}
