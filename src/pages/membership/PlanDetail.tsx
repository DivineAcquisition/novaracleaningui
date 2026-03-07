import {
  RiArrowDownSLine,
  RiArrowLeftLine,
  RiArrowRightLine,
  RiCalendarCheckLine,
  RiCheckLine,
  RiCheckboxCircleLine,
  RiGroupLine,
  RiLoader4Line,
  RiRepeatLine,
  RiShieldLine,
  RiSparklingLine,
  RiStarLine,
  RiTimeLine,
  RiVipCrownLine
} from "@remixicon/react";
import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { HOME_SIZES } from "@/config/brand-config";
import { MEMBERSHIP_PRICES } from "@/lib/pricing-system";

import { cn } from "@/lib/utils";
import { SEO } from "@/components/SEO";

const PLAN_META = {
  monthly: {
    name: "Glow Monthly",
    tagline: "One professional clean every month — your home stays fresh effortlessly.",
    icon: RiCalendarCheckLine,
    credits: 1,
    includedHours: "up to 2 hrs",
    benefits: [
      { icon: RiStarLine, text: "1 cleaning credit per month (up to 2 hrs)" },
      { icon: RiShieldLine, text: "48-hour reclean guarantee" },
      { icon: RiGroupLine, text: "Priority customer support" },
      { icon: RiSparklingLine, text: "20% off extra hours & add-ons" },
    ],
  },
  biweekly: {
    name: "Glow Bi-Weekly",
    tagline: "Two cleans a month — the sweet spot for a consistently clean home.",
    icon: RiRepeatLine,
    credits: 2,
    includedHours: "up to 3 hrs each",
    popular: true,
    benefits: [
      { icon: RiStarLine, text: "2 cleaning credits per month (up to 3 hrs each)" },
      { icon: RiGroupLine, text: "Dedicated cleaner match" },
      { icon: RiSparklingLine, text: "25% off deep cleans & add-ons" },
      { icon: RiShieldLine, text: "Satisfaction guarantee" },
    ],
  },
  weekly: {
    name: "Glow Weekly",
    tagline: "Four cleans a month — premium care for busy households.",
    icon: RiVipCrownLine,
    credits: 4,
    includedHours: "up to 3 hrs each",
    benefits: [
      { icon: RiStarLine, text: "4 cleaning credits per month (up to 3 hrs each)" },
      { icon: RiGroupLine, text: "Dedicated cleaner & preferred time slot" },
      { icon: RiSparklingLine, text: "Free deep clean every 6 months" },
      { icon: RiShieldLine, text: "30% off extra hours & add-ons" },
    ],
  },
} as const;

type PlanId = keyof typeof PLAN_META;

