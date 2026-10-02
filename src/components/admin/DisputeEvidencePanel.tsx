"use client";

import { useMemo, useState } from "react";
import { RiLoader4Line, RiShieldCheckLine } from "@remixicon/react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

interface GhlMessage {
  id?: string | null;
  at?: string | null;
  direction?: string | null;
  messageType?: string | null;
  body?: string | null;
  transcript?: string | null;
  callDurationSeconds?: number | null;
  callStatus?: string | null;
  source?: string | null;
}

export default function DisputeEvidencePanel({
  bookingId,
  bookingRef,
  booking,
  messages,
  photos,
  checklist,
  charges,
  acceptance,
}: {
  bookingId: string;
  bookingRef?: string | null;
  booking: Record<string, unknown>;
  messages?: GhlMessage[];
  photos?: Array<{ label: string; url?: string | null }>;
  checklist?: { completed_items?: number | null; total_items?: number | null } | null;
  charges?: Array<{ label: string; amountCents: number | null; paymentIntentId?: string | null; kind?: string | null }>;
  acceptance?: {
    signerName?: string | null;
    signedAt?: string | null;
    ip?: string | null;
    userAgent?: string | null;
    agreementVersion?: string | null;
    documentId?: string | null;
  } | null;
}) {
  const [disputeId, setDisputeId] = useState("");
  const [reason, setReason] = useState("product_unacceptable");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [readiness, setReadiness] = useState<Array<{ chargeKey: string; status: string; gaps: string[] }> | null>(null);

  const loadReadiness = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("dispute-evidence", {
        body: { action: "readiness", bookingId, chargeKey: String(booking.payment_intent_id || "") },
      });
      if (error) throw error;
      const payload = data as { ok?: boolean; error?: string; charges?: Array<{ chargeKey: string; status: string; gaps: string[] }> };
      if (payload?.ok === false) throw new Error(payload.error || "Failed");
      setReadiness(payload.charges || []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Readiness failed");
    } finally {
      setBusy(false);
    }
  };

  const mappedMessages = useMemo(() => (messages || []).map((m) => {
    const type = String(m.messageType || "").toUpperCase();
    const channel = type.includes("EMAIL") ? "email" : type.includes("CALL") ? "call" : "sms";
    return {
      id: m.id || m.at || "msg",
      at: m.at || null,
      direction: m.direction === "inbound" || m.direction === "customer" ? "customer" : "novara",
      channel,
      body: m.body || null,
      transcript: m.transcript || null,
      durationSeconds: m.callDurationSeconds ?? null,
      callStatus: m.callStatus || null,
      source: m.source || m.id || "ghl",
    };
  }), [messages]);

  const run = async (action: "preview" | "submit" | "accept_without_evidence") => {
    const id = disputeId.trim();
    if (!id) {
      toast.error("Enter the Stripe dispute id.");
      return;
    }
    if (action === "accept_without_evidence" && !note.trim()) {
      toast.error("A note is required to accept without evidence.");
      return;
    }
    setBusy(true);
    try {
      const address = [booking.address, booking.city, booking.state, booking.zip_code].filter(Boolean).join(", ");
      const { data, error } = await supabase.functions.invoke("dispute-evidence", {
        body: {
          action,
          bookingId,
          note,
          input: {
            disputeId: id,
            reason,
            evidenceDueAt: due || null,
            now: new Date().toISOString(),
            bookingRef: bookingRef || null,
            customerName: [booking.first_name, booking.last_name].filter(Boolean).join(" ") || booking.first_name || null,
            customerEmail: booking.email || null,
            billingAddress: address || null,
            serviceDescription: booking.service_type ? String(booking.service_type).replace(/_/g, " ") : null,
            serviceDate: booking.service_date || null,
            scheduledWindow: booking.time_slot || booking.arrival_window || null,
            finishedAt: booking.completed_at || null,
            checklistCompleted: checklist?.completed_items ?? null,
            checklistTotal: checklist?.total_items ?? null,
            photos: photos || [],
            messages: mappedMessages,
            acceptance: acceptance || null,
            charges: charges || [],
          },
        },
      });
      if (error) throw error;
      const payload = data as { ok?: boolean; error?: string };
      if (payload?.ok === false) throw new Error(payload.error || "Failed");
      setResult(data as Record<string, unknown>);
      toast.success(action === "preview" ? "Draft ready" : action === "submit" ? "Submitted once" : "Accepted without evidence");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Dispute evidence failed");
    } finally {
      setBusy(false);
    }
  };

  const budget = result?.budget as { ok?: boolean; pages?: number; bytes?: number; errors?: string[] } | undefined;
  const packets = (result?.packets as Array<{ filename: string; field: string; pages?: number; bytes?: number; trimmed?: boolean }> | undefined) || [];
  const warnings = (result?.warnings as string[] | undefined) || [];
  const over = budget?.ok === false;

  return (
    <section className="rounded-xl border border-slate-200 p-4 space-y-3">
      <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
        <RiShieldCheckLine className="w-4 h-4 text-violet-600" /> Stripe dispute evidence
      </p>
      <p className="text-xs text-slate-500">
        One file per evidence type: completion summary, communication, acceptance record, refund or cancellation policy, and a receipt only when the charge needs itemizing. Combined limit is 19 pages and 4.5 MB. The full agreement is not attached. Nothing is sent to Stripe until you approve.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <input className="border rounded px-2 py-1 text-xs" placeholder="Stripe dispute id" value={disputeId} onChange={(e) => setDisputeId(e.target.value)} />
        <select className="border rounded px-2 py-1 text-xs" value={reason} onChange={(e) => setReason(e.target.value)}>
          {["product_unacceptable", "fraudulent", "unrecognized", "product_not_received", "subscription_canceled", "credit_not_processed", "duplicate", "general"].map((r) => (
            <option key={r} value={r}>{r.replace(/_/g, " ")}</option>
          ))}
        </select>
        <input className="border rounded px-2 py-1 text-xs" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void loadReadiness()}>Readiness</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void run("preview")}>
          {busy ? <RiLoader4Line className="w-3 h-3 animate-spin" /> : "Build draft"}
        </Button>
        <Button size="sm" disabled={busy || over} onClick={() => void run("submit")}>Approve and submit once</Button>
      </div>
      <textarea className="w-full border rounded p-2 text-xs" rows={2} placeholder="Note required to accept without evidence" value={note} onChange={(e) => setNote(e.target.value)} />
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("accept_without_evidence")}>Accept dispute without evidence</Button>
      {budget && (
        <p className={`text-xs font-medium ${budget.ok ? "text-emerald-700" : "text-rose-600"}`}>
          {budget.pages} pages · {budget.bytes} bytes · limit 19 pages / 4.5 MB
          {budget.errors?.length ? ` · ${budget.errors.join(" ")}` : ""}
        </p>
      )}
      {packets.length > 0 && (
        <ul className="text-xs text-slate-600 space-y-1">
          {packets.map((p) => (
            <li key={p.filename}>{p.field}: {p.filename} · {p.pages} pages</li>
          ))}
        </ul>
      )}
      {warnings.length > 0 && (
        <ul className="text-xs text-amber-800 space-y-1">
          {warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
      {Array.isArray(result?.missing) && (result?.missing as string[]).length > 0 && (
        <p className="text-xs text-amber-700">Not recorded: {(result?.missing as string[]).join(", ")}</p>
      )}
      {typeof result?.narrative === "string" && result.narrative && (
        <p className="text-xs text-slate-600 whitespace-pre-wrap">{result.narrative}</p>
      )}
      {readiness && readiness.length === 0 && <p className="text-xs text-slate-500">Not ready. No prepared pieces are filed for this booking yet.</p>}
      {readiness?.map((row) => (
        <p key={row.chargeKey} className="text-xs text-slate-700">
          {row.chargeKey}: {row.status.replace(/_/g, " ")}{row.gaps.length ? ` — ${row.gaps.join("; ")}` : ""}
        </p>
      ))}
      {typeof result?.omittedMessages === "number" && (
        <p className="text-[11px] text-slate-500">{result.omittedMessages} routine messages omitted from the communication packet. The full history stays on the case.</p>
      )}
    </section>
  );
}
