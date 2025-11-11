import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Crown, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { MEMBERSHIP_PLANS, SERVICE_TIER_PRICING, ADD_ONS } from "@/lib/pricing-system";

interface MembershipSectionProps {
  membershipPlan: string;
  useCredit: boolean;
  creditAvailable: boolean;
  creditAvailableDate: string;
  checkingCredit: boolean;
  serviceType: string;
  addOns: string[];
  onChange: (field: string, value: any) => void;
}

export function MembershipSection({ 
  membershipPlan, 
  useCredit,
  creditAvailable,
  creditAvailableDate,
  checkingCredit,
  serviceType,
  addOns,
  onChange 
}: MembershipSectionProps) {
  return (
    <Card>
      <CardContent className="p-6 space-y-4">
        <div className="flex items-center gap-2 text-primary mb-4">
          <Crown className="w-5 h-5" />
          <h3 className="text-lg font-semibold">Membership Options</h3>
        </div>
        
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
          {Object.entries(MEMBERSHIP_PLANS).map(([planId, plan]) => {
            const serviceTierPrice = SERVICE_TIER_PRICING[serviceType as keyof typeof SERVICE_TIER_PRICING]?.addition || 0;
            const addOnsTotal = addOns.reduce((sum, addon) => 
              sum + (ADD_ONS[addon as keyof typeof ADD_ONS]?.price || 0), 0
            );
            const extrasAmount = serviceTierPrice + addOnsTotal;
            const dollarSavings = extrasAmount * plan.discount;

            return (
              <Card
                key={planId}
                className={cn(
                  "cursor-pointer transition-all duration-300 hover:shadow-md hover:scale-[1.02]",
                  membershipPlan === planId && "ring-2 ring-primary shadow-lg scale-[1.02]"
                )}
                onClick={() => onChange('membershipPlan', planId)}
              >
                <CardContent className="p-4 space-y-2">
                  <div className="flex justify-between items-start">
                    <h4 className="font-bold text-sm">{plan.label}</h4>
                    {plan.discount > 0 && (
                      <div className="flex flex-col items-end gap-1">
                        <Badge variant="secondary" className="text-xs">
                          {(plan.discount * 100).toFixed(0)}% off
                        </Badge>
                        {extrasAmount > 0 && dollarSavings > 0 && (
                          <span className="text-xs font-semibold text-green-600">
                            Save ${dollarSavings.toFixed(2)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <p className="text-xl font-bold text-primary">
                    ${plan.monthlyPrice}<span className="text-xs text-muted-foreground">/mo</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{plan.description}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {membershipPlan !== 'none' && (
          <Card className="bg-muted/50 mt-4">
            <CardContent className="p-4">
              <div className="flex items-start space-x-3">
                <Checkbox
                  id="useCredit"
                  checked={useCredit}
                  onCheckedChange={(checked) => onChange('useCredit', checked)}
                  className="mt-1"
                />
                <div className="flex-1 space-y-2">
                  <Label
                    htmlFor="useCredit"
                    className="text-sm font-medium leading-none cursor-pointer"
                  >
                    Use membership credit for this booking
                  </Label>
                  {useCredit && !creditAvailable && creditAvailableDate && (
                    <div className="flex items-start gap-2 text-xs text-amber-600">
                      <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      <span>Credit available from {creditAvailableDate}</span>
                    </div>
                  )}
                  {useCredit && creditAvailable && (
                    <div className="flex items-center gap-2 text-xs text-success">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Credit available for this date</span>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </CardContent>
    </Card>
  );
}