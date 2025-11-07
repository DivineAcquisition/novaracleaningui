import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Calendar, Clock, Home, MapPin, User, Mail, Phone, Sparkles } from "lucide-react";
import { ProgressBar } from "@/components/booking/ProgressBar";
import { calculatePrice, HOME_SIZE_RANGES, SERVICE_TIER_PRICING, ADD_ONS, MEMBERSHIP_PLANS } from "@/lib/pricing-system";
import { format } from "date-fns";

const BOOKING_STEPS = [
  { number: 1, label: "Location" },
  { number: 2, label: "Home Size" },
  { number: 3, label: "Service" },
  { number: 4, label: "Schedule" },
  { number: 5, label: "Details" },
  { number: 6, label: "Payment" },
];

const TIME_SLOT_LABELS: Record<string, string> = {
  "8-12": "8:00 AM - 12:00 PM",
  "12-16": "12:00 PM - 4:00 PM",
  "16-20": "4:00 PM - 8:00 PM",
};

export default function BookingSummary() {
  const navigate = useNavigate();
  const { bookingData, currentStep, setCurrentStep } = useBooking();

  const homeSize = HOME_SIZE_RANGES.find(h => h.id === bookingData.homeSizeId);
  const serviceTier = SERVICE_TIER_PRICING[bookingData.serviceType as keyof typeof SERVICE_TIER_PRICING];
  const membership = MEMBERSHIP_PLANS[bookingData.membershipPlan as keyof typeof MEMBERSHIP_PLANS];
  const pricing = calculatePrice(
    bookingData.homeSizeId,
    bookingData.serviceType,
    bookingData.addOns,
    bookingData.membershipPlan,
    bookingData.useCredit
  );

  const handleBack = () => {
    setCurrentStep(5);
    navigate("/book/details");
  };

  const handleConfirm = () => {
    navigate("/book/checkout");
  };

  return (
    <div className="min-h-screen bg-gradient-hero">
      <ProgressBar currentStep={currentStep} totalSteps={6} steps={BOOKING_STEPS} />
      
      <div className="container max-w-4xl mx-auto px-4 py-8">
        <Card className="shadow-xl">
          <CardHeader className="text-center space-y-2 pb-8">
            <CardTitle className="text-3xl font-bold">Review your booking</CardTitle>
            <CardDescription className="text-base">
              Please review your booking details before confirming
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-8">
            <div className="grid gap-6 md:grid-cols-2">
              {/* Service Details */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-primary" />
                    Service Details
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Home className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm text-muted-foreground">Home Size</p>
                      <p className="font-medium">{homeSize?.label}</p>
                    </div>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Service Type</p>
                    <p className="font-medium">{serviceTier?.label}</p>
                  </div>
                  {bookingData.addOns.length > 0 && (
                    <div>
                      <p className="text-sm text-muted-foreground">Add-ons</p>
                      {bookingData.addOns.map(addon => (
                        <p key={addon} className="font-medium text-sm">
                          • {ADD_ONS[addon as keyof typeof ADD_ONS]?.label}
                        </p>
                      ))}
                    </div>
                  )}
                  <div>
                    <p className="text-sm text-muted-foreground">Membership</p>
                    <p className="font-medium">{membership?.label}</p>
                    {bookingData.useCredit && (
                      <p className="text-xs text-success">Using 1 credit</p>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Schedule Details */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Calendar className="w-5 h-5 text-primary" />
                    Schedule
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm text-muted-foreground">Date</p>
                      <p className="font-medium">
                        {bookingData.serviceDate && format(new Date(bookingData.serviceDate), "EEEE, MMMM d, yyyy")}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm text-muted-foreground">Time Window</p>
                      <p className="font-medium">{TIME_SLOT_LABELS[bookingData.timeSlot]}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm text-muted-foreground">ZIP Code</p>
                      <p className="font-medium">{bookingData.zipCode}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Contact Details */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <User className="w-5 h-5 text-primary" />
                    Contact Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <p className="text-sm text-muted-foreground">Name</p>
                    <p className="font-medium">{bookingData.firstName} {bookingData.lastName}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Mail className="w-4 h-4 text-muted-foreground" />
                    <p className="font-medium">{bookingData.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Phone className="w-4 h-4 text-muted-foreground" />
                    <p className="font-medium">{bookingData.phone}</p>
                  </div>
                </CardContent>
              </Card>

              {/* Pricing */}
              <Card className="border-2 border-primary/20">
                <CardHeader className="bg-primary/5">
                  <CardTitle className="text-lg">Pricing Breakdown</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 pt-6">
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Base Price</span>
                      <span className="font-medium">${pricing.basePrice.toFixed(2)}</span>
                    </div>
                    {pricing.serviceAddition > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{serviceTier?.label} Addition</span>
                        <span className="font-medium">+${pricing.serviceAddition.toFixed(2)}</span>
                      </div>
                    )}
                    {pricing.addOnsTotal > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Add-ons</span>
                        <span className="font-medium">+${pricing.addOnsTotal.toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                  <Separator />
                  <div className="flex justify-between text-base font-semibold">
                    <span>Subtotal</span>
                    <span>${pricing.subtotal.toFixed(2)}</span>
                  </div>
                  {pricing.membershipDiscount > 0 && (
                    <div className="flex justify-between text-success text-sm">
                      <span>Membership Discount</span>
                      <span>-${pricing.membershipDiscount.toFixed(2)}</span>
                    </div>
                  )}
                  {bookingData.useCredit && (
                    <div className="flex justify-between text-success text-sm">
                      <span>Credit Applied</span>
                      <span>-${Math.min(pricing.basePrice, 150).toFixed(2)}</span>
                    </div>
                  )}
                  <Separator className="border-primary/30" />
                  <div className="space-y-3 bg-primary/5 p-4 rounded-lg -mx-2">
                    <div className="flex justify-between text-xl font-bold text-primary">
                      <span>Total</span>
                      <span>${pricing.total.toFixed(2)}</span>
                    </div>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Deposit (today)</span>
                        <span className="font-semibold">${pricing.deposit.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Balance (after clean)</span>
                        <span className="font-semibold">${pricing.balanceDue.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                  {bookingData.membershipPlan !== 'none' && (
                    <p className="text-xs text-muted-foreground">
                      + ${membership?.monthlyPrice}/mo membership fee
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="flex gap-4 pt-6">
              <Button
                variant="outline"
                size="lg"
                onClick={handleBack}
                className="h-14"
              >
                <ArrowLeft className="mr-2 w-5 h-5" />
                Back
              </Button>
              <Button
                size="lg"
                className="flex-1 h-14 text-base font-semibold bg-gradient-primary hover:opacity-90 shadow-neon"
                onClick={handleConfirm}
              >
                Continue to Payment
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
