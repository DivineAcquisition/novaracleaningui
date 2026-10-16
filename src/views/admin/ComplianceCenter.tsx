"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  ACCESSIBILITY_PLAN,
  APPROVED_CLAIMS,
  AUDIT_FINDINGS,
  DEFAULT_SETTINGS,
  SEEDED_WORDING,
  liveDraftAcceptances,
  type AcceptanceRecord,
  type ComplianceSettings,
  type DataRequest,
  type WordingVersion,
} from "@/lib/compliance";

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${data.session?.access_token || ""}`,
  };
}

export default function ComplianceCenter() {
  const [wording, setWording] = useState<WordingVersion[]>(SEEDED_WORDING);
  const [acceptances, setAcceptances] = useState<AcceptanceRecord[]>([]);
  const [requests, setRequests] = useState<DataRequest[]>([]);
  const [settings, setSettings] = useState<ComplianceSettings>(DEFAULT_SETTINGS);
  const [bookingId, setBookingId] = useState("");
  const [notice, setNotice] = useState("");
  const drafts = liveDraftAcceptances(acceptances);

  const load = async () => {
    const headers = await authHeaders();
    const [wordingRes, acceptanceRes, requestRes, settingsRes] = await Promise.all([
      fetch("/api/compliance?view=wording", { headers }),
      fetch(`/api/compliance?view=acceptances&bookingId=${encodeURIComponent(bookingId)}`, { headers }),
      fetch("/api/compliance?view=requests", { headers }),
      fetch("/api/compliance?view=admin", { headers }),
    ]);
    if (wordingRes.ok) {
      const json = await wordingRes.json();
      if (Array.isArray(json.wording) && json.wording.length) setWording(json.wording);
    }
    if (acceptanceRes.ok) {
      const json = await acceptanceRes.json();
      setAcceptances(json.acceptances || []);
    }
    if (requestRes.ok) {
      const json = await requestRes.json();
      setRequests(json.requests || []);
    }
    if (settingsRes.ok) {
      const json = await settingsRes.json();
      if (json.settings) setSettings(json.settings);
    }
  };

  useEffect(() => {
    void load();
    // Initial admin load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const publish = async (kind: string, title: string, body: string) => {
    const headers = await authHeaders();
    const res = await fetch("/api/compliance", {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "publish_wording", kind, title, body, status: "draft" }),
    });
    const json = await res.json();
    setNotice(res.ok ? `Published ${json.wording?.id}. Marked Draft pending legal review.` : json.error || "Could not publish.");
    await load();
  };

  return (
    <div className="space-y-8 p-4 md:p-6 max-w-5xl">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">Booking compliance</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Legal text on this page is a draft until counsel marks it reviewed. Customers never see the draft label.
        </p>
      </header>

      {notice ? <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm">{notice}</p> : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">What the audit found</h2>
        {AUDIT_FINDINGS.map((finding) => (
          <article key={finding.area} className="rounded-lg border border-border p-3 text-sm">
            <h3 className="font-semibold">{finding.area}</h3>
            <p className="mt-1"><span className="font-medium">Found. </span>{finding.found}</p>
            <p className="mt-1"><span className="font-medium">Gap. </span>{finding.gap}</p>
            <p className="mt-1"><span className="font-medium">Fix. </span>{finding.fix}</p>
          </article>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Live acceptances still on draft wording</h2>
        {drafts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No stored acceptances are using draft wording yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {drafts.map((row) => (
              <li key={row.id} className="rounded-md border border-amber-300 bg-amber-50 p-2">
                Draft pending legal review — {row.kind} {row.wordingVersionId} · {row.email || row.bookingId || row.id}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Wording versions</h2>
        <p className="text-xs text-muted-foreground">Publishing creates a new version. The previous text stays as it was shown.</p>
        {wording.map((row) => (
          <WordingEditor key={row.id} row={row} onPublish={publish} />
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Acceptances on a booking</h2>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void load();
          }}
        >
          <label className="flex-1 text-sm">
            Booking or agreement id
            <input
              value={bookingId}
              onChange={(event) => setBookingId(event.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
            />
          </label>
          <button type="submit" className="self-end h-10 rounded-md border border-border px-3 text-sm font-medium">
            Look up
          </button>
        </form>
        {acceptances.length === 0 ? (
          <p className="text-sm text-muted-foreground">No acceptances stored for that lookup.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {acceptances.map((row) => (
              <li key={row.id} className="rounded-md border border-border p-3">
                <p className="font-medium">
                  {row.action === "withdrawn" ? "Withdrawn" : "Accepted"} · {row.kind}
                  {row.wordingStatus === "draft" ? " · Draft pending legal review" : " · Reviewed"}
                </p>
                <p className="text-muted-foreground">
                  {row.wordingVersionId} · {row.acceptedAt} {row.timeZone} · {row.ip} · {row.userAgent}
                </p>
                <p className="mt-1">{row.wordingShown}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Privacy requests</h2>
        {requests.length === 0 ? <p className="text-sm text-muted-foreground">No requests yet.</p> : null}
        {requests.map((request) => (
          <RequestCard key={request.id} request={request} onSaved={() => void load()} />
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Settings waiting on counsel or an accountant</h2>
        <SettingsForm settings={settings} onSaved={(next) => setSettings(next)} />
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Approved claims</h2>
        <ul className="text-sm space-y-1">
          {APPROVED_CLAIMS.map((claim) => (
            <li key={claim.id}>
              {claim.text} — {claim.scope === "people_sent" ? "true for the people sent" : "company"}
              {claim.counselNote ? ` (${claim.counselNote})` : ""}
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">“Bonded” is not on this list and is not shown on checkout.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Accessibility</h2>
        <ul className="text-sm space-y-1">
          {ACCESSIBILITY_PLAN.map((item) => (
            <li key={item.item}>
              <span className="font-medium">{item.status === "fixed" ? "Fixed. " : "Still to check. "}</span>
              {item.item}. {item.note}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function WordingEditor({
  row,
  onPublish,
}: {
  row: WordingVersion;
  onPublish: (kind: string, title: string, body: string) => Promise<void>;
}) {
  const [body, setBody] = useState(row.body);
  return (
    <article className="rounded-lg border border-border p-3 text-sm space-y-2">
      <p className="font-medium">
        {row.title} · {row.id} · {row.status === "draft" ? "Draft pending legal review" : "Reviewed"}
      </p>
      <label className="block">
        Replacement text
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={4}
          className="mt-1 w-full rounded-md border border-border bg-background p-2"
        />
      </label>
      <button
        type="button"
        className="h-9 rounded-md border border-border px-3 text-sm"
        onClick={() => void onPublish(row.kind, row.title, body)}
      >
        Publish as a new draft version
      </button>
    </article>
  );
}

function RequestCard({ request, onSaved }: { request: DataRequest; onSaved: () => void }) {
  const [note, setNote] = useState("");
  const [retained, setRetained] = useState(request.retainedBecause || "");
  const save = async (status: DataRequest["status"]) => {
    const { data } = await supabase.auth.getSession();
    await fetch("/api/compliance", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${data.session?.access_token || ""}`,
      },
      body: JSON.stringify({
        action: "update_request",
        id: request.id,
        status,
        note: note || `Status set to ${status}.`,
        logAction: status,
        retainedBecause: retained,
      }),
    });
    onSaved();
  };
  return (
    <article className="rounded-lg border border-border p-3 text-sm space-y-2">
      <p className="font-medium">
        {request.kind} · {request.name} · due {request.dueOn} · {request.status}
      </p>
      <p>{request.details}</p>
      <ul className="text-xs text-muted-foreground">
        {request.log.map((entry, index) => (
          <li key={`${entry.at}-${index}`}>{entry.at} · {entry.action} · {entry.note}</li>
        ))}
      </ul>
      <label className="block">
        What was done
        <input value={note} onChange={(event) => setNote(event.target.value)} className="mt-1 w-full rounded-md border border-border px-2 py-1" />
      </label>
      <label className="block">
        Kept for a legal, tax, claim, or dispute reason
        <input value={retained} onChange={(event) => setRetained(event.target.value)} className="mt-1 w-full rounded-md border border-border px-2 py-1" />
      </label>
      <div className="flex gap-2">
        <button type="button" className="h-9 rounded-md border px-3" onClick={() => void save("in_progress")}>Mark in progress</button>
        <button type="button" className="h-9 rounded-md border px-3" onClick={() => void save("done")}>Mark done</button>
      </div>
    </article>
  );
}

