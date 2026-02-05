import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import SEO from "@/components/SEO";
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
  Award,
  Play,
  ChevronRight,
  Percent,
  RefreshCw,
  Heart,
  Target,
  TrendingUp
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

// Booking flow steps visualization
const BOOKING_STEPS = [
  {
    step: 1,
    title: "Enter ZIP",
    subtitle: "Check coverage",
    icon: MapPin,
    color: "from-violet-500 to-purple-600",
  },
  {
    step: 2,
    title: "Home Size",
    subtitle: "Instant price",
    icon: Home,
    color: "from-blue-500 to-indigo-600",
  },
  {
    step: 3,
    title: "Pick Service",
    subtitle: "One-time or plan",
    icon: Sparkles,
    color: "from-emerald-500 to-teal-600",
  },
  {
    step: 4,
    title: "Schedule",
    subtitle: "Book instantly",
    icon: Calendar,
    color: "from-amber-500 to-orange-600",
  },
];

const FEATURES = [
  {
    icon: Clock,
    title: "On-Time Guarantee",
    description: "We show up when we say we will. If we're late, your cleaning is discounted.",
    highlight: "98% on-time rate",
  },
  {
    icon: Shield,
    title: "Vetted Professionals",
    description: "Background-checked, trained, and insured cleaning professionals you can trust.",
    highlight: "100% vetted",
  },
  {
    icon: CreditCard,
    title: "Transparent Pricing",
    description: "See your exact price before booking. No hidden fees, no surprises.",
    highlight: "Upfront quotes",
  },
  {
    icon: RefreshCw,
    title: "Satisfaction Guaranteed",
    description: "Not happy? We'll re-clean for free within 48 hours. No questions asked.",
    highlight: "48hr re-clean",
  },
];

const TESTIMONIALS = [
  {
    name: "Sarah M.",
    location: "Bethesda, MD",
    text: "After years of no-shows and mediocre cleaning, Novara is a breath of fresh air. They actually show up on time and do an incredible job. My home has never looked better!",
    rating: 5,
    image: "SM",
  },
  {
    name: "Michael R.",
    location: "Rockville, MD",
    text: "The online booking was so easy - scheduled my first clean in under 2 minutes. The team was professional, thorough, and left my apartment sparkling.",
    rating: 5,
    image: "MR",
  },
  {
    name: "Jennifer L.",
    location: "Silver Spring, MD",
    text: "We switched from another service and the difference is night and day. Consistent quality every single time. Worth every penny for the peace of mind.",
    rating: 5,
    image: "JL",
  },
];

const STATS = [
  { value: "2,500+", label: "Happy Customers", icon: Heart },
  { value: "4.9", label: "Average Rating", icon: Star },
  { value: "98%", label: "On-Time Rate", icon: Target },
  { value: "15K+", label: "Cleans Completed", icon: TrendingUp },
];

const PRICING_PREVIEW = [
  { size: "Studio/1BR", sqft: "Under 1,000 sq ft", price: 150, popular: false },
  { size: "2-3 BR", sqft: "1,500-2,000 sq ft", price: 239, popular: true },
  { size: "4+ BR", sqft: "2,500-3,000 sq ft", price: 339, popular: false },
];

const SERVICE_AREAS = [
  'Bethesda', 'Potomac', 'Chevy Chase', 'Rockville', 'Silver Spring', 
  'Columbia', 'Ellicott City', 'Annapolis', 'Frederick', 'Baltimore'
];

