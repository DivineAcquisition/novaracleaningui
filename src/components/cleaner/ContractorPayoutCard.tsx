"use client";

import { useEffect, useState } from "react";
import { RiBankCardLine } from "@remixicon/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import PayoutMethodStep from "@/components/cleaner/PayoutMethodStep";

type Profile = {
  methodName?: string | null;
  status?: string | null;
  identifier?: string | null;
  accountName?: string | null;
  changePending?: boolean;
  confirmDetails?: boolean;
};

const STATUS_LABEL: Record<string, string> = {
  verified: "Verified",
  pending: "Pending",
  on_hold: "On hold",
};

export default function ContractorPayoutCard({ onStripe }: { onStripe: () => void }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [nextPayRunDate, setNextPayRunDate] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [stripeLoading, setStripeLoading] = useState(false);

  const load = async () => {
    const { data } = await supabase.auth.getSession();
    const res = await fetch("/api/cleaner/payout-method", {
      headers: { Authorization: `Bearer ${data.session?.access_token || ""}` },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return;
    setProfile(body.profile || null);
    setNextPayRunDate(body.nextPayRunDate || null);
  };

  useEffect(() => {
    void load().catch(() => undefined);
  }, []);

  const startStripe = async () => {
    setStripeLoading(true);
    try {
      await onStripe();
    } finally {
      setStripeLoading(false);
    }
  };

  return (
    <div className="p-3 border rounded-lg space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <RiBankCardLine className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">How you get paid</span>
        </div>
        {profile?.status ? (
          <Badge variant="outline" className="text-xs">{STATUS_LABEL[profile.status] || profile.status}</Badge>
        ) : (
          <Badge variant="outline" className="text-xs">Not set</Badge>
        )}
      </div>
      {profile?.methodName ? (
        <div className="text-sm space-y-1">
          <p>{profile.methodName}{profile.identifier ? ` · ${profile.identifier}` : ""}</p>
          {profile.accountName ? <p className="text-xs text-muted-foreground">Name on the account: {profile.accountName}</p> : null}
          {profile.changePending ? <p className="text-xs text-amber-700">A change is pending until you confirm the code.</p> : null}
          {profile.confirmDetails ? <p className="text-xs text-amber-700">Please confirm these details. A payment didn't go through.</p> : null}
          {nextPayRunDate && profile.status === "verified" && profile.methodName !== "Stripe" ? (
            <p className="text-xs text-muted-foreground">Next pay run: {nextPayRunDate}</p>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Stripe is the fastest way to get paid. Cash App, Zelle, and Chime are paid on the weekly pay run.</p>
      )}
      {changing || !profile ? (
        <PayoutMethodStep stripeLoading={stripeLoading} onStripe={() => void startStripe()} onVerified={() => { setChanging(false); void load(); }} />
      ) : (
        <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => setChanging(true)}>
          Change method or details
        </Button>
      )}
    </div>
  );
}
