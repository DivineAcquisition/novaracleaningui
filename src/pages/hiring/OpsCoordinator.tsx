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
  Laptop,
  HeartHandshake,
  TrendingUp,
  Umbrella,
  Calendar,
  Users,
  Loader2
} from "lucide-react";
import { toast } from "sonner";

export default function OpsCoordinatorRole() {
  const [isApplying, setIsApplying] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    linkedin: '',
    experience: '',
    message: ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    await new Promise(resolve => setTimeout(resolve, 1500));
    toast.success('Application submitted! We\'ll contact you within 48 hours.');
    setIsApplying(false);
    setFormData({ name: '', email: '', phone: '', linkedin: '', experience: '', message: '' });
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
            Operations Coordinator
          </h1>
          <p className="text-xl text-muted-foreground mb-6">
            Coordinate daily operations, manage cleaner schedules, and ensure smooth service delivery as we scale our growing cleaning operation.
          </p>
          
          <div className="flex flex-wrap gap-4 mb-8">
            <div className="flex items-center gap-2 text-muted-foreground">
              <MapPin className="h-4 w-4" />
              <span>Remote (US)</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>Full-time</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <DollarSign className="h-4 w-4" />
              <span>$45,000 - $55,000/year</span>
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
                As an Operations Coordinator at Novara, you'll be the backbone of our service delivery. You'll manage the day-to-day scheduling of our cleaning teams, handle customer communications, and ensure that every job runs smoothly from start to finish.
              </p>
              <p className="text-muted-foreground leading-relaxed mt-4">
                This is a fully remote position that offers the opportunity to make a real impact on a fast-growing company. You'll work closely with our leadership team and have a direct influence on customer satisfaction and team efficiency.
              </p>
            </div>

            {/* Responsibilities */}
            <div>
              <h2 className="text-2xl font-semibold mb-4">What You'll Do</h2>
              <ul className="space-y-3">
                {[
                  'Manage daily cleaner schedules and optimize job assignments',
                  'Handle customer inquiries, booking changes, and special requests',
                  'Coordinate emergency coverage and last-minute rescheduling',
                  'Monitor job completion rates and quality metrics',
                  'Onboard and train new cleaning staff on procedures',
                  'Maintain operational documentation and SOPs',
                  'Collaborate with leadership on process improvements',
                  'Ensure excellent customer communication throughout service delivery',
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
                  '2+ years of experience in operations, scheduling, or customer service',
                  'Experience with scheduling software and CRM systems',
                  'Excellent written and verbal communication skills',
                  'Strong problem-solving abilities and quick thinking',
                  'Ability to thrive in a fast-paced, dynamic environment',
                  'Detail-oriented with strong organizational skills',
                  'Experience managing remote teams is a plus',
                  'Home services industry experience preferred but not required',
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
                  { icon: Laptop, title: 'Fully Remote', desc: 'Work from anywhere in the US' },
                  { icon: HeartHandshake, title: 'Health Insurance', desc: 'Medical, dental, and vision' },
                  { icon: Umbrella, title: 'PTO', desc: 'Generous paid time off' },
                  { icon: TrendingUp, title: '401(k) Match', desc: 'Company retirement matching' },
                  { icon: Calendar, title: 'Flexible Schedule', desc: 'Results-focused culture' },
                  { icon: Users, title: 'Team Retreats', desc: 'Annual company gatherings' },
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
            <DialogTitle>Apply for Operations Coordinator</DialogTitle>
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
                <Label htmlFor="linkedin">LinkedIn URL</Label>
                <Input
                  id="linkedin"
                  type="url"
                  placeholder="linkedin.com/in/..."
                  value={formData.linkedin}
                  onChange={(e) => setFormData(prev => ({ ...prev, linkedin: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="experience">Relevant Experience *</Label>
              <Input
                id="experience"
                placeholder="e.g., 3 years in operations management"
                value={formData.experience}
                onChange={(e) => setFormData(prev => ({ ...prev, experience: e.target.value }))}
                required
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="message">Why do you want to join Novara? *</Label>
              <Textarea
                id="message"
                placeholder="Tell us about yourself and what excites you about this role..."
                rows={4}
                value={formData.message}
                onChange={(e) => setFormData(prev => ({ ...prev, message: e.target.value }))}
                required
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
