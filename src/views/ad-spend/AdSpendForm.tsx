"use client";

import { RiCheckLine, RiLoader4Line, RiMegaphoneLine } from "@remixicon/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ChannelEntry } from "@/lib/ad-spend/platforms";
import { PLATFORM_HELP, type PaidPlatform } from "@/lib/ad-spend/platforms";

type Boot = {
  ok: boolean;
  error?: string;
  periodStart: string;
  periodEnd: string;
  rangeLabel: string;
  status: string;
  submittedAt: string | null;
  platforms: PaidPlatform[];
  entries: ChannelEntry[];
};

export default function AdSpendForm({ token }: { token: string }) {
  const [boot, setBoot] = useState<Boot | null>(null);
  const [entries, setEntries] = useState<ChannelEntry[]>([]);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ad-spend?token=${encodeURIComponent(token)}`);
      const json = (await res.json()) as Boot;
      if (!res.ok || !json.ok) {
        setBoot({ ...(json as Boot), ok: false, error: json.error || "Could not open this form." } as Boot);
        return;
      }
      setBoot(json);
      setEntries(json.entries);
      setDone(json.status === "submitted");
    } catch (err) {
      setBoot({
        ok: false,
        error: err instanceof Error ? err.message : "Could not open this form.",
      } as Boot);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = (platform: PaidPlatform, field: keyof ChannelEntry, value: string) => {
    setEntries((prev) => prev.map((row) => (row.platform === platform ? { ...row, [field]: value } : row)));
  };

  const submit = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/ad-spend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, entries, email: email.trim() || undefined }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; platforms?: string[] };
      if (!res.ok || json.ok === false) throw new Error(json.error || "Submit failed");
      setDone(true);
      toast.success(`Saved ${json.platforms?.join(", ") || "spend"} to the sheet and Airtable.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAFAFC] flex items-center justify-center text-sm text-slate-500">
        Loading this month’s ad spend form…
      </div>
    );
  }

  if (!boot?.ok) {
    return (
      <div className="min-h-screen bg-[#FAFAFC] flex items-center justify-center p-6">
        <Card className="max-w-md p-6 text-sm text-slate-600">{boot?.error || "This link is invalid."}</Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAFAFC]">
      <div className="bg-gradient-to-br from-[#5C0FFE] to-[#8F7BFD] text-white px-5 py-8">
        <div className="max-w-2xl mx-auto">
          <p className="text-[11px] uppercase tracking-[0.14em] font-semibold text-white/80">Novara Cleaning</p>
          <h1 className="font-jakarta text-2xl font-bold mt-1">Monthly ad spend log</h1>
          <p className="text-sm text-white/90 mt-2">{boot.rangeLabel}</p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-5 py-6 space-y-4">
        <p className="text-sm text-slate-600">
          Totals for the whole month. Paid channels we already track: Facebook, LSA, Google, Instagram.
          Leave a channel blank if it wasn’t running. Enter{" "}
          <span className="font-medium text-slate-800">0</span> if it ran but spent nothing. Submitting
          writes the P&amp;L Google Sheet and Airtable.
        </p>

        {done && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            <RiCheckLine className="w-4 h-4" />
            Saved. You can still correct numbers and submit again.
          </div>
        )}

        {entries.map((row) => (
          <Card key={row.platform} className="p-4 space-y-3 border-slate-200">
            <div className="flex items-start gap-2">
              <span className="w-8 h-8 rounded-lg bg-[#5C0FFE]/10 text-[#5C0FFE] inline-flex items-center justify-center shrink-0">
                <RiMegaphoneLine className="w-4 h-4" />
              </span>
              <div>
                <p className="font-medium text-slate-900">{row.platform}</p>
                <p className="text-xs text-slate-500">{PLATFORM_HELP[row.platform]}</p>
              </div>
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              <label className="text-xs text-slate-600 space-y-1">
                <span>Spend ($)</span>
                <Input
                  inputMode="decimal"
                  placeholder="blank = skip"
                  value={row.spend_dollars}
                  onChange={(e) => patch(row.platform, "spend_dollars", e.target.value)}
                />
              </label>
              <label className="text-xs text-slate-600 space-y-1">
                <span>Leads / calls</span>
                <Input
                  inputMode="numeric"
                  value={row.leads_calls}
                  onChange={(e) => patch(row.platform, "leads_calls", e.target.value)}
                />
              </label>
              <label className="text-xs text-slate-600 space-y-1">
                <span>Booked jobs</span>
                <Input
                  inputMode="numeric"
                  value={row.booked_jobs}
                  onChange={(e) => patch(row.platform, "booked_jobs", e.target.value)}
                />
              </label>
            </div>
            <label className="text-xs text-slate-600 space-y-1 block">
              <span>Campaign / notes</span>
              <Textarea
                rows={2}
                value={row.campaign_notes}
                onChange={(e) => patch(row.platform, "campaign_notes", e.target.value)}
              />
            </label>
          </Card>
        ))}

        <div className="space-y-2">
          <Label className="text-xs text-slate-500">Your email (optional, so we know who filed this)</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@novaracleaning.com" />
        </div>

        <Button
          className="w-full bg-[#5C0FFE] hover:bg-[#4c0cd4] text-white h-11"
          disabled={saving}
          onClick={() => void submit()}
        >
          {saving ? <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" /> : null}
          Save to sheet &amp; Airtable
        </Button>
      </div>
    </div>
  );
}
