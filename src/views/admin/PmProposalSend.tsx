"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RiAddLine,
  RiCheckboxCircleLine,
  RiCloseLine,
  RiFileCopyLine,
  RiLoader4Line,
  RiMailSendLine,
  RiSearchLine,
  RiUserStarLine,
} from "@remixicon/react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { fetchPmAdmin, type PmAdminAccount, type PmAdminUnit } from "@/lib/partner-admin-api";
import { proposalOfferApi } from "@/lib/proposal-offer-api";
import { pmOfferRequirements } from "@/lib/proposal-offer-send";

interface FormUnit {
  key: string;
  unitId: string;
  nickname: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  bedrooms: string;
  bathrooms: string;
  sqft: string;
  moveOut: string;
  moveIn: string;
  standard: string;
}

function emptyUnit(partial?: Partial<FormUnit>): FormUnit {
  return {
    key: partial?.key || `u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    unitId: partial?.unitId || "",
    nickname: partial?.nickname || "",
    address: partial?.address || "",
    city: partial?.city || "",
    state: partial?.state || "",
    zip: partial?.zip || "",
    bedrooms: partial?.bedrooms || "",
    bathrooms: partial?.bathrooms || "",
    sqft: partial?.sqft || "",
    moveOut: partial?.moveOut || "",
    moveIn: partial?.moveIn || "",
    standard: partial?.standard || "",
  };
}

function unitPriced(u: FormUnit): boolean {
  const manual = Number(u.moveOut) > 0 && Number(u.moveIn) > 0 && Number(u.standard) > 0;
  const autoReady = u.address.trim().length >= 8 && (!!u.zip.trim() || (!!u.bedrooms && !!u.sqft));
  return manual || autoReady;
}

function centsToDollars(cents: number | null | undefined): string {
  const n = Number(cents || 0) / 100;
  return n > 0 ? n.toFixed(2) : "";
}

export default function PmProposalSend({ initialPmAccountId = "" }: { initialPmAccountId?: string }) {
  const [mode, setMode] = useState<"new" | "existing">(initialPmAccountId ? "existing" : "new");
  const [accounts, setAccounts] = useState<PmAdminAccount[]>([]);
  const [search, setSearch] = useState("");
  const [loadingList, setLoadingList] = useState(false);
  const [pmAccountId, setPmAccountId] = useState(initialPmAccountId);
  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [units, setUnits] = useState<FormUnit[]>([emptyUnit()]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ link: string | null; emailed: boolean; unitCount?: number } | null>(null);

  const loadAccounts = useCallback(async () => {
    setLoadingList(true);
    try {
      const out = await fetchPmAdmin();
      setAccounts(out.accounts || []);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    if (mode === "existing") void loadAccounts();
  }, [mode, loadAccounts]);

  const applyAccount = async (account: PmAdminAccount) => {
    setPmAccountId(account.id);
    setCompanyName(account.company_name || "");
    setContactName(account.contact_name || "");
    setEmail(account.email || "");
    setPhone(account.phone || "");
    try {
      const detail = await fetchPmAdmin(account.id);
      const existing = (detail.units || []) as PmAdminUnit[];
      if (existing.length) {
        setUnits(existing.map((u) => {
          const rate = (service: string) => centsToDollars(u.rates.find((r) => r.service === service)?.standingCents);
          return emptyUnit({
            key: u.id,
            unitId: u.id,
            nickname: u.unitLabel || u.label || "",
            address: u.address || "",
            city: u.city || "",
            state: u.state || "",
            zip: u.zipCode || "",
            bedrooms: u.bedrooms != null ? String(u.bedrooms) : "",
            bathrooms: u.bathrooms != null ? String(u.bathrooms) : "",
            sqft: u.sqft != null ? String(u.sqft) : "",
            moveOut: rate("move_out"),
            moveIn: rate("move_in"),
            standard: rate("standard"),
          });
        }));
      }
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  useEffect(() => {
    if (!initialPmAccountId) return;
    void (async () => {
      try {
        const out = await fetchPmAdmin();
        const account = (out.accounts || []).find((a) => a.id === initialPmAccountId);
        if (account) await applyAccount(account);
      } catch (err) {
        toast.error((err as Error).message);
      }
    })();
  }, [initialPmAccountId]);

  const filtered = accounts.filter((a) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return `${a.company_name} ${a.contact_name} ${a.email}`.toLowerCase().includes(q);
  });

  const requirements = useMemo(
    () => pmOfferRequirements({
      companyName,
      contactName,
      email,
      units: units.map((u) => ({
        nickname: u.nickname || u.address || "Unit",
        address: u.address,
        priced: unitPriced(u),
      })),
    }),
    [companyName, contactName, email, units],
  );
  const canSend = requirements.length === 0;

  const send = async () => {
    if (!canSend) return;
    setBusy(true);
    try {
      const out = await proposalOfferApi("POST", {
        flow: "property_manager",
        pmAccountId: pmAccountId || undefined,
        companyName: companyName.trim(),
        contactName: contactName.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        send: true,
        units: units.map((u) => ({
          unitId: u.unitId || undefined,
          nickname: u.nickname.trim(),
          address: u.address.trim(),
          city: u.city.trim(),
          state: u.state.trim(),
          zip: u.zip.trim(),
          bedrooms: u.bedrooms ? Number(u.bedrooms) : null,
          bathrooms: u.bathrooms ? Number(u.bathrooms) : null,
          sqft: u.sqft ? Number(u.sqft) : null,
          moveOutDollars: u.moveOut ? Number(u.moveOut) : null,
          moveInDollars: u.moveIn ? Number(u.moveIn) : null,
          standardDollars: u.standard ? Number(u.standard) : null,
        })),
      });
      setResult({ link: out.link || null, emailed: out.emailed === true, unitCount: out.unitCount });
      if (out.emailed === false) toast.warning("Link minted but the email did not send — copy it.");
      else toast.success("Property-manager onboarding sent.");
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
          <Badge className="mx-auto mt-3 bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-50">PM onboarding</Badge>
          <CardTitle className="font-jakarta text-2xl mt-3">{companyName} — agreement sent</CardTitle>
          <CardDescription>
            {result.emailed
              ? `Emailed to ${email}. They confirm standing rates and set payment on the link.`
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
          <Button variant="outline" className="w-full" onClick={() => { setResult(null); setPmAccountId(""); setCompanyName(""); setContactName(""); setEmail(""); setPhone(""); setUnits([emptyUnit()]); }}>
            Send another
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="max-w-3xl space-y-5">
      <header>
        <h2 className="font-jakarta text-[22px] font-bold tracking-tight text-slate-900">Send property-manager onboarding</h2>
        <p className="text-sm text-slate-500 mt-1">
          Company, contact, and priced units — then mail the portfolio agreement and payment setup. Standing rates come from the residential engine, or you type them.
        </p>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <RiUserStarLine className="w-4 h-4 text-violet-600" /> Property manager
        </div>
        <div className="flex gap-1 text-xs">
          <button type="button" onClick={() => { setMode("new"); setPmAccountId(""); }} className={cn("px-2.5 py-1 rounded-md", mode === "new" ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-600")}>New</button>
          <button type="button" onClick={() => setMode("existing")} className={cn("px-2.5 py-1 rounded-md", mode === "existing" ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-600")}>Existing</button>
        </div>
        {mode === "existing" && (
          <div className="space-y-2">
            <div className="relative">
              <RiSearchLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input placeholder="Search company or email…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <div className="rounded-lg border border-slate-200 divide-y max-h-48 overflow-y-auto">
              {loadingList && <p className="text-xs text-slate-500 p-3">Loading…</p>}
              {!loadingList && filtered.length === 0 && <p className="text-xs text-slate-500 p-3">No matching portfolios.</p>}
              {filtered.map((a) => (
                <button key={a.id} type="button" onClick={() => void applyAccount(a)} className={cn("w-full text-left p-3 hover:bg-slate-50", pmAccountId === a.id && "bg-violet-50/60")}>
                  <p className="text-sm font-medium">{a.company_name}</p>
                  <p className="text-xs text-slate-500">{a.contact_name || "No contact"} · {a.email || "no email"} · {a.unitCount} units</p>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Company" required><Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Harbor Property Group" /></Field>
          <Field label="Contact" required><Input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Jordan Lee" /></Field>
          <Field label="Email" required><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Phone"><Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-900">Units &amp; standing rates</p>
          <Button type="button" variant="outline" size="sm" onClick={() => setUnits((prev) => [...prev, emptyUnit()])}>
            <RiAddLine className="w-4 h-4 mr-1" /> Add unit
          </Button>
        </div>
        <p className="text-[11px] text-slate-500">
          Address plus ZIP or beds/sqft usually auto-prices. If it cannot, enter Move-Out, Move-In, and Standard in dollars.
        </p>
        {units.map((u, idx) => (
          <div key={u.key} className="rounded-xl border border-slate-200 p-3 space-y-3">
            <div className="flex justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Unit {idx + 1}</p>
              {units.length > 1 && (
                <button type="button" onClick={() => setUnits((prev) => prev.filter((x) => x.key !== u.key))} className="text-slate-400 hover:text-rose-600" aria-label="Remove unit">
                  <RiCloseLine className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Label"><Input value={u.nickname} onChange={(e) => setUnits((prev) => prev.map((x) => x.key === u.key ? { ...x, nickname: e.target.value } : x))} placeholder="Unit 2B" /></Field>
              <Field label="Address" required><Input value={u.address} onChange={(e) => setUnits((prev) => prev.map((x) => x.key === u.key ? { ...x, address: e.target.value } : x))} /></Field>
            </div>
            <div className="grid sm:grid-cols-5 gap-3">
              <Field label="City"><Input value={u.city} onChange={(e) => setUnits((prev) => prev.map((x) => x.key === u.key ? { ...x, city: e.target.value } : x))} /></Field>
              <Field label="State"><Input value={u.state} onChange={(e) => setUnits((prev) => prev.map((x) => x.key === u.key ? { ...x, state: e.target.value.toUpperCase() } : x))} maxLength={2} /></Field>
              <Field label="ZIP"><Input value={u.zip} onChange={(e) => setUnits((prev) => prev.map((x) => x.key === u.key ? { ...x, zip: e.target.value } : x))} /></Field>
              <Field label="Beds"><Input type="number" min={0} value={u.bedrooms} onChange={(e) => setUnits((prev) => prev.map((x) => x.key === u.key ? { ...x, bedrooms: e.target.value } : x))} /></Field>
              <Field label="Sqft"><Input type="number" min={0} value={u.sqft} onChange={(e) => setUnits((prev) => prev.map((x) => x.key === u.key ? { ...x, sqft: e.target.value } : x))} /></Field>
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              <Field label="Move-out ($)"><Input type="number" min={0} step="1" value={u.moveOut} onChange={(e) => setUnits((prev) => prev.map((x) => x.key === u.key ? { ...x, moveOut: e.target.value } : x))} /></Field>
              <Field label="Move-in ($)"><Input type="number" min={0} step="1" value={u.moveIn} onChange={(e) => setUnits((prev) => prev.map((x) => x.key === u.key ? { ...x, moveIn: e.target.value } : x))} /></Field>
              <Field label="Standard ($)"><Input type="number" min={0} step="1" value={u.standard} onChange={(e) => setUnits((prev) => prev.map((x) => x.key === u.key ? { ...x, standard: e.target.value } : x))} /></Field>
            </div>
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
        Send PM onboarding
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
