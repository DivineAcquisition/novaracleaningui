import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Sparkles, Clock, Shield, Star, User, LogOut } from "lucide-react";

const FEATURES = [
  {
    icon: Sparkles,
    title: "Professional Service",
    description: "Experienced cleaners you can trust",
  },
  {
    icon: Clock,
    title: "Flexible Scheduling",
    description: "Book at your convenience",
  },
  {
    icon: Shield,
    title: "Satisfaction Guaranteed",
    description: "100% happiness guarantee",
  },
  {
    icon: Star,
    title: "Top Rated",
    description: "4.9/5 from 10,000+ customers",
  },
];

const Index = () => {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  const handleSignOut = async () => {
    await signOut();
  };

  return (
    <div className="min-h-screen bg-gradient-hero">
      {/* Header */}
      <header className="container mx-auto px-4 py-6">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-gradient-primary rounded-full flex items-center justify-center shadow-lavender">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <span className="text-xl font-bold">HomeGlow</span>
          </div>
          
          {user ? (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => navigate("/account")}
              >
                <User className="mr-2 w-4 h-4" />
                Account
              </Button>
              <Button
                variant="ghost"
                onClick={handleSignOut}
              >
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              onClick={() => navigate("/auth")}
            >
              Sign In
            </Button>
          )}
        </div>
      </header>

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-20 text-center">
        <div className="max-w-4xl mx-auto space-y-8">
          <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight">
            Professional Home Cleaning
            <span className="block text-primary mt-2">Made Simple</span>
          </h1>
          
          <p className="text-xl md:text-2xl text-muted-foreground max-w-2xl mx-auto">
            Book trusted cleaners in minutes. Flexible scheduling, transparent pricing, and satisfaction guaranteed.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center pt-4">
            <Button
              size="lg"
              className="h-16 px-8 text-lg font-semibold shadow-xl hover:shadow-2xl transition-all"
              onClick={() => navigate("/book/zip")}
            >
              Book Your Cleaning
            </Button>
            <p className="text-sm text-muted-foreground">
              Starting at $129 • No commitments
            </p>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="container mx-auto px-4 py-16">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 max-w-6xl mx-auto">
          {FEATURES.map((feature, idx) => (
            <Card key={idx} className="border-none shadow-lg hover:shadow-xl transition-shadow">
              <CardContent className="pt-6 text-center space-y-3">
                <div className="mx-auto w-14 h-14 bg-primary/10 rounded-full flex items-center justify-center">
                  <feature.icon className="w-7 h-7 text-primary" />
                </div>
                <h3 className="text-xl font-bold">{feature.title}</h3>
                <p className="text-muted-foreground">{feature.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-4 py-20 text-center">
        <Card className="max-w-3xl mx-auto shadow-xl">
          <CardContent className="pt-12 pb-12 space-y-6">
            <h2 className="text-3xl md:text-4xl font-bold">
              Ready for a cleaner home?
            </h2>
            <p className="text-lg text-muted-foreground">
              Join thousands of happy customers. Book your first cleaning in just 2 minutes.
            </p>
            <Button
              size="lg"
              className="h-14 px-8 text-lg font-semibold"
              onClick={() => navigate("/book/zip")}
            >
              Get Started Now
            </Button>
          </CardContent>
        </Card>
      </section>
    </div>
  );
};

export default Index;
