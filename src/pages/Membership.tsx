import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CheckCircle2, Sparkles, Calendar, Gift, Zap, Crown, ArrowRight, PauseCircle, PlayCircle, AlertCircle } from "lucide-react";
import { PauseResumeDialog } from "@/components/membership/PauseResumeDialog";
import { MEMBERSHIP_PRICES } from "@/lib/pricing-system";

const MEMBERSHIP_TIERS = [
  {
    id: 'monthly',
    name: 'Glow Monthly',
    startingPrice: MEMBERSHIP_PRICES['0_999'].monthly,
    credits: 1,
    discount: '20%',
    icon: Calendar,
    color: 'from-primary to-accent',
    features: [
      '1 cleaning credit per month (up to 2 hrs)',
      '48-hour reclean guarantee',
      'Priority customer support',
      '20% off extra hours & add-ons',
    ],
    popular: false,
  },
  {
    id: 'biweekly',
    name: 'Glow Bi-Weekly',
    startingPrice: MEMBERSHIP_PRICES['0_999'].biweekly,
    credits: 2,
    discount: '25%',
    icon: Gift,
    color: 'from-primary to-accent',
    features: [
      '2 cleaning credits per month (up to 3 hrs each)',
      'Dedicated cleaner match',
      '25% off deep cleans & add-ons',
      'Satisfaction guarantee',
      'Free rescheduling',
    ],
    popular: true,
  },
  {
    id: 'weekly',
    name: 'Glow Weekly',
    startingPrice: MEMBERSHIP_PRICES['0_999'].weekly,
    credits: 4,
    discount: '30%',
    icon: Crown,
    color: 'from-primary to-accent',
    features: [
      '4 cleaning credits per month (up to 3 hrs each)',
      'Dedicated cleaner & preferred time slot',
      'Free deep clean every 6 months',
      '30% off extra hours & add-ons',
      'VIP scheduling',
    ],
    popular: false,
  },
];

export default function Membership() {
  const navigate = useNavigate();
  const { subscription, checkSubscription } = useAuth();
  const [pauseResumeDialogOpen, setPauseResumeDialogOpen] = useState(false);

  const currentPlanId = subscription?.subscribed
    ? (['monthly', 'biweekly', 'weekly'].find(id => {
        // Match by product_id if available, otherwise no current plan shown
        return false; // Will be matched once Stripe products are created dynamically
      }))
    : null;

  return (
    <div className="min-h-screen bg-gradient-hero">
      {/* Hero Section */}
      <div className="container max-w-7xl mx-auto px-4 py-12 md:py-16">
        <div className="text-center space-y-4 mb-12">
          <Badge className="bg-gradient-primary text-primary-foreground border-0 shadow-lg">
            <Sparkles className="w-4 h-4 mr-1" />
            Membership Plans
          </Badge>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold font-jakarta">
            Choose Your Perfect Plan
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
            Subscribe today and enjoy consistent, professional cleaning at a fraction of one-time pricing.
            All plans include a complimentary deep clean on your first visit.
          </p>
          <p className="text-sm text-muted-foreground/80 max-w-2xl mx-auto mt-2">
            Prices vary by home size. Click a plan to see your exact monthly cost.
          </p>
        </div>

        {/* Current Subscription Banner */}
        {subscription?.subscribed && (
          <Card className={`mb-8 ${subscription?.is_paused ? 'border-warning/50 bg-warning/5' : 'border-primary/50 bg-primary/5'}`}>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <CardTitle className="flex items-center gap-2">
                    {subscription?.is_paused ? (
                      <PauseCircle className="w-5 h-5 text-warning" />
                    ) : (
                      <CheckCircle2 className="w-5 h-5 text-primary" />
                    )}
                    {subscription?.is_paused ? 'Membership Paused' : 'Active Membership'}
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
                      'You have an active Novara Membership'
                    )}
                  </CardDescription>
                </div>
                <Button
                  variant={subscription?.is_paused ? "default" : "outline"}
                  size="sm"
                  onClick={() => setPauseResumeDialogOpen(true)}
                >
                  {subscription?.is_paused ? (
                    <><PlayCircle className="w-4 h-4 mr-2" /> Resume</>
                  ) : (
                    <><PauseCircle className="w-4 h-4 mr-2" /> Pause</>
                  )}
                </Button>
              </div>
              
              {subscription?.is_paused && (
                <div className="mt-4 p-3 rounded-lg bg-warning/10 border border-warning/20">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-warning mt-0.5" />
                    <div className="text-sm text-muted-foreground">
                      <p className="font-medium text-foreground">Your membership is on hold</p>
                      <p className="mt-1">While paused, you won't be charged and credits won't be issued. Resume anytime.</p>
                    </div>
                  </div>
                </div>
              )}
            </CardHeader>
          </Card>
        )}

        {/* Pricing Cards */}
        <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
          {MEMBERSHIP_TIERS.map((tier) => {
            const Icon = tier.icon;
            
            return (
              <Card
                key={tier.id}
                className={`relative overflow-hidden transition-all hover:shadow-xl cursor-pointer ${
                  tier.popular ? 'border-primary/50 shadow-lg scale-105' : ''
                }`}
                onClick={() => navigate(`/membership/${tier.id}`)}
              >
                {tier.popular && (
                  <div className="absolute top-0 right-0">
                    <Badge className="bg-gradient-primary text-primary-foreground border-0 rounded-none rounded-bl-lg">
                      Most Popular
                    </Badge>
                  </div>
                )}

                <CardHeader className="text-center space-y-4 pb-8">
                  <div className={`mx-auto w-16 h-16 rounded-full bg-gradient-to-br ${tier.color} flex items-center justify-center shadow-lg`}>
                    <Icon className="w-8 h-8 text-primary-foreground" />
                  </div>
                  
                  <div>
                    <CardTitle className="text-2xl mb-2">{tier.name}</CardTitle>
                    <div className="flex items-baseline justify-center gap-1">
                      <span className="text-sm text-muted-foreground">Starting at</span>
                    </div>
                    <div className="flex items-baseline justify-center gap-1 mt-1">
                      <span className="text-4xl font-bold">${tier.startingPrice}</span>
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
                        <CheckCircle2 className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                        <span className="text-sm">{feature}</span>
                      </li>
                    ))}
                  </ul>

                  <Button className="w-full h-12 bg-gradient-primary shadow-lg">
                    View Plan Details
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>

                  <p className="text-xs text-center text-muted-foreground">
                    +$75 first-month deep clean • Cancel anytime
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Benefits Section */}
        <Card className="mt-12 bg-primary/5 border-primary/20">
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
                  Use your credits for professional cleaning services, anytime
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
            <Button variant="link" onClick={() => navigate('/book/home')} className="p-0 h-auto">
              Book a one-time cleaning
            </Button>
          </p>
        </div>
      </div>
      
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
