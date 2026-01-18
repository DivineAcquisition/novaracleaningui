import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useBooking } from "@/contexts/BookingContext";
import { GradientBlob } from "@/components/ui/gradient-blob";
import { FeatureCard } from "@/components/ui/feature-card";
import { TestimonialCard } from "@/components/ui/testimonial-card";
import { StatsCard, StatsRow } from "@/components/ui/stats-card";
import { 
  User, 
  LogOut, 
  ArrowRight, 
  Sparkles, 
  Shield, 
  Crown, 
  Star,
  CheckCircle2,
  Calendar,
  CreditCard,
  Zap,
  MapPin,
  Play,
  Clock,
  Award,
  Heart,
  Users,
  Home
} from "lucide-react";
import logo from "@/assets/logo.png";
import { isValidZipCode, formatZipCode } from "@/lib/input-formatters";
import { cn } from "@/lib/utils";

const TRUST_BADGES = [
  { icon: Shield, label: "Insured & Bonded" },
  { icon: Star, label: "4.9★ Rating" },
  { icon: CheckCircle2, label: "Background Checked" },
];

const FEATURES = [
  {
    icon: Calendar,
    title: "Easy Scheduling",
    description: "Book online in 60 seconds. Choose your date, time, and get instant confirmation.",
    badge: "Quick"
  },
  {
    icon: CreditCard,
    title: "Transparent Pricing",
    description: "Know your exact price upfront. No hidden fees, no surprises. Ever.",
    badge: "Honest"
  },
  {
    icon: Zap,
    title: "Same-Week Service",
    description: "Need it fast? We offer same-week availability for urgent cleanings.",
    badge: "Fast"
  },
  {
    icon: Shield,
    title: "Satisfaction Guaranteed",
    description: "Not happy? We'll re-clean for free or give you a full refund. Simple.",
    badge: "Protected"
  },
];

const TESTIMONIALS = [
  { name: "Sarah M.", location: "Bethesda", quote: "Best cleaning service I've ever used. My house sparkles every single time!", rating: 5 },
  { name: "David L.", location: "Rockville", quote: "So easy to book and the team was amazing. Already booked my next cleaning!", rating: 5 },
  { name: "Jennifer K.", location: "Silver Spring", quote: "Consistent quality every time. The membership saves me so much money.", rating: 5 },
];

