import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { calculatePrice, HOME_SIZE_RANGES, SERVICE_TIER_PRICING, ADD_ONS, MEMBERSHIP_PLANS, NEW_CUSTOMER_DISCOUNT, DEPOSIT_AMOUNT } from "@/lib/pricing-system";
import { DollarSign, TrendingDown, User } from "lucide-react";

interface IntakePricingSidebarProps {
  homeSizeId: string;
  serviceType: string;
  addOns: string[];
  membershipPlan: string;
  applyNewCustomerDiscount: boolean;
}

export function IntakePricingSidebar({
  homeSizeId,
  serviceType,
  addOns,
  membershipPlan,
  applyNewCustomerDiscount,
}: IntakePricingSidebarProps) {
  const pricing = calculatePrice(
    homeSizeId,
    serviceType,
    addOns,
    membershipPlan,
    false,
    applyNewCustomerDiscount
  );

  const homeSize = HOME_SIZE_RANGES.find(h => h.id === homeSizeId);
  const estimatedHours = homeSize?.baseHours || 0;
  const cleanerPayout = estimatedHours * 20; // $20/hour

  const formatCurrency = (cents: number) => {
    return `$${(cents / 100).toFixed(2)}`;
  };

  const depositAmount = DEPOSIT_AMOUNT;
  const remainingBalance = pricing.total - depositAmount;

  return (
    <Card className="sticky top-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DollarSign className="w-5 h-5" />
          Live Pricing Calculator
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Base Pricing */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Base Price</span>
            <span className="font-medium">{formatCurrency(pricing.basePrice)}</span>
          </div>
          
          {pricing.serviceAddition > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">
                {serviceType === 'deep' ? 'Deep Clean' : 'Move-In/Out'} Add-on
              </span>
              <span className="font-medium">{formatCurrency(pricing.serviceAddition)}</span>
            </div>
          )}

          {addOns.map(addon => {
            const addonItem = ADD_ONS[addon as keyof typeof ADD_ONS];
            return addonItem ? (
              <div key={addon} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{addonItem.label}</span>
                <span className="font-medium">${addonItem.price}</span>
              </div>
            ) : null;
          })}

          <Separator className="my-2" />

          <div className="flex justify-between text-sm font-medium">
            <span>Subtotal</span>
            <span>{formatCurrency(pricing.subtotal)}</span>
          </div>
        </div>

        {/* Discounts */}
        {(applyNewCustomerDiscount || pricing.membershipDiscount > 0) && (
          <div className="space-y-2">
            <Separator />
            <div className="flex items-center gap-2 text-sm font-medium text-primary">
              <TrendingDown className="w-4 h-4" />
              <span>Savings</span>
            </div>

            {pricing.newCustomerDiscount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-green-600">New Customer Discount</span>
                <span className="text-green-600 font-medium">-${pricing.newCustomerDiscount}</span>
              </div>
            )}

            {pricing.membershipDiscount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-green-600">
                  {MEMBERSHIP_PLANS[membershipPlan as keyof typeof MEMBERSHIP_PLANS]?.label} Discount
                </span>
                <span className="text-green-600 font-medium">-${pricing.membershipDiscount}</span>
              </div>
            )}
          </div>
        )}

        <Separator />

        {/* Total */}
        <div className="space-y-3">
          <div className="flex justify-between text-lg font-bold">
            <span>Total</span>
            <span className="text-primary">${pricing.total}</span>
          </div>

          <div className="bg-muted/50 p-3 rounded-lg space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Deposit Today</span>
              <span className="font-semibold">${depositAmount}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Balance After Service</span>
              <span className="font-medium">${remainingBalance}</span>
            </div>
          </div>

          <div className="bg-muted/50 p-3 rounded-lg space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Full Payment Today</span>
              <span className="font-semibold">${pricing.total}</span>
            </div>
          </div>
        </div>

        <Separator />

        {/* Cleaner Payout Estimate */}
        <div className="bg-primary/5 p-3 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <User className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">Est. Cleaner Payout</span>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{estimatedHours} hours × $20/hr</span>
              <span className="font-bold text-primary">${cleanerPayout.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
