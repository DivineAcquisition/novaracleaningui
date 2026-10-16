"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

type Change = {
  id: string;
  old_method_code: string | null;
  new_method_code: string | null;
  old_identifier: string | null;
  new_identifier: string | null;
  changed_by_role: string | null;
  verification_channel: string | null;
  verified_at: string | null;
  created_at: string;
};

export default function ContractorPayoutPanel({ cleanerId, cleanerName }: { cleanerId: string; cleanerName: string }) {
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [changes, setChanges] = useState<Change[]>([]);
  const [lastPayment, setLastPayment] = useState<Record<string, unknown> | null>(null);
  const [draft, setDraft] = useState<{ subject: string; text: string; alreadySent: boolean } | null>(null);
  const [error, setError] = useState("");

  const headers = async () => {
    const { data } = await supabase.auth.getSession();
    return { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token || ""}` };
  };

  const load = async () => {
    try {
      const res = await fetch(`/api/admin/payout-methods?cleanerId=${cleanerId}`, { headers: await headers() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || "");
        return;
      }
      setProfile(body.profile || null);
      setChanges(body.changes || []);
      setLastPayment(body.lastPayment || null);
      setError("");
    } catch {
      setError("");
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanerId]);

  return (
    <div className="rounded-lg border border-slate-200 p-3 space-y-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">Payout method</p>
        {profile?.status ? <Badge variant="outline">{String(profile.status)}</Badge> : <Badge variant="outline">None</Badge>}
      </div>
      {error ? <p className="text-xs text-slate-500">{error}</p> : null}
      <p>{String(profile?.methodName || "No method on file")}</p>
      {profile?.identifier ? <p className="font-mono text-xs">{String(profile.identifier)}</p> : null}
      {lastPayment ? (
        <p className="text-xs text-slate-600">
          Last payment {lastPayment.paid_at ? String(lastPayment.paid_at).slice(0, 10) : ""} · ${((Number(lastPayment.amount_sent_cents ?? lastPayment.amount_cents) || 0) / 100).toFixed(2)}
        </p>
      ) : <p className="text-xs text-slate-500">No payment recorded yet.</p>}
      {changes.length ? (
        <ul className="text-xs space-y-1 text-slate-600">
          {changes.slice(0, 6).map((change) => (
            <li key={change.id}>
              {change.created_at.slice(0, 10)} · {change.old_method_code || "none"} → {change.new_method_code || "none"} · {change.old_identifier || "—"} → {change.new_identifier || "—"} · {change.verified_at ? "verified" : "pending"} · {change.changed_by_role || "unknown"} via {change.verification_channel || "—"}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={async () => {
          const res = await fetch("/api/admin/payout-methods", {
            method: "POST",
            headers: await headers(),
            body: JSON.stringify({ action: "draft_options_notice", cleanerId }),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) toast.error(body.error || "Couldn't draft the note.");
          else setDraft({ subject: body.subject, text: body.text, alreadySent: Boolean(body.alreadySent) });
        }}>
          Review options note
        </Button>
        {profile?.status === "verified" || profile?.status === "on_hold" ? (
          <Button type="button" size="sm" variant="outline" onClick={async () => {
            const hold = profile.status !== "on_hold";
            const res = await fetch("/api/admin/payout-methods", {
              method: "POST",
              headers: await headers(),
              body: JSON.stringify({ action: "hold", cleanerId, hold }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok || body.ok === false) toast.error(body.error || "Couldn't update the hold.");
            else void load();
          }}>
            {profile.status === "on_hold" ? "Clear hold" : "Place on hold"}
          </Button>
        ) : null}
      </div>
      {draft ? (
        <div className="rounded border bg-slate-50 p-2 space-y-2">
          <p className="font-medium">{draft.subject}</p>
          <pre className="whitespace-pre-wrap text-xs">{draft.text}</pre>
          <Button type="button" size="sm" disabled={draft.alreadySent} onClick={async () => {
            const res = await fetch("/api/admin/payout-methods", {
              method: "POST",
              headers: await headers(),
              body: JSON.stringify({ action: "send_options_notice", cleanerId, approved: true }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok || body.ok === false) toast.error(body.error || "Not sent.");
            else toast.success(`Sent to ${cleanerName}.`);
          }}>
            {draft.alreadySent ? "Already sent" : "Send this note"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
