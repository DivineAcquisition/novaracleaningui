import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight lg:text-6xl">
              Get Your Booking Interface Today
              <span className="block text-primary mt-2 text-2xl font-bold md:text-3xl">Example: Book Your Cleaning With Only $39 Today</span>
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
    </div>
  );
}
