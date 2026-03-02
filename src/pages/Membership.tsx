import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  RiCheckboxCircleLine, RiSparklingLine, RiCalendarLine, RiGiftLine, RiFlashlightLine,
  RiVipCrownLine, RiArrowRightLine, RiArrowLeftLine, RiPauseCircleLine, RiPlayCircleLine,
  RiAlertLine, RiShieldCheckLine, RiStarLine, RiTimeLine
} from "@remixicon/react";
import { PauseResumeDialog } from "@/components/membership/PauseResumeDialog";
import { MEMBERSHIP_PRICES } from "@/lib/pricing-system";
import { cn } from "@/lib/utils";

const MEMBERSHIP_TIERS = [
  {
    id: 'monthly',
    name: 'Glow Monthly',
    startingPrice: MEMBERSHIP_PRICES['0_999'].monthly,
    credits: 1,
    discount: '20%',
    icon: RiCalendarLine,
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
    icon: RiGiftLine,
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
    icon: RiVipCrownLine,
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

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <div className="border-b border-border/50">
        <div className="container max-w-7xl mx-auto px-4 py-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/account")} className="text-muted-foreground -ml-2">
            <RiArrowLeftLine className="w-4 h-4 mr-1.5" /> Back to Account
          </Button>
        </div>
      </div>

      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0" style={{ background: 'var(--gradient-hero)' }} />
        <div className="absolute inset-0 opacity-[0.03]" style={{ background: 'var(--gradient-primary)' }} />
        <div className="relative container max-w-7xl mx-auto px-4 py-12 md:py-20">
          <div className="text-center space-y-4 max-w-2xl mx-auto animate-fade-in-up">
            <Badge className="bg-primary/10 text-primary border-primary/20 shadow-none px-4 py-1.5">
              <RiSparklingLine className="w-3.5 h-3.5 mr-1.5" />
              Membership Plans
            </Badge>
            <h1 className="text-3xl md:text-5xl lg:text-6xl font-bold font-jakarta tracking-tight">
              Choose Your <span className="gradient-text">Perfect Plan</span>
            </h1>
            <p className="text-base md:text-lg text-muted-foreground leading-relaxed">
              Subscribe today and enjoy consistent, professional cleaning at a fraction of one-time pricing.
              All plans include a complimentary deep clean on your first visit.
            </p>
            <p className="text-xs text-muted-foreground/70">
              Prices vary by home size. Click a plan to see your exact monthly cost.
            </p>
          </div>
        </div>
      </div>

      <div className="container max-w-7xl mx-auto px-4 -mt-4 pb-16">
        {/* Active Subscription Banner */}
        {subscription?.subscribed && (
          <Card className={cn(
            "mb-8 shadow-md animate-fade-in-up",
            subscription?.is_paused
              ? 'border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-950/20'
              : 'border-emerald-300 dark:border-emerald-700 bg-emerald-50/60 dark:bg-emerald-950/20'
          )}>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center",
                    subscription?.is_paused ? "bg-amber-100 dark:bg-amber-900/40" : "bg-emerald-100 dark:bg-emerald-900/40"
                  )}>
                    {subscription?.is_paused
                      ? <RiPauseCircleLine className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                      : <RiCheckboxCircleLine className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                    }
                  </div>
                  <div>
                    <CardTitle className="text-base">
                      {subscription?.is_paused ? 'Membership Paused' : 'Active Membership'}
                    </CardTitle>
                    <CardDescription className="mt-0.5">
                      {subscription?.is_paused ? (
                        <>
                          Your subscription is paused
                          {subscription.resumes_at && (
                            <span className="block mt-0.5 font-medium text-foreground">
                              Resumes on {new Date(subscription.resumes_at).toLocaleDateString()}
                            </span>
                          )}
                        </>
                      ) : (
                        'You have an active Novara Membership'
                      )}
                    </CardDescription>
                  </div>
                </div>
                <Button
                  variant={subscription?.is_paused ? "default" : "outline"}
                  size="sm"
                  className="rounded-lg"
                  onClick={() => setPauseResumeDialogOpen(true)}
                >
                  {subscription?.is_paused ? (
                    <><RiPlayCircleLine className="w-4 h-4 mr-1.5" /> Resume</>
                  ) : (
                    <><RiPauseCircleLine className="w-4 h-4 mr-1.5" /> Pause</>
                  )}
                </Button>
              </div>
              
              {subscription?.is_paused && (
                <div className="mt-4 p-3 rounded-xl bg-amber-100/50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                  <div className="flex items-start gap-2.5">
                    <RiAlertLine className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                    <div className="text-sm text-muted-foreground">
                      <p className="font-medium text-foreground">Your membership is on hold</p>
                      <p className="mt-0.5">While paused, you won't be charged and credits won't be issued. Resume anytime.</p>
                    </div>
                  </div>
                </div>
              )}
            </CardHeader>
          </Card>
        )}

        {/* Plan Cards */}
        <div className="grid md:grid-cols-3 gap-5 lg:gap-6 mb-16">
          {MEMBERSHIP_TIERS.map((tier, index) => {
            const Icon = tier.icon;
            
            return (
              <Card
                key={tier.id}
                className={cn(
                  "relative overflow-hidden transition-all duration-300 hover:shadow-xl cursor-pointer group animate-fade-in-up",
                  tier.popular
                    ? 'border-primary shadow-lg md:scale-[1.03] z-10'
                    : 'hover:border-primary/40',
                  index === 0 && 'stagger-1',
                  index === 1 && 'stagger-2',
                  index === 2 && 'stagger-3',
                )}
                onClick={() => navigate(`/membership/${tier.id}`)}
              >
                {tier.popular && (
                  <div className="absolute top-0 left-0 right-0 h-1" style={{ background: 'var(--gradient-primary)' }} />
                )}

                {tier.popular && (
                  <div className="absolute top-3 right-3">
                    <Badge className="bg-gradient-primary text-white border-0 shadow-md text-[10px] font-bold uppercase tracking-wider px-2.5 py-1">
                      Most Popular
                    </Badge>
                  </div>
                )}

                <CardHeader className="text-center space-y-4 pb-6 pt-8">
                  <div className={cn(
                    "mx-auto w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg transition-transform group-hover:scale-110",
                  )} style={{ background: 'var(--gradient-primary)' }}>
                    <Icon className="w-7 h-7 text-white" />
                  </div>
                  
                  <div>
                    <CardTitle className="text-xl mb-1.5">{tier.name}</CardTitle>
                    <div className="flex items-baseline justify-center gap-1">
                      <span className="text-3xl font-bold">${tier.startingPrice}</span>
                      <span className="text-muted-foreground text-sm">/month</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">starting price</p>
                  </div>

                  <Badge variant="secondary" className="text-xs px-3 py-1 rounded-lg">
                    <RiFlashlightLine className="w-3 h-3 mr-1" />
                    {tier.credits} {tier.credits === 1 ? 'Credit' : 'Credits'}/Month &middot; Save {tier.discount}
                  </Badge>
                </CardHeader>

                <CardContent className="space-y-5 pb-8">
                  <Separator />
                  
                  <ul className="space-y-3">
                    {tier.features.map((feature, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        <RiCheckboxCircleLine className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                        <span className="text-sm text-muted-foreground">{feature}</span>
                      </li>
                    ))}
                  </ul>

                  <Button className={cn(
                    "w-full h-11 rounded-xl shadow-md transition-all",
                    tier.popular ? "bg-gradient-primary" : "bg-primary hover:bg-primary/90"
                  )}>
                    View Plan Details
                    <RiArrowRightLine className="w-4 h-4 ml-2" />
                  </Button>

                  <p className="text-[11px] text-center text-muted-foreground">
                    +$75 first-month deep clean &middot; Cancel anytime
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Why Choose Section */}
        <Card className="border-0 shadow-lg overflow-hidden">
          <div className="h-0.5 w-full" style={{ background: 'var(--gradient-primary)' }} />
          <CardHeader className="text-center pt-10">
            <CardTitle className="text-2xl md:text-3xl font-jakarta tracking-tight">Why Choose Novara Membership?</CardTitle>
            <CardDescription className="text-base mt-2">
              Join thousands of satisfied members enjoying hassle-free cleaning
            </CardDescription>
          </CardHeader>
          <CardContent className="pb-10">
            <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
              {[
                { icon: RiGiftLine, title: "Monthly Credits", desc: "Use your credits for professional cleaning services, anytime you need them" },
                { icon: RiFlashlightLine, title: "Exclusive Discounts", desc: "Save up to 30% on all add-ons, upgrades, and extra cleaning hours" },
                { icon: RiCalendarLine, title: "Flexible Scheduling", desc: "Priority booking windows and easy rescheduling with no fees" },
              ].map((item, i) => (
                <div key={i} className="text-center space-y-3">
                  <div className="mx-auto w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: 'var(--gradient-lavender)' }}>
                    <item.icon className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="font-semibold">{item.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* CTA */}
        <div className="text-center mt-10 space-y-3">
          <p className="text-muted-foreground text-sm">
            Not ready for a membership?{' '}
            <Button variant="link" onClick={() => navigate('/book/zip')} className="p-0 h-auto text-primary">
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
