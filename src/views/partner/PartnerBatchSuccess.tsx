"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RiCheckboxCircleLine, RiLoader4Line, RiErrorWarningLine, RiArrowRightLine } from "@remixicon/react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SEO } from "@/components/SEO";

type State = "verifying" | "ok" | "pending" | "error";

export default function PartnerBatchSuccess() {
  const router = useRouter();
  const params = useSearchParams();
  const sessionId = params.get("session_id");
  const [state, setState] = useState<State>("verifying");
  const [summary, setSummary] = useState<{ count?: number; total?: number; weekStart?: string }>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!sessionId) { setState("error"); return; }
      try {
        const { data, error } = await supabase.functions.invoke("partner-turnover", {
          body: { action: "batch.finalize", sessionId },
        });
        if (cancelled) return;
        if (error || (data as any)?.error) { setState("error"); return; }
        const d = data as { paid?: boolean; count?: number; total?: number; weekStart?: string };
        setSummary({ count: d.count, total: d.total, weekStart: d.weekStart });
        setState(d.paid ? "ok" : "pending");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#EDE9FE] to-white flex items-center justify-center px-4">
      <SEO title="Week Scheduled" noindex />
      <Card className="w-full max-w-md shadow-xl border-0">
        <div className="h-1.5 w-full" style={{ background: "linear-gradient(90deg,#5500FF,#918CFF)" }} />
        <CardContent className="pt-10 pb-8 text-center space-y-5">
          {state === "verifying" && (
            <><RiLoader4Line className="w-10 h-10 animate-spin mx-auto" style={{ color: "#5500FF" }} />
              <h1 className="text-xl font-bold">Confirming your week…</h1>
              <p className="text-sm text-muted-foreground">Verifying payment and scheduling your turnovers.</p></>
          )}
          {(state === "ok" || state === "pending") && (
            <>
              <div className="mx-auto w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: "#5500FF" }}>
                <RiCheckboxCircleLine className="w-8 h-8 text-white" />
              </div>
              <h1 className="text-2xl font-bold">Week scheduled!</h1>
              <p className="text-sm text-muted-foreground">
                {summary.count != null
                  ? `${summary.count} turnover${summary.count === 1 ? "" : "s"} scheduled${summary.weekStart ? ` for the week of ${summary.weekStart}` : ""}${summary.total != null ? `, total $${Number(summary.total).toFixed(0)}` : ""}. We're assigning your cleaning crews now.`
                  : "Payment received — we're scheduling and assigning your turnovers."}
              </p>
              <Button onClick={() => router.push("/partner/dashboard")} className="w-full h-11" style={{ background: "#5500FF" }}>
                View my turnovers <RiArrowRightLine className="w-4 h-4 ml-2" />
              </Button>
            </>
          )}
          {state === "error" && (
            <>
              <div className="mx-auto w-16 h-16 rounded-2xl bg-amber-100 flex items-center justify-center"><RiErrorWarningLine className="w-8 h-8 text-amber-600" /></div>
              <h1 className="text-xl font-bold">We couldn't confirm just yet</h1>
              <p className="text-sm text-muted-foreground">If you completed payment, your turnovers will appear on your dashboard shortly.</p>
              <Button onClick={() => router.push("/partner/dashboard")} className="w-full h-11" style={{ background: "#5500FF" }}>Go to dashboard</Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
