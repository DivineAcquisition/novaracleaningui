import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { 
  DollarSign, 
  Clock, 
  Shield, 
  TrendingUp,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  Users,
  Calendar,
  Loader2,
  Star,
  Zap,
  MapPin,
  CreditCard
} from "lucide-react";
import logo from "@/assets/logo.png";

const HERO_STATS = [
  { value: "$22", label: "Avg. Hourly", icon: DollarSign },
  { value: "500+", label: "Active Cleaners", icon: Users },
  { value: "24hr", label: "Fast Payouts", icon: Zap },
  { value: "4.9★", label: "Cleaner Rating", icon: Star },
];

const BENEFITS = [
  {
    icon: DollarSign,
    title: "Competitive Pay",
    description: "Earn $18-25/hour with tips. Get paid within 24 hours of job completion.",
    highlight: "$18-25/hr"
  },
  {
    icon: Calendar,
    title: "Your Schedule",
    description: "Work when you want. Set your availability and accept jobs that fit your life.",
    highlight: "100% Flexible"
  },
  {
    icon: MapPin,
    title: "Local Jobs",
    description: "Get matched with cleaning jobs in your area. Set your travel radius.",
    highlight: "Near You"
  },
  {
    icon: CreditCard,
    title: "Instant Payouts",
    description: "No waiting for payday. Get paid automatically after each completed job.",
    highlight: "Same Day"
  },
];

const STEPS = [
  { step: "1", title: "Sign Up", description: "Create your account in 2 minutes with Google or email" },
  { step: "2", title: "Complete Profile", description: "Add your skills, availability, and service area" },
  { step: "3", title: "Get Verified", description: "Quick background check and account verification" },
  { step: "4", title: "Start Earning", description: "Accept jobs and get paid instantly" },
];

const TESTIMONIALS = [
  { name: "Maria S.", role: "Cleaner since 2024", quote: "The flexible schedule lets me work around my kids' school. Love it!", rating: 5 },
  { name: "James T.", role: "Cleaner since 2023", quote: "Best part is getting paid right after each job. No waiting!", rating: 5 },
  { name: "Linda K.", role: "Cleaner since 2024", quote: "Great support team and steady work. Highly recommend.", rating: 5 },
];

