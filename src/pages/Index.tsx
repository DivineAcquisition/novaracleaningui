import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useBooking } from "@/contexts/BookingContext";
import { Sparkles, User, LogOut, ArrowRight, Sparkles as SparkleIcon, Clock, Shield, Crown, Tag } from "lucide-react";

const Index = () => {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { updateBookingData } = useBooking();
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
    
    updateBookingData({ zipCode });
    navigate("/book/home");
  };

  return (
    <div className="min-h-screen bg-gradient-hero">
      {/* Header */}
      <header className="container mx-auto px-4 py-6">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-gradient-primary rounded-full flex items-center justify-center shadow-lavender">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <span className="text-xl font-bold">HomeGlow</span>
          </div>
          
          {user ? (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => navigate("/account")}
              >
                <User className="mr-2 w-4 h-4" />
                Account
              </Button>
              <Button
                variant="ghost"
                onClick={handleSignOut}
              >
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              onClick={() => navigate("/auth")}
            >
              Sign In
            </Button>
          )}
        </div>
      </header>

      {/* Promo Banner */}
      <div className="bg-gradient-primary py-3">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-center gap-2 text-white">
            <Tag className="w-4 h-4" />
            <p className="text-sm md:text-base font-semibold">
              Limited Time Offer: Save up to 30% with our Membership Plan
            </p>
          </div>
        </div>
      </div>

      {/* Hero + Booking Section */}
      <section className="container mx-auto px-4 py-12 md:py-20">
        <div className="max-w-2xl mx-auto text-center space-y-8">
          <div className="space-y-4">
            <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight">
              Book Your Cleaning
              <span className="block text-primary mt-2">In Minutes</span>
            </h1>
            
            <p className="text-lg md:text-xl text-muted-foreground">
              Professional cleaning service at transparent prices. Enter your ZIP code to get started.
            </p>
          </div>

          {/* ZIP Code Entry */}
          <Card className="shadow-2xl border-primary/20">
            <CardContent className="pt-8 pb-8 space-y-6">
              <form onSubmit={handleStartBooking} className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="zipCode" className="text-sm font-medium text-left block">
                    Enter Your ZIP Code
                  </label>
                  <Input
                    id="zipCode"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={5}
                    placeholder="12345"
                    value={zipCode}
                    onChange={(e) => setZipCode(e.target.value.replace(/\D/g, ''))}
                    className="h-14 text-lg text-center"
                    autoFocus
                  />
                  <p className="text-xs text-muted-foreground">
                    We'll check if we service your area
                  </p>
                </div>

                <Button
                  type="submit"
                  size="lg"
                  disabled={zipCode.length !== 5 || isValidating}
                  className="w-full h-14 text-lg font-semibold bg-gradient-primary"
                >
                  {isValidating ? "Checking..." : "Continue"}
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Quick Benefits */}
          <div className="grid grid-cols-3 gap-4 pt-4">
            <div className="space-y-2">
              <div className="mx-auto w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                <SparkleIcon className="w-5 h-5 text-primary" />
              </div>
              <p className="text-xs md:text-sm font-medium">Professional</p>
            </div>
            <div className="space-y-2">
              <div className="mx-auto w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                <Clock className="w-5 h-5 text-primary" />
              </div>
              <p className="text-xs md:text-sm font-medium">Flexible</p>
            </div>
            <div className="space-y-2">
              <div className="mx-auto w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                <Shield className="w-5 h-5 text-primary" />
              </div>
              <p className="text-xs md:text-sm font-medium">Guaranteed</p>
            </div>
          </div>

          {/* Membership Promo Card */}
          <Card className="mt-12 border-primary/30 bg-gradient-lavender">
            <CardContent className="pt-6 pb-6">
              <div className="flex flex-col md:flex-row items-center gap-6">
                <div className="flex-shrink-0">
                  <div className="w-16 h-16 bg-primary rounded-full flex items-center justify-center shadow-lavender">
                    <Crown className="w-8 h-8 text-white" />
                  </div>
                </div>
                <div className="flex-1 text-center md:text-left space-y-2">
                  <h3 className="text-xl md:text-2xl font-bold">Join Our Membership Program</h3>
                  <p className="text-muted-foreground">
                    Get priority booking, exclusive discounts up to 30%, and credits that never expire. 
                    Perfect for regular cleaning schedules.
                  </p>
                </div>
                <Button
                  onClick={() => navigate("/membership")}
                  size="lg"
                  className="bg-primary hover:bg-primary-hover"
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
};

export default Index;
