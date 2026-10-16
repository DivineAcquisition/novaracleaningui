"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

import { supabase } from "@/integrations/supabase/client";
import { PAYMENT_SUMMARY_TITLE } from "@/lib/payout-methods";

export default function PaymentSummaryPage() {
  const params = useParams<{ id: string }>();
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const res = await fetch(`/api/cleaner/payment-summary/${params.id}`, {
        headers: { Authorization: `Bearer ${data.session?.access_token || ""}` },
      });
      const body = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (!res.ok || !body.summary?.text) {
        setError(body.error || "This payment summary isn't available.");
        return;
      }
      setText(body.summary.text);
    })();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  const download = () => {
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "payment-summary.txt";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="max-w-xl mx-auto p-6 space-y-4">
      <h1 className="text-xl font-semibold">{PAYMENT_SUMMARY_TITLE}</h1>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {text ? (
        <>
          <pre className="whitespace-pre-wrap text-sm border rounded-lg p-4 bg-white">{text}</pre>
          <button type="button" className="text-sm underline" onClick={download}>Download</button>
        </>
      ) : null}
    </main>
  );
}
