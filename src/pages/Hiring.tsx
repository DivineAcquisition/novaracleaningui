import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { 
  Sparkles, 
  MapPin, 
  Clock, 
  DollarSign, 
  CheckCircle, 
  ArrowRight,
  Briefcase,
  Users,
  Heart,
  Shield,
  Star,
  Building2,
  Send,
  Loader2
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

// Position types
interface Position {
  id: string;
  title: string;
  type: 'full-time' | 'part-time' | 'contract';
  location: string;
  salary: string;
  description: string;
  responsibilities: string[];
  requirements: string[];
  benefits: string[];
  icon: React.ElementType;
  color: string;
}

const POSITIONS: Position[] = [
  {
    id: 'field-cleaner',
    title: 'Field Cleaner',
    type: 'part-time',
    location: 'Dallas-Fort Worth, TX',
    salary: '$18 - $25/hour',
    description: 'Join our team of professional cleaners delivering exceptional cleaning services to homes across the DFW metroplex. Flexible scheduling with opportunity for growth.',
    responsibilities: [
      'Perform residential deep cleaning and maintenance cleaning',
      'Follow our 40-point cleaning checklist for consistent quality',
      'Communicate professionally with clients',
      'Maintain cleaning supplies and equipment',
      'Complete jobs within estimated timeframes',
      'Report any issues or damage to management'
    ],
    requirements: [
      'Reliable transportation',
      'Smartphone for job management app',
      'Ability to lift up to 25 lbs',
      'Attention to detail',
      'Positive attitude and professional demeanor',
      'Pass background check'
    ],
    benefits: [
      'Flexible scheduling - you choose your hours',
      'Weekly direct deposit payments',
      'Performance bonuses',
      'Supplies and equipment provided',
      'Training and certification',
      'Path to team lead positions'
    ],
    icon: Sparkles,
    color: 'primary'
  },
  {
    id: 'ops-coordinator',
    title: 'Operations Coordinator',
    type: 'full-time',
    location: 'Remote (US)',
    salary: '$45,000 - $55,000/year',
    description: 'Coordinate daily operations, manage cleaner schedules, and ensure smooth service delivery. Be the backbone of our growing cleaning operation.',
    responsibilities: [
      'Manage daily cleaner schedules and job assignments',
      'Handle customer inquiries and booking changes',
      'Coordinate emergency coverage and rescheduling',
      'Monitor job completion and quality metrics',
      'Onboard and train new cleaning staff',
      'Maintain operational documentation'
    ],
    requirements: [
      '2+ years in operations or customer service',
      'Experience with scheduling software',
      'Excellent communication skills',
      'Problem-solving mindset',
      'Ability to work in fast-paced environment',
      'Detail-oriented and organized'
    ],
    benefits: [
      'Fully remote position',
      'Health insurance',
      'Paid time off',
      '401(k) with company match',
      'Professional development budget',
      'Team retreats'
    ],
    icon: Users,
    color: 'emerald'
  },
  {
    id: 'executive-assistant',
    title: 'Executive Assistant',
    type: 'full-time',
    location: 'Remote (US)',
    salary: '$50,000 - $65,000/year',
    description: 'Support the executive team with administrative tasks, project management, and strategic initiatives. Help scale a fast-growing home services company.',
    responsibilities: [
      'Manage executive calendars and scheduling',
      'Coordinate meetings and prepare agendas',
      'Handle confidential correspondence',
      'Assist with project management and tracking',
      'Prepare reports and presentations',
      'Liaise with partners and stakeholders'
    ],
    requirements: [
      '3+ years as executive assistant or similar role',
      'Proficiency in Google Workspace and project tools',
      'Excellent written and verbal communication',
      'High level of discretion and professionalism',
      'Ability to prioritize and manage multiple tasks',
      'Bachelor\'s degree preferred'
    ],
    benefits: [
      'Fully remote position',
      'Competitive salary + bonus',
      'Health, dental, and vision insurance',
      'Unlimited PTO',
      'Home office stipend',
      'Equity participation'
    ],
    icon: Briefcase,
    color: 'violet'
  }
];

const COMPANY_VALUES = [
  {
    icon: Heart,
    title: 'People First',
    description: 'We invest in our team\'s growth and well-being'
  },
  {
    icon: Star,
    title: 'Excellence',
    description: 'We deliver exceptional service, every time'
  },
  {
    icon: Shield,
    title: 'Trust',
    description: 'Integrity and reliability in everything we do'
  },
  {
    icon: Building2,
    title: 'Growth',
    description: 'Building careers, not just jobs'
  }
];

export default function Hiring() {
  const [selectedPosition, setSelectedPosition] = useState<Position | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    resume: '',
    coverLetter: ''
  });

  const handleApply = (position: Position) => {
    setSelectedPosition(position);
    setIsApplying(true);
  };

  const handleSubmitApplication = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedPosition) return;
    
    setIsSubmitting(true);
    
    try {
      // Store application in database (you can create a job_applications table)
      // For now, we'll just show a success message
      await new Promise(resolve => setTimeout(resolve, 1500)); // Simulate API call
      
      toast.success('Application submitted successfully! We\'ll be in touch soon.');
      setIsApplying(false);
      setFormData({ name: '', email: '', phone: '', resume: '', coverLetter: '' });
    } catch (error) {
      toast.error('Failed to submit application. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getColorClasses = (color: string) => {
    switch (color) {
      case 'emerald':
        return {
          bg: 'bg-emerald-500',
          bgLight: 'bg-emerald-500/10',
          text: 'text-emerald-600 dark:text-emerald-400',
          border: 'border-emerald-500/20 hover:border-emerald-500/50',
          badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
        };
      case 'violet':
        return {
          bg: 'bg-violet-500',
          bgLight: 'bg-violet-500/10',
          text: 'text-violet-600 dark:text-violet-400',
          border: 'border-violet-500/20 hover:border-violet-500/50',
          badge: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400'
        };
      default:
        return {
          bg: 'bg-primary',
          bgLight: 'bg-primary/10',
          text: 'text-primary',
          border: 'border-primary/20 hover:border-primary/50',
          badge: 'bg-primary/10 text-primary'
        };
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        {/* Background decoration */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl" />
        </div>
        
        <div className="container max-w-6xl mx-auto px-4 py-20 md:py-32">
          <div className="text-center max-w-3xl mx-auto space-y-6">
            {/* Logo */}
            <div className="flex justify-center mb-8">
              <img 
                src="/novara-logo.png" 
                alt="Novara Cleaning" 
                className="h-16 w-16 rounded-2xl shadow-lg"
              />
            </div>
            
            <Badge variant="secondary" className="px-4 py-2 text-sm font-medium">
              <Sparkles className="w-4 h-4 mr-2" />
              We're Hiring
            </Badge>
            
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-foreground">
              Build Your Career at{' '}
              <span className="text-primary">Novara</span>
            </h1>
            
            <p className="text-xl text-muted-foreground leading-relaxed max-w-2xl mx-auto">
              Join our mission to deliver exceptional cleaning experiences. 
              We're growing fast and looking for talented people to join our team.
            </p>
            
            <div className="flex flex-wrap justify-center gap-4 pt-4">
              <Button size="lg" className="h-12 px-8" onClick={() => document.getElementById('positions')?.scrollIntoView({ behavior: 'smooth' })}>
                View Open Positions
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Values Section */}
      <section className="py-16 md:py-24 bg-slate-50/50 dark:bg-slate-900/50">
        <div className="container max-w-6xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Why Work With Us</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              We're more than a cleaning company. We're building a team that values growth, excellence, and each other.
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {COMPANY_VALUES.map((value, idx) => (
              <Card key={idx} className="text-center border-none shadow-md hover:shadow-lg transition-shadow">
                <CardContent className="pt-8 pb-6">
                  <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-primary/10 flex items-center justify-center">
                    <value.icon className="w-7 h-7 text-primary" />
                  </div>
                  <h3 className="font-semibold text-lg mb-2">{value.title}</h3>
                  <p className="text-muted-foreground text-sm">{value.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Positions Section */}
      <section id="positions" className="py-16 md:py-24 scroll-mt-8">
        <div className="container max-w-6xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Open Positions</h2>
            <p className="text-muted-foreground text-lg">
              Find your perfect role and start your journey with Novara
            </p>
          </div>
          
          <div className="grid gap-6">
            {POSITIONS.map((position) => {
              const colors = getColorClasses(position.color);
              return (
                <Card 
                  key={position.id} 
                  className={`overflow-hidden transition-all duration-300 hover:shadow-xl border-2 ${colors.border}`}
                >
                  <CardContent className="p-0">
                    <div className="flex flex-col lg:flex-row">
                      {/* Left side - Position info */}
                      <div className="flex-1 p-6 md:p-8 space-y-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-center gap-4">
                            <div className={`w-12 h-12 rounded-xl ${colors.bgLight} flex items-center justify-center`}>
                              <position.icon className={`w-6 h-6 ${colors.text}`} />
                            </div>
                            <div>
                              <h3 className="text-xl md:text-2xl font-bold">{position.title}</h3>
                              <div className="flex flex-wrap items-center gap-2 mt-1">
                                <Badge variant="secondary" className={colors.badge}>
                                  {position.type}
                                </Badge>
                              </div>
                            </div>
                          </div>
                        </div>
                        
                        <p className="text-muted-foreground">{position.description}</p>
                        
                        <div className="flex flex-wrap gap-4 text-sm">
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <MapPin className="w-4 h-4" />
                            {position.location}
                          </div>
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <DollarSign className="w-4 h-4" />
                            {position.salary}
                          </div>
                        </div>
                        
                        {/* Key benefits preview */}
                        <div className="flex flex-wrap gap-2 pt-2">
                          {position.benefits.slice(0, 3).map((benefit, idx) => (
                            <div key={idx} className="flex items-center gap-1.5 text-sm text-muted-foreground">
                              <CheckCircle className={`w-4 h-4 ${colors.text}`} />
                              {benefit}
                            </div>
                          ))}
                        </div>
                      </div>
                      
                      {/* Right side - CTA */}
                      <div className="lg:w-64 p-6 md:p-8 bg-slate-50 dark:bg-slate-800/50 flex flex-col justify-center items-center lg:items-stretch gap-4 border-t lg:border-t-0 lg:border-l border-border">
                        <Button 
                          size="lg" 
                          className={`w-full ${position.color === 'emerald' ? 'bg-emerald-500 hover:bg-emerald-600' : position.color === 'violet' ? 'bg-violet-500 hover:bg-violet-600' : ''}`}
                          onClick={() => handleApply(position)}
                        >
                          Apply Now
                          <ArrowRight className="w-4 h-4 ml-2" />
                        </Button>
                        <p className="text-xs text-center text-muted-foreground">
                          Quick application • 5 min
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 md:py-24 bg-primary text-primary-foreground">
        <div className="container max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Don't See the Right Fit?
          </h2>
          <p className="text-lg opacity-90 mb-8 max-w-2xl mx-auto">
            We're always looking for talented individuals. Send us your resume and we'll reach out when a position matches your skills.
          </p>
          <Button 
            size="lg" 
            variant="secondary"
            className="h-12 px-8"
            onClick={() => {
              setSelectedPosition({
                id: 'general',
                title: 'General Application',
                type: 'full-time',
                location: 'Various',
                salary: 'Competitive',
                description: 'General application for future opportunities',
                responsibilities: [],
                requirements: [],
                benefits: [],
                icon: Briefcase,
                color: 'primary'
              });
              setIsApplying(true);
            }}
          >
            <Send className="w-5 h-5 mr-2" />
            Send General Application
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 border-t">
        <div className="container max-w-6xl mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <img src="/novara-logo.png" alt="Novara" className="h-8 w-8 rounded-lg" />
              <span className="font-semibold">Novara Cleaning</span>
            </div>
            <p className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} Novara Cleaning. All rights reserved.
            </p>
          </div>
        </div>
      </footer>

      {/* Application Dialog */}
      <Dialog open={isApplying} onOpenChange={setIsApplying}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl">
              Apply for {selectedPosition?.title}
            </DialogTitle>
            <DialogDescription>
              Fill out the form below and we'll get back to you within 48 hours.
            </DialogDescription>
          </DialogHeader>
          
          <form onSubmit={handleSubmitApplication} className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="name">Full Name *</Label>
              <Input
                id="name"
                placeholder="John Doe"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                required
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="email">Email *</Label>
              <Input
                id="email"
                type="email"
                placeholder="john@example.com"
                value={formData.email}
                onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                required
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number *</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="(555) 123-4567"
                value={formData.phone}
                onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                required
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="resume">LinkedIn or Resume URL</Label>
              <Input
                id="resume"
                type="url"
                placeholder="https://linkedin.com/in/yourprofile"
                value={formData.resume}
                onChange={(e) => setFormData(prev => ({ ...prev, resume: e.target.value }))}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="coverLetter">Why do you want to join Novara? *</Label>
              <Textarea
                id="coverLetter"
                placeholder="Tell us about yourself and why you're interested in this position..."
                rows={4}
                value={formData.coverLetter}
                onChange={(e) => setFormData(prev => ({ ...prev, coverLetter: e.target.value }))}
                required
              />
            </div>
            
            <Button type="submit" className="w-full h-11" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  Submit Application
                  <ArrowRight className="w-4 h-4 ml-2" />
                </>
              )}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
