import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Sparkles, Zap, Package, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProgressBar } from "@/components/booking/ProgressBar";
import { BottomNavigation } from "@/components/booking/BottomNavigation";

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
    id: 'standard',
    icon: Sparkles,
    name: 'Standard',
    description: 'Base hourly cleaning service',
    features: ['All rooms cleaned', 'Dusting & vacuuming', 'Bathroom & kitchen cleaning', 'Trash removal'],
    badge: 'Most Popular',
  },
  {
    id: 'deep',
    icon: Zap,
    name: 'Deep Clean',
    description: '+$50 on Standard',
    features: ['Everything in Standard', 'Baseboards & trim', 'Window sills', 'Extra attention to detail'],
    badge: null,
  },
  {
    id: 'moveInOut',
    icon: Package,
    name: 'Move-In/Out Cleaning',
    description: '+$120 (includes fridge & oven)',
    features: ['Everything in Deep', 'Inside Fridge ✓ Included', 'Inside Oven ✓ Included', 'Cabinet interiors', 'Interior Windows (optional)'],
    badge: 'Moving Special',
  },
];

const ADD_ONS = [
  { id: 'fridge', label: 'Inside Fridge', price: 30 },
  { id: 'oven', label: 'Inside Oven', price: 30 },
  { id: 'windows', label: 'Interior Windows', price: 40 },
];

export default function BookingService() {
  const navigate = useNavigate();
  const { bookingData, updateBookingData, currentStep, setCurrentStep } = useBooking();
  const [selectedAddOns, setSelectedAddOns] = useState<string[]>(bookingData.addOns || []);

  const handleSelect = (serviceType: string) => {
    // For moveInOut, filter out fridge & oven from add-ons (they're included)
    const filteredAddOns = serviceType === 'moveInOut' 
      ? selectedAddOns.filter(addon => addon === 'windows')
      : selectedAddOns;
    
    updateBookingData({ 
      serviceType,
      addOns: filteredAddOns 
    });
    setCurrentStep(4);
    navigate("/book/schedule");
  };

  const handleAddOnToggle = (addonId: string) => {
    setSelectedAddOns(prev => 
      prev.includes(addonId) 
        ? prev.filter(id => id !== addonId)
        : [...prev, addonId]
    );
  };

  const handleBack = () => {
    setCurrentStep(2);
    navigate("/book/home");
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      <ProgressBar currentStep={currentStep} totalSteps={6} steps={BOOKING_STEPS} />
      
      <div className="container max-w-6xl mx-auto px-3 py-4 lg:px-4 lg:py-8 pb-32 lg:pb-8">
        <Card className="animate-fade-in border-border/50 shadow-lg">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-xl lg:text-3xl">Choose your service</CardTitle>
            <CardDescription className="text-sm lg:text-base">
              Select the cleaning tier that fits your needs
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-6">
            <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
              {SERVICES.map((service, index) => (
                <Card
                  key={service.id}
                  className={cn(
                    "cursor-pointer transition-all duration-300 hover:shadow-md hover:border-primary/50 relative active:scale-95 animate-fade-in",
                    bookingData.serviceType === service.id && "border-primary bg-primary/5 shadow-md"
                  )}
                  style={{ animationDelay: `${index * 100}ms` }}
                  onClick={() => handleSelect(service.id)}
                >
                  {service.badge && (
                    <Badge className="absolute -top-2 left-1/2 -translate-x-1/2 bg-primary text-xs">
                      {service.badge}
                    </Badge>
                  )}
                  <CardContent className="p-4 lg:p-6 space-y-3">
                    <div className="text-center space-y-2">
                      <div className="mx-auto w-12 h-12 lg:w-14 lg:h-14 bg-primary/10 rounded-full flex items-center justify-center">
                        <service.icon className="w-6 h-6 lg:w-7 lg:h-7 text-primary" />
                      </div>
                      <div>
                        <h3 className="text-lg lg:text-xl font-bold">{service.name}</h3>
                        <p className="text-xs lg:text-sm text-muted-foreground mt-1">{service.description}</p>
                      </div>
                    </div>
                    <ul className="space-y-2 pt-3 border-t">
                      {service.features.map((feature, idx) => (
                        <li key={idx} className="text-xs lg:text-sm flex items-start gap-2">
                          <span className="text-primary mt-0.5">✓</span>
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ))}
            </div>

            {bookingData.serviceType && (
              <Card className="bg-muted/50 animate-fade-in">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base lg:text-lg">À La Carte Add-ons</CardTitle>
                  <CardDescription className="text-xs lg:text-sm">
                    {bookingData.serviceType === 'moveInOut' 
                      ? 'Fridge & Oven included. Only Windows available as add-on.'
                      : 'Optional extras for your cleaning service'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
                    {ADD_ONS.map((addon) => {
                      const isIncluded = bookingData.serviceType === 'moveInOut' && 
                        (addon.id === 'fridge' || addon.id === 'oven');
                      
                      return (
                        <div
                          key={addon.id}
                          className={cn(
                            "flex items-center space-x-3 p-3 lg:p-4 rounded-lg border bg-background transition-colors",
                            isIncluded 
                              ? "opacity-50 cursor-not-allowed" 
                              : "cursor-pointer hover:border-primary active:scale-95"
                          )}
                          onClick={() => !isIncluded && handleAddOnToggle(addon.id)}
                        >
                          <Checkbox 
                            checked={isIncluded || selectedAddOns.includes(addon.id)}
                            disabled={isIncluded}
                            onCheckedChange={() => !isIncluded && handleAddOnToggle(addon.id)}
                          />
                          <div className="flex-1">
                            <p className="font-medium text-sm">
                              {addon.label}
                              {isIncluded && <span className="ml-2 text-xs text-success">✓ Included</span>}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {isIncluded ? 'Included' : `+$${addon.price}`}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            <Button
              variant="outline"
              size="lg"
              onClick={handleBack}
              className="w-full h-12 hidden lg:flex"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Mobile Bottom Navigation */}
      <BottomNavigation
        currentStep={currentStep}
        totalSteps={6}
        onBack={handleBack}
        onContinue={() => {}}
        continueDisabled={true}
        showBack={true}
      />
    </div>
  );
}
