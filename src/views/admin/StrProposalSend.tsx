"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RiAddLine,
  RiCheckboxCircleLine,
  RiCloseLine,
  RiFileCopyLine,
  RiHotelLine,
  RiLoader4Line,
  RiMailSendLine,
  RiSearchLine,
} from "@remixicon/react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { proposalOfferApi } from "@/lib/proposal-offer-api";
import { strOfferRequirements } from "@/lib/proposal-offer-send";

interface HostHit {
  id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  properties?: Array<{
    id: string;
    nickname?: string | null;
    address?: string | null;
    bedrooms?: number | null;
    bathrooms?: number | null;
    sqft?: number | null;
    turnover_price?: number | null;
    laundry_included?: boolean | null;
  }>;
}

interface FormProperty {
  key: string;
  propertyId: string;
  nickname: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  bedrooms: string;
  bathrooms: string;
  turnover: string;
  laundry: boolean;
}

function emptyProperty(partial?: Partial<FormProperty>): FormProperty {
  return {
    key: partial?.key || `p-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    propertyId: partial?.propertyId || "",
    nickname: partial?.nickname || "",
    address: partial?.address || "",
    city: partial?.city || "",
    state: partial?.state || "",
    zip: partial?.zip || "",
    bedrooms: partial?.bedrooms || "",
    bathrooms: partial?.bathrooms || "",
    turnover: partial?.turnover || "",
    laundry: partial?.laundry || false,
  };
}

export default function StrProposalSend({ initialHostId = "" }: { initialHostId?: string }) {
  const [mode, setMode] = useState<"new" | "existing">(initialHostId ? "existing" : "new");
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<HostHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [hostId, setHostId] = useState(initialHostId);
  const [hostName, setHostName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [properties, setProperties] = useState<FormProperty[]>([emptyProperty()]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ link: string | null; emailed: boolean } | null>(null);

  const loadHosts = useCallback(async (q: string) => {
    setSearching(true);
    try {
      const out = await proposalOfferApi("GET", undefined, `?view=hosts&q=${encodeURIComponent(q.trim())}`);
      setHits((out.hosts || []) as HostHit[]);
    } catch (err) {
      toast.error((err as Error).message);
      setHits([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (mode !== "existing") return;
    const t = setTimeout(() => { void loadHosts(search); }, 250);
    return () => clearTimeout(t);
  }, [mode, search, loadHosts]);

  const applyHost = (host: HostHit) => {
    setHostId(host.id);
    setHostName(host.name || "");
    setEmail(host.email || "");
    setPhone(host.phone || "");
    if (host.properties?.length) {
      setProperties(host.properties.map((p) => emptyProperty({
        key: p.id,
        propertyId: p.id,
        nickname: p.nickname || "",
        address: p.address || "",
        bedrooms: p.bedrooms != null ? String(p.bedrooms) : "",
        bathrooms: p.bathrooms != null ? String(p.bathrooms) : "",
        turnover: p.turnover_price != null ? String(p.turnover_price) : "",
        laundry: p.laundry_included === true,
      })));
    }
  };

  useEffect(() => {
    if (!initialHostId) return;
    void (async () => {
      try {
        const out = await proposalOfferApi("GET", undefined, "?view=hosts");
        const host = ((out.hosts || []) as HostHit[]).find((h) => h.id === initialHostId);
        if (host) applyHost(host);
      } catch (err) {
        toast.error((err as Error).message);
      }
    })();
  }, [initialHostId]);

  const requirements = useMemo(
    () => strOfferRequirements({
      hostName,
      email,
      properties: properties.map((p) => ({
        nickname: p.nickname || p.address || "Property",
        address: p.address,
        turnoverDollars: Number(p.turnover) || null,
      })),
    }),
    [hostName, email, properties],
  );
  const canSend = requirements.length === 0;

  const send = async () => {
    if (!canSend) return;
    setBusy(true);
    try {
      const out = await proposalOfferApi("POST", {
        flow: "str",
        hostId: hostId || undefined,
        hostName: hostName.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        send: true,
        properties: properties.map((p) => ({
          propertyId: p.propertyId || undefined,
          nickname: p.nickname.trim(),
          address: p.address.trim(),
          city: p.city.trim(),
          state: p.state.trim(),
          zip: p.zip.trim(),
          bedrooms: p.bedrooms ? Number(p.bedrooms) : null,
          bathrooms: p.bathrooms ? Number(p.bathrooms) : null,
          turnoverDollars: Number(p.turnover) || null,
          laundryIncluded: p.laundry,
        })),
      });
      setResult({ link: out.link || null, emailed: out.emailed === true });
      if (out.emailed === false) toast.warning("Link minted but the email did not send — copy it.");
      else toast.success("Host onboarding sent.");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <Card className="max-w-2xl mx-auto border-slate-200 rounded-2xl">
        <CardHeader className="text-center pt-10">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-violet-50 flex items-center justify-center ring-1 ring-violet-200">
            <RiCheckboxCircleLine className="w-7 h-7 text-violet-600" />
          </div>
          <Badge className="mx-auto mt-3 bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-50">STR host onboarding</Badge>
          <CardTitle className="font-jakarta text-2xl mt-3">{hostName} — agreement sent</CardTitle>
          <CardDescription>
            {result.emailed
              ? `Emailed to ${email}. They review the partnership agreement and set payment on the link.`
              : "The link is live. Copy it if the email did not send."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pb-8">
          {result.link && (
            <div className="flex gap-2">
              <Input value={result.link} readOnly className="font-mono text-xs" />
              <Button variant="outline" onClick={() => { void navigator.clipboard.writeText(result.link!); toast.success("Copied"); }}>
                <RiFileCopyLine className="w-4 h-4 mr-1.5" /> Copy
              </Button>
            </div>
          )}
          <Button variant="outline" className="w-full" onClick={() => { setResult(null); setHostId(""); setHostName(""); setEmail(""); setPhone(""); setProperties([emptyProperty()]); }}>
            Send another
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="max-w-3xl space-y-5">
      <header>
        <h2 className="font-jakarta text-[22px] font-bold tracking-tight text-slate-900">Send STR host onboarding</h2>
        <p className="text-sm text-slate-500 mt-1">
          Type the host and a priced property — then mail the agreement and payment setup. No walkthrough, no commercial proposal document.
        </p>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <RiHotelLine className="w-4 h-4 text-violet-600" /> Host
        </div>
        <div className="flex gap-1 text-xs">
          <button type="button" onClick={() => { setMode("new"); setHostId(""); }} className={cn("px-2.5 py-1 rounded-md", mode === "new" ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-600")}>New</button>
          <button type="button" onClick={() => setMode("existing")} className={cn("px-2.5 py-1 rounded-md", mode === "existing" ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-600")}>Existing</button>
        </div>
        {mode === "existing" && (
          <div className="space-y-2">
            <div className="relative">
              <RiSearchLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input placeholder="Search host name or email…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <div className="rounded-lg border border-slate-200 divide-y max-h-48 overflow-y-auto">
              {searching && <p className="text-xs text-slate-500 p-3">Searching…</p>}
              {!searching && hits.length === 0 && <p className="text-xs text-slate-500 p-3">No matching hosts.</p>}
              {hits.map((h) => (
                <button key={h.id} type="button" onClick={() => applyHost(h)} className={cn("w-full text-left p-3 hover:bg-slate-50", hostId === h.id && "bg-violet-50/60")}>
                  <p className="text-sm font-medium">{h.name || "Unnamed host"}</p>
                  <p className="text-xs text-slate-500">{h.email || "no email"} · {h.properties?.length || 0} properties</p>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Host name" required><Input value={hostName} onChange={(e) => setHostName(e.target.value)} placeholder="Alex Harbor" /></Field>
          <Field label="Email" required><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="alex@harbor.test" /></Field>
          <Field label="Phone"><Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-900">Properties &amp; turnover rates</p>
          <Button type="button" variant="outline" size="sm" onClick={() => setProperties((prev) => [...prev, emptyProperty()])}>
            <RiAddLine className="w-4 h-4 mr-1" /> Add property
          </Button>
        </div>
        {properties.map((p, idx) => (
          <div key={p.key} className="rounded-xl border border-slate-200 p-3 space-y-3">
            <div className="flex justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Property {idx + 1}</p>
              {properties.length > 1 && (
                <button type="button" onClick={() => setProperties((prev) => prev.filter((x) => x.key !== p.key))} className="text-slate-400 hover:text-rose-600" aria-label="Remove property">
                  <RiCloseLine className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Nickname"><Input value={p.nickname} onChange={(e) => setProperties((prev) => prev.map((x) => x.key === p.key ? { ...x, nickname: e.target.value } : x))} placeholder="Harbor loft" /></Field>
              <Field label="Turnover rate ($)" required><Input type="number" min={0} step="1" value={p.turnover} onChange={(e) => setProperties((prev) => prev.map((x) => x.key === p.key ? { ...x, turnover: e.target.value } : x))} placeholder="185" /></Field>
            </div>
            <Field label="Address" required><Input value={p.address} onChange={(e) => setProperties((prev) => prev.map((x) => x.key === p.key ? { ...x, address: e.target.value } : x))} placeholder="12 Harbor St" /></Field>
            <div className="grid sm:grid-cols-4 gap-3">
              <Field label="City"><Input value={p.city} onChange={(e) => setProperties((prev) => prev.map((x) => x.key === p.key ? { ...x, city: e.target.value } : x))} /></Field>
              <Field label="State"><Input value={p.state} onChange={(e) => setProperties((prev) => prev.map((x) => x.key === p.key ? { ...x, state: e.target.value.toUpperCase() } : x))} maxLength={2} /></Field>
              <Field label="ZIP"><Input value={p.zip} onChange={(e) => setProperties((prev) => prev.map((x) => x.key === p.key ? { ...x, zip: e.target.value } : x))} /></Field>
              <Field label="Beds / baths">
                <div className="flex gap-2">
                  <Input type="number" min={0} value={p.bedrooms} onChange={(e) => setProperties((prev) => prev.map((x) => x.key === p.key ? { ...x, bedrooms: e.target.value } : x))} placeholder="2" />
                  <Input type="number" min={0} step="0.5" value={p.bathrooms} onChange={(e) => setProperties((prev) => prev.map((x) => x.key === p.key ? { ...x, bathrooms: e.target.value } : x))} placeholder="1.5" />
                </div>
              </Field>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={p.laundry} onChange={(e) => setProperties((prev) => prev.map((x) => x.key === p.key ? { ...x, laundry: e.target.checked } : x))} />
              Laundry included
            </label>
          </div>
        ))}
      </section>

      {requirements.length > 0 && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Still needed: {requirements.join(", ")}
        </p>
      )}
      <Button className="bg-violet-600 hover:bg-violet-700 text-white" disabled={!canSend || busy} onClick={() => void send()}>
        {busy ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiMailSendLine className="w-4 h-4 mr-1.5" />}
        Send host onboarding
      </Button>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs text-slate-600">{label}{required ? " *" : ""}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
