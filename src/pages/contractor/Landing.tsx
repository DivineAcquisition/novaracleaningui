import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DollarSign,
  Clock,
  Calendar,
  Shield,
  ArrowRight,
  UserPlus,
  LogIn,
  Zap,
  Star,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import logo from "@/assets/logo.png";

export default function ContractorLanding() {
  const navigate = useNavigate();

  const handleSignIn = () => {
    navigate("/cleaner/auth");
  };

  const handleJoinTeam = () => {
    navigate("/cleaner/onboarding-landing");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-white to-violet-50">
      {/* Header */}
      <header className="container max-w-6xl mx-auto px-4 py-6">
        <div className="flex items-center justify-center gap-3">
          <img src={logo} alt="Novara" className="w-10 h-10 rounded-xl shadow-md" />
          <div>
            <span className="text-2xl font-bold">NovaraCleaning</span>
            <Badge variant="outline" className="ml-2 text-xs">Contractor Portal</Badge>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container max-w-6xl mx-auto px-4 py-12 md:py-20">
        <div className="text-center space-y-6 mb-12">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <Badge className="bg-primary/10 text-primary border-primary/20 px-4 py-1.5 mb-4">
              <Sparkles className="w-3.5 h-3.5 mr-1.5" />
              Join Maryland's Premier Cleaning Team
            </Badge>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight"
          >
            Welcome,{" "}
            <span className="bg-gradient-to-r from-primary to-[#8F7BFD] bg-clip-text text-transparent">
              Cleaning Pro
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto"
          >
            Earn great money on your schedule. Get paid instantly after every job.
          </motion.p>
        </div>

        {/* Choice Cards */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto"
        >
          {/* New Contractor Card */}
          <Card className="relative overflow-hidden border-2 border-primary/20 hover:border-primary/50 transition-all hover:shadow-xl group cursor-pointer"
            onClick={handleJoinTeam}
          >
            <div className="absolute top-0 right-0">
              <Badge className="bg-primary text-white rounded-none rounded-bl-lg">
                <Star className="w-3 h-3 mr-1" />
                Now Hiring
              </Badge>
            </div>
            <CardContent className="p-8 pt-12">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-[#8F7BFD] flex items-center justify-center mb-6 shadow-lg group-hover:scale-110 transition-transform">
                <UserPlus className="w-8 h-8 text-white" />
              </div>
              
              <h2 className="text-2xl font-bold mb-2">I'm New Here</h2>
              <p className="text-muted-foreground mb-6">
                Join our team and start earning. Quick onboarding, instant payouts.
              </p>

              <div className="space-y-3 mb-6">
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="w-4 h-4 text-primary" />
                  <span>Earn $18-25/hour</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="w-4 h-4 text-primary" />
                  <span>Flexible schedule - you choose when to work</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="w-4 h-4 text-primary" />
                  <span>Get paid same-day via direct deposit</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="w-4 h-4 text-primary" />
                  <span>All cleaning supplies provided</span>
                </div>
              </div>

              <Button className="w-full h-12 bg-primary hover:bg-primary/90 text-lg group-hover:shadow-lg transition-all">
                Join the Team
                <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
            </CardContent>
          </Card>

          {/* Existing Contractor Card */}
          <Card className="relative overflow-hidden border-2 border-slate-200 hover:border-primary/50 transition-all hover:shadow-xl group cursor-pointer"
            onClick={handleSignIn}
          >
            <CardContent className="p-8 pt-12">
              <div className="w-16 h-16 rounded-2xl bg-slate-100 group-hover:bg-primary/10 flex items-center justify-center mb-6 shadow-sm group-hover:shadow-lg transition-all">
                <LogIn className="w-8 h-8 text-slate-600 group-hover:text-primary transition-colors" />
              </div>
              
              <h2 className="text-2xl font-bold mb-2">I Have an Account</h2>
              <p className="text-muted-foreground mb-6">
                Sign in to view your jobs, track earnings, and manage your schedule.
              </p>

              <div className="space-y-3 mb-6">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Calendar className="w-4 h-4" />
                  <span>View upcoming jobs</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <DollarSign className="w-4 h-4" />
                  <span>Track your earnings</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="w-4 h-4" />
                  <span>Manage availability</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Zap className="w-4 h-4" />
                  <span>Accept new job offers</span>
                </div>
              </div>

              <Button variant="outline" className="w-full h-12 text-lg border-2 hover:bg-primary hover:text-white hover:border-primary transition-all">
                Sign In
                <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
            </CardContent>
          </Card>
        </motion.div>

        {/* Benefits Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="mt-16"
        >
          <h3 className="text-center text-lg font-semibold text-muted-foreground mb-8">
            Why cleaners love working with Novara
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-4xl mx-auto">
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                <DollarSign className="w-6 h-6 text-primary" />
              </div>
              <div className="font-semibold">Instant Pay</div>
              <div className="text-sm text-muted-foreground">Same-day deposits</div>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                <Calendar className="w-6 h-6 text-primary" />
              </div>
              <div className="font-semibold">Flexible Hours</div>
              <div className="text-sm text-muted-foreground">Work when you want</div>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                <Shield className="w-6 h-6 text-primary" />
              </div>
              <div className="font-semibold">Insured</div>
              <div className="text-sm text-muted-foreground">Full coverage</div>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                <Star className="w-6 h-6 text-primary" />
              </div>
              <div className="font-semibold">Top Rated</div>
              <div className="text-sm text-muted-foreground">4.9/5 average</div>
            </div>
          </div>
        </motion.div>

        {/* Customer Booking Link */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="mt-16 text-center"
        >
          <p className="text-muted-foreground">
            Looking to book a cleaning instead?{" "}
            <a 
              href="https://book.novaracleaning.com" 
              className="text-primary hover:underline font-medium"
            >
              Book a cleaning →
            </a>
          </p>
        </motion.div>
      </main>

      {/* Footer */}
      <footer className="container max-w-6xl mx-auto px-4 py-8 border-t mt-12">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <img src={logo} alt="Novara" className="w-5 h-5 rounded" />
            <span>© {new Date().getFullYear()} NovaraCleaning</span>
          </div>
          <div className="flex items-center gap-6">
            <a href="https://novaracleaning.com/privacy" className="hover:text-foreground">Privacy</a>
            <a href="https://novaracleaning.com/terms" className="hover:text-foreground">Terms</a>
            <a href="mailto:contractors@novaracleaning.com" className="hover:text-foreground">Support</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
