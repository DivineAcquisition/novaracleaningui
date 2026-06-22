"use client";

// ─── partner.novaracleaning.com — Host turnover portal ───────────────────
//
// Self-serve portal for Airbnb / short-term-rental hosts: sign up, register
// properties (admin sets the per-turnover price), request + pay for
// turnovers, and track status. Mobile-first. All pricing/payment/assignment
// is enforced server-side by the partner-turnover edge function.

import { useEffect, useState, useCallback } from "react";
import type { Session } from "@supabase/supabase-js";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  RiHome4Line, RiAddLine, RiLoader4Line, RiCalendarLine, RiMapPinLine,
  RiLogoutBoxRLine, RiCheckboxCircleLine, RiTimeLine, RiEditLine, RiSparklingLine,
} from "@remixicon/react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { SEO } from "@/components/SEO";

interface Property {
  id: string; nickname: string | null; address: string | null;
  access_instructions: string | null; bedrooms: number | null; bathrooms: number | null;
  sqft: number | null; laundry_included: boolean; restock_included: boolean;
  turnover_price: number | null; special_notes: string | null;
}
interface Turnover {
  id: string; property_id: string; requested_date: string; window_start: string | null;
  window_end: string | null; price: number; status: string; assignment_type: string | null;
  assigned_cleaner_id: string | null; created_at: string;
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  pending_payment: { label: "Awaiting payment", cls: "bg-amber-100 text-amber-700" },
  paid: { label: "Paid · assigning", cls: "bg-blue-100 text-blue-700" },
  assigned: { label: "Assigned", cls: "bg-violet-100 text-violet-700" },
  cleaner_confirmed: { label: "Cleaner confirmed", cls: "bg-emerald-100 text-emerald-700" },
  in_progress: { label: "In progress", cls: "bg-blue-100 text-blue-700" },
  completed: { label: "Completed", cls: "bg-emerald-100 text-emerald-700" },
  cancelled: { label: "Cancelled", cls: "bg-slate-100 text-slate-500" },
  unassigned_alert: { label: "Finding a cleaner", cls: "bg-amber-100 text-amber-700" },
};

const digits = (s: string) => s.replace(/\D/g, "");

export default function PartnerPortal() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthLoading(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (authLoading) {
    return <div className="min-h-screen flex items-center justify-center"><RiLoader4Line className="w-8 h-8 animate-spin text-primary" /></div>;
  }
  return session ? <Dashboard /> : <AuthScreen />;
}

