import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Crown,
  Shield,
  Sparkles,
  Star,
  Clock,
  Phone,
  Zap,
  Home,
  Award,
} from "lucide-react";
import { cn } from "@/lib/utils";
import logo from "@/assets/logo.png";
import {
  HOME_SIZE_RANGES,
  SERVICE_TIER_PRICING,
  ADD_ONS,
  MEMBERSHIP_PLANS,
  DEPOSIT_AMOUNT,
  NEW_CUSTOMER_DISCOUNT,
} from "@/lib/pricing-system";

// ─── Pricing data derived from the system ───────────────
const SERVICE_TIERS = [
  {
    key: "standard",
    name: "Standard Clean",
    addition: 0,
    description: "Routine maintenance cleaning for a tidy home",
    features: [
      "Dusting all surfaces",
      "Vacuuming & mopping floors",
      "Kitchen & bathroom cleaning",
      "Trash removal & bed making",
    ],
  },
  {
    key: "deep",
    name: "Deep Clean",
    addition: 50,
    badge: "Most Popular",
    description: "Top-to-bottom deep clean for a fresh reset",
    features: [
      "Everything in Standard",
      "40-point deep cleaning checklist",
      "Baseboards, door frames & vents",
      "Light fixtures & ceiling fans",
      "Interior window sills",
      "Behind & under appliances",
    ],
  },
  {
    key: "moveInOut",
    name: "Move-In/Move-Out",
    addition: 120,
    description: "Comprehensive clean for moving transitions",
    features: [
      "Everything in Deep Clean",
      "Inside oven & fridge included",
      "Inside all cabinets & drawers",
      "Closet interiors cleaned",
      "Garage sweep (if applicable)",
    ],
  },
];

const MEMBERSHIP_TIERS = [
  {
    key: "essential",
    plan: MEMBERSHIP_PLANS.essential,
    color: "primary",
    icon: Sparkles,
  },
  {
    key: "standard",
    plan: MEMBERSHIP_PLANS.standard,
    color: "primary",
    icon: Star,
    popular: true,
  },
  {
    key: "premium",
    plan: MEMBERSHIP_PLANS.premium,
    color: "primary",
    icon: Crown,
  },
];

