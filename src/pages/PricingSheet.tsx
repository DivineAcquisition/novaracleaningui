import {
  RiArrowRightLine,
  RiCheckLine,
  RiCheckboxCircleLine,
  RiFlashlightLine,
  RiGroupLine,
  RiHomeLine,
  RiMapPinLine,
  RiPhoneLine,
  RiShieldLine,
  RiSparklingLine,
  RiStarLine,
  RiTimeLine,
  RiTrophyLine,
  RiVipCrownLine
} from "@remixicon/react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

import { cn } from "@/lib/utils";
import logo from "@/assets/logo.png";
import {
  HOME_SIZE_RANGES, SERVICE_ZONES, ADD_ONS, MEMBERSHIP_PRICES,
  DEPOSIT_AMOUNT, NEW_CUSTOMER_DISCOUNT, FIRST_CLEAN_SURCHARGE,
  type ZoneId,
} from "@/lib/pricing-system";
import { SEO } from "@/components/SEO";

// ─── Precomputed pricing rows from the PDF ──────────────
const STANDARD_PRICES: Record<string, Record<ZoneId, number>> = {
  '0_999':     { B: 150, A: 173, C: 135 },
  '1000_1500': { B: 189, A: 217, C: 170 },
  '1501_2000': { B: 239, A: 275, C: 215 },
  '2001_2500': { B: 279, A: 321, C: 251 },
  '2501_3000': { B: 339, A: 390, C: 305 },
  '3001_3500': { B: 379, A: 436, C: 341 },
  '3501_4000': { B: 439, A: 505, C: 395 },
  '4001_4500': { B: 489, A: 562, C: 440 },
  '4501_5000': { B: 539, A: 620, C: 485 },
};

const DEEP_PRICES: Record<string, Record<ZoneId, number>> = {
  '0_999':     { B: 225, A: 259, C: 203 },
  '1000_1500': { B: 284, A: 327, C: 256 },
  '1501_2000': { B: 359, A: 413, C: 323 },
  '2001_2500': { B: 419, A: 482, C: 377 },
  '2501_3000': { B: 509, A: 585, C: 458 },
  '3001_3500': { B: 569, A: 654, C: 512 },
  '3501_4000': { B: 659, A: 758, C: 593 },
  '4001_4500': { B: 734, A: 844, C: 661 },
  '4501_5000': { B: 809, A: 930, C: 728 },
};

const MOVEINOUT_PRICES: Record<string, Record<ZoneId, number>> = {
  '0_999':     { B: 300, A: 345, C: 270 },
  '1000_1500': { B: 378, A: 435, C: 340 },
  '1501_2000': { B: 478, A: 550, C: 430 },
  '2001_2500': { B: 558, A: 642, C: 502 },
  '2501_3000': { B: 678, A: 780, C: 610 },
  '3001_3500': { B: 758, A: 872, C: 682 },
  '3501_4000': { B: 878, A: 1010, C: 790 },
  '4001_4500': { B: 978, A: 1125, C: 880 },
  '4501_5000': { B: 1078, A: 1240, C: 970 },
};

const MEMBERSHIP_ZONE_PRICES = {
  monthly: {
    '0_999':     { B: 129, A: 148, C: 116, savings: '14%' },
    '1000_1500': { B: 159, A: 183, C: 143, savings: '16%' },
    '1501_2000': { B: 199, A: 229, C: 179, savings: '17%' },
    '2001_2500': { B: 229, A: 263, C: 206, savings: '18%' },
    '2501_3000': { B: 279, A: 321, C: 251, savings: '18%' },
    '3001_3500': { B: 319, A: 367, C: 287, savings: '16%' },
    '3501_4000': { B: 369, A: 424, C: 332, savings: '16%' },
    '4001_4500': { B: 409, A: 470, C: 368, savings: '16%' },
    '4501_5000': { B: 459, A: 528, C: 413, savings: '15%' },
  },
  biweekly: {
    '0_999':     { B: 199, A: 229, C: 179, savings: '34%', perClean: 99.50 },
    '1000_1500': { B: 249, A: 286, C: 224, savings: '34%', perClean: 124.50 },
    '1501_2000': { B: 319, A: 367, C: 287, savings: '33%', perClean: 159.50 },
    '2001_2500': { B: 369, A: 424, C: 332, savings: '34%', perClean: 184.50 },
    '2501_3000': { B: 449, A: 516, C: 404, savings: '34%', perClean: 224.50 },
    '3001_3500': { B: 499, A: 574, C: 449, savings: '34%', perClean: 249.50 },
    '3501_4000': { B: 579, A: 666, C: 521, savings: '34%', perClean: 289.50 },
    '4001_4500': { B: 649, A: 746, C: 584, savings: '34%', perClean: 324.50 },
    '4501_5000': { B: 719, A: 827, C: 647, savings: '33%', perClean: 359.50 },
  },
  weekly: {
    '0_999':     { B: 349, A: 401, C: 314, savings: '42%', perClean: 87.25 },
    '1000_1500': { B: 449, A: 516, C: 404, savings: '41%', perClean: 112.25 },
    '1501_2000': { B: 569, A: 654, C: 512, savings: '40%', perClean: 142.25 },
    '2001_2500': { B: 659, A: 758, C: 593, savings: '41%', perClean: 164.75 },
    '2501_3000': { B: 799, A: 919, C: 719, savings: '41%', perClean: 199.75 },
    '3001_3500': { B: 899, A: 1034, C: 809, savings: '41%', perClean: 224.75 },
    '3501_4000': { B: 1039, A: 1195, C: 935, savings: '41%', perClean: 259.75 },
    '4001_4500': { B: 1159, A: 1333, C: 1043, savings: '41%', perClean: 289.75 },
    '4501_5000': { B: 1279, A: 1471, C: 1151, savings: '41%', perClean: 319.75 },
  },
};

