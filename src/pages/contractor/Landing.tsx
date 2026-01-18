import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { 
  UserPlus, 
  LogIn, 
  DollarSign, 
  Clock, 
  Shield, 
  TrendingUp,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  Users,
  Calendar
} from "lucide-react";
import logo from "@/assets/logo.png";

const BENEFITS = [
  {
    icon: DollarSign,
    title: "Earn $18+/hour",
    description: "Competitive pay with instant payouts after every job"
  },
  {
    icon: Clock,
    title: "Flexible Hours",
    description: "Work when you want, set your own schedule"
  },
  {
    icon: Shield,
    title: "Secure Platform",
    description: "Get paid reliably through our trusted payment system"
  },
  {
    icon: TrendingUp,
    title: "Grow Your Career",
    description: "Build your reputation and increase earnings over time"
  }
];

const STATS = [
  { value: "500+", label: "Active Cleaners" },
  { value: "$18+", label: "Hourly Rate" },
  { value: "24hr", label: "Payout Speed" },
  { value: "4.9★", label: "Average Rating" }
];

export default function ContractorLanding() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#5500FF]/5 via-background to-[#8F7BFD]/10">
      {/* Header */}
      <header className="container mx-auto px-4 py-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={logo} alt="Novara" className="w-10 h-10 rounded-xl shadow-md" />
            <div>
              <span className="text-xl font-bold block leading-tight">Novara Cleaning</span>
              <span className="text-xs text-muted-foreground">Contractor Portal</span>
            </div>
          </div>
          <Button 
            variant="outline" 
            onClick={() => navigate("/")}
            className="text-muted-foreground"
          >
            Customer Booking
          </Button>
        </div>
      </header>

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-12 md:py-20">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#5500FF]/10 text-[#5500FF] text-sm font-medium">
            <Sparkles className="w-4 h-4" />
            Now Hiring Cleaning Professionals
          </div>

          {/* Heading */}
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight">
            Join Maryland's
            <span className="block bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] bg-clip-text text-transparent">
              #1 Cleaning Team
            </span>
          </h1>

          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
            Earn great pay with flexible hours. Choose your schedule, get instant payouts, 
            and be part of a professional cleaning network.
          </p>

          {/* Stats Bar */}
          <div className="flex flex-wrap justify-center gap-6 md:gap-12 py-6">
            {STATS.map((stat, index) => (
              <div key={index} className="text-center">
                <div className="text-2xl md:text-3xl font-bold text-[#5500FF]">{stat.value}</div>
                <div className="text-sm text-muted-foreground">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Cards */}
      <section className="container mx-auto px-4 pb-16">
        <div className="max-w-3xl mx-auto grid md:grid-cols-2 gap-6">
          {/* New User Card */}
          <Card className="overflow-hidden border-2 border-[#5500FF]/20 hover:border-[#5500FF]/40 transition-all hover:shadow-xl group">
            <CardContent className="p-0">
              <div className="bg-gradient-to-br from-[#5500FF] to-[#8F7BFD] p-6 text-white">
                <div className="w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <UserPlus className="w-7 h-7" />
                </div>
                <h3 className="text-2xl font-bold mb-2">New Here?</h3>
                <p className="text-white/80">
                  Start your journey as a professional cleaner. Quick 5-minute application.
                </p>
              </div>
              <div className="p-6 space-y-4">
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#5500FF]" />
                    No experience required
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#5500FF]" />
                    Training provided
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#5500FF]" />
                    Start earning within days
                  </li>
                </ul>
                <Button 
                  onClick={() => navigate("/cleaner/onboarding-landing")}
                  className="w-full h-12 bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] hover:opacity-90"
                >
                  Join the Team
                  <ArrowRight className="ml-2 w-5 h-5" />
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Existing User Card */}
          <Card className="overflow-hidden border-2 border-border hover:border-[#5500FF]/40 transition-all hover:shadow-xl group">
            <CardContent className="p-0">
              <div className="bg-muted/50 p-6">
                <div className="w-14 h-14 rounded-2xl bg-[#5500FF]/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <LogIn className="w-7 h-7 text-[#5500FF]" />
                </div>
                <h3 className="text-2xl font-bold mb-2">Already a Cleaner?</h3>
                <p className="text-muted-foreground">
                  Sign in to view your dashboard, jobs, and earnings.
                </p>
              </div>
              <div className="p-6 space-y-4">
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-[#5500FF]" />
                    View upcoming jobs
                  </li>
                  <li className="flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-[#5500FF]" />
                    Track your earnings
                  </li>
                  <li className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-[#5500FF]" />
                    Manage availability
                  </li>
                </ul>
                <Button 
                  onClick={() => navigate("/cleaner/auth")}
                  variant="outline"
                  className="w-full h-12 border-2 border-[#5500FF] text-[#5500FF] hover:bg-[#5500FF]/10"
                >
                  Sign In
                  <ArrowRight className="ml-2 w-5 h-5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="bg-card/50 backdrop-blur border-y border-border py-16">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Why Clean with Novara?</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              We provide everything you need to succeed as a professional cleaner.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-5xl mx-auto">
            {BENEFITS.map((benefit, index) => (
              <div 
                key={index}
                className="p-6 rounded-xl bg-card border border-border hover:border-[#5500FF]/40 transition-all hover:shadow-lg"
              >
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#5500FF] to-[#8F7BFD] flex items-center justify-center mb-4">
                  <benefit.icon className="w-6 h-6 text-white" />
                </div>
                <h3 className="font-semibold text-lg mb-2">{benefit.title}</h3>
                <p className="text-sm text-muted-foreground">{benefit.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="container mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold mb-4">How It Works</h2>
          <p className="text-muted-foreground">Getting started is easy</p>
        </div>

        <div className="max-w-4xl mx-auto">
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { step: 1, title: "Apply Online", desc: "Complete our quick 5-minute application with your email" },
              { step: 2, title: "Get Verified", desc: "We'll verify your information and set up your account" },
              { step: 3, title: "Start Earning", desc: "Accept jobs and get paid instantly after completion" }
            ].map((item, index) => (
              <div key={index} className="text-center relative">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#5500FF] to-[#8F7BFD] flex items-center justify-center mx-auto mb-4 text-white text-2xl font-bold">
                  {item.step}
                </div>
                <h3 className="font-semibold text-lg mb-2">{item.title}</h3>
                <p className="text-sm text-muted-foreground">{item.desc}</p>
                {index < 2 && (
                  <div className="hidden md:block absolute top-8 left-[60%] w-[80%] h-0.5 bg-gradient-to-r from-[#5500FF] to-transparent" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Banner */}
      <section className="container mx-auto px-4 pb-16">
        <div className="max-w-4xl mx-auto">
          <div className="bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] rounded-2xl p-8 md:p-12 text-white text-center">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Ready to Get Started?</h2>
            <p className="text-white/80 mb-8 max-w-xl mx-auto">
              Join hundreds of professional cleaners earning great pay with flexible schedules.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button 
                onClick={() => navigate("/cleaner/onboarding-landing")}
                size="lg"
                className="bg-white text-[#5500FF] hover:bg-white/90 h-12 px-8"
              >
                Apply Now
                <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
              <Button 
                onClick={() => navigate("/cleaner/auth")}
                size="lg"
                variant="outline"
                className="border-white text-white hover:bg-white/10 h-12 px-8"
              >
                Sign In
              </Button>
            </div>
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
              <a href="mailto:hello@novaracleaning.com" className="hover:text-[#5500FF]">
                Contact
              </a>
              <button onClick={() => navigate("/")} className="hover:text-[#5500FF]">
                Book a Cleaning
              </button>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
