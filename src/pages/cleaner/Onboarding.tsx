import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { 
  Loader2, 
  MapPin, 
  CheckCircle2, 
  ArrowLeft, 
  ArrowRight,
  User,
  Phone,
  Mail,
  Camera,
  Calendar,
  Sparkles,
  Car,
  Star
} from "lucide-react";
import { validatePhone, validateName } from "@/lib/form-validation";
import { processAvatarImage } from "@/lib/image-compression";
import { cn } from "@/lib/utils";

const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"
];

const DAYS_OF_WEEK = [
  { id: "Mon", label: "Mon", full: "Monday" },
  { id: "Tue", label: "Tue", full: "Tuesday" },
  { id: "Wed", label: "Wed", full: "Wednesday" },
  { id: "Thu", label: "Thu", full: "Thursday" },
  { id: "Fri", label: "Fri", full: "Friday" },
  { id: "Sat", label: "Sat", full: "Saturday" },
  { id: "Sun", label: "Sun", full: "Sunday" },
];

const SKILLSET_OPTIONS = [
  { id: "Standard Cleaning", icon: "🏠", desc: "Regular home cleaning" },
  { id: "Deep Cleaning", icon: "✨", desc: "Intensive deep cleans" },
  { id: "Move-In/Move-Out", icon: "📦", desc: "Turnover cleaning" },
  { id: "Vacation Rental", icon: "🏖️", desc: "Airbnb & rentals" },
  { id: "Pet-Friendly", icon: "🐾", desc: "Pet hair & odors" },
  { id: "Eco-Friendly", icon: "🌿", desc: "Green products" },
];

const TRAVEL_OPTIONS = [
  { value: 10, label: "10 mi", desc: "Local area" },
  { value: 15, label: "15 mi", desc: "Nearby" },
  { value: 20, label: "20 mi", desc: "Standard" },
  { value: 25, label: "25 mi", desc: "Extended" },
  { value: 30, label: "30 mi", desc: "Far reach" },
];

