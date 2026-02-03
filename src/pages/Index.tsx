import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { 
  ArrowRight, 
  CheckCircle2, 
  Sparkles, 
  Clock, 
  Shield, 
  Star,
  Calendar,
  CreditCard,
  Home,
  Users,
  Zap,
  MapPin,
  Phone,
  ThumbsUp,
  Award,
  Percent,
  RefreshCw
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const FEATURES = [
  {
    icon: Clock,
    title: "On-Time, Every Time",
    description: "We show up when promised. No excuses, no waiting around."
  },
  {
    icon: Shield,
    title: "Vetted & Trained",
    description: "Background-checked, trained professionals you can trust in your home."
  },
  {
    icon: CreditCard,
    title: "Transparent Pricing",
    description: "Know exactly what you'll pay. No surprises, no hidden fees."
  },
  {
    icon: RefreshCw,
    title: "Satisfaction Guarantee",
    description: "Not happy? We'll re-clean for free within 48 hours."
  }
];

const PROCESS_STEPS = [
  {
    step: 1,
    title: "Enter Your ZIP",
    description: "Check if we service your area",
    icon: MapPin
  },
  {
    step: 2,
    title: "Select Home Size",
    description: "Get instant pricing",
    icon: Home
  },
  {
    step: 3,
    title: "Choose Service",
    description: "One-time or membership",
    icon: Sparkles
  },
  {
    step: 4,
    title: "Pick Your Date",
    description: "Flexible scheduling",
    icon: Calendar
  }
];

const TESTIMONIALS = [
  {
    name: "Sarah M.",
    location: "Bethesda, MD",
    text: "After years of no-shows and mediocre cleaning, Novara is a breath of fresh air. They actually show up on time and do an incredible job.",
    rating: 5
  },
  {
    name: "Mike R.",
    location: "Rockville, MD",
    text: "The online booking was so easy. I had my first clean scheduled in under 2 minutes. The team was professional and thorough.",
    rating: 5
  },
  {
    name: "Jennifer L.",
    location: "Silver Spring, MD",
    text: "We switched from another service and the difference is night and day. Worth every penny for the peace of mind.",
    rating: 5
  }
];

const PRICING_PREVIEW = [
  { size: "Studio/1BR", sqft: "Under 1,000 sq ft", price: 150 },
  { size: "2-3 BR", sqft: "1,500-2,000 sq ft", price: 239 },
  { size: "4 BR", sqft: "2,500-3,000 sq ft", price: 339 },
];

const STATS = [
  { value: "2,500+", label: "Happy Customers" },
  { value: "4.9", label: "Average Rating" },
  { value: "98%", label: "On-Time Rate" },
  { value: "48hr", label: "Re-Clean Guarantee" },
];

const Index = () => {
  const navigate = useNavigate();
  const { updateBookingData } = useBooking();
  const [zipCode, setZipCode] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState("");

  const handleZipSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (zipCode.length !== 5) {
      setError("Please enter a valid 5-digit ZIP code");
      return;
    }

    setIsValidating(true);
    setError("");

    try {
      const { data: coverage } = await supabase
        .from('service_coverage_zones')
        .select('city, state')
        .eq('zip_code', zipCode)
        .eq('is_active', true)
        .single();

      updateBookingData({ zipCode });
      navigate("/book/sqft");
    } catch (err) {
      updateBookingData({ zipCode });
      navigate("/book/sqft");
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-background/95 backdrop-blur sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-purple-600 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-lg">Novara</span>
          </div>
          <div className="flex items-center gap-3">
            <a href="tel:3018005252" className="hidden md:flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
              <Phone className="w-4 h-4" />
              (301) 800-5252
            </a>
            <Badge variant="secondary" className="text-xs border border-green-500/20 bg-green-500/10 text-green-600">
              <Zap className="w-3 h-3 mr-1" />
              Book in 2 min
            </Badge>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-purple-500/5" />
        <div className="relative max-w-6xl mx-auto px-4 py-12 md:py-20">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            {/* Left: Hero Text + ZIP Entry */}
            <div className="space-y-6">
              <Badge className="bg-primary/10 text-primary border border-primary/20">
                Maryland's Most Reliable Cleaning Service
              </Badge>
              
              <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold leading-tight">
                Finally, a Cleaning Service That{" "}
                <span className="text-primary">Actually Shows Up</span>
              </h1>
              
              <p className="text-lg text-muted-foreground">
                Tired of cleaners who cancel, show up late, or do a mediocre job? 
                We get it. That's why we built Novara differently—professional teams that 
                arrive on time, every time, with a satisfaction guarantee you can count on.
              </p>

              {/* Stats Row */}
              <div className="flex flex-wrap gap-4 py-2">
                {STATS.map((stat, i) => (
                  <div key={i} className="text-center">
                    <p className="text-2xl font-bold text-primary">{stat.value}</p>
                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                  </div>
                ))}
              </div>

              {/* ZIP Entry Card */}
              <Card className="border border-border shadow-lg">
                <CardContent className="p-5">
                  <form onSubmit={handleZipSubmit} className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">
                        Get your instant quote in seconds
                      </label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                          <Input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            maxLength={5}
                            placeholder="Enter ZIP code"
                            value={zipCode}
                            onChange={(e) => {
                              setZipCode(e.target.value.replace(/\D/g, ''));
                              setError("");
                            }}
                            className={cn(
                              "h-12 pl-10 text-lg border",
                              error ? "border-destructive" : "border-border"
                            )}
                            autoFocus
                          />
                        </div>
                        <Button 
                          type="submit"
                          disabled={zipCode.length !== 5 || isValidating}
                          className="h-12 px-6 bg-gradient-to-r from-primary to-purple-600 border-0"
                        >
                          {isValidating ? "..." : "Get Quote"}
                          <ArrowRight className="w-4 h-4 ml-2" />
                        </Button>
                      </div>
                      {error && (
                        <p className="text-xs text-destructive">{error}</p>
                      )}
                    </div>
                  </form>

                  <div className="flex items-center gap-4 mt-4 pt-4 border-t border-border">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                      No credit card needed
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                      Instant pricing
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                      Cancel anytime
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Right: Process Visual */}
            <div className="hidden lg:block">
              <Card className="border border-border shadow-xl bg-gradient-to-br from-muted/50 to-background">
                <CardContent className="p-6">
                  <div className="text-center mb-6">
                    <Badge variant="secondary" className="mb-2 border border-border">
                      Simple 4-Step Booking
                    </Badge>
                    <h3 className="text-lg font-semibold">Get Your Home Cleaned Today</h3>
                  </div>
                  
                  <div className="space-y-4">
                    {PROCESS_STEPS.map((step, index) => {
                      const Icon = step.icon;
                      return (
                        <div key={step.step} className="flex items-start gap-4">
                          <div className={cn(
                            "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border",
                            index === 0 
                              ? "bg-primary text-white border-primary" 
                              : "bg-muted text-muted-foreground border-border"
                          )}>
                            <Icon className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="font-medium text-sm">{step.title}</p>
                            <p className="text-xs text-muted-foreground">{step.description}</p>
                          </div>
                          {index === 0 && (
                            <Badge className="ml-auto bg-green-500/10 text-green-600 border border-green-500/20 text-[10px]">
                              Start here
                            </Badge>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-6 pt-6 border-t border-border">
                    <div className="flex items-center justify-center gap-1 mb-2">
                      {[...Array(5)].map((_, i) => (
                        <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />
                      ))}
                    </div>
                    <p className="text-xs text-center text-muted-foreground">
                      "Best cleaning service in Maryland" — 500+ 5-star reviews
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* Problem/Solution Section */}
      <section className="py-12 md:py-16 border-t border-border bg-muted/30">
        <div className="max-w-6xl mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
            <div>
              <Badge variant="outline" className="mb-4 border-red-500/30 text-red-600 bg-red-500/10">
                Sound Familiar?
              </Badge>
              <h2 className="text-2xl md:text-3xl font-bold mb-4">
                Tired of Unreliable Cleaners?
              </h2>
              <ul className="space-y-3 text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="text-red-500 mt-1">✗</span>
                  Cleaners who cancel at the last minute
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-500 mt-1">✗</span>
                  Showing up late (or not at all)
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-500 mt-1">✗</span>
                  Inconsistent quality from visit to visit
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-500 mt-1">✗</span>
                  Hidden fees and surprise charges
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-500 mt-1">✗</span>
                  Having to follow up multiple times
                </li>
              </ul>
            </div>
            <div>
              <Badge variant="outline" className="mb-4 border-green-500/30 text-green-600 bg-green-500/10">
                The Novara Difference
              </Badge>
              <h2 className="text-2xl md:text-3xl font-bold mb-4">
                Professional Service You Can Count On
              </h2>
              <ul className="space-y-3">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                  <span><strong>On-time guarantee</strong> — We show up when promised</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                  <span><strong>Same team every time</strong> — Consistency you can trust</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                  <span><strong>Transparent pricing</strong> — Know what you pay upfront</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                  <span><strong>48-hour re-clean guarantee</strong> — Not happy? We fix it free</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                  <span><strong>Real communication</strong> — We respond in minutes, not days</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Preview */}
      <section className="py-12 md:py-16 border-t border-border">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center mb-10">
            <Badge variant="secondary" className="mb-2 border border-border">
              <Percent className="w-3 h-3 mr-1" />
              Transparent Pricing
            </Badge>
            <h2 className="text-2xl md:text-3xl font-bold mb-2">Simple, Honest Pricing</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              No hidden fees. No surprise charges. Just straightforward pricing based on your home size.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-3xl mx-auto mb-8">
            {PRICING_PREVIEW.map((item, index) => (
              <Card key={index} className="border border-border shadow-sm text-center">
                <CardContent className="p-5">
                  <p className="font-semibold mb-1">{item.size}</p>
                  <p className="text-xs text-muted-foreground mb-3">{item.sqft}</p>
                  <p className="text-3xl font-bold text-primary">${item.price}</p>
                  <p className="text-xs text-muted-foreground">one-time clean</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="text-center">
            <p className="text-sm text-muted-foreground mb-4">
              Save up to 40% with a membership plan. Prices vary by location.
            </p>
            <Button 
              size="lg"
              onClick={() => document.getElementById('hero-zip')?.focus()}
              className="bg-gradient-to-r from-primary to-purple-600"
            >
              Get Your Exact Price
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-12 md:py-16 border-t border-border bg-muted/30">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center mb-10">
            <h2 className="text-2xl md:text-3xl font-bold mb-2">Why Novara?</h2>
            <p className="text-muted-foreground">Professional cleaning you can actually count on</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
            {FEATURES.map((feature, index) => {
              const Icon = feature.icon;
              return (
                <Card key={index} className="border border-border shadow-sm">
                  <CardContent className="p-4 md:p-5 text-center">
                    <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3 border border-primary/20">
                      <Icon className="w-5 h-5 text-primary" />
                    </div>
                    <h3 className="font-semibold text-sm mb-1">{feature.title}</h3>
                    <p className="text-xs text-muted-foreground">{feature.description}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* Social Proof Section */}
      <section className="py-12 md:py-16 border-t border-border">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center mb-10">
            <div className="flex items-center justify-center gap-1 mb-2">
              {[...Array(5)].map((_, i) => (
                <Star key={i} className="w-5 h-5 fill-amber-400 text-amber-400" />
              ))}
            </div>
            <h2 className="text-2xl md:text-3xl font-bold mb-2">Loved by Maryland Homeowners</h2>
            <p className="text-muted-foreground">Join thousands of happy customers across the DMV</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {TESTIMONIALS.map((testimonial, index) => (
              <Card key={index} className="border border-border shadow-sm">
                <CardContent className="p-5">
                  <div className="flex items-center gap-1 mb-3">
                    {[...Array(testimonial.rating)].map((_, i) => (
                      <Star key={i} className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                    ))}
                  </div>
                  <p className="text-sm mb-4 italic">"{testimonial.text}"</p>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <Users className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{testimonial.name}</p>
                      <p className="text-xs text-muted-foreground">{testimonial.location}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-12 md:py-16 border-t border-border bg-gradient-to-br from-primary/5 to-purple-500/5">
        <div className="max-w-2xl mx-auto px-4 text-center">
          <Award className="w-12 h-12 text-primary mx-auto mb-4" />
          <h2 className="text-2xl md:text-3xl font-bold mb-4">
            Ready for a Home That Sparkles?
          </h2>
          <p className="text-muted-foreground mb-6">
            Get your instant quote in seconds. No commitment required. 
            Join thousands of Maryland homeowners who trust Novara for their cleaning needs.
          </p>

          <Card className="border border-border shadow-lg max-w-md mx-auto">
            <CardContent className="p-5">
              <form onSubmit={handleZipSubmit} className="space-y-3">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="hero-zip"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={5}
                      placeholder="Enter ZIP code"
                      value={zipCode}
                      onChange={(e) => {
                        setZipCode(e.target.value.replace(/\D/g, ''));
                        setError("");
                      }}
                      className="h-12 pl-10 text-lg border border-border"
                    />
                  </div>
                  <Button 
                    type="submit"
                    disabled={zipCode.length !== 5 || isValidating}
                    className="h-12 px-6 bg-gradient-to-r from-primary to-purple-600 border-0"
                  >
                    {isValidating ? "..." : "Get Quote"}
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              </form>
              <p className="text-xs text-muted-foreground mt-3 text-center">
                No credit card required • Instant pricing • Cancel anytime
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Service Areas */}
      <section className="py-8 border-t border-border bg-muted/30">
        <div className="max-w-6xl mx-auto px-4 text-center">
          <p className="text-sm text-muted-foreground mb-3">Proudly serving Maryland communities</p>
          <div className="flex flex-wrap justify-center gap-2 text-xs text-muted-foreground">
            {['Bethesda', 'Potomac', 'Chevy Chase', 'Rockville', 'Silver Spring', 'Columbia', 'Ellicott City', 'Annapolis', 'Frederick', 'Baltimore'].map((area) => (
              <span key={area} className="px-2 py-1 bg-background rounded border border-border">{area}</span>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 border-t border-border">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-gradient-to-br from-primary to-purple-600 flex items-center justify-center">
                <Sparkles className="w-3 h-3 text-white" />
              </div>
              <span className="font-semibold text-sm">Novara Cleaning</span>
            </div>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <a href="tel:3018005252" className="flex items-center gap-1 hover:text-foreground">
                <Phone className="w-3.5 h-3.5" />
                (301) 800-5252
              </a>
            </div>
            <div className="flex items-center gap-6 text-xs text-muted-foreground">
              <span>© 2024 Novara Cleaning</span>
              <a href="#" className="hover:text-foreground">Privacy</a>
              <a href="#" className="hover:text-foreground">Terms</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
