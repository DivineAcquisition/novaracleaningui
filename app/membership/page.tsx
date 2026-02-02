"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Crown,
  Check,
  Sparkles,
  Calendar,
  Shield,
  ArrowRight,
  ArrowLeft,
  Loader2,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const MEMBERSHIP_PLANS = [
  {
    id: "weekly",
    name: "Weekly",
    price: 149,
    period: "week",
    credits: 4,
    savings: "20%",
    features: [
      "4 cleaning credits/month",
      "20% off all services",
      "Priority scheduling",
      "Same team every time",
      "Cancel anytime",
    ],
    popular: false,
  },
  {
    id: "biweekly",
    name: "Bi-Weekly",
    price: 99,
    period: "2 weeks",
    credits: 2,
    savings: "15%",
    features: [
      "2 cleaning credits/month",
      "15% off all services",
      "Priority scheduling",
      "Flexible rescheduling",
      "Cancel anytime",
    ],
    popular: true,
  },
  {
    id: "monthly",
    name: "Monthly",
    price: 79,
    period: "month",
    credits: 1,
    savings: "10%",
    features: [
      "1 cleaning credit/month",
      "10% off all services",
      "Standard scheduling",
      "Flexible rescheduling",
      "Cancel anytime",
    ],
    popular: false,
  },
];

export default function Membership() {
  const router = useRouter();
  const { user, subscription } = useAuth();
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSelectPlan = async (planId: string) => {
    if (!user) {
      toast.info("Please sign in to subscribe");
      router.push("/auth");
      return;
    }

    setSelectedPlan(planId);
    setIsLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke("create-checkout", {
        body: {
          priceId: `price_${planId}`,
          mode: "subscription",
        },
      });

      if (error) throw error;

      if (data?.url) {
        window.location.href = data.url;
      }
    } catch (error: any) {
      console.error("Checkout error:", error);
      toast.error("Failed to start checkout. Please try again.");
    } finally {
      setIsLoading(false);
      setSelectedPlan(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-hero">
      {/* Header */}
      <header className="container mx-auto px-4 py-6">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm font-medium">Back</span>
          </Link>
          {user ? (
            <Link href="/account">
              <Button variant="outline" size="sm">
                My Account
              </Button>
            </Link>
          ) : (
            <Link href="/auth">
              <Button variant="outline" size="sm">
                Sign In
              </Button>
            </Link>
          )}
        </div>
      </header>

      <main className="container max-w-6xl mx-auto px-4 py-8">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12"
        >
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-primary shadow-lg mb-4">
            <Crown className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl md:text-4xl font-bold mb-3">
            Membership Plans
          </h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Save up to 20% on every cleaning with our membership plans. 
            Get priority scheduling, dedicated teams, and flexible credits.
          </p>
        </motion.div>

        {/* Current Subscription Notice */}
        {subscription?.subscribed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mb-8"
          >
            <Card className="bg-green-500/10 border-green-500/20">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Check className="w-5 h-5 text-green-500" />
                  <div>
                    <p className="font-medium">
                      You&apos;re subscribed to {subscription.plan_name}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Manage your subscription in your account
                    </p>
                  </div>
                </div>
                <Link href="/account">
                  <Button variant="outline" size="sm">
                    Manage
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Plans Grid */}
        <div className="grid md:grid-cols-3 gap-6 mb-12">
          {MEMBERSHIP_PLANS.map((plan, index) => (
            <motion.div
              key={plan.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <Card
                className={`relative h-full transition-all duration-300 hover:shadow-xl ${
                  plan.popular
                    ? "border-primary border-2 ring-4 ring-primary/20"
                    : "hover:border-primary/50"
                }`}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-gradient-primary text-white border-0">
                      <Sparkles className="w-3 h-3 mr-1" />
                      Most Popular
                    </Badge>
                  </div>
                )}

                <CardHeader className="text-center pb-2">
                  <CardTitle className="text-xl">{plan.name}</CardTitle>
                  <div className="mt-4">
                    <span className="text-4xl font-bold">${plan.price}</span>
                    <span className="text-muted-foreground">/{plan.period}</span>
                  </div>
                  <Badge variant="secondary" className="mt-2">
                    Save {plan.savings}
                  </Badge>
                </CardHeader>

                <CardContent className="space-y-4">
                  <div className="flex items-center justify-center gap-2 py-3 bg-muted/50 rounded-lg">
                    <Calendar className="w-4 h-4 text-primary" />
                    <span className="font-medium">
                      {plan.credits} credit{plan.credits > 1 ? "s" : ""}/month
                    </span>
                  </div>

                  <ul className="space-y-3">
                    {plan.features.map((feature, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <Check className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>

                  <Button
                    onClick={() => handleSelectPlan(plan.id)}
                    disabled={isLoading || subscription?.subscribed}
                    className={`w-full ${
                      plan.popular ? "bg-gradient-primary" : ""
                    }`}
                    variant={plan.popular ? "default" : "outline"}
                  >
                    {isLoading && selectedPlan === plan.id ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Processing...
                      </>
                    ) : subscription?.subscribed ? (
                      "Current Plan"
                    ) : (
                      <>
                        Get Started
                        <ArrowRight className="w-4 h-4 ml-2" />
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        {/* Benefits */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <Card className="bg-gradient-lavender border-primary/20">
            <CardContent className="p-8">
              <div className="grid md:grid-cols-3 gap-8 text-center">
                <div>
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                    <Calendar className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="font-semibold mb-1">Flexible Credits</h3>
                  <p className="text-sm text-muted-foreground">
                    Use your credits anytime. They never expire.
                  </p>
                </div>
                <div>
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                    <Shield className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="font-semibold mb-1">Satisfaction Guaranteed</h3>
                  <p className="text-sm text-muted-foreground">
                    Not happy? We&apos;ll re-clean for free within 48 hours.
                  </p>
                </div>
                <div>
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                    <Crown className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="font-semibold mb-1">Cancel Anytime</h3>
                  <p className="text-sm text-muted-foreground">
                    No contracts, no commitments. Cancel with one click.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </main>
    </div>
  );
}
