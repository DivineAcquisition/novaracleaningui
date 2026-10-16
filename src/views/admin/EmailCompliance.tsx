"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Identity = {
  legalName: string;
  brandName: string;
  mailingAddress: { line1: string; line2: string; city: string; region: string; postalCode: string; country: string };
  supportEmail: string;
  phone: string;
  website: string;
  privacyUrl: string;
  termsUrl: string;
  publicOrigin: string;
  licenseLine: string;
  retentionMonths: number;
  service: { displayName: string; address: string; replyTo: string; streamKey: string };
  billing: { displayName: string; address: string; replyTo: string; streamKey: string };
  marketing: { displayName: string; address: string; replyTo: string; streamKey: string };
  contractor: { displayName: string; address: string; replyTo: string };
  why: Record<string, string>;
};

type Claim = { id: string; phrase: string; basis: string; conditional: boolean; requiredWording: string; active: boolean };
type CatalogRow = { key: string; name: string; assignedType: string; ownerDecisionNeeded: boolean; changed: string; external: boolean; routed: boolean; senderBefore: string; promotionalBefore: boolean; unsubscribeBefore: boolean };

async function call(method: string, body?: unknown) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch("/api/admin/email-compliance", {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out.ok === false) throw new Error(out.error || "Request failed");
  return out;
}

const TYPES = [
  "customer_service",
  "customer_marketing",
  "agreement_account",
  "contractor_operational",
  "contractor_tax",
  "internal_admin",
];