export default function PricingSheet() {
  const navigate = useNavigate();

  const handleBookNow = () => {
    navigate("/book/zip");
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Navigation */}
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-white/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={logo} alt="Novara" className="w-9 h-9 rounded-xl" />
            <span className="text-lg font-bold tracking-tight font-jakarta">
              Novara<span className="text-[#5C0FFE]">Cleaning</span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="tel:9725590223"
              className="hidden sm:flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <Phone className="w-4 h-4" />
              (972) 559-0223
            </a>
            <Button
              onClick={handleBookNow}
              className="h-10 px-6 font-semibold bg-[#5C0FFE] hover:bg-[#5C0FFE]/90 text-white"
            >
              Book Now
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[#5C0FFE]/[0.03] via-white to-white" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-[#8F7BFD]/[0.06] rounded-full blur-3xl" />

        <div className="relative container mx-auto px-4 pt-16 pb-12 md:pt-24 md:pb-16">
          <div className="max-w-3xl mx-auto text-center space-y-6">
            <Badge className="bg-[#5C0FFE]/10 text-[#5C0FFE] border-[#5C0FFE]/20 hover:bg-[#5C0FFE]/10 px-4 py-1.5">
              <Shield className="w-3.5 h-3.5 mr-1.5" />
              Transparent Pricing — No Hidden Fees
            </Badge>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight font-jakarta leading-[1.1]">
              Simple,{" "}
              <span className="bg-gradient-to-r from-[#5C0FFE] to-[#8F7BFD] bg-clip-text text-transparent">
                Honest
              </span>{" "}
              Pricing
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
              Premium residential cleaning starting at just $39 deposit. Choose
              your home size, pick your service, and book in minutes.
            </p>
          </div>
        </div>
      </section>

      {/* How Pricing Works */}
      <section className="container mx-auto px-4 pb-16">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
            {[
              {
                icon: Home,
                title: "1. Pick Home Size",
                desc: "Pricing is based on your home's square footage",
              },
              {
                icon: Sparkles,
                title: "2. Choose Service",
                desc: "Standard, Deep Clean, or Move-In/Out",
              },
              {
                icon: Zap,
                title: "3. Pay $39 Deposit",
                desc: "Balance due after your cleaning is complete",
              },
            ].map((s) => (
              <div
                key={s.title}
                className="flex items-start gap-3 p-4 rounded-xl bg-[#5C0FFE]/[0.03] border border-[#5C0FFE]/10"
              >
                <div className="w-10 h-10 rounded-xl bg-[#5C0FFE]/10 flex items-center justify-center flex-shrink-0">
                  <s.icon className="w-5 h-5 text-[#5C0FFE]" />
                </div>
                <div>
                  <p className="font-semibold text-sm">{s.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {s.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* ─── Home Size Pricing Table ─────────────────────── */}
          <div className="mb-6 text-center">
            <h2 className="text-2xl md:text-3xl font-bold font-jakarta">
              Pricing by Home Size
            </h2>
            <p className="text-muted-foreground mt-2">
              Base price for a standard clean. Deep clean and move-in/out are
              additional.
            </p>
          </div>

          <Card className="border border-border/60 shadow-lg overflow-hidden mb-8">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#5C0FFE] text-white">
                    <th className="text-left py-3.5 px-4 font-semibold">
                      Home Size
                    </th>
                    <th className="text-left py-3.5 px-4 font-semibold hidden sm:table-cell">
                      Bedrooms
                    </th>
                    <th className="text-center py-3.5 px-4 font-semibold">
                      Standard
                    </th>
                    <th className="text-center py-3.5 px-4 font-semibold">
                      Deep Clean
                    </th>
                    <th className="text-center py-3.5 px-4 font-semibold">
                      Move-In/Out
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {HOME_SIZE_RANGES.filter((s) => s.id !== "5000_plus").map(
                    (size, idx) => (
                      <tr
                        key={size.id}
                        className={cn(
                          "border-b border-border/40 transition-colors hover:bg-[#5C0FFE]/[0.02]",
                          idx % 2 === 0 ? "bg-white" : "bg-[#F8F7FF]"
                        )}
                      >
                        <td className="py-3 px-4 font-medium">{size.label}</td>
                        <td className="py-3 px-4 text-muted-foreground hidden sm:table-cell">
                          {size.bedroomRange}
                        </td>
                        <td className="py-3 px-4 text-center font-semibold">
                          ${size.standardPrice.toFixed(0)}
                        </td>
                        <td className="py-3 px-4 text-center font-semibold text-[#5C0FFE]">
                          ${(size.standardPrice + 50).toFixed(0)}
                        </td>
                        <td className="py-3 px-4 text-center font-semibold">
                          ${(size.standardPrice + 120).toFixed(0)}
                        </td>
                      </tr>
                    )
                  )}
                  <tr className="bg-[#5C0FFE]/[0.04]">
                    <td className="py-3 px-4 font-medium" colSpan={2}>
                      5,000+ sq ft
                    </td>
                    <td className="py-3 px-4 text-center" colSpan={3}>
                      <a
                        href="tel:9725590223"
                        className="text-[#5C0FFE] font-semibold hover:underline"
                      >
                        Call for Custom Quote
                      </a>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          {/* Deposit callout */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
            <div className="flex items-center gap-2 px-5 py-3 rounded-full bg-[#5C0FFE]/10 border border-[#5C0FFE]/20">
              <Zap className="w-4 h-4 text-[#5C0FFE]" />
              <span className="text-sm font-semibold text-[#5C0FFE]">
                Only ${DEPOSIT_AMOUNT} deposit to book
              </span>
            </div>
            <div className="flex items-center gap-2 px-5 py-3 rounded-full bg-green-500/10 border border-green-500/20">
              <Award className="w-4 h-4 text-green-600" />
              <span className="text-sm font-semibold text-green-700">
                New customers save ${NEW_CUSTOMER_DISCOUNT}
              </span>
            </div>
            <Button
              onClick={handleBookNow}
              className="h-11 px-8 font-semibold bg-[#5C0FFE] hover:bg-[#5C0FFE]/90 text-white shadow-lg"
            >
              Book Your Clean
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>

          {/* ─── Service Tiers ───────────────────────────────── */}
          <div className="mb-6 text-center">
            <h2 className="text-2xl md:text-3xl font-bold font-jakarta">
              Service Tiers
            </h2>
            <p className="text-muted-foreground mt-2">
              Every tier includes a professional 2-person team, all supplies,
              and our 48-hour re-clean guarantee.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-5 mb-16">
            {SERVICE_TIERS.map((tier) => (
              <Card
                key={tier.key}
                className={cn(
                  "relative border overflow-hidden transition-all hover:shadow-xl",
                  tier.badge
                    ? "border-[#5C0FFE]/40 shadow-lg"
                    : "border-border/50"
                )}
              >
                {tier.badge && (
                  <div className="absolute top-0 left-0 right-0 bg-[#5C0FFE] text-white text-center text-xs font-bold py-1.5 uppercase tracking-wider">
                    {tier.badge}
                  </div>
                )}
                <CardContent
                  className={cn("p-6 space-y-4", tier.badge && "pt-10")}
                >
                  <div>
                    <h3 className="text-xl font-bold font-jakarta">
                      {tier.name}
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      {tier.description}
                    </p>
                  </div>

                  <div className="flex items-baseline gap-1">
                    {tier.addition > 0 ? (
                      <>
                        <span className="text-sm text-muted-foreground">
                          Base price
                        </span>
                        <span className="text-lg font-bold text-[#5C0FFE]">
                          + ${tier.addition}
                        </span>
                      </>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        Base price (no surcharge)
                      </span>
                    )}
                  </div>

                  <Separator />

                  <ul className="space-y-2.5">
                    {tier.features.map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <Check className="w-4 h-4 text-[#5C0FFE] mt-0.5 flex-shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>

                  <Button
                    onClick={handleBookNow}
                    className={cn(
                      "w-full h-11 font-semibold",
                      tier.badge
                        ? "bg-[#5C0FFE] hover:bg-[#5C0FFE]/90 text-white"
                        : "bg-white border-2 border-[#5C0FFE]/30 text-[#5C0FFE] hover:bg-[#5C0FFE]/5"
                    )}
                    variant={tier.badge ? "default" : "outline"}
                  >
                    Book {tier.name}
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* ─── Add-Ons ─────────────────────────────────────── */}
          <div className="mb-6 text-center">
            <h2 className="text-2xl md:text-3xl font-bold font-jakarta">
              Add-On Services
            </h2>
            <p className="text-muted-foreground mt-2">
              Customize your clean with these optional extras.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-16">
            {Object.entries(ADD_ONS).map(([key, addon]) => (
              <Card
                key={key}
                className="border border-border/50 hover:border-[#5C0FFE]/30 transition-all"
              >
                <CardContent className="p-5 text-center space-y-2">
                  <p className="font-semibold">{addon.label}</p>
                  <p className="text-2xl font-bold text-[#5C0FFE]">
                    +${addon.price}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {key === "fridge"
                      ? "Deep clean inside your refrigerator"
                      : key === "oven"
                      ? "Degrease and deep clean your oven"
                      : "Clean all interior window surfaces"}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* ─── Novara Glow Membership ──────────────────────── */}
          <div className="mb-6 text-center">
            <Badge className="bg-[#5C0FFE]/10 text-[#5C0FFE] border-[#5C0FFE]/20 hover:bg-[#5C0FFE]/10 px-4 py-1.5 mb-4">
              <Crown className="w-3.5 h-3.5 mr-1.5" />
              Save Up to 30%
            </Badge>
            <h2 className="text-2xl md:text-3xl font-bold font-jakarta">
              Novara Glow Membership
            </h2>
            <p className="text-muted-foreground mt-2 max-w-xl mx-auto">
              Keep your home guest-ready year-round with recurring cleaning
              credits, priority scheduling, and exclusive member perks.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-5 mb-8">
            {MEMBERSHIP_TIERS.map((tier) => {
              const Icon = tier.icon;
              return (
                <Card
                  key={tier.key}
                  className={cn(
                    "relative border overflow-hidden transition-all hover:shadow-xl",
                    tier.popular
                      ? "border-[#5C0FFE]/40 shadow-lg"
                      : "border-border/50"
                  )}
                >
                  {tier.popular && (
                    <div className="absolute top-0 left-0 right-0 bg-gradient-to-r from-[#5C0FFE] to-[#8F7BFD] text-white text-center text-xs font-bold py-1.5 uppercase tracking-wider">
                      Best Value
                    </div>
                  )}
                  <CardContent
                    className={cn("p-6 space-y-5", tier.popular && "pt-10")}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-[#5C0FFE]/10 flex items-center justify-center">
                        <Icon className="w-5 h-5 text-[#5C0FFE]" />
                      </div>
                      <div>
                        <h3 className="font-bold font-jakarta">
                          {tier.plan.label}
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          {tier.plan.description.split("•")[0].trim()}
                        </p>
                      </div>
                    </div>

                    <div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-3xl font-extrabold text-[#5C0FFE]">
                          ${tier.plan.monthlyPrice}
                        </span>
                        <span className="text-muted-foreground text-sm">
                          /month
                        </span>
                      </div>
                    </div>

                    <Separator />

                    <ul className="space-y-2.5">
                      {tier.plan.features.map((f, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <CheckCircle2 className="w-4 h-4 text-[#5C0FFE] mt-0.5 flex-shrink-0" />
                          <span>{f}</span>
                        </li>
                      ))}
                      <li className="flex items-start gap-2 text-sm">
                        <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                        <span className="font-medium text-green-700">
                          48-hour re-clean guarantee
                        </span>
                      </li>
                    </ul>

                    <Button
                      onClick={handleBookNow}
                      className={cn(
                        "w-full h-11 font-semibold",
                        tier.popular
                          ? "bg-[#5C0FFE] hover:bg-[#5C0FFE]/90 text-white shadow-md"
                          : "bg-white border-2 border-[#5C0FFE]/30 text-[#5C0FFE] hover:bg-[#5C0FFE]/5"
                      )}
                      variant={tier.popular ? "default" : "outline"}
                    >
                      Get Started
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Membership CTA */}
          <div className="text-center mb-16">
            <p className="text-sm text-muted-foreground">
              All memberships are month-to-month. Cancel or pause anytime — no
              long-term contracts.
            </p>
          </div>

          {/* ─── Guarantees ──────────────────────────────────── */}
          <div className="rounded-2xl bg-gradient-to-br from-[#5C0FFE]/[0.04] to-[#8F7BFD]/[0.04] border border-[#5C0FFE]/10 p-8 md:p-12 mb-16">
            <div className="max-w-2xl mx-auto text-center space-y-6">
              <Shield className="w-12 h-12 text-[#5C0FFE] mx-auto" />
              <h2 className="text-2xl md:text-3xl font-bold font-jakarta">
                Our Guarantee
              </h2>
              <div className="grid sm:grid-cols-3 gap-6 text-center">
                {[
                  {
                    icon: CheckCircle2,
                    title: "48-Hour Re-Clean",
                    desc: "Not happy? We come back free within 48 hours.",
                  },
                  {
                    icon: Shield,
                    title: "Fully Insured",
                    desc: "Every team is background-checked, bonded & insured.",
                  },
                  {
                    icon: Clock,
                    title: "Always On Time",
                    desc: "99% on-time rate or your next clean is on us.",
                  },
                ].map((g) => (
                  <div key={g.title} className="space-y-2">
                    <g.icon className="w-8 h-8 text-[#5C0FFE] mx-auto" />
                    <p className="font-semibold text-sm">{g.title}</p>
                    <p className="text-xs text-muted-foreground">{g.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ─── Final CTA ───────────────────────────────────── */}
          <div className="text-center space-y-6 pb-8">
            <h2 className="text-2xl md:text-3xl font-bold font-jakarta">
              Ready for a Spotless Home?
            </h2>
            <p className="text-muted-foreground max-w-lg mx-auto">
              Book in under 2 minutes. Only ${DEPOSIT_AMOUNT} to reserve your
              spot. New customers save ${NEW_CUSTOMER_DISCOUNT} on their first
              clean.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Button
                onClick={handleBookNow}
                size="lg"
                className="h-14 px-10 text-base font-semibold bg-[#5C0FFE] hover:bg-[#5C0FFE]/90 text-white shadow-lg"
              >
                Book Your Clean Now
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
              <a href="tel:9725590223">
                <Button
                  variant="outline"
                  size="lg"
                  className="h-14 px-10 text-base font-semibold border-[#5C0FFE]/30 text-[#5C0FFE]"
                >
                  <Phone className="w-4 h-4 mr-2" />
                  Call (972) 559-0223
                </Button>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/40 bg-[#FAFAFE]">
        <div className="container mx-auto px-4 py-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <img src={logo} alt="Novara" className="w-7 h-7 rounded-lg" />
              <span className="text-sm font-bold font-jakarta">
                Novara<span className="text-[#5C0FFE]">Cleaning</span>
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <a
                href="https://novaracleaning.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground transition-colors"
              >
                Privacy Policy
              </a>
              <a
                href="https://novaracleaning.com/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground transition-colors"
              >
                Terms
              </a>
              <span>
                &copy; {new Date().getFullYear()} Novara Cleaning LLC
              </span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
