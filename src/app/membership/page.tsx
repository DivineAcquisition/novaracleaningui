"use client";
export const dynamic = "force-dynamic";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CheckCircle2, Sparkles, Calendar, Gift, Zap, Crown, ArrowRight, PauseCircle, PlayCircle, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SavingsComparison } from "@/components/membership/SavingsComparison";
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
    color: 'from-purple-500 to-pink-500',
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

export default function MembershipPage() {
  const router = useRouter();
  const { user, subscription, checkSubscription } = useAuth();
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [pauseResumeDialogOpen, setPauseResumeDialogOpen] = useState(false);

  const handleSubscribe = async (priceId: string, planId: string) => {
    if (!user) {
      toast.error('Please sign in to subscribe');
      router.push('/auth');
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
          <p className="text-sm text-muted-foreground/80 max-w-2xl mx-auto mt-2">
            Credits apply to standard cleanings only. Deep cleans and move-in/out cleanings available at member discount rates.
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
                        Resume anytime to continue.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </CardHeader>
          </Card>
        )}

        {/* Pricing Cards */}
        <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
          {Object.values(MEMBERSHIP_TIERS).map((tier) => {
            const Icon = tier.icon;
            const isCurrentPlan = currentPlan?.id === tier.id;
            
            return (
              <Card
                key={tier.id}
                className={`relative overflow-hidden transition-all hover:shadow-xl ${
                  tier.popular ? 'border-primary/50 shadow-lg scale-105' : ''
                } ${isCurrentPlan ? 'border-success/50 bg-success/5' : ''}`}
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

                <CardHeader className="text-center space-y-4 pb-8">
                  <div className={`mx-auto w-16 h-16 rounded-full bg-gradient-to-br ${tier.color} flex items-center justify-center shadow-elegant`}>
                    <Icon className="w-8 h-8 text-white" />
                  </div>
                  
                  <div>
                    <CardTitle className="text-2xl mb-2">{tier.name}</CardTitle>
                    <div className="flex items-baseline justify-center gap-1">
                      <span className="text-4xl font-bold">${tier.price}</span>
                      <span className="text-muted-foreground">/month</span>
                    </div>
                  </div>

                  <Badge variant="secondary" className="text-sm">
                    <Zap className="w-3 h-3 mr-1" />
                    {tier.credits} {tier.credits === 1 ? 'Credit' : 'Credits'}/Month
                  </Badge>
                </CardHeader>

                <CardContent className="space-y-6">
                  <Separator />
                  
                  <ul className="space-y-3">
                    {tier.features.map((feature, index) => (
                      <li key={index} className="flex items-start gap-2">
                        <CheckCircle2 className="w-5 h-5 text-success flex-shrink-0 mt-0.5" />
                        <span className="text-sm">{feature}</span>
                      </li>
                    ))}
                  </ul>

                  <Button
                    onClick={() => handleSubscribe(tier.priceId, tier.id)}
                    disabled={loadingPlan === tier.id || isCurrentPlan}
                    className={`w-full h-12 ${
                      tier.popular
                        ? 'bg-gradient-primary shadow-elegant'
                        : 'bg-gradient-to-r from-primary to-accent'
                    }`}
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

        {/* Savings Comparison */}
        <div className="mt-12 space-y-6">
          <SavingsComparison 
            monthlyPrice={189}
            regularCleanPrice={225}
            creditsPerMonth={1}
          />
        </div>

        {/* Benefits Section */}
        <Card className="mt-12 bg-gradient-to-br from-primary/5 to-accent/5 border-primary/20">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl md:text-3xl">Why Choose Novara Membership?</CardTitle>
            <CardDescription className="text-base">
              Join thousands of satisfied members enjoying hassle-free cleaning
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-3 gap-6">
              <div className="text-center space-y-2">
                <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
                  <Gift className="w-6 h-6 text-primary" />
                </div>
                <h3 className="font-semibold">Monthly Credits</h3>
                <p className="text-sm text-muted-foreground">
                  Use your credits for standard cleaning services, anytime
                </p>
              </div>

              <div className="text-center space-y-2">
                <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
                  <Zap className="w-6 h-6 text-primary" />
                </div>
                <h3 className="font-semibold">Exclusive Discounts</h3>
                <p className="text-sm text-muted-foreground">
                  Save up to 30% on all add-ons and upgrades
                </p>
              </div>

              <div className="text-center space-y-2">
                <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
                  <Calendar className="w-6 h-6 text-primary" />
                </div>
                <h3 className="font-semibold">Flexible Scheduling</h3>
                <p className="text-sm text-muted-foreground">
                  Priority booking and easy rescheduling options
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* CTA Section */}
        <div className="text-center mt-12 space-y-4">
          <p className="text-muted-foreground">
            Not ready for a membership?{' '}
            <Button variant="link" onClick={() => router.push('/book/sqft')} className="p-0 h-auto">
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
