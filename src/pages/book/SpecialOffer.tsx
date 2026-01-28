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
  MapPin,
  Star,
  Shield,
  Sparkles,
  Users,
  Calendar,
  Heart,
  Gift,
  Phone,
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
    text: "Best cleaning service I've ever used! Thorough and professional.",
    avatar: "SM"
  },
  {
    name: "Michael R.",
    location: "Arlington, VA",
    rating: 5,
    text: "The membership is worth every penny. Love my dedicated team!",
    avatar: "MR"
  },
  {
    name: "Jennifer L.",
    location: "Washington, DC",
    rating: 5,
    text: "Finally, cleaners I can trust! Always on time and amazing work.",
    avatar: "JL"
  }
];

const BOOKING_STEPS_DEMO = [
  { step: 1, title: "ZIP Code", visual: "20814" },
  { step: 2, title: "Home Size", visual: "2,000 sqft" },
  { step: 3, title: "Service", visual: "$189/mo" },
  { step: 4, title: "Schedule", visual: "Jan 25" },
  { step: 5, title: "Payment", visual: "•••• 4242" },
  { step: 6, title: "Done!", visual: "✓" },
];

const MEMBERSHIP_PERKS = [
  { icon: Calendar, title: "Flexible Schedule", desc: "Bi-weekly or monthly" },
  { icon: Users, title: "Dedicated Team", desc: "Same trusted cleaners" },
  { icon: Gift, title: "30% Savings", desc: "On every cleaning" },
  { icon: Heart, title: "Priority Access", desc: "Best time slots" },
  { icon: Shield, title: "Guarantee", desc: "48-hour re-clean" },
  { icon: Sparkles, title: "No Contracts", desc: "Cancel anytime" },
];

