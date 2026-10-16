"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { WEEKDAYS, type PayoutMethodDefinition, type PayoutSettings } from "@/lib/payout-methods";

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${data.session?.access_token || ""}`,
  };
}

const EMPTY_METHOD: PayoutMethodDefinition = {
  code: "",
  displayName: "",
  enabled: true,
  kind: "manual",
  recommended: false,
  sortOrder: 10,
  identifierFormat: "text",
  identifierLabel: "Identifier",
  contractorProvides: "The identifier for this method.",
  instructions: "Enter the identifier twice, and the name on the account.",
  summary: "Paid weekly on the pay run day.",
  countsTowardOwn1099: null,
};

export default function PayoutMethodSettings() {
  const [settings, setSettings] = useState<PayoutSettings | null>(null);
  const [ackText, setAckText] = useState("");
  const [report, setReport] = useState<{ byMethod: { methodCode: string; count: number }[]; noCompleteMethod: string[]; stalledAtPayout: number } | null>(null);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [totals, setTotals] = useState<{ methodCode: string; amountCents: number; count: number }[]>([]);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const headers = await authHeaders();
    const [settingsRes, monthRes] = await Promise.all([
      fetch("/api/admin/payout-methods", { headers }),
      fetch(`/api/admin/payout-methods?report=monthly&month=${month}`, { headers }),
    ]);
    const body = await settingsRes.json().catch(() => ({}));
    const monthBody = await monthRes.json().catch(() => ({}));
    if (!settingsRes.ok) {
      toast.error(body.error || "Couldn't load payout settings.");
      return;
    }
    setSettings(body.settings);
    setReport(body.report);
    const active = (body.settings?.acknowledgmentVersions || []).find((v: { id: string }) => v.id === body.settings.activeAcknowledgmentId);
    setAckText(active?.text || "");
    setTotals(monthBody.totals || []);
  };

  useEffect(() => {
    void load().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/payout-methods", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ action: "save_settings", settings, acknowledgmentText: ackText }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error || "Couldn't save.");
        return;
      }
      setSettings(body.settings);
      toast.success("Payout settings saved. Past payouts were not changed.");
    } finally {
      setSaving(false);
    }
  };

  const updateMethod = (code: string, patch: Partial<PayoutMethodDefinition>) => {
    if (!settings) return;
    setSettings({
      ...settings,
      methods: settings.methods.map((item) => (item.code === code ? { ...item, ...patch } : item)),
    });
  };

  if (!settings) return <p className="text-sm text-slate-500">Loading payout methods…</p>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payout methods</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-slate-600">
            Stripe stays first and recommended. The 1099 flag is unset until you and the accountant choose it. Saving here does not change payouts already recorded.
          </p>
          {settings.methods.map((item) => (
            <div key={item.code} className="rounded-lg border p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <p className="font-medium">{item.displayName}</p>
                <label className="text-sm flex items-center gap-1.5">
                  <input type="checkbox" checked={item.enabled} onChange={(e) => updateMethod(item.code, { enabled: e.target.checked })} />
                  Enabled
                </label>
                <label className="text-sm">
                  1099-NEC
                  <select
                    className="ml-2 border rounded px-2 py-1"
                    value={item.countsTowardOwn1099 === null ? "" : item.countsTowardOwn1099 ? "yes" : "no"}
                    onChange={(e) => updateMethod(item.code, { countsTowardOwn1099: e.target.value === "" ? null : e.target.value === "yes" })}
                  >
                    <option value="">Not set</option>
                    <option value="yes">Counts toward Novara's 1099</option>
                    <option value="no">Does not count</option>
                  </select>
                </label>
              </div>
              <Label className="text-xs">What the contractor provides</Label>
              <Input value={item.contractorProvides} onChange={(e) => updateMethod(item.code, { contractorProvides: e.target.value })} />
              <Label className="text-xs">Instructions</Label>
              <Input value={item.instructions} onChange={(e) => updateMethod(item.code, { instructions: e.target.value })} />
              <Label className="text-xs">One-line explanation</Label>
              <Input value={item.summary} onChange={(e) => updateMethod(item.code, { summary: e.target.value })} />
              {item.countsTowardOwn1099 !== null ? (
                <Button type="button" variant="outline" onClick={async () => {
                  const res = await fetch("/api/admin/payout-methods", {
                    method: "POST",
                    headers: await authHeaders(),
                    body: JSON.stringify({ action: "classify_unclassified", methodCode: item.code, include: item.countsTowardOwn1099 }),
                  });
                  const body = await res.json().catch(() => ({}));
                  if (!res.ok || body.ok === false) toast.error(body.error || "Couldn't classify payouts.");
                  else toast.success(`Classified ${body.payouts || 0} payout${body.payouts === 1 ? "" : "s"}.`);
                }}>
                  Apply this 1099 flag to unclassified {item.displayName} payouts
                </Button>
              ) : null}
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            onClick={() => setSettings({ ...settings, methods: [...settings.methods, { ...EMPTY_METHOD, code: `method_${settings.methods.length + 1}`, sortOrder: settings.methods.length }] })}
          >
            Add a method
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Pay run and protections</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Pay run day
            <select
              className="mt-1 block w-full border rounded px-2 py-1"
              value={settings.payRunWeekday}
              onChange={(e) => setSettings({ ...settings, payRunWeekday: Number(e.target.value) })}
            >
              {WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}
            </select>
          </label>
          <label className="text-sm">Hold window after a change (hours)
            <Input type="number" value={settings.changeHoldHours} onChange={(e) => setSettings({ ...settings, changeHoldHours: Number(e.target.value) })} />
          </label>
          <label className="text-sm">Aging alert after (days)
            <Input type="number" value={settings.agingDays} onChange={(e) => setSettings({ ...settings, agingDays: Number(e.target.value) })} />
          </label>
          <label className="text-sm">Reminder every (days)
            <Input type="number" value={settings.reminderIntervalDays} onChange={(e) => setSettings({ ...settings, reminderIntervalDays: Number(e.target.value) })} />
          </label>
          <label className="text-sm sm:col-span-2">Acknowledgment shown to contractors
            <textarea className="mt-1 w-full border rounded p-2 text-sm" rows={3} value={ackText} onChange={(e) => setAckText(e.target.value)} />
          </label>
          <p className="text-xs text-slate-500 sm:col-span-2">{settings.acknowledgmentVersions.length} acknowledgment version{settings.acknowledgmentVersions.length === 1 ? "" : "s"} kept.</p>
          <div className="flex gap-2">
            <Button type="button" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save settings"}</Button>
            <Button type="button" variant="outline" onClick={async () => {
              const res = await fetch("/api/admin/payout-methods", { method: "POST", headers: await authHeaders(), body: JSON.stringify({ action: "send_reminders" }) });
              const body = await res.json().catch(() => ({}));
              if (!res.ok) toast.error(body.error || "Couldn't send reminders.");
              else toast.success(`Sent ${body.sent || 0} reminder${body.sent === 1 ? "" : "s"}.`);
            }}>Send due reminders</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Payout method report</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {(report?.byMethod || []).map((row) => (
            <p key={row.methodCode}>{row.methodCode}: {row.count}</p>
          ))}
          <p>No complete method: {report?.noCompleteMethod.length || 0}</p>
          <p>Onboarding stalled at the payout step: {report?.stalledAtPayout || 0}</p>
          <div className="flex items-end gap-2 pt-2">
            <label className="text-sm">Month
              <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </label>
            <Button type="button" variant="outline" onClick={() => void load()}>Load totals</Button>
          </div>
          {totals.map((row) => (
            <p key={row.methodCode}>{row.methodCode}: ${(row.amountCents / 100).toFixed(2)} ({row.count})</p>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
