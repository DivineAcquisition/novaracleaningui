import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  ArrowLeft,
  ArrowRight,
  MapPin, 
  Clock, 
  DollarSign, 
  Briefcase,
  Loader2,
  Sparkles,
  Car,
  Smartphone,
  Heart,
  CheckCircle2,
  Users,
  ClipboardList,
  Star
} from "lucide-react";
import { toast } from "sonner";

// Glowing dot component
function GlowDot() {
  return (
    <span className="relative flex h-2 w-2">
      <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-75 animate-ping-dot" />
      <span className="relative inline-flex rounded-full h-2 w-2 bg-primary shadow-[0_0_10px_hsl(260_100%_50%/0.5)]" />
    </span>
  );
}

const jobData = {
  title: 'Field Cleaner',
  subtitle: 'Operations',
  department: 'Operations',
  location: 'Dallas-Fort Worth, TX',
  type: 'Part-time / Full-time',
  compensation: '$18 - $25/hour',
  mission: 'We believe every home deserves exceptional care. Our Field Cleaners are the heart of Novara, transforming spaces and creating joy for our customers through meticulous attention to detail and genuine care.',
  description: 'Join our team of professional cleaners delivering exceptional cleaning services to homes across the DFW metroplex. Flexible hours and competitive pay.',
  sections: [
    {
      title: 'Responsibilities',
      type: 'list' as const,
      items: [
        'Perform residential deep cleaning and maintenance cleaning services',
        'Follow our comprehensive 40-point cleaning checklist',
        'Communicate professionally with clients about their needs',
        'Maintain and care for cleaning supplies and equipment',
        'Complete jobs within estimated timeframes',
        'Report any issues or special requests to management',
        'Maintain a positive, professional attitude at all times',
      ],
    },
    {
      title: 'Requirements',
      type: 'list' as const,
      items: [
        'Reliable personal transportation to travel between job sites',
        'Smartphone capable of running our job management app',
        'Ability to lift up to 25 lbs and stand for extended periods',
        'Strong attention to detail and pride in your work',
        'Positive attitude and professional demeanor',
        'Ability to pass a background check',
        'Legal authorization to work in the United States',
      ],
    },
    {
      title: 'Who This Is For',
      type: 'list' as const,
      items: [
        'People who take pride in creating clean, organized spaces',
        'Self-motivated individuals who work well independently',
        'Those seeking flexible hours to fit their lifestyle',
        'Anyone looking to join a growing, supportive team',
      ],
    },
    {
      title: 'Who This Is NOT For',
      type: 'list' as const,
      items: [
        'Those who cut corners or rush through tasks',
        'People who struggle with physical activity',
        'Anyone unreliable with scheduling or punctuality',
        'Those who can\'t maintain a professional attitude',
      ],
    },
    {
      title: 'Compensation',
      type: 'list' as const,
      items: [
        'Starting pay: $18-$25/hour based on experience',
        'Performance bonuses for 5-star reviews',
        'Mileage reimbursement for travel between jobs',
        'Weekly direct deposit payments',
        'Opportunity for raises as you grow',
      ],
    },
  ],
  benefits: [
    { icon: Clock, title: 'Flexible Scheduling', desc: 'You choose your hours' },
    { icon: DollarSign, title: 'Weekly Pay', desc: 'Direct deposit every week' },
    { icon: Sparkles, title: 'Performance Bonuses', desc: 'Earn more with great reviews' },
    { icon: Car, title: 'Mileage Reimbursement', desc: 'Gas compensation provided' },
    { icon: Smartphone, title: 'Equipment Provided', desc: 'All supplies included' },
    { icon: Heart, title: 'Supportive Team', desc: 'Training and ongoing support' },
  ],
};

const aboutContent = `Novara Cleaning delivers premium residential cleaning services across the Dallas-Fort Worth metroplex. We exist to transform homes and create peace of mind for busy families.

Our philosophy rests on three pillars:
• Excellence — We hold ourselves to the highest standards
• Care — Every home is treated like our own
• Reliability — Consistent, dependable service every time

What we believe:
• Customer first — every decision starts with the customer
• Quality over quantity — we'd rather do fewer jobs exceptionally
• Team success — we win and lose together
• Continuous improvement — we're always getting better

Why join us:
Novara is more than a cleaning company. We're building a team of professionals who take pride in their work and care about making a difference. If you want to be part of something growing — and earn well while doing it — keep reading.`;

