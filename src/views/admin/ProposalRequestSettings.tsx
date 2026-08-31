"use client";

import { useState } from "react";
import { RiLoader4Line, RiSaveLine } from "@remixicon/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ProposalRequestSettings } from "@/lib/proposal-request";
import { proposalApi } from "@/lib/proposal-request-api";

export default function ProposalRequestSettings({
  settings,
  onSaved,
}: {
  settings: ProposalRequestSettings;
  onSaved: (next: ProposalRequestSettings) => void;
}) {
  const [local, setLocal] = useState(settings);
  const [saving, setSaving] = useState(false);
  const set = (p: Partial<ProposalRequestSettings>) => setLocal((s) => ({ ...s, ...p }));

  const save = async () => {
    setSaving(true);
    try {
      const out = await proposalApi.saveSettings({ settings: local });
      onSaved(out.settings);
      setLocal(out.settings);
      toast.success("Templates and walkthrough pay saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-bold text-slate-900">Requester emails &amp; walkthrough pay</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Placeholders: [Name] [property/address] [date] [time] [Agent name] [link]. Walkthrough assignment is paid whether or not the proposal converts. STR requests use a separate email — no agent is assigned.
          </p>
        </div>
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiSaveLine className="w-4 h-4 mr-1.5" />}
          Save
        </Button>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <div>
          <Label className="text-xs">Pay type</Label>
          <Select value={local.walkthroughPayType} onValueChange={(v) => set({ walkthroughPayType: v as "flat" | "hourly" })}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="flat">Flat fee</SelectItem>
              <SelectItem value="hourly">Hourly</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Flat fee ($)</Label>
          <Input className="mt-1" type="number" min={0} step="0.01"
            value={(local.walkthroughPayCents / 100).toFixed(2)}
            onChange={(e) => set({ walkthroughPayCents: Math.round(Number(e.target.value) * 100) })} />
        </div>
        <div>
          <Label className="text-xs">Hourly rate ($)</Label>
          <Input className="mt-1" type="number" min={0} step="0.01"
            value={(local.walkthroughHourlyCents / 100).toFixed(2)}
            onChange={(e) => set({ walkthroughHourlyCents: Math.round(Number(e.target.value) * 100) })} />
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Token lifetime (hours)</Label>
          <Input className="mt-1" type="number" min={24} value={local.tokenTtlHours} onChange={(e) => set({ tokenTtlHours: Number(e.target.value) })} />
        </div>
        <div>
          <Label className="text-xs">Admin notify email (optional)</Label>
          <Input className="mt-1" type="email" value={local.adminNotifyEmail} onChange={(e) => set({ adminNotifyEmail: e.target.value })} />
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Pending — assigning agent (office / commercial)</Label>
        <Input value={local.pendingEmailSubject} onChange={(e) => set({ pendingEmailSubject: e.target.value })} />
        <Textarea rows={6} value={local.pendingEmailBody} onChange={(e) => set({ pendingEmailBody: e.target.value })} className="text-sm" />
      </div>
      <div className="space-y-2">
        <Label className="text-xs">Pending — STR, no walkthrough (subject)</Label>
        <Input value={local.pendingStrEmailSubject} onChange={(e) => set({ pendingStrEmailSubject: e.target.value })} />
        <Textarea rows={5} value={local.pendingStrEmailBody} onChange={(e) => set({ pendingStrEmailBody: e.target.value })} className="text-sm" />
      </div>
      <div className="space-y-2">
        <Label className="text-xs">Walkthrough scheduled (subject)</Label>
        <Input value={local.scheduledEmailSubject} onChange={(e) => set({ scheduledEmailSubject: e.target.value })} />
        <Textarea rows={5} value={local.scheduledEmailBody} onChange={(e) => set({ scheduledEmailBody: e.target.value })} className="text-sm" />
      </div>
      <div className="space-y-2">
        <Label className="text-xs">Agent assignment email (subject)</Label>
        <Input value={local.agentEmailSubject} onChange={(e) => set({ agentEmailSubject: e.target.value })} />
        <Textarea rows={5} value={local.agentEmailBody} onChange={(e) => set({ agentEmailBody: e.target.value })} className="text-sm" />
      </div>
    </div>
  );
}
