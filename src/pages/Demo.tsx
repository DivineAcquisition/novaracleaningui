import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ArrowRight, Tag, Crown } from "lucide-react";
import selestialLogo from "@/assets/selestial-logo.png";

export default function Demo() {
  return (
    <div className="min-h-screen bg-gradient-hero">
      {/* Header */}
      <header className="container mx-auto px-4 py-4 md:py-6">
        <div className="flex justify-between items-center gap-2">
          <div className="flex items-center gap-2 md:gap-3 min-w-0">
            <img src={selestialLogo} alt="Selestial Logo" className="w-8 h-8 md:w-10 md:h-10 rounded-lg flex-shrink-0" />
            <span className="text-base md:text-lg font-semibold truncate">Selestial</span>
          </div>
          
          <Button variant="outline" size="sm" className="h-9 md:h-10 flex-shrink-0">
            Sign In
          </Button>
        </div>
      </header>

      {/* Promo Banner */}
      <div className="bg-gradient-primary py-3">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-center gap-2 text-white">
            <Tag className="w-4 h-4" />
            <p className="text-sm md:text-base font-medium">
              Custom Booking Interfaces Built for Your Cleaning Business
            </p>
          </div>
        </div>
      </div>

      {/* Hero + Booking Section */}
      <section className="container mx-auto px-4 py-12 md:py-20">
        <div className="max-w-2xl mx-auto text-center space-y-8">
          <div className="space-y-4">
            <h1 className="text-3xl md:text-4xl font-bold font-jakarta tracking-tight lg:text-6xl">
              Get Your Booking Interface Today
              <span className="block text-primary mt-2 text-2xl font-bold font-jakarta md:text-3xl">Example: Book Your Cleaning With Only $39 Today</span>
            </h1>
            
            <p className="text-lg text-[#2c2c2c] font-normal md:text-sm">
              This is an example booking interface we build for cleaning companies. Fully customizable to your brand.
            </p>
          </div>

          {/* ZIP Code Entry (Static Demo) */}
          <Card variant="outlined" className="border-primary/30 shadow-card">
            <CardContent className="pt-8 pb-8 space-y-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="zipCode" className="text-sm font-medium text-left block">
                    Enter Your ZIP Code
                  </label>
                  <Input 
                    id="zipCode" 
                    type="text" 
                    placeholder="12345" 
                    className="h-14 text-lg text-center" 
                    disabled
                  />
                  <p className="text-xs text-muted-foreground">
                    We'll check if we service your area
                  </p>
                </div>

                <Button 
                  size="lg" 
                  disabled 
                  className="w-full h-12 md:h-14 text-base md:text-lg font-semibold bg-gradient-primary"
                >
                  Continue
                  <ArrowRight className="w-4 h-4 md:w-5 md:h-5 ml-2" />
                </Button>
              </div>
            </CardContent>
          </Card>

      {/* Membership Promo Card */}
      <Card className="mt-12 border-2 border-primary/40 bg-gradient-lavender shadow-card">
        <CardContent className="pt-6 pb-6">
          <div className="flex flex-col md:flex-row items-center gap-4 md:gap-6">
            <div className="flex-shrink-0">
              <div className="w-12 h-12 md:w-16 md:h-16 bg-primary rounded-full flex items-center justify-center shadow-lavender">
                <Crown className="w-6 h-6 md:w-8 md:h-8 text-white" />
              </div>
            </div>
            <div className="flex-1 text-center md:text-left space-y-2">
              <h3 className="text-lg md:text-xl font-semibold">Membership Program Example</h3>
              <p className="text-sm md:text-base text-muted-foreground">
                Your customers get priority booking, exclusive discounts up to 30%, and credits that never expire. 
                Perfect for building recurring revenue.
              </p>
            </div>
            <Button 
              size="lg" 
              disabled 
              className="bg-primary hover:bg-primary-hover w-full md:w-auto h-11 md:h-12"
            >
              Learn More
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  </section>

  {/* Separator */}
  <div className="container mx-auto px-4">
    <div className="max-w-2xl mx-auto">
      <div className="h-px bg-border my-12" />
    </div>
  </div>

  {/* Home Size Selection Demo */}
  <section className="container mx-auto px-4 py-8">
    <div className="max-w-4xl mx-auto">
      <Card variant="outlined">
        <CardHeader className="text-center space-y-1.5">
          <CardTitle className="text-base md:text-xl font-semibold">Select your home size</CardTitle>
          <p className="text-xs md:text-sm text-muted-foreground">
            Choose the size that best matches your space
          </p>
        </CardHeader>
        <CardContent className="space-y-4 px-3 md:px-6">
          <div className="grid gap-3 md:gap-4 grid-cols-2 md:grid-cols-4">
            {[
              { label: "Studio", range: "< 700 sq ft" },
              { label: "1 Bedroom", range: "700-1,000 sq ft" },
              { label: "2 Bedrooms", range: "1,000-1,500 sq ft" },
              { label: "3+ Bedrooms", range: "1,500+ sq ft" }
            ].map((size, i) => (
              <Card
                key={i}
                className={`card-interactive ${i === 1 ? "ring-2 ring-primary border-primary/60 shadow-lavender" : ""}`}
              >
                <CardContent className="p-3 md:p-4 space-y-2 text-center">
                  <h3 className="text-sm md:text-base font-semibold">{size.label}</h3>
                  <p className="text-xs text-muted-foreground">{size.range}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  </section>

  {/* Separator */}
  <div className="container mx-auto px-4">
    <div className="max-w-4xl mx-auto">
      <div className="h-px bg-border my-12" />
    </div>
  </div>

  {/* Service Selection Demo */}
  <section className="container mx-auto px-4 py-8">
    <div className="max-w-5xl mx-auto">
      <Card variant="outlined">
        <CardHeader className="text-center space-y-1.5">
          <CardTitle className="text-base md:text-xl font-semibold">Choose your service</CardTitle>
          <p className="text-xs md:text-sm text-muted-foreground">
            Select the cleaning tier that fits your needs
          </p>
        </CardHeader>
        <CardContent className="space-y-4 px-3 md:px-6">
          <div className="grid gap-3 md:gap-4 grid-cols-1 md:grid-cols-3">
            {[
              { 
                name: "Standard", 
                desc: "Base hourly cleaning service",
                badge: "Most Popular",
                features: ["All rooms cleaned", "Dusting & vacuuming", "Bathroom & kitchen cleaning"]
              },
              { 
                name: "Deep Clean", 
                desc: "+$50 on Standard",
                badge: null,
                features: ["Everything in Standard", "Baseboards & trim", "Extra attention to detail"]
              },
              { 
                name: "Move-In/Out", 
                desc: "+$120 (includes fridge & oven)",
                badge: "Moving Special",
                features: ["Everything in Deep", "Inside Fridge ✓", "Inside Oven ✓"]
              }
            ].map((service, i) => (
              <Card
                key={i}
                className={`relative ${i === 0 ? "ring-2 ring-primary border-primary/60 shadow-lavender" : ""}`}
              >
                {service.badge && (
                  <div className="absolute -top-2 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs px-3 py-1 rounded-full">
                    {service.badge}
                  </div>
                )}
                <CardContent className="p-3 md:p-4 space-y-3">
                  <div className="text-center space-y-2">
                    <h3 className="text-base md:text-lg font-semibold">{service.name}</h3>
                    <p className="text-xs text-muted-foreground">{service.desc}</p>
                  </div>
                  <ul className="space-y-1 pt-2 border-t text-xs">
                    {service.features.map((feature, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-primary">✓</span>
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  </section>

  {/* Separator */}
  <div className="container mx-auto px-4">
    <div className="max-w-4xl mx-auto">
      <div className="h-px bg-border my-12" />
    </div>
  </div>

  {/* Schedule Demo */}
  <section className="container mx-auto px-4 py-8">
    <div className="max-w-4xl mx-auto">
      <Card variant="outlined">
        <CardHeader className="text-center space-y-1.5">
          <CardTitle className="text-base md:text-xl font-semibold">Schedule your service</CardTitle>
          <p className="text-xs md:text-sm text-muted-foreground">
            Select your preferred date and time window
          </p>
        </CardHeader>
        <CardContent className="space-y-4 px-3 md:px-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Date Selection */}
            <div className="space-y-3">
              <h3 className="text-sm md:text-base font-semibold">Select Date</h3>
              <Card className="border-2 border-border/50">
                <CardContent className="p-3 space-y-2">
                  {["Thu, Jan 16", "Fri, Jan 17", "Mon, Jan 20"].map((date, i) => (
                    <div
                      key={i}
                      className={`p-3 rounded-lg border-2 ${
                        i === 1 ? "bg-primary text-primary-foreground border-primary" : "border-border/60"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold">{date}</span>
                        {i === 1 && <div className="w-4 h-4 rounded-full bg-primary-foreground" />}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>

            {/* Time Selection */}
            <div className="space-y-3">
              <h3 className="text-sm md:text-base font-semibold">Select Time</h3>
              <Card className="border-2 border-border/50">
                <CardContent className="p-3 space-y-2">
                  {["8:00 AM - 12:00 PM", "12:00 PM - 4:00 PM", "4:00 PM - 8:00 PM"].map((time, i) => (
                    <div
                      key={i}
                      className={`p-3 rounded-lg border-2 ${
                        i === 0 ? "bg-primary text-primary-foreground border-primary" : "border-border/60"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs md:text-sm font-medium">{time}</span>
                        {i === 0 && <div className="w-4 h-4 rounded-full bg-primary-foreground" />}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  </section>

  {/* Separator */}
  <div className="container mx-auto px-4">
    <div className="max-w-4xl mx-auto">
      <div className="h-px bg-border my-12" />
    </div>
  </div>

  {/* Checkout Demo */}
  <section className="container mx-auto px-4 py-8 pb-20">
    <div className="max-w-4xl mx-auto">
      <Card variant="outlined" className="border-primary/30">
        <CardHeader className="text-center space-y-1.5">
          <div className="mx-auto w-12 h-12 md:w-14 md:h-14 bg-gradient-primary rounded-full flex items-center justify-center mb-3">
            <span className="text-2xl">💳</span>
          </div>
          <CardTitle className="text-base md:text-xl font-semibold">Secure Checkout</CardTitle>
          <p className="text-xs md:text-sm text-muted-foreground">
            Review your order and complete your booking
          </p>
        </CardHeader>
        <CardContent className="space-y-5 px-3 md:px-6">
          {/* New Customer Banner */}
          <Card className="border-2 border-[#5500FF]/50 bg-gradient-to-br from-violet-50 to-purple-50">
            <CardContent className="p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-[#5500FF] flex items-center justify-center">
                  <span className="text-white text-sm">🎁</span>
                </div>
                <div>
                  <p className="text-sm font-bold text-green-700">New Customer Special!</p>
                  <p className="text-xs text-green-600">You're saving $60 on this booking 🎉</p>
                </div>
              </div>
              <div className="text-lg font-bold text-green-700">-$60</div>
            </CardContent>
          </Card>

          {/* Order Summary */}
          <div className="grid gap-3 md:grid-cols-2">
            <Card className="border-2 border-primary/30">
              <CardContent className="p-4 space-y-2">
                <h4 className="font-semibold text-sm flex items-center gap-2">
                  <span className="text-primary">✨</span>
                  Service Details
                </h4>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Service</span>
                    <span className="font-medium">Standard Clean</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Home Size</span>
                    <span className="font-medium">1 Bedroom</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-2 border-primary/30">
              <CardContent className="p-4 space-y-2">
                <h4 className="font-semibold text-sm flex items-center gap-2">
                  <span className="text-primary">📅</span>
                  Schedule
                </h4>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Date</span>
                    <span className="font-medium">Jan 17, 2025</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Time</span>
                    <span className="font-medium">8:00 AM - 12:00 PM</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Payment Total */}
          <Card className="border-2 border-primary bg-gradient-to-br from-primary/5 to-secondary/5">
            <CardContent className="p-4 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-muted-foreground">Subtotal</span>
                <span className="text-sm">$139.00</span>
              </div>
              <div className="flex justify-between items-center text-green-600">
                <span className="text-sm font-medium">New Customer Discount</span>
                <span className="text-sm font-semibold">-$60.00</span>
              </div>
              <div className="h-px bg-border" />
              <div className="flex justify-between items-center">
                <span className="text-base font-semibold">Deposit Due Today</span>
                <span className="text-xl font-bold text-primary">$39.00</span>
              </div>
              <p className="text-xs text-muted-foreground">Balance after service: $40.00</p>
            </CardContent>
          </Card>

          {/* Fake Payment Button */}
          <Button disabled size="lg" className="w-full h-12 bg-gradient-primary text-base font-semibold">
            Complete Booking
          </Button>
        </CardContent>
      </Card>
    </div>
  </section>
</div>
  );
}
