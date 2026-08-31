"use client";

// ─── Re-clean verification + dispatch (Spotless Guarantee) ───────────────
//
// Lives on the original job's QC case. Photos/checklist are reviewed and
// classified BEFORE anything is dispatched. Classification decides Score
// impact. The performer is always paid; the customer is never charged.

import { useCallback, useEffect, useState } from "react";
import { RiLoader4Line, RiShieldCheckLine, RiCameraLine } from "@remixicon/react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { edgeResult } from "@/lib/edge-invoke";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { RecleanBadge } from "@/components/reclean/RecleanCallout";
import { ChecklistItemPicker } from "@/components/checklists/ChecklistItemPicker";

const AREAS = [
  { id: "kitchen", label: "Kitchen" },
  { id: "bathroom", label: "Bathroom" },
  { id: "bedroom", label: "Bedroom" },
  { id: "living", label: "Living / common" },
  { id: "other", label: "Other" },
];

const CLASS_COPY: Record<string, { label: string; hit: boolean; hint: string }> = {
  quality_miss: {
    label: "Valid — quality miss",
    hit: true,
    hint: "Photos/checklist support the complaint. Re-clean is dispatched. Original cleaner takes a quality hit.",
  },
  scope_confusion: {
    label: "Valid — scope confusion",
    hit: false,
    hint: "Work matched what was booked; customer expected more. May approve as goodwill. No Score hit.",
  },
  not_supported: {
    label: "Not supported",
    hit: false,
    hint: "Photos show the work was completed to standard. No dispatch by default. Customer gets a factual explanation.",
  },
};

function dollars(cents: number | null | undefined) {
  return `$${((Number(cents) || 0) / 100).toFixed(2)}`;
}

