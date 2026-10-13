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
  drive,
}: {
  bookingId: string;
  bookingRef?: string | null;
  booking: Record<string, unknown>;
  messages?: GhlMessage[];
  photos?: Array<{ label: string; url?: string | null; phase?: string | null; room?: string | null; takenAt?: string | null; jobId?: string | null }>;
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
  drive?: {
    folderUrl?: string | null;
    summaryUrl?: string | null;
    agreementUrl?: string | null;
  } | null;
}) {
  const [disputeId, setDisputeId] = useState("");
  const [reason, setReason] = useState("product_unacceptable");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [narrative, setNarrative] = useState("");
  const [lossCause, setLossCause] = useState("reason_code_not_answered");
  const [lossNote, setLossNote] = useState("");
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

  const run = async (action: "preview" | "submit" | "stage" | "accept_without_evidence" | "loss_review" | "withdrawal_draft") => {
    const id = disputeId.trim();
    if (!id) {
      toast.error("Enter the Stripe dispute id.");
      return;
    }
    if (action === "accept_without_evidence" && !note.trim()) {
      toast.error("A note is required to accept without evidence.");
      return;
    }
    if (action === "loss_review" && !lossNote.trim()) {
      toast.error("A note is required for a lost-dispute review.");
      return;
    }
    setBusy(true);
    try {
      const address = [booking.address, booking.city, booking.state, booking.zip_code].filter(Boolean).join(", ");
      const chargeCents = charges?.find((charge) => charge.amountCents != null)?.amountCents
        ?? (typeof booking.final_charge_cents === "number" ? booking.final_charge_cents : null)
        ?? (typeof booking.total_estimate_cents === "number" ? booking.total_estimate_cents : null);
      const { data, error } = await supabase.functions.invoke("dispute-evidence", {
        body: {
          action,
          bookingId,
          note: action === "loss_review" ? lossNote : note,
          cause: lossCause,
          narrative: narrative.trim() || undefined,
          clientKey: booking.email || null,
          chargeKey: booking.payment_intent_id || charges?.[0]?.paymentIntentId || null,
          customerName: [booking.first_name, booking.last_name].filter(Boolean).join(" ") || booking.first_name || null,
          serviceDate: booking.service_date || null,
          serviceAddress: address || null,
          serviceDocumented: (photos || []).length > 0 || Boolean(booking.completed_at),
          relationshipIntact: true,
          input: {
            disputeId: id,
            reason,
            evidenceDueAt: due || null,
            now: new Date().toISOString(),
            bookingRef: bookingRef || null,
            jobId: booking.job_id || null,
            customerName: [booking.first_name, booking.last_name].filter(Boolean).join(" ") || booking.first_name || null,
            customerEmail: booking.email || null,
            billingAddress: address || null,
            serviceAddress: address || null,
            serviceDescription: booking.service_type ? String(booking.service_type).replace(/_/g, " ") : null,
            serviceDate: booking.service_date || null,
            disputedAmountCents: chargeCents,
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
      const payloadResult = data as Record<string, unknown>;
      setResult(payloadResult);
      if (typeof payloadResult.narrative === "string" && !narrative.trim()) setNarrative(payloadResult.narrative);
      const labels: Record<string, string> = {
        preview: "Draft ready",
        submit: "Submitted once",
        stage: "Staged, not submitted",
        accept_without_evidence: "Accepted without evidence",
        loss_review: "Loss review saved",
        withdrawal_draft: "Withdrawal draft ready. It was not sent.",
      };
      toast.success(labels[action]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Dispute evidence failed");
    } finally {
      setBusy(false);
    }
  };

  const budget = result?.budget as { ok?: boolean; pages?: number; bytes?: number; errors?: string[] } | undefined;
  const packets = (result?.packets as Array<{
    filename: string;
    field: string;
    pages?: number;
    bytes?: number;
    trimmed?: boolean;
    pdfBase64?: string | null;
    identity?: { customerName?: string; serviceDate?: string; recordId?: string; chargeAmount?: string; packetName?: string };
    pagesPreview?: string[][];
  }> | undefined) || [];
  const review = result?.checklist as { ok?: boolean; items?: Array<{ id: string; ok: boolean; label: string }> } | undefined;
  const dueMs = due ? Date.parse(due) - Date.now() : NaN;
  const dueLabel = !due ? null : dueMs <= 24 * 60 * 60 * 1000 ? "Due within 24 hours" : dueMs <= 48 * 60 * 60 * 1000 ? "Due within 48 hours" : "Due later than 48 hours";
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
      {(drive?.folderUrl || drive?.summaryUrl || drive?.agreementUrl) && (
        <div className="rounded-lg border px-3 py-2 text-xs space-y-1" style={{ borderColor: "rgba(92, 15, 254, 0.22)", background: "rgba(92, 15, 254, 0.05)" }}>
          <p className="font-semibold text-slate-800">Drive archive for this job</p>
          {drive.folderUrl && <a className="block text-violet-700 font-medium hover:underline" href={drive.folderUrl} target="_blank" rel="noreferrer">Job folder — summary, agreement, before and after photos</a>}
          {drive.summaryUrl && <a className="block text-violet-700 font-medium hover:underline" href={drive.summaryUrl} target="_blank" rel="noreferrer">Completion summary PDF</a>}
          {drive.agreementUrl && <a className="block text-violet-700 font-medium hover:underline" href={drive.agreementUrl} target="_blank" rel="noreferrer">Executed agreement PDF</a>}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <input className="border rounded px-2 py-1 text-xs" placeholder="Stripe dispute id" value={disputeId} onChange={(e) => setDisputeId(e.target.value)} />
        <select className="border rounded px-2 py-1 text-xs" value={reason} onChange={(e) => setReason(e.target.value)}>
          {["product_unacceptable", "fraudulent", "unrecognized", "product_not_received", "subscription_canceled", "credit_not_processed", "duplicate", "general"].map((r) => (
            <option key={r} value={r}>{r.replace(/_/g, " ")}</option>
          ))}
        </select>
        <input className="border rounded px-2 py-1 text-xs" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
      </div>
      {dueLabel && <p className={`text-xs font-medium ${dueLabel.startsWith("Due within 24") ? "text-rose-600" : "text-slate-600"}`}>{dueLabel}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void loadReadiness()}>Readiness</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void run("preview")}>
          {busy ? <RiLoader4Line className="w-3 h-3 animate-spin" /> : "Build draft"}
        </Button>
        <Button size="sm" variant="outline" disabled={busy || over} onClick={() => void run("stage")}>Stage, do not submit</Button>
        <Button size="sm" disabled={busy || over} onClick={() => void run("submit")}>Approve and submit once</Button>
      </div>
      <textarea className="w-full border rounded p-2 text-xs" rows={4} placeholder="Response narrative. The first two sentences must answer the dispute reason. Leave blank to use the generated note." value={narrative} onChange={(e) => setNarrative(e.target.value)} />
      <textarea className="w-full border rounded p-2 text-xs" rows={2} placeholder="Note required to accept without evidence" value={note} onChange={(e) => setNote(e.target.value)} />
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("accept_without_evidence")}>Accept dispute without evidence</Button>
      <div className="flex flex-wrap gap-2 items-center">
        <select className="border rounded px-2 py-1 text-xs" value={lossCause} onChange={(e) => setLossCause(e.target.value)}>
          {["reason_code_not_answered", "evidence_not_tied_to_customer", "photos_unreadable", "authorization_evidence_missing", "evidence_missing_or_late", "other"].map((cause) => (
            <option key={cause} value={cause}>{cause.replace(/_/g, " ")}</option>
          ))}
        </select>
        <input className="border rounded px-2 py-1 text-xs flex-1" placeholder="Note for a lost dispute" value={lossNote} onChange={(e) => setLossNote(e.target.value)} />
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void run("loss_review")}>Save loss review</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("withdrawal_draft")}>Withdrawal draft</Button>
      </div>
      {budget && (
        <p className={`text-xs font-medium ${budget.ok ? "text-emerald-700" : "text-rose-600"}`}>
          {budget.pages} pages · {budget.bytes} bytes · limit 19 pages / 4.5 MB
          {budget.errors?.length ? ` · ${budget.errors.join(" ")}` : ""}
        </p>
      )}
      {review?.items && (
        <ul className="text-xs space-y-1">
          {review.items.map((item) => (
            <li key={item.id} className={item.ok ? "text-emerald-700" : "text-rose-600"}>{item.ok ? "Yes" : "No"} — {item.label}</li>
          ))}
        </ul>
      )}
      {packets.length > 0 && (
        <div className="space-y-3">
          {packets.map((p) => (
            <div key={p.filename} className="text-xs text-slate-700 space-y-1">
              <p className="font-medium">{p.field}: {p.filename} · {p.pages ?? "?"} pages · {p.bytes ?? 0} bytes</p>
              {p.identity && (
                <p>{p.identity.customerName} · {p.identity.serviceDate} · {p.identity.recordId} · {p.identity.chargeAmount}</p>
              )}
              {p.pdfBase64 && (
                <iframe title={p.filename} className="w-full h-[480px] border bg-white" src={`data:application/pdf;base64,${p.pdfBase64}`} />
              )}
              {!p.pdfBase64 && p.pagesPreview?.slice(0, 2).map((page, index) => (
                <pre key={`${p.filename}-${index}`} className="whitespace-pre-wrap bg-white border p-2 text-[11px] leading-4">{page.join("\n")}</pre>
              ))}
            </div>
          ))}
        </div>
      )}
      {warnings.length > 0 && (
        <ul className="text-xs text-amber-800 space-y-1">
          {warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
      {Array.isArray(result?.missing) && (result?.missing as string[]).length > 0 && (
        <p className="text-xs text-amber-700">Not recorded: {(result?.missing as string[]).join(", ")}</p>
      )}
      {result?.draft && typeof (result.draft as { draft?: string }).draft === "string" && (
        <pre className="text-xs whitespace-pre-wrap border p-2 bg-white">{(result.draft as { draft: string }).draft}</pre>
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
