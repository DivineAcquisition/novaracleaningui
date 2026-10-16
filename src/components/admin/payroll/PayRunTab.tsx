"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

type Line = {
  id: string;
  cleaner_id: string;
  contractor_name?: string;
  method_code: string;
  identifier: string | null;
  amount_due_cents: number;
  amount_sent_cents: number | null;
  difference_reason: string | null;
  status: string;
  flags: string[];
  w9_legal_name: string | null;
  earnings?: { jobId: string | null; jobDate: string | null; amountCents: number; kind: string; reason: string | null; section: string | null }[];
};

type CannotPay = {
  cleanerId: string;
  contractorName: string;
  reasonText: string;
  amountCents: number;
};

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${data.session?.access_token || ""}`,
  };
}

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default function PayRunTab() {
  const [runId, setRunId] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [cannotPay, setCannotPay] = useState<CannotPay[]>([]);
  const [reminder, setReminder] = useState<string | null>(null);
  const [aging, setAging] = useState<string | null>(null);
  const [unclassified, setUnclassified] = useState<string[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, { amount: string; recipient: string; note: string; reason: string; reference: string }>>({});
  const [busy, setBusy] = useState(false);

  const applyPayload = (body: Record<string, unknown>) => {
    const run = body.run as { id?: string } | undefined;
    setRunId(run?.id || null);
    setLines((body.lines as Line[]) || []);
    setCannotPay((body.cannotPay as CannotPay[]) || []);
    const reminderBody = body.reminder as { body?: string } | null;
    const agingBody = body.aging as { body?: string } | null;
    setReminder(reminderBody?.body || null);
    setAging(agingBody?.body || null);
    const methods = (body.settings as { methods?: { displayName?: string; kind?: string; countsTowardOwn1099?: boolean | null }[] } | undefined)?.methods || [];
    setUnclassified(methods.filter((item) => item.kind === "manual" && item.countsTowardOwn1099 == null).map((item) => item.displayName || "A method"));
  };

  const load = async (create = false) => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/pay-runs", {
        method: create ? "POST" : "GET",
        headers: await authHeaders(),
        body: create ? JSON.stringify({ action: "create" }) : undefined,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error || "Couldn't build the pay run.");
        return;
      }
      applyPayload(body);
    } finally {
      setBusy(false);
    }
  };

  const draftFor = (line: Line) => drafts[line.id] || {
    amount: ((line.amount_due_cents || 0) / 100).toFixed(2),
    recipient: "",
    note: "",
    reason: "",
    reference: "",
  };

  const markPaid = async (ids: string[]) => {
    setBusy(true);
    try {
      const results = [];
      for (const lineId of ids) {
        const line = lines.find((row) => row.id === lineId);
        if (!line) continue;
        const draft = draftFor(line);
        const amountCents = Math.round(Number(draft.amount) * 100);
        const res = await fetch("/api/admin/pay-runs", {
          method: "POST",
          headers: await authHeaders(),
          body: JSON.stringify({
            action: "mark_paid",
            lineId,
            amountSentCents: Number.isFinite(amountCents) ? amountCents : undefined,
            recipientName: draft.recipient,
            mismatchNote: draft.note,
            differenceReason: draft.reason,
            confirmationRef: draft.reference,
            holdReleased: false,
          }),
        });
        const body = await res.json().catch(() => ({}));
        const result = body.results?.[0] || body;
        results.push(result);
        if (!result.ok) toast.error(result.error || "Couldn't mark that line paid.");
      }
      if (results.some((row) => row.ok)) toast.success("Recorded the payment.");
      await load(false);
    } finally {
      setBusy(false);
    }
  };

  const grouped = new Map<string, Line[]>();
  for (const line of lines) {
    const list = grouped.get(line.method_code) || [];
    list.push(line);
    grouped.set(line.method_code, list);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => void load(false)} disabled={busy}>Open pay run</Button>
        <Button type="button" variant="outline" onClick={() => void load(true)} disabled={busy}>Create pay run now</Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy || !runId}
          onClick={async () => {
            const res = await fetch("/api/admin/pay-runs", {
              method: "POST",
              headers: await authHeaders(),
              body: JSON.stringify({ action: "close", runId }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok || body.ok === false) toast.error(body.error || "Couldn't close the run.");
            else toast.success("Pay run closed. New earnings go to the next run.");
          }}
        >
          Close run
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy || !Object.values(selected).some(Boolean)}
          onClick={() => void markPaid(Object.entries(selected).filter(([, on]) => on).map(([id]) => id))}
        >
          Mark selected paid
        </Button>
      </div>
      {reminder ? <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">{reminder}</div> : null}
      {aging ? <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-950">{aging}</div> : null}
      {unclassified.length ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          The accountant has not set the 1099-NEC flag for {unclassified.join(", ")}. Set it before marking these paid. A payment recorded while the flag is unset stays unclassified until you apply the flag to those payouts.
        </div>
      ) : null}

      {[...grouped.entries()].map(([method, methodLines]) => (
        <Card key={method}>
          <CardHeader><CardTitle className="text-base capitalize">{method.replaceAll("_", " ")}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {methodLines.map((line) => {
              const draft = draftFor(line);
              const flags = line.flags || [];
              return (
                <div key={line.id} className="rounded-lg border p-3 space-y-2 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={Boolean(selected[line.id])} onChange={(e) => setSelected({ ...selected, [line.id]: e.target.checked })} />
                    <span className="font-medium">{line.contractor_name || "Contractor"}</span>
                    <span className="font-mono text-xs">{line.identifier || "No identifier"}</span>
                    <span>{money(line.amount_due_cents)}</span>
                    <span className="text-slate-500">{line.status}</span>
                  </label>
                  {flags.length ? <p className="text-xs text-amber-800">{flags.join(" · ").replaceAll("_", " ")}</p> : null}
                  {(line.earnings || []).map((earning, index) => (
                    <p key={`${earning.jobId || earning.kind}-${index}`} className="text-xs text-slate-600">
                      {earning.kind === "adjustment"
                        ? `${earning.section === "7.9" ? "Overpayment correction (section 7.9)" : "Adjustment"}: ${earning.reason || ""} · ${money(earning.amountCents)}`
                        : `${earning.jobId || "Job"}${earning.jobDate ? ` · ${earning.jobDate}` : ""} · ${money(earning.amountCents)}`}
                    </p>
                  ))}
                  {line.difference_reason ? <p className="text-xs">Difference: {line.difference_reason}</p> : null}
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input placeholder="Amount sent" value={draft.amount} onChange={(e) => setDrafts({ ...drafts, [line.id]: { ...draft, amount: e.target.value } })} />
                    <Input placeholder="Recipient name the app showed" value={draft.recipient} onChange={(e) => setDrafts({ ...drafts, [line.id]: { ...draft, recipient: e.target.value } })} />
                    <Input placeholder="Reason if the amount differs" value={draft.reason} onChange={(e) => setDrafts({ ...drafts, [line.id]: { ...draft, reason: e.target.value } })} />
                    <Input placeholder="Confirmation reference" value={draft.reference} onChange={(e) => setDrafts({ ...drafts, [line.id]: { ...draft, reference: e.target.value } })} />
                    <Input placeholder="Note if the name doesn't match the W-9" value={draft.note} onChange={(e) => setDrafts({ ...drafts, [line.id]: { ...draft, note: e.target.value } })} />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" disabled={busy || line.status === "paid"} onClick={() => void markPaid([line.id])}>Mark paid</Button>
                    {flags.includes("recent_change_hold") ? (
                      <Button type="button" size="sm" variant="outline" onClick={async () => {
                        await fetch("/api/admin/pay-runs", { method: "POST", headers: await authHeaders(), body: JSON.stringify({ action: "release_hold", lineId: line.id }) });
                        toast.success("Hold released for review.");
                        await load(false);
                      }}>Release hold</Button>
                    ) : null}
                    <Button type="button" size="sm" variant="outline" onClick={async () => {
                      const reason = window.prompt("Why did this payment fail?") || "";
                      const res = await fetch("/api/admin/pay-runs", { method: "POST", headers: await authHeaders(), body: JSON.stringify({ action: "fail", lineId: line.id, reason }) });
                      const body = await res.json().catch(() => ({}));
                      if (!res.ok || body.ok === false) toast.error(body.error || "Couldn't mark it failed.");
                      else toast.success("Earnings returned to unpaid.");
                      await load(false);
                    }}>Mark failed</Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader><CardTitle className="text-base">Cannot pay yet</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          {cannotPay.length === 0 ? <p className="text-slate-500">Nobody with approved earnings is blocked.</p> : null}
          {cannotPay.map((row) => (
            <p key={`${row.cleanerId}:${row.reasonText}`}>{row.contractorName} — {row.reasonText} — {money(row.amountCents)}</p>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
