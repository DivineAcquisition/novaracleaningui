import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useBooking } from "@/contexts/BookingContext";
import { ArrowRight, Sparkles as SparkleIcon, Clock, Shield, Crown } from "lucide-react";
import { HeaderNav } from "@/components/HeaderNav";
const Index = () => {
  const navigate = useNavigate();
  const {
    user,
    signOut
  } = useAuth();
  const {
    updateBookingData
  } = useBooking();
  const [zipCode, setZipCode] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const handleSignOut = async () => {
    await signOut();
  };
  const handleStartBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (zipCode.length !== 5) {
      return;
    }
    setIsValidating(true);

    // Simulate validation
    await new Promise(resolve => setTimeout(resolve, 500));
    updateBookingData({
      zipCode
    });
    navigate("/book/home");
  };
  return <div className="min-h-screen bg-gradient-hero">
      {/* Header */}
      <HeaderNav onSignOut={handleSignOut} />

      {/* Promo Banner */}
      <div className="bg-gradient-primary py-3">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-center gap-2 text-white">
            
            <p className="text-sm md:text-base text-center font-semibold">
              Save up to 30% with our Membership Plan
            </p>
          </div>
        </div>
      </div>

      {/* Hero + Booking Section */}
      <section className="container mx-auto px-4 py-12 md:py-20">
        <div className="max-w-2xl mx-auto text-center space-y-8">
          <div className="space-y-4">
            <h1 className="text-3xl md:text-4xl tracking-tight lg:text-6xl text-center font-extrabold font-jakarta mx-auto max-w-4xl">
              Book Your Cleaning Today For Only $39
            </h1>
            
            <p className="text-[#2c2c2c] font-normal md:text-sm text-sm">
              Premium cleaning service at transparent prices. Enter your ZIP code to get started.
            </p>
          </div>

          {/* ZIP Code Entry */}
          <Card variant="outlined" className="border-primary/30 shadow-card">
            <CardContent className="pt-8 pb-8 space-y-6">
              <form onSubmit={handleStartBooking} className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="zipCode" className="text-sm font-medium text-left block">
                    Enter Your ZIP Code
                  </label>
                  <Input id="zipCode" type="text" inputMode="numeric" pattern="[0-9]*" maxLength={5} placeholder="12345" value={zipCode} onChange={e => setZipCode(e.target.value.replace(/\D/g, ''))} className="h-14 text-lg text-center" autoFocus aria-label="ZIP code for service area" aria-required="true" aria-invalid={zipCode.length > 0 && zipCode.length !== 5} aria-describedby="zipcode-help" />
                  <p className="text-xs text-muted-foreground" id="zipcode-help">
                    We'll check if we service your area
                  </p>
                </div>

                <Button type="submit" size="lg" disabled={zipCode.length !== 5 || isValidating} className="w-full h-12 md:h-14 text-base md:text-lg font-semibold bg-gradient-primary" aria-label={zipCode.length !== 5 ? "Enter a valid 5-digit ZIP code to continue" : "Check service availability"} aria-busy={isValidating}>
                  {isValidating ? "Checking..." : "Continue"}
                  <ArrowRight className="w-4 h-4 md:w-5 md:h-5 ml-2" aria-hidden="true" />
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Quick Benefits */}
          

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
                  <h3 className="text-lg md:text-xl font-semibold">Join Our Membership Program</h3>
                  <p className="text-sm md:text-base text-muted-foreground">
                    Get priority booking, exclusive discounts up to 30%, and credits that never expire. 
                    Perfect for regular cleaning schedules.
                  </p>
                </div>
                <Button onClick={() => navigate("/membership")} size="lg" className="bg-primary hover:bg-primary-hover w-full md:w-auto h-11 md:h-12">
                  Learn More
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>;
};
export default Index;