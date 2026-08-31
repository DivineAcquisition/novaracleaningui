"use client";

// Proposal request intake — parallel to Internal Booking, never a booking.
// First question is property type; type-specific questions stay light. Full
// detail is captured on the contractor's tokenized walkthrough.

import { useMemo, useState } from "react";
import {
  RiAddLine,
  RiBuilding2Line,
  RiCheckLine,
  RiCloseLine,
  RiLoader4Line,
  RiMapPinLine,
  RiSparklingLine,
  RiUserLine,
} from "@remixicon/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { formatPhoneNumber } from "@/lib/input-formatters";
import {
  FREQUENCIES,
  LEAD_SOURCES,
  START_TIMEFRAMES,
  intakeFieldsFor,
  type ProposalChecklists,
  type PropertyTypeDef,
} from "@/lib/proposal-request";
import { proposalApi } from "@/lib/proposal-request-api";
import { ChecklistField } from "@/components/proposals/ChecklistField";

interface SiteDraft {
  address: string;
  city: string;
  state: string;
  zip: string;
  nickname: string;
  clientStatedSqft: string;
}

const EMPTY_SITE = (): SiteDraft => ({ address: "", city: "", state: "", zip: "", nickname: "", clientStatedSqft: "" });

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2.5">
        <span className="w-6 h-6 rounded-full bg-violet-600 text-white text-[11px] font-bold flex items-center justify-center">
          {n}
        </span>
        <h2 className="text-sm font-bold text-slate-900">{title}</h2>
      </div>
      <div className="p-5 space-y-3">{children}</div>
    </section>
  );
}

