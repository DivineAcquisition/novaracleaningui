"use client";

// ─── Partnership communications — Commercial hub → Home → Comms ────────────
//
// The shared log, versioned templates, and policy settings that sit under
// every host and commercial send. Tables are service-role only; this screen
// talks to /api/admin/partnership-comms.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RiLoader4Line,
  RiMailLine,
  RiRefreshLine,
  RiSaveLine,
  RiSearch2Line,
  RiSendPlaneLine,
} from "@remixicon/react";
import { format } from "date-fns";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { partnershipCommsApi } from "@/lib/partnership-comms-api";
import type {
  PartnershipCommsSettings,
  PartnershipMessageStatus,
  PartnershipTemplate,
} from "@/lib/partnership-comms/types";
import { DEFAULT_PARTNERSHIP_COMMS_SETTINGS } from "@/lib/partnership-comms/types";

interface LogRow {
  id: string;
  template_key: string;
  template_version: number | null;
  role: string;
  priority: string;
  channel: string;
  status: PartnershipMessageStatus | string;
  trigger_source: string;
  to_email: string | null;
  to_phone: string | null;
  subject: string | null;
  error: string | null;
  attempt_count: number;
  sent_at: string | null;
  created_at: string;
  escalated_at: string | null;
  provider: string | null;
}

const STATUS_TONE: Record<string, string> = {
  sent: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  queued: "bg-amber-50 text-amber-800 ring-amber-200",
  retry: "bg-amber-50 text-amber-800 ring-amber-200",
  sending: "bg-sky-50 text-sky-800 ring-sky-200",
  failed: "bg-rose-50 text-rose-800 ring-rose-200",
  suppressed: "bg-slate-100 text-slate-600 ring-slate-200",
};

type Pane = "log" | "templates" | "settings";

