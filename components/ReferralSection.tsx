"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Share2, Copy, UserPlus, Check } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface ReferralSectionProps {
  email: string;
}

export function ReferralSection({ email }: ReferralSectionProps) {
  const [referralCode, setReferralCode] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [copied, setCopied] = useState(false);

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

  const referralLink = `${window.location.origin}/book?ref=${referralCode}`;

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(`${label} copied to clipboard!`);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast.error('Failed to copy');
    }
  };

  const handleShare = async () => {
    const shareData = {
      title: 'Get $50 off Novara Cleaning',
      text: `Use my referral code ${referralCode} to get $50 off your first cleaning with Novara!`,
      url: referralLink,
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
        toast.success('Shared successfully!');
      } else {
        copyToClipboard(referralLink, 'Referral link');
      }
    } catch (error) {
      console.error('Error sharing:', error);
    }
  };

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-accent/5">
      <CardHeader className="pb-3 md:pb-4">
        <CardTitle className="text-base md:text-xl flex items-center gap-2">
          <UserPlus className="w-5 h-5 text-primary" />
          Share & Earn $50 Credit
        </CardTitle>
        <CardDescription className="text-xs md:text-sm">
          Refer friends and get $50 off your next cleaning when they book!
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label className="text-xs md:text-sm">Your Referral Code</Label>
          <div className="flex gap-2 mt-1.5">
            <Input 
              value={referralCode} 
              readOnly 
              className="font-mono text-sm md:text-base"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => copyToClipboard(referralCode, 'Referral code')}
              className="shrink-0"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        <div>
          <Label className="text-xs md:text-sm">Referral Link</Label>
          <div className="flex gap-2 mt-1.5">
            <Input 
              value={referralLink} 
              readOnly 
              className="text-xs md:text-sm"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => copyToClipboard(referralLink, 'Referral link')}
              className="shrink-0"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        <Button 
          onClick={handleShare} 
          className="w-full h-10 md:h-12 text-sm md:text-base bg-gradient-primary shadow-elegant"
        >
          <Share2 className="mr-2 h-4 w-4" />
          Share Referral
        </Button>

        <div className="text-xs text-muted-foreground text-center pt-2">
          Your friends get $50 off their first booking, and you earn $50 credit when they complete it!
        </div>
      </CardContent>
    </Card>
  );
}
