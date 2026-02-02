"use client";

import { DollarSign } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

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

  // Don't show if no savings
  if (totalSavings <= 0) return null;

  return (
    <div className="bg-gradient-to-br from-primary/5 to-primary/10 rounded-lg p-4 border border-primary/20">
      <div className="flex items-center gap-2 mb-3">
        <DollarSign className="w-5 h-5 text-green-600" />
        <h3 className="font-semibold">Your Savings</h3>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Original Price</span>
          <span>${originalPrice.toFixed(2)}</span>
        </div>

        {membershipDiscount > 0 && (
          <div className="flex justify-between text-green-600">
            <span>Membership Discount</span>
            <span>-${membershipDiscount.toFixed(2)}</span>
          </div>
        )}

        {fullPaymentDiscount > 0 && (
          <div className="flex justify-between text-green-600">
            <span>Full Payment Discount</span>
            <span>-${fullPaymentDiscount.toFixed(2)}</span>
          </div>
        )}

        {promoDiscount > 0 && (
          <div className="flex justify-between text-green-600">
            <span>Promo Discount</span>
            <span>-${promoDiscount.toFixed(2)}</span>
          </div>
        )}
      </div>

      <Separator className="my-3" />

      <div className="flex justify-between font-semibold">
        <span>You Pay</span>
        <span className="text-primary text-lg">${finalPrice.toFixed(2)}</span>
      </div>

      <div className="text-center mt-2">
        <Badge variant="secondary" className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
          Saving ${totalSavings.toFixed(2)}
        </Badge>
      </div>
    </div>
  );
};
