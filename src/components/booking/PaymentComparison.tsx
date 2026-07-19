"use client";

import {
  RiCheckLine,
  RiFlashlightLine,
  RiGiftLine
} from "@remixicon/react";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

import { cn } from "@/lib/utils";

interface PaymentComparisonProps {
  depositPricing: {
    deposit: number;
    balanceDue: number;
    subtotal: number;
    newCustomerDiscount: number;
    membershipDiscount: number;
  };
  fullPaymentPricing: {
    originalTotal: number;
    finalAmount: number;
    discount: number;
    savings: number;
    newCustomerDiscount: number;
  };
  selectedOption: 'deposit' | 'full';
  onSelect: (option: 'deposit' | 'full') => void;
}

export function PaymentComparison({
  depositPricing,
  fullPaymentPricing,
  selectedOption,
  onSelect,
}: PaymentComparisonProps) {
  return (
    <div className="grid md:grid-cols-2 gap-3 md:gap-4">
      {/* Deposit Option */}
      <Card
        className={cn(
          "cursor-pointer transition-all border-2 hover:shadow-lg",
          selectedOption === 'deposit'
            ? "border-primary bg-primary/5 shadow-md ring-2 ring-primary/20"
            : "border-border hover:border-primary/50"
        )}
        onClick={() => onSelect('deposit')}
      >
        <CardContent className="p-4 md:p-5 space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <h4 className="font-semibold text-base md:text-lg">Pay 50% Deposit</h4>
              <p className="text-xs text-muted-foreground mt-1">Half today, half after service</p>
            </div>
            {selectedOption === 'deposit' && (
              <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                <RiCheckLine className="w-4 h-4 text-white" />
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-2xl md:text-3xl font-bold text-primary">
                ${depositPricing.deposit.toFixed(2)}
              </span>
              <span className="text-xs text-muted-foreground">due today</span>
            </div>
            
            <Separator />
            
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Service subtotal:</span>
                <span>${depositPricing.subtotal.toFixed(2)}</span>
              </div>
              
              {depositPricing.newCustomerDiscount > 0 && (
                <div className="flex items-center justify-between text-green-600 font-medium">
                  <span className="flex items-center gap-1.5">
                    <RiGiftLine className="w-3.5 h-3.5" />
                    New customer 25% off:
                  </span>
                  <span>-${depositPricing.newCustomerDiscount.toFixed(2)}</span>
                </div>
              )}

              {depositPricing.membershipDiscount > 0 && (
                <div className="flex justify-between text-success font-medium">
                  <span>Membership discount:</span>
                  <span>-${depositPricing.membershipDiscount.toFixed(2)}</span>
                </div>
              )}
              
              <Separator className="my-2" />
              
              <div className="flex justify-between font-semibold pt-1">
                <span>Remaining balance:</span>
                <span className="text-orange-600">${depositPricing.balanceDue.toFixed(2)}</span>
              </div>
              
              <p className="text-xs text-muted-foreground italic pt-2">
                Pay remaining balance after service
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Full Payment Option */}
      <Card
        className={cn(
          "cursor-pointer transition-all border-2 hover:shadow-lg relative",
          selectedOption === 'full'
            ? "border-primary bg-primary/5 shadow-md ring-2 ring-primary/20"
            : "border-border hover:border-primary/50"
        )}
        onClick={() => onSelect('full')}
      >
        <div className="absolute -top-2 -right-2 z-10">
          <div className="bg-success text-white text-xs font-bold px-3 py-1 rounded-full shadow-md">
            No balance due
          </div>
        </div>

        <CardContent className="p-4 md:p-5 space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <h4 className="font-semibold text-base md:text-lg">Pay in Full</h4>
              <p className="text-xs text-muted-foreground mt-1">One-and-done</p>
            </div>
            {selectedOption === 'full' && (
              <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                <RiCheckLine className="w-4 h-4 text-white" />
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-2xl md:text-3xl font-bold text-primary">
                ${fullPaymentPricing.finalAmount.toFixed(2)}
              </span>
              <span className="text-xs text-muted-foreground">due today</span>
            </div>
            
            <Separator />
            
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Original total:</span>
                <span className="line-through">${fullPaymentPricing.originalTotal.toFixed(2)}</span>
              </div>
              
              {fullPaymentPricing.newCustomerDiscount > 0 && (
                <div className="flex items-center justify-between text-green-600 font-medium">
                  <span className="flex items-center gap-1.5">
                    <RiGiftLine className="w-3.5 h-3.5" />
                    New customer 25% off:
                  </span>
                  <span>-${fullPaymentPricing.newCustomerDiscount.toFixed(2)}</span>
                </div>
              )}

              <Separator className="my-2" />

              <div className="flex items-center justify-between font-bold text-success pt-1">
                <span className="flex items-center gap-1.5">
                  <RiFlashlightLine className="w-4 h-4" />
                  Total savings:
                </span>
                <span className="text-lg">${fullPaymentPricing.savings.toFixed(2)}</span>
              </div>

              <p className="text-xs text-muted-foreground italic pt-2">
                No balance due — pay once and you're done.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
