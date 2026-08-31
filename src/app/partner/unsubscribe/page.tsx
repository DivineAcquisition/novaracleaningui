"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";

function UnsubscribeInner() {
  const params = useSearchParams();
  const token = params?.get("t") || params?.get("token") || "";
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("This unsubscribe link is missing its token.");
      return;
    }
    fetch(`/api/partnership-comms/unsubscribe?t=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const out = await res.json().catch(() => ({}));
        if (!res.ok || out.ok === false) throw new Error(out.error || "This link is not valid.");
        setEmail(out.email || null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "This link is not valid."));
  }, [token]);

  const confirm = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/partnership-comms/unsubscribe?t=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ t: token }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.ok === false) throw new Error(out.error || "Could not unsubscribe.");
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not unsubscribe.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-16">
      <div className="max-w-md w-full rounded-2xl border border-slate-200 bg-white p-8 shadow-sm text-center">
        <p className="text-[10px] font-bold tracking-[0.14em] uppercase text-violet-700">Novara Cleaning</p>
        <h1 className="mt-3 text-xl font-bold text-slate-900">Partnership emails</h1>
        {error && <p className="mt-4 text-sm text-rose-600">{error}</p>}
        {!error && done && (
          <p className="mt-4 text-sm text-slate-600">
            You&apos;re unsubscribed from partnership emails{email ? ` sent to ${email}` : ""}.
            You can still receive SMS unless you reply STOP.
          </p>
        )}
        {!error && !done && (
          <>
            <p className="mt-4 text-sm text-slate-600">
              Unsubscribe {email ? <strong>{email}</strong> : "this address"} from partnership
              emails? SMS is unchanged unless you text STOP.
            </p>
            <Button className="mt-6" onClick={() => void confirm()} disabled={busy || !token}>
              {busy ? "Unsubscribing…" : "Unsubscribe from emails"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export default function PartnerUnsubscribePage() {
  return (
    <Suspense>
      <UnsubscribeInner />
    </Suspense>
  );
}
