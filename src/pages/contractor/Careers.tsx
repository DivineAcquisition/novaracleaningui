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
  Target,
  BadgeCheck,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Ascension Tiers Data
const ascensionTiers = [
  {
    name: 'Starter',
    rate: '$18/hr',
    color: 'from-gray-500 to-gray-600',
    bgColor: 'bg-gray-50',
    borderColor: 'border-gray-200',
    requirements: [
      'New hire',
      'Probation period',
    ],
    icon: Users,
  },
  {
    name: 'Reliable',
    rate: '$19/hr',
    color: 'from-blue-500 to-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    requirements: [
      '20 jobs completed',
      '90% attendance',
      '0 complaints',
      '3+ reviews',
      '3 months tenure',
    ],
    icon: BadgeCheck,
  },
  {
    name: 'Pro',
    rate: '$20/hr',
    color: 'from-purple-500 to-purple-600',
    bgColor: 'bg-purple-50',
    borderColor: 'border-purple-200',
    requirements: [
      '50 jobs completed',
      '95% attendance',
      '0 complaints',
      '8+ reviews',
      '4 months tenure',
    ],
    icon: Trophy,
  },
  {
    name: 'Senior',
    rate: '$22/hr',
    color: 'from-amber-500 to-yellow-500',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
    requirements: [
      '100 jobs completed',
      '95% attendance',
      '0 complaints',
      '15+ reviews',
      '6 months tenure',
    ],
    icon: Star,
    featured: true,
  },
];

// Bonus Data
const bonuses = [
  {
    name: 'Review Bonus',
    amount: '$25',
    trigger: 'Every 5 reviews (Google or internal)',
    icon: Star,
    color: 'text-yellow-500',
    bgColor: 'bg-yellow-50',
  },
  {
    name: 'Perfect Attendance',
    amount: '$50',
    trigger: '100% attendance for the month',
    icon: Calendar,
    color: 'text-green-500',
    bgColor: 'bg-green-50',
  },
  {
    name: 'First 5-Star Review',
    amount: '$10',
    trigger: 'First review that names you',
    icon: Award,
    color: 'text-purple-500',
    bgColor: 'bg-purple-50',
  },
];

// Values Data
const values = [
  {
    name: 'Devotion',
    description: 'We show up with full commitment to every home and every customer.',
    icon: Heart,
    color: 'from-rose-500 to-pink-500',
  },
  {
    name: 'Value',
    description: 'We deliver exceptional quality that exceeds expectations, every time.',
    icon: Gem,
    color: 'from-[#5500FF] to-[#8F7BFD]',
  },
  {
    name: 'Care',
    description: 'We treat every home as if it were our own, with respect and attention.',
    icon: Shield,
    color: 'from-emerald-500 to-teal-500',
  },
];

