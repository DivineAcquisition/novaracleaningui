"use client";

import { useMemo, useState } from "react";
import { RiDownloadLine, RiFilePdf2Line, RiLoader4Line } from "@remixicon/react";
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

type ClaimId =
  | "product_not_received"
  | "product_unacceptable"
  | "fraudulent"
  | "unrecognized"
  | "subscription_canceled"
  | "credit_not_processed"
  | "duplicate"
  | "general";

interface PlannedDoc {
  name: string;
  detail: string;
}

const CLAIMS: Array<{
  id: ClaimId;
  title: string;
  customerSays: string;
  lead: string;
  documents: (chargeCount: number) => PlannedDoc[];
}> = [
  {
    id: "product_not_received",
    title: "Service was not received",
    customerSays: "Nobody came, or the clean did not happen.",
    lead: "Completion summary",
    documents: (chargeCount) => [
      { name: "Completion summary", detail: "The visit, the checklist, and the before and after photos." },
      { name: "Customer communication", detail: "Messages about this visit." },
      { name: "Acceptance record", detail: "The agreement the customer signed, and when." },
      ...(chargeCount > 1 ? [{ name: "Receipt", detail: "Each charge on this visit, on its own line." }] : []),
    ],
  },
  {
    id: "product_unacceptable",
    title: "Service was unacceptable",
    customerSays: "The clean was incomplete, dirty, or not what they paid for.",
    lead: "Completion summary",
    documents: (chargeCount) => [
      { name: "Completion summary", detail: "What was done, and the before and after photos." },
      { name: "Customer communication", detail: "The complaint and any remedy that was offered." },
      { name: "Acceptance record", detail: "The agreement the customer signed." },
      { name: "Refund policy", detail: "The refund terms they accepted." },
      ...(chargeCount > 1 ? [{ name: "Receipt", detail: "Each charge on this visit, on its own line." }] : []),
    ],
  },
  {
    id: "fraudulent",
    title: "Does not recognize the charge",
    customerSays: "They say this charge is fraud, or the card was not theirs.",
    lead: "Acceptance record",
    documents: (chargeCount) => [
      { name: "Acceptance record", detail: "The customer accepted this service." },
      { name: "Customer communication", detail: "Their own messages about the booking." },
      { name: "Completion summary", detail: "The visit that matches the charge." },
      ...(chargeCount > 1 ? [{ name: "Receipt", detail: "Each charge on this visit, on its own line." }] : []),
    ],
  },
  {
    id: "unrecognized",
    title: "Does not recognize the payment",
    customerSays: "They do not remember authorizing this payment.",
    lead: "Acceptance record",
    documents: (chargeCount) => [
      { name: "Acceptance record", detail: "The customer accepted this service." },
      { name: "Customer communication", detail: "Their own messages about the booking." },
      { name: "Completion summary", detail: "The visit that matches the charge." },
      ...(chargeCount > 1 ? [{ name: "Receipt", detail: "Each charge on this visit, on its own line." }] : []),
    ],
  },
  {
    id: "subscription_canceled",
    title: "Membership was canceled",
    customerSays: "They say they canceled before this charge.",
    lead: "Cancellation policy",
    documents: () => [
      { name: "Cancellation policy", detail: "The cancellation terms they accepted." },
      { name: "Customer communication", detail: "When and how cancellation was requested." },
      { name: "Acceptance record", detail: "The agreement that contains those terms." },
      { name: "Completion summary", detail: "The visit this charge was for." },
    ],
  },
  {
    id: "credit_not_processed",
    title: "Refund was not received",
    customerSays: "A refund or credit they were promised never arrived.",
    lead: "Refund policy",
    documents: () => [
      { name: "Refund policy", detail: "The refund terms, and any refund already issued." },
      { name: "Receipt", detail: "The charge and any credit on it." },
      { name: "Customer communication", detail: "The messages about the credit." },
      { name: "Completion summary", detail: "The visit the refund is about." },
      { name: "Acceptance record", detail: "The agreement they signed." },
    ],
  },
  {
    id: "duplicate",
    title: "Charged more than once",
    customerSays: "They say this payment duplicates another charge.",
    lead: "Receipt",
    documents: () => [
      { name: "Receipt", detail: "Each payment on its own line, and what it was for." },
      { name: "Customer communication", detail: "Messages about the charges." },
      { name: "Completion summary", detail: "The visit tied to the disputed payment." },
      { name: "Acceptance record", detail: "The agreement for that service." },
    ],
  },
  {
    id: "general",
    title: "Another claim",
    customerSays: "The reason does not match the claims above.",
    lead: "Completion summary",
    documents: () => [
      { name: "Completion summary", detail: "The visit, the checklist, and the photos." },
      { name: "Customer communication", detail: "Messages about this service." },
      { name: "Acceptance record", detail: "The agreement the customer signed." },
      { name: "Refund policy", detail: "The refund terms they accepted." },
      { name: "Receipt", detail: "The charge breakdown." },
    ],
  },
];

