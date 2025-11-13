import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkles, Smartphone, Zap, ArrowRight, Check } from "lucide-react";
import selestialLogo from "@/assets/selestial-logo.png";

export default function Demo() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      {/* Header */}
      <header className="border-b border-border/40 bg-background/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src={selestialLogo} alt="Selestial" className="h-10 w-auto" />
              <span className="text-xl font-semibold text-foreground">Selestial</span>
            </div>
            <nav className="hidden md:flex items-center gap-6">
              <a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Features
              </a>
              <a href="#demo" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Demo
              </a>
              <a href="#pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Pricing
              </a>
              <Button size="sm" className="ml-2">
                Get Started
              </Button>
            </nav>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-20 md:py-32">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
            <Sparkles className="w-4 h-4" />
            Custom Booking Interfaces for Cleaning Companies
          </div>
          
          <h1 className="text-4xl md:text-6xl font-bold text-foreground leading-tight">
            Get Your Booking Interface{" "}
            <span className="bg-gradient-to-r from-primary via-purple-500 to-blue-500 bg-clip-text text-transparent">
              Today
            </span>
          </h1>
          
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
            Custom-built booking experiences for cleaning companies. Launch in days, not months. 
            Increase conversions with mobile-first design and seamless user experience.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center pt-4">
            <Button size="lg" className="text-base px-8">
              Book a Demo
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
            <Button size="lg" variant="outline" className="text-base px-8">
              See Examples
            </Button>
          </div>

          {/* Hero Visual */}
          <div className="mt-16 relative">
            <div className="absolute inset-0 bg-gradient-to-r from-primary/20 to-blue-500/20 blur-3xl opacity-30 rounded-full" />
            <Card className="relative border-2 shadow-2xl overflow-hidden">
              <div className="bg-gradient-to-br from-primary/5 via-purple-500/5 to-blue-500/5 p-8 md:p-12">
                <div className="grid md:grid-cols-2 gap-8 items-center">
                  <div className="space-y-4">
                    <div className="inline-block px-3 py-1 bg-primary/10 rounded-md text-sm font-medium text-primary">
                      NovaraCleaning Example
                    </div>
                    <h3 className="text-2xl font-semibold text-foreground">
                      Booking flow that converts
                    </h3>
                    <p className="text-muted-foreground">
                      See how our custom interface helped NovaraCleaning increase bookings by 40%
                    </p>
                    <Button variant="outline">
                      Try Live Demo
                    </Button>
                  </div>
                  <div className="bg-background/80 backdrop-blur-sm rounded-lg p-6 border shadow-lg">
                    <div className="space-y-3 text-left">
                      <div className="flex items-center gap-2 text-sm">
                        <Check className="w-4 h-4 text-primary" />
                        <span className="text-foreground">Mobile-optimized checkout</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <Check className="w-4 h-4 text-primary" />
                        <span className="text-foreground">Stripe payment integration</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <Check className="w-4 h-4 text-primary" />
                        <span className="text-foreground">Automated confirmation emails</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <Check className="w-4 h-4 text-primary" />
                        <span className="text-foreground">Customer portal & scheduling</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="container mx-auto px-4 py-20 md:py-32">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
            Everything you need to start booking
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Built for modern cleaning businesses that want to grow faster
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {/* Feature 1 */}
          <Card className="border-2 hover:border-primary/50 transition-all duration-300 hover:shadow-lg">
            <CardHeader>
              <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center mb-4">
                <Sparkles className="w-6 h-6 text-primary-foreground" />
              </div>
              <CardTitle className="text-xl">Fully Customizable</CardTitle>
              <CardDescription className="text-base">
                Tailored to your brand with custom colors, logos, and messaging. 
                Every detail matches your company identity.
              </CardDescription>
            </CardHeader>
          </Card>

          {/* Feature 2 */}
          <Card className="border-2 hover:border-primary/50 transition-all duration-300 hover:shadow-lg">
            <CardHeader>
              <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center mb-4">
                <Smartphone className="w-6 h-6 text-white" />
              </div>
              <CardTitle className="text-xl">Mobile-First Design</CardTitle>
              <CardDescription className="text-base">
                Optimized booking flow for all devices with swipe gestures, 
                touch-friendly UI, and lightning-fast performance.
              </CardDescription>
            </CardHeader>
          </Card>

          {/* Feature 3 */}
          <Card className="border-2 hover:border-primary/50 transition-all duration-300 hover:shadow-lg">
            <CardHeader>
              <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-purple-500 to-primary flex items-center justify-center mb-4">
                <Zap className="w-6 h-6 text-primary-foreground" />
              </div>
              <CardTitle className="text-xl">Instant Deployment</CardTitle>
              <CardDescription className="text-base">
                Go live in days with our rapid deployment process. 
                Includes hosting, SSL, and ongoing technical support.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </section>

      {/* Demo Section */}
      <section id="demo" className="container mx-auto px-4 py-20 md:py-32 bg-gradient-to-br from-primary/5 to-blue-500/5 rounded-3xl">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
            See It In Action
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Try our NovaraCleaning demo to experience the complete booking journey
          </p>
        </div>

        <div className="max-w-4xl mx-auto">
          <Card className="border-2 shadow-2xl overflow-hidden">
            <CardContent className="p-0">
              <div className="bg-muted/30 p-8 md:p-16 text-center space-y-6">
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium">
                  Live Interactive Demo
                </div>
                <h3 className="text-2xl font-semibold text-foreground">
                  Experience the full booking flow
                </h3>
                <p className="text-muted-foreground max-w-xl mx-auto">
                  Click below to start a sample booking with NovaraCleaning and see 
                  how our interface guides customers from start to finish.
                </p>
                <Button size="lg" className="text-base px-8">
                  Launch Demo
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="container mx-auto px-4 py-20 md:py-32">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
            Simple, transparent pricing
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Get your custom booking interface without breaking the bank
          </p>
        </div>

        <div className="max-w-lg mx-auto">
          <Card className="border-2 border-primary/50 shadow-xl">
            <CardHeader className="text-center pb-8">
              <CardTitle className="text-2xl mb-2">Custom Booking Interface</CardTitle>
              <div className="space-y-2">
                <p className="text-4xl font-bold text-foreground">Contact for Pricing</p>
                <CardDescription className="text-base">
                  Tailored solutions for your business size
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pb-8">
              <div className="flex items-start gap-3">
                <Check className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                <span className="text-muted-foreground">Custom branding and design</span>
              </div>
              <div className="flex items-start gap-3">
                <Check className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                <span className="text-muted-foreground">Mobile-optimized booking flow</span>
              </div>
              <div className="flex items-start gap-3">
                <Check className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                <span className="text-muted-foreground">Stripe payment integration</span>
              </div>
              <div className="flex items-start gap-3">
                <Check className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                <span className="text-muted-foreground">Customer portal & scheduling</span>
              </div>
              <div className="flex items-start gap-3">
                <Check className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                <span className="text-muted-foreground">Email notifications & reminders</span>
              </div>
              <div className="flex items-start gap-3">
                <Check className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                <span className="text-muted-foreground">Hosting, SSL, and support included</span>
              </div>
              <Button className="w-full mt-6" size="lg">
                Contact Sales
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/40 bg-muted/30">
        <div className="container mx-auto px-4 py-12">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="flex items-center gap-3">
              <img src={selestialLogo} alt="Selestial" className="h-8 w-auto" />
              <span className="text-lg font-semibold text-foreground">Selestial</span>
            </div>
            <nav className="flex flex-wrap justify-center gap-6">
              <a href="#" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Privacy Policy
              </a>
              <a href="#" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Terms of Service
              </a>
              <a href="#" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Contact
              </a>
            </nav>
          </div>
          <div className="text-center mt-8 text-sm text-muted-foreground">
            © 2024 Selestial. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
