import {
  RiGiftLine,
  RiSparklingLine,
  RiVipCrownLine
} from "@remixicon/react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

import { useMembershipCredits } from "@/hooks/use-membership-credits";

export function MembershipBanner() {
  const { credits, loading } = useMembershipCredits();

  if (loading || !credits) {
    return null;
  }

  const planNames: Record<string, string> = {
    monthly: 'Novara Monthly',
    biweekly: 'Novara Bi-Weekly',
    weekly: 'Novara Weekly',
  };

  const planName = planNames[credits.membership_plan] || credits.membership_plan;
  const discountPercent = { monthly: 20, biweekly: 25, weekly: 30 }[credits.membership_plan] || 20;

  return (
    <Card className="bg-gradient-to-br from-primary/10 to-accent/10 border-primary/30 shadow-lg">
      <CardContent className="p-4 md:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className="bg-gradient-primary text-white border-0">
                <RiVipCrownLine className="w-3 h-3 mr-1" />
                {planName} Member
              </Badge>
            </div>
            
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <RiGiftLine className="w-4 h-4 text-primary" />
                <span className="font-semibold">
                  {credits.credits_remaining} {credits.credits_remaining === 1 ? 'Credit' : 'Credits'} Available
                </span>
              </div>
              
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <RiSparklingLine className="w-3 h-3" />
                <span>{discountPercent}% off all add-ons</span>
              </div>
            </div>
          </div>

          <div className="text-right">
            <div className="text-3xl font-bold text-primary">
              {credits.credits_remaining}
            </div>
            <div className="text-xs text-muted-foreground">
              of {credits.credits_per_month}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