function SettingsForm({
  settings,
  onSaved,
}: {
  settings: ComplianceSettings;
  onSaved: (next: ComplianceSettings) => void;
}) {
  const [draft, setDraft] = useState(settings);
  useEffect(() => setDraft(settings), [settings]);
  return (
    <form
      className="space-y-3 text-sm"
      onSubmit={async (event) => {
        event.preventDefault();
        const { data } = await supabase.auth.getSession();
        const res = await fetch("/api/compliance", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${data.session?.access_token || ""}`,
          },
          body: JSON.stringify({ action: "save_settings", settings: draft }),
        });
        const json = await res.json();
        if (json.settings) onSaved(json.settings);
      }}
    >
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={draft.salesTaxEnabled}
          onChange={(event) => setDraft({ ...draft, salesTaxEnabled: event.target.checked })}
        />
        Show sales tax (off until an accountant confirms it, including commercial and DC work)
      </label>
      <label className="block">
        Tax rate as a decimal, used only when tax is on
        <input
          type="number"
          step="0.0001"
          value={draft.salesTaxRate}
          onChange={(event) => setDraft({ ...draft, salesTaxRate: Number(event.target.value) })}
          className="mt-1 w-40 rounded-md border border-border px-2 py-1"
        />
      </label>
      <fieldset className="space-y-1">
        <legend>Auto-renewal notice days (0 means not configured)</legend>
        {(["MD", "VA", "DC"] as const).map((state) => (
          <label key={state} className="mr-4">
            {state}
            <input
              type="number"
              min={0}
              value={draft.autoRenewalNoticeDays[state]}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  autoRenewalNoticeDays: { ...draft.autoRenewalNoticeDays, [state]: Number(event.target.value) },
                  autoRenewalCounselFlag: true,
                })
              }
              className="ml-1 w-16 rounded-md border border-border px-2 py-1"
            />
          </label>
        ))}
        <p className="text-xs text-amber-800">Draft pending legal review. Notice windows differ by state.</p>
      </fieldset>
      <label className="block">
        License or registration line (blank until supplied)
        <input
          value={draft.licenseLine}
          onChange={(event) => setDraft({ ...draft, licenseLine: event.target.value })}
          className="mt-1 w-full rounded-md border border-border px-2 py-1"
        />
      </label>
      <label className="block">
        Days to keep access codes after the job
        <input
          type="number"
          min={1}
          value={draft.accessRetentionDays}
          onChange={(event) => setDraft({ ...draft, accessRetentionDays: Number(event.target.value) })}
          className="mt-1 w-24 rounded-md border border-border px-2 py-1"
        />
      </label>
      <label className="block">
        Breach procedure
        <textarea
          value={draft.breachProcedure}
          onChange={(event) => setDraft({ ...draft, breachProcedure: event.target.value })}
          rows={4}
          className="mt-1 w-full rounded-md border border-border p-2"
        />
      </label>
      <p className="text-xs text-muted-foreground">
        Breach contacts: {draft.breachContacts.length === 0 ? "none yet" : draft.breachContacts.map((contact) => contact.email).join(", ")}.
        The affected-person list is the acceptance and booking email on file for the dates involved.
      </p>
      <button type="submit" className="h-10 rounded-md border border-border px-3 font-medium">Save settings</button>
    </form>
  );
}