const sizes = HOME_SIZE_RANGES.filter(s => s.id !== '5000_plus');

export default function PricingSheet() {
  const navigate = useNavigate();
  const [zone, setZone] = useState<ZoneId>('B');
  const handleBookNow = () => navigate("/book/zip");

  const Z = (prices: Record<ZoneId, number>) => prices[zone];

  return (
    <div className="min-h-screen bg-white">
      <SEO title="Pricing" description="Transparent home cleaning pricing based on your home size. Standard, deep, and move-in/out cleaning available. Starting at $99." />
      {/* Nav */}
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-white/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={logo} alt="Novara" className="w-9 h-9 rounded-xl" />
            <span className="text-lg font-bold tracking-tight font-jakarta">
              Novara<span className="text-[#5C0FFE]">Cleaning</span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <a href="tel:+18447352070" className="hidden sm:flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <RiPhoneLine className="w-4 h-4" />(844) 735-2070
            </a>
            <Button onClick={handleBookNow} className="h-10 px-6 font-semibold bg-[#5C0FFE] hover:bg-[#5C0FFE]/90 text-white">
              Book Now <RiArrowRightLine className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[#5C0FFE]/[0.03] via-white to-white" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-[#8F7BFD]/[0.06] rounded-full blur-3xl" />
        <div className="relative container mx-auto px-4 pt-16 pb-10 md:pt-24 md:pb-14">
          <div className="max-w-3xl mx-auto text-center space-y-6">
            <Badge className="bg-[#5C0FFE]/10 text-[#5C0FFE] border-[#5C0FFE]/20 hover:bg-[#5C0FFE]/10 px-4 py-1.5">
              <RiShieldLine className="w-3.5 h-3.5 mr-1.5" />Maryland Service Areas
            </Badge>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight font-jakarta leading-[1.1]">
              Simple, <span className="bg-gradient-to-r from-[#5C0FFE] to-[#8F7BFD] bg-clip-text text-transparent">Transparent</span> Pricing
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
              Zone-based pricing across Maryland. Only ${DEPOSIT_AMOUNT} deposit to book. New customers save ${NEW_CUSTOMER_DISCOUNT}.
            </p>
          </div>
        </div>
      </section>

      <div className="container mx-auto px-4 max-w-5xl">
        {/* ─── Zone Selector ─────────────────────────────── */}
        <div className="mb-10">
          <h2 className="text-xl font-bold font-jakarta text-center mb-4">Select Your Service Zone</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-3xl mx-auto">
            {(Object.entries(SERVICE_ZONES) as [ZoneId, typeof SERVICE_ZONES.A][]).map(([id, z]) => (
              <button
                key={id}
                onClick={() => setZone(id)}
                className={cn(
                  "relative p-4 rounded-xl border-2 text-left transition-all",
                  zone === id
                    ? "border-[#5C0FFE] bg-[#5C0FFE]/[0.04] shadow-md"
                    : "border-border/50 hover:border-[#5C0FFE]/30"
                )}
              >
                {zone === id && (
                  <div className="absolute -top-2 -right-2 w-6 h-6 bg-[#5C0FFE] rounded-full flex items-center justify-center">
                    <RiCheckLine className="w-3.5 h-3.5 text-white" />
                  </div>
                )}
                <div className="flex items-center gap-2 mb-1">
                  <RiMapPinLine className="w-4 h-4 text-[#5C0FFE]" />
                  <span className="font-bold text-sm">{z.label}</span>
                  {id === 'A' && <Badge className="bg-amber-500/10 text-amber-600 border-0 text-[10px]">+15%</Badge>}
                  {id === 'B' && <Badge variant="secondary" className="text-[10px]">Base</Badge>}
                  {id === 'C' && <Badge className="bg-green-500/10 text-green-600 border-0 text-[10px]">-10%</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">{z.areas}</p>
              </button>
            ))}
          </div>
        </div>

        {/* ─── One-Time Pricing ──────────────────────────── */}
        <div className="mb-6 text-center">
          <h2 className="text-2xl md:text-3xl font-bold font-jakarta">One-Time Cleaning</h2>
          <p className="text-muted-foreground mt-2">No commitment. Book a single clean anytime.</p>
        </div>

        <Tabs defaultValue="standard" className="mb-12">
          <TabsList className="grid w-full max-w-md mx-auto grid-cols-3 mb-6">
            <TabsTrigger value="standard">Standard</TabsTrigger>
            <TabsTrigger value="deep">Deep Clean</TabsTrigger>
            <TabsTrigger value="moveinout">Move-In/Out</TabsTrigger>
          </TabsList>

          {/* Standard */}
          <TabsContent value="standard">
            <Card className="border border-border/60 shadow-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#5C0FFE] text-white">
                      <th className="text-left py-3 px-4 font-semibold">Home Size</th>
                      <th className="text-left py-3 px-4 font-semibold hidden sm:table-cell">Bedrooms</th>
                      <th className="text-center py-3 px-4 font-semibold">Price</th>
                      <th className="text-center py-3 px-4 font-semibold hidden sm:table-cell">Cleaners</th>
                      <th className="text-center py-3 px-4 font-semibold hidden sm:table-cell">Hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sizes.map((s, idx) => (
                      <tr key={s.id} className={cn("border-b border-border/40 hover:bg-[#5C0FFE]/[0.02]", idx % 2 === 0 ? "bg-white" : "bg-[#F8F7FF]")}>
                        <td className="py-3 px-4 font-medium text-xs sm:text-sm">{s.label}</td>
                        <td className="py-3 px-4 text-muted-foreground text-xs hidden sm:table-cell">{s.bedroomRange}</td>
                        <td className="py-3 px-4 text-center font-bold text-[#5C0FFE]">${Z(STANDARD_PRICES[s.id])}</td>
                        <td className="py-3 px-4 text-center text-muted-foreground hidden sm:table-cell">{s.cleaners}</td>
                        <td className="py-3 px-4 text-center text-muted-foreground hidden sm:table-cell">{s.baseHours}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>

          {/* Deep Clean */}
          <TabsContent value="deep">
            <div className="text-center mb-4">
              <Badge className="bg-[#5C0FFE]/10 text-[#5C0FFE] border-0">Standard Price × 1.5</Badge>
            </div>
            <Card className="border border-border/60 shadow-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#5C0FFE] text-white">
                      <th className="text-left py-3 px-4 font-semibold">Home Size</th>
                      <th className="text-center py-3 px-4 font-semibold">Deep Clean Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sizes.map((s, idx) => (
                      <tr key={s.id} className={cn("border-b border-border/40", idx % 2 === 0 ? "bg-white" : "bg-[#F8F7FF]")}>
                        <td className="py-3 px-4 font-medium text-xs sm:text-sm">{s.label}</td>
                        <td className="py-3 px-4 text-center font-bold text-[#5C0FFE]">${Z(DEEP_PRICES[s.id])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>

          {/* Move-In/Out */}
          <TabsContent value="moveinout">
            <div className="text-center mb-4">
              <Badge className="bg-[#5C0FFE]/10 text-[#5C0FFE] border-0">Standard Price × 2.0 — Includes Fridge & Oven</Badge>
            </div>
            <Card className="border border-border/60 shadow-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#5C0FFE] text-white">
                      <th className="text-left py-3 px-4 font-semibold">Home Size</th>
                      <th className="text-center py-3 px-4 font-semibold">Move-In/Out Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sizes.map((s, idx) => (
                      <tr key={s.id} className={cn("border-b border-border/40", idx % 2 === 0 ? "bg-white" : "bg-[#F8F7FF]")}>
                        <td className="py-3 px-4 font-medium text-xs sm:text-sm">{s.label}</td>
                        <td className="py-3 px-4 text-center font-bold text-[#5C0FFE]">${Z(MOVEINOUT_PRICES[s.id]).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>
        </Tabs>

        {/* CTA Strip */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-16">
          <div className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#5C0FFE]/10 border border-[#5C0FFE]/20">
            <RiFlashlightLine className="w-4 h-4 text-[#5C0FFE]" />
            <span className="text-sm font-semibold text-[#5C0FFE]">${DEPOSIT_AMOUNT} deposit to book</span>
          </div>
          <div className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-green-500/10 border border-green-500/20">
            <RiTrophyLine className="w-4 h-4 text-green-600" />
            <span className="text-sm font-semibold text-green-700">New customers save ${NEW_CUSTOMER_DISCOUNT}</span>
          </div>
          <Button onClick={handleBookNow} className="h-11 px-8 font-semibold bg-[#5C0FFE] hover:bg-[#5C0FFE]/90 text-white shadow-lg">
            Book Your Clean <RiArrowRightLine className="w-4 h-4 ml-2" />
          </Button>
        </div>

        {/* ─── Add-Ons ───────────────────────────────────── */}
        <div className="mb-6 text-center">
          <h2 className="text-2xl md:text-3xl font-bold font-jakarta">Add-On Services</h2>
          <p className="text-muted-foreground mt-2">Available with any service type. All zones same price.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-16">
          {Object.entries(ADD_ONS).map(([key, addon]) => (
            <Card key={key} className="border border-border/50 hover:border-[#5C0FFE]/30 transition-all">
              <CardContent className="p-5 text-center space-y-2">
                <p className="font-semibold">{addon.label}</p>
                <p className="text-2xl font-bold text-[#5C0FFE]">+${addon.price}</p>
                <p className="text-xs text-muted-foreground">{addon.note}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* ─── Novara Glow Membership (Recurring Services) ── */}
        <div className="mb-8 text-center">
          <Badge className="bg-[#5C0FFE]/10 text-[#5C0FFE] border-[#5C0FFE]/20 hover:bg-[#5C0FFE]/10 px-4 py-1.5 mb-4">
            <RiVipCrownLine className="w-3.5 h-3.5 mr-1.5" />Save Up to 42%
          </Badge>
          <h2 className="text-2xl md:text-3xl font-bold font-jakarta">Novara Glow Membership</h2>
          <p className="text-muted-foreground mt-2 max-w-2xl mx-auto">
            Recurring cleaning services at a fraction of the one-time price. Choose your frequency — <span className="font-semibold text-foreground">Monthly</span>, <span className="font-semibold text-foreground">Bi-Weekly</span>, or <span className="font-semibold text-foreground">Weekly</span> — and enjoy consistent, reliable cleaning with the same trusted team. Cancel or pause anytime.
          </p>
          <p className="text-xs text-amber-600 font-medium mt-3">
            * First month: +${FIRST_CLEAN_SURCHARGE} required deep clean for all new members
          </p>
        </div>

        {/* Frequency Cards */}
        <div className="grid md:grid-cols-3 gap-5 mb-10">
          {/* Monthly */}
          <Card className="border border-border/50 hover:shadow-lg transition-all">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#5C0FFE]/10 flex items-center justify-center">
                  <RiSparklingLine className="w-5 h-5 text-[#5C0FFE]" />
                </div>
                <div>
                  <h3 className="font-bold font-jakarta">Monthly</h3>
                  <p className="text-xs text-muted-foreground">1 clean per month</p>
                </div>
              </div>
              <div className="text-center py-2">
                <span className="text-sm text-muted-foreground">Starting at</span>
                <p className="text-3xl font-extrabold text-[#5C0FFE]">
                  ${zone === 'A' ? 148 : zone === 'C' ? 116 : 129}<span className="text-base font-normal text-muted-foreground">/mo</span>
                </p>
                <Badge variant="secondary" className="mt-1 text-[10px]">Up to 18% off one-time price</Badge>
              </div>
              <Separator />
              <ul className="space-y-2">
                {['1 standard clean per month', 'Priority scheduling', 'Cancel anytime', 'No long-term contract'].map((f, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs"><RiCheckboxCircleLine className="w-3.5 h-3.5 text-[#5C0FFE]" />{f}</li>
                ))}
              </ul>
              <Button onClick={handleBookNow} variant="outline" className="w-full h-10 font-semibold border-[#5C0FFE]/30 text-[#5C0FFE] hover:bg-[#5C0FFE]/5">
                Get Started <RiArrowRightLine className="w-4 h-4 ml-1" />
              </Button>
            </CardContent>
          </Card>

          {/* Bi-Weekly (Best Value) */}
          <Card className="relative border-2 border-[#5C0FFE]/40 shadow-xl hover:shadow-2xl transition-all">
            <div className="absolute top-0 left-0 right-0 bg-gradient-to-r from-[#5C0FFE] to-[#8F7BFD] text-white text-center text-xs font-bold py-2 uppercase tracking-wider">
              Best Value — 34% Off
            </div>
            <CardContent className="p-6 pt-12 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#5C0FFE]/10 flex items-center justify-center">
                  <RiStarLine className="w-5 h-5 text-[#5C0FFE]" />
                </div>
                <div>
                  <h3 className="font-bold font-jakarta">Bi-Weekly</h3>
                  <p className="text-xs text-muted-foreground">2 cleans per month</p>
                </div>
              </div>
              <div className="text-center py-2">
                <span className="text-sm text-muted-foreground">Starting at</span>
                <p className="text-3xl font-extrabold text-[#5C0FFE]">
                  ${zone === 'A' ? 229 : zone === 'C' ? 179 : 199}<span className="text-base font-normal text-muted-foreground">/mo</span>
                </p>
                <Badge className="bg-green-500/10 text-green-600 border-0 mt-1 text-[10px]">Save up to 34% per clean</Badge>
              </div>
              <Separator />
              <ul className="space-y-2">
                {['2 standard cleans per month', 'Same trusted team every visit', 'Priority scheduling', 'Free add-ons included', 'Cancel or pause anytime'].map((f, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs"><RiCheckboxCircleLine className="w-3.5 h-3.5 text-[#5C0FFE]" />{f}</li>
                ))}
              </ul>
              <Button onClick={handleBookNow} className="w-full h-11 font-semibold bg-[#5C0FFE] hover:bg-[#5C0FFE]/90 text-white shadow-md">
                Get Started <RiArrowRightLine className="w-4 h-4 ml-1" />
              </Button>
            </CardContent>
          </Card>

          {/* Weekly */}
          <Card className="border border-border/50 hover:shadow-lg transition-all">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#5C0FFE]/10 flex items-center justify-center">
                  <RiVipCrownLine className="w-5 h-5 text-[#5C0FFE]" />
                </div>
                <div>
                  <h3 className="font-bold font-jakarta">Weekly</h3>
                  <p className="text-xs text-muted-foreground">4 cleans per month</p>
                </div>
              </div>
              <div className="text-center py-2">
                <span className="text-sm text-muted-foreground">Starting at</span>
                <p className="text-3xl font-extrabold text-[#5C0FFE]">
                  ${zone === 'A' ? 401 : zone === 'C' ? 314 : 349}<span className="text-base font-normal text-muted-foreground">/mo</span>
                </p>
                <Badge className="bg-amber-500/10 text-amber-600 border-0 mt-1 text-[10px]">Up to 42% off per clean</Badge>
              </div>
              <Separator />
              <ul className="space-y-2">
                {['4 standard cleans per month', 'Dedicated cleaning team', 'VIP scheduling', 'Free add-ons included', 'Best for families & pets'].map((f, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs"><RiCheckboxCircleLine className="w-3.5 h-3.5 text-[#5C0FFE]" />{f}</li>
                ))}
              </ul>
              <Button onClick={handleBookNow} variant="outline" className="w-full h-10 font-semibold border-[#5C0FFE]/30 text-[#5C0FFE] hover:bg-[#5C0FFE]/5">
                Get Started <RiArrowRightLine className="w-4 h-4 ml-1" />
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Full Membership Pricing Table */}
        <div className="mb-6 text-center">
          <h3 className="text-lg font-bold font-jakarta">Novara Glow Membership — Full Pricing — {SERVICE_ZONES[zone].label}</h3>
          <p className="text-xs text-muted-foreground mt-1">Compare one-time vs. recurring per-clean savings by home size</p>
        </div>
        <Card className="border border-border/60 shadow-lg overflow-hidden mb-16">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#5C0FFE] text-white">
                  <th className="text-left py-3 px-4 font-semibold">Home Size</th>
                  <th className="text-center py-3 px-4 font-semibold">One-Time</th>
                  <th className="text-center py-3 px-4 font-semibold">Monthly (1x)</th>
                  <th className="text-center py-3 px-4 font-semibold">
                    <span className="flex items-center justify-center gap-1">Bi-Weekly (2x) <RiStarLine className="w-3 h-3" /></span>
                  </th>
                  <th className="text-center py-3 px-4 font-semibold">Weekly (4x)</th>
                </tr>
              </thead>
              <tbody>
                {sizes.map((s, idx) => {
                  const mo = MEMBERSHIP_ZONE_PRICES.monthly[s.id as keyof typeof MEMBERSHIP_ZONE_PRICES.monthly];
                  const bw = MEMBERSHIP_ZONE_PRICES.biweekly[s.id as keyof typeof MEMBERSHIP_ZONE_PRICES.biweekly];
                  const wk = MEMBERSHIP_ZONE_PRICES.weekly[s.id as keyof typeof MEMBERSHIP_ZONE_PRICES.weekly];
                  return (
                    <tr key={s.id} className={cn("border-b border-border/40", idx % 2 === 0 ? "bg-white" : "bg-[#F8F7FF]")}>
                      <td className="py-3 px-4 font-medium text-xs">{s.label}</td>
                      <td className="py-3 px-4 text-center text-muted-foreground">${Z(STANDARD_PRICES[s.id])}</td>
                      <td className="py-3 px-4 text-center">
                        <span className="font-semibold">${mo[zone]}/mo</span>
                        <span className="text-[10px] text-green-600 block">{mo.savings} off</span>
                      </td>
                      <td className="py-3 px-4 text-center bg-[#5C0FFE]/[0.03]">
                        <span className="font-bold text-[#5C0FFE]">${bw[zone]}/mo</span>
                        <span className="text-[10px] text-green-600 block">{bw.savings} off</span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className="font-semibold">${wk[zone]}/mo</span>
                        <span className="text-[10px] text-green-600 block">{wk.savings} off</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {/* ─── Guarantees ────────────────────────────────── */}
        <div className="rounded-2xl bg-gradient-to-br from-[#5C0FFE]/[0.04] to-[#8F7BFD]/[0.04] border border-[#5C0FFE]/10 p-8 md:p-12 mb-16">
          <div className="max-w-2xl mx-auto text-center space-y-6">
            <RiShieldLine className="w-12 h-12 text-[#5C0FFE] mx-auto" />
            <h2 className="text-2xl md:text-3xl font-bold font-jakarta">Our Guarantee</h2>
            <div className="grid sm:grid-cols-3 gap-6">
              {[
                { icon: RiCheckboxCircleLine, title: "48-Hour Re-Clean", desc: "Not happy? We come back free within 48 hours." },
                { icon: RiShieldLine, title: "Fully Insured", desc: "Background-checked, bonded & insured teams." },
                { icon: RiTimeLine, title: "Always On Time", desc: "99% on-time rate or your next clean is on us." },
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

        {/* ─── Final CTA ─────────────────────────────────── */}
        <div className="text-center space-y-6 pb-12">
          <h2 className="text-2xl md:text-3xl font-bold font-jakarta">Ready for a Spotless Home?</h2>
          <p className="text-muted-foreground max-w-lg mx-auto">
            Book in under 2 minutes. Only ${DEPOSIT_AMOUNT} deposit. Bi-weekly members save up to 34%.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button onClick={handleBookNow} size="lg" className="h-14 px-10 text-base font-semibold bg-[#5C0FFE] hover:bg-[#5C0FFE]/90 text-white shadow-lg">
              Book Your Clean Now <RiArrowRightLine className="w-5 h-5 ml-2" />
            </Button>
            <a href="tel:+18447352070">
              <Button variant="outline" size="lg" className="h-14 px-10 text-base font-semibold border-[#5C0FFE]/30 text-[#5C0FFE]">
                <RiPhoneLine className="w-4 h-4 mr-2" />Call (844) 735-2070
              </Button>
            </a>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-border/40 bg-[#FAFAFE]">
        <div className="container mx-auto px-4 py-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <img src={logo} alt="Novara" className="w-7 h-7 rounded-lg" />
              <span className="text-sm font-bold font-jakarta">Novara<span className="text-[#5C0FFE]">Cleaning</span></span>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <a href="https://novaracleaning.com/privacy" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">Privacy</a>
              <a href="https://novaracleaning.com/terms" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">Terms</a>
              <span>&copy; {new Date().getFullYear()} Novara Cleaning LLC</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