const Index = () => {
  const navigate = useNavigate();
  const { updateBookingData } = useBooking();
  const [zipCode, setZipCode] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState("");
  const [activeStep, setActiveStep] = useState(1);

  // Animate through booking steps
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveStep((prev) => (prev % 4) + 1);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleZipSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (zipCode.length !== 5) {
      setError("Please enter a valid 5-digit ZIP code");
      return;
    }

    setIsValidating(true);
    setError("");

    try {
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
    <div className="min-h-screen bg-background overflow-hidden">
      <SEO />
      
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <span className="font-bold text-xl tracking-tight">Novara</span>
            </div>
            
            <div className="hidden md:flex items-center gap-6">
              <a href="#how-it-works" className="text-sm text-muted-foreground hover:text-foreground transition-colors">How It Works</a>
              <a href="#pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Pricing</a>
              <a href="#reviews" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Reviews</a>
              <a href="tel:3018005252" className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
                <Phone className="w-3.5 h-3.5" />
                (301) 800-5252
              </a>
            </div>
            
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" onClick={() => navigate('/auth')} className="hidden sm:flex">
                Sign In
              </Button>
              <Badge className="bg-gradient-to-r from-emerald-500 to-teal-500 text-white border-0 shadow-md">
                <Zap className="w-3 h-3 mr-1" />
                Book in 2 min
              </Badge>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-12 pb-20 md:pt-20 md:pb-32 overflow-hidden">
        {/* Background Elements */}
        <div className="absolute inset-0 bg-gradient-to-br from-violet-50 via-background to-purple-50/50 dark:from-violet-950/20 dark:to-purple-950/20" />
        <div className="absolute top-20 left-10 w-72 h-72 bg-violet-200/30 rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-purple-200/30 rounded-full blur-3xl" />
        
        <div className="relative max-w-7xl mx-auto px-4">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            {/* Left: Hero Content */}
            <div className="space-y-8">
              <div className="space-y-4">
                <Badge variant="outline" className="border-violet-300 text-violet-700 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/50 px-4 py-1.5">
                  <Award className="w-3.5 h-3.5 mr-1.5" />
                  Maryland's #1 Rated Cleaning Service
                </Badge>
                
                <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold leading-tight tracking-tight">
                  A Cleaning Service That{" "}
                  <span className="bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">
                    Actually Shows Up
                  </span>
                </h1>
                
                <p className="text-lg md:text-xl text-muted-foreground max-w-lg">
                  Tired of unreliable cleaners? Book vetted professionals in minutes. 
                  Transparent pricing. On-time guarantee. Satisfaction guaranteed.
                </p>
              </div>

              {/* Stats Row */}
              <div className="grid grid-cols-4 gap-4">
                {STATS.map((stat, i) => {
                  const Icon = stat.icon;
                  return (
                    <div key={i} className="text-center">
                      <div className="flex items-center justify-center mb-1">
                        <Icon className="w-4 h-4 text-violet-500 mr-1" />
                        <span className="text-xl md:text-2xl font-bold">{stat.value}</span>
                      </div>
                      <p className="text-[10px] md:text-xs text-muted-foreground">{stat.label}</p>
                    </div>
                  );
                })}
              </div>

              {/* ZIP Entry Form */}
              <Card className="border-2 border-violet-200 dark:border-violet-800 shadow-xl bg-white/80 dark:bg-background/80 backdrop-blur">
                <CardContent className="p-6">
                  <form onSubmit={handleZipSubmit} className="space-y-4">
                    <div>
                      <label className="text-sm font-semibold mb-2 block">
                        Get your instant quote
                      </label>
                      <div className="flex gap-3">
                        <div className="relative flex-1">
                          <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
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
                              "h-14 pl-12 text-lg font-medium border-2 rounded-xl transition-all",
                              error ? "border-destructive" : "border-border focus:border-violet-500"
                            )}
                            autoFocus
                          />
                        </div>
                        <Button 
                          type="submit"
                          disabled={zipCode.length !== 5 || isValidating}
                          size="lg"
                          className="h-14 px-8 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 shadow-lg shadow-violet-500/25"
                        >
                          {isValidating ? "..." : "Get Quote"}
                          <ArrowRight className="w-5 h-5 ml-2" />
                        </Button>
                      </div>
                      {error && <p className="text-sm text-destructive mt-2">{error}</p>}
                    </div>
                  </form>

                  <div className="flex flex-wrap items-center gap-4 mt-4 pt-4 border-t">
                    {[
                      { icon: CheckCircle2, text: "No credit card needed" },
                      { icon: Clock, text: "Instant pricing" },
                      { icon: Shield, text: "Cancel anytime" },
                    ].map((item, i) => (
                      <div key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <item.icon className="w-3.5 h-3.5 text-emerald-500" />
                        {item.text}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Right: Booking Flow Visualization */}
            <div className="hidden lg:block">
              <Card className="border-2 border-border shadow-2xl bg-gradient-to-br from-white to-violet-50/50 dark:from-background dark:to-violet-950/20 overflow-hidden">
                <CardContent className="p-8">
                  <div className="text-center mb-8">
                    <Badge className="bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300 border-0 mb-3">
                      <Play className="w-3 h-3 mr-1" />
                      See How It Works
                    </Badge>
                    <h3 className="text-xl font-bold">Book in 4 Simple Steps</h3>
                  </div>
                  
                  <div className="space-y-4">
                    {BOOKING_STEPS.map((step, index) => {
                      const Icon = step.icon;
                      const isActive = activeStep === step.step;
                      const isPast = activeStep > step.step;
                      
                      return (
                        <div 
                          key={step.step}
                          className={cn(
                            "flex items-center gap-4 p-4 rounded-2xl border-2 transition-all duration-500",
                            isActive 
                              ? "border-violet-400 bg-gradient-to-r from-violet-50 to-purple-50 dark:from-violet-950/50 dark:to-purple-950/50 scale-[1.02] shadow-lg" 
                              : isPast
                              ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20"
                              : "border-border bg-background/50"
                          )}
                        >
                          <div className={cn(
                            "w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-500",
                            isActive 
                              ? `bg-gradient-to-br ${step.color} shadow-lg`
                              : isPast
                              ? "bg-emerald-500"
                              : "bg-muted"
                          )}>
                            {isPast ? (
                              <CheckCircle2 className="w-6 h-6 text-white" />
                            ) : (
                              <Icon className={cn("w-6 h-6", isActive ? "text-white" : "text-muted-foreground")} />
                            )}
                          </div>
                          <div className="flex-1">
                            <p className={cn(
                              "font-semibold transition-colors",
                              isActive ? "text-violet-700 dark:text-violet-300" : ""
                            )}>
                              {step.title}
                            </p>
                            <p className="text-sm text-muted-foreground">{step.subtitle}</p>
                          </div>
                          {isActive && (
                            <div className="w-2 h-2 rounded-full bg-violet-500 animate-pulse" />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-8 pt-6 border-t text-center">
                    <div className="flex items-center justify-center gap-1 mb-2">
                      {[...Array(5)].map((_, i) => (
                        <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />
                      ))}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Join 2,500+ happy customers in Maryland
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" className="py-20 bg-muted/30 border-y border-border">
        <div className="max-w-7xl mx-auto px-4">
          <div className="text-center mb-12">
            <Badge variant="secondary" className="mb-3">Simple Process</Badge>
            <h2 className="text-3xl md:text-4xl font-bold mb-3">How Novara Works</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Book your professional cleaning in under 2 minutes. No phone calls, no waiting.
            </p>
          </div>

          <div className="grid md:grid-cols-4 gap-6">
            {BOOKING_STEPS.map((step, index) => {
              const Icon = step.icon;
              return (
                <div key={step.step} className="relative">
                  {index < 3 && (
                    <div className="hidden md:block absolute top-12 left-[60%] w-[80%] border-t-2 border-dashed border-violet-200 dark:border-violet-800" />
                  )}
                  <Card className="relative bg-background border-2 hover:border-violet-300 transition-all hover:shadow-lg group">
                    <CardContent className="pt-8 pb-6 text-center">
                      <div className={cn(
                        "w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center bg-gradient-to-br shadow-lg transition-transform group-hover:scale-110",
                        step.color
                      )}>
                        <Icon className="w-8 h-8 text-white" />
                      </div>
                      <div className="absolute top-4 right-4 w-8 h-8 rounded-full bg-violet-100 dark:bg-violet-900 flex items-center justify-center text-sm font-bold text-violet-700 dark:text-violet-300">
                        {step.step}
                      </div>
                      <h3 className="font-bold text-lg mb-1">{step.title}</h3>
                      <p className="text-sm text-muted-foreground">{step.subtitle}</p>
                    </CardContent>
                  </Card>
                </div>
              );
            })}
          </div>

          <div className="text-center mt-10">
            <Button 
              size="lg" 
              onClick={() => document.querySelector('input')?.focus()}
              className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 shadow-lg h-14 px-8 rounded-xl"
            >
              Start Booking Now
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4">
          <div className="text-center mb-12">
            <Badge variant="secondary" className="mb-3">Why Choose Us</Badge>
            <h2 className="text-3xl md:text-4xl font-bold mb-3">The Novara Difference</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Professional cleaning service backed by guarantees you can count on.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {FEATURES.map((feature, index) => {
              const Icon = feature.icon;
              return (
                <Card key={index} className="border-2 hover:border-violet-300 transition-all hover:shadow-lg group">
                  <CardContent className="pt-6">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-100 to-purple-100 dark:from-violet-900 dark:to-purple-900 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                      <Icon className="w-7 h-7 text-violet-600 dark:text-violet-400" />
                    </div>
                    <Badge variant="outline" className="mb-3 text-[10px] border-emerald-300 text-emerald-700 dark:text-emerald-400">
                      {feature.highlight}
                    </Badge>
                    <h3 className="font-bold text-lg mb-2">{feature.title}</h3>
                    <p className="text-sm text-muted-foreground">{feature.description}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* Pricing Preview */}
      <section id="pricing" className="py-20 bg-gradient-to-b from-background to-violet-50/50 dark:to-violet-950/20">
        <div className="max-w-5xl mx-auto px-4">
          <div className="text-center mb-12">
            <Badge variant="secondary" className="mb-3">
              <Percent className="w-3 h-3 mr-1" />
              Transparent Pricing
            </Badge>
            <h2 className="text-3xl md:text-4xl font-bold mb-3">Simple, Honest Pricing</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              No hidden fees. Know exactly what you'll pay before booking.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6 mb-8">
            {PRICING_PREVIEW.map((tier, index) => (
              <Card 
                key={index} 
                className={cn(
                  "relative border-2 transition-all hover:shadow-xl",
                  tier.popular 
                    ? "border-violet-400 shadow-lg scale-105 bg-gradient-to-b from-violet-50 to-white dark:from-violet-950/50 dark:to-background" 
                    : "border-border hover:border-violet-300"
                )}
              >
                {tier.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-gradient-to-r from-violet-600 to-purple-600 text-white border-0 shadow-md">
                      Most Popular
                    </Badge>
                  </div>
                )}
                <CardContent className="pt-8 pb-6 text-center">
                  <p className="font-bold text-lg mb-1">{tier.size}</p>
                  <p className="text-xs text-muted-foreground mb-4">{tier.sqft}</p>
                  <div className="mb-4">
                    <span className="text-4xl font-bold">${tier.price}</span>
                    <span className="text-muted-foreground text-sm">/clean</span>
                  </div>
                  <p className="text-xs text-muted-foreground">One-time pricing</p>
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
              onClick={() => document.querySelector('input')?.focus()}
              className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 rounded-xl h-12"
            >
              Get Your Exact Price
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section id="reviews" className="py-20">
        <div className="max-w-7xl mx-auto px-4">
          <div className="text-center mb-12">
            <div className="flex items-center justify-center gap-1 mb-3">
              {[...Array(5)].map((_, i) => (
                <Star key={i} className="w-5 h-5 fill-amber-400 text-amber-400" />
              ))}
            </div>
            <h2 className="text-3xl md:text-4xl font-bold mb-3">Loved by Maryland Homeowners</h2>
            <p className="text-muted-foreground">Join thousands of happy customers across the DMV</p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {TESTIMONIALS.map((testimonial, index) => (
              <Card key={index} className="border-2 hover:border-violet-300 transition-all hover:shadow-lg">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-1 mb-4">
                    {[...Array(testimonial.rating)].map((_, i) => (
                      <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />
                    ))}
                  </div>
                  <p className="text-sm mb-6 leading-relaxed">"{testimonial.text}"</p>
                  <div className="flex items-center gap-3 pt-4 border-t">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white text-sm font-bold">
                      {testimonial.image}
                    </div>
                    <div>
                      <p className="font-semibold text-sm">{testimonial.name}</p>
                      <p className="text-xs text-muted-foreground">{testimonial.location}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-20 bg-gradient-to-br from-violet-600 to-purple-700 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-10 left-10 w-40 h-40 bg-white rounded-full blur-3xl" />
          <div className="absolute bottom-10 right-10 w-60 h-60 bg-white rounded-full blur-3xl" />
        </div>
        
        <div className="relative max-w-3xl mx-auto px-4 text-center">
          <Sparkles className="w-12 h-12 text-white/80 mx-auto mb-6" />
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Ready for a Spotless Home?
          </h2>
          <p className="text-lg text-white/80 mb-8 max-w-xl mx-auto">
            Get your instant quote in seconds. No commitment required.
          </p>

          <Card className="max-w-md mx-auto border-0 shadow-2xl">
            <CardContent className="p-6">
              <form onSubmit={handleZipSubmit} className="space-y-4">
                <div className="flex gap-3">
                  <div className="relative flex-1">
                    <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <Input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={5}
                      placeholder="ZIP code"
                      value={zipCode}
                      onChange={(e) => setZipCode(e.target.value.replace(/\D/g, ''))}
                      className="h-14 pl-12 text-lg rounded-xl border-2"
                    />
                  </div>
                  <Button 
                    type="submit"
                    disabled={zipCode.length !== 5 || isValidating}
                    size="lg"
                    className="h-14 px-8 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600"
                  >
                    Book Now
                    <ChevronRight className="w-5 h-5 ml-1" />
                  </Button>
                </div>
              </form>
              <p className="text-xs text-muted-foreground mt-4 text-center">
                No credit card required • Instant pricing • Cancel anytime
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Service Areas */}
      <section className="py-10 bg-muted/30 border-t">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <p className="text-sm text-muted-foreground mb-4">Proudly serving Maryland communities</p>
          <div className="flex flex-wrap justify-center gap-2">
            {SERVICE_AREAS.map((area) => (
              <Badge key={area} variant="secondary" className="px-3 py-1">
                {area}
              </Badge>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 border-t">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <span className="font-bold">Novara Cleaning</span>
            </div>
            
            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <a href="tel:3018005252" className="flex items-center gap-1 hover:text-foreground transition-colors">
                <Phone className="w-4 h-4" />
                (301) 800-5252
              </a>
              <span>support@novaracleaning.com</span>
            </div>
            
            <div className="flex items-center gap-6 text-xs text-muted-foreground">
              <span>© 2024 Novara Cleaning</span>
              <a href="#" className="hover:text-foreground transition-colors">Privacy</a>
              <a href="#" className="hover:text-foreground transition-colors">Terms</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
