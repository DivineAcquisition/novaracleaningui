import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Zap, Package, ArrowRight, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProgressBar } from "@/components/booking/ProgressBar";

const BOOKING_STEPS = [
  { number: 1, label: "Location" },
  { number: 2, label: "Home Size" },
  { number: 3, label: "Service" },
  { number: 4, label: "Schedule" },
  { number: 5, label: "Details" },
  { number: 6, label: "Payment" },
];

const SERVICES = [
  {
    id: 'regular',
    icon: Sparkles,
    name: 'Standard Cleaning',
    description: 'Regular maintenance cleaning for your home',
    features: ['All rooms cleaned', 'Dusting & vacuuming', 'Bathroom & kitchen cleaning', 'Trash removal'],
    badge: 'Most Popular',
  },
  {
    id: 'deep',
    icon: Zap,
    name: 'Deep Cleaning',
    description: 'Thorough top-to-bottom deep clean',
    features: ['Everything in Standard', 'Inside appliances', 'Baseboards & trim', 'Window sills'],
    badge: 'Recommended',
  },
  {
    id: 'move_in_out',
    icon: Package,
    name: 'Move In/Out',
    description: 'Complete cleaning for moving',
    features: ['Everything in Deep', 'Inside cabinets', 'Deep appliance clean', 'Extra attention to detail'],
    badge: null,
  },
];

export default function BookingService() {
  const navigate = useNavigate();
  const { bookingData, updateBookingData, currentStep, setCurrentStep } = useBooking();

  const handleSelect = (serviceType: string) => {
    updateBookingData({ serviceType });
    setCurrentStep(4);
    navigate("/book/schedule");
  };

  const handleBack = () => {
    setCurrentStep(2);
    navigate("/book/home");
  };

  return (
    <div className="min-h-screen bg-gradient-hero">
      <ProgressBar currentStep={currentStep} totalSteps={6} steps={BOOKING_STEPS} />
      
      <div className="container max-w-5xl mx-auto px-4 py-8">
        <Card className="shadow-xl">
          <CardHeader className="text-center space-y-2 pb-8">
            <CardTitle className="text-3xl font-bold">Choose your service</CardTitle>
            <CardDescription className="text-base">
              Select the cleaning service that fits your needs
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-6">
            <div className="grid gap-6 md:grid-cols-3">
              {SERVICES.map((service) => (
                <Card
                  key={service.id}
                  className={cn(
                    "cursor-pointer transition-all duration-300 hover:shadow-lg hover:scale-105 relative",
                    bookingData.serviceType === service.id && "ring-2 ring-primary shadow-lg"
                  )}
                  onClick={() => handleSelect(service.id)}
                >
                  {service.badge && (
                    <Badge className="absolute -top-2 left-1/2 -translate-x-1/2 bg-primary">
                      {service.badge}
                    </Badge>
                  )}
                  <CardContent className="p-6 space-y-4">
                    <div className="text-center space-y-3">
                      <div className="mx-auto w-14 h-14 bg-primary/10 rounded-full flex items-center justify-center">
                        <service.icon className="w-7 h-7 text-primary" />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold">{service.name}</h3>
                        <p className="text-sm text-muted-foreground mt-1">{service.description}</p>
                      </div>
                    </div>
                    <ul className="space-y-2 pt-4 border-t">
                      {service.features.map((feature, idx) => (
                        <li key={idx} className="text-sm flex items-start gap-2">
                          <span className="text-primary mt-0.5">✓</span>
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ))}
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
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
