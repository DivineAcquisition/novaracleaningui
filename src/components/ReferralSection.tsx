"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RiShareLine, RiFileCopyLine, RiUserAddLine, RiCheckLine, RiGiftLine } from "@remixicon/react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface ReferralSectionProps {
  email: string;
}

export function ReferralSection({ email }: ReferralSectionProps) {
  const [referralCode, setReferralCode] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  useEffect(() => {
    const fetchReferralCode = async () => {
      try {
        const { data } = await supabase
          .from('customers')
          .select('referral_code')
          .eq('email', email)
          .maybeSingle();

        if (data?.referral_code) {
          setReferralCode(data.referral_code);
        }
      } catch (error) {
        console.error('Error fetching referral code:', error);
      } finally {
        setIsLoading(false);
      }
    };

    if (email) {
      fetchReferralCode();
    }
  }, [email]);

  if (isLoading || !referralCode) {
    return null;
  }

  const referralLink = `https://try.novaracleaning.com/book/zip?ref=${referralCode}`;

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      toast.success("Copied to clipboard!");
      setTimeout(() => setCopiedField(null), 2000);
    } catch (error) {
      toast.error('Failed to copy');
    }
  };

  const handleShare = async () => {
    const shareData = {
      title: 'Get 50% off Novara Cleaning',
      text: `Use my referral code ${referralCode} to get 50% off your first cleaning with Novara!`,
      url: referralLink,
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        copyToClipboard(referralLink, 'link');
      }
    } catch (error) {
      console.error('Error sharing:', error);
    }
  };

  return (
    <Card className="overflow-hidden shadow-md border-0">
      <div className="h-0.5 w-full" style={{ background: 'var(--gradient-primary)' }} />
      <CardContent className="p-5 md:p-6">
        <div className="flex flex-col sm:flex-row gap-5">
          {/* Left: Info */}
          <div className="flex-1 space-y-3">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--gradient-primary)' }}>
                <RiGiftLine className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="font-bold text-base">Give $50, Get $50</h3>
                <p className="text-xs text-muted-foreground">Share with friends and you both save</p>
              </div>
            </div>

            <p className="text-sm text-muted-foreground leading-relaxed">
              Your friends get <span className="font-semibold text-foreground">50% off</span> their first booking, and you earn a <span className="font-semibold text-foreground">50%-off credit</span> when they complete it.
            </p>
          </div>

          {/* Right: Code + Actions */}
          <div className="sm:w-[260px] space-y-3">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">Your Code</label>
              <div className="flex gap-2">
                <Input 
                  value={referralCode} 
                  readOnly 
                  className="font-mono font-semibold text-sm h-10 rounded-lg bg-muted/50"
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 rounded-lg flex-shrink-0"
                  onClick={() => copyToClipboard(referralCode, 'code')}
                >
                  {copiedField === 'code' ? <RiCheckLine className="w-4 h-4 text-emerald-600" /> : <RiFileCopyLine className="w-4 h-4" />}
                </Button>
              </div>
            </div>

            <Button 
              onClick={handleShare} 
              className="w-full h-10 rounded-lg bg-gradient-primary shadow-sm"
            >
              <RiShareLine className="mr-2 h-4 w-4" />
              Share & Earn
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
