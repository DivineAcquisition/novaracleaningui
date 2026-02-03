import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
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
  Settings,
  Sparkles,
  MapPin
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
  { id: "Mon", label: "Mon" },
  { id: "Tue", label: "Tue" },
  { id: "Wed", label: "Wed" },
  { id: "Thu", label: "Thu" },
  { id: "Fri", label: "Fri" },
  { id: "Sat", label: "Sat" },
  { id: "Sun", label: "Sun" },
];

const TRAVEL_OPTIONS = [10, 15, 20, 25, 30];

export default function CleanerDashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<CleanerProfile | null>(null);
  const [stripeLoading, setStripeLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  
  // Editable settings
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
      toast.success("Settings saved");
    } catch (error) {
      console.error("Save error:", error);
      toast.error("Failed to save settings");
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
        console.error(error);
      } finally {
        setStripeLoading(false);
      }
      return;
    }

    setStripeLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "create-stripe-login-link",
        {
          body: { stripe_account_id: profile.stripe_account_id }
        }
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
      <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/10 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
          <p className="text-muted-foreground font-medium">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (!profile) {
    return null;
  }

  const stripeStatus = profile.payouts_enabled 
    ? "active" 
    : profile.stripe_account_id 
      ? "pending" 
      : "not_setup";

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/10">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b">
        <div className="max-w-lg mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {profile.avatar_url ? (
              <img 
                src={profile.avatar_url} 
                alt="Avatar" 
                className="w-11 h-11 rounded-full object-cover ring-2 ring-primary/20"
              />
            ) : (
              <div className="w-11 h-11 rounded-full bg-gradient-to-br from-primary to-purple-600 flex items-center justify-center">
                <User className="w-5 h-5 text-white" />
              </div>
            )}
            <div>
              <p className="font-semibold">{profile.first_name} {profile.last_name}</p>
              <div className="flex items-center gap-2">
                <Badge 
                  variant="secondary" 
                  className={cn(
                    "text-xs",
                    isActive ? "bg-green-500/10 text-green-600" : "bg-gray-500/10 text-gray-600"
                  )}
                >
                  {isActive ? "Active" : "Inactive"}
                </Badge>
                {saving && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
              </div>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={handleSignOut}>
            <LogOut className="w-5 h-5" />
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-lg mx-auto px-4 py-6 space-y-5">
        
        {/* Status Toggle */}
        <Card className="border-0 shadow-xl overflow-hidden">
          <div className={cn(
            "h-1.5 transition-colors",
            isActive ? "bg-gradient-to-r from-green-500 to-emerald-500" : "bg-gray-300"
          )} />
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={cn(
                  "w-12 h-12 rounded-xl flex items-center justify-center transition-colors",
                  isActive ? "bg-green-500/10" : "bg-muted"
                )}>
                  <Power className={cn(
                    "w-6 h-6",
                    isActive ? "text-green-600" : "text-muted-foreground"
                  )} />
                </div>
                <div>
                  <h3 className="font-semibold">Availability Status</h3>
                  <p className="text-sm text-muted-foreground">
                    {isActive ? "You're receiving job offers" : "You won't receive job offers"}
                  </p>
                </div>
              </div>
              <Switch
                checked={isActive}
                onCheckedChange={toggleStatus}
                className="scale-110"
              />
            </div>
          </CardContent>
        </Card>

        {/* Work Days */}
        <Card className="border-0 shadow-xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="w-5 h-5 text-primary" />
              Work Days
            </CardTitle>
            <CardDescription>
              Select the days you're available to work
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex gap-2">
              {DAYS_OF_WEEK.map((day) => (
                <button
                  key={day.id}
                  onClick={() => toggleDay(day.id)}
                  className={cn(
                    "flex-1 py-3 rounded-xl font-medium text-sm transition-all",
                    workDays.includes(day.id)
                      ? "bg-primary text-white shadow-md"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  )}
                >
                  {day.label.charAt(0)}
                </button>
              ))}
            </div>
            {workDays.length > 0 && (
              <p className="text-xs text-muted-foreground mt-3">
                Working: {workDays.join(", ")}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Travel Distance */}
        <Card className="border-0 shadow-xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Car className="w-5 h-5 text-primary" />
              Travel Distance
            </CardTitle>
            <CardDescription>
              Maximum miles you'll travel for jobs
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex gap-2">
              {TRAVEL_OPTIONS.map((miles) => (
                <button
                  key={miles}
                  onClick={() => updateMiles(miles)}
                  className={cn(
                    "flex-1 py-3 rounded-xl font-medium text-sm transition-all",
                    maxMiles === miles
                      ? "bg-primary text-white shadow-md"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  )}
                >
                  {miles}mi
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
              <MapPin className="w-3 h-3" />
              Based on ZIP: {profile.home_zip}
            </div>
          </CardContent>
        </Card>

        {/* Stripe Connect - Prominent */}
        <Card className="border-0 shadow-xl bg-gradient-to-br from-indigo-500/5 to-purple-500/5 border-indigo-500/10">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-indigo-600" />
                Earnings & Payouts
              </CardTitle>
              {stripeStatus === "active" && (
                <Badge className="bg-green-500/10 text-green-600 border-0">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Connected
                </Badge>
              )}
              {stripeStatus === "pending" && (
                <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 border-0">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  Pending
                </Badge>
              )}
            </div>
            <CardDescription>
              {stripeStatus === "active" 
                ? "View earnings, payouts, tax documents, and bank info"
                : stripeStatus === "pending"
                  ? "Complete setup to start receiving payouts"
                  : "Connect Stripe to receive your earnings"
              }
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            <Button 
              onClick={openStripeConnect}
              disabled={stripeLoading}
              className={cn(
                "w-full h-14 text-base font-semibold rounded-xl transition-all",
                stripeStatus === "active" 
                  ? "bg-gradient-to-r from-indigo-600 to-purple-600 hover:opacity-90" 
                  : ""
              )}
              variant={stripeStatus === "active" ? "default" : "outline"}
            >
              {stripeLoading ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Loading...
                </>
              ) : stripeStatus === "active" ? (
                <>
                  <DollarSign className="w-5 h-5 mr-2" />
                  Open Stripe Dashboard
                  <ExternalLink className="w-4 h-4 ml-2" />
                </>
              ) : (
                <>
                  <Settings className="w-5 h-5 mr-2" />
                  {stripeStatus === "pending" ? "Complete Setup" : "Set Up Payments"}
                </>
              )}
            </Button>

            {stripeStatus === "active" && (
              <div className="mt-4 p-4 bg-card rounded-xl border">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Your Pay Rate</p>
                    <p className="text-2xl font-bold text-green-600">$18/hr</p>
                  </div>
                  <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
                    <Sparkles className="w-6 h-6 text-green-600" />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Payouts are processed weekly via Stripe
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Info */}
        <Card className="border-0 shadow-lg bg-muted/30">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <AlertCircle className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="font-medium text-sm mb-1">How It Works</p>
                <ul className="text-xs text-muted-foreground space-y-1">
                  <li>1. You'll receive job offers via email & SMS</li>
                  <li>2. Accept or decline based on your availability</li>
                  <li>3. Complete the job and get paid weekly</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Support Footer */}
        <p className="text-xs text-center text-muted-foreground pb-4">
          Need help? Contact support@novaracleaning.com
        </p>
      </main>
    </div>
  );
}
