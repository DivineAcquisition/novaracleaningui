import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, Home, Sparkles, MapPin } from "lucide-react";
import { format } from "date-fns";
import { HOME_SIZE_RANGES, SERVICE_TIER_PRICING, MEMBERSHIP_PLANS, calculatePrice, calculateFullPaymentWithDiscount } from "@/lib/pricing-system";

const TIME_SLOT_LABELS: Record<string, string> = {
  "8-12": "8:00 AM - 12:00 PM",
  "12-16": "12:00 PM - 4:00 PM",
  "16-20": "4:00 PM - 8:00 PM",
};

interface OrderSummaryCardProps {
  bookingData: any;
  isNewCustomer: boolean;
}

export function OrderSummaryCard({ bookingData, isNewCustomer }: OrderSummaryCardProps) {
  const homeSize = HOME_SIZE_RANGES.find(h => h.id === bookingData.homeSizeId);
  const serviceTier = SERVICE_TIER_PRICING[bookingData.serviceType as keyof typeof SERVICE_TIER_PRICING];
  const membership = MEMBERSHIP_PLANS[bookingData.membershipPlan as keyof typeof MEMBERSHIP_PLANS];
  
  const depositPricing = calculatePrice(
    bookingData.homeSizeId,
    bookingData.serviceType,
    bookingData.addOns,
    bookingData.membershipPlan,
    bookingData.useCredit,
    isNewCustomer
  );

  const fullPaymentPricing = calculateFullPaymentWithDiscount(
    bookingData.homeSizeId,
    bookingData.serviceType,
    bookingData.addOns,
    bookingData.membershipPlan,
    bookingData.useCredit,
    isNewCustomer
  );

  const currentAmount = bookingData.paymentOption === 'full' 
    ? fullPaymentPricing.finalAmount 
    : depositPricing.deposit;

  return (
    <Card className="border-primary/20 sticky top-8">
      <CardHeader>
        <CardTitle className="text-lg">Order Summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <Sparkles className="w-5 h-5 text-primary mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold text-sm">{serviceTier?.label}</p>
              <p className="text-xs text-muted-foreground">{homeSize?.label}</p>
            </div>
          </div>

          {bookingData.serviceDate && (
            <div className="flex items-start gap-3">
              <Calendar className="w-5 h-5 text-primary mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-sm">
                  {format(new Date(bookingData.serviceDate), "MMM d, yyyy")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {TIME_SLOT_LABELS[bookingData.timeSlot]}
                </p>
              </div>
            </div>
          )}

          <div className="flex items-start gap-3">
            <MapPin className="w-5 h-5 text-primary mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold text-sm">Service Location</p>
              <p className="text-xs text-muted-foreground">ZIP: {bookingData.zipCode}</p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Home className="w-5 h-5 text-primary mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold text-sm">{membership?.label}</p>
              {membership?.discount > 0 && (
                <Badge variant="secondary" className="text-xs mt-1">
                  {(membership.discount * 100).toFixed(0)}% savings
                </Badge>
              )}
            </div>
          </div>
        </div>

        <Separator />

        <div className="space-y-2">
          {bookingData.paymentOption === 'full' ? (
            <>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Original Total:</span>
                <span className="line-through">${fullPaymentPricing.originalTotal.toFixed(2)}</span>
              </div>
              {fullPaymentPricing.discount > 0 && (
                <div className="flex justify-between text-sm text-success">
                  <span>10% Discount:</span>
                  <span>-${fullPaymentPricing.discount.toFixed(2)}</span>
                </div>
              )}
              {fullPaymentPricing.newCustomerDiscount > 0 && (
                <div className="flex justify-between text-sm text-green-600">
                  <span>New Customer:</span>
                  <span>-${fullPaymentPricing.newCustomerDiscount.toFixed(2)}</span>
                </div>
              )}
              <Separator className="my-2" />
              <div className="flex justify-between text-base font-bold">
                <span>Total Due Today:</span>
                <span className="text-primary">${currentAmount.toFixed(2)}</span>
              </div>
            </>
          ) : (
            <>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Deposit:</span>
                <span>${depositPricing.deposit.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Balance After Service:</span>
                <span>${depositPricing.balanceDue.toFixed(2)}</span>
              </div>
              {(depositPricing.membershipDiscount > 0 || depositPricing.newCustomerDiscount > 0) && (
                <>
                  <Separator className="my-2" />
                  {depositPricing.membershipDiscount > 0 && (
                    <div className="flex justify-between text-sm text-success">
                      <span>Membership Savings:</span>
                      <span>-${depositPricing.membershipDiscount.toFixed(2)}</span>
                    </div>
                  )}
                  {depositPricing.newCustomerDiscount > 0 && (
                    <div className="flex justify-between text-sm text-green-600">
                      <span>New Customer:</span>
                      <span>-${depositPricing.newCustomerDiscount.toFixed(2)}</span>
                    </div>
                  )}
                </>
              )}
              <Separator className="my-2" />
              <div className="flex justify-between text-base font-bold">
                <span>Due Today:</span>
                <span className="text-primary">${currentAmount.toFixed(2)}</span>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}