export default function CleanerOnboarding() {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string>("");
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    state: "",
    homeZip: "",
    maxTravelMiles: 20,
    preferredWorkDays: [] as string[],
    skillset: [] as string[],
    avatarFile: null as File | null
  });
  const [avatarPreview, setAvatarPreview] = useState<string>("");

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        toast.error("Please sign in to continue");
        navigate("/cleaner/auth");
        return;
      }
      
      setUserId(session.user.id);
      setUserEmail(session.user.email || "");
      
      const { data: existingCleaner } = await supabase
        .from("cleaners")
        .select("id, onboarding_complete")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (existingCleaner?.onboarding_complete) {
        navigate("/cleaner/dashboard");
        return;
      }

      setCheckingAuth(false);
    } catch (error) {
      console.error("Auth check error:", error);
      navigate("/cleaner/auth");
    }
  };

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsLoading(true);
      const { file: compressedFile, preview } = await processAvatarImage(file);
      setFormData(prev => ({ ...prev, avatarFile: compressedFile }));
      setAvatarPreview(preview);
      toast.success("Photo ready!");
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleDay = (day: string) => {
    setFormData(prev => ({
      ...prev,
      preferredWorkDays: prev.preferredWorkDays.includes(day)
        ? prev.preferredWorkDays.filter(d => d !== day)
        : [...prev.preferredWorkDays, day]
    }));
  };

  const toggleSkill = (skill: string) => {
    setFormData(prev => ({
      ...prev,
      skillset: prev.skillset.includes(skill)
        ? prev.skillset.filter(s => s !== skill)
        : [...prev.skillset, skill]
    }));
  };

  const validateStep = () => {
    switch (currentStep) {
      case 1:
        if (!validateName(formData.firstName, "First name").isValid) {
          toast.error("Please enter a valid first name");
          return false;
        }
        if (!validateName(formData.lastName, "Last name").isValid) {
          toast.error("Please enter a valid last name");
          return false;
        }
        if (!validatePhone(formData.phone).isValid) {
          toast.error("Please enter a valid phone number");
          return false;
        }
        return true;

      case 2:
        if (!formData.state) {
          toast.error("Please select your state");
          return false;
        }
        if (!formData.homeZip || formData.homeZip.length !== 5) {
          toast.error("Please enter a valid ZIP code");
          return false;
        }
        return true;

      case 3:
        if (formData.preferredWorkDays.length === 0) {
          toast.error("Please select at least one work day");
          return false;
        }
        if (formData.skillset.length === 0) {
          toast.error("Please select at least one skill");
          return false;
        }
        return true;

      default:
        return true;
    }
  };

  const handleNext = () => {
    if (validateStep()) {
      setCurrentStep(prev => Math.min(prev + 1, 4));
    }
  };

  const handleBack = () => {
    setCurrentStep(prev => Math.max(prev - 1, 1));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateStep() || !userId) return;

    setIsLoading(true);

    try {
      let avatarUrl = null;
      if (formData.avatarFile) {
        const fileExt = formData.avatarFile.name.split('.').pop();
        const storagePath = `${userId}/${Date.now()}.${fileExt}`;
        
        const { error: uploadError } = await supabase.storage
          .from('cleaner-avatars')
          .upload(storagePath, formData.avatarFile);

        if (!uploadError) {
          const { data: { publicUrl } } = supabase.storage
            .from('cleaner-avatars')
            .getPublicUrl(storagePath);
          avatarUrl = publicUrl;
        }
      }

      const { error: insertError } = await supabase
        .from("cleaners")
        .insert({
          user_id: userId,
          first_name: formData.firstName,
          last_name: formData.lastName,
          phone: formData.phone,
          email: userEmail,
          state: formData.state,
          home_zip: formData.homeZip,
          max_travel_miles: formData.maxTravelMiles,
          preferred_work_days: formData.preferredWorkDays,
          avatar_url: avatarUrl,
          skillset: formData.skillset,
          pay_rate_hr: 18.00,
          status: "active",
          approved: true,
          onboarding_complete: true,
          activated_at: new Date().toISOString(),
        });

      if (insertError) {
        if (insertError.code === '23505') {
          toast.info("Profile already exists. Redirecting...");
          navigate("/cleaner/dashboard");
          return;
        }
        throw insertError;
      }

      toast.success("Profile created! Setting up payments...");
      
      const { data: stripeData, error: stripeError } = await supabase.functions.invoke(
        "initiate-cleaner-stripe-connect"
      );

      if (stripeError || !stripeData?.url) {
        toast.info("Profile saved! You can set up payments later.");
        navigate("/cleaner/dashboard");
        return;
      }

      window.location.href = stripeData.url;

    } catch (error: any) {
      console.error("Onboarding error:", error);
      toast.error(error.message || "Failed to complete onboarding");
    } finally {
      setIsLoading(false);
    }
  };

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/10 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="relative">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          </div>
          <p className="text-muted-foreground font-medium">Verifying session...</p>
        </div>
      </div>
    );
  }

  const progress = (currentStep / 4) * 100;

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/10 py-6 px-4">
      <div className="max-w-md mx-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-purple-600 shadow-xl mb-4">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold">Complete Your Profile</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Step {currentStep} of 4
          </p>
        </div>

        {/* Progress Bar */}
        <div className="mb-6">
          <Progress value={progress} className="h-2 bg-muted" />
          <div className="flex justify-between mt-2">
            {['Profile', 'Location', 'Schedule', 'Review'].map((label, index) => (
              <span 
                key={label}
                className={cn(
                  "text-xs font-medium transition-colors",
                  currentStep > index + 1 ? "text-green-600" : 
                  currentStep === index + 1 ? "text-primary" : "text-muted-foreground"
                )}
              >
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* Form Card */}
        <Card className="border-0 shadow-2xl overflow-hidden">
          <CardContent className="p-6">
            <form onSubmit={handleSubmit}>
              {/* Step 1: Personal Info */}
              {currentStep === 1 && (
                <div className="space-y-6">
                  <div className="text-center">
                    <h2 className="text-lg font-semibold">Personal Information</h2>
                    <p className="text-sm text-muted-foreground">Let's start with the basics</p>
                  </div>

                  {/* Avatar Upload */}
                  <div className="flex flex-col items-center">
                    <div className="relative group">
                      <div className={cn(
                        "w-28 h-28 rounded-full border-4 flex items-center justify-center overflow-hidden transition-all",
                        avatarPreview 
                          ? "border-primary shadow-lg" 
                          : "border-dashed border-muted-foreground/30 hover:border-primary/50"
                      )}>
                        {avatarPreview ? (
                          <img src={avatarPreview} alt="Preview" className="w-full h-full object-cover" />
                        ) : (
                          <div className="text-center">
                            <Camera className="w-8 h-8 text-muted-foreground/40 mx-auto" />
                            <span className="text-xs text-muted-foreground/60 mt-1">Add Photo</span>
                          </div>
                        )}
                      </div>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleImageChange}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                      <div className="absolute -bottom-1 -right-1 w-9 h-9 bg-primary rounded-full flex items-center justify-center shadow-lg border-2 border-background">
                        <Camera className="w-4 h-4 text-white" />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">Optional - helps build trust</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">First Name</Label>
                      <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          value={formData.firstName}
                          onChange={(e) => setFormData(prev => ({ ...prev, firstName: e.target.value }))}
                          className="pl-10 h-12 rounded-xl"
                          placeholder="John"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Last Name</Label>
                      <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          value={formData.lastName}
                          onChange={(e) => setFormData(prev => ({ ...prev, lastName: e.target.value }))}
                          className="pl-10 h-12 rounded-xl"
                          placeholder="Doe"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        value={userEmail}
                        disabled
                        className="pl-10 h-12 rounded-xl bg-muted/50"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3 text-green-500" />
                      Verified
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Phone Number</Label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        type="tel"
                        value={formData.phone}
                        onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                        className="pl-10 h-12 rounded-xl"
                        placeholder="(555) 123-4567"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Location */}
              {currentStep === 2 && (
                <div className="space-y-6">
                  <div className="text-center">
                    <h2 className="text-lg font-semibold">Your Location</h2>
                    <p className="text-sm text-muted-foreground">Where will you be working from?</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">State</Label>
                      <select
                        value={formData.state}
                        onChange={(e) => setFormData(prev => ({ ...prev, state: e.target.value }))}
                        className="w-full h-12 rounded-xl border border-input bg-background px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      >
                        <option value="">Select state</option>
                        {US_STATES.map(state => (
                          <option key={state} value={state}>{state}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">ZIP Code</Label>
                      <div className="relative">
                        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          value={formData.homeZip}
                          onChange={(e) => setFormData(prev => ({ ...prev, homeZip: e.target.value }))}
                          maxLength={5}
                          className="pl-10 h-12 rounded-xl"
                          placeholder="12345"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <Car className="w-4 h-4" />
                      How far will you travel?
                    </Label>
                    <div className="grid grid-cols-5 gap-2">
                      {TRAVEL_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setFormData(prev => ({ ...prev, maxTravelMiles: option.value }))}
                          className={cn(
                            "p-3 rounded-xl border-2 text-center transition-all",
                            formData.maxTravelMiles === option.value
                              ? "border-primary bg-primary/5 shadow-sm"
                              : "border-border hover:border-primary/50"
                          )}
                        >
                          <p className="font-bold text-sm">{option.label}</p>
                          <p className="text-[10px] text-muted-foreground">{option.desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Pay Rate Preview */}
                  <div className="bg-gradient-to-r from-green-500/10 to-emerald-500/10 rounded-2xl p-5 border border-green-500/20">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center">
                        <Star className="w-6 h-6 text-green-600" />
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Starting Pay Rate</p>
                        <p className="text-3xl font-bold text-green-600">$18<span className="text-lg">/hr</span></p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 3: Availability & Skills */}
              {currentStep === 3 && (
                <div className="space-y-6">
                  <div className="text-center">
                    <h2 className="text-lg font-semibold">Availability & Skills</h2>
                    <p className="text-sm text-muted-foreground">Set your schedule and expertise</p>
                  </div>

                  <div className="space-y-3">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <Calendar className="w-4 h-4" />
                      Available Days
                    </Label>
                    <div className="grid grid-cols-7 gap-2">
                      {DAYS_OF_WEEK.map((day) => (
                        <button
                          key={day.id}
                          type="button"
                          onClick={() => toggleDay(day.id)}
                          className={cn(
                            "aspect-square rounded-xl font-semibold text-sm transition-all flex flex-col items-center justify-center",
                            formData.preferredWorkDays.includes(day.id)
                              ? "bg-primary text-white shadow-lg"
                              : "bg-muted text-muted-foreground hover:bg-muted/80"
                          )}
                        >
                          <span>{day.label.charAt(0)}</span>
                        </button>
                      ))}
                    </div>
                    {formData.preferredWorkDays.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Selected: {formData.preferredWorkDays.join(", ")}
                      </p>
                    )}
                  </div>

                  <div className="space-y-3">
                    <Label className="text-sm font-medium">Your Cleaning Skills</Label>
                    <div className="grid grid-cols-2 gap-3">
                      {SKILLSET_OPTIONS.map((skill) => (
                        <button
                          key={skill.id}
                          type="button"
                          onClick={() => toggleSkill(skill.id)}
                          className={cn(
                            "p-4 rounded-xl border-2 text-left transition-all",
                            formData.skillset.includes(skill.id)
                              ? "border-primary bg-primary/5 shadow-sm"
                              : "border-border hover:border-primary/50 bg-card"
                          )}
                        >
                          <div className="flex items-start gap-3">
                            <span className="text-2xl">{skill.icon}</span>
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{skill.id}</p>
                              <p className="text-xs text-muted-foreground">{skill.desc}</p>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Step 4: Review */}
              {currentStep === 4 && (
                <div className="space-y-6">
                  <div className="text-center">
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center mx-auto mb-3 shadow-lg">
                      <CheckCircle2 className="w-8 h-8 text-white" />
                    </div>
                    <h2 className="text-lg font-semibold">Review Your Profile</h2>
                    <p className="text-sm text-muted-foreground">You're almost there!</p>
                  </div>

                  <div className="bg-muted/30 rounded-2xl p-5 space-y-4">
                    {/* Profile Header */}
                    <div className="flex items-center gap-4">
                      {avatarPreview ? (
                        <img src={avatarPreview} className="w-16 h-16 rounded-full object-cover ring-2 ring-primary/20" />
                      ) : (
                        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                          <User className="w-8 h-8 text-primary/50" />
                        </div>
                      )}
                      <div>
                        <p className="text-lg font-semibold">{formData.firstName} {formData.lastName}</p>
                        <p className="text-sm text-muted-foreground">{userEmail}</p>
                      </div>
                    </div>

                    <div className="h-px bg-border" />

                    {/* Details Grid */}
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Phone</p>
                        <p className="font-medium">{formData.phone}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Location</p>
                        <p className="font-medium">{formData.homeZip}, {formData.state}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Travel Range</p>
                        <p className="font-medium">{formData.maxTravelMiles} miles</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Pay Rate</p>
                        <p className="font-medium text-green-600">$18/hour</p>
                      </div>
                    </div>

                    <div className="h-px bg-border" />

                    {/* Days */}
                    <div>
                      <p className="text-muted-foreground text-xs uppercase tracking-wide mb-2">Available Days</p>
                      <div className="flex gap-1 flex-wrap">
                        {formData.preferredWorkDays.map(day => (
                          <Badge key={day} variant="secondary" className="text-xs px-3">{day}</Badge>
                        ))}
                      </div>
                    </div>

                    {/* Skills */}
                    <div>
                      <p className="text-muted-foreground text-xs uppercase tracking-wide mb-2">Skills</p>
                      <div className="flex gap-1 flex-wrap">
                        {formData.skillset.map(skill => (
                          <Badge key={skill} className="text-xs px-3 bg-primary/10 text-primary border-0">
                            {skill}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Stripe Info */}
                  <div className="bg-blue-500/10 rounded-xl p-4 border border-blue-500/20">
                    <p className="text-sm text-blue-700 dark:text-blue-300">
                      <span className="font-semibold">Next step:</span> Set up your Stripe account to receive weekly payouts directly to your bank.
                    </p>
                  </div>
                </div>
              )}

              {/* Navigation */}
              <div className="flex gap-3 mt-8">
                {currentStep > 1 && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleBack}
                    className="flex-1 h-12 rounded-xl"
                    disabled={isLoading}
                  >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back
                  </Button>
                )}

                {currentStep < 4 ? (
                  <Button
                    type="button"
                    onClick={handleNext}
                    className="flex-1 h-12 rounded-xl"
                    disabled={isLoading}
                  >
                    Continue
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    className="flex-1 h-12 rounded-xl bg-gradient-to-r from-primary to-purple-600 hover:opacity-90"
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Creating Profile...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                        Complete & Set Up Payments
                      </>
                    )}
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground mt-6">
          By continuing, you agree to our Terms of Service
        </p>
      </div>
    </div>
  );
}