export default function EmailCompliance() {
  const [loading, setLoading] = useState(true);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [audit, setAudit] = useState<{ findings: Array<{ id: string; status: string; title: string; detail: string }>; setupTasks: string[] } | null>(null);
  const [catalog, setCatalog] = useState<CatalogRow[]>([]);
  const [log, setLog] = useState<Array<Record<string, string>>>([]);
  const [suppression, setSuppression] = useState<Array<Record<string, string>>>([]);
  const [previewType, setPreviewType] = useState("customer_service");
  const [preview, setPreview] = useState<{ html: string; darkHtml: string; text: string } | null>(null);
  const [testTo, setTestTo] = useState("");
  const [sampleHtml, setSampleHtml] = useState("<p>Your cleaning on Tuesday is confirmed.</p>");

  const load = async () => {
    setLoading(true);
    try {
      const out = await call("GET");
      setIdentity(out.identity);
      setClaims(out.claims || []);
      setAudit(out.audit);
      setCatalog(out.catalog || []);
      setLog(out.deliveryLog || []);
      setSuppression(out.suppression || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load email settings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const saveIdentity = async () => {
    try {
      const out = await call("POST", { action: "save_identity", identity });
      setIdentity(out.identity);
      toast.success("Business details saved. New mail uses this footer.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    }
  };

  const saveClaims = async () => {
    try {
      const out = await call("POST", { action: "save_claims", claims });
      setClaims(out.claims);
      toast.success("Claims saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save claims");
    }
  };

  const runPreview = async () => {
    try {
      const out = await call("POST", { action: "preview", emailType: previewType, html: sampleHtml, subject: "Preview" });
      setPreview(out.footer);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not preview");
    }
  };

  const testSend = async () => {
    try {
      await call("POST", { action: "test_send", to: testTo, emailType: previewType, html: sampleHtml, subject: "Test from Novara" });
      toast.success("Test sent");
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test was not sent");
    }
  };

  if (loading || !identity) return <p className="p-6 text-sm text-slate-500">Loading email settings…</p>;

  const address = identity.mailingAddress;
  const setAddress = (key: keyof Identity["mailingAddress"], value: string) =>
    setIdentity({ ...identity, mailingAddress: { ...address, [key]: value } });

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Email</h1>
        <p className="mt-1 text-sm text-slate-600">Every send has one type. The type builds the footer from these details.</p>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">What was already here</h2>
        <div className="mt-3 space-y-3">
          {(audit?.findings || []).map((finding) => (
            <div key={finding.id}>
              <p className="text-sm font-medium">{finding.title} <span className="text-xs uppercase text-slate-500">{finding.status}</span></p>
              <p className="text-sm text-slate-600">{finding.detail}</p>
            </div>
          ))}
        </div>
        <h3 className="mt-4 text-sm font-semibold">Setup still waiting on the owner</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
          {(audit?.setupTasks || []).map((task) => <li key={task}>{task}</li>)}
        </ul>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <h2 className="font-semibold">Business details</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Legal name" value={identity.legalName} onChange={(value) => setIdentity({ ...identity, legalName: value })} />
          <Field label="Brand name" value={identity.brandName} onChange={(value) => setIdentity({ ...identity, brandName: value })} />
          <Field label="Street" value={address.line1} onChange={(value) => setAddress("line1", value)} />
          <Field label="Line 2" value={address.line2} onChange={(value) => setAddress("line2", value)} />
          <Field label="City" value={address.city} onChange={(value) => setAddress("city", value)} />
          <Field label="State" value={address.region} onChange={(value) => setAddress("region", value)} />
          <Field label="Postal code" value={address.postalCode} onChange={(value) => setAddress("postalCode", value)} />
          <Field label="Support email" value={identity.supportEmail} onChange={(value) => setIdentity({ ...identity, supportEmail: value })} />
          <Field label="Phone" value={identity.phone} onChange={(value) => setIdentity({ ...identity, phone: value })} />
          <Field label="Website" value={identity.website} onChange={(value) => setIdentity({ ...identity, website: value })} />
          <Field label="Privacy link" value={identity.privacyUrl} onChange={(value) => setIdentity({ ...identity, privacyUrl: value })} />
          <Field label="Terms link" value={identity.termsUrl} onChange={(value) => setIdentity({ ...identity, termsUrl: value })} />
          <Field label="License line (optional)" value={identity.licenseLine} onChange={(value) => setIdentity({ ...identity, licenseLine: value })} />
          <Field label="Keep sent mail (months)" value={String(identity.retentionMonths)} onChange={(value) => setIdentity({ ...identity, retentionMonths: Number(value) || 24 })} />
        </div>
        <p className="text-xs text-slate-500">Marketing cannot send while the street, city, state, and postal code are empty. Service mail still sends.</p>
        <h3 className="text-sm font-semibold">Senders</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <SenderFields title="Support" sender={identity.service} onChange={(service) => setIdentity({ ...identity, service: { ...identity.service, ...service } })} />
          <SenderFields title="Billing" sender={identity.billing} onChange={(billing) => setIdentity({ ...identity, billing: { ...identity.billing, ...billing } })} />
          <SenderFields title="Marketing" sender={identity.marketing} onChange={(marketing) => setIdentity({ ...identity, marketing: { ...identity.marketing, ...marketing } })} />
          <SenderFields title="Contractor" sender={identity.contractor} onChange={(contractor) => setIdentity({ ...identity, contractor })} />
        </div>
        <Button onClick={() => void saveIdentity()}>Save business details</Button>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <h2 className="font-semibold">Approved claims</h2>
        <p className="text-sm text-slate-600">A marketing template that uses a claim with no basis cannot be saved or sent. Leave the basis blank until you can stand behind it.</p>
        {claims.map((claim, index) => (
          <div key={claim.id} className="grid gap-2 rounded-xl border border-slate-100 p-3 sm:grid-cols-2">
            <Field label="Phrase" value={claim.phrase} onChange={(phrase) => setClaims(claims.map((row, i) => i === index ? { ...row, phrase } : row))} />
            <Field label="Basis" value={claim.basis} onChange={(basis) => setClaims(claims.map((row, i) => i === index ? { ...row, basis, active: Boolean(basis.trim()) } : row))} />
            <Field label="Required wording if it is only true sometimes" value={claim.requiredWording} onChange={(requiredWording) => setClaims(claims.map((row, i) => i === index ? { ...row, requiredWording, conditional: Boolean(requiredWording.trim()) } : row))} />
          </div>
        ))}
        <Button variant="outline" onClick={() => setClaims([...claims, { id: `claim_${claims.length + 1}`, phrase: "", basis: "", conditional: false, requiredWording: "", active: false }])}>Add a claim</Button>
        <Button onClick={() => void saveClaims()}>Save claims</Button>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <h2 className="font-semibold">Templates</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase text-slate-500">
                <th className="py-2 pr-3">Template</th>
                <th className="py-2 pr-3">Type</th>
                <th className="py-2">What changed</th>
              </tr>
            </thead>
            <tbody>
              {catalog.map((row) => (
                <tr key={row.key} className="border-t border-slate-100 align-top">
                  <td className="py-2 pr-3">
                    <div className="font-medium">{row.name}</div>
                    <div className="text-xs text-slate-500">{row.ownerDecisionNeeded ? "Waiting on the owner" : row.external ? "Sent outside this app" : row.routed ? "On the shared sender" : "Type assigned; this send still calls Resend directly"}</div>
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">{row.assignedType.replace(/_/g, " ")}</td>
                  <td className="py-2 text-slate-600">{row.changed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <h2 className="font-semibold">Preview and test</h2>
        <Label>Type</Label>
        <select className="h-10 rounded-md border border-slate-200 px-3 text-sm" value={previewType} onChange={(event) => setPreviewType(event.target.value)}>
          {TYPES.map((type) => <option key={type} value={type}>{type.replace(/_/g, " ")}</option>)}
        </select>
        <Label>Sample body</Label>
        <Textarea value={sampleHtml} onChange={(event) => setSampleHtml(event.target.value)} rows={4} />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void runPreview()}>Show footer</Button>
        </div>
        {preview ? (
          <div className="grid gap-3 lg:grid-cols-2">
            <Frame title="Footer" html={preview.html} />
            <Frame title="Dark mode" html={preview.darkHtml} dark />
            <pre className="lg:col-span-2 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-xs text-slate-700">{preview.text}</pre>
          </div>
        ) : null}
        <Field label="Send a test to" value={testTo} onChange={setTestTo} />
        <Button onClick={() => void testSend()}>Send test</Button>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">Suppression</h2>
        <p className="mt-1 text-sm text-slate-600">An admin cannot put an address back on the marketing list. The person resubscribes from their preference link. Text status is not changed here.</p>
        <ul className="mt-3 space-y-1 text-sm">
          {suppression.length === 0 ? <li className="text-slate-500">No suppressed addresses.</li> : null}
          {suppression.map((row) => (
            <li key={row.email}>{row.email} · {row.reason} · {row.source}</li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">Delivery log</h2>
        <ul className="mt-3 space-y-1 text-sm">
          {log.length === 0 ? <li className="text-slate-500">Nothing sent through this layer yet.</li> : null}
          {log.map((row) => (
            <li key={row.id}>{row.sent_at} · {row.email_type} · {row.status} · {row.contact_email} · {row.subject}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-sm">
      <Label className="mb-1 block">{label}</Label>
      <Input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function SenderFields({
  title,
  sender,
  onChange,
}: {
  title: string;
  sender: { displayName: string; address: string; replyTo: string };
  onChange: (next: { displayName: string; address: string; replyTo: string }) => void;
}) {
  return (
    <div className="space-y-2 rounded-xl bg-slate-50 p-3">
      <p className="text-sm font-medium">{title}</p>
      <Input value={sender.displayName} onChange={(event) => onChange({ ...sender, displayName: event.target.value })} placeholder="Display name" />
      <Input value={sender.address} onChange={(event) => onChange({ ...sender, address: event.target.value })} placeholder="Address" />
      <Input value={sender.replyTo} onChange={(event) => onChange({ ...sender, replyTo: event.target.value })} placeholder="Reply-to" />
    </div>
  );
}

function Frame({ title, html, dark }: { title: string; html: string; dark?: boolean }) {
  const doc = `<!doctype html><html><body style="margin:0;background:${dark ? "#18181b" : "#ffffff"};">${html}</body></html>`;
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-slate-500">{title}</p>
      <iframe title={title} className="h-64 w-full rounded-xl border border-slate-200" srcDoc={doc} />
    </div>
  );
}