export default function PartnershipComms() {
  const [pane, setPane] = useState<Pane>("log");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<LogRow[]>([]);
  const [templates, setTemplates] = useState<PartnershipTemplate[]>([]);
  const [settings, setSettings] = useState<PartnershipCommsSettings>(DEFAULT_PARTNERSHIP_COMMS_SETTINGS);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [draft, setDraft] = useState<PartnershipTemplate | null>(null);
  const [saving, setSaving] = useState(false);
  const [draining, setDraining] = useState(false);

  const load = useCallback(async (search = q, st = status) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("q", search.trim());
      if (st && st !== "all") params.set("status", st);
      const out = await partnershipCommsApi.load(params.toString() ? `?${params}` : "");
      setMessages((out.messages || []) as LogRow[]);
      const tpls = (out.templates || []) as PartnershipTemplate[];
      setTemplates(tpls);
      if (out.settings) setSettings(out.settings);
      setSelectedKey((prev) => {
        if (prev && tpls.some((t) => t.key === prev)) return prev;
        return tpls[0]?.key || "";
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load partnership comms");
    } finally {
      setLoading(false);
    }
  }, [q, status]);

  useEffect(() => {
    void load();
    // initial load only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = templates.find((x) => x.key === selectedKey) || null;
    setDraft(t ? { ...t } : null);
  }, [selectedKey, templates]);

  const saveSettings = async () => {
    setSaving(true);
    try {
      const out = await partnershipCommsApi.saveSettings(settings);
      setSettings(out.settings);
      toast.success("Quiet hours, caps, and senders saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save settings");
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    if (!draft?.key) return;
    setSaving(true);
    try {
      await partnershipCommsApi.publishTemplate(draft);
      toast.success(`Published ${draft.key} v${Number(draft.version || 0) + 1}. Past sends keep their original copy.`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not publish template");
    } finally {
      setSaving(false);
    }
  };

  const drain = async () => {
    setDraining(true);
    try {
      const out = await partnershipCommsApi.drain();
      toast.success(`Drained ${out.processed || 0} queued message${out.processed === 1 ? "" : "s"}.`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Drain failed");
    } finally {
      setDraining(false);
    }
  };

  const panes: Array<{ id: Pane; label: string }> = [
    { id: "log", label: "Delivery log" },
    { id: "templates", label: "Templates" },
    { id: "settings", label: "Policy" },
  ];

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const m of messages) c[m.status] = (c[m.status] || 0) + 1;
    return c;
  }, [messages]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h2 className="font-bold text-slate-900">Partnership communications</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Every host and commercial send goes through this layer — one log, one template store,
            opt-outs and quiet hours enforced centrally.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiRefreshLine className="w-4 h-4 mr-1.5" />}
          Refresh
        </Button>
      </div>

      <nav className="flex flex-wrap gap-1">
        {panes.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPane(p.id)}
            className={cn(
              "rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
              pane === p.id
                ? "bg-violet-50 text-violet-800 ring-1 ring-violet-200"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-800",
            )}
          >
            {p.label}
          </button>
        ))}
      </nav>

      {pane === "log" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
          <form
            className="flex flex-col sm:flex-row gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void load();
            }}
          >
            <div className="relative flex-1">
              <RiSearch2Line className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                className="pl-9"
                placeholder="Search host, commercial account, email, or phone"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <Select value={status} onValueChange={(v) => { setStatus(v); void load(q, v); }}>
              <SelectTrigger className="sm:w-40"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {["sent", "queued", "retry", "failed", "suppressed", "sending"].map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" disabled={loading}>Search</Button>
            <Button type="button" variant="outline" onClick={() => void drain()} disabled={draining}>
              {draining ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiSendPlaneLine className="w-4 h-4 mr-1.5" />}
              Drain queue
            </Button>
          </form>
          <p className="text-xs text-slate-500">
            {loading ? "Loading…" : `${messages.length} message${messages.length === 1 ? "" : "s"}`}
            {Object.keys(statusCounts).length > 0 && (
              <span>
                {" "}· {Object.entries(statusCounts).map(([k, v]) => `${v} ${k}`).join(", ")}
              </span>
            )}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400 border-b">
                  <th className="py-2 pr-3">When</th>
                  <th className="py-2 pr-3">Recipient</th>
                  <th className="py-2 pr-3">Channel</th>
                  <th className="py-2 pr-3">Template</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2">Trigger</th>
                </tr>
              </thead>
              <tbody>
                {messages.map((m) => (
                  <tr key={m.id} className="border-b border-slate-100 align-top">
                    <td className="py-2 pr-3 whitespace-nowrap text-slate-500">
                      {format(new Date(m.sent_at || m.created_at), "MMM d, h:mm a")}
                    </td>
                    <td className="py-2 pr-3">
                      <div className="font-medium text-slate-800">{m.to_email || m.to_phone || "—"}</div>
                      {m.to_email && m.to_phone && (
                        <div className="text-xs text-slate-400">{m.to_phone}</div>
                      )}
                    </td>
                    <td className="py-2 pr-3 uppercase text-xs font-semibold text-slate-500">{m.channel}</td>
                    <td className="py-2 pr-3">
                      <div className="font-mono text-xs">{m.template_key}</div>
                      <div className="text-xs text-slate-400">
                        v{m.template_version ?? "—"} · {m.priority}
                        {m.escalated_at ? " · escalated" : ""}
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1", STATUS_TONE[m.status] || STATUS_TONE.suppressed)}>
                        {m.status}
                      </span>
                      {m.error && <div className="text-[11px] text-rose-600 mt-1 max-w-[180px] truncate">{m.error}</div>}
                    </td>
                    <td className="py-2 text-xs text-slate-500">{m.trigger_source}</td>
                  </tr>
                ))}
                {!loading && messages.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400">
                      No partnership messages match this search.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pane === "templates" && draft && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="flex-1">
              <Label className="text-xs">Template</Label>
              <Select value={selectedKey} onValueChange={setSelectedKey}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.key} value={t.key}>
                      {t.key} (v{t.version})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => void publish()} disabled={saving}>
              {saving ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiSaveLine className="w-4 h-4 mr-1.5" />}
              Publish new version
            </Button>
          </div>
          <p className="text-xs text-slate-500">
            Placeholders: <code>{"{{first_name}}"}</code> <code>{"{{link}}"}</code> <code>{"{{property}}"}</code>{" "}
            and Proposals-tab aliases like <code>[Name]</code> <code>[link]</code>. Publishing creates a new
            version; the log keeps what was actually sent.
          </p>
          {draft.description && <p className="text-sm text-slate-600">{draft.description}</p>}
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Role</Label>
              <Select value={draft.role} onValueChange={(v) => setDraft({ ...draft, role: v as PartnershipTemplate["role"] })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="partner">Partner (host / client)</SelectItem>
                  <SelectItem value="walkthrough_agent">Walkthrough agent</SelectItem>
                  <SelectItem value="admin">Admin / ops</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Priority</Label>
              <Select value={draft.priority} onValueChange={(v) => setDraft({ ...draft, priority: v as PartnershipTemplate["priority"] })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="urgent">Urgent (quiet-hours exempt)</SelectItem>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="routine">Routine</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Channels (comma: email, sms)</Label>
              <Input
                className="mt-1"
                value={(draft.channels || []).join(", ")}
                onChange={(e) => setDraft({
                  ...draft,
                  channels: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) as PartnershipTemplate["channels"],
                })}
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">Subject</Label>
            <Input className="mt-1" value={draft.subject || ""} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">HTML body</Label>
            <Textarea className="mt-1 font-mono text-xs" rows={10} value={draft.html || ""} onChange={(e) => setDraft({ ...draft, html: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">SMS body</Label>
            <Textarea className="mt-1 text-sm" rows={4} value={draft.sms_body || ""} onChange={(e) => setDraft({ ...draft, sms_body: e.target.value })} />
          </div>
        </div>
      )}
      {pane === "templates" && !draft && (
        <p className="text-sm text-slate-500 py-8 text-center">No templates loaded.</p>
      )}

      {pane === "settings" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-bold text-slate-900">Quiet hours, caps, senders</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Urgent sends (crew-lead heads-up, time-critical walkthrough assignment) skip quiet hours and caps.
                STOP on SMS and email unsubscribe are honored even for urgent.
              </p>
            </div>
            <Button onClick={() => void saveSettings()} disabled={saving}>
              {saving ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiSaveLine className="w-4 h-4 mr-1.5" />}
              Save
            </Button>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Timezone</Label>
              <Input className="mt-1" value={settings.timezone} onChange={(e) => setSettings({ ...settings, timezone: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Quiet hours start</Label>
              <Input className="mt-1" value={settings.quiet_hours_start} onChange={(e) => setSettings({ ...settings, quiet_hours_start: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Quiet hours end</Label>
              <Input className="mt-1" value={settings.quiet_hours_end} onChange={(e) => setSettings({ ...settings, quiet_hours_end: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Frequency cap (count)</Label>
              <Input className="mt-1" type="number" min={1} value={settings.frequency_cap_count} onChange={(e) => setSettings({ ...settings, frequency_cap_count: Number(e.target.value) })} />
            </div>
            <div>
              <Label className="text-xs">Frequency cap window (hours)</Label>
              <Input className="mt-1" type="number" min={1} value={settings.frequency_cap_hours} onChange={(e) => setSettings({ ...settings, frequency_cap_hours: Number(e.target.value) })} />
            </div>
            <div>
              <Label className="text-xs">Partners origin (unsubscribe links)</Label>
              <Input className="mt-1" value={settings.partners_origin} onChange={(e) => setSettings({ ...settings, partners_origin: e.target.value })} />
            </div>
          </div>
          {(["partner", "walkthrough_agent", "admin"] as const).map((role) => (
            <div key={role} className="grid sm:grid-cols-2 gap-3 rounded-xl border border-slate-100 p-3">
              <div className="sm:col-span-2 text-xs font-semibold uppercase tracking-wide text-slate-400 flex items-center gap-1.5">
                <RiMailLine className="w-3.5 h-3.5" />
                {role === "partner" ? "Host / commercial client" : role === "walkthrough_agent" ? "Walkthrough agent" : "Admin"}
              </div>
              <div>
                <Label className="text-xs">From</Label>
                <Input
                  className="mt-1"
                  value={settings.senders[role].from}
                  onChange={(e) => setSettings({
                    ...settings,
                    senders: { ...settings.senders, [role]: { ...settings.senders[role], from: e.target.value } },
                  })}
                />
              </div>
              <div>
                <Label className="text-xs">Reply-to</Label>
                <Input
                  className="mt-1"
                  value={settings.senders[role].reply_to}
                  onChange={(e) => setSettings({
                    ...settings,
                    senders: { ...settings.senders, [role]: { ...settings.senders[role], reply_to: e.target.value } },
                  })}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