// ─── Auth ────────────────────────────────────────────────────────────────
function AuthScreen() {
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim() || password.length < 6) { toast.error("Enter your email and a 6+ character password."); return; }
    setBusy(true);
    try {
      if (mode === "signup") {
        if (!name.trim() || digits(phone).length < 10) { toast.error("Add your name and phone."); setBusy(false); return; }
        const { error } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password,
          options: { data: { full_name: name.trim(), phone: digits(phone) } },
        });
        if (error) throw error;
        // Establish the host profile (works whether or not email confirmation is on).
        await supabase.functions.invoke("partner-turnover", { body: { action: "host.ensure", name: name.trim(), phone: digits(phone) } }).catch(() => {});
        toast.success("Welcome! Add your first property to get started.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
        if (error) throw error;
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#EDE9FE] to-white flex items-center justify-center px-4">
      <SEO title="Host Portal" description="Request Airbnb & short-term-rental turnover cleanings." noindex />
      <Card className="w-full max-w-md shadow-xl border-0">
        <div className="h-1.5 w-full" style={{ background: "linear-gradient(90deg,#5500FF,#918CFF)" }} />
        <CardHeader className="text-center space-y-1 pt-8">
          <div className="mx-auto w-12 h-12 rounded-2xl flex items-center justify-center mb-1" style={{ background: "#5500FF" }}>
            <RiSparklingLine className="w-6 h-6 text-white" />
          </div>
          <CardTitle className="text-2xl">Novara Host Portal</CardTitle>
          <p className="text-sm text-muted-foreground">Turnover cleanings for your rentals — booked in seconds.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {mode === "signup" && (
            <>
              <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" /></div>
              <div><Label>Phone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(301) 555-0100" /></div>
            </>
          )}
          <div><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" /></div>
          <div><Label>Password</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" /></div>
          <Button onClick={submit} disabled={busy} className="w-full h-11" style={{ background: "#5500FF" }}>
            {busy ? <RiLoader4Line className="w-4 h-4 animate-spin" /> : mode === "signup" ? "Create account" : "Sign in"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            {mode === "signup" ? "Already have an account?" : "New here?"}{" "}
            <button className="text-primary font-medium underline" onClick={() => setMode(mode === "signup" ? "login" : "signup")}>
              {mode === "signup" ? "Sign in" : "Create one"}
            </button>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Dashboard ─────────────────────────────────────────────────────────────
function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [properties, setProperties] = useState<Property[]>([]);
  const [turnovers, setTurnovers] = useState<Turnover[]>([]);
  const [showPropForm, setShowPropForm] = useState(false);
  const [editingProp, setEditingProp] = useState<Property | null>(null);
  const [requestFor, setRequestFor] = useState<Property | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    await supabase.functions.invoke("partner-turnover", { body: { action: "host.ensure" } }).catch(() => {});
    const [{ data: props }, { data: trs }] = await Promise.all([
      (supabase.from as any)("properties").select("*").order("created_at", { ascending: false }),
      (supabase.from as any)("turnover_requests").select("*").order("created_at", { ascending: false }),
    ]);
    setProperties((props as Property[]) || []);
    setTurnovers((trs as Turnover[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const propName = (id: string) => properties.find((p) => p.id === id)?.nickname || properties.find((p) => p.id === id)?.address || "Property";

  return (
    <div className="min-h-screen bg-slate-50">
      <SEO title="Host Dashboard" noindex />
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold"><RiSparklingLine className="w-5 h-5" style={{ color: "#5500FF" }} /> Host Portal</div>
          <Button variant="ghost" size="sm" onClick={() => supabase.auth.signOut()}><RiLogoutBoxRLine className="w-4 h-4" /></Button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-8">
        {loading ? (
          <div className="flex justify-center py-16"><RiLoader4Line className="w-8 h-8 animate-spin text-primary" /></div>
        ) : (
          <>
            {/* Properties */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold">Your properties</h2>
                <Button size="sm" onClick={() => { setEditingProp(null); setShowPropForm(true); }} style={{ background: "#5500FF" }}>
                  <RiAddLine className="w-4 h-4 mr-1" /> Add property
                </Button>
              </div>
              {properties.length === 0 && <p className="text-sm text-muted-foreground">No properties yet. Add your first rental to request turnovers.</p>}
              <div className="grid gap-3">
                {properties.map((p) => {
                  const priced = p.turnover_price != null && Number(p.turnover_price) > 0;
                  return (
                    <Card key={p.id}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-semibold flex items-center gap-2"><RiHome4Line className="w-4 h-4 text-primary" /> {p.nickname || "Property"}</p>
                            <p className="text-xs text-muted-foreground truncate">{p.address}</p>
                            <div className="flex flex-wrap gap-1.5 mt-2 text-[11px]">
                              {p.bedrooms != null && <Badge variant="secondary">{p.bedrooms} BR</Badge>}
                              {p.bathrooms != null && <Badge variant="secondary">{p.bathrooms} BA</Badge>}
                              {p.laundry_included && <Badge variant="secondary">Laundry on-site</Badge>}
                              {p.restock_included && <Badge variant="secondary">Restock</Badge>}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            {priced ? (
                              <p className="font-bold text-primary">${Number(p.turnover_price).toFixed(0)}<span className="text-[11px] text-muted-foreground">/turnover</span></p>
                            ) : (
                              <Badge className="bg-amber-100 text-amber-700">Pending pricing</Badge>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2 mt-3">
                          <Button size="sm" variant="outline" onClick={() => { setEditingProp(p); setShowPropForm(true); }}>
                            <RiEditLine className="w-3.5 h-3.5 mr-1" /> Edit
                          </Button>
                          <Button size="sm" disabled={!priced} onClick={() => setRequestFor(p)} style={priced ? { background: "#5500FF" } : undefined}>
                            <RiCalendarLine className="w-3.5 h-3.5 mr-1" /> Request turnover
                          </Button>
                        </div>
                        {!priced && <p className="text-[11px] text-amber-600 mt-2">Our team is setting your per-turnover rate — you'll be able to book once it's set.</p>}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>

            {/* Turnover history */}
            <section className="space-y-3">
              <h2 className="text-lg font-bold">Turnovers</h2>
              {turnovers.length === 0 && <p className="text-sm text-muted-foreground">No turnover requests yet.</p>}
              <div className="grid gap-2.5">
                {turnovers.map((t) => {
                  const st = STATUS_LABEL[t.status] || { label: t.status, cls: "bg-slate-100 text-slate-600" };
                  return (
                    <Card key={t.id}>
                      <CardContent className="p-3.5 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate flex items-center gap-1.5"><RiMapPinLine className="w-3.5 h-3.5 text-primary" />{propName(t.property_id)}</p>
                          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                            <RiTimeLine className="w-3 h-3" />{format(new Date(`${t.requested_date}T12:00:00`), "EEE, MMM d")}
                            {t.window_start ? ` · ${t.window_start.slice(0,5)}–${(t.window_end||"").slice(0,5)}` : ""}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <Badge className={cn("text-[11px]", st.cls)}>{st.label}</Badge>
                          <p className="text-sm font-semibold mt-1">${Number(t.price).toFixed(0)}</p>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </main>

      {showPropForm && (
        <PropertyForm property={editingProp} onClose={() => setShowPropForm(false)} onSaved={() => { setShowPropForm(false); load(); }} />
      )}
      {requestFor && (
        <RequestForm property={requestFor} onClose={() => setRequestFor(null)} />
      )}
    </div>
  );
}

// ─── Property form (modal) ─────────────────────────────────────────────────
function PropertyForm({ property, onClose, onSaved }: { property: Property | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    nickname: property?.nickname || "", address: property?.address || "",
    access_instructions: property?.access_instructions || "",
    bedrooms: property?.bedrooms?.toString() || "", bathrooms: property?.bathrooms?.toString() || "",
    sqft: property?.sqft?.toString() || "",
    laundry_included: property?.laundry_included || false, restock_included: property?.restock_included || false,
    special_notes: property?.special_notes || "",
  });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!f.nickname.trim() || !f.address.trim()) { toast.error("Add a nickname and address."); return; }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("partner-turnover", {
      body: { action: "property.save", propertyId: property?.id, ...f },
    });
    setBusy(false);
    if (error || (data as any)?.error) { toast.error((data as any)?.error || "Could not save"); return; }
    toast.success(property ? "Property updated" : "Property added — pending pricing");
    onSaved();
  };
  return (
    <Modal onClose={onClose} title={property ? "Edit property" : "Add property"}>
      <div className="space-y-3">
        <div><Label>Nickname *</Label><Input value={f.nickname} onChange={(e) => setF({ ...f, nickname: e.target.value })} placeholder="Lakehouse 2BR" /></div>
        <div><Label>Address *</Label><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} placeholder="123 Lake Dr, Columbia, MD" /></div>
        <div className="grid grid-cols-3 gap-2">
          <div><Label>Beds</Label><Input value={f.bedrooms} onChange={(e) => setF({ ...f, bedrooms: e.target.value })} inputMode="numeric" /></div>
          <div><Label>Baths</Label><Input value={f.bathrooms} onChange={(e) => setF({ ...f, bathrooms: e.target.value })} inputMode="decimal" /></div>
          <div><Label>Sq ft</Label><Input value={f.sqft} onChange={(e) => setF({ ...f, sqft: e.target.value })} inputMode="numeric" /></div>
        </div>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.laundry_included} onChange={(e) => setF({ ...f, laundry_included: e.target.checked })} /> Linens / laundry on-site</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.restock_included} onChange={(e) => setF({ ...f, restock_included: e.target.checked })} /> Restock consumables</label>
        </div>
        <div><Label>Access instructions</Label><Textarea rows={2} value={f.access_instructions} onChange={(e) => setF({ ...f, access_instructions: e.target.value })} placeholder="Lockbox 1234, gate code, parking, where supplies are…" /></div>
        <div><Label>Special notes</Label><Textarea rows={2} value={f.special_notes} onChange={(e) => setF({ ...f, special_notes: e.target.value })} placeholder="Staging prefs, quirks…" /></div>
        <Button onClick={save} disabled={busy} className="w-full" style={{ background: "#5500FF" }}>
          {busy ? <RiLoader4Line className="w-4 h-4 animate-spin" /> : "Save property"}
        </Button>
      </div>
    </Modal>
  );
}

// ─── Request turnover (modal → Stripe checkout) ────────────────────────────
function RequestForm({ property, onClose }: { property: Property; onClose: () => void }) {
  const [date, setDate] = useState("");
  const [start, setStart] = useState("11:00");
  const [end, setEnd] = useState("15:00");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!date) { toast.error("Pick a date."); return; }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("partner-turnover", {
      body: { action: "turnover.request", propertyId: property.id, requested_date: date, window_start: start, window_end: end },
    });
    if (error || (data as any)?.error || !(data as any)?.url) {
      setBusy(false);
      toast.error((data as any)?.error || "Could not start checkout");
      return;
    }
    window.location.href = (data as any).url;
  };
  return (
    <Modal onClose={onClose} title={`Request turnover — ${property.nickname || "Property"}`}>
      <div className="space-y-3">
        <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 flex items-center justify-between">
          <span className="text-sm">Per-turnover price</span>
          <span className="font-bold text-primary">${Number(property.turnover_price).toFixed(0)}</span>
        </div>
        <div><Label>Date *</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label>Checkout time</Label><Input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></div>
          <div><Label>Next check-in by</Label><Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
        </div>
        <Button onClick={submit} disabled={busy} className="w-full h-11" style={{ background: "#5500FF" }}>
          {busy ? <RiLoader4Line className="w-4 h-4 animate-spin" /> : `Pay $${Number(property.turnover_price).toFixed(0)} & request`}
        </Button>
        <p className="text-[11px] text-center text-muted-foreground">Your turnover is confirmed once payment succeeds, then we assign your cleaning crew.</p>
      </div>
    </Modal>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 max-h-[92vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold">{title}</h3>
          <button onClick={onClose} className="text-muted-foreground text-sm">Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}
