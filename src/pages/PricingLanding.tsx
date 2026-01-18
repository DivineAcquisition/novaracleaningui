import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CheckCircle2,
  Sparkles,
  Calendar,
  Gift,
  Zap,
  Crown,
  ArrowRight,
  Star,
  Shield,
  Clock,
  Users,
  Home,
  Percent,
  Check,
  X,
  ChevronRight,
  Play,
} from "lucide-react";
import logo from "@/assets/logo.png";

// Pricing data
const ONE_TIME_PRICING = [
  { size: "XS", sqft: "0-999", bedrooms: "Studio-1", hours: 2, price: 150 },
  { size: "S", sqft: "1,000-1,500", bedrooms: "1-2", hours: 3, price: 225 },
  { size: "M", sqft: "1,501-2,000", bedrooms: "2-3", hours: 4, price: 300 },
  { size: "L", sqft: "2,001-2,500", bedrooms: "3-4", hours: 5, price: 375 },
  { size: "XL", sqft: "2,501-3,000", bedrooms: "4-5", hours: 6, price: 450 },
  { size: "2XL", sqft: "3,001-3,500", bedrooms: "5+", hours: 7, price: 525 },
];

const MEMBERSHIP_PLANS = [
  {
    id: "monthly",
    name: "Monthly",
    subtitle: "Perfect for occasional cleaning",
    price: 189,
    credits: 1,
    discount: 20,
    icon: Calendar,
    color: "from-blue-500 to-cyan-500",
    bgColor: "bg-blue-50",
    features: [
      "1 standard cleaning credit/month",
      "20% off all add-ons",
      "Flexible scheduling",
      "Cancel anytime",
      "Priority support",
    ],
    notIncluded: ["Dedicated cleaner", "VIP scheduling"],
  },
  {
    id: "biweekly",
    name: "Bi-Weekly",
    subtitle: "Most popular for families",
    price: 289,
    credits: 2,
    discount: 25,
    icon: Gift,
    color: "from-violet-500 to-purple-500",
    bgColor: "bg-violet-50",
    popular: true,
    features: [
      "2 standard cleaning credits/month",
      "25% off all add-ons",
      "Early booking access",
      "Free rescheduling",
      "Priority support",
    ],
    notIncluded: ["Dedicated cleaner"],
  },
  {
    id: "weekly",
    name: "Weekly",
    subtitle: "Ultimate convenience",
    price: 389,
    credits: 4,
    discount: 30,
    icon: Crown,
    color: "from-amber-500 to-orange-500",
    bgColor: "bg-amber-50",
    features: [
      "4 standard cleaning credits/month",
      "30% off all add-ons",
      "VIP priority scheduling",
      "Free rescheduling",
      "Dedicated cleaning team",
      "VIP support line",
    ],
    notIncluded: [],
  },
];

const ADD_ONS = [
  { name: "Inside Fridge", price: 35 },
  { name: "Inside Oven", price: 35 },
  { name: "Interior Windows", price: 45 },
  { name: "Laundry (1 load)", price: 25 },
  { name: "Garage Sweep", price: 40 },
  { name: "Light Organization", price: 50 },
];

const TESTIMONIALS = [
  {
    name: "Sarah M.",
    location: "Dallas, TX",
    rating: 5,
    text: "The bi-weekly membership has been a game-changer for our busy family. Worth every penny!",
    avatar: "SM",
  },
  {
    name: "James K.",
    location: "Plano, TX",
    rating: 5,
    text: "Professional, reliable, and the pricing is transparent. No surprises, just a clean home.",
    avatar: "JK",
  },
  {
    name: "Emily R.",
    location: "Frisco, TX",
    rating: 5,
    text: "I love that my credits never expire. The flexibility makes this the best cleaning service I've used.",
    avatar: "ER",
  },
];

const FAQ = [
  {
    q: "How do cleaning credits work?",
    a: "Each credit covers one standard cleaning for your home size. Credits are added monthly and never expire as long as you're subscribed.",
  },
  {
    q: "Can I use my credit for deep cleaning?",
    a: "Credits apply to standard cleanings. Deep cleans and move-in/out services are available at your member discount rate.",
  },
  {
    q: "What's included in a standard cleaning?",
    a: "Dusting, vacuuming, mopping, bathroom sanitization, kitchen cleaning, trash removal, and making beds.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes! There are no long-term contracts. Cancel anytime with no cancellation fees.",
  },
];

