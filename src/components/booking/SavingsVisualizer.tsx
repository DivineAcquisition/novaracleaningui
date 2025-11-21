import { Progress } from "@/components/ui/progress";
import { DollarSign, TrendingDown } from "lucide-react";

interface SavingsVisualizerProps {
  originalPrice: number;
  newCustomerDiscount: number;
  membershipDiscount: number;
  fullPaymentDiscount: number;
  promoDiscount?: number;
  finalPrice: number;
  isMembershipSignup?: boolean;
}

export const SavingsVisualizer = ({
  originalPrice,
  newCustomerDiscount,
  membershipDiscount,
  fullPaymentDiscount,
  promoDiscount = 0,
  finalPrice,
  isMembershipSignup = false,
}: SavingsVisualizerProps) => {
  const totalSavings = newCustomerDiscount + membershipDiscount + fullPaymentDiscount + promoDiscount;
  const savingsPercentage = (totalSavings / originalPrice) * 100;

  // Calculate cumulative percentages for stacked visualization
  const newCustomerPercent = (newCustomerDiscount / originalPrice) * 100;
  const membershipPercent = ((newCustomerDiscount + membershipDiscount) / originalPrice) * 100;
  const fullPaymentPercent = ((newCustomerDiscount + membershipDiscount + fullPaymentDiscount) / originalPrice) * 100;
  const promoPercent = ((newCustomerDiscount + membershipDiscount + fullPaymentDiscount + promoDiscount) / originalPrice) * 100;

  return (
    <div className="bg-gradient-to-br from-primary/5 to-primary/10 rounded-lg p-4 md:p-6 border border-primary/20">
      <div className="flex items-center gap-2 mb-4">
        <TrendingDown className="w-5 h-5 text-primary" />
        <h3 className="font-semibold text-base md:text-lg">Your Savings Breakdown</h3>
      </div>

      {/* Visual Progress Bars */}
      <div className="space-y-3 mb-4">
        <div className="flex items-center justify-between text-xs md:text-sm mb-1">
          <span className="text-muted-foreground">Original Price</span>
          <span className="font-semibold">${originalPrice.toFixed(2)}</span>
        </div>

        {/* New Customer Discount Bar */}
        {newCustomerDiscount > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-foreground/80">New Customer Discount</span>
              <span className="text-green-600 font-medium">-${newCustomerDiscount.toFixed(2)}</span>
            </div>
            <Progress 
              value={newCustomerPercent} 
              className="h-2 bg-muted"
            />
          </div>
        )}

        {/* Membership Discount Bar or Clarification */}
        {isMembershipSignup && membershipDiscount === 0 ? (
          <div className="bg-primary/5 border border-primary/20 rounded-md p-3">
            <div className="flex items-center gap-2 text-xs md:text-sm">
              <span className="text-primary font-medium">💡 Your membership includes this standard cleaning!</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Membership discounts apply to extras (add-ons, deep cleans) and future bookings
            </p>
          </div>
        ) : membershipDiscount > 0 ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-foreground/80">Membership Discount</span>
              <span className="text-green-600 font-medium">-${membershipDiscount.toFixed(2)}</span>
            </div>
            <Progress 
              value={membershipPercent} 
              className="h-2 bg-muted"
            />
          </div>
        ) : null}

        {/* Full Payment Discount Bar */}
        {fullPaymentDiscount > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-foreground/80">Full Payment Discount</span>
              <span className="text-green-600 font-medium">-${fullPaymentDiscount.toFixed(2)}</span>
            </div>
            <Progress 
              value={fullPaymentPercent} 
              className="h-2 bg-muted"
            />
          </div>
        )}

        {/* Promo Discount Bar */}
        {promoDiscount > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-foreground/80">🎄 Holiday Promo</span>
              <span className="text-green-600 font-medium">-${promoDiscount.toFixed(2)}</span>
            </div>
            <Progress 
              value={promoPercent} 
              className="h-2 bg-muted"
            />
          </div>
        )}
      </div>

      {/* Total Savings Summary */}
      <div className="border-t border-primary/20 pt-3 mt-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-green-600" />
            <span className="font-semibold text-sm md:text-base">Total Savings</span>
          </div>
          <span className="text-lg md:text-xl font-bold text-green-600">
            ${totalSavings.toFixed(2)}
          </span>
        </div>
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs md:text-sm text-muted-foreground">You Pay</span>
          <span className="text-base md:text-lg font-bold text-primary">
            ${finalPrice.toFixed(2)}
          </span>
        </div>
        <div className="text-center mt-2">
          <span className="text-xs text-green-600 font-medium">
            Saving {savingsPercentage.toFixed(0)}% off original price!
          </span>
        </div>
      </div>
    </div>
  );
};