export default function PlanDetail() {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [selectedHomeSize, setSelectedHomeSize] = useState("1501_2000");
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const plan = PLAN_META[planId as PlanId];
  if (!plan) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-muted-foreground">Plan not found.</p>
          <Button variant="outline" onClick={() => navigate("/membership")}>View All Plans</Button>
        </div>
      </div>
    );
  }

  const Icon = plan.icon;
  const prices = MEMBERSHIP_PRICES[selectedHomeSize];
  const selectedPrice = prices?.[planId as keyof typeof prices] || 0;
  const startingPrice = MEMBERSHIP_PRICES["0_999"]?.[planId as keyof typeof prices] || 0;
  const selectableSizes = HOME_SIZES.filter(s => s.basePrice > 0);

  const handleSubscribe = async () => {
    if (!user) {
      toast.error("Please sign in first");
      navigate("/auth");
      return;
    }
    if (!agreedToTerms) {
      toast.error("Please agree to the Terms of Service");
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-checkout", {
        body: { mode: "subscription", membershipPlan: planId, homeSizeId: selectedHomeSize },
      });
      if (error) throw error;
      if (data?.url) window.location.href = data.url;
    } catch (err) {
      console.error(err);
      toast.error("Failed to start checkout. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <SEO title="Plan Details" description="View detailed pricing and benefits for your Novara Glow membership plan. Select your home size to see your exact monthly cost." />
      {/* Navigation */}
      <div className="border-b border-border/50">
        <div className="container max-w-4xl mx-auto px-4 py-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/membership")} className="-ml-2 text-muted-foreground">
            <RiArrowLeftLine className="w-4 h-4 mr-1.5" /> All Plans
          </Button>
        </div>
      </div>

      {/* Hero */}
      <section className="relative overflow-hidden py-14 md:py-20">
        <div className="absolute inset-0" style={{ background: 'var(--gradient-hero)' }} />
        <div className="absolute inset-0 opacity-[0.03]" style={{ background: 'var(--gradient-primary)' }} />
        <div className="relative container max-w-4xl mx-auto px-4 text-center space-y-4 animate-fade-in-up">
          {'popular' in plan && plan.popular && (
            <Badge className="bg-gradient-primary text-white border-0 shadow-md text-[10px] font-bold uppercase tracking-wider px-3 py-1">Most Popular</Badge>
          )}
          <div className="mx-auto w-16 h-16 rounded-2xl flex items-center justify-center shadow-lg" style={{ background: 'var(--gradient-primary)' }}>
            <Icon className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl md:text-5xl font-bold font-jakarta tracking-tight">{plan.name}</h1>
          <p className="text-base md:text-lg text-muted-foreground max-w-xl mx-auto">{plan.tagline}</p>
          <p className="text-2xl md:text-3xl font-bold">
            Starting at <span className="gradient-text">${startingPrice}</span>
            <span className="text-sm font-normal text-muted-foreground">/month</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {plan.credits} credit{plan.credits > 1 ? "s" : ""}/month &middot; {plan.includedHours}
          </p>
        </div>
      </section>

      <div className="container max-w-4xl mx-auto px-4 py-10 space-y-10">
        {/* Home Size Pricing */}
        <section className="space-y-4 animate-fade-in-up stagger-1">
          <div className="text-center">
            <h2 className="text-xl md:text-2xl font-bold font-jakarta">Select Your Home Size</h2>
            <p className="text-sm text-muted-foreground mt-1">Your monthly price depends on your home size</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {selectableSizes.map((size) => {
              const price = MEMBERSHIP_PRICES[size.id]?.[planId as keyof typeof prices];
              const isSelected = selectedHomeSize === size.id;
              return (
                <button
                  key={size.id}
                  onClick={() => setSelectedHomeSize(size.id)}
                  className={cn(
                    "p-4 rounded-xl border-2 text-left transition-all",
                    isSelected
                      ? "border-primary bg-primary/5 shadow-md"
                      : "border-border hover:border-primary/30"
                  )}
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-semibold text-sm">{size.sqftRange} sqft</p>
                      <p className="text-xs text-muted-foreground">{size.bedrooms} BR</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={cn("text-lg font-bold", isSelected && "text-primary")}>${price}</span>
                      <span className="text-[10px] text-muted-foreground">/mo</span>
                      {isSelected && (
                        <div className="w-5 h-5 bg-primary rounded-md flex items-center justify-center ml-1">
                          <RiCheckLine className="w-3 h-3 text-white" />
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <Card className="border-primary/20 bg-primary/5 shadow-sm">
            <CardContent className="py-4 flex items-center justify-between">
              <div>
                <p className="font-semibold text-sm">Your monthly price</p>
                <p className="text-xs text-muted-foreground">
                  First month: ${selectedPrice + 75} (includes $75 deep clean)
                </p>
              </div>
              <p className="text-2xl md:text-3xl font-bold text-primary">${selectedPrice}<span className="text-xs font-normal text-muted-foreground">/mo</span></p>
            </CardContent>
          </Card>
        </section>

        <Separator />

        {/* Benefits */}
        <section className="space-y-5 animate-fade-in-up stagger-2">
          <h2 className="text-xl md:text-2xl font-bold font-jakarta text-center">What's Included</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {plan.benefits.map((b, i) => {
              const BIcon = b.icon;
              return (
                <div key={i} className="flex items-start gap-3 p-4 rounded-xl border border-border bg-card shadow-sm">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--gradient-lavender)' }}>
                    <BIcon className="w-5 h-5 text-primary" />
                  </div>
                  <p className="text-sm font-medium pt-2">{b.text}</p>
                </div>
              );
            })}
          </div>
        </section>

        <Separator />

        {/* How It Works */}
        <section className="space-y-5 animate-fade-in-up stagger-3">
          <h2 className="text-xl md:text-2xl font-bold font-jakarta text-center">How It Works</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            {[
              { step: "1", label: "Subscribe", desc: "Choose your plan & home size" },
              { step: "2", label: "Schedule", desc: "Book your first cleaning" },
              { step: "3", label: "We Clean", desc: "Our team arrives on time" },
              { step: "4", label: "Repeat", desc: "Credits renew monthly" },
            ].map((s) => (
              <div key={s.step} className="space-y-2">
                <div className="mx-auto w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: 'var(--gradient-lavender)' }}>
                  <span className="text-base font-bold text-primary">{s.step}</span>
                </div>
                <p className="font-semibold text-sm">{s.label}</p>
                <p className="text-xs text-muted-foreground">{s.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <Separator />

        {/* Terms */}
        <Collapsible open={termsOpen} onOpenChange={setTermsOpen}>
          <CollapsibleTrigger asChild>
            <button className="w-full flex items-center justify-between p-4 rounded-xl border border-border hover:bg-muted/50 transition-colors">
              <span className="font-semibold text-sm">Terms & Disclaimer</span>
              <RiArrowDownSLine className={cn("w-4 h-4 transition-transform duration-200", termsOpen && "rotate-180")} />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 p-4 rounded-xl border border-border bg-muted/30 space-y-3 text-sm text-muted-foreground">
              <p><strong>Recurring Billing:</strong> By subscribing, you authorize recurring monthly billing to your payment method on file. (Section 5.1)</p>
              <p><strong>Cancellation:</strong> Cancellation requires 14 days' written notice before the next billing cycle. Must be submitted in writing via email or your member portal. (Sections 6.2, 6.5)</p>
              <p><strong>Rescheduling:</strong> Rescheduling requires 48 hours' notice before the scheduled service. (Section 4.4)</p>
              <p><strong>Refund Policy:</strong> No refunds for subjective dissatisfaction. If unsatisfied, report within 24 hours for one complimentary re-clean. (Sections 6.4, 7)</p>
              <p><strong>First Clean Surcharge:</strong> All new memberships include a mandatory +$75 deep clean surcharge on the first month.</p>
              <p className="pt-2">
                <a href="https://novaracleaning.com/terms" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                  Read full Terms of Service
                </a>
              </p>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Subscribe CTA */}
        <Card className="border-0 shadow-lg overflow-hidden">
          <div className="h-0.5 w-full" style={{ background: 'var(--gradient-primary)' }} />
          <CardHeader className="text-center">
            <CardTitle className="text-lg">Ready to join?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3">
              <Checkbox
                id="terms"
                checked={agreedToTerms}
                onCheckedChange={(v) => setAgreedToTerms(v === true)}
              />
              <label htmlFor="terms" className="text-sm text-muted-foreground cursor-pointer leading-relaxed">
                I agree to the{" "}
                <a href="https://novaracleaning.com/terms" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                  Terms of Service
                </a>{" "}
                and acknowledge the recurring billing, cancellation, and refund policies above.
              </label>
            </div>

            <Button
              onClick={handleSubscribe}
              disabled={loading || !agreedToTerms}
              className="w-full h-13 text-base bg-gradient-primary shadow-lg rounded-xl"
            >
              {loading ? (
                <><RiLoader4Line className="w-4 h-4 mr-2 animate-spin" /> Processing...</>
              ) : (
                <>
                  Subscribe — ${selectedPrice}/mo
                  <RiArrowRightLine className="w-5 h-5 ml-2" />
                </>
              )}
            </Button>

            <p className="text-[11px] text-center text-muted-foreground">
              First month total: ${selectedPrice + 75} (includes $75 deep clean). Cancel anytime with 14 days' notice.
            </p>
          </CardContent>
        </Card>

        {/* Back */}
        <div className="text-center pb-4">
          <Button variant="ghost" onClick={() => navigate("/membership")} className="text-muted-foreground">
            <RiArrowLeftLine className="w-4 h-4 mr-1.5" /> Back to all plans
          </Button>
        </div>
      </div>
    </div>
  );
}
