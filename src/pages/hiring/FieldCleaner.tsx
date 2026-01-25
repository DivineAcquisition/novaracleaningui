import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { 
  ArrowLeft,
  ArrowRight,
  MapPin, 
  Clock, 
  DollarSign, 
  CheckCircle2,
  Sparkles,
  Car,
  Smartphone,
  Heart,
  Loader2,
  Building2
} from "lucide-react";
import { toast } from "sonner";

export default function FieldCleanerRole() {
  const [isApplying, setIsApplying] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    experience: '',
    availability: '',
    message: ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    await new Promise(resolve => setTimeout(resolve, 1500));
    toast.success('Application submitted! We\'ll contact you within 48 hours.');
    setIsApplying(false);
    setFormData({ name: '', email: '', phone: '', experience: '', availability: '', message: '' });
    setIsSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <img src="/novara-logo.png" alt="Novara" className="h-9 w-9 rounded-lg" />
            <span className="font-bold text-lg">Novara</span>
          </Link>
          <Button onClick={() => setIsApplying(true)}>
            Apply Now
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Back Link */}
      <div className="container pt-6">
        <Link to="/" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to all positions
        </Link>
      </div>

      {/* Hero */}
      <section className="container py-12">
        <div className="max-w-3xl">
          <Badge variant="secondary" className="mb-4">Operations</Badge>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl mb-4">
            Field Cleaner
          </h1>
          <p className="text-xl text-muted-foreground mb-6">
            Join our team of professional cleaners delivering exceptional cleaning services to homes across the DFW metroplex.
          </p>
          
          <div className="flex flex-wrap gap-4 mb-8">
            <div className="flex items-center gap-2 text-muted-foreground">
              <MapPin className="h-4 w-4" />
              <span>Dallas-Fort Worth, TX</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>Part-time / Full-time</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <DollarSign className="h-4 w-4" />
              <span>$18 - $25/hour</span>
            </div>
          </div>

          <Button size="lg" onClick={() => setIsApplying(true)}>
            Apply for this position
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </section>

      <Separator />

      {/* Content */}
      <section className="container py-12">
        <div className="grid lg:grid-cols-3 gap-12">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-10">
            {/* About */}
            <div>
              <h2 className="text-2xl font-semibold mb-4">About This Role</h2>
              <p className="text-muted-foreground leading-relaxed">
                As a Field Cleaner at Novara, you'll be the face of our company, delivering exceptional cleaning experiences to our valued customers. You'll work independently or as part of a two-person team, following our proven 40-point cleaning checklist to ensure consistent, high-quality results every time.
              </p>
              <p className="text-muted-foreground leading-relaxed mt-4">
                This role offers flexible scheduling, allowing you to choose hours that work for your lifestyle. Whether you're looking for part-time work or a full-time career, we have opportunities to match your goals.
              </p>
            </div>

            {/* Responsibilities */}
            <div>
              <h2 className="text-2xl font-semibold mb-4">What You'll Do</h2>
              <ul className="space-y-3">
                {[
                  'Perform residential deep cleaning and maintenance cleaning services',
                  'Follow our comprehensive 40-point cleaning checklist',
                  'Communicate professionally with clients about their needs',
                  'Maintain and care for cleaning supplies and equipment',
                  'Complete jobs within estimated timeframes',
                  'Report any issues or special requests to management',
                  'Maintain a positive, professional attitude at all times',
                ].map((item, idx) => (
                  <li key={idx} className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                    <span className="text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Requirements */}
            <div>
              <h2 className="text-2xl font-semibold mb-4">What We're Looking For</h2>
              <ul className="space-y-3">
                {[
                  'Reliable personal transportation to travel between job sites',
                  'Smartphone capable of running our job management app',
                  'Ability to lift up to 25 lbs and stand for extended periods',
                  'Strong attention to detail and pride in your work',
                  'Positive attitude and professional demeanor',
                  'Ability to pass a background check',
                  'Legal authorization to work in the United States',
                ].map((item, idx) => (
                  <li key={idx} className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                    <span className="text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Benefits Card */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">What We Offer</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {[
                  { icon: Clock, title: 'Flexible Scheduling', desc: 'You choose your hours' },
                  { icon: DollarSign, title: 'Weekly Pay', desc: 'Direct deposit every week' },
                  { icon: Sparkles, title: 'Performance Bonuses', desc: 'Earn more with great reviews' },
                  { icon: Car, title: 'Mileage Reimbursement', desc: 'Gas compensation provided' },
                  { icon: Smartphone, title: 'Equipment Provided', desc: 'All supplies included' },
                  { icon: Heart, title: 'Supportive Team', desc: 'Training and ongoing support' },
                ].map((benefit, idx) => (
                  <div key={idx} className="flex items-start gap-3">
                    <div className="rounded-md bg-primary/10 p-2">
                      <benefit.icon className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{benefit.title}</p>
                      <p className="text-xs text-muted-foreground">{benefit.desc}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Apply Card */}
            <Card className="border-primary">
              <CardContent className="pt-6">
                <h3 className="font-semibold mb-2">Ready to join?</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Start your application today and hear back within 48 hours.
                </p>
                <Button className="w-full" onClick={() => setIsApplying(true)}>
                  Apply Now
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Application Dialog */}
      <Dialog open={isApplying} onOpenChange={setIsApplying}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Apply for Field Cleaner</DialogTitle>
            <DialogDescription>
              Fill out the form below and we'll get back to you within 48 hours.
            </DialogDescription>
          </DialogHeader>
          
          <form onSubmit={handleSubmit} className="space-y-4 pt-4">
            <div className="grid sm:grid-cols-2 gap-4">
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
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="experience">Cleaning Experience</Label>
                <Input
                  id="experience"
                  placeholder="e.g., 2 years"
                  value={formData.experience}
                  onChange={(e) => setFormData(prev => ({ ...prev, experience: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="availability">Availability *</Label>
              <Input
                id="availability"
                placeholder="e.g., Weekdays 9am-5pm, flexible weekends"
                value={formData.availability}
                onChange={(e) => setFormData(prev => ({ ...prev, availability: e.target.value }))}
                required
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="message">Why do you want to join Novara?</Label>
              <Textarea
                id="message"
                placeholder="Tell us about yourself..."
                rows={3}
                value={formData.message}
                onChange={(e) => setFormData(prev => ({ ...prev, message: e.target.value }))}
              />
            </div>
            
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                'Submit Application'
              )}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
