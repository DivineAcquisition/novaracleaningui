import { useSearchParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, Calendar, User, ArrowRight, Sparkles, Gift } from "lucide-react";
import { SEO } from "@/components/SEO";

const PLAN_NAMES: Record<string, string> = {
  monthly: "Glow Monthly",
  biweekly: "Glow Bi-Weekly",
  weekly: "Glow Weekly",
};

export default function MembershipSuccess() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const plan = searchParams.get("plan") || "monthly";
  const planName = PLAN_NAMES[plan] || "Novara Membership";

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <SEO title="Welcome to Novara!" description="Your membership is active. Schedule your first cleaning now." noindex />
      <Card className="max-w-lg w-full border-0 shadow-xl overflow-hidden animate-scale-in">
        <div className="h-1 w-full" style={{ background: 'var(--gradient-primary)' }} />
        <CardContent className="pt-10 pb-8 space-y-6 text-center">
          <div className="relative">
            <div className="mx-auto w-20 h-20 rounded-2xl flex items-center justify-center shadow-lg" style={{ background: 'var(--gradient-primary)' }}>
              <CheckCircle2 className="w-10 h-10 text-white" />
            </div>
            <div className="absolute -top-1 -right-1 left-0 right-0 mx-auto w-24 h-24 rounded-2xl animate-ping opacity-20" style={{ background: 'var(--gradient-primary)' }} />
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl md:text-3xl font-bold font-jakarta tracking-tight">Welcome to Novara!</h1>
            <p className="text-muted-foreground text-sm md:text-base">
              You're now a <span className="font-semibold text-foreground">{planName}</span> member.
              Your first cleaning credit is ready to use.
            </p>
          </div>

          <div className="rounded-xl bg-muted/50 p-4 space-y-2">
            <div className="flex items-center justify-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              <p className="font-medium text-sm">What's next?</p>
            </div>
            <p className="text-sm text-muted-foreground">Schedule your first cleaning and we'll handle the rest.</p>
          </div>

          <div className="space-y-3">
            <Button
              onClick={() => navigate("/portal/book")}
              className="w-full h-12 bg-gradient-primary shadow-lg rounded-xl"
            >
              <Calendar className="w-5 h-5 mr-2" />
              Schedule Your First Cleaning
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>

            <Button
              variant="outline"
              onClick={() => navigate("/account")}
              className="w-full rounded-xl"
            >
              <User className="w-4 h-4 mr-2" />
              Go to My Account
            </Button>
          </div>

          <p className="text-[11px] text-muted-foreground">
            A confirmation email has been sent to your inbox.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