export default function RecleanWorkflow({
  issueId,
  onChanged,
}: {
  issueId: string;
  onChanged?: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [packet, setPacket] = useState<Record<string, unknown> | null>(null);
  const [classification, setClassification] = useState<string>("");
  const [scope, setScope] = useState<"targeted" | "full">("targeted");
  const [areas, setAreas] = useState<string[]>([]);
  // Targeted scope resolved to stable checklist item IDs. This is what makes a
  // quality-miss countable against the item rather than just against the job.
  const [checklistItemIds, setChecklistItemIds] = useState<string[]>([]);
  const [serviceDate, setServiceDate] = useState("");
  const [timeSlot, setTimeSlot] = useState("");
  const [customerPrefersOther, setCustomerPrefersOther] = useState(false);
  const [honorOutsideWindow, setHonorOutsideWindow] = useState(false);
  const [goodwill, setGoodwill] = useState(false);
  const [fullApproved, setFullApproved] = useState(false);
  const [message, setMessage] = useState("");
  const [previewCents, setPreviewCents] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("qc-reclean", {
        body: { action: "packet", issueId },
      });
      const outcome = await edgeResult(error, data);
      if (!outcome.ok) throw new Error(outcome.error || "Failed to load re-clean packet");
      const d = data as Record<string, unknown>;
      setPacket(d);
      const issue = (d.issue || {}) as Record<string, unknown>;
      setClassification(String(issue.reclean_classification || "") === "pending" ? "" : String(issue.reclean_classification || ""));
      setScope((issue.reclean_scope as "targeted" | "full") || "targeted");
      const named = Array.isArray(issue.reclean_areas_named) ? (issue.reclean_areas_named as string[]) : [];
      const pkt = (d.packet as { namedAreas?: string[]; siteZones?: string[]; issueZone?: string | null } | undefined);
      const pktAreas = pkt?.namedAreas || [];
      const issueZone = String(issue.zone_name || pkt?.issueZone || "");
      setAreas(named.length ? named : pktAreas.length ? pktAreas : issueZone ? [issueZone] : []);
      setChecklistItemIds(
        Array.isArray(issue.reclean_checklist_item_ids)
          ? (issue.reclean_checklist_item_ids as string[])
          : [],
      );
      setCustomerPrefersOther(Boolean(issue.reclean_customer_prefers_other));
      const outside = !(d.inWindow ?? issue.reclean_inside_window);
      setHonorOutsideWindow(Boolean(issue.reclean_honored_outside_window) || outside);
      setGoodwill(Boolean(issue.reclean_goodwill));
      setMessage(String(d.draftMessage || issue.reclean_message_draft || ""));
      const orig = d.originalBooking as { time_slot?: string } | undefined;
      setTimeSlot(String(orig?.time_slot || "morning"));
      setServiceDate((prev) => {
        if (prev) return prev;
        const t = new Date();
        t.setDate(t.getDate() + 1);
        const y = t.getFullYear();
        const m = String(t.getMonth() + 1).padStart(2, "0");
        const day = String(t.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
      });
      setPreviewCents(typeof d.assessedValueCents === "number" ? d.assessedValueCents : null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load re-clean packet");
    } finally {
      setLoading(false);
    }
  }, [issueId]);

  useEffect(() => { void load(); }, [load]);

  const call = async (body: Record<string, unknown>, key: string, success: string) => {
    setBusy(key);
    try {
      const { data, error } = await supabase.functions.invoke("qc-reclean", { body: { issueId, ...body } });
      const outcome = await edgeResult(error, data);
      if (!outcome.ok) throw new Error(outcome.error || "Failed");
      const d = data as {
        ok?: boolean;
        error?: string;
        draftMessage?: string;
        recleanBookingNumber?: number | null;
        recleanBookingId?: string;
        dispatchError?: string | null;
      };
      if (d.draftMessage) setMessage(d.draftMessage);
      const bookingBit = d.recleanBookingNumber
        ? ` Booking #${d.recleanBookingNumber} is on the Bookings tab.`
        : d.recleanBookingId
          ? " Re-clean booking created — it is on the Bookings tab."
          : "";
      const dispatchBit = d.dispatchError
        ? ` Offer not sent yet: ${d.dispatchError}`
        : "";
      toast.success(success + bookingBit + dispatchBit);
      await load();
      onChanged?.();
      return d;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
      return null;
    } finally {
      setBusy(null);
    }
  };

  const preview = async () => {
    const { data } = await supabase.functions.invoke("qc-reclean", {
      body: { action: "preview_price", issueId, scope, areas },
    });
    const d = data as { assessedValueCents?: number };
    if (typeof d?.assessedValueCents === "number") setPreviewCents(d.assessedValueCents);
  };

  const issue = (packet?.issue || {}) as Record<string, unknown>;
  const pkt = (packet?.packet || {}) as {
    originalPhotos?: { before: string[]; after: string[] };
    recleanPhotos?: { before: string[]; after: string[] };
    fourStageSequence?: Array<{ stage: string; url: string }>;
    skippedItems?: Array<{ key: string; reason: string }>;
    conditionsFound?: Array<{ section: string; note?: string }>;
    originalCrew?: Array<{ name: string; role: string | null }>;
    namedAreas?: string[];
    siteZones?: string[];
    issueZone?: string | null;
    zonePhotos?: Array<{ zoneName: string; kind: string; url: string; label: string }>;
    qualityHitApplies?: boolean;
  };
  const status = String(issue.reclean_status || "none");
  const inWindow = Boolean(packet?.inWindow ?? issue.reclean_inside_window);
  const clsMeta = classification ? CLASS_COPY[classification] : null;

  const canDispatch = ["approved", "offered", "dispatched"].includes(status);
  const locked = ["completed", "declined", "cancelled"].includes(status);

  const toggleArea = (id: string) => {
    setAreas((prev) => {
      const hit = prev.find((a) => a.toLowerCase() === id.toLowerCase());
      if (hit) return prev.filter((a) => a.toLowerCase() !== id.toLowerCase());
      return [...prev, id];
    });
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-4 text-sm text-violet-800 flex items-center gap-2">
        <RiLoader4Line className="w-4 h-4 animate-spin" /> Loading verification packet…
      </div>
    );
  }
  if (!packet) return null;

  return (
    <div className="rounded-xl border border-violet-300 bg-white p-4 space-y-4">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <p className="text-sm font-bold text-violet-900 flex items-center gap-1.5">
          <RiShieldCheckLine className="w-4 h-4" /> Spotless Guarantee — re-clean
        </p>
        <div className="flex gap-1.5 flex-wrap">
          <Badge className="border-0 bg-violet-100 text-violet-800">{String(status).replace(/_/g, " ")}</Badge>
          {inWindow ? (
            <Badge className="border-0 bg-emerald-100 text-emerald-800">Inside {String((packet.settings as { guarantee_window_hours?: number })?.guarantee_window_hours || 48)}h window</Badge>
          ) : (
            <Badge className="border-0 bg-amber-100 text-amber-800">Outside window — honor at discretion</Badge>
          )}
          {clsMeta && (
            <Badge className={cn("border-0", clsMeta.hit ? "bg-rose-100 text-rose-800" : "bg-slate-100 text-slate-700")}>
              {clsMeta.hit ? "Score hit" : "No Score hit"}
            </Badge>
          )}
        </div>
      </div>
      <p className="text-[11px] text-slate-500">
        Whoever performs the re-clean is paid at their normal tier rate on the assessed scope. The customer is not charged. The original job's pay is never reduced.
      </p>

      {/* ── Verification evidence ─────────────────────────────────────── */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-slate-700 flex items-center gap-1">
          <RiCameraLine className="w-3.5 h-3.5" /> Original job evidence (review before dispatch)
        </p>
        {pkt.originalCrew && pkt.originalCrew.length > 0 && (
          <p className="text-xs text-slate-600">
            Original crew: {pkt.originalCrew.map((c) => `${c.name}${c.role ? ` (${c.role})` : ""}`).join(", ")}
          </p>
        )}
        <PhotoRow label="Original before" urls={pkt.originalPhotos?.before || []} />
        <PhotoRow label="Original after" urls={pkt.originalPhotos?.after || []} />
        {(pkt.recleanPhotos?.before?.length || 0) + (pkt.recleanPhotos?.after?.length || 0) > 0 && (
          <>
            <PhotoRow label="Re-clean before" urls={pkt.recleanPhotos?.before || []} />
            <PhotoRow label="Re-clean after" urls={pkt.recleanPhotos?.after || []} />
          </>
        )}
        {(pkt.skippedItems?.length || 0) > 0 && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-2 text-xs">
            <p className="font-semibold text-amber-800 mb-1">Skipped checklist items</p>
            {pkt.skippedItems!.map((s) => (
              <p key={s.key} className="text-amber-900">{s.key}: {s.reason || "—"}</p>
            ))}
          </div>
        )}
        {(pkt.conditionsFound?.length || 0) > 0 && (
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-2 text-xs">
            <p className="font-semibold text-slate-700 mb-1">Conditions found</p>
            {pkt.conditionsFound!.map((c, i) => (
              <p key={i} className="text-slate-700">{c.section}: {c.note}</p>
            ))}
          </div>
        )}
      </div>

      {!locked && (
        <>
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-700">Classification</p>
            {Object.entries(CLASS_COPY).map(([id, meta]) => (
              <label key={id} className={cn(
                "flex gap-2 items-start rounded-lg border px-3 py-2 cursor-pointer text-sm",
                classification === id ? "border-violet-400 bg-violet-50" : "border-slate-200",
              )}>
                <input type="radio" name="reclean-class" className="mt-1" checked={classification === id} onChange={() => setClassification(id)} />
                <span>
                  <span className="font-semibold text-slate-800">{meta.label}</span>
                  <span className="block text-[11px] text-slate-500">{meta.hint}</span>
                </span>
              </label>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[11px] font-semibold text-slate-500 mb-1">Scope</p>
              <Select value={scope} onValueChange={(v) => setScope(v as "targeted" | "full")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="targeted">Targeted (default)</SelectItem>
                  <SelectItem value="full">Full re-service</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-slate-500 mb-1">Service date</p>
              <Input type="date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} />
            </div>
          </div>
          {scope === "targeted" && (
            <div className="flex flex-wrap gap-2">
              {(pkt.siteZones && pkt.siteZones.length > 0
                ? pkt.siteZones.map((z) => ({ id: z, label: z }))
                : AREAS
              ).map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => toggleArea(a.id)}
                  className={cn(
                    "text-xs rounded-full border px-2.5 py-1",
                    areas.some((x) => x.toLowerCase() === a.id.toLowerCase())
                      ? "bg-violet-600 text-white border-violet-600"
                      : "border-slate-200 text-slate-700",
                  )}
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}
          {scope === "full" && (
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <Checkbox checked={fullApproved} onCheckedChange={(v) => setFullApproved(v === true)} />
              Admin-approve full re-service (reserved for jobs that substantially failed)
            </label>
          )}

          <ChecklistItemPicker
            value={checklistItemIds}
            onChange={setChecklistItemIds}
            label="Checklist items this re-clean covers"
            hint={
              classification === "scope_confusion"
                ? "Tag the items whose scope boundary was unclear. Scope-confusion is tracked separately from quality-miss — it points at wording, not workmanship."
                : "Tag the items that were missed. A valid quality-miss against the same item across jobs is the strongest signal the checklist under-specifies it."
            }
          />
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <Checkbox checked={customerPrefersOther} onCheckedChange={(v) => setCustomerPrefersOther(v === true)} />
            Customer requested a different team (overrides offering the original cleaner)
          </label>
          {!inWindow && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              This request is outside the {String((packet.settings as { guarantee_window_hours?: number })?.guarantee_window_hours || 48)}h guarantee window.
              Approving honors it at company discretion (customer still not charged; performer still paid).
            </p>
          )}
          {classification === "not_supported" && (
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <Checkbox checked={goodwill} onCheckedChange={(v) => setGoodwill(v === true)} />
              Approve as goodwill anyway (still paid to the performer, customer not charged)
            </label>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={() => void preview()}>Preview pay</Button>
            {previewCents != null && (
              <span className="text-xs text-slate-600">
                Assessed {dollars(previewCents)} · customer charged $0.00 · original payout untouched
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!classification || busy !== null}
              onClick={() => void call({ action: "classify", classification, scope, areas, checklistItemIds }, "classify", "Classified")}
            >
              {busy === "classify" && <RiLoader4Line className="w-3.5 h-3.5 animate-spin mr-1" />}
              Save classification
            </Button>
            <Button
              size="sm"
              disabled={!classification || busy !== null || (scope === "full" && !fullApproved)}
              onClick={() => void call({
                action: "approve",
                classification,
                scope,
                areas,
                checklistItemIds,
                serviceDate: serviceDate || undefined,
                timeSlot,
                customerPrefersOther,
                honorOutsideWindow,
                goodwill,
                fullApproved,
                customerMessage: message,
              }, "approve", "Re-clean approved — customer not charged, performer paid")}
            >
              {busy === "approve" && <RiLoader4Line className="w-3.5 h-3.5 animate-spin mr-1" />}
              Approve re-clean
            </Button>
            {canDispatch && status !== "dispatched" && status !== "offered" && (
              <Button
                size="sm"
                className="bg-violet-700 hover:bg-violet-800"
                disabled={busy !== null}
                onClick={() => void call({ action: "dispatch", customerPrefersOther }, "dispatch", "Offered / dispatched")}
              >
                {busy === "dispatch" && <RiLoader4Line className="w-3.5 h-3.5 animate-spin mr-1" />}
                Dispatch
              </Button>
            )}
            {status === "offered" && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => void call({ action: "fallback_dispatch" }, "fallback", "Routed through ranked assignment")}
              >
                {busy === "fallback" && <RiLoader4Line className="w-3.5 h-3.5 animate-spin mr-1" />}
                Original declined — ranked dispatch
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={busy !== null}
              onClick={() => void call({ action: "decline", classification: classification || "not_supported", customerMessage: message }, "decline", "Re-clean not dispatched")}
            >
              Do not dispatch
            </Button>
          </div>
        </>
      )}

      <div className="space-y-1.5">
        <p className="text-xs font-semibold text-slate-700">Customer message (editable before send)</p>
        <Textarea rows={5} value={message} onChange={(e) => setMessage(e.target.value)} />
        <Button
          size="sm"
          variant="outline"
          disabled={!message.trim() || busy !== null}
          onClick={() => void call({ action: "send_message", message, subject: String(packet.draftSubject || "About your Novara Cleaning visit") }, "msg", "Message sent")}
        >
          {busy === "msg" && <RiLoader4Line className="w-3.5 h-3.5 animate-spin mr-1" />}
          Send to customer
        </Button>
      </div>

      {issue.reclean_booking_id && (
        <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 space-y-1">
          <RecleanBadge />
          <p className="text-[11px] text-violet-900">
            Re-clean booking {String(issue.reclean_booking_id).slice(0, 8)}
            {issue.reclean_assessed_value_cents != null
              ? ` · assessed ${dollars(Number(issue.reclean_assessed_value_cents))}`
              : ""}
            {issue.reclean_absorbed_cost_cents != null
              ? ` · absorbed ${dollars(Number(issue.reclean_absorbed_cost_cents))}`
              : ""}
            . It is on the Bookings tab with the Re-clean label, and the original cleaner is offered it on their dashboard.
          </p>
          <a className="text-xs text-violet-700 underline" href={`/admin/bookings?highlight=${String(issue.reclean_booking_id)}`}>
            Open on Bookings tab
          </a>
        </div>
      )}
    </div>
  );
}

function PhotoRow({ label, urls }: { label: string; urls: string[] }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">{label} ({urls.length})</p>
      {urls.length === 0 ? (
        <p className="text-xs text-slate-400">None on file.</p>
      ) : (
        <div className="flex gap-1.5 overflow-x-auto">
          {urls.slice(0, 12).map((u) => (
            <a key={u} href={u} target="_blank" rel="noreferrer">
              <img src={u} alt="" className="h-16 w-16 object-cover rounded-md border border-slate-200" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
