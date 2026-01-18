import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useBooking } from "@/contexts/BookingContext";
import { 
  User, 
  LogOut, 
  ArrowRight, 
  Sparkles, 
  Clock, 
  Shield, 
  Crown, 
  Star,
  CheckCircle2,
  Calendar,
  CreditCard,
  Zap,
  MapPin
} from "lucide-react";
import logo from "@/assets/logo.png";
import { isValidZipCode, formatZipCode } from "@/lib/input-formatters";

const TRUST_BADGES = [
  { icon: Shield, label: "Insured & Bonded" },
  { icon: Star, label: "4.9★ Rating" },
  { icon: CheckCircle2, label: "Background Checked" },
];

const FEATURES = [
  {
    icon: Calendar,
    title: "Easy Scheduling",
    description: "Book online in 60 seconds. Choose your date and time."
  },
  {
    icon: CreditCard,
    title: "Transparent Pricing",
    description: "Know your exact price upfront. No hidden fees ever."
  },
  {
    icon: Zap,
    title: "Same-Week Service",
    description: "Need it fast? We offer same-week availability."
  },
  {
    icon: Shield,
    title: "Satisfaction Guaranteed",
    description: "Not happy? We'll re-clean for free or refund you."
  },
];

const TESTIMONIALS = [
  { name: "Sarah M.", location: "Bethesda", quote: "Best cleaning service I've ever used. My house sparkles!", rating: 5 },
  { name: "David L.", location: "Rockville", quote: "So easy to book and the team was amazing. Highly recommend!", rating: 5 },
  { name: "Jennifer K.", location: "Silver Spring", quote: "Consistent quality every time. Worth every penny.", rating: 5 },
];

