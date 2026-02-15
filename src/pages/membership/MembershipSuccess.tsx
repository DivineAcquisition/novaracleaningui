import { useSearchParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, Calendar, User, ArrowRight } from "lucide-react";

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
    <div className="min-h-screen bg-gradient-hero flex items-center justify-center px-4">
      <Card className="max-w-lg w-full border-primary/20 shadow-xl">
        <CardContent className="pt-10 pb-8 space-y-6 text-center">
          <div className="mx-auto w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
            <CheckCircle2 className="w-10 h-10 text-primary" />
          </div>

          <div className="space-y-2">
            <h1 className="text-3xl font-bold font-jakarta">Welcome to Novara!</h1>
            <p className="text-muted-foreground">
              You're now a <span className="font-semibold text-foreground">{planName}</span> member.
              Your first cleaning credit is ready to use.
            </p>
          </div>

          <div className="bg-muted/50 rounded-xl p-4 space-y-1 text-sm">
            <p className="font-medium">What's next?</p>
            <p className="text-muted-foreground">Schedule your first cleaning and we'll handle the rest.</p>
          </div>

          <div className="space-y-3">
            <Button
              onClick={() => navigate("/portal/book")}
              className="w-full h-12 bg-gradient-primary shadow-lg"
            >
              <Calendar className="w-5 h-5 mr-2" />
              Schedule Your First Cleaning
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>

            <Button
              variant="outline"
              onClick={() => navigate("/account")}
              className="w-full"
            >
              <User className="w-4 h-4 mr-2" />
              Go to My Account
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            A confirmation email has been sent to your inbox.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
