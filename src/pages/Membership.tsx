import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { 
  CheckCircle2, Sparkles, Calendar, Gift, Zap, Crown, ArrowRight, 
  PauseCircle, PlayCircle, AlertCircle, Home, Star, Shield, Clock,
  TrendingUp, Users, Award
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PauseResumeDialog } from "@/components/membership/PauseResumeDialog";

const MEMBERSHIP_TIERS = {
  monthly: {
    id: 'monthly',
    name: 'Novara Monthly',
    price: 189,
    priceId: 'price_1SR2UhGc7k6gIVcMiKbuq1mo',
    productId: 'prod_TNo6QN7DbsYAew',
    credits: 1,
    discount: '20%',
    icon: Calendar,
    color: 'from-blue-500 to-cyan-500',
    glowColor: 'hsl(200 100% 50% / 0.15)',
    features: [
      '🎁 First standard cleaning included ($225 value)',
      '1 standard cleaning credit per month',
      '20% off all add-ons',
      'Flexible scheduling',
      'Cancel anytime',
      'Priority customer support',
    ],
    popular: false,
  },
  biweekly: {
    id: 'biweekly',
    name: 'Novara Bi-Weekly',
    price: 289,
    priceId: 'price_1SR2VNGc7k6gIVcMMI6Fuxga',
    productId: 'prod_TNo7Dtg4Sn31wW',
    credits: 2,
    discount: '25%',
    icon: Gift,
    color: 'from-primary to-purple-600',
    glowColor: 'hsl(260 100% 50% / 0.2)',
    features: [
      '🎁 First standard cleaning included ($225 value)',
      '2 standard cleaning credits per month',
      '25% off all add-ons',
      'Early booking access',
      'Cancel anytime',
      'Priority customer support',
      'Free rescheduling',
    ],
    popular: true,
  },
  weekly: {
    id: 'weekly',
    name: 'Novara Weekly',
    price: 389,
    priceId: 'price_1SR2VYGc7k6gIVcML2W0jVKS',
    productId: 'prod_TNo7DH056lKJ5o',
    credits: 4,
    discount: '30%',
    icon: Crown,
    color: 'from-amber-500 to-orange-500',
    glowColor: 'hsl(40 100% 50% / 0.15)',
    features: [
      '🎁 First standard cleaning included ($225 value)',
      '4 standard cleaning credits per month',
      '30% off all add-ons',
      'Priority scheduling',
      'Cancel anytime',
      'VIP customer support',
      'Free rescheduling',
      'Dedicated cleaning team',
    ],
    popular: false,
  },
};

const benefits = [
  { icon: Star, title: 'Premium Service', description: 'Top-rated cleaners with background checks' },
  { icon: Shield, title: 'Satisfaction Guaranteed', description: '48-hour re-clean if you\'re not happy' },
  { icon: Clock, title: 'Flexible Scheduling', description: 'Book and reschedule anytime online' },
  { icon: Gift, title: 'No Commitment', description: 'Cancel or pause anytime, no fees' },
];

