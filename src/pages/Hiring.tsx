import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { 
  Sparkles, 
  MapPin, 
  Clock, 
  DollarSign, 
  ArrowRight,
  Briefcase,
  Users,
  TrendingUp,
  Star,
  Zap,
  Send,
  Loader2,
  ChevronRight,
  Heart,
  Target
} from "lucide-react";
import { toast } from "sonner";

interface Position {
  id: string;
  title: string;
  department: string;
  type: string;
  location: string;
  salary: string;
  description: string;
  link: string;
}

const POSITIONS: Position[] = [
  {
    id: 'field-cleaner',
    title: 'Field Cleaner',
    department: 'Operations',
    type: 'Part-time / Full-time',
    location: 'Dallas-Fort Worth, TX',
    salary: '$18 - $25/hour',
    description: 'Join our team of professional cleaners delivering exceptional cleaning services to homes across the DFW metroplex.',
    link: '/field-cleaner',
  },
  {
    id: 'ops-coordinator',
    title: 'Operations Coordinator',
    department: 'Operations',
    type: 'Full-time',
    location: 'Remote',
    salary: '$45,000 - $55,000/year',
    description: 'Coordinate daily operations, manage cleaner schedules, and ensure smooth service delivery across our growing operation.',
    link: '/ops-coordinator',
  },
  {
    id: 'executive-assistant',
    title: 'Executive Assistant',
    department: 'Executive',
    type: 'Full-time',
    location: 'Remote',
    salary: '$50,000 - $65,000/year',
    description: 'Support the executive team with administrative tasks, project management, and strategic initiatives as we scale.',
    link: '/executive-assistant',
  },
];

const BENEFITS = [
  {
    icon: DollarSign,
    title: 'Competitive Pay',
    description: 'Industry-leading compensation with performance bonuses',
  },
  {
    icon: Clock,
    title: 'Flexible Hours',
    description: 'Work-life balance with schedules that fit your life',
  },
  {
    icon: TrendingUp,
    title: 'Growth Path',
    description: 'Clear advancement opportunities as we scale',
  },
  {
    icon: Heart,
    title: 'Great Culture',
    description: 'Supportive team environment focused on success',
  },
];

const STATS = [
  { value: '500+', label: 'Happy Customers' },
  { value: '50+', label: 'Team Members' },
  { value: '4.9', label: 'Average Rating' },
  { value: '98%', label: 'Satisfaction Rate' },
];

