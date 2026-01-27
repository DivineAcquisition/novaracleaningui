import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { 
  ArrowRight, 
  Crown, 
  CheckCircle, 
  Clock, 
  MapPin,
  Star,
  Shield,
  Sparkles,
  Users,
  Calendar,
  Heart,
  Gift,
  Home,
  Phone,
  ChevronDown,
  Play
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatPhoneNumber } from "@/lib/input-formatters";

const SERVICE_AREAS = [
  "Washington DC", "Bethesda", "Silver Spring", "Rockville", "Arlington",
  "Alexandria", "Fairfax", "Falls Church", "Tysons", "Chevy Chase"
];

const TESTIMONIALS = [
  {
    name: "Sarah M.",
    location: "Bethesda, MD",
    rating: 5,
    text: "Best cleaning service I've ever used! They were thorough, professional, and my home has never looked better.",
    avatar: "SM"
  },
  {
    name: "Michael R.",
    location: "Arlington, VA",
    rating: 5,
    text: "The membership is worth every penny. I love having a dedicated team that knows my home.",
    avatar: "MR"
  },
  {
    name: "Jennifer L.",
    location: "Washington, DC",
    rating: 5,
    text: "Finally, cleaners I can trust! They're always on time and do an amazing job every single visit.",
    avatar: "JL"
  }
];

const BOOKING_STEPS_DEMO = [
  { step: 1, title: "Enter ZIP Code", desc: "Check if we service your area", visual: "20814" },
  { step: 2, title: "Select Home Size", desc: "Choose your square footage", visual: "1,500-2,000 sq ft" },
  { step: 3, title: "Pick Your Service", desc: "Deep clean or membership", visual: "$189 Membership" },
  { step: 4, title: "Schedule Date", desc: "Choose your preferred time", visual: "Sat, Jan 25 • 9am" },
  { step: 5, title: "Secure Checkout", desc: "Pay securely with Stripe", visual: "💳 **** 4242" },
  { step: 6, title: "Confirmation", desc: "You're all set!", visual: "✓ Booked!" },
];

const MEMBERSHIP_PERKS = [
  { icon: Calendar, title: "Flexible Scheduling", desc: "Bi-weekly or monthly cleanings that fit your life" },
  { icon: Users, title: "Dedicated Team", desc: "Same trusted cleaners who know your preferences" },
  { icon: Gift, title: "Member Discounts", desc: "Up to 30% off every cleaning, forever" },
  { icon: Heart, title: "Priority Booking", desc: "First access to preferred time slots" },
  { icon: Shield, title: "48-Hour Guarantee", desc: "Not satisfied? We'll come back and re-clean free" },
  { icon: Sparkles, title: "Cancel Anytime", desc: "No long-term contracts or hidden fees" },
];

const WHY_NOVARA = [
  { icon: Shield, title: "Background Checked", desc: "Every cleaner is vetted and insured" },
  { icon: Star, title: "4.9 Star Rating", desc: "Hundreds of happy customers" },
  { icon: CheckCircle, title: "40-Point Checklist", desc: "Nothing gets missed" },
  { icon: Users, title: "Professional Teams", desc: "Trained & equipped for excellence" },
];

type FormMode = 'zip' | 'contact';

