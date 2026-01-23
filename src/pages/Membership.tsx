import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { 
  CheckCircle2, Sparkles, Calendar, Gift, Zap, Crown, ArrowRight, 
  PauseCircle, PlayCircle, AlertCircle, TrendingDown, Clock, Shield,
  Star, Users, Percent, DollarSign, Home, Heart
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PauseResumeDialog } from "@/components/membership/PauseResumeDialog";
import { cn } from "@/lib/utils";

const MEMBERSHIP_TIERS = {
  monthly: {
    id: 'monthly',
    name: 'Novara Monthly',
    price: 189,
    priceId: 'price_1SR2UhGc7k6gIVcMiKbuq1mo',
    productId: 'prod_TNo6QN7DbsYAew',
    credits: 1,
    discount: 20,
    regularPrice: 225,
    icon: Calendar,
    color: 'from-blue-500 to-cyan-500',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    features: [
      { text: 'First standard cleaning included', value: '$225 value', highlight: true },
      { text: '1 standard cleaning credit per month', value: null, highlight: false },
      { text: '20% off all add-ons', value: null, highlight: false },
      { text: 'Flexible scheduling', value: null, highlight: false },
      { text: 'Cancel anytime', value: null, highlight: false },
      { text: 'Priority customer support', value: null, highlight: false },
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
    discount: 25,
    regularPrice: 450,
    icon: Gift,
    color: 'from-purple-500 to-pink-500',
    bgColor: 'bg-purple-50',
    borderColor: 'border-purple-200',
    features: [
      { text: 'First standard cleaning included', value: '$225 value', highlight: true },
      { text: '2 standard cleaning credits per month', value: null, highlight: false },
      { text: '25% off all add-ons', value: null, highlight: false },
      { text: 'Early booking access', value: null, highlight: false },
      { text: 'Cancel anytime', value: null, highlight: false },
      { text: 'Priority customer support', value: null, highlight: false },
      { text: 'Free rescheduling', value: null, highlight: false },
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
    discount: 30,
    regularPrice: 900,
    icon: Crown,
    color: 'from-amber-500 to-orange-500',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
    features: [
      { text: 'First standard cleaning included', value: '$225 value', highlight: true },
      { text: '4 standard cleaning credits per month', value: null, highlight: false },
      { text: '30% off all add-ons', value: null, highlight: false },
      { text: 'Priority scheduling', value: null, highlight: false },
      { text: 'Cancel anytime', value: null, highlight: false },
      { text: 'VIP customer support', value: null, highlight: false },
      { text: 'Free rescheduling', value: null, highlight: false },
      { text: 'Dedicated cleaning team', value: null, highlight: false },
    ],
    popular: false,
  },
};

// Calculate yearly savings for display
const calculateYearlySavings = (tier: typeof MEMBERSHIP_TIERS.monthly) => {
  const yearlyMemberCost = tier.price * 12;
  const yearlyRegularCost = tier.regularPrice * 12;
  const savings = yearlyRegularCost - yearlyMemberCost;
  return { yearlyMemberCost, yearlyRegularCost, savings };
};

export default function Membership() {
  const navigate = useNavigate();
  const { user, subscription, checkSubscription } = useAuth();
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [pauseResumeDialogOpen, setPauseResumeDialogOpen] = useState(false);
  const [selectedComparison, setSelectedComparison] = useState<'monthly' | 'biweekly' | 'weekly'>('biweekly');

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

  const selectedTier = MEMBERSHIP_TIERS[selectedComparison];
  const comparisonData = calculateYearlySavings(selectedTier);

  return (
    <div className="min-h-screen bg-gradient-hero">
      {/* Hero Section */}
      <div className="container max-w-7xl mx-auto px-4 py-12 md:py-16">
        <div className="text-center space-y-4 mb-12">
          <Badge className="bg-gradient-primary text-white border-0 shadow-elegant">
            <Sparkles className="w-4 h-4 mr-1" />
            Membership Plans
          </Badge>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold font-jakarta">
            Choose Your Perfect Plan
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
            Subscribe today and get your first standard cleaning immediately with your membership credit.
            Save time and money with our flexible membership plans.
          </p>
        </div>

        {/* Current Subscription Banner */}
        {currentPlan && (
          <Card className={`mb-8 ${subscription?.is_paused ? 'border-warning/50 bg-gradient-to-br from-warning/5 to-orange/5' : 'border-primary/50 bg-gradient-to-br from-primary/5 to-accent/5'}`}>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <CardTitle className="flex items-center gap-2">
                    {subscription?.is_paused ? (
                      <PauseCircle className="w-5 h-5 text-warning" />
                    ) : (
                      <CheckCircle2 className="w-5 h-5 text-success" />
                    )}
                    {subscription?.is_paused ? 'Paused: ' : 'Your Current Plan: '}
                    {currentPlan.name}
                  </CardTitle>
                  <CardDescription className="mt-2">
                    {subscription?.is_paused ? (
                      <>
                        Your subscription is paused
                        {subscription.resumes_at && (
                          <span className="block mt-1">
                            Scheduled to resume on {new Date(subscription.resumes_at).toLocaleDateString()}
                          </span>
                        )}
                      </>
                    ) : (
                      `You have an active subscription with ${currentPlan.credits} credit(s) per month`
                    )}
                  </CardDescription>
                </div>
                <Button
                  variant={subscription?.is_paused ? "default" : "outline"}
                  size="sm"
                  onClick={() => setPauseResumeDialogOpen(true)}
                  className={subscription?.is_paused ? "bg-success hover:bg-success/90" : ""}
                >
                  {subscription?.is_paused ? (
                    <>
                      <PlayCircle className="w-4 h-4 mr-2" />
                      Resume
                    </>
                  ) : (
                    <>
                      <PauseCircle className="w-4 h-4 mr-2" />
                      Pause
                    </>
                  )}
                </Button>
              </div>
              
              {subscription?.is_paused && (
                <div className="mt-4 p-3 rounded-lg bg-warning/10 border border-warning/20">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-warning mt-0.5" />
                    <div className="text-sm text-muted-foreground">
                      <p className="font-medium text-foreground">Your membership is on hold</p>
                      <p className="mt-1">
                        While paused, you won't be charged and credits won't be issued. Your benefits and pricing are saved.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </CardHeader>
          </Card>
        )}

        {/* Pricing Cards */}
        <div className="grid md:grid-cols-3 gap-6 lg:gap-8 mb-16">
          {Object.values(MEMBERSHIP_TIERS).map((tier) => {
            const Icon = tier.icon;
            const isCurrentPlan = currentPlan?.id === tier.id;
            const savings = calculateYearlySavings(tier);
            
            return (
              <Card
                key={tier.id}
                className={cn(
                  "relative overflow-hidden transition-all hover:shadow-xl",
                  tier.popular ? 'border-primary/50 shadow-lg scale-105' : '',
                  isCurrentPlan ? 'border-success/50 bg-success/5' : ''
                )}
              >
                {tier.popular && (
                  <div className="absolute top-0 right-0">
                    <Badge className="bg-gradient-primary text-white border-0 rounded-none rounded-bl-lg">
                      Most Popular
                    </Badge>
                  </div>
                )}

                {isCurrentPlan && (
                  <div className="absolute top-0 left-0">
                    <Badge className="bg-success text-white border-0 rounded-none rounded-br-lg">
                      Current Plan
                    </Badge>
                  </div>
                )}

                <CardHeader className="text-center space-y-4 pb-6">
                  <div className={`mx-auto w-16 h-16 rounded-full bg-gradient-to-br ${tier.color} flex items-center justify-center shadow-elegant`}>
                    <Icon className="w-8 h-8 text-white" />
                  </div>
                  
                  <div>
                    <CardTitle className="text-2xl mb-2">{tier.name}</CardTitle>
                    <div className="flex items-baseline justify-center gap-1">
                      <span className="text-4xl font-bold">${tier.price}</span>
                      <span className="text-muted-foreground">/month</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1 line-through">
                      ${tier.regularPrice}/mo regular
                    </p>
                  </div>

                  <div className="flex items-center justify-center gap-2">
                    <Badge variant="secondary" className="text-sm">
                      <Zap className="w-3 h-3 mr-1" />
                      {tier.credits} {tier.credits === 1 ? 'Credit' : 'Credits'}/Month
                    </Badge>
                    <Badge className="bg-green-100 text-green-700 border-green-200">
                      Save {tier.discount}%
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="space-y-6">
                  <Separator />
                  
                  <ul className="space-y-3">
                    {tier.features.map((feature, index) => (
                      <li key={index} className="flex items-start gap-2">
                        <CheckCircle2 className={cn(
                          "w-5 h-5 flex-shrink-0 mt-0.5",
                          feature.highlight ? "text-primary" : "text-success"
                        )} />
                        <span className={cn(
                          "text-sm",
                          feature.highlight && "font-medium"
                        )}>
                          {feature.highlight && "🎁 "}
                          {feature.text}
                          {feature.value && (
                            <span className="text-primary font-medium ml-1">({feature.value})</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <Button
                    onClick={() => handleSubscribe(tier.priceId, tier.id)}
                    disabled={loadingPlan === tier.id || isCurrentPlan}
                    className={cn(
                      "w-full h-12",
                      tier.popular
                        ? 'bg-gradient-primary shadow-elegant'
                        : 'bg-gradient-to-r from-primary to-accent'
                    )}
                  >
                    {loadingPlan === tier.id ? (
                      <>Processing...</>
                    ) : isCurrentPlan ? (
                      <>Current Plan</>
                    ) : (
                      <>
                        Subscribe Now
                        <ArrowRight className="w-4 h-4 ml-2" />
                      </>
                    )}
                  </Button>

                  <p className="text-xs text-center text-muted-foreground">
                    Cancel anytime • No long-term commitment
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Interactive Savings Calculator */}
        <Card className="border-2 border-primary/20 mb-12">
          <CardHeader className="text-center">
            <div className="mx-auto w-16 h-16 bg-gradient-primary rounded-full flex items-center justify-center mb-4">
              <TrendingDown className="w-8 h-8 text-white" />
            </div>
            <CardTitle className="text-2xl md:text-3xl font-jakarta">See How Much You'll Save</CardTitle>
            <CardDescription className="text-base">
              Compare membership pricing to pay-per-clean over time
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
            {/* Plan Selector */}
            <div className="flex justify-center gap-2">
              {Object.entries(MEMBERSHIP_TIERS).map(([key, tier]) => (
                <Button
                  key={key}
                  variant={selectedComparison === key ? "default" : "outline"}
                  onClick={() => setSelectedComparison(key as 'monthly' | 'biweekly' | 'weekly')}
                  className={selectedComparison === key ? "bg-gradient-primary" : ""}
                >
                  {tier.name.replace('Novara ', '')}
                </Button>
              ))}
            </div>

            {/* Visual Comparison */}
            <div className="grid md:grid-cols-2 gap-8">
              {/* Without Membership */}
              <div className="space-y-4">
                <div className="text-center">
                  <p className="text-sm text-muted-foreground uppercase tracking-wider mb-2">Without Membership</p>
                  <p className="text-3xl font-bold text-destructive">
                    ${comparisonData.yearlyRegularCost}
                    <span className="text-sm font-normal text-muted-foreground">/year</span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {selectedTier.credits * 12} cleanings × $225 each
                  </p>
                </div>
                <div className="bg-destructive/10 rounded-xl p-6 border border-destructive/20">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm">
                      <DollarSign className="w-4 h-4 text-destructive" />
                      <span>Full price per cleaning</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="w-4 h-4 text-destructive" />
                      <span>No scheduling priority</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Percent className="w-4 h-4 text-destructive" />
                      <span>No add-on discounts</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* With Membership */}
              <div className="space-y-4">
                <div className="text-center">
                  <p className="text-sm text-muted-foreground uppercase tracking-wider mb-2">With {selectedTier.name}</p>
                  <p className="text-3xl font-bold text-primary">
                    ${comparisonData.yearlyMemberCost}
                    <span className="text-sm font-normal text-muted-foreground">/year</span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    12 months × ${selectedTier.price}/mo
                  </p>
                </div>
                <div className="bg-primary/10 rounded-xl p-6 border border-primary/20">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className="w-4 h-4 text-primary" />
                      <span>{selectedTier.credits} cleanings included/month</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className="w-4 h-4 text-primary" />
                      <span>Priority scheduling</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className="w-4 h-4 text-primary" />
                      <span>{selectedTier.discount}% off all add-ons</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Savings Highlight */}
            <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl p-6 border border-green-200">
              <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
                    <Gift className="w-8 h-8 text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm text-green-700 font-medium">Your Annual Savings</p>
                    <p className="text-4xl font-bold text-green-600">${comparisonData.savings}</p>
                  </div>
                </div>
                <div className="text-center md:text-right">
                  <p className="text-sm text-muted-foreground">That's like getting</p>
                  <p className="text-xl font-bold text-green-600">
                    {Math.round(comparisonData.savings / 225)} free cleanings!
                  </p>
                </div>
              </div>
              
              {/* Savings Progress Bar */}
              <div className="mt-6 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Savings Progress</span>
                  <span className="font-medium text-green-600">
                    {Math.round((comparisonData.savings / comparisonData.yearlyRegularCost) * 100)}% saved
                  </span>
                </div>
                <Progress 
                  value={(comparisonData.savings / comparisonData.yearlyRegularCost) * 100} 
                  className="h-3 bg-green-100"
                />
              </div>
            </div>

            {/* Monthly Breakdown */}
            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="p-4 rounded-lg bg-accent/50">
                <p className="text-2xl font-bold text-foreground">3 mo</p>
                <p className="text-sm text-muted-foreground">Save ${Math.round(comparisonData.savings / 4)}</p>
              </div>
              <div className="p-4 rounded-lg bg-primary/10 ring-2 ring-primary">
                <p className="text-2xl font-bold text-primary">6 mo</p>
                <p className="text-sm text-muted-foreground">Save ${Math.round(comparisonData.savings / 2)}</p>
              </div>
              <div className="p-4 rounded-lg bg-accent/50">
                <p className="text-2xl font-bold text-foreground">12 mo</p>
                <p className="text-sm text-muted-foreground">Save ${comparisonData.savings}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Why Membership Section */}
        <div className="mb-12">
          <div className="text-center mb-8">
            <h2 className="text-3xl md:text-4xl font-bold font-jakarta mb-4">Why Members Love Novara</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Join thousands of happy homeowners who've made the switch to stress-free cleaning
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            <Card className="text-center p-6 border-2 hover:border-primary/50 transition-all hover:shadow-lg">
              <div className="mx-auto w-14 h-14 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-full flex items-center justify-center mb-4">
                <DollarSign className="w-7 h-7 text-white" />
              </div>
              <h3 className="font-semibold text-lg mb-2">Guaranteed Savings</h3>
              <p className="text-sm text-muted-foreground">
                Save up to 30% compared to booking individual cleanings
              </p>
            </Card>

            <Card className="text-center p-6 border-2 hover:border-primary/50 transition-all hover:shadow-lg">
              <div className="mx-auto w-14 h-14 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center mb-4">
                <Calendar className="w-7 h-7 text-white" />
              </div>
              <h3 className="font-semibold text-lg mb-2">Priority Booking</h3>
              <p className="text-sm text-muted-foreground">
                Members get first access to the best time slots
              </p>
            </Card>

            <Card className="text-center p-6 border-2 hover:border-primary/50 transition-all hover:shadow-lg">
              <div className="mx-auto w-14 h-14 bg-gradient-to-br from-amber-500 to-orange-500 rounded-full flex items-center justify-center mb-4">
                <Users className="w-7 h-7 text-white" />
              </div>
              <h3 className="font-semibold text-lg mb-2">Dedicated Team</h3>
              <p className="text-sm text-muted-foreground">
                Premium members get the same trusted cleaners every time
              </p>
            </Card>

            <Card className="text-center p-6 border-2 hover:border-primary/50 transition-all hover:shadow-lg">
              <div className="mx-auto w-14 h-14 bg-gradient-to-br from-green-500 to-emerald-500 rounded-full flex items-center justify-center mb-4">
                <Shield className="w-7 h-7 text-white" />
              </div>
              <h3 className="font-semibold text-lg mb-2">Full Flexibility</h3>
              <p className="text-sm text-muted-foreground">
                Pause, reschedule, or cancel anytime with no penalties
              </p>
            </Card>
          </div>
        </div>

        {/* Testimonial Section */}
        <Card className="bg-gradient-to-br from-primary/5 to-accent/10 border-primary/20 mb-12">
          <CardContent className="py-8">
            <div className="flex flex-col md:flex-row items-center gap-8">
              <div className="flex-shrink-0">
                <div className="w-20 h-20 bg-gradient-primary rounded-full flex items-center justify-center">
                  <Heart className="w-10 h-10 text-white" />
                </div>
              </div>
              <div className="flex-1 text-center md:text-left">
                <div className="flex items-center justify-center md:justify-start gap-1 mb-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star key={star} className="w-5 h-5 fill-yellow-400 text-yellow-400" />
                  ))}
                </div>
                <blockquote className="text-lg italic text-foreground mb-4">
                  "The bi-weekly membership has been a game changer for our family. We save over $150 a month 
                  compared to our old cleaning service, and the team is always on time and thorough!"
                </blockquote>
                <div className="flex items-center justify-center md:justify-start gap-3">
                  <div className="w-10 h-10 bg-primary/20 rounded-full flex items-center justify-center">
                    <span className="text-primary font-bold">SM</span>
                  </div>
                  <div>
                    <p className="font-semibold">Sarah M.</p>
                    <p className="text-sm text-muted-foreground">Bi-Weekly Member since 2024</p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* FAQ / Trust Section */}
        <div className="grid md:grid-cols-3 gap-6 mb-12">
          <Card className="p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <h3 className="font-semibold mb-1">Cancel Anytime</h3>
                <p className="text-sm text-muted-foreground">
                  No long-term contracts. Cancel or pause your membership whenever you need.
                </p>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <Home className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h3 className="font-semibold mb-1">Google Guaranteed</h3>
                <p className="text-sm text-muted-foreground">
                  We're backed by Google's $2,000 guarantee for your peace of mind.
                </p>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <h3 className="font-semibold mb-1">Instant Credit</h3>
                <p className="text-sm text-muted-foreground">
                  Your first cleaning credit is available immediately when you subscribe.
                </p>
              </div>
            </div>
          </Card>
        </div>

        {/* CTA Section */}
        <div className="text-center space-y-4">
          <p className="text-muted-foreground">
            Not ready for a membership?{' '}
            <Button variant="link" onClick={() => navigate('/book/sqft')} className="p-0 h-auto">
              Book a one-time cleaning
            </Button>
          </p>
        </div>
      </div>
      
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