export default function Hiring() {
  const [selectedPosition, setSelectedPosition] = useState<Position | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    linkedin: '',
    message: ''
  });

  const handleApply = (position: Position) => {
    setSelectedPosition(position);
    setIsApplying(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPosition) return;
    
    setIsSubmitting(true);
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    toast.success('Application submitted! We\'ll be in touch within 48 hours.');
    setIsApplying(false);
    setFormData({ name: '', email: '', phone: '', linkedin: '', message: '' });
    setIsSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-xl border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <img src="/novara-logo.png" alt="Novara" className="h-10 w-10 rounded-xl" />
              <span className="font-bold text-xl text-slate-900">Novara</span>
            </div>
            <Button 
              className="bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25"
              onClick={() => document.getElementById('positions')?.scrollIntoView({ behavior: 'smooth' })}
            >
              View Positions
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-white to-white" />
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-primary/10 rounded-full blur-3xl opacity-50" />
        
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto">
            <Badge className="mb-6 bg-primary/10 text-primary border-0 px-4 py-2 text-sm font-medium">
              <Sparkles className="w-4 h-4 mr-2" />
              We're Growing Fast
            </Badge>
            
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold text-slate-900 tracking-tight leading-tight">
              Build Your Career
              <span className="block text-primary">With Novara</span>
            </h1>
            
            <p className="mt-6 text-xl text-slate-600 leading-relaxed max-w-2xl mx-auto">
              Join a fast-growing team that's transforming the home cleaning industry. 
              We're looking for ambitious people ready to make an impact.
            </p>
            
            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Button 
                size="lg" 
                className="h-14 px-8 text-lg bg-primary hover:bg-primary/90 shadow-xl shadow-primary/30"
                onClick={() => document.getElementById('positions')?.scrollIntoView({ behavior: 'smooth' })}
              >
                View Open Roles
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
              <Button 
                size="lg" 
                variant="outline"
                className="h-14 px-8 text-lg border-2"
                onClick={() => document.getElementById('culture')?.scrollIntoView({ behavior: 'smooth' })}
              >
                Learn About Us
              </Button>
            </div>
          </div>
          
          {/* Stats */}
          <div className="mt-20 grid grid-cols-2 md:grid-cols-4 gap-8">
            {STATS.map((stat, idx) => (
              <div key={idx} className="text-center">
                <div className="text-4xl sm:text-5xl font-bold text-slate-900">{stat.value}</div>
                <div className="mt-2 text-slate-600">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why Join Section */}
      <section id="culture" className="py-24 bg-slate-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <Badge className="mb-4 bg-emerald-100 text-emerald-700 border-0">Why Join Us</Badge>
            <h2 className="text-4xl sm:text-5xl font-bold text-slate-900">
              More Than Just a Job
            </h2>
            <p className="mt-4 text-xl text-slate-600 max-w-2xl mx-auto">
              We invest in our people because we know that's what drives exceptional results.
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {BENEFITS.map((benefit, idx) => (
              <Card key={idx} className="border-0 shadow-lg shadow-slate-200/50 hover:shadow-xl transition-shadow">
                <CardContent className="p-6">
                  <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                    <benefit.icon className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">{benefit.title}</h3>
                  <p className="text-slate-600">{benefit.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Open Positions */}
      <section id="positions" className="py-24 scroll-mt-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <Badge className="mb-4 bg-primary/10 text-primary border-0">Open Positions</Badge>
            <h2 className="text-4xl sm:text-5xl font-bold text-slate-900">
              Find Your Role
            </h2>
            <p className="mt-4 text-xl text-slate-600 max-w-2xl mx-auto">
              We have opportunities across multiple departments. Find the one that fits you.
            </p>
          </div>
          
          <div className="space-y-4">
            {POSITIONS.map((position) => (
              <Link key={position.id} to={position.link}>
                <Card className="border border-slate-200 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10 transition-all cursor-pointer group">
                  <CardContent className="p-6">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-xl font-semibold text-slate-900 group-hover:text-primary transition-colors">
                            {position.title}
                          </h3>
                          <Badge variant="secondary" className="bg-slate-100 text-slate-700">
                            {position.department}
                          </Badge>
                        </div>
                        <p className="text-slate-600 mb-4 line-clamp-2">{position.description}</p>
                        <div className="flex flex-wrap items-center gap-4 text-sm text-slate-500">
                          <span className="flex items-center gap-1.5">
                            <MapPin className="w-4 h-4" />
                            {position.location}
                          </span>
                          <span className="flex items-center gap-1.5">
                            <Clock className="w-4 h-4" />
                            {position.type}
                          </span>
                          <span className="flex items-center gap-1.5">
                            <DollarSign className="w-4 h-4" />
                            {position.salary}
                          </span>
                        </div>
                      </div>
                      <Button className="shrink-0 bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25 group-hover:shadow-xl group-hover:shadow-primary/30 transition-all">
                        View Role
                        <ArrowRight className="w-4 h-4 ml-2" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Values Section */}
      <section className="py-24 bg-slate-900 text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <Badge className="mb-6 bg-white/10 text-white border-0">Our Values</Badge>
              <h2 className="text-4xl sm:text-5xl font-bold mb-6">
                What Drives Us Forward
              </h2>
              <p className="text-xl text-slate-300 mb-8">
                We're building more than a cleaning company. We're creating a culture where 
                everyone can thrive and grow.
              </p>
              <Button 
                size="lg"
                className="bg-white text-slate-900 hover:bg-slate-100"
                onClick={() => document.getElementById('positions')?.scrollIntoView({ behavior: 'smooth' })}
              >
                Join Our Team
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </div>
            <div className="grid gap-6">
              {[
                { icon: Target, title: 'Customer Obsessed', desc: 'Every decision starts with the customer' },
                { icon: Zap, title: 'Move Fast', desc: 'Speed and quality are not mutually exclusive' },
                { icon: Users, title: 'Team First', desc: 'We win and lose together as a team' },
                { icon: Star, title: 'Excellence Always', desc: 'Good enough is never good enough' },
              ].map((value, idx) => (
                <div key={idx} className="flex items-start gap-4 p-4 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
                  <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center shrink-0">
                    <value.icon className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg mb-1">{value.title}</h3>
                    <p className="text-slate-400">{value.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-4xl sm:text-5xl font-bold text-slate-900 mb-6">
            Ready to Make an Impact?
          </h2>
          <p className="text-xl text-slate-600 mb-10 max-w-2xl mx-auto">
            Don't see the perfect role? We're always looking for exceptional talent. 
            Send us your information and we'll reach out when something opens up.
          </p>
          <Button 
            size="lg"
            className="h-14 px-10 text-lg bg-primary hover:bg-primary/90 shadow-xl shadow-primary/30"
            onClick={() => {
              setSelectedPosition({
                id: 'general',
                title: 'General Application',
                department: 'Various',
                type: 'Various',
                location: 'Various',
                salary: 'Competitive',
                description: 'General application for future opportunities',
                responsibilities: [],
                requirements: [],
              });
              setIsApplying(true);
            }}
          >
            <Send className="w-5 h-5 mr-2" />
            Submit General Application
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 border-t border-slate-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <img src="/novara-logo.png" alt="Novara" className="h-8 w-8 rounded-lg" />
              <span className="font-semibold text-slate-900">Novara Cleaning</span>
            </div>
            <p className="text-sm text-slate-500">
              © {new Date().getFullYear()} Novara Cleaning. All rights reserved.
            </p>
          </div>
        </div>
      </footer>

      {/* Application Modal */}
      <Dialog open={isApplying} onOpenChange={setIsApplying}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold">
              Apply for {selectedPosition?.title}
            </DialogTitle>
          </DialogHeader>
          
          <form onSubmit={handleSubmit} className="space-y-5 pt-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Full Name *</Label>
                <Input
                  id="name"
                  placeholder="John Doe"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  required
                  className="h-11"
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
                  className="h-11"
                />
              </div>
            </div>
            
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="phone">Phone *</Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="(555) 123-4567"
                  value={formData.phone}
                  onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                  required
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="linkedin">LinkedIn URL</Label>
                <Input
                  id="linkedin"
                  type="url"
                  placeholder="linkedin.com/in/..."
                  value={formData.linkedin}
                  onChange={(e) => setFormData(prev => ({ ...prev, linkedin: e.target.value }))}
                  className="h-11"
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="message">Why do you want to join Novara? *</Label>
              <Textarea
                id="message"
                placeholder="Tell us about yourself and what excites you about this opportunity..."
                rows={4}
                value={formData.message}
                onChange={(e) => setFormData(prev => ({ ...prev, message: e.target.value }))}
                required
              />
            </div>
            
            <Button 
              type="submit" 
              className="w-full h-12 text-base bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25" 
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  Submit Application
                  <ArrowRight className="w-5 h-5 ml-2" />
                </>
              )}
            </Button>
            
            <p className="text-xs text-center text-slate-500">
              By submitting, you agree to our privacy policy and terms of service.
            </p>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
