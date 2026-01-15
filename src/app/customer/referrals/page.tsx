"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { format, parseISO } from "date-fns";
import {
  Gift,
  Copy,
  Mail,
  MessageSquare,
  Users,
  DollarSign,
  CheckCircle,
} from "lucide-react";
import { toast } from "sonner";

interface Referral {
  id: string;
  code: string;
  status: string;
  referred_email: string | null;
  credit_cents: number | null;
  created_at: string;
}

export default function ReferralsPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [referralCode, setReferralCode] = useState("");
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [stats, setStats] = useState({
    totalReferrals: 0,
    successfulReferrals: 0,
    creditsEarned: 0,
  });

  useEffect(() => {
    const fetchReferralData = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.email) return;

      setIsLoading(true);
      try {
        const { data: customer } = await supabase
          .from("customers")
          .select("id, referral_code")
          .eq("email", session.user.email)
          .maybeSingle();

        if (customer?.referral_code) {
          setReferralCode(customer.referral_code);
        } else {
          const firstName = session.user.user_metadata?.first_name || session.user.email?.split("@")[0] || "";
          const newCode = `${firstName.toUpperCase().slice(0, 3)}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
          
          await supabase
            .from("customers")
            .update({ referral_code: newCode })
            .eq("email", session.user.email);
          
          setReferralCode(newCode);
        }

        if (customer?.id) {
          const { data: referralsData } = await supabase
            .from("referrals")
            .select("*")
            .eq("customer_id", customer.id)
            .order("created_at", { ascending: false });

          setReferrals(referralsData || []);

          const successful = referralsData?.filter((r) => r.status === "redeemed") || [];
          const creditsEarned = successful.reduce((sum, r) => sum + (r.credit_cents || 0), 0);

          setStats({
            totalReferrals: referralsData?.length || 0,
            successfulReferrals: successful.length,
            creditsEarned,
          });
        }
      } catch (error) {
        console.error("Error fetching referral data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchReferralData();
  }, []);

  const copyCode = () => {
    navigator.clipboard.writeText(referralCode);
    toast.success("Referral code copied!");
  };

  const shareViaEmail = () => {
    const subject = encodeURIComponent("$25 off your first cleaning with NovaraCleaning!");
    const body = encodeURIComponent(
      `Hey! I've been using NovaraCleaning and love it. Use my referral code ${referralCode} to get $25 off your first clean!\n\nBook here: https://try.novaracleaning.com`
    );
    window.open(`mailto:?subject=${subject}&body=${body}`);
  };

  const shareViaSMS = () => {
    const message = encodeURIComponent(
      `Hey! Use my code ${referralCode} to get $25 off your first clean with NovaraCleaning! Book here: https://try.novaracleaning.com`
    );
    window.open(`sms:?body=${message}`);
  };

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(cents / 100);
  };

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Referral Program</h1>
        <p className="text-sm text-muted-foreground">Share NovaraCleaning and earn rewards</p>
      </div>

      {/* Referral Code Card */}
      <Card>
        <CardHeader className="text-center pb-4">
          <CardTitle className="flex items-center justify-center gap-2">
            <Gift className="h-5 w-5" />
            Give $25, Get $25
          </CardTitle>
          <CardDescription>
            Share your code with friends. When they book, you both save!
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Code Display */}
          <div className="flex items-center justify-center gap-2">
            <div className="px-6 py-3 bg-muted rounded-lg border-2 border-dashed">
              <p className="text-2xl font-bold tracking-widest font-mono text-primary">
                {referralCode}
              </p>
            </div>
            <Button variant="outline" size="icon" onClick={copyCode}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>

          {/* Share Buttons */}
          <div className="grid grid-cols-3 gap-2">
            <Button variant="outline" onClick={copyCode}>
              <Copy className="mr-2 h-4 w-4" />
              Copy
            </Button>
            <Button variant="outline" onClick={shareViaEmail}>
              <Mail className="mr-2 h-4 w-4" />
              Email
            </Button>
            <Button variant="outline" onClick={shareViaSMS}>
              <MessageSquare className="mr-2 h-4 w-4" />
              Text
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Stats Cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6 text-center">
            <Users className="h-5 w-5 text-primary mx-auto mb-2" />
            <p className="text-2xl font-bold">{stats.totalReferrals}</p>
            <p className="text-xs text-muted-foreground">Total Referrals</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <CheckCircle className="h-5 w-5 text-emerald-500 mx-auto mb-2" />
            <p className="text-2xl font-bold">{stats.successfulReferrals}</p>
            <p className="text-xs text-muted-foreground">Successful</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <DollarSign className="h-5 w-5 text-primary mx-auto mb-2" />
            <p className="text-2xl font-bold">{formatCurrency(stats.creditsEarned)}</p>
            <p className="text-xs text-muted-foreground">Earned</p>
          </CardContent>
        </Card>
      </div>

      {/* How It Works */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">How It Works</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[
              { step: 1, title: "Share Your Code", description: "Send your unique referral code to friends and family" },
              { step: 2, title: "They Book", description: "Your friend enters your code at checkout and gets $25 off" },
              { step: 3, title: "You Earn", description: "You get $25 credit after their cleaning is completed" },
            ].map((item) => (
              <div key={item.step} className="flex items-start gap-3">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary flex-shrink-0">
                  {item.step}
                </div>
                <div>
                  <p className="font-medium text-sm">{item.title}</p>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Referral History */}
      {referrals.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Referral History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {referrals.map((referral) => (
                <div key={referral.id} className="flex items-center justify-between p-3 rounded-lg border">
                  <div>
                    <p className="text-sm font-medium">{referral.referred_email || "Pending referral"}</p>
                    <p className="text-xs text-muted-foreground">
                      {format(parseISO(referral.created_at), "MMM d, yyyy")}
                    </p>
                  </div>
                  <div className="text-right">
                    <Badge variant={referral.status === "redeemed" ? "default" : "outline"}>
                      {referral.status}
                    </Badge>
                    {referral.credit_cents && referral.status === "redeemed" && (
                      <p className="text-xs text-emerald-600 mt-1">+{formatCurrency(referral.credit_cents)}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
