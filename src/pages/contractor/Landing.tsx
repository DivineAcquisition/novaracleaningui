import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GradientBlob } from "@/components/ui/gradient-blob";
import { FeatureCard } from "@/components/ui/feature-card";
import { TestimonialCard } from "@/components/ui/testimonial-card";
import { StatsCard, StatsRow } from "@/components/ui/stats-card";
import { 
  DollarSign, 
  CheckCircle2,
  ArrowRight,
  Sparkles,
  Users,
  Calendar,
  Star,
  Zap,
  MapPin,
  CreditCard,
  Award,
  Briefcase,
  Target
} from "lucide-react";
import logo from "@/assets/logo.png";
import { cn } from "@/lib/utils";

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
    badge: "$18-25/hr"
  },
  {
    icon: Calendar,
    title: "Your Schedule",
    description: "Work when you want. Set your availability and accept jobs that fit your life.",
    badge: "100% Flexible"
  },
  {
    icon: MapPin,
    title: "Local Jobs",
    description: "Get matched with cleaning jobs in your area. Set your preferred travel radius.",
    badge: "Near You"
  },
  {
    icon: CreditCard,
    title: "Instant Payouts",
    description: "No waiting for payday. Get paid automatically after each completed job.",
    badge: "Same Day"
  },
];

const STEPS = [
  { step: "1", title: "Sign Up", description: "Create your account in 2 minutes" },
  { step: "2", title: "Complete Profile", description: "Add your skills & availability" },
  { step: "3", title: "Get Verified", description: "Quick background check" },
  { step: "4", title: "Start Earning", description: "Accept jobs & get paid" },
];

const TESTIMONIALS = [
  { name: "Maria S.", role: "Cleaner since 2024", quote: "The flexible schedule lets me work around my kids' school. Love it!", rating: 5 },
  { name: "James T.", role: "Cleaner since 2023", quote: "Best part is getting paid right after each job. No waiting!", rating: 5 },
  { name: "Linda K.", role: "Cleaner since 2024", quote: "Great support team and steady work. Highly recommend joining.", rating: 5 },
];