export function CareersPage() {
  const [selectedTier, setSelectedTier] = useState<number | null>(null);

  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-purple-50/30 to-white">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#5500FF] to-[#8F7BFD] flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] bg-clip-text text-transparent">
              Novara
            </span>
          </Link>
          <div className="flex items-center gap-4">
            <Link to="/cleaner/auth">
              <Button variant="ghost">Sign In</Button>
            </Link>
            <Link to="/cleaner/onboarding-landing">
              <Button className="bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] hover:opacity-90">
                Apply Now
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#5500FF]/5 via-transparent to-[#8F7BFD]/5" />
        <div className="container mx-auto px-4 py-20 relative">
          <div className="max-w-4xl mx-auto text-center">
            <Badge className="mb-6 bg-gradient-to-r from-[#5500FF]/10 to-[#8F7BFD]/10 text-[#5500FF] border-[#5500FF]/20">
              <MapPin className="w-3 h-3 mr-1" />
              Now Hiring in Maryland
            </Badge>
            
            <h1 className="text-4xl md:text-6xl font-bold mb-6">
              Join the{' '}
              <span className="bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] bg-clip-text text-transparent">
                Novara
              </span>{' '}
              Team
            </h1>
            
            <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
              Build a rewarding career as a professional cleaner. Flexible schedules, 
              competitive pay, and a clear path to grow your earnings.
            </p>

            {/* Pay Highlight */}
            <div className="flex flex-wrap justify-center gap-4 mb-10">
              <div className="flex items-center gap-2 bg-white rounded-full px-6 py-3 shadow-lg border">
                <DollarSign className="w-5 h-5 text-green-500" />
                <span className="font-bold text-2xl">$18-22</span>
                <span className="text-muted-foreground">/hour</span>
              </div>
              <div className="flex items-center gap-2 bg-white rounded-full px-6 py-3 shadow-lg border">
                <Calendar className="w-5 h-5 text-blue-500" />
                <span className="font-semibold">Weekly Payouts</span>
              </div>
              <div className="flex items-center gap-2 bg-white rounded-full px-6 py-3 shadow-lg border">
                <Zap className="w-5 h-5 text-amber-500" />
                <span className="font-semibold">Instant Pay Available</span>
              </div>
            </div>

            <Link to="/cleaner/onboarding-landing">
              <Button size="lg" className="bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] hover:opacity-90 text-lg px-8">
                Start Your Application
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Our Values */}
      <section className="py-20 bg-white">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Our Values</h2>
            <p className="text-muted-foreground text-lg">
              The principles that guide everything we do
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {values.map((value) => (
              <Card key={value.name} className="border-2 hover:shadow-lg transition-shadow">
                <CardContent className="pt-8 pb-6 text-center">
                  <div className={cn(
                    'w-16 h-16 rounded-2xl mx-auto mb-6 flex items-center justify-center bg-gradient-to-br',
                    value.color
                  )}>
                    <value.icon className="w-8 h-8 text-white" />
                  </div>
                  <h3 className="text-2xl font-bold mb-3">{value.name}</h3>
                  <p className="text-muted-foreground">{value.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Ascension Tiers */}
      <section className="py-20 bg-gradient-to-b from-purple-50/50 to-white">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <Badge className="mb-4 bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] text-white">
              <TrendingUp className="w-3 h-3 mr-1" />
              Career Growth
            </Badge>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Ascension Tiers</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Your performance directly impacts your pay. Level up through our tier system 
              and earn more with every milestone you reach.
            </p>
          </div>

          {/* Tier Cards */}
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
            {ascensionTiers.map((tier, index) => (
              <Card 
                key={tier.name}
                className={cn(
                  'relative overflow-hidden transition-all cursor-pointer hover:shadow-xl',
                  tier.borderColor,
                  tier.featured && 'ring-2 ring-amber-400 ring-offset-2',
                  selectedTier === index && 'scale-105'
                )}
                onClick={() => setSelectedTier(selectedTier === index ? null : index)}
              >
                {tier.featured && (
                  <div className="absolute top-0 right-0 bg-gradient-to-r from-amber-500 to-yellow-500 text-white text-xs font-bold px-3 py-1 rounded-bl-lg">
                    TOP TIER
                  </div>
                )}
                <CardHeader className={cn('pb-4', tier.bgColor)}>
                  <div className="flex items-center justify-between">
                    <div className={cn(
                      'w-12 h-12 rounded-xl flex items-center justify-center bg-gradient-to-br',
                      tier.color
                    )}>
                      <tier.icon className="w-6 h-6 text-white" />
                    </div>
                    <div className="text-right">
                      <div className={cn(
                        'text-3xl font-bold bg-gradient-to-r bg-clip-text text-transparent',
                        tier.color
                      )}>
                        {tier.rate}
                      </div>
                    </div>
                  </div>
                  <CardTitle className="mt-4 text-xl">{tier.name}</CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                  <ul className="space-y-2">
                    {tier.requirements.map((req, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm">
                        <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                        <span className="text-muted-foreground">{req}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Progression Arrow */}
          <div className="flex justify-center mt-8">
            <div className="flex items-center gap-2 text-muted-foreground">
              <span className="text-sm">Progress through tiers</span>
              <div className="flex items-center">
                {[0, 1, 2, 3].map((i) => (
                  <ChevronRight key={i} className="w-5 h-5 -ml-2 first:ml-0" />
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Bonus System */}
      <section className="py-20 bg-white">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <Badge className="mb-4 bg-green-100 text-green-700 border-green-200">
              <Award className="w-3 h-3 mr-1" />
              Extra Earnings
            </Badge>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Bonus Opportunities</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Earn extra money on top of your hourly rate through our bonus programs
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {bonuses.map((bonus) => (
              <Card key={bonus.name} className="hover:shadow-lg transition-shadow">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-4">
                    <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center', bonus.bgColor)}>
                      <bonus.icon className={cn('w-6 h-6', bonus.color)} />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="font-bold text-lg">{bonus.name}</h3>
                        <span className="text-2xl font-bold text-green-600">{bonus.amount}</span>
                      </div>
                      <p className="text-muted-foreground text-sm">{bonus.trigger}</p>
                      <Badge variant="outline" className="mt-3 text-xs">
                        One-time bonus
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Example Earnings */}
          <Card className="mt-12 max-w-3xl mx-auto bg-gradient-to-r from-green-50 to-emerald-50 border-green-200">
            <CardContent className="py-6">
              <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                <div>
                  <h3 className="font-bold text-lg text-green-800 mb-1">Example Monthly Earnings</h3>
                  <p className="text-green-700 text-sm">
                    Pro tier cleaner • 30 hours/week • Perfect attendance
                  </p>
                </div>
                <div className="text-center md:text-right">
                  <div className="text-4xl font-bold text-green-600">$2,450+</div>
                  <div className="text-sm text-green-700">per month</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Penalty System */}
      <section className="py-20 bg-gradient-to-b from-gray-50 to-white">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <Badge className="mb-4 bg-red-100 text-red-700 border-red-200">
              <AlertTriangle className="w-3 h-3 mr-1" />
              Important
            </Badge>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Our Standards</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              We maintain high standards to protect our customers and team. 
              Here's our "One Strike, One Chance" policy.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
            {/* Immediate Termination */}
            <Card className="border-red-200">
              <CardHeader className="bg-red-50 border-b border-red-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-red-500 flex items-center justify-center">
                    <XCircle className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-red-800">Immediate Termination</CardTitle>
                    <CardDescription className="text-red-600">
                      Zero tolerance — no forgiveness
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                <ul className="space-y-3">
                  {[
                    'No-call no-show',
                    'Theft or intentional property damage',
                    'Customer complaint about behavior (rude, inappropriate, unprofessional)',
                    'Showing up under the influence',
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <XCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                      <span className="text-gray-700">{item}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            {/* Strike System */}
            <Card className="border-amber-200">
              <CardHeader className="bg-amber-50 border-b border-amber-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-amber-500 flex items-center justify-center">
                    <AlertTriangle className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-amber-800">Strike System</CardTitle>
                    <CardDescription className="text-amber-600">
                      1st strike = final warning • 2nd = termination
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                <ul className="space-y-3">
                  {[
                    'Late arrival (15+ minutes)',
                    'Quality complaint (missed areas, rushed job)',
                    'Canceling shift under 24 hours notice',
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                      <span className="text-gray-700">{item}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-6 p-4 bg-amber-50 rounded-lg border border-amber-200">
                  <p className="text-sm text-amber-800">
                    <strong>Note:</strong> We believe in second chances for minor issues, 
                    but consistent problems indicate this may not be the right fit.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="py-20 bg-white">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Why Join Novara?</h2>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 max-w-5xl mx-auto">
            {[
              { icon: Clock, title: 'Flexible Hours', desc: 'Work when it suits your schedule' },
              { icon: MapPin, title: 'Local Jobs', desc: 'Work in your neighborhood' },
              { icon: Zap, title: 'Instant Pay', desc: 'Get paid same day when eligible' },
              { icon: TrendingUp, title: 'Career Growth', desc: 'Clear path to higher earnings' },
            ].map((benefit) => (
              <div key={benefit.title} className="text-center p-6">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#5500FF]/10 to-[#8F7BFD]/10 flex items-center justify-center mx-auto mb-4">
                  <benefit.icon className="w-7 h-7 text-[#5500FF]" />
                </div>
                <h3 className="font-bold text-lg mb-2">{benefit.title}</h3>
                <p className="text-muted-foreground text-sm">{benefit.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-20 bg-gradient-to-r from-[#5500FF] to-[#8F7BFD]">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-6">
            Ready to Start Earning?
          </h2>
          <p className="text-white/80 text-lg mb-8 max-w-2xl mx-auto">
            Join our team of professional cleaners and start building your career today. 
            The application takes just 5 minutes.
          </p>
          <Link to="/cleaner/onboarding-landing">
            <Button size="lg" variant="secondary" className="text-lg px-8">
              Apply Now
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </Link>
          <p className="text-white/60 text-sm mt-4">
            No experience required • Training provided • Start within a week
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-12">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#5500FF] to-[#8F7BFD] flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold">Novara Cleaning</span>
            </div>
            <div className="flex items-center gap-6 text-gray-400">
              <a href="https://try.novaracleaning.com" className="hover:text-white transition-colors">
                Book a Cleaning
              </a>
              <Link to="/cleaner/auth" className="hover:text-white transition-colors">
                Cleaner Login
              </Link>
            </div>
            <p className="text-gray-500 text-sm">
              © 2026 Novara Cleaning. Maryland.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default CareersPage;
