import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { calculatePrice, HOME_SIZE_RANGES, SERVICE_TIER_PRICING, ADD_ONS, DEPOSIT_AMOUNT } from "@/lib/pricing-system";
import { DollarSign, TrendingDown, User } from "lucide-react";

interface SelectedCleaner {
  id: string;
  name: string;
  role: 'Lead' | 'Support';
  hourlyRate: number;
  distance: number;
}

interface IntakePricingSidebarProps {
  homeSizeId: string;
  serviceType: string;
  addOns: string[];
  membershipPlan: string;
  customDiscount?: number;
  selectedCleaners: SelectedCleaner[];
  estimatedHours: number;
}

export function IntakePricingSidebar({
  homeSizeId,
  serviceType,
  addOns,
  membershipPlan,
  customDiscount = 0,
  selectedCleaners,
  estimatedHours,
}: IntakePricingSidebarProps) {
  const pricing = calculatePrice(
    homeSizeId,
    serviceType,
    addOns,
    membershipPlan,
    false,
    false
  );

  // Apply custom discount
  const customDiscountCents = customDiscount * 100;
  const adjustedTotal = Math.max(0, pricing.total - customDiscountCents);

  // Calculate total cleaner payout from selected cleaners
  const totalCleanerPayout = selectedCleaners.reduce((sum, cleaner) => {
    return sum + (cleaner.hourlyRate * estimatedHours);
  }, 0);
  
  const companyProfit = (adjustedTotal / 100) - totalCleanerPayout;

  const formatCurrency = (cents: number) => {
    return `$${(cents / 100).toFixed(2)}`;
  };

  const depositAmount = DEPOSIT_AMOUNT;
  const remainingBalance = adjustedTotal - depositAmount;

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
        {customDiscount > 0 && (
          <div className="space-y-2">
            <Separator />
            <div className="flex items-center gap-2 text-sm font-medium text-primary">
              <TrendingDown className="w-4 h-4" />
              <span>Savings</span>
            </div>

            <div className="flex justify-between text-sm">
              <span className="text-green-600">Custom Discount</span>
              <span className="text-green-600 font-medium">-${customDiscount.toFixed(2)}</span>
            </div>
          </div>
        )}

        <Separator />

        {/* Total */}
        <div className="space-y-3">
          <div className="flex justify-between text-lg font-bold">
            <span>Total</span>
            <span className="text-primary">${adjustedTotal}</span>
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

        {/* Cleaner Payout Breakdown */}
        <div className="bg-primary/5 p-3 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <User className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">Cleaner Payout Breakdown</span>
          </div>
          
          {selectedCleaners.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No cleaners assigned yet
            </div>
          ) : (
            <div className="space-y-2">
              {selectedCleaners.map((cleaner, index) => (
                <div key={cleaner.id} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    {cleaner.name} ({cleaner.role}): ${cleaner.hourlyRate}/hr × {estimatedHours}h
                  </span>
                  <span className="font-medium">
                    ${(cleaner.hourlyRate * estimatedHours).toFixed(2)}
                  </span>
                </div>
              ))}
              
              <Separator className="my-1" />
              
              <div className="flex justify-between text-sm font-bold">
                <span>Total Cleaner Payout</span>
                <span className="text-primary">${totalCleanerPayout.toFixed(2)}</span>
              </div>
              
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Company Profit</span>
                <span className="font-semibold text-green-600">
                  ${companyProfit.toFixed(2)}
                </span>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
