import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Calendar, Clock, Home, MapPin, User, Mail, Phone, Sparkles } from "lucide-react";
import { ProgressBar } from "@/components/booking/ProgressBar";
import { calculatePrice, HOME_SIZE_RANGES, FREQUENCY_DISCOUNTS } from "@/lib/pricing-system";
import { format } from "date-fns";

const BOOKING_STEPS = [
  { number: 1, label: "Location" },
  { number: 2, label: "Home Size" },
  { number: 3, label: "Service" },
  { number: 4, label: "Schedule" },
  { number: 5, label: "Details" },
  { number: 6, label: "Payment" },
];

const SERVICE_NAMES = {
  regular: "Standard Cleaning",
  deep: "Deep Cleaning",
  move_in_out: "Move In/Out Cleaning",
};

const TIME_SLOT_LABELS: Record<string, string> = {
  "8-12": "8:00 AM - 12:00 PM",
  "12-16": "12:00 PM - 4:00 PM",
  "16-20": "4:00 PM - 8:00 PM",
};

export default function BookingSummary() {
  const navigate = useNavigate();
  const { bookingData, currentStep, setCurrentStep } = useBooking();

  const homeSize = HOME_SIZE_RANGES.find(h => h.id === bookingData.homeSizeId);
  const frequencyData = FREQUENCY_DISCOUNTS[bookingData.frequency as keyof typeof FREQUENCY_DISCOUNTS];
  const price = calculatePrice(bookingData.homeSizeId, bookingData.serviceType, bookingData.frequency);

  const handleBack = () => {
    setCurrentStep(5);
    navigate("/book/details");
  };

  const handleConfirm = () => {
    // Navigate to payment/checkout
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
                    <p className="font-medium">{SERVICE_NAMES[bookingData.serviceType as keyof typeof SERVICE_NAMES]}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Frequency</p>
                    <p className="font-medium">{frequencyData?.label}</p>
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
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Pricing</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Base Price</span>
                      <span className="font-medium">${Math.round(price / (1 - (frequencyData?.discount || 0)))}</span>
                    </div>
                    {frequencyData?.discount > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-success">{frequencyData.label} Discount ({frequencyData.discount * 100}%)</span>
                        <span className="text-success font-medium">
                          -${Math.round(price / (1 - frequencyData.discount) * frequencyData.discount)}
                        </span>
                      </div>
                    )}
                  </div>
                  <Separator />
                  <div className="flex justify-between text-lg font-bold">
                    <span>Total</span>
                    <span className="text-primary">${price}</span>
                  </div>
                  {bookingData.frequency !== "one_time" && (
                    <p className="text-xs text-muted-foreground">
                      Recurring {frequencyData?.label.toLowerCase()} charge
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
                className="flex-1 h-14 text-base font-semibold"
                onClick={handleConfirm}
              >
                Confirm & Pay ${price}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