const responsibilityIcons = [
  <ClipboardList key="1" className="w-4 h-4" />,
  <CheckCircle2 key="2" className="w-4 h-4" />,
  <Users key="3" className="w-4 h-4" />,
  <Star key="4" className="w-4 h-4" />,
  <Clock key="5" className="w-4 h-4" />,
  <Briefcase key="6" className="w-4 h-4" />,
  <Heart key="7" className="w-4 h-4" />,
];

export default function FieldCleanerRole() {
  const [mounted, setMounted] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    phone: '',
    experience: '',
    availability: '',
    whyYou: '',
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    await new Promise(resolve => setTimeout(resolve, 1500));
    toast.success('Application submitted! We\'ll contact you within 48 hours.');
    setIsApplying(false);
    setFormData({ fullName: '', email: '', phone: '', experience: '', availability: '', whyYou: '' });
    setIsSubmitting(false);
  };

  const shouldUseIcons = (title: string) => {
    return title === 'Responsibilities' || title === 'Requirements';
  };

  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased selection:bg-primary/20 selection:text-primary overflow-x-hidden">
      
      {/* Grid Background */}
      <div className="fixed inset-0 pointer-events-none grid-pattern" />

      {/* Background Glow Effects */}
      <div className="fixed inset-0 pointer-events-none">
        {/* Main top glow */}
        <div 
          className="absolute top-[-15%] left-1/2 -translate-x-1/2 w-full md:w-[1200px] h-[700px]"
          style={{
            background: 'radial-gradient(ellipse at center, hsl(260 100% 50% / 0.08) 0%, hsl(260 100% 50% / 0.03) 40%, transparent 70%)',
            filter: 'blur(60px)',
          }}
        />
        {/* Bottom right glow */}
        <div 
          className="absolute bottom-[-10%] right-0 w-[500px] h-[500px]"
          style={{
            background: 'radial-gradient(ellipse at bottom right, hsl(260 100% 70% / 0.1) 0%, transparent 60%)',
            filter: 'blur(80px)',
          }}
        />
        {/* Left side glow */}
        <div 
          className="absolute top-1/2 left-0 -translate-y-1/2 w-[400px] h-[500px]"
          style={{
            background: 'radial-gradient(ellipse at left center, hsl(260 100% 70% / 0.08) 0%, transparent 50%)',
            filter: 'blur(60px)',
          }}
        />
      </div>

      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 h-20 border-b border-slate-200/50 bg-white/90 backdrop-blur-xl">
        <div className="max-w-5xl mx-auto h-full px-6 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3 group">
            <img 
              src="/novara-logo.png" 
              alt="Novara" 
              className="h-10 w-10 rounded-xl group-hover:opacity-80 transition-opacity"
            />
            <span className="font-bold text-xl text-slate-900">Novara</span>
          </Link>
          
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold bg-primary text-white hover:bg-primary/90 transition-all shadow-lg shadow-primary/25"
          >
            <ArrowLeft className="w-4 h-4" />
            All Positions
          </Link>
        </div>
      </nav>

      {/* Main Content */}
      <main className="relative z-10 pt-28 pb-20 px-6">
        <div className="max-w-4xl mx-auto">
          
          {/* Hero Section */}
          <section className={`mb-16 ${mounted ? 'animate-fade-in' : 'opacity-0'}`}>
            {/* Department Badge */}
            <div className="flex items-center gap-3 mb-6">
              <span className="w-8 h-px bg-gradient-to-r from-primary to-transparent" />
              <span className="text-xs font-semibold text-primary uppercase tracking-widest">
                {jobData.department}
              </span>
            </div>

            {/* Title */}
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-slate-900 tracking-tight mb-6">
              {jobData.title}
            </h1>

            {/* Description */}
            <p className="text-xl text-slate-600 leading-relaxed mb-10 max-w-3xl">
              {jobData.description}
            </p>

            {/* Meta Info Bar */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 p-6 rounded-2xl bg-slate-50/80 border border-slate-200/50 backdrop-blur-sm">
              <div>
                <p className="section-label mb-1">Department</p>
                <p className="text-sm font-medium text-slate-900">{jobData.department}</p>
              </div>
              <div>
                <p className="section-label mb-1">Location</p>
                <p className="text-sm font-medium text-slate-900">{jobData.location}</p>
              </div>
              <div>
                <p className="section-label mb-1">Type</p>
                <p className="text-sm font-medium text-slate-900">{jobData.type}</p>
              </div>
              <div>
                <p className="section-label mb-1">Compensation</p>
                <p className="text-sm font-medium text-primary">{jobData.compensation}</p>
              </div>
            </div>
          </section>

          {/* Mission Section */}
          <section className={`mb-16 ${mounted ? 'animate-fade-in animation-delay-100' : 'opacity-0'}`}>
            <div className="flex items-center gap-3 mb-6">
              <GlowDot />
              <h2 className="section-label">The Mission</h2>
            </div>
            <p className="text-lg text-slate-600 leading-relaxed">
              {jobData.mission}
            </p>
          </section>

          {/* Content Sections */}
          {jobData.sections.map((section, sectionIndex) => (
            <section key={sectionIndex} className={`mb-16 ${mounted ? 'animate-fade-in' : 'opacity-0'}`} style={{ animationDelay: `${(sectionIndex + 2) * 100}ms` }}>
              <div className="flex items-center gap-3 mb-6">
                {shouldUseIcons(section.title) ? (
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                    {section.title === 'Responsibilities' ? (
                      <ClipboardList className="w-4 h-4" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4" />
                    )}
                  </div>
                ) : (
                  <GlowDot />
                )}
                <h2 className="section-label">{section.title}</h2>
              </div>
              
              {section.type === 'list' && section.items && (
                <div className="space-y-4">
                  {section.items.map((item, itemIndex) => (
                    <div key={itemIndex} className="flex items-start gap-4 group">
                      {shouldUseIcons(section.title) ? (
                        <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-primary group-hover:bg-primary/10 group-hover:border-primary/20 transition-all">
                          {responsibilityIcons[itemIndex % responsibilityIcons.length]}
                        </div>
                      ) : (
                        <div className="flex-shrink-0 mt-2">
                          <span className="block w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_8px_hsl(260_100%_50%/0.4)]" />
                        </div>
                      )}
                      <div className="flex-1 pt-1">
                        <p className="text-slate-600 leading-relaxed">{item}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ))}

          {/* Benefits Section */}
          <section className={`mb-16 ${mounted ? 'animate-fade-in animation-delay-400' : 'opacity-0'}`}>
            <div className="flex items-center gap-3 mb-6">
              <GlowDot />
              <h2 className="section-label">What We Offer</h2>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {jobData.benefits.map((benefit, idx) => (
                <div key={idx} className="p-4 rounded-xl bg-slate-50/80 border border-slate-200/50 hover:border-primary/30 hover:bg-white transition-all group">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-white transition-all">
                      <benefit.icon className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="font-medium text-sm text-slate-900">{benefit.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{benefit.desc}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* About Section */}
          <section className={`mb-16 p-8 rounded-2xl bg-gradient-to-br from-primary/5 to-transparent border border-primary/10 ${mounted ? 'animate-fade-in animation-delay-400' : 'opacity-0'}`}>
            <div className="flex items-center gap-3 mb-6">
              <GlowDot />
              <h2 className="section-label">About Novara Cleaning</h2>
            </div>
            <p className="text-slate-600 leading-relaxed whitespace-pre-line text-sm">
              {aboutContent}
            </p>
          </section>

          {/* Application Section */}
          <section id="apply">
            <div className="relative rounded-2xl bg-white border border-slate-200 overflow-hidden shadow-lg shadow-slate-200/50">
              {/* Background glow */}
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[150px] bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />
              
              {/* Mac-style title bar */}
              <div className="relative flex items-center gap-4 px-6 py-4 border-b border-slate-200 bg-slate-50">
                {/* Traffic light dots */}
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-red-400" />
                  <span className="w-3 h-3 rounded-full bg-yellow-400" />
                  <span className="w-3 h-3 rounded-full bg-green-400" />
                </div>
                
                {/* Step indicator and title */}
                <div className="flex items-center gap-3 flex-1">
                  <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-white text-sm font-bold shadow-lg shadow-primary/30">
                    2
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">Apply for {jobData.title}</h2>
                    <p className="text-xs text-slate-500">Complete the form below to submit your application</p>
                  </div>
                </div>
              </div>
              
              {/* Form content */}
              <div className="relative p-6 md:p-8">
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label htmlFor="fullName" className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                        Full Name *
                      </Label>
                      <Input
                        id="fullName"
                        required
                        value={formData.fullName}
                        onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                        className="h-12 bg-slate-50 border-slate-200 focus:bg-white focus:border-primary"
                        placeholder="John Doe"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email" className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                        Email Address *
                      </Label>
                      <Input
                        id="email"
                        type="email"
                        required
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        className="h-12 bg-slate-50 border-slate-200 focus:bg-white focus:border-primary"
                        placeholder="john@example.com"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label htmlFor="phone" className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                        Phone Number *
                      </Label>
                      <Input
                        id="phone"
                        type="tel"
                        required
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                        className="h-12 bg-slate-50 border-slate-200 focus:bg-white focus:border-primary"
                        placeholder="(555) 123-4567"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="experience" className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                        Cleaning Experience
                      </Label>
                      <Input
                        id="experience"
                        value={formData.experience}
                        onChange={(e) => setFormData({ ...formData, experience: e.target.value })}
                        className="h-12 bg-slate-50 border-slate-200 focus:bg-white focus:border-primary"
                        placeholder="e.g., 2 years residential cleaning"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="availability" className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Availability *
                    </Label>
                    <Select
                      value={formData.availability}
                      onValueChange={(value) => setFormData({ ...formData, availability: value })}
                    >
                      <SelectTrigger className="h-12 bg-slate-50 border-slate-200">
                        <SelectValue placeholder="Select your availability" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="weekdays">Weekdays Only</SelectItem>
                        <SelectItem value="weekends">Weekends Only</SelectItem>
                        <SelectItem value="flexible">Flexible Schedule</SelectItem>
                        <SelectItem value="fulltime">Full-time (40+ hours)</SelectItem>
                        <SelectItem value="parttime">Part-time (20-30 hours)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="whyYou" className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Why do you want to join Novara? *
                    </Label>
                    <Textarea
                      id="whyYou"
                      required
                      rows={4}
                      value={formData.whyYou}
                      onChange={(e) => setFormData({ ...formData, whyYou: e.target.value })}
                      className="bg-slate-50 border-slate-200 focus:bg-white focus:border-primary resize-none"
                      placeholder="Tell us about yourself and what excites you about this opportunity..."
                    />
                  </div>

                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full h-14 rounded-xl bg-primary hover:bg-primary/90 text-white font-semibold shadow-lg shadow-primary/30"
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

                  <p className="text-xs text-slate-500 text-center">
                    By submitting, you agree to our privacy policy and consent to being contacted about this opportunity.
                  </p>
                </form>
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-slate-200">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-3">
              <img 
                src="/novara-logo.png" 
                alt="Novara" 
                className="h-8 w-8 rounded-lg opacity-80 hover:opacity-100 transition-opacity"
              />
              <span className="text-slate-500 text-sm font-medium">
                {new Date().getFullYear()} © Novara Cleaning. All rights reserved.
              </span>
            </div>
            <div className="flex items-center gap-6">
              <a href="https://novaracleaning.com" className="text-xs text-slate-400 font-medium hover:text-primary transition-colors">
                Website
              </a>
              <a href="mailto:careers@novaracleaning.com" className="text-xs text-slate-400 font-medium hover:text-primary transition-colors">
                Contact
              </a>
              <a href="/privacy" className="text-xs text-slate-400 font-medium hover:text-primary transition-colors">
                Privacy
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
