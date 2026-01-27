import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { 
  ArrowLeft,
  MapPin, 
  Clock, 
  DollarSign, 
  Sparkles,
  Car,
  Smartphone,
  Heart,
  CheckCircle2,
  Users,
  ClipboardList,
  Star,
  TrendingUp,
  RefreshCw
} from "lucide-react";

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
  location: 'Washington DC Metro Area',
  type: 'Part-time / Full-time',
  compensation: '$18 - $25/hour',
  mission: 'We believe every home deserves exceptional care. Our Field Cleaners are the heart of Novara, transforming spaces and creating joy for our customers through meticulous attention to detail and genuine care.',
  description: 'Join our team of professional cleaners delivering exceptional cleaning services to homes across the DMV area. Flexible hours and competitive pay.',
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

const aboutContent = `Novara Cleaning delivers premium residential cleaning services across the DC, Maryland & Virginia area. We exist to transform homes and create peace of mind for busy families.

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
  <MapPin key="6" className="w-4 h-4" />,
  <Heart key="7" className="w-4 h-4" />,
];

export default function FieldCleanerRole() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    
    // Load Fillout embed script
    const script = document.createElement('script');
    script.src = 'https://server.fillout.com/embed/v1/';
    script.async = true;
    document.body.appendChild(script);

    return () => {
      // Cleanup script on unmount
      const existingScript = document.querySelector('script[src="https://server.fillout.com/embed/v1/"]');
      if (existingScript) {
        existingScript.remove();
      }
    };
  }, []);

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

          {/* Ascension Program Section */}
          <section className={`mb-16 ${mounted ? 'animate-fade-in animation-delay-400' : 'opacity-0'}`}>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center text-white shadow-lg shadow-primary/30">
                <TrendingUp className="w-4 h-4" />
              </div>
              <div>
                <h2 className="section-label">Novara Ascension Program</h2>
                <p className="text-xs text-slate-500 mt-0.5">"Grow With Us"</p>
              </div>
            </div>
            
            {/* Tier Cards */}
            <div className="grid md:grid-cols-3 gap-4 mb-8">
              {/* Tier 1 - Foundation */}
              <div className="relative p-6 rounded-2xl bg-slate-50 border border-slate-200 hover:border-slate-300 transition-all">
                <div className="flex items-center gap-2 mb-4">
                  <span className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 font-bold text-sm">1</span>
                  <div>
                    <h3 className="font-semibold text-slate-900">Foundation</h3>
                    <p className="text-xs text-slate-500">Entry Level</p>
                  </div>
                </div>
                <div className="mb-4">
                  <p className="text-2xl font-bold text-slate-900">$18<span className="text-sm font-normal text-slate-500">/hr</span></p>
                </div>
                <div className="space-y-2 mb-4">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Requirements</p>
                  <ul className="text-sm text-slate-600 space-y-1">
                    <li className="flex items-start gap-2">
                      <span className="w-1 h-1 rounded-full bg-slate-400 mt-2 shrink-0" />
                      New contractor (0–6 months)
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1 h-1 rounded-full bg-slate-400 mt-2 shrink-0" />
                      Completed onboarding + training
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1 h-1 rounded-full bg-slate-400 mt-2 shrink-0" />
                      Maintain 4.8+ star rating
                    </li>
                  </ul>
                </div>
                <div className="space-y-2 mb-4">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Job Access</p>
                  <p className="text-sm text-slate-600">Standard cleans only</p>
                </div>
                <div className="pt-4 border-t border-slate-200">
                  <p className="text-xs text-slate-500">Platform Fee: <span className="font-semibold text-slate-700">10%</span></p>
                </div>
              </div>

              {/* Tier 2 - Proven */}
              <div className="relative p-6 rounded-2xl bg-gradient-to-br from-primary/5 to-white border-2 border-primary/20 hover:border-primary/40 transition-all">
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="px-3 py-1 rounded-full text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20">POPULAR</span>
                </div>
                <div className="flex items-center gap-2 mb-4">
                  <span className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-sm">2</span>
                  <div>
                    <h3 className="font-semibold text-slate-900">Proven</h3>
                    <p className="text-xs text-slate-500">Mid Level</p>
                  </div>
                </div>
                <div className="mb-4">
                  <p className="text-2xl font-bold text-primary">$20<span className="text-sm font-normal text-slate-500">/hr</span></p>
                </div>
                <div className="space-y-2 mb-4">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Requirements</p>
                  <ul className="text-sm text-slate-600 space-y-1">
                    <li className="flex items-start gap-2">
                      <span className="w-1 h-1 rounded-full bg-primary mt-2 shrink-0" />
                      6+ months tenure
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1 h-1 rounded-full bg-primary mt-2 shrink-0" />
                      25+ jobs completed
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1 h-1 rounded-full bg-primary mt-2 shrink-0" />
                      4.8+ star rating average
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1 h-1 rounded-full bg-primary mt-2 shrink-0" />
                      90%+ on-time rate
                    </li>
                  </ul>
                </div>
                <div className="space-y-2 mb-4">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Job Access</p>
                  <p className="text-sm text-slate-600">Standard cleans + Deep cleans (higher pay)</p>
                </div>
                <div className="pt-4 border-t border-primary/10">
                  <p className="text-xs text-slate-500">Platform Fee: <span className="font-semibold text-primary">7%</span></p>
                </div>
              </div>

              {/* Tier 3 - Elite */}
              <div className="relative p-6 rounded-2xl bg-gradient-to-br from-amber-50 to-white border-2 border-amber-200 hover:border-amber-300 transition-all">
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="px-3 py-1 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700 border border-amber-200">TOP TIER</span>
                </div>
                <div className="flex items-center gap-2 mb-4">
                  <span className="w-8 h-8 rounded-full bg-amber-200 flex items-center justify-center text-amber-700 font-bold text-sm">3</span>
                  <div>
                    <h3 className="font-semibold text-slate-900">Elite</h3>
                    <p className="text-xs text-slate-500">Top Performer</p>
                  </div>
                </div>
                <div className="mb-4">
                  <p className="text-2xl font-bold text-amber-600">$22<span className="text-sm font-normal text-slate-500">/hr</span></p>
                </div>
                <div className="space-y-2 mb-4">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Requirements</p>
                  <ul className="text-sm text-slate-600 space-y-1">
                    <li className="flex items-start gap-2">
                      <span className="w-1 h-1 rounded-full bg-amber-500 mt-2 shrink-0" />
                      12+ months tenure
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1 h-1 rounded-full bg-amber-500 mt-2 shrink-0" />
                      50+ jobs completed
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1 h-1 rounded-full bg-amber-500 mt-2 shrink-0" />
                      4.8+ star rating average
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1 h-1 rounded-full bg-amber-500 mt-2 shrink-0" />
                      95%+ on-time rate
                    </li>
                  </ul>
                </div>
                <div className="space-y-2 mb-4">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Job Access</p>
                  <p className="text-sm text-slate-600">All job types + Priority booking (first access)</p>
                </div>
                <div className="pt-4 border-t border-amber-200">
                  <p className="text-xs text-slate-500">Platform Fee: <span className="font-semibold text-amber-600">5%</span></p>
                </div>
              </div>
            </div>

            {/* Tier Review Process */}
            <div className="p-6 rounded-xl bg-slate-50 border border-slate-200">
              <h4 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-primary" />
                Tier Review Process
              </h4>
              <ul className="space-y-2 text-sm text-slate-600">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                  Automatic review at 6 months and 12 months
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                  Contractors can request early review if metrics are met
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                  Tier status can be downgraded if rating drops below 4.8 for 60+ days
                </li>
              </ul>
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

          {/* Application Section - Fillout Embed */}
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
              
              {/* Fillout Form Embed */}
              <div className="relative" style={{ minHeight: '600px' }}>
                <div 
                  data-fillout-id="p9FCwh89JPus" 
                  data-fillout-embed-type="standard"
                  data-fillout-inherit-parameters
                  style={{ width: '100%', height: '600px' }}
                />
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