export default function ContractorLanding() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);

  const getRedirectUrl = (path: string) => {
    const hostname = window.location.hostname;
    if (hostname.includes("contractor.")) {
      return `https://contractor.novaracleaning.com${path}`;
    }
    return `${window.location.origin}${path}`;
  };

  const handleGoogleSignUp = async () => {
    setIsLoading(true);
    try {
      const redirectUrl = getRedirectUrl("/cleaner/onboarding");
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          queryParams: { access_type: 'offline', prompt: 'consent' },
        },
      });
      if (error) {
        toast.error("Failed to connect. Please try again.");
        setIsLoading(false);
      }
    } catch {
      toast.error("An error occurred. Please try again.");
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src={logo} alt="Novara" className="w-10 h-10 rounded-xl" />
              <div>
                <span className="text-xl font-bold">Novara</span>
                <Badge variant="secondary" className="ml-2 text-xs">Contractors</Badge>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="ghost" onClick={() => navigate("/cleaner/auth")}>
                Sign In
              </Button>
              <Button 
                onClick={handleGoogleSignUp}
                disabled={isLoading}
                className="bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] hover:opacity-90"
              >
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Join Now
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        {/* Background Gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#5500FF]/10 via-background to-[#8F7BFD]/10" />
        <div className="absolute top-20 left-10 w-72 h-72 bg-[#5500FF]/20 rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-[#8F7BFD]/20 rounded-full blur-3xl" />
        
        <div className="container mx-auto px-4 py-16 md:py-24 relative">
          <div className="max-w-4xl mx-auto text-center space-y-8">
            <Badge className="bg-[#5500FF]/10 text-[#5500FF] border-[#5500FF]/20 px-4 py-1.5">
              <Sparkles className="w-4 h-4 mr-2" />
              Now Hiring in Maryland
            </Badge>
            
            <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight">
              Clean Homes.
              <span className="block bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] bg-clip-text text-transparent">
                Earn More.
              </span>
            </h1>
            
            <p className="text-xl md:text-2xl text-muted-foreground max-w-2xl mx-auto">
              Join Maryland's fastest-growing cleaning network. Set your own hours, 
              choose your jobs, and get paid instantly.
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
              <Button 
                size="lg" 
                onClick={handleGoogleSignUp}
                disabled={isLoading}
                className="h-14 px-8 text-lg bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] hover:opacity-90 shadow-lg shadow-[#5500FF]/25"
              >
                {isLoading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : (
                  <svg className="mr-2 w-5 h-5" viewBox="0 0 24 24">
                    <path fill="#fff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#fff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#fff" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#fff" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                )}
                Start with Google
              </Button>
              <Button 
                size="lg" 
                variant="outline"
                onClick={() => navigate("/cleaner/onboarding-landing")}
                className="h-14 px-8 text-lg border-2"
              >
                Use Email Instead
                <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-8 max-w-3xl mx-auto">
              {HERO_STATS.map((stat, i) => (
                <div key={i} className="bg-card/50 backdrop-blur border border-border rounded-xl p-4 text-center">
                  <stat.icon className="w-5 h-5 mx-auto mb-2 text-[#5500FF]" />
                  <div className="text-2xl font-bold">{stat.value}</div>
                  <div className="text-xs text-muted-foreground">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="py-20 bg-muted/30">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <Badge variant="outline" className="mb-4">Why Join Novara</Badge>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Built for Cleaners, by Cleaners
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              We've created a platform that puts you first. Better pay, more flexibility, and tools to help you succeed.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
            {BENEFITS.map((benefit, i) => (
              <Card key={i} className="border-2 hover:border-[#5500FF]/50 transition-all hover:shadow-lg group">
                <CardContent className="p-6">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#5500FF] to-[#8F7BFD] flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                    <benefit.icon className="w-6 h-6 text-white" />
                  </div>
                  <Badge variant="secondary" className="mb-3 bg-[#5500FF]/10 text-[#5500FF]">
                    {benefit.highlight}
                  </Badge>
                  <h3 className="text-lg font-semibold mb-2">{benefit.title}</h3>
                  <p className="text-sm text-muted-foreground">{benefit.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <Badge variant="outline" className="mb-4">Get Started</Badge>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Start Earning in 4 Steps
            </h2>
          </div>

          <div className="max-w-4xl mx-auto">
            <div className="grid md:grid-cols-4 gap-8">
              {STEPS.map((item, i) => (
                <div key={i} className="text-center relative">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#5500FF] to-[#8F7BFD] flex items-center justify-center mx-auto mb-4 text-white text-2xl font-bold shadow-lg">
                    {item.step}
                  </div>
                  <h3 className="font-semibold mb-2">{item.title}</h3>
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                  {i < STEPS.length - 1 && (
                    <div className="hidden md:block absolute top-8 left-[60%] w-full h-0.5 bg-gradient-to-r from-[#5500FF]/50 to-transparent" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-20 bg-muted/30">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <Badge variant="outline" className="mb-4">Testimonials</Badge>
            <h2 className="text-3xl md:text-4xl font-bold">
              Loved by Our Team
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
                    <p className="text-xs text-muted-foreground">{t.role}</p>
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
          <div className="max-w-4xl mx-auto">
            <Card className="bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] border-0 overflow-hidden relative">
              <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
              <CardContent className="p-8 md:p-12 text-center text-white relative">
                <h2 className="text-3xl md:text-4xl font-bold mb-4">
                  Ready to Start Earning?
                </h2>
                <p className="text-white/80 mb-8 max-w-xl mx-auto text-lg">
                  Join hundreds of cleaners already earning great pay with flexible hours. 
                  Sign up takes less than 5 minutes.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Button 
                    size="lg"
                    onClick={handleGoogleSignUp}
                    disabled={isLoading}
                    className="h-14 px-8 bg-white text-[#5500FF] hover:bg-white/90"
                  >
                    {isLoading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : null}
                    Get Started Now
                    <ArrowRight className="ml-2 w-5 h-5" />
                  </Button>
                </div>
                <p className="text-white/60 text-sm mt-6">
                  No fees to join • Start earning this week
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <img src={logo} alt="Novara" className="w-6 h-6 rounded" />
              <span>© {new Date().getFullYear()} Novara Cleaning</span>
            </div>
            <div className="flex gap-6">
              <a href="mailto:hello@novaracleaning.com" className="hover:text-[#5500FF]">Contact</a>
              <button onClick={() => window.location.href = "https://book.novaracleaning.com"} className="hover:text-[#5500FF]">
                Book a Cleaning
              </button>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