const WHY_NOVARA = [
  { icon: Shield, title: "Background Checked", desc: "Vetted & insured" },
  { icon: Star, title: "4.9 Rating", desc: "500+ reviews" },
  { icon: CheckCircle, title: "40-Point Check", desc: "Nothing missed" },
  { icon: Users, title: "Pro Teams", desc: "Trained experts" },
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
    
    updateBookingData({
      firstName,
      lastName,
      email,
      phone: formattedPhone,
      promoCode: 'FIRST25',
    });
    
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
      {/* Sticky Header - Compact */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-xl border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-3 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/novara-logo.png" alt="Novara" className="h-8 w-8 rounded-lg" />
            <span className="font-bold text-lg text-slate-900 font-jakarta">Novara</span>
          </div>
          <Button onClick={scrollToBooking} size="sm" className="bg-primary hover:bg-primary/90 shadow-md text-xs px-3 h-9">
            Get $25 Off
            <ArrowRight className="w-3 h-3 ml-1" />
          </Button>
        </div>
      </header>

      {/* Hero Section - Mobile Optimized */}
      <section className="relative pt-16 pb-8 sm:pt-20 sm:pb-12 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-white to-white" />
        <div className="absolute top-10 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-primary/10 rounded-full blur-3xl opacity-30" />
        
        <div className="relative max-w-6xl mx-auto px-3 sm:px-4">
          <div className="grid lg:grid-cols-2 gap-6 lg:gap-12 items-start">
            {/* Left - Copy */}
            <div className="space-y-4 sm:space-y-6 text-center lg:text-left">
              <Badge className="bg-green-100 text-green-700 border-green-200 px-2.5 py-1 text-xs">
                <Gift className="w-3 h-3 mr-1" />
                $25 Off First Clean
              </Badge>
              
              <h1 className="text-2xl sm:text-4xl lg:text-5xl font-extrabold text-slate-900 leading-tight font-jakarta tracking-tight">
                Premium Cleaning
                <span className="block text-primary">From $189/mo</span>
              </h1>
              
              <p className="text-sm sm:text-base text-slate-600 leading-relaxed max-w-md mx-auto lg:mx-0">
                Join DMV families who trust Novara. Professional teams, 40-point checklists, satisfaction guaranteed.
              </p>
              
              {/* Trust Badges - Compact */}
              <div className="flex flex-wrap items-center justify-center lg:justify-start gap-2">
                <div className="flex items-center gap-1">
                  <div className="flex -space-x-0.5">
                    {[1,2,3,4,5].map(i => (
                      <Star key={i} className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />
                    ))}
                  </div>
                  <span className="text-xs font-semibold text-slate-700">4.9</span>
                </div>
                <Badge variant="outline" className="bg-white text-[10px] px-2 py-0.5">
                  <Shield className="w-2.5 h-2.5 mr-1" />
                  Insured
                </Badge>
                <Badge variant="outline" className="bg-white text-[10px] px-2 py-0.5">
                  <CheckCircle className="w-2.5 h-2.5 mr-1" />
                  Vetted
                </Badge>
              </div>
              
              {/* CTA - Desktop Only */}
              <div className="hidden lg:flex gap-3">
                <Button 
                  size="lg" 
                  onClick={scrollToBooking}
                  className="h-12 px-6 text-sm font-bold bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25"
                >
                  Claim $25 Discount
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
                <Button 
                  size="lg" 
                  variant="outline"
                  className="h-12 px-6 text-sm"
                  onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })}
                >
                  How It Works
                </Button>
              </div>
            </div>

            {/* Right - Booking Card */}
            <div id="booking-section" className="scroll-mt-20">
              <Card className="border-2 border-primary/30 shadow-xl shadow-primary/10 overflow-hidden">
                <div className="bg-gradient-to-r from-primary to-primary/80 px-3 py-2.5 text-white text-center">
                  <p className="font-bold text-sm font-jakarta">🎉 First-Time Special</p>
                  <p className="text-[11px] text-white/90">Save $25 on your first cleaning</p>
                </div>
                <CardContent className="p-4 space-y-4">
                  {formMode === 'zip' ? (
                    <form onSubmit={handleZipSubmit} className="space-y-3">
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-700">Enter ZIP Code</label>
                        <Input 
                          type="text" 
                          inputMode="numeric"
                          maxLength={5}
                          placeholder="e.g., 20814"
                          value={zipCode}
                          onChange={e => {
                            setZipCode(e.target.value.replace(/\D/g, ''));
                            setIsOutOfArea(false);
                          }}
                          className="h-12 text-base text-center font-medium"
                          autoFocus
                        />
                        {isOutOfArea && (
                          <p className="text-xs text-red-500">
                            We don't serve that area yet. Check back soon!
                          </p>
                        )}
                      </div>
                      <Button 
                        type="submit"
                        disabled={zipCode.length !== 5 || isValidating}
                        className="w-full h-11 text-sm font-bold bg-primary hover:bg-primary/90"
                      >
                        {isValidating ? "Checking..." : "Check Availability"}
                        <ArrowRight className="w-4 h-4 ml-2" />
                      </Button>
                    </form>
                  ) : (
                    <form onSubmit={handleContactSubmit} className="space-y-3">
                      <div className="flex items-center gap-2 p-2.5 bg-green-50 rounded-lg border border-green-200">
                        <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
                        <div>
                          <p className="font-semibold text-green-800 text-xs">We service {cityState}!</p>
                          <p className="text-[10px] text-green-600">$25 off applied at checkout</p>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label className="text-xs font-semibold text-slate-700">First Name</label>
                          <Input
                            placeholder="John"
                            value={firstName}
                            onChange={e => setFirstName(e.target.value)}
                            className="h-10 text-sm"
                            required
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-semibold text-slate-700">Last Name</label>
                          <Input
                            placeholder="Smith"
                            value={lastName}
                            onChange={e => setLastName(e.target.value)}
                            className="h-10 text-sm"
                            required
                          />
                        </div>
                      </div>
                      
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700">Email</label>
                        <Input
                          type="email"
                          placeholder="john@example.com"
                          value={email}
                          onChange={e => setEmail(e.target.value)}
                          className="h-10 text-sm"
                          required
                        />
                      </div>
                      
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700">Phone</label>
                        <Input
                          type="tel"
                          placeholder="(202) 555-0123"
                          value={phone}
                          onChange={handlePhoneChange}
                          className="h-10 text-sm"
                          required
                        />
                      </div>
                      
                      <Button
                        type="submit"
                        disabled={!firstName || !lastName || !email || phone.replace(/\D/g, '').length !== 10 || isSubmitting}
                        className="w-full h-11 text-sm font-bold bg-primary hover:bg-primary/90"
                      >
                        {isSubmitting ? "Processing..." : "Continue & Get $25 Off"}
                        <ArrowRight className="w-4 h-4 ml-2" />
                      </Button>
                      
                      <button
                        type="button"
                        onClick={() => {
                          setFormMode('zip');
                          setZipCode('');
                        }}
                        className="text-xs text-primary hover:underline w-full text-center"
                      >
                        ← Change ZIP
                      </button>
                    </form>
                  )}
                  
                  <div className="pt-3 border-t text-center">
                    <p className="text-[10px] text-slate-400 flex items-center justify-center gap-1">
                      <Shield className="w-3 h-3" />
                      100% Satisfaction Guaranteed
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* Booking Demo - Compact */}
      <section className="py-8 sm:py-12 bg-slate-50">
        <div className="max-w-6xl mx-auto px-3 sm:px-4">
          <div className="text-center mb-6">
            <Badge className="mb-2 bg-primary/10 text-primary border-0 text-[10px] px-2 py-0.5">
              <Play className="w-2.5 h-2.5 mr-1" />
              Quick & Easy
            </Badge>
            <h2 className="text-lg sm:text-2xl font-extrabold text-slate-900 font-jakarta">
              Book in Under 2 Minutes
            </h2>
          </div>
          
          {/* Steps - Horizontal Scroll on Mobile */}
          <div className="flex gap-2 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-hide">
            {BOOKING_STEPS_DEMO.map((item, idx) => (
              <div 
                key={idx} 
                className="flex-shrink-0 w-[85px] snap-center"
              >
                <div className="flex flex-col items-center">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm shadow-md ${
                    idx === BOOKING_STEPS_DEMO.length - 1 
                      ? 'bg-green-500' 
                      : 'bg-primary'
                  }`}>
                    {item.step}
                  </div>
                  <p className="mt-2 text-[10px] font-bold text-slate-900 text-center">{item.title}</p>
                  <div className="mt-1 px-2 py-1 bg-white rounded text-[9px] font-mono text-slate-500 border">
                    {item.visual}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why Novara - Compact Grid */}
      <section className="py-8 sm:py-12">
        <div className="max-w-6xl mx-auto px-3 sm:px-4">
          <div className="text-center mb-6">
            <h2 className="text-lg sm:text-2xl font-extrabold text-slate-900 font-jakarta">
              Why Choose Novara
            </h2>
          </div>
          
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {WHY_NOVARA.map((item, idx) => (
              <div key={idx} className="p-3 rounded-xl bg-white border border-slate-100 shadow-sm text-center">
                <div className="w-10 h-10 mx-auto rounded-xl bg-primary/10 flex items-center justify-center mb-2">
                  <item.icon className="w-5 h-5 text-primary" />
                </div>
                <p className="font-bold text-xs text-slate-900">{item.title}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Membership - Compact */}
      <section className="py-8 sm:py-12 bg-gradient-to-br from-primary/5 to-white">
        <div className="max-w-6xl mx-auto px-3 sm:px-4">
          <div className="text-center mb-6">
            <Badge className="mb-2 bg-amber-100 text-amber-700 border-amber-200 text-[10px] px-2 py-0.5">
              <Crown className="w-2.5 h-2.5 mr-1" />
              Membership
            </Badge>
            <h2 className="text-lg sm:text-2xl font-extrabold text-slate-900 font-jakarta">
              Save More Every Month
            </h2>
            <div className="mt-3 inline-flex items-baseline gap-1 bg-white px-4 py-2 rounded-full shadow-sm border">
              <span className="text-2xl font-extrabold text-primary font-jakarta">$189</span>
              <span className="text-xs text-slate-500">/month</span>
            </div>
          </div>
          
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
            {MEMBERSHIP_PERKS.map((perk, idx) => (
              <div key={idx} className="flex items-start gap-2 p-2.5 rounded-lg bg-white border border-slate-100">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <perk.icon className="w-4 h-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-[11px] text-slate-900 truncate">{perk.title}</p>
                  <p className="text-[9px] text-slate-500 truncate">{perk.desc}</p>
                </div>
              </div>
            ))}
          </div>
          
          <div className="text-center mt-6">
            <Button onClick={scrollToBooking} size="sm" className="bg-primary hover:bg-primary/90 h-10 px-6 text-sm font-bold">
              Start Membership
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>
      </section>

      {/* How It Works - Compact */}
      <section id="how-it-works" className="py-8 sm:py-12 bg-slate-900 text-white">
        <div className="max-w-6xl mx-auto px-3 sm:px-4">
          <div className="text-center mb-6">
            <h2 className="text-lg sm:text-2xl font-extrabold font-jakarta">
              How It Works
            </h2>
          </div>
          
          <div className="grid grid-cols-3 gap-3">
            {[
              { step: "1", title: "Tell Us", desc: "ZIP & home size" },
              { step: "2", title: "Schedule", desc: "Pick your time" },
              { step: "3", title: "Relax", desc: "We handle it" },
            ].map((item, idx) => (
              <div key={idx} className="text-center">
                <div className="w-10 h-10 mx-auto rounded-full bg-primary text-white font-bold text-sm flex items-center justify-center">
                  {item.step}
                </div>
                <p className="mt-2 font-bold text-xs">{item.title}</p>
                <p className="text-[10px] text-slate-400">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials - Horizontal Scroll */}
      <section className="py-8 sm:py-12">
        <div className="max-w-6xl mx-auto px-3 sm:px-4">
          <div className="text-center mb-6">
            <h2 className="text-lg sm:text-2xl font-extrabold text-slate-900 font-jakarta">
              What Customers Say
            </h2>
          </div>
          
          <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-hide">
            {TESTIMONIALS.map((t, idx) => (
              <div key={idx} className="flex-shrink-0 w-[260px] snap-center">
                <Card className="border-0 shadow-md h-full">
                  <CardContent className="p-4">
                    <div className="flex gap-0.5 mb-2">
                      {[...Array(t.rating)].map((_, i) => (
                        <Star key={i} className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />
                      ))}
                    </div>
                    <p className="text-xs text-slate-600 mb-3 line-clamp-3">"{t.text}"</p>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold">
                        {t.avatar}
                      </div>
                      <div>
                        <p className="font-bold text-xs text-slate-900">{t.name}</p>
                        <p className="text-[10px] text-slate-500">{t.location}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Service Areas - Compact */}
      <section className="py-8 sm:py-12 bg-slate-50">
        <div className="max-w-6xl mx-auto px-3 sm:px-4">
          <div className="text-center mb-4">
            <h2 className="text-lg sm:text-2xl font-extrabold text-slate-900 font-jakarta">
              Serving the DMV
            </h2>
            <p className="text-xs text-slate-500 mt-1">DC • Maryland • Virginia</p>
          </div>
          
          <div className="flex flex-wrap justify-center gap-1.5">
            {SERVICE_AREAS.map((area, idx) => (
              <Badge key={idx} variant="outline" className="px-2.5 py-1 text-[10px] bg-white">
                {area}
              </Badge>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA - Compact */}
      <section className="py-8 sm:py-12 bg-primary text-white">
        <div className="max-w-4xl mx-auto px-3 sm:px-4 text-center">
          <h2 className="text-lg sm:text-2xl font-extrabold font-jakarta mb-3">
            Ready for a Spotless Home?
          </h2>
          <p className="text-xs sm:text-sm text-white/80 mb-4">
            Book today and save $25. No contracts, no hassle.
          </p>
          <Button 
            onClick={scrollToBooking}
            className="h-10 px-6 text-sm font-bold bg-white text-primary hover:bg-slate-100"
          >
            Claim $25 Discount
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </section>

      {/* Footer - Compact */}
      <footer className="py-8 bg-slate-900 text-white">
        <div className="max-w-6xl mx-auto px-3 sm:px-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-2">
              <img src="/novara-logo.png" alt="Novara" className="h-8 w-8 rounded-lg" />
              <span className="font-bold font-jakarta">Novara</span>
            </div>
            <a href="tel:+12025551234" className="flex items-center gap-2 text-xs text-slate-400 hover:text-white">
              <Phone className="w-3.5 h-3.5" />
              (202) 555-1234
            </a>
          </div>
          
          <div className="flex flex-wrap justify-center gap-3 text-[10px] text-slate-400 mb-4">
            <a href="https://novaracleaning.com/terms" className="hover:text-white">Terms</a>
            <a href="https://novaracleaning.com/privacy" className="hover:text-white">Privacy</a>
            <a href="https://novaracleaning.com/cancellation" className="hover:text-white">Cancellation</a>
            <a href="https://novaracleaning.com/refunds" className="hover:text-white">Refunds</a>
          </div>
          
          <div className="text-center text-[10px] text-slate-500">
            <p>© {new Date().getFullYear()} Novara Cleaning. All rights reserved.</p>
            <p className="mt-1">* $25 off for first-time customers only.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
