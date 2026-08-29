"use client";

// Stripe redirects here after a tip checkout. We confirm the session with
// the tip-cleaner function, which verifies payment with Stripe and records
// the pass-through shares against the job's actual crew (idempotent).

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { RiHeart3Fill, RiLoader4Line, RiErrorWarningLine } from "@remixicon/react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export default function TipSuccess() {
  const params = useSearchParams();
  const sessionId = params.get("session_id") || "";
  const [state, setState] = useState<"working" | "done" | "error">("working");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!sessionId) {
      setState("error");
      setMessage("Missing checkout session.");
      return;
    }
    void (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("tip-cleaner", {
          body: { action: "confirm", sessionId },
        });
        if (error) throw error;
        const d = data as { ok?: boolean; error?: string };
        if (!d?.ok) throw new Error(d?.error || "Could not confirm the tip");
        setState("done");
      } catch (e) {
        setState("error");
        setMessage(e instanceof Error ? e.message : "Could not confirm the tip");
      }
    })();
  }, [sessionId]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-50 to-background flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-3xl bg-white shadow-xl shadow-violet-100 ring-1 ring-slate-100 p-8 text-center space-y-4">
        {state === "working" && (
          <>
            <RiLoader4Line className="w-10 h-10 text-violet-500 mx-auto animate-spin" />
            <h1 className="text-xl font-bold text-slate-900">Recording your tip…</h1>
            <p className="text-sm text-slate-500">One moment while we pass it along.</p>
          </>
        )}
        {state === "done" && (
          <>
            <div className="w-14 h-14 rounded-2xl bg-violet-100 flex items-center justify-center mx-auto">
              <RiHeart3Fill className="w-8 h-8 text-violet-600" />
            </div>
            <h1 className="text-xl font-bold text-slate-900">Thank you!</h1>
            <p className="text-sm text-slate-600">
              Your tip is on its way — 100% goes to your cleaning crew.
              They&apos;ve been notified.
            </p>
            <Button asChild className="mt-2">
              <Link href="/account">Back to my account</Link>
            </Button>
          </>
        )}
        {state === "error" && (
          <>
            <RiErrorWarningLine className="w-10 h-10 text-amber-500 mx-auto" />
            <h1 className="text-xl font-bold text-slate-900">Something went wrong</h1>
            <p className="text-sm text-slate-600">{message}</p>
            <p className="text-xs text-slate-400">
              If you were charged, don&apos;t worry — our team reconciles every
              tip and your crew will receive it.
            </p>
            <Button asChild variant="outline" className="mt-2">
              <Link href="/account">Back to my account</Link>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
