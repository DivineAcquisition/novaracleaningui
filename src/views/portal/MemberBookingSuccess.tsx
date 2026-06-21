"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  RiArrowRightLine,
  RiCalendarLine,
  RiCheckboxCircleLine,
  RiErrorWarningLine,
  RiLoader4Line,
  RiUserLine,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { SEO } from "@/components/SEO";

type State = "verifying" | "confirmed" | "pending" | "error";

export default function MemberBookingSuccess() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const [state, setState] = useState<State>("verifying");

  useEffect(() => {
    let cancelled = false;
    async function finalize() {
      if (!sessionId) {
        setState("error");
        return;
      }
      try {
        const { data, error } = await supabase.functions.invoke("portal-book-checkout", {
          body: { action: "verify", sessionId },
        });
        if (cancelled) return;
        if (error || (data as any)?.error) {
          setState("error");
          return;
        }
        setState((data as any)?.paid ? "confirmed" : "pending");
      } catch {
        if (!cancelled) setState("error");
      }
    }
    finalize();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <SEO title="Booking Confirmed" description="Your cleaning is booked." noindex />
      <Card className="max-w-lg w-full border-0 shadow-xl overflow-hidden animate-scale-in">
        <div className="h-1 w-full" style={{ background: "var(--gradient-primary)" }} />
        <CardContent className="pt-10 pb-8 space-y-6 text-center">
          {state === "verifying" && (
            <>
              <RiLoader4Line className="w-10 h-10 animate-spin text-primary mx-auto" />
              <div className="space-y-1.5">
                <h1 className="text-xl font-bold font-jakarta">Confirming your booking…</h1>
                <p className="text-sm text-muted-foreground">Just a moment while we verify your payment.</p>
              </div>
            </>
          )}

          {(state === "confirmed" || state === "pending") && (
            <>
              <div className="mx-auto w-20 h-20 rounded-2xl flex items-center justify-center shadow-lg" style={{ background: "var(--gradient-primary)" }}>
                <RiCheckboxCircleLine className="w-10 h-10 text-white" />
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl md:text-3xl font-bold font-jakarta tracking-tight">You&apos;re booked!</h1>
                <p className="text-muted-foreground text-sm md:text-base">
                  {state === "confirmed"
                    ? "Payment received and your cleaning is confirmed. We&apos;ll send the details to your email."
                    : "Thanks! Your payment is processing — we&apos;ll confirm your cleaning by email shortly."}
                </p>
              </div>
              <div className="space-y-3">
                <Button onClick={() => router.push("/account")} className="w-full h-12 bg-gradient-primary shadow-lg rounded-xl">
                  <RiCalendarLine className="w-5 h-5 mr-2" />
                  View My Bookings
                  <RiArrowRightLine className="w-4 h-4 ml-2" />
                </Button>
                <Button variant="outline" onClick={() => router.push("/portal/book")} className="w-full rounded-xl">
                  <RiUserLine className="w-4 h-4 mr-2" />
                  Book Another Clean
                </Button>
              </div>
            </>
          )}

          {state === "error" && (
            <>
              <div className="mx-auto w-16 h-16 rounded-2xl bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
                <RiErrorWarningLine className="w-8 h-8 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="space-y-2">
                <h1 className="text-xl font-bold">We couldn&apos;t confirm this just yet</h1>
                <p className="text-sm text-muted-foreground">
                  If you completed payment, your booking will appear in your account shortly. Otherwise you can try again.
                </p>
              </div>
              <div className="space-y-3">
                <Button onClick={() => router.push("/account")} className="w-full h-12 bg-gradient-primary rounded-xl">
                  Go to My Account
                </Button>
                <Button variant="outline" onClick={() => router.push("/portal/book")} className="w-full rounded-xl">
                  Back to Booking
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