const Index = () => {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { updateBookingData } = useBooking();
  const [zipCode, setZipCode] = useState("");
  const [zipError, setZipError] = useState("");

  const handleSignOut = async () => {
    await signOut();
  };

  const handleZipChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatZipCode(e.target.value);
    setZipCode(formatted);
    if (zipError) setZipError("");
  };

  const handleStartBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!isValidZipCode(zipCode)) {
      setZipError("Please enter a valid 5-digit ZIP code");
      return;
    }

    updateBookingData({ zipCode });
    navigate("/book/home");
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="container mx-auto px-4 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <img src={logo} alt="Novara" className="w-10 h-10 rounded-xl" />
              <span className="text-xl font-bold">Novara Cleaning</span>
            </div>
            
            <div className="flex items-center gap-3">
              {user ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate("/account")}
                  >
                    <User className="w-4 h-4 mr-2" />
                    Account
                  </Button>
                  <Button variant="ghost" size="sm" onClick={handleSignOut}>
                    <LogOut className="w-4 h-4" />
                  </Button>
                </>
              ) : (
                <Button variant="ghost" onClick={() => navigate("/auth")}>
                  Sign In
                </Button>
              )}
              <Button 
                onClick={() => navigate("/membership")}
                className="bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] hover:opacity-90"
              >
                <Crown className="w-4 h-4 mr-2" />
                Membership
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#5500FF]/5 via-background to-[#8F7BFD]/10" />
        <div className="absolute top-10 right-10 w-96 h-96 bg-[#5500FF]/10 rounded-full blur-3xl" />
        <div className="absolute bottom-10 left-10 w-72 h-72 bg-[#8F7BFD]/10 rounded-full blur-3xl" />
        
        <div className="container mx-auto px-4 py-16 md:py-24 relative">
          <div className="max-w-5xl mx-auto">
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              {/* Left - Text Content */}
              <div className="space-y-8">
                <Badge className="bg-[#5500FF]/10 text-[#5500FF] border-[#5500FF]/20">
                  <Sparkles className="w-4 h-4 mr-2" />
                  Serving Maryland • Rated 4.9★
                </Badge>
                
                <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight">
                  Professional
                  <span className="block bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] bg-clip-text text-transparent">
                    Home Cleaning
                  </span>
                  Made Simple
                </h1>
                
                <p className="text-xl text-muted-foreground">
                  Book trusted, background-checked cleaners in 60 seconds. 
                  Transparent pricing, flexible scheduling, satisfaction guaranteed.
                </p>

                {/* Trust Badges */}
                <div className="flex flex-wrap gap-4">
                  {TRUST_BADGES.map((badge, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <badge.icon className="w-4 h-4 text-[#5500FF]" />
                      <span>{badge.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right - Booking Card */}
              <div>
                <Card className="shadow-2xl border-[#5500FF]/20 overflow-hidden">
                  <div className="bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] p-6 text-white">
                    <h2 className="text-2xl font-bold mb-1">Get Your Price</h2>
                    <p className="text-white/80">Instant quote in seconds</p>
                  </div>
                  <CardContent className="p-6">
                    <form onSubmit={handleStartBooking} className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium flex items-center gap-2">
                          <MapPin className="w-4 h-4 text-[#5500FF]" />
                          Enter Your ZIP Code
                        </label>
                        <Input
                          type="text"
                          inputMode="numeric"
                          maxLength={5}
                          placeholder="21201"
                          value={zipCode}
                          onChange={handleZipChange}
                          className={`h-14 text-xl text-center font-semibold ${zipError ? 'border-red-500' : ''}`}
                          autoFocus
                        />
                        {zipError && (
                          <p className="text-xs text-red-500">{zipError}</p>
                        )}
                      </div>

                      <Button
                        type="submit"
                        size="lg"
                        disabled={!zipCode}
                        className="w-full h-14 text-lg bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] hover:opacity-90 shadow-lg"
                      >
                        Get Instant Quote
                        <ArrowRight className="w-5 h-5 ml-2" />
                      </Button>

                      <p className="text-xs text-center text-muted-foreground">
                        No credit card required • Free cancellation
                      </p>
                    </form>

                    {/* Quick Info */}
                    <div className="mt-6 pt-6 border-t grid grid-cols-3 gap-4 text-center">
                      <div>
                        <p className="text-2xl font-bold text-[#5500FF]">$99</p>
                        <p className="text-xs text-muted-foreground">Starting at</p>
                      </div>
                      <div>
                        <p className="text-2xl font-bold text-[#5500FF]">2hr</p>
                        <p className="text-xs text-muted-foreground">Min booking</p>
                      </div>
                      <div>
                        <p className="text-2xl font-bold text-[#5500FF]">24hr</p>
                        <p className="text-xs text-muted-foreground">Advance notice</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 bg-muted/30">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <Badge variant="outline" className="mb-4">Why Choose Us</Badge>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Cleaning Made Effortless
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              We handle everything so you don't have to. From booking to completion, 
              experience hassle-free home cleaning.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
            {FEATURES.map((feature, i) => (
              <Card key={i} className="border-2 hover:border-[#5500FF]/50 transition-all group">
                <CardContent className="p-6">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#5500FF] to-[#8F7BFD] flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                    <feature.icon className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="font-semibold mb-2">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Membership CTA */}
      <section className="py-20">
        <div className="container mx-auto px-4">
          <Card className="max-w-4xl mx-auto bg-gradient-to-r from-[#5500FF]/10 to-[#8F7BFD]/10 border-[#5500FF]/20">
            <CardContent className="p-8 md:p-12">
              <div className="flex flex-col md:flex-row items-center gap-8">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#5500FF] to-[#8F7BFD] flex items-center justify-center flex-shrink-0">
                  <Crown className="w-10 h-10 text-white" />
                </div>
                <div className="flex-1 text-center md:text-left">
                  <Badge className="mb-2 bg-[#5500FF]/20 text-[#5500FF]">Save up to 30%</Badge>
                  <h3 className="text-2xl md:text-3xl font-bold mb-2">Join Our Membership</h3>
                  <p className="text-muted-foreground mb-4">
                    Get priority booking, exclusive discounts, and credits that never expire. 
                    Perfect for regular cleaning schedules.
                  </p>
                  <Button 
                    onClick={() => navigate("/membership")}
                    className="bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] hover:opacity-90"
                  >
                    View Plans
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-20 bg-muted/30">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <Badge variant="outline" className="mb-4">Testimonials</Badge>
            <h2 className="text-3xl md:text-4xl font-bold">
              What Our Customers Say
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {TESTIMONIALS.map((t, i) => (
              <Card key={i} className="border-2">
                <CardContent className="p-6">
                  <div className="flex mb-3">
                    {[...Array(t.rating)].map((_, j) => (
                      <Star key={j} className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                    ))}
                  </div>
                  <p className="text-muted-foreground mb-4">"{t.quote}"</p>
                  <div>
                    <p className="font-semibold">{t.name}</p>
                    <p className="text-xs text-muted-foreground">{t.location}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-20">
        <div className="container mx-auto px-4">
          <Card className="max-w-4xl mx-auto bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] border-0 overflow-hidden relative">
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
            <CardContent className="p-8 md:p-12 text-center text-white relative">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">
                Ready for a Cleaner Home?
              </h2>
              <p className="text-white/80 mb-8 max-w-xl mx-auto text-lg">
                Book your first cleaning today and see why thousands of Maryland 
                homeowners trust Novara Cleaning.
              </p>
              <Button 
                size="lg"
                onClick={() => document.querySelector('input')?.focus()}
                className="h-14 px-8 bg-white text-[#5500FF] hover:bg-white/90"
              >
                Book Now
                <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <img src={logo} alt="Novara" className="w-6 h-6 rounded" />
              <span>© {new Date().getFullYear()} Novara Cleaning • Maryland</span>
            </div>
            <div className="flex gap-6">
              <a href="mailto:hello@novaracleaning.com" className="hover:text-[#5500FF]">Contact</a>
              <button 
                onClick={() => window.location.href = "https://contractor.novaracleaning.com"} 
                className="hover:text-[#5500FF]"
              >
                Become a Cleaner
              </button>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
