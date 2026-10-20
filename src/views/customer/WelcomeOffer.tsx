"use client";

import { useEffect, useState } from "react";
import { RiLoader4Line } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

interface Offer {
  firstName: string | null;
  code: string | null;
  percentOff: number;
  expiresAt: string | null;
  status: "ready" | "claimed" | "expired";
}

const PLANS = [
  { id: "monthly", label: "Monthly" },
  { id: "biweekly", label: "Every two weeks" },
  { id: "weekly", label: "Weekly" },
];

export default function WelcomeOfferPage({ token }: { token: string }) {
  const [offer, setOffer] = useState<Offer | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("membership-welcome", { body: { token } });
        if (cancelled) return;
        if (error || !data?.ok) {
          setMissing(true);
          return;
        }
        setOffer(data as Offer);
      } catch {
        if (!cancelled) setMissing(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!offer && !missing) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <RiLoader4Line className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (missing || !offer) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center text-muted-foreground">
            This offer link is not valid.
          </CardContent>
        </Card>
      </div>
    );
  }

  const expires = offer.expiresAt
    ? new Date(offer.expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : null;

  return (
    <div className="min-h-screen bg-gradient-hero flex items-center justify-center p-6">
      <Card className="max-w-lg w-full">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-jakarta">
            {offer.status === "ready"
              ? `${offer.percentOff}% off your first Glow month`
              : offer.status === "claimed"
                ? "This offer has been used"
                : "This offer has expired"}
          </CardTitle>
          <CardDescription>
            {offer.firstName ? `Hi ${offer.firstName}. ` : ""}
            {offer.status === "ready"
              ? `First-time members only, one per household${expires ? `, through ${expires}` : ""}. It applies to the first month. Later months are the regular price.`
              : "The code from this email can no longer be applied."}
          </CardDescription>
        </CardHeader>
        {offer.status === "ready" && offer.code && (
          <CardContent className="space-y-4">
            <p className="text-center text-2xl font-bold tracking-widest">{offer.code}</p>
            <div className="grid gap-2">
              {PLANS.map((plan) => (
                <Button key={plan.id} asChild className="w-full">
                  <a href={`/book/zip?membership=${plan.id}&welcome=${encodeURIComponent(offer.code || "")}`}>
                    Start {plan.label}
                  </a>
                </Button>
              ))}
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