const STATS = [
  { value: "2,500+", label: "Happy Customers" },
  { value: "15,000+", label: "Cleanings Done" },
  { value: "4.9", label: "Average Rating", suffix: "★" },
  { value: "100%", label: "Satisfaction Rate" },
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
    navigate("/book/sqft");
  };

  return (
    <div className="min-h-screen bg-white overflow-x-hidden">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-gray-100">
        <div className="container mx-auto px-4 py-3 md:py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2 md:gap-3">
              <img src={logo} alt="Novara" className="w-8 h-8 md:w-10 md:h-10 rounded-xl" />
              <span className="text-lg md:text-xl font-bold">Novara</span>
            </div>
            
            <div className="flex items-center gap-2 md:gap-3">
              {user ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate("/account")}
                    className="hidden md:flex"
                  >
                    <User className="w-4 h-4 mr-2" />
                    Account
                  </Button>
                  <Button variant="ghost" size="sm" onClick={handleSignOut}>
                    <LogOut className="w-4 h-4" />
                  </Button>
                </>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => navigate("/auth")} className="text-xs md:text-sm">
                  Sign In
                </Button>
              )}
              <Button 
                onClick={() => navigate("/membership")}
                size="sm"
                className="bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] hover:opacity-90 text-xs md:text-sm"
              >
                <Crown className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" />
                <span className="hidden sm:inline">Membership</span>
                <span className="sm:hidden">Join</span>
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        {/* Background Elements */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#5500FF]/5 via-white to-[#8F7BFD]/5" />
        <GradientBlob className="top-0 right-0 translate-x-1/3 -translate-y-1/4" color="purple" size="xl" />
        <GradientBlob className="bottom-0 left-0 -translate-x-1/3 translate-y-1/4" color="pink" size="lg" />
        
        {/* Decorative grid pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:24px_24px]" />
        
        <div className="container mx-auto px-4 py-12 md:py-20 lg:py-28 relative">
          <div className="max-w-6xl mx-auto">
            <div className="grid lg:grid-cols-2 gap-8 lg:gap-16 items-center">
              {/* Left - Text Content */}
              <div className="space-y-6 md:space-y-8 text-center lg:text-left">
                <Badge className="bg-[#5500FF]/10 text-[#5500FF] border-[#5500FF]/20 text-xs md:text-sm">
                  <Sparkles className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" />
                  Serving Maryland • Rated 4.9★
                </Badge>
                
                <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1]">
                  Professional
                  <span className="block bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] bg-clip-text text-transparent">
                    Home Cleaning
                  </span>
                  Made Simple
                </h1>
                
                <p className="text-base md:text-lg lg:text-xl text-muted-foreground max-w-lg mx-auto lg:mx-0">
                  Book trusted, background-checked cleaners in 60 seconds. 
                  Transparent pricing, flexible scheduling, satisfaction guaranteed.
                </p>

                {/* Trust Badges */}
                <div className="flex flex-wrap justify-center lg:justify-start gap-3 md:gap-4">
                  {TRUST_BADGES.map((badge, i) => (
                    <div key={i} className="flex items-center gap-1.5 md:gap-2 text-xs md:text-sm text-muted-foreground bg-white/80 backdrop-blur rounded-full px-3 py-1.5 border">
                      <badge.icon className="w-3 h-3 md:w-4 md:h-4 text-[#5500FF]" />
                      <span>{badge.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right - Booking Card */}
              <div className="lg:pl-8">
                <Card className="shadow-2xl shadow-purple-500/10 border-[#5500FF]/10 overflow-hidden backdrop-blur-sm bg-white/90">
                  <div className="bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] p-5 md:p-6 text-white relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2" />
                    <h2 className="text-xl md:text-2xl font-bold mb-1 relative">Get Your Price</h2>
                    <p className="text-white/80 text-sm md:text-base relative">Instant quote in seconds</p>
                  </div>
                  <CardContent className="p-5 md:p-6">
                    <form onSubmit={handleStartBooking} className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-xs md:text-sm font-medium flex items-center gap-2">
                          <MapPin className="w-3 h-3 md:w-4 md:h-4 text-[#5500FF]" />
                          Enter Your ZIP Code
                        </label>
                        <Input
                          type="text"
                          inputMode="numeric"
                          maxLength={5}
                          placeholder="21201"
                          value={zipCode}
                          onChange={handleZipChange}
                          className={cn(
                            "h-12 md:h-14 text-lg md:text-xl text-center font-semibold border-2 transition-colors",
                            zipError ? 'border-red-500' : 'focus:border-[#5500FF]'
                          )}
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
                        className="w-full h-12 md:h-14 text-base md:text-lg bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] hover:opacity-90 shadow-lg shadow-purple-500/25"
                      >
                        Get Instant Quote
                        <ArrowRight className="w-4 h-4 md:w-5 md:h-5 ml-2" />
                      </Button>

                      <p className="text-[10px] md:text-xs text-center text-muted-foreground">
                        No credit card required • Free cancellation
                      </p>
                    </form>

                    {/* Quick Info */}
                    <div className="mt-5 md:mt-6 pt-5 md:pt-6 border-t grid grid-cols-3 gap-2 md:gap-4 text-center">
                      <div>
                        <p className="text-xl md:text-2xl font-bold text-[#5500FF]">$99</p>
                        <p className="text-[10px] md:text-xs text-muted-foreground">Starting at</p>
                      </div>
                      <div>
                        <p className="text-xl md:text-2xl font-bold text-[#5500FF]">2hr</p>
                        <p className="text-[10px] md:text-xs text-muted-foreground">Min booking</p>
                      </div>
                      <div>
                        <p className="text-xl md:text-2xl font-bold text-[#5500FF]">24hr</p>
                        <p className="text-[10px] md:text-xs text-muted-foreground">Advance notice</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-8 md:py-12 border-y bg-gradient-to-r from-[#5500FF]/5 via-white to-[#8F7BFD]/5">
        <div className="container mx-auto px-4">
          <StatsRow className="max-w-4xl mx-auto">
            {STATS.map((stat, i) => (
              <StatsCard
                key={i}
                value={stat.value}
                label={stat.label}
                suffix={stat.suffix}
                variant="default"
                animated={false}
              />
            ))}
          </StatsRow>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-16 md:py-24 relative">
        <GradientBlob className="top-1/2 left-0 -translate-x-1/2 -translate-y-1/2" color="blue" size="lg" animate={false} />
        
        <div className="container mx-auto px-4 relative">
          <div className="text-center mb-10 md:mb-16">
            <Badge variant="outline" className="mb-3 md:mb-4 text-xs">Why Choose Us</Badge>
            <h2 className="text-2xl md:text-3xl lg:text-4xl font-bold mb-3 md:mb-4">
              Cleaning Made Effortless
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto text-sm md:text-base px-4">
              We handle everything so you don't have to. From booking to completion, 
              experience hassle-free home cleaning.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 max-w-6xl mx-auto">
            {FEATURES.map((feature, i) => (
              <FeatureCard
                key={i}
                icon={feature.icon}
                title={feature.title}
                description={feature.description}
                badge={feature.badge}
                variant="gradient"
              />
            ))}
          </div>
        </div>
      </section>

      {/* Membership CTA */}
      <section className="py-16 md:py-20 bg-gradient-to-b from-gray-50 to-white">
        <div className="container mx-auto px-4">
          <Card className="max-w-4xl mx-auto bg-gradient-to-br from-[#5500FF]/5 via-white to-[#8F7BFD]/10 border-[#5500FF]/20 overflow-hidden relative">
            <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-[#5500FF]/10 to-transparent rounded-full -translate-y-1/2 translate-x-1/2" />
            <CardContent className="p-6 md:p-10 lg:p-12 relative">
              <div className="flex flex-col md:flex-row items-center gap-6 md:gap-8">
                <div className="w-16 h-16 md:w-20 md:h-20 rounded-2xl md:rounded-3xl bg-gradient-to-br from-[#5500FF] to-[#8F7BFD] flex items-center justify-center flex-shrink-0 shadow-xl shadow-purple-500/30">
                  <Crown className="w-8 h-8 md:w-10 md:h-10 text-white" />
                </div>
                <div className="flex-1 text-center md:text-left">
                  <Badge className="mb-2 bg-[#5500FF]/20 text-[#5500FF] text-xs">Save up to 30%</Badge>
                  <h3 className="text-xl md:text-2xl lg:text-3xl font-bold mb-2">Join Our Membership</h3>
                  <p className="text-muted-foreground mb-4 text-sm md:text-base">
                    Get priority booking, exclusive discounts, and credits that never expire. 
                    Perfect for regular cleaning schedules.
                  </p>
                  <Button 
                    onClick={() => navigate("/membership")}
                    className="bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] hover:opacity-90 shadow-lg"
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
      <section className="py-16 md:py-24 relative">
        <GradientBlob className="top-0 right-0 translate-x-1/2" color="pink" size="md" animate={false} />
        
        <div className="container mx-auto px-4 relative">
          <div className="text-center mb-10 md:mb-16">
            <Badge variant="outline" className="mb-3 md:mb-4 text-xs">Testimonials</Badge>
            <h2 className="text-2xl md:text-3xl lg:text-4xl font-bold">
              What Our Customers Say
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-4 md:gap-6 max-w-5xl mx-auto">
            {TESTIMONIALS.map((t, i) => (
              <TestimonialCard
                key={i}
                quote={t.quote}
                name={t.name}
                location={t.location}
                rating={t.rating}
                variant="gradient"
              />
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-16 md:py-20">
        <div className="container mx-auto px-4">
          <Card className="max-w-4xl mx-auto bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] border-0 overflow-hidden relative">
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
            <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/10 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />
            <CardContent className="p-8 md:p-12 text-center text-white relative">
              <Home className="w-12 h-12 md:w-16 md:h-16 mx-auto mb-4 md:mb-6 opacity-90" />
              <h2 className="text-2xl md:text-3xl lg:text-4xl font-bold mb-3 md:mb-4">
                Ready for a Cleaner Home?
              </h2>
              <p className="text-white/80 mb-6 md:mb-8 max-w-xl mx-auto text-sm md:text-lg">
                Book your first cleaning today and see why thousands of Maryland 
                homeowners trust Novara Cleaning.
              </p>
              <Button 
                size="lg"
                onClick={() => document.querySelector('input')?.focus()}
                className="h-12 md:h-14 px-6 md:px-8 bg-white text-[#5500FF] hover:bg-white/90 shadow-xl text-sm md:text-base"
              >
                Book Now
                <ArrowRight className="ml-2 w-4 h-4 md:w-5 md:h-5" />
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 py-6 md:py-8 bg-gray-50/50">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-xs md:text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <img src={logo} alt="Novara" className="w-5 h-5 md:w-6 md:h-6 rounded" />
              <span>© {new Date().getFullYear()} Novara Cleaning • Maryland</span>
            </div>
            <div className="flex gap-4 md:gap-6">
              <a href="mailto:hello@novaracleaning.com" className="hover:text-[#5500FF] transition-colors">Contact</a>
              <button 
                onClick={() => window.location.href = "https://contractor.novaracleaning.com/careers"} 
                className="hover:text-[#5500FF] transition-colors"
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
