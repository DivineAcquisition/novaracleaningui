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
import {
  Sparkles, CheckCircle2, ArrowRight, ChevronDown, Shield,
  Clock, CalendarCheck, Star, Users, Repeat, Crown,
} from "lucide-react";

// ─── Plan metadata ──────────────────────────────────────
const PLAN_META = {
  monthly: {
    name: "Glow Monthly",
    tagline: "One professional clean every month — your home stays fresh effortlessly.",
    icon: CalendarCheck,
    color: "from-primary to-accent",
    credits: 1,
    includedHours: "up to 2 hrs",
    benefits: [
      { icon: Star, text: "1 cleaning credit per month (up to 2 hrs)" },
      { icon: Shield, text: "48-hour reclean guarantee" },
      { icon: Users, text: "Priority customer support" },
      { icon: Sparkles, text: "20% off extra hours & add-ons" },
    ],
  },
  biweekly: {
    name: "Glow Bi-Weekly",
    tagline: "Two cleans a month — the sweet spot for a consistently clean home.",
    icon: Repeat,
    color: "from-primary to-accent",
    credits: 2,
    includedHours: "up to 3 hrs each",
    popular: true,
    benefits: [
      { icon: Star, text: "2 cleaning credits per month (up to 3 hrs each)" },
      { icon: Users, text: "Dedicated cleaner match" },
      { icon: Sparkles, text: "25% off deep cleans & add-ons" },
      { icon: Shield, text: "Satisfaction guarantee" },
    ],
  },
  weekly: {
    name: "Glow Weekly",
    tagline: "Four cleans a month — premium care for busy households.",
    icon: Crown,
    color: "from-primary to-accent",
    credits: 4,
    includedHours: "up to 3 hrs each",
    benefits: [
      { icon: Star, text: "4 cleaning credits per month (up to 3 hrs each)" },
      { icon: Users, text: "Dedicated cleaner & preferred time slot" },
      { icon: Sparkles, text: "Free deep clean every 6 months" },
      { icon: Shield, text: "30% off extra hours & add-ons" },
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
        <p className="text-muted-foreground">Plan not found.</p>
      </div>
    );
  }

  const Icon = plan.icon;
  const prices = MEMBERSHIP_PRICES[selectedHomeSize];
  const selectedPrice = prices?.[planId as keyof typeof prices] || 0;
  const startingPrice = MEMBERSHIP_PRICES["0_999"]?.[planId as keyof typeof prices] || 0;

  // Filter out custom-quote sizes
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
      if (data?.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to start checkout. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* ─── Section 1: Hero ───────────────────────────── */}
      <section className="relative overflow-hidden bg-gradient-hero py-16 md:py-24">
        <div className="container max-w-4xl mx-auto px-4 text-center space-y-4">
          {'popular' in plan && plan.popular && (
            <Badge className="bg-gradient-primary text-primary-foreground border-0">Most Popular</Badge>
          )}
          <div className={`mx-auto w-20 h-20 rounded-2xl bg-gradient-to-br ${plan.color} flex items-center justify-center shadow-lg`}>
            <Icon className="w-10 h-10 text-primary-foreground" />
          </div>
          <h1 className="text-4xl md:text-5xl font-bold font-jakarta">{plan.name}</h1>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto">{plan.tagline}</p>
          <p className="text-3xl font-bold">
            Starting at <span className="text-primary">${startingPrice}</span>
            <span className="text-base font-normal text-muted-foreground">/month</span>
          </p>
          <p className="text-sm text-muted-foreground">
            {plan.credits} credit{plan.credits > 1 ? "s" : ""}/month • {plan.includedHours}
          </p>
        </div>
      </section>

      <div className="container max-w-4xl mx-auto px-4 py-12 space-y-12">
        {/* ─── Section 2: Home Size Pricing ─────────────── */}
        <section className="space-y-4">
          <h2 className="text-2xl font-bold font-jakarta text-center">Select Your Home Size</h2>
          <p className="text-center text-muted-foreground text-sm">Your monthly price depends on your home size.</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {selectableSizes.map((size) => {
              const price = MEMBERSHIP_PRICES[size.id]?.[planId as keyof typeof prices];
              const isSelected = selectedHomeSize === size.id;
              return (
                <button
                  key={size.id}
                  onClick={() => setSelectedHomeSize(size.id)}
                  className={`p-4 rounded-xl border-2 text-left transition-all ${
                    isSelected
                      ? "border-primary bg-primary/5 shadow-md"
                      : "border-border hover:border-primary/30"
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-semibold text-sm">{size.sqftRange} sqft</p>
                      <p className="text-xs text-muted-foreground">{size.bedrooms} BR</p>
                    </div>
                    <span className={`text-lg font-bold ${isSelected ? "text-primary" : ""}`}>
                      ${price}
                      <span className="text-xs font-normal text-muted-foreground">/mo</span>
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="py-4 flex items-center justify-between">
              <div>
                <p className="font-semibold">Your monthly price</p>
                <p className="text-sm text-muted-foreground">
                  First month: ${selectedPrice + 75} (includes $75 deep clean)
                </p>
              </div>
              <p className="text-3xl font-bold text-primary">${selectedPrice}<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
            </CardContent>
          </Card>
        </section>

        <Separator />

        {/* ─── Section 3: Benefits ─────────────────────── */}
        <section className="space-y-6">
          <h2 className="text-2xl font-bold font-jakarta text-center">What's Included</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {plan.benefits.map((b, i) => {
              const BIcon = b.icon;
              return (
                <div key={i} className="flex items-start gap-3 p-4 rounded-xl border border-border bg-card">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <BIcon className="w-5 h-5 text-primary" />
                  </div>
                  <p className="text-sm font-medium pt-2">{b.text}</p>
                </div>
              );
            })}
          </div>
        </section>

        <Separator />

        {/* ─── Section 4: How It Works ─────────────────── */}
        <section className="space-y-6">
          <h2 className="text-2xl font-bold font-jakarta text-center">How It Works</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            {[
              { step: "1", label: "Subscribe", desc: "Choose your plan & home size" },
              { step: "2", label: "Schedule", desc: "Book your first cleaning" },
              { step: "3", label: "We Clean", desc: "Our team arrives on time" },
              { step: "4", label: "Repeat", desc: "Credits renew monthly" },
            ].map((s) => (
              <div key={s.step} className="space-y-2">
                <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-lg font-bold text-primary">{s.step}</span>
                </div>
                <p className="font-semibold text-sm">{s.label}</p>
                <p className="text-xs text-muted-foreground">{s.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <Separator />

        {/* ─── Section 5: Terms & Disclaimer ───────────── */}
        <Collapsible open={termsOpen} onOpenChange={setTermsOpen}>
          <CollapsibleTrigger asChild>
            <button className="w-full flex items-center justify-between p-4 rounded-xl border border-border hover:bg-muted/50 transition-colors">
              <span className="font-semibold text-sm">Terms & Disclaimer</span>
              <ChevronDown className={`w-4 h-4 transition-transform ${termsOpen ? "rotate-180" : ""}`} />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 p-4 rounded-xl border border-border bg-muted/30 space-y-3 text-sm text-muted-foreground">
              <p><strong>Recurring Billing:</strong> By subscribing, you authorize recurring monthly billing to your payment method on file. (Section 5.1)</p>
              <p><strong>Cancellation:</strong> Cancellation requires 14 days' written notice before the next billing cycle. Cancellation must be submitted in writing via email or your member portal. (Sections 6.2, 6.5)</p>
              <p><strong>Rescheduling:</strong> Rescheduling requires 48 hours' notice before the scheduled service. (Section 4.4)</p>
              <p><strong>Refund Policy:</strong> No refunds are issued for subjective dissatisfaction. If you're unsatisfied, report within 24 hours for one complimentary re-clean. (Sections 6.4, 7)</p>
              <p><strong>First Clean Surcharge:</strong> All new memberships include a mandatory +$75 deep clean surcharge on the first month to ensure your home starts with a thorough cleaning.</p>
              <p className="pt-2">
                <a href="https://novaracleaning.com/terms" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                  Read full Terms of Service →
                </a>
              </p>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* ─── Section 6: Subscribe CTA ────────────────── */}
        <Card className="border-primary/20">
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Ready to join?</CardTitle>
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
              className="w-full h-14 text-lg bg-gradient-primary shadow-lg"
            >
              {loading ? "Processing..." : (
                <>
                  Subscribe — ${selectedPrice}/mo
                  <ArrowRight className="w-5 h-5 ml-2" />
                </>
              )}
            </Button>

            <p className="text-xs text-center text-muted-foreground">
              First month total: ${selectedPrice + 75} (includes $75 deep clean). Cancel anytime with 14 days' notice.
            </p>
          </CardContent>
        </Card>

        {/* Back link */}
        <div className="text-center">
          <Button variant="ghost" onClick={() => navigate("/membership")}>
            ← Back to all plans
          </Button>
        </div>
      </div>
    </div>
  );
}