export default function SpecialOffer() {
  const navigate = useNavigate();
  const { updateBookingData } = useBooking();
  
  const [zipCode, setZipCode] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>('zip');
  const [cityState, setCityState] = useState("");
  const [isOutOfArea, setIsOutOfArea] = useState(false);
  
  // Contact form state
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleZipSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (zipCode.length !== 5) return;
    
    setIsValidating(true);
    
    const { data: coverage } = await supabase
      .from('service_coverage_zones')
      .select('city, state')
      .eq('zip_code', zipCode)
      .eq('is_active', true)
      .single();
    
    setIsValidating(false);
    
    if (coverage) {
      setCityState(`${coverage.city}, ${coverage.state}`);
      setFormMode('contact');
      setIsOutOfArea(false);
      updateBookingData({ zipCode });
    } else {
      setIsOutOfArea(true);
    }
  };

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName || !lastName || !email || !phone) return;
    
    setIsSubmitting(true);
    
    const formattedPhone = phone.replace(/\D/g, '');
    
    // Update booking data with first-time discount flag
    updateBookingData({
      firstName,
      lastName,
      email,
      phone: formattedPhone,
      promoCode: 'FIRST25', // Apply $25 off automatically
    });
    
    // Track lead
    supabase.functions.invoke('send-lead-capture-webhook', {
      body: {
        firstName,
        lastName,
        email,
        phone: formattedPhone,
        zipCode,
        city: cityState.split(', ')[0] || '',
        state: cityState.split(', ')[1] || '',
        source: 'Special Offer Landing',
        landingPage: '/special/offer',
        promoApplied: 'FIRST25',
      }
    }).catch(err => console.error('Lead webhook error:', err));
    
    // Navigate to the booking flow
    navigate("/book/sqft");
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhoneNumber(e.target.value);
    setPhone(formatted);
  };

  const scrollToBooking = () => {
    document.getElementById('booking-section')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Sticky Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-white/90 backdrop-blur-xl border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/novara-logo.png" alt="Novara" className="h-9 w-9 rounded-xl" />
            <span className="font-bold text-xl text-slate-900">Novara</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="tel:+14697001034" className="hidden sm:flex items-center gap-2 text-sm text-slate-600 hover:text-primary">
              <Phone className="w-4 h-4" />
              (469) 700-1034
            </a>
            <Button onClick={scrollToBooking} className="bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25">
              Get $25 Off
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative pt-24 pb-16 overflow-hidden">
        {/* Background */}
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-white to-white" />
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-primary/10 rounded-full blur-3xl opacity-40" />
        
        <div className="relative max-w-6xl mx-auto px-4">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Left - Copy */}
            <div className="space-y-8">
              <Badge className="bg-green-100 text-green-700 border-green-200 px-4 py-2">
                <Gift className="w-4 h-4 mr-2" />
                Limited Time: $25 Off Your First Clean
              </Badge>
              
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-slate-900 leading-tight">
                Premium Home Cleaning
                <span className="block text-primary">Starting at $189</span>
              </h1>
              
              <p className="text-xl text-slate-600 leading-relaxed">
                Join thousands of DMV families who trust Novara for spotless homes. 
                Professional teams, 40-point checklists, and a satisfaction guarantee.
              </p>
              
              {/* Trust Badges */}
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <div className="flex -space-x-1">
                    {[1,2,3,4,5].map(i => (
                      <Star key={i} className="w-5 h-5 text-yellow-400 fill-yellow-400" />
                    ))}
                  </div>
                  <span className="text-sm font-medium text-slate-700">4.9 Rating</span>
                </div>
                <Badge variant="outline" className="bg-white">
                  <Shield className="w-3 h-3 mr-1" />
                  Insured & Bonded
                </Badge>
                <Badge variant="outline" className="bg-white">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  Background Checked
                </Badge>
              </div>
              
              <div className="flex flex-col sm:flex-row gap-4">
                <Button 
                  size="lg" 
                  onClick={scrollToBooking}
                  className="h-14 px-8 text-lg bg-primary hover:bg-primary/90 shadow-xl shadow-primary/30"
                >
                  Claim Your $25 Discount
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
                <Button 
                  size="lg" 
                  variant="outline"
                  className="h-14 px-8 text-lg"
                  onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })}
                >
                  See How It Works
                </Button>
              </div>
            </div>

            {/* Right - Booking Card */}
            <div id="booking-section" className="scroll-mt-24">
              <Card className="border-2 border-primary/30 shadow-2xl shadow-primary/10 overflow-hidden">
                <div className="bg-gradient-to-r from-primary to-primary/80 p-4 text-white text-center">
                  <p className="font-semibold text-lg">🎉 First-Time Customer Special</p>
                  <p className="text-sm text-white/90">Book today and save $25 on your first cleaning</p>
                </div>
                <CardContent className="p-6 space-y-6">
                  {formMode === 'zip' ? (
                    <form onSubmit={handleZipSubmit} className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Enter Your ZIP Code</label>
                        <Input 
                          type="text" 
                          inputMode="numeric"
                          maxLength={5}
                          placeholder="e.g., 75034"
                          value={zipCode}
                          onChange={e => {
                            setZipCode(e.target.value.replace(/\D/g, ''));
                            setIsOutOfArea(false);
                          }}
                          className="h-14 text-lg text-center"
                          autoFocus
                        />
                        {isOutOfArea && (
                          <p className="text-sm text-red-500">
                            Sorry, we don't serve that area yet. Check back soon!
                          </p>
                        )}
                      </div>
                      <Button 
                        type="submit"
                        size="lg"
                        disabled={zipCode.length !== 5 || isValidating}
                        className="w-full h-14 text-lg bg-primary hover:bg-primary/90"
                      >
                        {isValidating ? "Checking..." : "Check Availability"}
                        <ArrowRight className="w-5 h-5 ml-2" />
                      </Button>
                    </form>
                  ) : (
                    <form onSubmit={handleContactSubmit} className="space-y-4">
                      <div className="flex items-center gap-2 p-3 bg-green-50 rounded-lg border border-green-200">
                        <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
                        <div>
                          <p className="font-medium text-green-800">Great! We service {cityState}</p>
                          <p className="text-sm text-green-600">Your $25 discount will be applied at checkout</p>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">First Name</label>
                          <Input
                            placeholder="John"
                            value={firstName}
                            onChange={e => setFirstName(e.target.value)}
                            className="h-12"
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Last Name</label>
                          <Input
                            placeholder="Smith"
                            value={lastName}
                            onChange={e => setLastName(e.target.value)}
                            className="h-12"
                            required
                          />
                        </div>
                      </div>
                      
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Email</label>
                        <Input
                          type="email"
                          placeholder="john@example.com"
                          value={email}
                          onChange={e => setEmail(e.target.value)}
                          className="h-12"
                          required
                        />
                      </div>
                      
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Phone</label>
                        <Input
                          type="tel"
                          placeholder="(555) 123-4567"
                          value={phone}
                          onChange={handlePhoneChange}
                          className="h-12"
                          required
                        />
                      </div>
                      
                      <Button
                        type="submit"
                        size="lg"
                        disabled={!firstName || !lastName || !email || phone.replace(/\D/g, '').length !== 10 || isSubmitting}
                        className="w-full h-14 text-lg bg-primary hover:bg-primary/90"
                      >
                        {isSubmitting ? "Processing..." : "Continue & Get $25 Off"}
                        <ArrowRight className="w-5 h-5 ml-2" />
                      </Button>
                      
                      <button
                        type="button"
                        onClick={() => {
                          setFormMode('zip');
                          setZipCode('');
                        }}
                        className="text-sm text-primary hover:underline w-full text-center"
                      >
                        ← Change ZIP code
                      </button>
                    </form>
                  )}
                  
                  <div className="pt-4 border-t text-center text-sm text-slate-500">
                    <p className="flex items-center justify-center gap-2">
                      <Shield className="w-4 h-4" />
                      100% Satisfaction Guaranteed
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* Why Novara */}
      <section className="py-20 bg-slate-50">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center mb-12">
            <Badge className="mb-4 bg-primary/10 text-primary border-0">Why Choose Us</Badge>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">
              Cleaning You Can Trust
            </h2>
            <p className="mt-4 text-lg text-slate-600 max-w-2xl mx-auto">
              We're not your average cleaning service. Every detail matters.
            </p>
          </div>
          
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {WHY_NOVARA.map((item, idx) => (
              <Card key={idx} className="border-0 shadow-lg shadow-slate-200/50 hover:shadow-xl transition-shadow">
                <CardContent className="p-6 text-center">
                  <div className="w-14 h-14 mx-auto rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                    <item.icon className="w-7 h-7 text-primary" />
                  </div>
                  <h3 className="font-semibold text-lg text-slate-900 mb-2">{item.title}</h3>
                  <p className="text-slate-600 text-sm">{item.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Membership Benefits */}
      <section className="py-20">
        <div className="max-w-6xl mx-auto px-4">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <Badge className="mb-4 bg-amber-100 text-amber-700 border-amber-200">
                <Crown className="w-4 h-4 mr-2" />
                Membership
              </Badge>
              <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-6">
                Join the Novara Membership
              </h2>
              <p className="text-lg text-slate-600 mb-8">
                Get premium cleaning on a schedule that works for you. 
                Members save up to 30% on every cleaning and enjoy exclusive perks.
              </p>
              
              <div className="bg-gradient-to-br from-primary/5 to-primary/10 rounded-2xl p-6 border border-primary/20 mb-8">
                <div className="flex items-baseline gap-2 mb-2">
                  <span className="text-4xl font-bold text-primary">$189</span>
                  <span className="text-slate-600">/month</span>
                </div>
                <p className="text-slate-600">Includes your first deep clean + ongoing service</p>
              </div>
              
              <Button size="lg" onClick={scrollToBooking} className="bg-primary hover:bg-primary/90">
                Start Your Membership
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </div>
            
            <div className="grid sm:grid-cols-2 gap-4">
              {MEMBERSHIP_PERKS.map((perk, idx) => (
                <div key={idx} className="p-4 rounded-xl bg-white border border-slate-200 hover:border-primary/30 hover:shadow-md transition-all">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <perk.icon className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-slate-900">{perk.title}</p>
                      <p className="text-sm text-slate-500">{perk.desc}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-20 bg-slate-900 text-white">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center mb-12">
            <Badge className="mb-4 bg-white/10 text-white border-0">How It Works</Badge>
            <h2 className="text-3xl sm:text-4xl font-bold">
              Booking is Easy
            </h2>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { step: "1", title: "Tell Us About Your Home", desc: "Enter your ZIP, home size, and preferences" },
              { step: "2", title: "Pick Your Schedule", desc: "Choose a date and time that works for you" },
              { step: "3", title: "Relax & Enjoy", desc: "We'll handle the rest. Welcome home to spotless!" },
            ].map((item, idx) => (
              <div key={idx} className="text-center">
                <div className="w-14 h-14 mx-auto rounded-full bg-primary text-white font-bold text-xl flex items-center justify-center mb-4">
                  {item.step}
                </div>
                <h3 className="text-xl font-semibold mb-2">{item.title}</h3>
                <p className="text-slate-400">{item.desc}</p>
              </div>
            ))}
          </div>
          
          <div className="text-center mt-12">
            <Button size="lg" onClick={scrollToBooking} className="bg-white text-slate-900 hover:bg-slate-100">
              Book Your Clean Now
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-20">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center mb-12">
            <Badge className="mb-4 bg-primary/10 text-primary border-0">Testimonials</Badge>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">
              What Our Customers Say
            </h2>
          </div>
          
          <div className="grid md:grid-cols-3 gap-6">
            {TESTIMONIALS.map((t, idx) => (
              <Card key={idx} className="border-0 shadow-lg">
                <CardContent className="p-6">
                  <div className="flex items-center gap-1 mb-4">
                    {[...Array(t.rating)].map((_, i) => (
                      <Star key={i} className="w-5 h-5 text-yellow-400 fill-yellow-400" />
                    ))}
                  </div>
                  <p className="text-slate-600 mb-6 italic">"{t.text}"</p>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
                      {t.avatar}
                    </div>
                    <div>
                      <p className="font-medium text-slate-900">{t.name}</p>
                      <p className="text-sm text-slate-500">{t.location}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Live Demo - Booking Process */}
      <section className="py-20 bg-white overflow-hidden">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center mb-12">
            <Badge className="mb-4 bg-primary/10 text-primary border-0">
              <Play className="w-4 h-4 mr-2" />
              See How Easy It Is
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">
              Book in Under 2 Minutes
            </h2>
            <p className="mt-4 text-lg text-slate-600 max-w-2xl mx-auto">
              Our streamlined booking process makes scheduling your cleaning effortless
            </p>
          </div>
          
          {/* Desktop Visual Demo */}
          <div className="hidden md:block relative">
            <div className="flex items-center justify-between gap-2">
              {BOOKING_STEPS_DEMO.map((item, idx) => (
                <div key={idx} className="flex-1 relative">
                  {/* Connector Line */}
                  {idx < BOOKING_STEPS_DEMO.length - 1 && (
                    <div className="absolute top-8 left-1/2 w-full h-0.5 bg-gradient-to-r from-primary to-primary/30 z-0" />
                  )}
                  
                  {/* Step Card */}
                  <div className="relative z-10 flex flex-col items-center">
                    <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-white font-bold text-xl shadow-lg ${
                      idx === BOOKING_STEPS_DEMO.length - 1 
                        ? 'bg-green-500 shadow-green-500/30' 
                        : 'bg-primary shadow-primary/30'
                    }`}>
                      {item.step}
                    </div>
                    <div className="mt-4 text-center">
                      <p className="font-semibold text-slate-900 text-sm">{item.title}</p>
                      <p className="text-xs text-slate-500 mt-1">{item.desc}</p>
                    </div>
                    {/* Visual Preview */}
                    <div className="mt-3 px-3 py-2 bg-slate-100 rounded-lg text-xs font-mono text-slate-600">
                      {item.visual}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          
          {/* Mobile Visual Demo */}
          <div className="md:hidden space-y-4">
            {BOOKING_STEPS_DEMO.map((item, idx) => (
              <div key={idx} className="flex items-start gap-4">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold shrink-0 ${
                  idx === BOOKING_STEPS_DEMO.length - 1 
                    ? 'bg-green-500' 
                    : 'bg-primary'
                }`}>
                  {item.step}
                </div>
                <div className="flex-1 pb-4 border-b border-slate-100">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-slate-900">{item.title}</p>
                      <p className="text-sm text-slate-500">{item.desc}</p>
                    </div>
                    <div className="px-3 py-1.5 bg-slate-100 rounded-lg text-xs font-mono text-slate-600">
                      {item.visual}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          
          <div className="text-center mt-12">
            <Button size="lg" onClick={scrollToBooking} className="bg-primary hover:bg-primary/90">
              Start Booking Now
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </div>
        </div>
      </section>

      {/* Service Areas */}
      <section className="py-20 bg-slate-50">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center mb-12">
            <Badge className="mb-4 bg-primary/10 text-primary border-0">
              <MapPin className="w-4 h-4 mr-2" />
              Service Areas
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">
              Serving the DMV Area
            </h2>
            <p className="mt-4 text-lg text-slate-600">
              Premium cleaning services across DC, Maryland & Virginia
            </p>
          </div>
          
          <div className="flex flex-wrap justify-center gap-3">
            {SERVICE_AREAS.map((area, idx) => (
              <Badge key={idx} variant="outline" className="px-4 py-2 text-base bg-white">
                {area}
              </Badge>
            ))}
          </div>
          
          <p className="text-center mt-6 text-slate-500">
            And many more! Enter your ZIP code above to check availability.
          </p>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-20 bg-gradient-to-r from-primary to-primary/80 text-white">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold mb-6">
            Ready for a Spotless Home?
          </h2>
          <p className="text-xl text-white/90 mb-8">
            Book today and save $25 on your first cleaning. No contracts, no hassle.
          </p>
          <Button 
            size="lg" 
            onClick={scrollToBooking}
            className="h-14 px-10 text-lg bg-white text-primary hover:bg-slate-100"
          >
            Claim Your $25 Discount Now
            <ArrowRight className="w-5 h-5 ml-2" />
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 bg-slate-900 text-white">
        <div className="max-w-6xl mx-auto px-4">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <img src="/novara-logo.png" alt="Novara" className="h-10 w-10 rounded-xl" />
                <span className="font-bold text-xl">Novara</span>
              </div>
              <p className="text-slate-400 text-sm">
                Premium residential cleaning services for the DC, Maryland & Virginia area.
              </p>
            </div>
            
            <div>
              <h4 className="font-semibold mb-4">Quick Links</h4>
              <ul className="space-y-2 text-sm text-slate-400">
                <li><a href="https://novaracleaning.com/about" className="hover:text-white">About Us</a></li>
                <li><a href="https://novaracleaning.com/services" className="hover:text-white">Services</a></li>
                <li><a href="https://novaracleaning.com/pricing" className="hover:text-white">Pricing</a></li>
                <li><a href="https://novaracleaning.com/contact" className="hover:text-white">Contact</a></li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-semibold mb-4">Legal</h4>
              <ul className="space-y-2 text-sm text-slate-400">
                <li><a href="https://novaracleaning.com/terms" className="hover:text-white">Terms of Service</a></li>
                <li><a href="https://novaracleaning.com/privacy" className="hover:text-white">Privacy Policy</a></li>
                <li><a href="https://novaracleaning.com/cancellation" className="hover:text-white">Cancellation Policy</a></li>
                <li><a href="https://novaracleaning.com/refunds" className="hover:text-white">Refund Policy</a></li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-semibold mb-4">Contact</h4>
              <ul className="space-y-2 text-sm text-slate-400">
                <li className="flex items-center gap-2">
                  <Phone className="w-4 h-4" />
                  (469) 700-1034
                </li>
                <li className="flex items-center gap-2">
                  <MapPin className="w-4 h-4" />
                  Washington DC Metro Area
                </li>
              </ul>
            </div>
          </div>
          
          <div className="pt-8 border-t border-slate-800 text-center text-sm text-slate-500">
            <p>© {new Date().getFullYear()} Novara Cleaning. All rights reserved.</p>
            <p className="mt-2">
              * $25 discount applies to first-time customers only. Cannot be combined with other offers.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