export default function PricingLanding() {
  const navigate = useNavigate();
  const [billingCycle, setBillingCycle] = useState<"one-time" | "membership">("membership");
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);

  const handleGetStarted = () => {
    navigate("/book/zip");
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-lg border-b">
        <div className="container max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <img src={logo} alt="Novara" className="w-8 h-8 rounded-lg" />
              <span className="text-xl font-bold">NovaraCleaning</span>
            </div>
            <div className="hidden md:flex items-center gap-6">
              <a href="#pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Pricing
              </a>
              <a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Features
              </a>
              <a href="#faq" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                FAQ
              </a>
              <Button onClick={handleGetStarted} className="bg-gradient-to-r from-primary to-violet-600">
                Get Started
                <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
            </div>
            <Button onClick={handleGetStarted} className="md:hidden" size="sm">
              Get Started
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-violet-50 via-white to-cyan-50" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-violet-100/40 via-transparent to-transparent" />
        
        <div className="container max-w-7xl mx-auto px-4 py-20 md:py-28 relative">
          <div className="text-center max-w-4xl mx-auto space-y-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
            >
              <Badge className="bg-gradient-to-r from-violet-100 to-cyan-100 text-violet-700 border-violet-200 px-4 py-1.5">
                <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                Trusted by 2,000+ Dallas homeowners
              </Badge>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight"
            >
              Simple, Transparent{" "}
              <span className="bg-gradient-to-r from-violet-600 to-cyan-600 bg-clip-text text-transparent">
                Pricing
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto"
            >
              No hidden fees. No surprises. Just professional cleaning at prices that make sense.
              Choose one-time or subscribe and save up to 30%.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4"
            >
              <Button 
                size="lg" 
                onClick={handleGetStarted}
                className="bg-gradient-to-r from-violet-600 to-cyan-600 hover:from-violet-700 hover:to-cyan-700 text-lg h-14 px-8 shadow-lg shadow-violet-500/25"
              >
                Get Your Quote
                <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
              <Button variant="outline" size="lg" className="h-14 px-8">
                <Play className="mr-2 w-4 h-4" />
                See How It Works
              </Button>
            </motion.div>

            {/* Trust badges */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.4 }}
              className="flex flex-wrap items-center justify-center gap-6 pt-8 text-sm text-muted-foreground"
            >
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-green-500" />
                <span>Insured & Bonded</span>
              </div>
              <div className="flex items-center gap-2">
                <Star className="w-4 h-4 text-yellow-500" />
                <span>4.9/5 Rating</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-500" />
                <span>Same-Day Booking</span>
              </div>
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-violet-500" />
                <span>Background-Checked Team</span>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-20 bg-slate-50/50">
        <div className="container max-w-7xl mx-auto px-4">
          {/* Pricing Toggle */}
          <div className="text-center mb-12">
            <Tabs value={billingCycle} onValueChange={(v) => setBillingCycle(v as any)} className="inline-flex">
              <TabsList className="bg-white border shadow-sm h-12 p-1">
                <TabsTrigger value="one-time" className="px-6 data-[state=active]:bg-slate-900 data-[state=active]:text-white">
                  One-Time
                </TabsTrigger>
                <TabsTrigger value="membership" className="px-6 data-[state=active]:bg-slate-900 data-[state=active]:text-white">
                  Membership
                  <Badge className="ml-2 bg-green-500 text-white text-[10px]">Save 30%</Badge>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {billingCycle === "one-time" ? (
            /* One-Time Pricing Table */
            <div className="max-w-4xl mx-auto">
              <Card className="overflow-hidden border-0 shadow-xl">
                <CardHeader className="bg-gradient-to-r from-slate-900 to-slate-800 text-white">
                  <CardTitle className="text-center">
                    <span className="text-2xl font-bold">Standard Cleaning Prices</span>
                    <p className="text-sm font-normal text-slate-300 mt-2">
                      Based on your home size • 2-person cleaning team
                    </p>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-slate-50 border-b">
                        <tr>
                          <th className="text-left py-4 px-6 font-semibold">Size</th>
                          <th className="text-left py-4 px-6 font-semibold">Square Feet</th>
                          <th className="text-left py-4 px-6 font-semibold">Bedrooms</th>
                          <th className="text-center py-4 px-6 font-semibold">Est. Hours</th>
                          <th className="text-right py-4 px-6 font-semibold">Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ONE_TIME_PRICING.map((row, i) => (
                          <tr key={row.size} className={i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                            <td className="py-4 px-6">
                              <Badge variant="outline" className="font-mono">{row.size}</Badge>
                            </td>
                            <td className="py-4 px-6 text-muted-foreground">{row.sqft} sq ft</td>
                            <td className="py-4 px-6 text-muted-foreground">{row.bedrooms} bed</td>
                            <td className="py-4 px-6 text-center text-muted-foreground">{row.hours} hrs</td>
                            <td className="py-4 px-6 text-right">
                              <span className="text-xl font-bold">${row.price}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="p-6 bg-gradient-to-r from-violet-50 to-cyan-50 border-t">
                    <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                      <div className="text-center md:text-left">
                        <p className="font-semibold">Ready to book?</p>
                        <p className="text-sm text-muted-foreground">Enter your ZIP to check availability</p>
                      </div>
                      <Button onClick={handleGetStarted} size="lg" className="bg-slate-900 hover:bg-slate-800">
                        Book Now
                        <ArrowRight className="ml-2 w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Service Upgrades */}
              <div className="mt-8 grid md:grid-cols-2 gap-4">
                <Card className="p-6">
                  <h3 className="font-semibold mb-2">Deep Clean</h3>
                  <p className="text-sm text-muted-foreground mb-3">
                    Thorough top-to-bottom cleaning including baseboards, light fixtures, and inside cabinets.
                  </p>
                  <Badge variant="secondary">+$50 to base price</Badge>
                </Card>
                <Card className="p-6">
                  <h3 className="font-semibold mb-2">Move In/Out</h3>
                  <p className="text-sm text-muted-foreground mb-3">
                    Complete clean including inside all appliances, cabinets, and garage sweep.
                  </p>
                  <Badge variant="secondary">+$120 to base price</Badge>
                </Card>
              </div>
            </div>
          ) : (
            /* Membership Plans */
            <div className="grid md:grid-cols-3 gap-6 lg:gap-8 max-w-6xl mx-auto">
              {MEMBERSHIP_PLANS.map((plan, index) => {
                const Icon = plan.icon;
                return (
                  <motion.div
                    key={plan.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: index * 0.1 }}
                  >
                    <Card
                      className={`relative h-full transition-all hover:shadow-2xl ${
                        plan.popular
                          ? "border-2 border-violet-500 shadow-xl shadow-violet-500/10 scale-105"
                          : "border hover:border-slate-300"
                      }`}
                    >
                      {plan.popular && (
                        <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                          <Badge className="bg-gradient-to-r from-violet-600 to-purple-600 text-white px-4 py-1 shadow-lg">
                            <Star className="w-3 h-3 mr-1" />
                            Most Popular
                          </Badge>
                        </div>
                      )}

                      <CardHeader className="text-center pt-8 pb-4">
                        <div className={`mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br ${plan.color} flex items-center justify-center shadow-lg mb-4`}>
                          <Icon className="w-7 h-7 text-white" />
                        </div>
                        <CardTitle className="text-xl">{plan.name}</CardTitle>
                        <p className="text-sm text-muted-foreground">{plan.subtitle}</p>

                        <div className="pt-4">
                          <div className="flex items-baseline justify-center gap-1">
                            <span className="text-5xl font-bold">${plan.price}</span>
                            <span className="text-muted-foreground">/mo</span>
                          </div>
                          <Badge className={`mt-3 ${plan.bgColor} text-slate-700 border-0`}>
                            <Zap className="w-3 h-3 mr-1" />
                            {plan.credits} {plan.credits === 1 ? "Credit" : "Credits"}/Month
                          </Badge>
                        </div>
                      </CardHeader>

                      <CardContent className="pt-4">
                        <div className="space-y-3">
                          {plan.features.map((feature, i) => (
                            <div key={i} className="flex items-start gap-3">
                              <Check className="w-5 h-5 text-green-500 flex-shrink-0" />
                              <span className="text-sm">{feature}</span>
                            </div>
                          ))}
                          {plan.notIncluded.map((feature, i) => (
                            <div key={i} className="flex items-start gap-3 opacity-40">
                              <X className="w-5 h-5 flex-shrink-0" />
                              <span className="text-sm">{feature}</span>
                            </div>
                          ))}
                        </div>

                        <Button
                          onClick={handleGetStarted}
                          className={`w-full mt-6 h-12 ${
                            plan.popular
                              ? "bg-gradient-to-r from-violet-600 to-purple-600 shadow-lg"
                              : ""
                          }`}
                          variant={plan.popular ? "default" : "outline"}
                        >
                          Get Started
                          <ChevronRight className="ml-1 w-4 h-4" />
                        </Button>

                        <p className="text-xs text-center text-muted-foreground mt-4">
                          Cancel anytime • No commitment
                        </p>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </div>
          )}

          {/* Add-ons */}
          <div className="mt-16 text-center">
            <h3 className="text-2xl font-bold mb-2">Customize with Add-Ons</h3>
            <p className="text-muted-foreground mb-8">
              Members save up to 30% on all add-ons
            </p>
            <div className="flex flex-wrap justify-center gap-3 max-w-3xl mx-auto">
              {ADD_ONS.map((addon) => (
                <Badge
                  key={addon.name}
                  variant="outline"
                  className="px-4 py-2 text-sm bg-white"
                >
                  {addon.name}
                  <span className="ml-2 text-muted-foreground">${addon.price}</span>
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20">
        <div className="container max-w-7xl mx-auto px-4">
          <div className="text-center mb-12">
            <Badge variant="outline" className="mb-4">Why Novara?</Badge>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Professional Cleaning, Simplified
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              We've streamlined every aspect of home cleaning so you can focus on what matters most.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                icon: Home,
                title: "Flat-Rate Pricing",
                description: "Know exactly what you'll pay. No hourly surprises.",
                color: "bg-blue-100 text-blue-600",
              },
              {
                icon: Users,
                title: "Vetted Professionals",
                description: "Background-checked, trained, and insured cleaners.",
                color: "bg-green-100 text-green-600",
              },
              {
                icon: Clock,
                title: "Flexible Scheduling",
                description: "Book online 24/7. Reschedule anytime for free.",
                color: "bg-violet-100 text-violet-600",
              },
              {
                icon: Shield,
                title: "Satisfaction Guaranteed",
                description: "Not happy? We'll re-clean for free or refund you.",
                color: "bg-amber-100 text-amber-600",
              },
            ].map((feature, i) => (
              <Card key={i} className="text-center p-6 border-0 shadow-sm hover:shadow-md transition-shadow">
                <div className={`mx-auto w-12 h-12 rounded-xl ${feature.color} flex items-center justify-center mb-4`}>
                  <feature.icon className="w-6 h-6" />
                </div>
                <h3 className="font-semibold mb-2">{feature.title}</h3>
                <p className="text-sm text-muted-foreground">{feature.description}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-20 bg-slate-50">
        <div className="container max-w-7xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Loved by Dallas Homeowners</h2>
            <div className="flex items-center justify-center gap-1 text-yellow-500">
              {[...Array(5)].map((_, i) => (
                <Star key={i} className="w-5 h-5 fill-current" />
              ))}
              <span className="ml-2 text-slate-600 font-medium">4.9/5 from 500+ reviews</span>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {TESTIMONIALS.map((t, i) => (
              <Card key={i} className="p-6">
                <div className="flex items-center gap-1 text-yellow-500 mb-4">
                  {[...Array(t.rating)].map((_, j) => (
                    <Star key={j} className="w-4 h-4 fill-current" />
                  ))}
                </div>
                <p className="text-muted-foreground mb-4">"{t.text}"</p>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center text-white font-semibold text-sm">
                    {t.avatar}
                  </div>
                  <div>
                    <p className="font-semibold text-sm">{t.name}</p>
                    <p className="text-xs text-muted-foreground">{t.location}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-20">
        <div className="container max-w-3xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Frequently Asked Questions</h2>
          </div>

          <div className="space-y-4">
            {FAQ.map((item, i) => (
              <Card
                key={i}
                className={`cursor-pointer transition-all ${expandedFaq === i ? "shadow-md" : ""}`}
                onClick={() => setExpandedFaq(expandedFaq === i ? null : i)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">{item.q}</h3>
                    <ChevronRight
                      className={`w-5 h-5 text-muted-foreground transition-transform ${
                        expandedFaq === i ? "rotate-90" : ""
                      }`}
                    />
                  </div>
                  {expandedFaq === i && (
                    <motion.p
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      className="text-muted-foreground mt-3 text-sm"
                    >
                      {item.a}
                    </motion.p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-gradient-to-r from-slate-900 to-slate-800 text-white">
        <div className="container max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Ready for a Cleaner Home?
          </h2>
          <p className="text-slate-300 mb-8 text-lg">
            Join 2,000+ Dallas homeowners who trust Novara for their cleaning needs.
          </p>
          <Button
            size="lg"
            onClick={handleGetStarted}
            className="bg-white text-slate-900 hover:bg-slate-100 h-14 px-8 text-lg"
          >
            Get Your Free Quote
            <ArrowRight className="ml-2 w-5 h-5" />
          </Button>
          <p className="text-sm text-slate-400 mt-4">
            No credit card required • Takes less than 2 minutes
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t">
        <div className="container max-w-7xl mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <img src={logo} alt="Novara" className="w-6 h-6 rounded" />
              <span className="font-semibold">NovaraCleaning</span>
            </div>
            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <a href="https://novaracleaning.com/privacy" className="hover:text-foreground">
                Privacy Policy
              </a>
              <a href="https://novaracleaning.com/terms" className="hover:text-foreground">
                Terms of Service
              </a>
              <a href="mailto:hello@novaracleaning.com" className="hover:text-foreground">
                Contact
              </a>
            </div>
            <p className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} NovaraCleaning. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
