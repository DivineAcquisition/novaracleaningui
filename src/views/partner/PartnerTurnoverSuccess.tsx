"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RiCheckboxCircleLine, RiLoader4Line, RiErrorWarningLine, RiArrowRightLine } from "@remixicon/react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SEO } from "@/components/SEO";

type State = "verifying" | "ok" | "pending" | "error";

export default function PartnerTurnoverSuccess() {
  const router = useRouter();
  const params = useSearchParams();
  const sessionId = params.get("session_id");
  const [state, setState] = useState<State>("verifying");
  const [assignment, setAssignment] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!sessionId) { setState("error"); return; }
      try {
        const { data, error } = await supabase.functions.invoke("partner-turnover", {
          body: { action: "turnover.finalize", sessionId },
        });
        if (cancelled) return;
        if (error || (data as any)?.error) { setState("error"); return; }
        const d = data as { paid?: boolean; status?: string };
        if (d.paid) {
          setState("ok");
          setAssignment(d.status === "unassigned_alert" ? "We're matching you with a cleaner and will confirm shortly." : "Your cleaning crew is assigned.");
        } else {
          setState("pending");
        }
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 to-background flex items-center justify-center px-4">
      <SEO title="Turnover Confirmed" noindex />
      <Card className="w-full max-w-md shadow-xl border-0">
        <div className="h-1.5 w-full" style={{ background: "linear-gradient(90deg,#5C0FFE,#8F7BFD)" }} />
        <CardContent className="pt-10 pb-8 text-center space-y-5">
          {state === "verifying" && (
            <><RiLoader4Line className="w-10 h-10 animate-spin mx-auto" style={{ color: "#5C0FFE" }} />
              <h1 className="text-xl font-bold">Confirming your turnover…</h1>
              <p className="text-sm text-muted-foreground">Verifying your payment.</p></>
          )}
          {(state === "ok" || state === "pending") && (
            <>
              <div className="mx-auto w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: "#5C0FFE" }}>
                <RiCheckboxCircleLine className="w-8 h-8 text-white" />
              </div>
              <h1 className="text-2xl font-bold">Turnover confirmed!</h1>
              <p className="text-sm text-muted-foreground">{state === "ok" ? assignment : "Payment received — we'll confirm your assignment shortly."}</p>
              <Button onClick={() => router.push("/partner")} className="h-11 w-full">
                View my turnovers <RiArrowRightLine className="w-4 h-4 ml-2" />
              </Button>
            </>
          )}
          {state === "error" && (
            <>
              <div className="mx-auto w-16 h-16 rounded-2xl bg-amber-100 flex items-center justify-center"><RiErrorWarningLine className="w-8 h-8 text-amber-600" /></div>
              <h1 className="text-xl font-bold">We couldn't confirm just yet</h1>
              <p className="text-sm text-muted-foreground">If you completed payment, your turnover will appear on your dashboard shortly.</p>
              <Button onClick={() => router.push("/partner")} className="h-11 w-full">Go to portal</Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