function money(cents: number | null): string {
  if (cents == null || !Number.isFinite(cents)) return "Amount not on the booking";
  return `$${(cents / 100).toFixed(2)}`;
}

function downloadPdf(filename: string, pdfBase64: string) {
  const binary = atob(pdfBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
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
  const [reason, setReason] = useState<ClaimId | "">("");
  const [disputeId, setDisputeId] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [narrative, setNarrative] = useState("");
  const [lossCause, setLossCause] = useState("reason_code_not_answered");
  const [lossNote, setLossNote] = useState("");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [openPacket, setOpenPacket] = useState<string | null>(null);

  const customerName = [booking.first_name, booking.last_name].filter(Boolean).join(" ") || String(booking.first_name || "Customer");
  const address = [booking.address, booking.city, booking.state, booking.zip_code].filter(Boolean).join(", ");
  const chargeCents = charges?.find((charge) => charge.amountCents != null)?.amountCents
    ?? (typeof booking.final_charge_cents === "number" ? booking.final_charge_cents : null)
    ?? (typeof booking.total_estimate_cents === "number" ? booking.total_estimate_cents : null);
  const claim = CLAIMS.find((item) => item.id === reason) || null;
  const planned = claim ? claim.documents(charges?.length || 0) : [];

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
    if (!reason) {
      toast.error("Choose the claim the customer is making.");
      return;
    }
    const stripeId = disputeId.trim();
    if (action !== "preview" && action !== "withdrawal_draft" && !stripeId) {
      toast.error("Enter the Stripe dispute id before sending anything to Stripe.");
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
    setBusy(action);
    try {
      const { data, error } = await supabase.functions.invoke("dispute-evidence", {
        body: {
          action,
          bookingId,
          note: action === "loss_review" ? lossNote : note,
          cause: lossCause,
          narrative: narrative.trim() || undefined,
          clientKey: booking.email || null,
          chargeKey: booking.payment_intent_id || charges?.[0]?.paymentIntentId || null,
          customerName,
          serviceDate: booking.service_date || null,
          serviceAddress: address || null,
          serviceDocumented: (photos || []).length > 0 || Boolean(booking.completed_at),
          relationshipIntact: true,
          input: {
            disputeId: stripeId || undefined,
            reason,
            evidenceDueAt: due || null,
            now: new Date().toISOString(),
            bookingRef: bookingRef || null,
            jobId: booking.job_id || null,
            customerName,
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
      if (typeof payloadResult.narrative === "string") setNarrative(payloadResult.narrative);
      const packets = (payloadResult.packets as Array<{ filename: string }> | undefined) || [];
      if (packets[0]) setOpenPacket(packets[0].filename);
      toast.success(action === "preview" ? "Documents are ready" : action === "submit" ? "Submitted once" : action === "stage" ? "Staged. Not submitted." : action === "withdrawal_draft" ? "Withdrawal draft is ready. It was not sent." : "Saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not build the documents");
    } finally {
      setBusy(null);
    }
  };

  const budget = result?.budget as { ok?: boolean; pages?: number; bytes?: number; errors?: string[] } | undefined;
  const packets = (result?.packets as Array<{
    filename: string;
    field: string;
    title?: string;
    pages?: number;
    bytes?: number;
    pdfBase64?: string | null;
    identity?: { customerName?: string; serviceDate?: string; recordId?: string; chargeAmount?: string; packetName?: string };
  }> | undefined) || [];
  const warnings = (result?.warnings as string[] | undefined) || [];
  const missing = (result?.missing as string[] | undefined) || [];

  return (
    <section className="rounded-2xl border border-violet-200/80 bg-white p-4 space-y-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-slate-900">Documents for a dispute</p>
          <p className="text-xs text-slate-500 mt-1">Choose the claim. The PDFs for that claim are built from this case. Nothing is sent to Stripe until you submit it.</p>
        </div>
        <RiFilePdf2Line className="w-5 h-5 text-violet-600 shrink-0" />
      </div>

      <div className="rounded-xl bg-violet-50/80 px-3 py-2.5 text-xs text-slate-700 grid gap-1 sm:grid-cols-2">
        <p><span className="text-slate-500">Customer</span> · {customerName}</p>
        <p><span className="text-slate-500">Visit</span> · {bookingRef || "No job id"} · {String(booking.service_date || "date not recorded")}</p>
        <p><span className="text-slate-500">Charge</span> · {money(typeof chargeCents === "number" ? chargeCents : null)}</p>
        <p className="truncate"><span className="text-slate-500">Address</span> · {address || "not recorded"}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {CLAIMS.map((item) => {
          const selected = reason === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setReason(item.id);
                setResult(null);
                setOpenPacket(null);
                setNarrative("");
              }}
              className={`text-left rounded-xl border px-3 py-2.5 transition-colors ${selected ? "border-violet-500 bg-violet-50 ring-1 ring-violet-500" : "border-slate-200 hover:border-violet-300 bg-white"}`}
            >
              <p className="text-sm font-semibold text-slate-900">{item.title}</p>
              <p className="text-xs text-slate-500 mt-0.5">{item.customerSays}</p>
              <p className="text-[11px] font-medium text-violet-700 mt-1.5">Lead document · {item.lead}</p>
            </button>
          );
        })}
      </div>

      {claim && (
        <div className="rounded-xl border border-slate-200 p-3 space-y-2">
          <p className="text-xs font-semibold text-slate-800">This claim produces {planned.length} {planned.length === 1 ? "document" : "documents"}</p>
          <ol className="space-y-1.5">
            {planned.map((doc, index) => (
              <li key={doc.name} className="flex gap-2 text-xs">
                <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${index === 0 ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-600"}`}>{index + 1}</span>
                <span>
                  <span className="font-semibold text-slate-800">{doc.name}</span>
                  {index === 0 && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-violet-700">Opens the case</span>}
                  <span className="block text-slate-500">{doc.detail}</span>
                </span>
              </li>
            ))}
          </ol>
          <Button disabled={busy !== null} onClick={() => void run("preview")}>
            {busy === "preview" ? <RiLoader4Line className="w-4 h-4 animate-spin" /> : <RiFilePdf2Line className="w-4 h-4" />}
            Generate these documents
          </Button>
        </div>
      )}

      {budget && (
        <p className={`text-xs font-medium ${budget.ok ? "text-emerald-700" : "text-rose-600"}`}>
          {packets.length} files · {budget.pages} pages · {(budget.bytes / 1024 / 1024).toFixed(2)} MB
          {budget.ok ? " · inside Stripe’s 19 page and 4.5 MB limits" : ` · ${budget.errors?.join(" ") || "over the Stripe limit"}`}
        </p>
      )}

      {packets.length > 0 && (
        <div className="space-y-2">
          {packets.map((packet, index) => {
            const open = openPacket === packet.filename;
            return (
              <article key={packet.filename} className="rounded-xl border border-slate-200 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 bg-slate-50">
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${index === 0 ? "bg-violet-600 text-white" : "bg-white border text-slate-600"}`}>{index + 1}</span>
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpenPacket(open ? null : packet.filename)}>
                    <p className="text-sm font-semibold text-slate-900 truncate">{packet.identity?.packetName || packet.filename}</p>
                    <p className="text-[11px] text-slate-500">{packet.pages ?? "?"} pages · {packet.filename}</p>
                  </button>
                  {packet.pdfBase64 && (
                    <Button size="sm" variant="outline" onClick={() => downloadPdf(packet.filename, packet.pdfBase64!)}>
                      <RiDownloadLine className="w-3.5 h-3.5" /> Download
                    </Button>
                  )}
                </div>
                {open && packet.pdfBase64 && (
                  <iframe title={packet.filename} className="w-full h-[520px] bg-white" src={`data:application/pdf;base64,${packet.pdfBase64}`} />
                )}
                {open && !packet.pdfBase64 && (
                  <p className="px-3 py-2 text-xs text-amber-800">This file was built, and it is too large to preview here. Generate again after reducing the photo count, or download it from the job folder.</p>
                )}
              </article>
            );
          })}
        </div>
      )}

      {missing.length > 0 && <p className="text-xs text-amber-800">Not on the case yet: {missing.join(", ")}. Those lines say “not recorded” in the PDF.</p>}
      {warnings.length > 0 && (
        <ul className="text-xs text-amber-800 space-y-1">
          {warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      )}

      {(drive?.folderUrl || drive?.summaryUrl || drive?.agreementUrl) && (
        <div className="text-xs space-y-1">
          <p className="font-semibold text-slate-700">Already in the job folder</p>
          {drive.folderUrl && <a className="block text-violet-700 font-medium hover:underline" href={drive.folderUrl} target="_blank" rel="noreferrer">Open the job folder</a>}
          {drive.summaryUrl && <a className="block text-violet-700 font-medium hover:underline" href={drive.summaryUrl} target="_blank" rel="noreferrer">Stored completion summary</a>}
          {drive.agreementUrl && <a className="block text-violet-700 font-medium hover:underline" href={drive.agreementUrl} target="_blank" rel="noreferrer">Signed agreement</a>}
        </div>
      )}

      <details className="rounded-xl border border-slate-200 px-3 py-2">
        <summary className="cursor-pointer text-xs font-semibold text-slate-700">Send this set to Stripe</summary>
        <div className="mt-3 space-y-2">
          <p className="text-xs text-slate-500">Use this only after the documents look right. Submission happens once.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input className="border rounded-lg px-2 py-1.5 text-xs" placeholder="Stripe dispute id, du_…" value={disputeId} onChange={(e) => setDisputeId(e.target.value)} />
            <input className="border rounded-lg px-2 py-1.5 text-xs" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
          <textarea className="w-full border rounded-lg p-2 text-xs" rows={3} placeholder="The note Stripe receives. Leave it as generated, or edit the first two sentences so they answer this claim." value={narrative} onChange={(e) => setNarrative(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy !== null || budget?.ok === false} onClick={() => void run("stage")}>Stage, do not submit</Button>
            <Button size="sm" disabled={busy !== null || budget?.ok === false} onClick={() => void run("submit")}>Submit once</Button>
          </div>
          <textarea className="w-full border rounded-lg p-2 text-xs" rows={2} placeholder="Note, required only if you accept the dispute with no documents" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void run("accept_without_evidence")}>Accept without documents</Button>
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void run("withdrawal_draft")}>Draft a withdrawal. Do not send it.</Button>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <select className="border rounded-lg px-2 py-1 text-xs" value={lossCause} onChange={(e) => setLossCause(e.target.value)}>
              {["reason_code_not_answered", "evidence_not_tied_to_customer", "photos_unreadable", "authorization_evidence_missing", "evidence_missing_or_late", "other"].map((cause) => (
                <option key={cause} value={cause}>{cause.replace(/_/g, " ")}</option>
              ))}
            </select>
            <input className="border rounded-lg px-2 py-1 text-xs flex-1 min-w-[12rem]" placeholder="Why a lost dispute was lost" value={lossNote} onChange={(e) => setLossNote(e.target.value)} />
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void run("loss_review")}>Save loss review</Button>
          </div>
          {result?.draft && typeof (result.draft as { draft?: string }).draft === "string" && (
            <pre className="text-xs whitespace-pre-wrap border rounded-lg p-2 bg-slate-50">{(result.draft as { draft: string }).draft}</pre>
          )}
        </div>
      </details>
    </section>
  );
}
