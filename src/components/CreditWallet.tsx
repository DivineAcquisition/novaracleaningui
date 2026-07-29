"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { RiMoneyDollarCircleLine, RiGift2Line } from "@remixicon/react";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";

interface CreditRow {
  id: string;
  amount_cents: number;
  source: string;
  status: string;
  reason: string | null;
  created_at: string;
  applied_at: string | null;
  expires_at: string | null;
}

interface CreditBalance {
  balance_cents: number;
  lifetime_granted_cents: number;
  lifetime_applied_cents: number;
  open_count: number;
}

interface Props {
  email: string;
}

const SOURCE_LABEL: Record<string, string> = {
  referral: "Referral reward",
  admin_grant: "Account credit",
  promo: "Promo",
  refund_credit: "Refunded as credit",
  perk: "Loyalty perk",
  adjustment: "Account adjustment",
};

export function CreditWallet({ email }: Props) {
  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState<CreditBalance | null>(null);
  const [rows, setRows] = useState<CreditRow[]>([]);
  const [hasWallet, setHasWallet] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const cleanEmail = email?.trim();
      if (!cleanEmail) {
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        // Resolve credits by EMAIL (case-insensitive) so the wallet shows up
        // regardless of which customer row the credit was granted against.
        const [{ data: bal }, { data: history }] = await Promise.all([
          (supabase.rpc as any)("get_customer_credit_balance_by_email", { _email: cleanEmail }),
          // Revoked rows are an internal correction, not something the
          // customer needs to see in their own activity feed.
          (supabase.from as any)("customer_credits")
            .select("id, amount_cents, source, status, reason, created_at, applied_at, expires_at")
            .ilike("email", cleanEmail)
            .neq("status", "revoked")
            .order("created_at", { ascending: false })
            .limit(20),
        ]);
        if (cancelled) return;
        const b = (bal as unknown as CreditBalance) || null;
        setBalance(b);
        setRows((history as unknown as CreditRow[]) || []);
        setHasWallet((b?.lifetime_granted_cents ?? 0) > 0);
      } catch (e) {
        console.error("[CreditWallet] load error", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [email]);

  if (loading) {
    return (
      <Card className="overflow-hidden shadow-md border-0">
        <div className="h-0.5 w-full" style={{ background: "var(--gradient-primary)" }} />
        <CardContent className="p-5 md:p-6 space-y-3">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-64" />
        </CardContent>
      </Card>
    );
  }

  // Don't show the section to customers with no history yet — they'll
  // see their first credit when a referral redeems or admin grants one.
  if (!hasWallet || (balance?.lifetime_granted_cents ?? 0) === 0) {
    return null;
  }

  return (
    <Card className="overflow-hidden shadow-md border-0">
      <div className="h-0.5 w-full" style={{ background: "var(--gradient-primary)" }} />
      <CardContent className="p-5 md:p-6">
        <div className="flex flex-col sm:flex-row sm:items-start gap-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "var(--gradient-primary)" }}>
              <RiMoneyDollarCircleLine className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-base">Novara Credit Wallet</h3>
              <p className="text-xs text-muted-foreground">Apply at checkout on any booking.</p>
            </div>
          </div>

          <div className="flex-1 grid grid-cols-3 gap-3 sm:gap-4">
            <div>
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Balance</p>
              <p className="text-2xl font-bold text-emerald-600">
                ${((balance?.balance_cents || 0) / 100).toFixed(2)}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Lifetime</p>
              <p className="text-lg font-semibold">${((balance?.lifetime_granted_cents || 0) / 100).toFixed(2)}</p>
            </div>
            <div>
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Used</p>
              <p className="text-lg font-semibold">${((balance?.lifetime_applied_cents || 0) / 100).toFixed(2)}</p>
            </div>
          </div>
        </div>

        {rows.length > 0 && (
          <div className="mt-5 pt-4 border-t">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-3">Recent activity</p>
            <div className="space-y-1.5 max-h-60 overflow-y-auto">
              {rows.map((r) => {
                const negative = r.amount_cents < 0 || r.status === "applied";
                return (
                  <div key={r.id} className="flex items-center justify-between text-sm bg-muted/30 rounded-lg px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <RiGift2Line className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="font-medium truncate">
                          {SOURCE_LABEL[r.source] || r.source}
                        </span>
                        <Badge variant="outline" className="text-[10px] capitalize">
                          {r.status}
                        </Badge>
                      </div>
                      {r.reason && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{r.reason}</p>
                      )}
                      <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                        {format(new Date(r.applied_at || r.created_at), "MMM d, yyyy")}
                      </p>
                    </div>
                    <div className={`text-sm font-semibold ${negative ? "text-muted-foreground" : "text-emerald-600"}`}>
                      {r.amount_cents > 0 ? "+" : ""}${(r.amount_cents / 100).toFixed(2)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
