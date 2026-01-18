/**
 * Careers Page - contractor.novaracleaning.com/careers
 * 
 * Hiring page showcasing:
 * - Company values
 * - Pay structure & ascension tiers
 * - Bonus system
 * - Penalty system
 * - CTA to apply
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Heart,
  Gem,
  Shield,
  DollarSign,
  TrendingUp,
  Star,
  Calendar,
  Award,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  ArrowRight,
  Users,
  MapPin,
  Sparkles,
  Trophy,
  BadgeCheck,
  ChevronRight,
  Play,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import logo from '@/assets/logo.png';

// Ascension Tiers Data
const ascensionTiers = [
  {
    name: 'Starter',
    rate: '$18',
    rateLabel: '/hr',
    color: 'from-slate-400 to-slate-500',
    bgColor: 'bg-slate-50',
    borderColor: 'border-slate-200',
    textColor: 'text-slate-600',
    requirements: ['New hire', 'Probation period'],
    icon: Users,
  },
  {
    name: 'Reliable',
    rate: '$19',
    rateLabel: '/hr',
    color: 'from-blue-500 to-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    textColor: 'text-blue-600',
    requirements: ['20 jobs', '90% attendance', '0 complaints', '3+ reviews', '3 mo tenure'],
    icon: BadgeCheck,
  },
  {
    name: 'Pro',
    rate: '$20',
    rateLabel: '/hr',
    color: 'from-[#5500FF] to-[#8F7BFD]',
    bgColor: 'bg-purple-50',
    borderColor: 'border-purple-200',
    textColor: 'text-[#5500FF]',
    requirements: ['50 jobs', '95% attendance', '0 complaints', '8+ reviews', '4 mo tenure'],
    icon: Trophy,
  },
  {
    name: 'Senior',
    rate: '$22',
    rateLabel: '/hr',
    color: 'from-amber-500 to-yellow-500',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
    textColor: 'text-amber-600',
    requirements: ['100 jobs', '95% attendance', '0 complaints', '15+ reviews', '6 mo tenure'],
    icon: Star,
    featured: true,
  },
];

// Bonus Data
const bonuses = [
  {
    name: 'Review Bonus',
    amount: '$25',
    trigger: 'Every 5 reviews',
    subtext: 'Google or internal',
    icon: Star,
    color: 'text-yellow-500',
    bgColor: 'bg-yellow-100',
  },
  {
    name: 'Perfect Attendance',
    amount: '$50',
    trigger: '100% monthly attendance',
    subtext: 'No missed shifts',
    icon: Calendar,
    color: 'text-green-500',
    bgColor: 'bg-green-100',
  },
  {
    name: 'First 5-Star',
    amount: '$10',
    trigger: 'First review naming you',
    subtext: 'One-time bonus',
    icon: Award,
    color: 'text-purple-500',
    bgColor: 'bg-purple-100',
  },
];

// Values Data
const values = [
  {
    name: 'Devotion',
    description: 'Full commitment to every home and customer',
    icon: Heart,
    color: 'from-rose-500 to-pink-500',
    bg: 'bg-rose-50',
  },
  {
    name: 'Value',
    description: 'Exceptional quality that exceeds expectations',
    icon: Gem,
    color: 'from-[#5500FF] to-[#8F7BFD]',
    bg: 'bg-purple-50',
  },
  {
    name: 'Care',
    description: 'Treating every home as our own',
    icon: Shield,
    color: 'from-emerald-500 to-teal-500',
    bg: 'bg-emerald-50',
  },
];

export function CareersPage() {
  return (
    <div className="min-h-screen bg-white overflow-x-hidden">
      {/* Header */}
      <header className="border-b bg-white/90 backdrop-blur-md sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3 md:py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <img src={logo} alt="Novara" className="w-8 h-8 md:w-10 md:h-10 rounded-xl" />
            <span className="text-lg md:text-xl font-bold bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] bg-clip-text text-transparent">
              Novara
            </span>
          </Link>
          <div className="flex items-center gap-2 md:gap-4">
            <Link to="/cleaner/auth">
              <Button variant="ghost" size="sm" className="text-xs md:text-sm">Sign In</Button>
            </Link>
            <Link to="/cleaner/onboarding-landing">
              <Button size="sm" className="bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] hover:opacity-90 text-xs md:text-sm">
                Apply Now
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        {/* Background Elements */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#5500FF]/5 via-white to-[#8F7BFD]/5" />
        <div className="absolute top-20 -right-20 w-72 h-72 md:w-96 md:h-96 bg-gradient-to-br from-[#5500FF]/10 to-[#8F7BFD]/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-20 -left-20 w-72 h-72 md:w-96 md:h-96 bg-gradient-to-br from-purple-200/30 to-pink-200/30 rounded-full blur-3xl" />
        
        <div className="container mx-auto px-4 py-12 md:py-20 relative">
          <div className="max-w-4xl mx-auto text-center">
            {/* Location Badge */}
            <Badge className="mb-4 md:mb-6 bg-white/80 backdrop-blur-sm text-[#5500FF] border border-[#5500FF]/20 shadow-sm text-xs md:text-sm">
              <MapPin className="w-3 h-3 mr-1" />
              Now Hiring in Maryland
            </Badge>
            
            {/* Main Headline */}
            <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold mb-4 md:mb-6 leading-tight">
              Join the{' '}
              <span className="bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] bg-clip-text text-transparent">
                Novara
              </span>{' '}
              Team
            </h1>
            
            <p className="text-base md:text-lg lg:text-xl text-muted-foreground mb-6 md:mb-8 max-w-2xl mx-auto px-4">
              Build a rewarding career with flexible schedules, competitive pay, and a clear path to grow.
            </p>

            {/* Pay Highlight Cards */}
            <div className="flex flex-wrap justify-center gap-2 md:gap-4 mb-8 md:mb-10 px-2">
              <div className="flex items-center gap-1.5 md:gap-2 bg-white rounded-full px-3 md:px-5 py-2 md:py-3 shadow-lg border text-sm md:text-base">
                <DollarSign className="w-4 h-4 md:w-5 md:h-5 text-green-500" />
                <span className="font-bold text-lg md:text-2xl">$18-22</span>
                <span className="text-muted-foreground text-xs md:text-sm">/hr</span>
              </div>
              <div className="flex items-center gap-1.5 md:gap-2 bg-white rounded-full px-3 md:px-5 py-2 md:py-3 shadow-lg border text-xs md:text-sm">
                <Calendar className="w-4 h-4 md:w-5 md:h-5 text-blue-500" />
                <span className="font-medium">Weekly Pay</span>
              </div>
              <div className="flex items-center gap-1.5 md:gap-2 bg-white rounded-full px-3 md:px-5 py-2 md:py-3 shadow-lg border text-xs md:text-sm">
                <Zap className="w-4 h-4 md:w-5 md:h-5 text-amber-500" />
                <span className="font-medium">Instant Pay</span>
              </div>
            </div>

            {/* CTA Button */}
            <Link to="/cleaner/onboarding-landing">
              <Button size="lg" className="bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] hover:opacity-90 text-sm md:text-base px-6 md:px-8 shadow-xl shadow-purple-500/25">
                Start Your Application
                <ArrowRight className="w-4 h-4 md:w-5 md:h-5 ml-2" />
              </Button>
            </Link>
            
            <p className="text-xs md:text-sm text-muted-foreground mt-4">
              No experience required • Training provided
            </p>
          </div>
        </div>
      </section>

      {/* Our Values */}
      <section className="py-12 md:py-20 bg-gradient-to-b from-white to-gray-50/50">
        <div className="container mx-auto px-4">
          <div className="text-center mb-8 md:mb-12">
            <h2 className="text-2xl md:text-3xl lg:text-4xl font-bold mb-2 md:mb-4">Our Values</h2>
            <p className="text-muted-foreground text-sm md:text-base">
              The principles that guide everything we do
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 max-w-4xl mx-auto">
            {values.map((value) => (
              <Card key={value.name} className={cn('border-0 shadow-lg hover:shadow-xl transition-all', value.bg)}>
                <CardContent className="pt-6 md:pt-8 pb-4 md:pb-6 text-center">
                  <div className={cn(
                    'w-12 h-12 md:w-14 md:h-14 rounded-xl md:rounded-2xl mx-auto mb-4 flex items-center justify-center bg-gradient-to-br shadow-lg',
                    value.color
                  )}>
                    <value.icon className="w-6 h-6 md:w-7 md:h-7 text-white" />
                  </div>
                  <h3 className="text-lg md:text-xl font-bold mb-2">{value.name}</h3>
                  <p className="text-muted-foreground text-xs md:text-sm">{value.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Ascension Tiers */}
      <section className="py-12 md:py-20 relative overflow-hidden">
        {/* Background decoration */}
        <div className="absolute inset-0 bg-gradient-to-b from-gray-50/50 via-purple-50/30 to-white" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-r from-[#5500FF]/5 to-[#8F7BFD]/5 rounded-full blur-3xl" />
        
        <div className="container mx-auto px-4 relative">
          <div className="text-center mb-8 md:mb-12">
            <Badge className="mb-3 md:mb-4 bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] text-white text-xs">
              <TrendingUp className="w-3 h-3 mr-1" />
              Career Growth
            </Badge>
            <h2 className="text-2xl md:text-3xl lg:text-4xl font-bold mb-2 md:mb-4">Ascension Tiers</h2>
            <p className="text-muted-foreground text-sm md:text-base max-w-xl mx-auto px-4">
              Level up and earn more with every milestone
            </p>
          </div>

          {/* Tier Cards - Horizontal scroll on mobile */}
          <div className="flex md:grid md:grid-cols-4 gap-3 md:gap-4 max-w-5xl mx-auto overflow-x-auto pb-4 md:pb-0 snap-x snap-mandatory md:snap-none -mx-4 px-4 md:mx-auto md:px-0">
            {ascensionTiers.map((tier, index) => (
              <Card 
                key={tier.name}
                className={cn(
                  'relative overflow-hidden transition-all hover:shadow-xl flex-shrink-0 w-[260px] md:w-auto snap-center',
                  tier.borderColor,
                  tier.featured && 'ring-2 ring-amber-400 ring-offset-2'
                )}
              >
                {tier.featured && (
                  <div className="absolute top-0 right-0 bg-gradient-to-r from-amber-500 to-yellow-500 text-white text-[10px] md:text-xs font-bold px-2 py-0.5 rounded-bl-lg">
                    TOP TIER
                  </div>
                )}
                <CardHeader className={cn('pb-2 md:pb-3', tier.bgColor)}>
                  <div className="flex items-center justify-between">
                    <div className={cn(
                      'w-10 h-10 md:w-11 md:h-11 rounded-xl flex items-center justify-center bg-gradient-to-br shadow-md',
                      tier.color
                    )}>
                      <tier.icon className="w-5 h-5 md:w-5 md:h-5 text-white" />
                    </div>
                    <div className="text-right">
                      <span className={cn('text-2xl md:text-3xl font-bold', tier.textColor)}>
                        {tier.rate}
                      </span>
                      <span className="text-xs md:text-sm text-muted-foreground">{tier.rateLabel}</span>
                    </div>
                  </div>
                  <CardTitle className="mt-2 md:mt-3 text-base md:text-lg">{tier.name}</CardTitle>
                </CardHeader>
                <CardContent className="pt-2 md:pt-3 pb-4">
                  <ul className="space-y-1 md:space-y-1.5">
                    {tier.requirements.map((req, i) => (
                      <li key={i} className="flex items-center gap-1.5 text-xs md:text-sm">
                        <CheckCircle2 className="w-3 h-3 md:w-3.5 md:h-3.5 text-green-500 flex-shrink-0" />
                        <span className="text-muted-foreground">{req}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Progression indicator */}
          <div className="hidden md:flex justify-center mt-6">
            <div className="flex items-center gap-1 text-muted-foreground text-sm">
              <span>Progress through tiers</span>
              {[0, 1, 2].map((i) => (
                <ChevronRight key={i} className="w-4 h-4 -ml-1" />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Bonus System */}
      <section className="py-12 md:py-20 bg-white">
        <div className="container mx-auto px-4">
          <div className="text-center mb-8 md:mb-12">
            <Badge className="mb-3 md:mb-4 bg-green-100 text-green-700 border-green-200 text-xs">
              <Award className="w-3 h-3 mr-1" />
              Extra Earnings
            </Badge>
            <h2 className="text-2xl md:text-3xl lg:text-4xl font-bold mb-2 md:mb-4">Bonus Opportunities</h2>
            <p className="text-muted-foreground text-sm md:text-base">
              Earn more on top of your hourly rate
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4 max-w-3xl mx-auto">
            {bonuses.map((bonus) => (
              <Card key={bonus.name} className="border-2 hover:shadow-lg transition-shadow">
                <CardContent className="pt-4 md:pt-6 pb-4 text-center">
                  <div className={cn('w-12 h-12 md:w-14 md:h-14 rounded-xl md:rounded-2xl mx-auto mb-3 flex items-center justify-center', bonus.bgColor)}>
                    <bonus.icon className={cn('w-6 h-6 md:w-7 md:h-7', bonus.color)} />
                  </div>
                  <div className="text-2xl md:text-3xl font-bold text-green-600 mb-1">{bonus.amount}</div>
                  <h3 className="font-semibold text-sm md:text-base mb-1">{bonus.name}</h3>
                  <p className="text-muted-foreground text-xs">{bonus.trigger}</p>
                  <p className="text-muted-foreground/70 text-[10px] md:text-xs">{bonus.subtext}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Example Earnings */}
          <Card className="mt-6 md:mt-10 max-w-2xl mx-auto bg-gradient-to-r from-green-50 to-emerald-50 border-green-200 shadow-lg">
            <CardContent className="py-4 md:py-5">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="text-center sm:text-left">
                  <h3 className="font-bold text-sm md:text-base text-green-800 mb-0.5">Example Monthly Earnings</h3>
                  <p className="text-green-700 text-xs md:text-sm">
                    Pro tier • 30 hrs/week • Perfect attendance
                  </p>
                </div>
                <div className="text-center sm:text-right">
                  <div className="text-3xl md:text-4xl font-bold text-green-600">$2,450+</div>
                  <div className="text-xs text-green-700">per month</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Penalty System */}
      <section className="py-12 md:py-20 bg-gray-50">
        <div className="container mx-auto px-4">
          <div className="text-center mb-8 md:mb-12">
            <Badge className="mb-3 md:mb-4 bg-slate-100 text-slate-700 border-slate-200 text-xs">
              <AlertTriangle className="w-3 h-3 mr-1" />
              Standards
            </Badge>
            <h2 className="text-2xl md:text-3xl lg:text-4xl font-bold mb-2 md:mb-4">Our Standards</h2>
            <p className="text-muted-foreground text-sm md:text-base max-w-md mx-auto px-4">
              "One Strike, One Chance" policy to protect our customers
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-4 md:gap-6 max-w-4xl mx-auto">
            {/* Immediate Termination */}
            <Card className="border-red-200 overflow-hidden">
              <CardHeader className="bg-red-50 border-b border-red-100 py-3 md:py-4">
                <div className="flex items-center gap-2 md:gap-3">
                  <div className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-red-500 flex items-center justify-center">
                    <XCircle className="w-4 h-4 md:w-5 md:h-5 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-red-800 text-sm md:text-base">Immediate Termination</CardTitle>
                    <CardDescription className="text-red-600 text-xs">
                      Zero tolerance
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-3 md:pt-4 pb-4">
                <ul className="space-y-2">
                  {[
                    'No-call no-show',
                    'Theft or property damage',
                    'Rude/inappropriate behavior',
                    'Under the influence',
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs md:text-sm">
                      <XCircle className="w-3.5 h-3.5 md:w-4 md:h-4 text-red-500 flex-shrink-0 mt-0.5" />
                      <span className="text-gray-700">{item}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            {/* Strike System */}
            <Card className="border-amber-200 overflow-hidden">
              <CardHeader className="bg-amber-50 border-b border-amber-100 py-3 md:py-4">
                <div className="flex items-center gap-2 md:gap-3">
                  <div className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-amber-500 flex items-center justify-center">
                    <AlertTriangle className="w-4 h-4 md:w-5 md:h-5 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-amber-800 text-sm md:text-base">Strike System</CardTitle>
                    <CardDescription className="text-amber-600 text-xs">
                      1 warning → 2nd = termination
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-3 md:pt-4 pb-4">
                <ul className="space-y-2">
                  {[
                    'Late arrival (15+ min)',
                    'Quality complaints',
                    'Canceling under 24hr notice',
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs md:text-sm">
                      <AlertTriangle className="w-3.5 h-3.5 md:w-4 md:h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                      <span className="text-gray-700">{item}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 md:mt-4 p-2.5 md:p-3 bg-amber-50 rounded-lg border border-amber-200">
                  <p className="text-[10px] md:text-xs text-amber-800">
                    <strong>Note:</strong> We believe in second chances for minor issues.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="py-12 md:py-16 bg-white">
        <div className="container mx-auto px-4">
          <div className="text-center mb-8 md:mb-10">
            <h2 className="text-2xl md:text-3xl font-bold mb-2">Why Join Novara?</h2>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 max-w-4xl mx-auto">
            {[
              { icon: Clock, title: 'Flexible Hours', desc: 'Work your schedule' },
              { icon: MapPin, title: 'Local Jobs', desc: 'Your neighborhood' },
              { icon: Zap, title: 'Instant Pay', desc: 'Same-day when eligible' },
              { icon: TrendingUp, title: 'Career Growth', desc: 'Clear path up' },
            ].map((benefit) => (
              <div key={benefit.title} className="text-center p-3 md:p-4">
                <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-gradient-to-br from-[#5500FF]/10 to-[#8F7BFD]/10 flex items-center justify-center mx-auto mb-2 md:mb-3">
                  <benefit.icon className="w-5 h-5 md:w-6 md:h-6 text-[#5500FF]" />
                </div>
                <h3 className="font-bold text-sm md:text-base mb-0.5 md:mb-1">{benefit.title}</h3>
                <p className="text-muted-foreground text-xs">{benefit.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-12 md:py-20 bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] relative overflow-hidden">
        {/* Decorative elements */}
        <div className="absolute top-0 left-0 w-64 h-64 bg-white/5 rounded-full -translate-x-1/2 -translate-y-1/2" />
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-white/5 rounded-full translate-x-1/3 translate-y-1/3" />
        
        <div className="container mx-auto px-4 text-center relative">
          <h2 className="text-2xl md:text-3xl lg:text-4xl font-bold text-white mb-3 md:mb-4">
            Ready to Start Earning?
          </h2>
          <p className="text-white/80 text-sm md:text-base mb-6 md:mb-8 max-w-lg mx-auto px-4">
            Join our team of professional cleaners today. Application takes just 5 minutes.
          </p>
          <Link to="/cleaner/onboarding-landing">
            <Button size="lg" variant="secondary" className="text-sm md:text-base px-6 md:px-8 shadow-xl">
              Apply Now
              <ArrowRight className="w-4 h-4 md:w-5 md:h-5 ml-2" />
            </Button>
          </Link>
          <p className="text-white/60 text-xs mt-3 md:mt-4">
            No experience required • Start within a week
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-8 md:py-10">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <img src={logo} alt="Novara" className="w-8 h-8 rounded-lg" />
              <span className="text-base md:text-lg font-bold">Novara Cleaning</span>
            </div>
            <div className="flex items-center gap-4 md:gap-6 text-gray-400 text-xs md:text-sm">
              <a href="https://try.novaracleaning.com" className="hover:text-white transition-colors">
                Book a Cleaning
              </a>
              <Link to="/cleaner/auth" className="hover:text-white transition-colors">
                Cleaner Login
              </Link>
            </div>
            <p className="text-gray-500 text-xs">
              © 2026 Novara Cleaning. Maryland.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default CareersPage;