export default function ContractorLanding() {
  const navigate = useNavigate();

  // Navigate to onboarding page where users can choose Google or Email signup
  const handleJoinClick = () => {
    navigate("/cleaner/onboarding-landing");
  };

  return (
    <div className="min-h-screen bg-white overflow-x-hidden">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-gray-100">
        <div className="container mx-auto px-4 py-3 md:py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 md:gap-3">
              <img src={logo} alt="Novara" className="w-8 h-8 md:w-10 md:h-10 rounded-xl" />
              <div className="flex items-center gap-2">
                <span className="text-lg md:text-xl font-bold">Novara</span>
                <Badge variant="secondary" className="text-[10px] md:text-xs bg-[#5500FF]/10 text-[#5500FF]">Contractors</Badge>
              </div>
            </div>
            <div className="flex items-center gap-2 md:gap-3">
              <Link to="/careers">
                <Button variant="ghost" size="sm" className="hidden md:flex text-xs">
                  <Briefcase className="w-3 h-3 mr-1" />
                  Careers
                </Button>
              </Link>
              <Button variant="ghost" size="sm" onClick={() => navigate("/cleaner/auth")} className="text-xs md:text-sm">
                Sign In
              </Button>
              <Button 
                onClick={handleJoinClick}
                size="sm"
                className="bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] hover:opacity-90 text-xs md:text-sm"
              >
                Join Now
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        {/* Background Elements */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#5500FF]/5 via-white to-[#8F7BFD]/5" />
        <GradientBlob className="top-0 left-0 -translate-x-1/3 -translate-y-1/4" color="purple" size="xl" />
        <GradientBlob className="bottom-0 right-0 translate-x-1/3 translate-y-1/4" color="blue" size="lg" />
        
        {/* Decorative grid pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:24px_24px]" />
        
        <div className="container mx-auto px-4 py-12 md:py-20 lg:py-28 relative">
          <div className="max-w-4xl mx-auto text-center space-y-6 md:space-y-8">
            <Badge className="bg-[#5500FF]/10 text-[#5500FF] border-[#5500FF]/20 px-3 md:px-4 py-1 md:py-1.5 text-xs md:text-sm">
              <Sparkles className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" />
              Now Hiring in Maryland
            </Badge>
            
            <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-bold tracking-tight leading-[1.1]">
              Clean Homes.
              <span className="block bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] bg-clip-text text-transparent">
                Earn More.
              </span>
            </h1>
            
            <p className="text-base md:text-lg lg:text-xl xl:text-2xl text-muted-foreground max-w-2xl mx-auto px-4">
              Join Maryland's fastest-growing cleaning network. Set your own hours, 
              choose your jobs, and get paid instantly.
            </p>

            {/* CTA Button - Single button to onboarding page */}
            <div className="flex justify-center pt-2 md:pt-4 px-4">
              <Button 
                size="lg" 
                onClick={handleJoinClick}
                className="h-12 md:h-14 px-8 md:px-12 text-sm md:text-lg bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] hover:opacity-90 shadow-xl shadow-purple-500/25"
              >
                <Sparkles className="mr-2 w-4 h-4 md:w-5 md:h-5" />
                Join Our Team
                <ArrowRight className="ml-2 w-4 h-4 md:w-5 md:h-5" />
              </Button>
            </div>

            {/* Stats Row */}
            <div className="pt-6 md:pt-10">
              <StatsRow className="max-w-3xl mx-auto">
                {HERO_STATS.map((stat, i) => (
                  <StatsCard
                    key={i}
                    value={stat.value}
                    label={stat.label}
                    icon={stat.icon}
                    variant="default"
                    animated={false}
                  />
                ))}
              </StatsRow>
            </div>
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="py-16 md:py-24 bg-gradient-to-b from-gray-50/50 to-white relative">
        <GradientBlob className="top-1/2 right-0 translate-x-1/2 -translate-y-1/2" color="pink" size="lg" animate={false} />
        
        <div className="container mx-auto px-4 relative">
          <div className="text-center mb-10 md:mb-16">
            <Badge variant="outline" className="mb-3 md:mb-4 text-xs">Why Join Novara</Badge>
            <h2 className="text-2xl md:text-3xl lg:text-4xl font-bold mb-3 md:mb-4">
              Built for Cleaners, by Cleaners
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto text-sm md:text-base px-4">
              We've created a platform that puts you first. Better pay, more flexibility, and tools to help you succeed.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 max-w-6xl mx-auto">
            {BENEFITS.map((benefit, i) => (
              <FeatureCard
                key={i}
                icon={benefit.icon}
                title={benefit.title}
                description={benefit.description}
                badge={benefit.badge}
                variant="gradient"
              />
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-16 md:py-24 relative">
        <div className="container mx-auto px-4">
          <div className="text-center mb-10 md:mb-16">
            <Badge variant="outline" className="mb-3 md:mb-4 text-xs">Get Started</Badge>
            <h2 className="text-2xl md:text-3xl lg:text-4xl font-bold mb-3 md:mb-4">
              Start Earning in 4 Steps
            </h2>
          </div>

          <div className="max-w-4xl mx-auto">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-8">
              {STEPS.map((item, i) => (
                <div key={i} className="text-center relative">
                  <div className="w-12 h-12 md:w-16 md:h-16 rounded-xl md:rounded-2xl bg-gradient-to-br from-[#5500FF] to-[#8F7BFD] flex items-center justify-center mx-auto mb-3 md:mb-4 text-white text-lg md:text-2xl font-bold shadow-lg shadow-purple-500/25">
                    {item.step}
                  </div>
                  <h3 className="font-semibold mb-1 text-sm md:text-base">{item.title}</h3>
                  <p className="text-xs md:text-sm text-muted-foreground">{item.description}</p>
                  {i < STEPS.length - 1 && (
                    <div className="hidden md:block absolute top-8 left-[60%] w-full h-0.5 bg-gradient-to-r from-[#5500FF]/50 to-transparent" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Earnings Calculator */}
      <section className="py-16 md:py-20 bg-gradient-to-b from-white to-gray-50/50">
        <div className="container mx-auto px-4">
          <Card className="max-w-3xl mx-auto bg-gradient-to-br from-green-50 to-emerald-50/50 border-green-200 overflow-hidden relative">
            <div className="absolute top-0 right-0 w-48 h-48 bg-green-200/30 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl" />
            <CardContent className="p-6 md:p-10 relative">
              <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="text-center md:text-left">
                  <Badge className="mb-2 md:mb-3 bg-green-100 text-green-700 border-green-200 text-xs">
                    <Target className="w-3 h-3 mr-1" />
                    Earning Potential
                  </Badge>
                  <h3 className="text-xl md:text-2xl font-bold text-green-800 mb-2">Monthly Earnings Example</h3>
                  <p className="text-green-700 text-xs md:text-sm">
                    Pro tier cleaner • 30 hours/week • With bonuses
                  </p>
                </div>
                <div className="text-center">
                  <div className="text-4xl md:text-5xl font-bold text-green-600">$2,450+</div>
                  <div className="text-xs md:text-sm text-green-700">per month</div>
                </div>
              </div>
              <div className="mt-6 pt-6 border-t border-green-200 flex flex-wrap justify-center gap-3 md:gap-6">
                <div className="flex items-center gap-2 text-xs md:text-sm text-green-700">
                  <CheckCircle2 className="w-4 h-4" />
                  Weekly payouts
                </div>
                <div className="flex items-center gap-2 text-xs md:text-sm text-green-700">
                  <CheckCircle2 className="w-4 h-4" />
                  Instant pay available
                </div>
                <div className="flex items-center gap-2 text-xs md:text-sm text-green-700">
                  <CheckCircle2 className="w-4 h-4" />
                  Bonus opportunities
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-16 md:py-24 relative">
        <GradientBlob className="bottom-0 left-0 -translate-x-1/3 translate-y-1/3" color="purple" size="md" animate={false} />
        
        <div className="container mx-auto px-4 relative">
          <div className="text-center mb-10 md:mb-16">
            <Badge variant="outline" className="mb-3 md:mb-4 text-xs">Testimonials</Badge>
            <h2 className="text-2xl md:text-3xl lg:text-4xl font-bold">
              Loved by Our Team
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-4 md:gap-6 max-w-5xl mx-auto">
            {TESTIMONIALS.map((t, i) => (
              <TestimonialCard
                key={i}
                quote={t.quote}
                name={t.name}
                role={t.role}
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
          <div className="max-w-4xl mx-auto">
            <Card className="bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] border-0 overflow-hidden relative">
              <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
              <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/10 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />
              <CardContent className="p-8 md:p-12 text-center text-white relative">
                <Award className="w-12 h-12 md:w-16 md:h-16 mx-auto mb-4 md:mb-6 opacity-90" />
                <h2 className="text-2xl md:text-3xl lg:text-4xl font-bold mb-3 md:mb-4">
                  Ready to Start Earning?
                </h2>
                <p className="text-white/80 mb-6 md:mb-8 max-w-xl mx-auto text-sm md:text-lg">
                  Join hundreds of cleaners already earning great pay with flexible hours. 
                  Sign up takes less than 5 minutes.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 md:gap-4 justify-center">
                  <Button 
                    size="lg"
                    onClick={handleJoinClick}
                    className="h-12 md:h-14 px-6 md:px-8 bg-white text-[#5500FF] hover:bg-white/90 shadow-xl text-sm md:text-base"
                  >
                    Get Started Now
                    <ArrowRight className="ml-2 w-4 h-4 md:w-5 md:h-5" />
                  </Button>
                  <Link to="/careers">
                    <Button 
                      size="lg"
                      variant="outline"
                      className="h-12 md:h-14 px-6 md:px-8 border-white/30 text-white hover:bg-white/10 text-sm md:text-base w-full sm:w-auto"
                    >
                      View Pay & Benefits
                    </Button>
                  </Link>
                </div>
                <p className="text-white/60 text-xs md:text-sm mt-4 md:mt-6">
                  No fees to join • Start earning this week
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 py-6 md:py-8 bg-gray-50/50">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-xs md:text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <img src={logo} alt="Novara" className="w-5 h-5 md:w-6 md:h-6 rounded" />
              <span>© {new Date().getFullYear()} Novara Cleaning</span>
            </div>
            <div className="flex gap-4 md:gap-6">
              <a href="mailto:hello@novaracleaning.com" className="hover:text-[#5500FF] transition-colors">Contact</a>
              <Link to="/careers" className="hover:text-[#5500FF] transition-colors">Careers</Link>
              <button onClick={() => window.location.href = "https://try.novaracleaning.com"} className="hover:text-[#5500FF] transition-colors">
                Book a Cleaning
              </button>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
