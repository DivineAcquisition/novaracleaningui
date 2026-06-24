"use client";

// ─── Open weekly scheduler (token link, no login) ─────────────────────────────
//
// Hosts open this from the SMS/email link admin sends. They pick which days
// each property needs a turnover this week, choose a payment option, and check
// out. Authenticated only by the hosts.calendar_token in the URL.

import { useEffect, useMemo, useState } from "react";
import { RiLoader4Line, RiCalendarCheckLine, RiCheckLine } from "@remixicon/react";

interface Property { id: string; nickname: string | null; address: string | null; turnover_price: number | null; }
interface Existing { property_id: string; requested_date: string; status: string; }

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const fmtDay = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export default function OpenScheduler({ token }: { token: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hostName, setHostName] = useState("");
  const [weekStart, setWeekStart] = useState("");
  const [properties, setProperties] = useState<Property[]>([]);
  const [existing, setExisting] = useState<Existing[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({}); // `${propId}|${date}`
  const [start, setStart] = useState("11:00");
  const [end, setEnd] = useState("15:00");
  const [payOption, setPayOption] = useState<"full" | "split">("full");
  const [submitting, setSubmitting] = useState(false);

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
  const existingSet = useMemo(
    () => new Set(existing.map((e) => `${e.property_id}|${e.requested_date}`)),
    [existing],
  );

  const toggle = (propId: string, date: string) => {
    const key = `${propId}|${date}`;
    if (existingSet.has(key)) return; // already scheduled
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
      if (!res.ok || !data?.url) throw new Error(data?.error || "Could not start checkout");
      window.location.href = data.url;
    } catch (e) {
      setError((e as Error).message);
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><RiLoader4Line className="w-8 h-8 animate-spin text-[#5C0FFE]" /></div>;
  }
  if (error && properties.length === 0) {
    return <div className="min-h-screen flex items-center justify-center p-6 text-center text-slate-600">{error}</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-3xl mx-auto space-y-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <RiCalendarCheckLine className="w-6 h-6 text-[#5C0FFE]" /> Schedule your week
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {hostName ? `Hi ${hostName.split(" ")[0]} — ` : ""}pick the days each property needs a turnover (week of {fmtDay(weekStart)}).
          </p>
        </div>

        {properties.length === 0 && (
          <div className="rounded-lg border bg-white p-4 text-sm text-slate-600">
            No priced properties yet — your account manager is setting your rates.
          </div>
        )}

        {properties.map((p) => (
          <div key={p.id} className="rounded-xl border bg-white p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="min-w-0">
                <p className="font-semibold truncate">{p.nickname || "Property"}</p>
                <p className="text-xs text-slate-500 truncate">{p.address}</p>
              </div>
              <span className="text-sm font-bold text-[#5C0FFE]">${Number(p.turnover_price).toFixed(0)}/turnover</span>
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
                    className={`flex flex-col items-center rounded-lg border py-2 text-xs transition-colors ${
                      already
                        ? "bg-emerald-50 border-emerald-200 text-emerald-700 cursor-default"
                        : on
                          ? "bg-[#5C0FFE] border-[#5C0FFE] text-white"
                          : "bg-white border-slate-200 hover:bg-slate-50 text-slate-600"
                    }`}
                    title={already ? "Already scheduled" : ""}
                  >
                    <span className="font-semibold">{DOW[i]}</span>
                    <span>{fmtDay(date).split(" ")[1]}</span>
                    {already && <RiCheckLine className="w-3 h-3 mt-0.5" />}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {properties.length > 0 && (
          <div className="rounded-xl border bg-white p-4 space-y-4 sticky bottom-4 shadow-lg">
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">Guest checkout time
                <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5" />
              </label>
              <label className="text-sm">Next check-in by
                <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5" />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {([
                { key: "full", title: "Pay in full", sub: "100% now" },
                { key: "split", title: "Split 50/50", sub: "50% now · 50% per turnover on completion" },
              ] as const).map((o) => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => setPayOption(o.key)}
                  className={`rounded-lg border p-2.5 text-left ${payOption === o.key ? "border-[#5C0FFE] bg-[#5C0FFE]/5" : "border-slate-200"}`}
                >
                  <span className="block text-sm font-medium">{o.title}</span>
                  <span className="block text-[11px] text-slate-500">{o.sub}</span>
                </button>
              ))}
            </div>
            {error && <p className="text-xs text-rose-600">{error}</p>}
            <button
              onClick={submit}
              disabled={submitting || chosen.length === 0}
              className="w-full h-11 rounded-lg bg-[#5C0FFE] text-white font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting ? <RiLoader4Line className="w-4 h-4 animate-spin" /> : `Schedule ${chosen.length} turnover${chosen.length === 1 ? "" : "s"} · pay $${dueNow.toFixed(0)} now`}
            </button>
            <p className="text-[11px] text-center text-slate-400">
              {payOption === "split" ? "The remaining 50% of each turnover is charged automatically when it's completed." : "Secure checkout via Stripe. Your card is saved for one-tap rebooking."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