export default function Membership() {
  const navigate = useNavigate();
  const { user, subscription, checkSubscription } = useAuth();
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [pauseResumeDialogOpen, setPauseResumeDialogOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleSubscribe = async (priceId: string, planId: string) => {
    if (!user) {
      toast.error('Please sign in to subscribe');
      navigate('/auth');
      return;
    }

    setLoadingPlan(planId);
    
    try {
      const { data, error } = await supabase.functions.invoke('create-checkout', {
        body: { priceId, mode: 'subscription' },
      });

      if (error) throw error;

      if (data?.url) {
        window.open(data.url, '_blank');
        toast.success('Opening checkout in new tab...');
      }
    } catch (error) {
      console.error('Error creating checkout:', error);
      toast.error('Failed to start checkout. Please try again.');
    } finally {
      setLoadingPlan(null);
    }
  };

  const currentPlan = subscription?.subscribed 
    ? Object.values(MEMBERSHIP_TIERS).find(tier => tier.productId === subscription.product_id)
    : null;

  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased selection:bg-primary/20 selection:text-primary overflow-x-hidden">
      
      {/* Grid Background */}
      <div className="fixed inset-0 pointer-events-none grid-pattern opacity-50" />

      {/* Background Glow Effects */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        {/* Main banner glow */}
        <div 
          className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-full md:w-[1200px] h-[800px]"
          style={{
            background: 'radial-gradient(ellipse at center, hsl(260 100% 50% / 0.08) 0%, hsl(260 100% 50% / 0.03) 40%, transparent 70%)',
            filter: 'blur(60px)',
          }}
        />
        {/* Bottom right glow */}
        <div 
          className="absolute bottom-[-10%] right-[-5%] w-[600px] h-[600px] rounded-full opacity-60"
          style={{
            background: 'radial-gradient(circle, hsl(260 100% 70% / 0.1) 0%, transparent 60%)',
            filter: 'blur(80px)',
          }}
        />
        {/* Left accent glow */}
        <div 
          className="absolute top-1/3 left-[-10%] w-[400px] h-[400px] rounded-full opacity-40"
          style={{
            background: 'radial-gradient(circle, hsl(200 100% 60% / 0.1) 0%, transparent 60%)',
            filter: 'blur(80px)',
          }}
        />
      </div>

      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 h-16 sm:h-20 border-b border-slate-200/50 bg-white/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 sm:gap-3 group">
            <img 
              src="/novara-logo.png" 
              alt="Novara" 
              className="h-8 w-8 sm:h-10 sm:w-10 rounded-xl group-hover:opacity-80 transition-opacity"
            />
            <span className="font-bold text-lg sm:text-xl text-slate-900">Novara</span>
          </Link>
          
          <div className="flex items-center gap-2 sm:gap-3">
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => navigate('/')}
              className="text-xs sm:text-sm h-8 sm:h-10"
            >
              <Home className="w-4 h-4 sm:mr-2" />
              <span className="hidden sm:inline">Home</span>
            </Button>
            {user ? (
              <Button 
                size="sm"
                onClick={() => navigate('/account')}
                className="bg-primary text-white text-xs sm:text-sm h-8 sm:h-10"
              >
                My Account
              </Button>
            ) : (
              <Button 
                size="sm"
                onClick={() => navigate('/auth')}
                className="bg-primary text-white text-xs sm:text-sm h-8 sm:h-10"
              >
                Sign In
              </Button>
            )}
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative z-10 px-4 sm:px-6 pt-24 pb-8 sm:pt-36 sm:pb-16 md:pt-44 md:pb-20">
        <div className="max-w-3xl mx-auto text-center">
          {/* Badge */}
          <div 
            className={`glow-badge mb-4 sm:mb-8 ${mounted ? 'animate-fade-in' : 'opacity-0'}`}
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping-dot absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
            </span>
            Membership Plans
          </div>

          {/* Headline */}
          <h1 
            className={`text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-4 sm:mb-6 leading-[1.1] font-jakarta
                        ${mounted ? 'animate-fade-in animation-delay-100' : 'opacity-0'}`}
          >
            <span className="text-slate-900">Clean Home,</span>
            <br />
            <span className="text-primary">Clear Mind</span>
          </h1>

          {/* Subheadline */}
          <p 
            className={`text-base sm:text-lg md:text-xl text-slate-600 leading-relaxed max-w-2xl mx-auto mb-6 sm:mb-10
                        ${mounted ? 'animate-fade-in animation-delay-200' : 'opacity-0'}`}
          >
            Subscribe today and get your first cleaning immediately. 
            Flexible plans, transparent pricing, exceptional service.
          </p>

          {/* Trust badges */}
          <div 
            className={`flex flex-wrap justify-center gap-2 sm:gap-3
                        ${mounted ? 'animate-fade-in animation-delay-300' : 'opacity-0'}`}
          >
            {['Cancel Anytime', 'Background-Checked', '4.9★ Rating'].map((value) => (
              <span 
                key={value}
                className="px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium bg-slate-100 border border-slate-200 text-slate-700"
              >
                {value}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Current Subscription Banner */}
      {currentPlan && (
        <section className="relative z-10 px-4 sm:px-6 pb-8">
          <div className="max-w-4xl mx-auto">
            <Card className={`${subscription?.is_paused ? 'border-amber-300 bg-gradient-to-br from-amber-50 to-orange-50' : 'border-primary/30 bg-gradient-to-br from-primary/5 to-purple-50'} overflow-hidden`}>
              <CardHeader className="pb-2 sm:pb-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
                  <div className="flex-1">
                    <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                      {subscription?.is_paused ? (
                        <PauseCircle className="w-5 h-5 text-amber-500" />
                      ) : (
                        <CheckCircle2 className="w-5 h-5 text-green-500" />
                      )}
                      {subscription?.is_paused ? 'Paused: ' : 'Active: '}
                      {currentPlan.name}
                    </CardTitle>
                    <CardDescription className="mt-1 text-xs sm:text-sm">
                      {subscription?.is_paused ? (
                        'Your subscription is paused'
                      ) : (
                        `${currentPlan.credits} credit(s) per month • ${currentPlan.discount} off add-ons`
                      )}
                    </CardDescription>
                  </div>
                  <Button
                    variant={subscription?.is_paused ? "default" : "outline"}
                    size="sm"
                    onClick={() => setPauseResumeDialogOpen(true)}
                    className={subscription?.is_paused ? "bg-green-500 hover:bg-green-600 text-xs sm:text-sm" : "text-xs sm:text-sm"}
                  >
                    {subscription?.is_paused ? (
                      <>
                        <PlayCircle className="w-4 h-4 mr-1 sm:mr-2" />
                        Resume
                      </>
                    ) : (
                      <>
                        <PauseCircle className="w-4 h-4 mr-1 sm:mr-2" />
                        Pause
                      </>
                    )}
                  </Button>
                </div>
              </CardHeader>
            </Card>
          </div>
        </section>
      )}

      {/* Pricing Cards */}
      <section className="relative z-10 px-4 sm:px-6 pb-12 sm:pb-20" id="plans">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
            {Object.values(MEMBERSHIP_TIERS).map((tier, index) => {
              const Icon = tier.icon;
              const isCurrentPlan = currentPlan?.id === tier.id;
              
              return (
                <Card
                  key={tier.id}
                  className={`relative overflow-hidden transition-all duration-300 hover:shadow-2xl group
                    ${tier.popular ? 'border-primary/50 shadow-xl md:scale-105 z-10' : 'border-slate-200'} 
                    ${isCurrentPlan ? 'ring-2 ring-green-500 bg-green-50/30' : ''}
                    ${mounted ? `animate-fade-in animation-delay-${(index + 3) * 100}` : 'opacity-0'}`}
                  style={{
                    boxShadow: tier.popular ? `0 20px 60px ${tier.glowColor}` : undefined
                  }}
                >
                  {/* Popular Badge */}
                  {tier.popular && (
                    <div className="absolute top-0 left-0 right-0 bg-gradient-to-r from-primary to-purple-600 text-white text-xs sm:text-sm font-semibold py-1.5 sm:py-2 text-center">
                      <Sparkles className="inline w-3 h-3 sm:w-4 sm:h-4 mr-1" />
                      Most Popular
                    </div>
                  )}

                  {/* Current Plan Badge */}
                  {isCurrentPlan && (
                    <div className="absolute top-0 right-0">
                      <Badge className="bg-green-500 text-white border-0 rounded-none rounded-bl-lg text-[10px] sm:text-xs">
                        Current
                      </Badge>
                    </div>
                  )}

                  <CardHeader className={`text-center space-y-3 sm:space-y-4 pb-4 sm:pb-6 ${tier.popular ? 'pt-10 sm:pt-12' : 'pt-4 sm:pt-6'}`}>
                    {/* Icon */}
                    <div 
                      className={`mx-auto w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-gradient-to-br ${tier.color} flex items-center justify-center shadow-lg transition-transform group-hover:scale-110`}
                      style={{
                        boxShadow: `0 10px 40px ${tier.glowColor}`
                      }}
                    >
                      <Icon className="w-7 h-7 sm:w-8 sm:h-8 text-white" />
                    </div>
                    
                    {/* Plan Name & Price */}
                    <div>
                      <CardTitle className="text-lg sm:text-xl mb-2">{tier.name}</CardTitle>
                      <div className="flex items-baseline justify-center gap-1">
                        <span className="text-3xl sm:text-4xl font-bold">${tier.price}</span>
                        <span className="text-slate-500 text-sm">/mo</span>
                      </div>
                    </div>

                    {/* Credits Badge */}
                    <Badge variant="secondary" className="text-xs sm:text-sm px-3 py-1">
                      <Zap className="w-3 h-3 mr-1" />
                      {tier.credits} {tier.credits === 1 ? 'Credit' : 'Credits'}/Month
                    </Badge>
                  </CardHeader>

                  <CardContent className="space-y-4 sm:space-y-6 px-4 sm:px-6 pb-4 sm:pb-6">
                    <Separator />
                    
                    {/* Features */}
                    <ul className="space-y-2 sm:space-y-3">
                      {tier.features.map((feature, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-green-500 flex-shrink-0 mt-0.5" />
                          <span className="text-xs sm:text-sm text-slate-600">{feature}</span>
                        </li>
                      ))}
                    </ul>

                    {/* CTA Button */}
                    <Button
                      onClick={() => handleSubscribe(tier.priceId, tier.id)}
                      disabled={loadingPlan === tier.id || isCurrentPlan}
                      className={`w-full h-10 sm:h-12 text-sm sm:text-base font-semibold transition-all ${
                        tier.popular
                          ? 'bg-gradient-to-r from-primary to-purple-600 shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30'
                          : ''
                      }`}
                    >
                      {loadingPlan === tier.id ? (
                        'Processing...'
                      ) : isCurrentPlan ? (
                        'Current Plan'
                      ) : (
                        <>
                          Get Started
                          <ArrowRight className="w-4 h-4 ml-2" />
                        </>
                      )}
                    </Button>

                    <p className="text-[10px] sm:text-xs text-center text-slate-400">
                      Cancel anytime • No fees
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="relative z-10 px-4 sm:px-6 py-12 sm:py-20 bg-slate-50/50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-8 sm:mb-12">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-3 sm:mb-4">
              Why Choose <span className="text-primary">Novara</span>?
            </h2>
            <p className="text-sm sm:text-base text-slate-600 max-w-xl mx-auto">
              Join thousands of happy members enjoying premium cleaning service
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
            {benefits.map((benefit, idx) => (
              <Card 
                key={benefit.title} 
                className={`text-center p-4 sm:p-6 border-slate-200 hover:border-primary/30 hover:shadow-lg transition-all
                  ${mounted ? `animate-fade-in animation-delay-${(idx + 6) * 100}` : 'opacity-0'}`}
              >
                <div className="mx-auto w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3 sm:mb-4">
                  <benefit.icon className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
                </div>
                <h3 className="font-semibold text-sm sm:text-base mb-1 sm:mb-2">{benefit.title}</h3>
                <p className="text-xs sm:text-sm text-slate-500">{benefit.description}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="relative z-10 px-4 sm:px-6 py-12 sm:py-16">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-3 gap-4 sm:gap-8 text-center">
            <div>
              <p className="text-2xl sm:text-4xl font-bold text-primary">2,500+</p>
              <p className="text-xs sm:text-sm text-slate-500 mt-1">Happy Members</p>
            </div>
            <div>
              <p className="text-2xl sm:text-4xl font-bold text-primary">4.9★</p>
              <p className="text-xs sm:text-sm text-slate-500 mt-1">Average Rating</p>
            </div>
            <div>
              <p className="text-2xl sm:text-4xl font-bold text-primary">50K+</p>
              <p className="text-xs sm:text-sm text-slate-500 mt-1">Cleanings Done</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative z-10 px-4 sm:px-6 py-12 sm:py-20">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-xl sm:text-2xl md:text-3xl font-bold mb-4 sm:mb-6">
            Ready for a Cleaner Home?
          </h2>
          <p className="text-sm sm:text-base text-slate-600 mb-6 sm:mb-8">
            Start your membership today or book a one-time cleaning
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-3 sm:gap-4">
            <Button 
              size="lg" 
              className="bg-gradient-to-r from-primary to-purple-600 shadow-lg shadow-primary/25 h-11 sm:h-12 text-sm sm:text-base"
              onClick={() => document.getElementById('plans')?.scrollIntoView({ behavior: 'smooth' })}
            >
              View Plans
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
            <Button 
              variant="outline" 
              size="lg"
              className="h-11 sm:h-12 text-sm sm:text-base"
              onClick={() => navigate('/book/zip')}
            >
              Book One-Time Cleaning
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-slate-200 px-4 sm:px-6 py-6 sm:py-8">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs sm:text-sm text-slate-500">
          <p>© 2025 Novara Cleaning. All rights reserved.</p>
          <div className="flex gap-4 sm:gap-6">
            <a href="https://novaracleaning.com/terms" className="hover:text-primary transition-colors">Terms</a>
            <a href="https://novaracleaning.com/privacy" className="hover:text-primary transition-colors">Privacy</a>
            <a href="https://novaracleaning.com/contact" className="hover:text-primary transition-colors">Contact</a>
          </div>
        </div>
      </footer>
      
      {/* Pause/Resume Dialog */}
      <PauseResumeDialog
        open={pauseResumeDialogOpen}
        onOpenChange={setPauseResumeDialogOpen}
        isPaused={subscription?.is_paused || false}
        resumesAt={subscription?.resumes_at}
        onSuccess={checkSubscription}
      />
    </div>
  );
}
