"use client";

// ─── Commercial / Office partner portal (partner.novaracleaning.com) ─────────
//
// The least-visibility self-service surface for an approved commercial or
// office partner: THEIR account only — status, setup gates, upcoming visits,
// service history, invoices, signed documents, and a request-changes path.
// No pricing controls, no other partners, no admin tools.
//
// A partner whose onboarding isn't complete (agreement + payment) sees a
// "finish setup" state instead of the full app.

import { useCallback, useEffect, useState } from "react";
import {
  RiBuilding2Line,
  RiCalendarCheckLine,
  RiCheckboxCircleFill,
  RiErrorWarningLine,
  RiFileTextLine,
  RiLoader4Line,
  RiLogoutBoxRLine,
  RiMailSendLine,
  RiMoneyDollarCircleLine,
  RiRefreshLine,
} from "@remixicon/react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const PURPLE_GRADIENT = "linear-gradient(135deg,#5C0FFE 0%,#8F7BFD 100%)";

interface Account {
  id: string;
  business_name: string;
  contact_name: string | null;
  account_type: string;
  facility_type: string | null;
  status: string;
  recurring_frequency: string | null;
  num_locations: number | null;
  agreement_signed: boolean;
  payment_on_file: boolean;
  autopay_enabled: boolean;
  setup_complete: boolean;
}
interface BookingRow {
  id: string;
  booking_number: number | null;
  status: string | null;
  service_date: string | null;
  time_slot: string | null;
  arrival_window: string | null;
  address: string | null;
  city: string | null;
  custom_quote_cents: number | null;
  final_charge_cents: number | null;
  total_estimate_cents: number | null;
  hosted_invoice_url: string | null;
  is_recurring: boolean | null;
  recurring_frequency: string | null;
}
interface SiteRow {
  id: string;
  nickname: string;
  address: string | null;
  city: string | null;
  facility_type: string | null;
  sqft: number | null;
}
interface DocRow { label: string; url: string | null; date: string }

const money = (c: number | null | undefined) => (c != null ? `$${(Number(c) / 100).toFixed(2)}` : "—");
const fmtDate = (d?: string | null) => {
  if (!d) return "—";
  const dt = new Date(`${String(d).slice(0, 10)}T12:00:00`);
  return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
};

export default function CommercialPortal() {
  const [loading, setLoading] = useState(true);
  const [account, setAccount] = useState<Account | null>(null);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestText, setRequestText] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("partner-commercial-portal", {
        body: { action: "overview" },
      });
      if (error) throw error;
      const d = data as { ok?: boolean; error?: string; account?: Account; bookings?: BookingRow[]; sites?: SiteRow[]; documents?: DocRow[] };
      if (!d?.ok) throw new Error(d?.error || "Couldn't load your account");
      setAccount(d.account || null);
      setBookings(d.bookings || []);
      setSites(d.sites || []);
      setDocs(d.documents || []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load your account");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const sendRequest = async () => {
    if (!requestText.trim()) return;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("partner-commercial-portal", {
        body: { action: "request_service", message: requestText.trim() },
      });
      if (error) throw error;
      if ((data as { ok?: boolean })?.ok === false) throw new Error((data as { error?: string })?.error || "Failed");
      toast.success("Request sent — our team will follow up shortly.");
      setRequestText("");
      setRequestOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't send request");
    } finally {
      setSending(false);
    }
  };

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = bookings.filter((b) => (b.service_date || "") >= today && b.status !== "cancelled").reverse();
  const history = bookings.filter((b) => (b.service_date || "") < today || b.status === "completed");

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-6 max-w-4xl mx-auto space-y-4">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
      </div>
    );
  }
  if (!account) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <Card className="max-w-md"><CardContent className="p-8 text-center space-y-3">
          <RiErrorWarningLine className="w-10 h-10 text-amber-500 mx-auto" />
          <p className="font-bold text-slate-900">No account found</p>
          <p className="text-sm text-slate-500">We couldn't find a commercial account for this login. Contact contact@novaracleaning.com.</p>
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <img src="/novara-logo.png" alt="Novara Cleaning" className="h-8" />
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => void load()}><RiRefreshLine className="w-4 h-4" /></Button>
            <Button variant="ghost" size="sm" onClick={() => void supabase.auth.signOut().then(() => window.location.reload())}>
              <RiLogoutBoxRLine className="w-4 h-4 mr-1" /> Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-5">
        {/* ─── Account header ───────────────────────────────────────────── */}
        <div className="rounded-2xl p-6 text-white" style={{ background: PURPLE_GRADIENT }}>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-white/70 text-xs font-semibold uppercase tracking-wide">
                {account.account_type === "office" ? "Office partner" : "Commercial partner"}
              </p>
              <h1 className="text-2xl font-bold mt-0.5">{account.business_name}</h1>
              <p className="text-white/80 text-sm mt-1">
                {account.facility_type || "—"}{account.recurring_frequency ? ` · ${account.recurring_frequency}` : ""}
                {account.num_locations ? ` · ${account.num_locations} location${account.num_locations === 1 ? "" : "s"}` : ""}
              </p>
            </div>
            <Badge className={cn("border-0 text-xs", account.status === "active" ? "bg-emerald-400/20 text-emerald-100" : "bg-white/20 text-white")}>
              {account.status}
            </Badge>
          </div>
        </div>

        {/* ─── Finish-setup gate ────────────────────────────────────────── */}
        {!account.setup_complete && (
          <Card className="border-amber-300 bg-amber-50">
            <CardContent className="p-5">
              <p className="font-bold text-amber-900 flex items-center gap-2">
                <RiErrorWarningLine className="w-5 h-5" /> Finish setting up your account
              </p>
              <p className="text-sm text-amber-800 mt-1">
                Service can't go live until your agreement is signed and a payment method is on file. Our team will send you anything that's missing — or reach out to speed it up.
              </p>
              <div className="flex gap-2 mt-3 flex-wrap">
                <Badge className={cn("border-0", account.agreement_signed ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700")}>
                  {account.agreement_signed ? "✓ Agreement signed" : "Agreement pending"}
                </Badge>
                <Badge className={cn("border-0", account.payment_on_file ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700")}>
                  {account.payment_on_file ? "✓ Payment on file" : "Payment method needed"}
                </Badge>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ─── Sites ────────────────────────────────────────────────────── */}
        {sites.length > 0 && (
          <section>
            <h2 className="font-bold text-slate-900 flex items-center gap-1.5 mb-2">
              <RiBuilding2Line className="w-4 h-4 text-violet-600" /> Your sites
            </h2>
            <div className="grid sm:grid-cols-2 gap-2">
              {sites.map((st) => (
                <Card key={st.id}><CardContent className="p-4">
                  <p className="font-semibold text-slate-900">{st.nickname}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {st.facility_type || "—"}{st.sqft ? ` · ${st.sqft.toLocaleString()} sqft` : ""}
                    {st.address ? ` · ${st.address}${st.city ? `, ${st.city}` : ""}` : ""}
                  </p>
                </CardContent></Card>
              ))}
            </div>
          </section>
        )}

        {/* ─── Upcoming visits ──────────────────────────────────────────── */}
        <section>
          <h2 className="font-bold text-slate-900 flex items-center gap-1.5 mb-2">
            <RiCalendarCheckLine className="w-4 h-4 text-violet-600" /> Upcoming service
          </h2>
          {upcoming.length === 0 ? (
            <Card><CardContent className="p-6 text-center text-sm text-slate-500">
              No upcoming visits scheduled{account.setup_complete ? " — request service below." : " — finish setup to go live."}
            </CardContent></Card>
          ) : (
            <div className="space-y-2">
              {upcoming.map((b) => (
                <Card key={b.id}><CardContent className="p-4 flex flex-wrap items-center gap-3">
                  <div>
                    <p className="font-semibold text-slate-900">{fmtDate(b.service_date)}</p>
                    <p className="text-xs text-slate-500">{b.time_slot || b.arrival_window || ""} · {b.address}{b.city ? `, ${b.city}` : ""}</p>
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    {b.is_recurring && <Badge variant="outline">{b.recurring_frequency || "recurring"}</Badge>}
                    <Badge className="bg-violet-100 text-violet-700 border-0">{b.status}</Badge>
                  </div>
                </CardContent></Card>
              ))}
            </div>
          )}
        </section>

        {/* ─── Request service / changes ────────────────────────────────── */}
        <Card className="border-violet-200">
          <CardContent className="p-5">
            <p className="font-bold text-slate-900 flex items-center gap-1.5">
              <RiMailSendLine className="w-4 h-4 text-violet-600" /> Need something?
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Request additional service, a schedule change, or anything else — it goes straight to our partnerships team.
            </p>
            {!requestOpen ? (
              <Button className="mt-3 text-white" style={{ background: PURPLE_GRADIENT }} onClick={() => setRequestOpen(true)}>
                Request service or changes
              </Button>
            ) : (
              <div className="mt-3 space-y-2">
                <Textarea value={requestText} onChange={(e) => setRequestText(e.target.value)} rows={3}
                  placeholder="e.g. Add a deep clean before our open house on the 20th, or move our Tuesday visit to Thursday…" />
                <div className="flex gap-2">
                  <Button className="text-white" style={{ background: PURPLE_GRADIENT }} disabled={!requestText.trim() || sending} onClick={() => void sendRequest()}>
                    {sending ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiMailSendLine className="w-4 h-4 mr-1.5" />}
                    Send to the team
                  </Button>
                  <Button variant="ghost" onClick={() => setRequestOpen(false)}>Cancel</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ─── History + invoices ───────────────────────────────────────── */}
        <section>
          <h2 className="font-bold text-slate-900 flex items-center gap-1.5 mb-2">
            <RiMoneyDollarCircleLine className="w-4 h-4 text-violet-600" /> Service history & invoices
          </h2>
          {history.length === 0 ? (
            <Card><CardContent className="p-6 text-center text-sm text-slate-500">No completed visits yet.</CardContent></Card>
          ) : (
            <div className="space-y-2">
              {history.slice(0, 20).map((b) => (
                <Card key={b.id}><CardContent className="p-4 flex flex-wrap items-center gap-3">
                  <div>
                    <p className="font-semibold text-slate-900">{fmtDate(b.service_date)}</p>
                    <p className="text-xs text-slate-500">{b.address}{b.city ? `, ${b.city}` : ""}</p>
                  </div>
                  <div className="ml-auto flex items-center gap-3">
                    <span className="text-sm font-semibold text-slate-700">{money(b.final_charge_cents ?? b.custom_quote_cents ?? b.total_estimate_cents)}</span>
                    {b.hosted_invoice_url && (
                      <a href={b.hosted_invoice_url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-violet-600 hover:underline">Invoice</a>
                    )}
                    <Badge variant="outline">{b.status}</Badge>
                  </div>
                </CardContent></Card>
              ))}
            </div>
          )}
        </section>

        {/* ─── Documents ────────────────────────────────────────────────── */}
        <section className="pb-10">
          <h2 className="font-bold text-slate-900 flex items-center gap-1.5 mb-2">
            <RiFileTextLine className="w-4 h-4 text-violet-600" /> Documents
          </h2>
          {docs.length === 0 ? (
            <Card><CardContent className="p-6 text-center text-sm text-slate-500">No documents yet — your signed agreement will appear here.</CardContent></Card>
          ) : (
            <div className="space-y-2">
              {docs.map((d, i) => (
                <Card key={i}><CardContent className="p-4 flex items-center gap-3">
                  <RiCheckboxCircleFill className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span className="text-sm text-slate-700">{d.label}</span>
                  {d.url && <a href={d.url} target="_blank" rel="noreferrer" className="ml-auto text-xs font-semibold text-violet-600 hover:underline">Open</a>}
                </CardContent></Card>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