export default function ProposalRequestIntake({
  catalog,
  onCreated,
}: {
  catalog: ProposalChecklists;
  onCreated: () => void;
}) {
  const types = catalog.types.filter((t) => t.active !== false);
  const [typeKey, setTypeKey] = useState<string>("");
  const type: PropertyTypeDef | null = types.find((t) => t.key === typeKey) || null;
  const intake = type ? intakeFieldsFor(catalog, type.key) : [];

  const [requesterName, setRequesterName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("");
  const [frequency, setFrequency] = useState("");
  const [timeframe, setTimeframe] = useState("");
  const [leadSource, setLeadSource] = useState("");
  const [sqft, setSqft] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [sites, setSites] = useState<SiteDraft[]>([EMPTY_SITE()]);
  const [intakeAnswers, setIntakeAnswers] = useState<Record<string, unknown>>({});
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const setSite = (i: number, patch: Partial<SiteDraft>) =>
    setSites((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  const missing = useMemo(() => {
    const m: string[] = [];
    if (!type) m.push("property type");
    if (!requesterName.trim()) m.push("requester name");
    if (!/.+@.+\..+/.test(email)) m.push("requester email");
    if (!sites.some((s) => s.address.trim())) m.push("at least one address");
    for (const item of intake) {
      if (item.required && (intakeAnswers[item.key] == null || intakeAnswers[item.key] === "")) {
        m.push(item.label);
      }
    }
    return m;
  }, [type, requesterName, email, sites, intake, intakeAnswers]);

  const addressPreview = sites
    .filter((s) => s.address.trim())
    .map((s) => [s.address, s.city, s.state].filter(Boolean).join(", "))
    .join("; ");

  const submit = async () => {
    if (missing.length || !type) {
      toast.error(`Still needed: ${missing.join(", ")}`);
      return;
    }
    setSubmitting(true);
    try {
      const out = await proposalApi.create({
        propertyTypeKey: type.key,
        requesterName,
        requesterCompany: company,
        requesterEmail: email,
        requesterPhone: phone,
        requesterRole: role,
        frequency,
        startTimeframe: timeframe,
        leadSource,
        clientStatedSqft: sqft,
        siteContactName: contactName || requesterName,
        siteContactPhone: contactPhone || phone,
        siteContactEmail: contactEmail || email,
        intakeAnswers,
        notes,
        sites: sites.filter((s) => s.address.trim()).map((s) => ({
          ...s,
          zip_code: s.zip,
        })),
      });
      toast.success(
        out.requesterEmailed
          ? "Proposal request in — requester emailed that a walkthrough agent is being assigned. This is not a booking."
          : "Proposal request saved. Requester email did not send — check templates / Resend.",
      );
      setTypeKey("");
      setRequesterName(""); setCompany(""); setEmail(""); setPhone(""); setRole("");
      setFrequency(""); setTimeframe(""); setLeadSource(""); setSqft("");
      setContactName(""); setContactPhone(""); setContactEmail("");
      setSites([EMPTY_SITE()]); setIntakeAnswers({}); setNotes("");
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the request");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_300px] gap-4 items-start">
      <div className="space-y-4">
        <Section n={1} title="Property type">
          <p className="text-xs text-slate-500 -mt-1">
            Routes the walkthrough agent&apos;s site findings (not the crew job list). Intake stays light — the on-site visit captures the rest.
          </p>
          <div className="grid sm:grid-cols-2 gap-2">
            {types.map((t) => {
              const on = typeKey === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => { setTypeKey(t.key); setIntakeAnswers({}); }}
                  className={cn(
                    "text-left rounded-xl border px-3 py-2.5 transition",
                    on ? "border-violet-500 bg-violet-50 ring-1 ring-violet-200" : "border-slate-200 bg-white hover:border-slate-300",
                  )}
                >
                  <p className="text-sm font-semibold text-slate-900">{t.label}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {t.accountKind === "str" ? "Links to an STR host record" : `Prospective ${t.accountKind} account`}
                  </p>
                </button>
              );
            })}
          </div>
        </Section>

        <Section n={2} title="Requester">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-slate-600">Name *</Label>
              <Input className="mt-1" value={requesterName} onChange={(e) => setRequesterName(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs text-slate-600">Company</Label>
              <Input className="mt-1" value={company} onChange={(e) => setCompany(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs text-slate-600">Email *</Label>
              <Input className="mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs text-slate-600">Phone</Label>
              <Input className="mt-1" value={phone} onChange={(e) => setPhone(formatPhoneNumber(e.target.value))} />
            </div>
            <div>
              <Label className="text-xs text-slate-600">Role</Label>
              <Input className="mt-1" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Owner, GM, property manager…" />
            </div>
            <div>
              <Label className="text-xs text-slate-600">How they found us</Label>
              <Select value={leadSource} onValueChange={setLeadSource}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Lead source" /></SelectTrigger>
                <SelectContent>
                  {LEAD_SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </Section>

        <Section n={3} title="Property address(es)">
          <p className="text-xs text-slate-500 -mt-1">A single request may cover several sites under one prospective account.</p>
          {sites.map((site, i) => (
            <div key={i} className="rounded-xl border border-slate-200 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                  <RiMapPinLine className="w-3.5 h-3.5" /> Site {i + 1}
                </p>
                {sites.length > 1 && (
                  <button type="button" className="text-slate-400 hover:text-rose-600" onClick={() => setSites((p) => p.filter((_, idx) => idx !== i))}>
                    <RiCloseLine className="w-4 h-4" />
                  </button>
                )}
              </div>
              <Input placeholder="Street address *" value={site.address} onChange={(e) => setSite(i, { address: e.target.value })} />
              <div className="grid grid-cols-6 gap-2">
                <Input className="col-span-3" placeholder="City" value={site.city} onChange={(e) => setSite(i, { city: e.target.value })} />
                <Input className="col-span-1" placeholder="ST" value={site.state} onChange={(e) => setSite(i, { state: e.target.value })} />
                <Input className="col-span-2" placeholder="ZIP" value={site.zip} onChange={(e) => setSite(i, { zip: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="Nickname (optional)" value={site.nickname} onChange={(e) => setSite(i, { nickname: e.target.value })} />
                <Input placeholder="Client-stated sqft" type="number" value={site.clientStatedSqft} onChange={(e) => setSite(i, { clientStatedSqft: e.target.value })} />
              </div>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => setSites((p) => [...p, EMPTY_SITE()])}>
            <RiAddLine className="w-4 h-4 mr-1" /> Add another site
          </Button>
          <div className="grid sm:grid-cols-3 gap-3 pt-1">
            <div>
              <Label className="text-xs text-slate-600">Approx. sqft (overall)</Label>
              <Input className="mt-1" type="number" value={sqft} onChange={(e) => setSqft(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs text-slate-600">Desired frequency</Label>
              <Select value={frequency} onValueChange={setFrequency}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Frequency" /></SelectTrigger>
                <SelectContent>
                  {FREQUENCIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-slate-600">Start timeframe</Label>
              <Select value={timeframe} onValueChange={setTimeframe}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="When" /></SelectTrigger>
                <SelectContent>
                  {START_TIMEFRAMES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </Section>

        {type && (
          <Section n={4} title={`${type.shortLabel} intake`}>
            {intake.length === 0 ? (
              <p className="text-xs text-slate-500">No extra intake questions for this type — the walkthrough captures the rest.</p>
            ) : (
              <div className="space-y-3">
                {intake.map((item) => (
                  <ChecklistField
                    key={item.key}
                    item={item}
                    value={intakeAnswers[item.key]}
                    onChange={(v) => setIntakeAnswers((a) => ({ ...a, [item.key]: v }))}
                  />
                ))}
              </div>
            )}
          </Section>
        )}

        <Section n={5} title="Walkthrough site contact">
          <p className="text-xs text-slate-500 -mt-1">May differ from the requester. Needed so the agent can get in.</p>
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs text-slate-600">Name</Label>
              <Input className="mt-1" value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder={requesterName || "Same as requester"} />
            </div>
            <div>
              <Label className="text-xs text-slate-600">Phone</Label>
              <Input className="mt-1" value={contactPhone} onChange={(e) => setContactPhone(formatPhoneNumber(e.target.value))} />
            </div>
            <div>
              <Label className="text-xs text-slate-600">Email</Label>
              <Input className="mt-1" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
            </div>
          </div>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the agent should know before they go." className="text-sm" />
        </Section>
      </div>

      <aside className="lg:sticky lg:top-4 space-y-3">
        <div className="rounded-2xl p-4 text-white shadow-sm" style={{ background: "linear-gradient(135deg,#5C0FFE,#6810FE)" }}>
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/80">Proposal request</p>
          <p className="text-lg font-bold mt-1">{type ? type.label : "Pick a type"}</p>
          <p className="text-xs text-white/80 mt-1 min-h-[2.5rem]">{addressPreview || "Address will show here"}</p>
          <p className="text-[11px] text-white/70 mt-2 flex items-start gap-1.5">
            <RiSparklingLine className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            Submitting does not create a job booking. It opens a walkthrough pipeline and emails the requester.
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
          <p className="text-xs font-semibold text-slate-700 flex items-center gap-1">
            <RiUserLine className="w-3.5 h-3.5" /> Still needed
          </p>
          {missing.length === 0 ? (
            <p className="text-xs text-emerald-700 flex items-center gap-1"><RiCheckLine className="w-3.5 h-3.5" /> Ready to submit</p>
          ) : (
            <ul className="text-xs text-slate-500 list-disc pl-4 space-y-0.5">
              {missing.map((m) => <li key={m}>{m}</li>)}
            </ul>
          )}
          <Button className="w-full mt-2" disabled={submitting || missing.length > 0} onClick={() => void submit()}>
            {submitting ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiBuilding2Line className="w-4 h-4 mr-1.5" />}
            Submit proposal request
          </Button>
        </div>
      </aside>
    </div>
  );
}
