import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { 
  Loader2, 
  LogOut, 
  ExternalLink, 
  CheckCircle2, 
  AlertCircle,
  DollarSign,
  User,
  CreditCard,
  Calendar,
  Car,
  Power,
  MapPin,
  Info
} from "lucide-react";
import { cn } from "@/lib/utils";

interface CleanerProfile {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  avatar_url: string | null;
  status: string;
  home_zip: string;
  max_travel_miles: number;
  preferred_work_days: string[];
  stripe_account_id: string | null;
  payouts_enabled: boolean;
  onboarding_complete: boolean;
}

const DAYS_OF_WEEK = [
  { id: "Mon", label: "M" },
  { id: "Tue", label: "T" },
  { id: "Wed", label: "W" },
  { id: "Thu", label: "T" },
  { id: "Fri", label: "F" },
  { id: "Sat", label: "S" },
  { id: "Sun", label: "S" },
];

const TRAVEL_OPTIONS = [10, 15, 20, 25, 30];

export default function CleanerDashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<CleanerProfile | null>(null);
  const [stripeLoading, setStripeLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  
  const [isActive, setIsActive] = useState(false);
  const [workDays, setWorkDays] = useState<string[]>([]);
  const [maxMiles, setMaxMiles] = useState(20);

  useEffect(() => {
    checkAuthAndLoadProfile();
  }, []);

  const checkAuthAndLoadProfile = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        navigate("/cleaner/auth");
        return;
      }

      const { data: cleaner, error } = await supabase
        .from("cleaners")
        .select("*")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (error) throw error;

      if (!cleaner || !cleaner.onboarding_complete) {
        navigate("/cleaner/onboarding");
        return;
      }

      setProfile(cleaner as CleanerProfile);
      setIsActive(cleaner.status === "active");
      setWorkDays(cleaner.preferred_work_days || []);
      setMaxMiles(cleaner.max_travel_miles || 20);
    } catch (error) {
      console.error("Error loading profile:", error);
      toast.error("Failed to load profile");
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/cleaner/auth");
  };

  const toggleDay = async (day: string) => {
    const newDays = workDays.includes(day)
      ? workDays.filter(d => d !== day)
      : [...workDays, day];
    
    setWorkDays(newDays);
    await saveSettings({ preferred_work_days: newDays });
  };

  const updateMiles = async (miles: number) => {
    setMaxMiles(miles);
    await saveSettings({ max_travel_miles: miles });
  };

  const toggleStatus = async () => {
    const newStatus = !isActive;
    setIsActive(newStatus);
    await saveSettings({ status: newStatus ? "active" : "inactive" });
  };

  const saveSettings = async (updates: Partial<CleanerProfile>) => {
    if (!profile) return;
    
    setSaving(true);
    try {
      const { error } = await supabase
        .from("cleaners")
        .update(updates)
        .eq("id", profile.id);

      if (error) throw error;
      toast.success("Saved");
    } catch (error) {
      console.error("Save error:", error);
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const openStripeConnect = async () => {
    if (!profile?.stripe_account_id) {
      setStripeLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke(
          "initiate-cleaner-stripe-connect"
        );

        if (error) throw error;
        if (data?.url) {
          window.location.href = data.url;
        }
      } catch (error: any) {
        toast.error("Failed to initiate Stripe setup");
      } finally {
        setStripeLoading(false);
      }
      return;
    }

    setStripeLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "create-stripe-login-link",
        { body: { stripe_account_id: profile.stripe_account_id } }
      );

      if (error) throw error;
      if (data?.url) {
        window.open(data.url, "_blank");
      } else {
        window.open("https://dashboard.stripe.com", "_blank");
      }
    } catch (error) {
      window.open("https://connect.stripe.com/express_login", "_blank");
    } finally {
      setStripeLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto border border-border">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!profile) return null;

  const stripeStatus = profile.payouts_enabled 
    ? "active" 
    : profile.stripe_account_id 
      ? "pending" 
      : "not_setup";

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur border-b border-border">
        <div className="max-w-sm mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {profile.avatar_url ? (
              <img 
                src={profile.avatar_url} 
                alt="Avatar" 
                className="w-9 h-9 rounded-full object-cover border border-border"
              />
            ) : (
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary to-purple-600 flex items-center justify-center">
                <User className="w-4 h-4 text-white" />
              </div>
            )}
            <div>
              <p className="font-semibold text-sm">{profile.first_name} {profile.last_name}</p>
              <div className="flex items-center gap-1.5">
                <Badge 
                  variant="secondary" 
                  className={cn(
                    "text-[10px] px-1.5 py-0 h-4 border",
                    isActive 
                      ? "bg-green-500/10 text-green-600 border-green-500/20" 
                      : "bg-muted text-muted-foreground border-border"
                  )}
                >
                  {isActive ? "Active" : "Inactive"}
                </Badge>
                {saving && <Loader2 className="w-2.5 h-2.5 animate-spin text-muted-foreground" />}
              </div>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={handleSignOut} className="h-8 w-8 border border-border">
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-sm mx-auto px-4 py-4 space-y-3">
        
        {/* Status Toggle */}
        <Card className="border border-border shadow-sm overflow-hidden">
          <div className={cn(
            "h-1 transition-colors",
            isActive ? "bg-gradient-to-r from-green-500 to-emerald-500" : "bg-muted"
          )} />
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={cn(
                  "w-10 h-10 rounded-lg flex items-center justify-center border",
                  isActive ? "bg-green-500/10 border-green-500/20" : "bg-muted border-border"
                )}>
                  <Power className={cn("w-5 h-5", isActive ? "text-green-600" : "text-muted-foreground")} />
                </div>
                <div>
                  <h3 className="font-semibold text-sm">Availability</h3>
                  <p className="text-xs text-muted-foreground">
                    {isActive ? "Receiving jobs" : "Not receiving jobs"}
                  </p>
                </div>
              </div>
              <Switch checked={isActive} onCheckedChange={toggleStatus} />
            </div>
          </CardContent>
        </Card>

        {/* Work Days */}
        <Card className="border border-border shadow-sm">
          <CardHeader className="pb-2 px-4 pt-4">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-primary" />
              Work Days
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            <div className="flex gap-1.5">
              {DAYS_OF_WEEK.map((day) => (
                <button
                  key={day.id}
                  onClick={() => toggleDay(day.id)}
                  className={cn(
                    "flex-1 py-2.5 rounded-lg font-semibold text-xs transition-all border",
                    workDays.includes(day.id)
                      ? "bg-primary text-white border-primary"
                      : "bg-muted text-muted-foreground border-border hover:border-primary/50"
                  )}
                >
                  {day.label}
                </button>
              ))}
            </div>
            {workDays.length > 0 && (
              <p className="text-[10px] text-muted-foreground mt-2">
                {workDays.join(", ")}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Travel Distance */}
        <Card className="border border-border shadow-sm">
          <CardHeader className="pb-2 px-4 pt-4">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Car className="w-4 h-4 text-primary" />
              Travel Distance
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            <div className="flex gap-1.5">
              {TRAVEL_OPTIONS.map((miles) => (
                <button
                  key={miles}
                  onClick={() => updateMiles(miles)}
                  className={cn(
                    "flex-1 py-2.5 rounded-lg font-semibold text-xs transition-all border",
                    maxMiles === miles
                      ? "bg-primary text-white border-primary"
                      : "bg-muted text-muted-foreground border-border hover:border-primary/50"
                  )}
                >
                  {miles}mi
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5 mt-2 text-[10px] text-muted-foreground">
              <MapPin className="w-2.5 h-2.5" />
              From ZIP: {profile.home_zip}
            </div>
          </CardContent>
        </Card>

        {/* Stripe Connect */}
        <Card className="border border-indigo-500/20 shadow-sm bg-gradient-to-br from-indigo-500/5 to-purple-500/5">
          <CardHeader className="pb-2 px-4 pt-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <CreditCard className="w-4 h-4 text-indigo-600" />
                Earnings
              </CardTitle>
              {stripeStatus === "active" && (
                <Badge className="bg-green-500/10 text-green-600 border border-green-500/20 text-[10px] px-1.5 py-0 h-4">
                  <CheckCircle2 className="w-2.5 h-2.5 mr-0.5" />
                  Connected
                </Badge>
              )}
              {stripeStatus === "pending" && (
                <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 border border-amber-500/20 text-[10px] px-1.5 py-0 h-4">
                  <AlertCircle className="w-2.5 h-2.5 mr-0.5" />
                  Pending
                </Badge>
              )}
            </div>
            <CardDescription className="text-xs">
              {stripeStatus === "active" 
                ? "View earnings, payouts & tax docs"
                : stripeStatus === "pending"
                  ? "Complete setup to receive payouts"
                  : "Connect Stripe to get paid"
              }
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            <Button 
              onClick={openStripeConnect}
              disabled={stripeLoading}
              className={cn(
                "w-full h-11 text-sm font-semibold border",
                stripeStatus === "active" 
                  ? "bg-gradient-to-r from-indigo-600 to-purple-600 border-indigo-500/20 text-white" 
                  : "border-border"
              )}
              variant={stripeStatus === "active" ? "default" : "outline"}
            >
              {stripeLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Loading...
                </>
              ) : stripeStatus === "active" ? (
                <>
                  <DollarSign className="w-4 h-4 mr-1.5" />
                  Open Stripe Dashboard
                  <ExternalLink className="w-3 h-3 ml-1.5" />
                </>
              ) : (
                <>
                  {stripeStatus === "pending" ? "Complete Setup" : "Set Up Payments"}
                </>
              )}
            </Button>

            {stripeStatus === "active" && (
              <div className="mt-3 p-3 bg-card rounded-lg border border-border">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase">Pay Rate</p>
                    <p className="text-lg font-bold text-green-600">$18/hr</p>
                  </div>
                  <div className="w-9 h-9 rounded-lg bg-green-500/10 flex items-center justify-center border border-green-500/20">
                    <DollarSign className="w-4 h-4 text-green-600" />
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Weekly payouts via Stripe
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Info Card */}
        <Card className="border border-border shadow-sm bg-muted/30">
          <CardContent className="p-3">
            <div className="flex items-start gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center border border-primary/20 flex-shrink-0">
                <Info className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="font-semibold text-xs mb-1">How It Works</p>
                <ol className="text-[10px] text-muted-foreground space-y-0.5 list-decimal list-inside">
                  <li>Receive job offers via email & SMS</li>
                  <li>Accept or decline based on schedule</li>
                  <li>Complete jobs and get paid weekly</li>
                </ol>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Support */}
        <p className="text-[10px] text-center text-muted-foreground pb-2">
          Need help? support@novaracleaning.com
        </p>
      </main>
    </div>
  );
}
