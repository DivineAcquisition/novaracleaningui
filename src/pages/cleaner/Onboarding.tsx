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
  Car
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
  { id: "Mon", label: "M" },
  { id: "Tue", label: "T" },
  { id: "Wed", label: "W" },
  { id: "Thu", label: "T" },
  { id: "Fri", label: "F" },
  { id: "Sat", label: "S" },
  { id: "Sun", label: "S" },
];

const SKILLSET_OPTIONS = [
  { id: "Standard Cleaning", icon: "🏠", desc: "Regular cleans" },
  { id: "Deep Cleaning", icon: "✨", desc: "Intensive" },
  { id: "Move-In/Move-Out", icon: "📦", desc: "Turnover" },
  { id: "Vacation Rental", icon: "🏖️", desc: "Airbnb" },
  { id: "Pet-Friendly", icon: "🐾", desc: "Pet homes" },
  { id: "Eco-Friendly", icon: "🌿", desc: "Green" },
];

const TRAVEL_OPTIONS = [
  { value: 10, label: "10mi" },
  { value: 15, label: "15mi" },
  { value: 20, label: "20mi" },
  { value: 25, label: "25mi" },
  { value: 30, label: "30mi" },
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
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto border border-border">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
          <p className="text-sm text-muted-foreground">Verifying session...</p>
        </div>
      </div>
    );
  }

  const progress = (currentStep / 4) * 100;

  return (
    <div className="min-h-screen bg-background py-4 px-4">
      <div className="max-w-sm mx-auto">
        {/* Header */}
        <div className="text-center mb-4">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-purple-600 shadow-md mb-3">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-xl font-bold">Complete Your Profile</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Step {currentStep} of 4</p>
        </div>

        {/* Progress Bar */}
        <div className="mb-4">
          <Progress value={progress} className="h-1.5 bg-muted" />
          <div className="flex justify-between mt-1.5">
            {['Profile', 'Location', 'Schedule', 'Review'].map((label, index) => (
              <span 
                key={label}
                className={cn(
                  "text-[10px] font-medium",
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
        <Card className="border border-border shadow-md">
          <CardContent className="p-4">
            <form onSubmit={handleSubmit}>
              {/* Step 1: Personal Info */}
              {currentStep === 1 && (
                <div className="space-y-4">
                  <div className="text-center mb-4">
                    <h2 className="text-base font-semibold">Personal Info</h2>
                    <p className="text-xs text-muted-foreground">Basic details</p>
                  </div>

                  {/* Avatar Upload */}
                  <div className="flex flex-col items-center">
                    <div className="relative">
                      <div className={cn(
                        "w-20 h-20 rounded-full border-2 flex items-center justify-center overflow-hidden",
                        avatarPreview ? "border-primary" : "border-dashed border-border"
                      )}>
                        {avatarPreview ? (
                          <img src={avatarPreview} alt="Preview" className="w-full h-full object-cover" />
                        ) : (
                          <Camera className="w-6 h-6 text-muted-foreground/40" />
                        )}
                      </div>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleImageChange}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                      <div className="absolute -bottom-0.5 -right-0.5 w-7 h-7 bg-primary rounded-full flex items-center justify-center border-2 border-background">
                        <Camera className="w-3 h-3 text-white" />
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1.5">Optional photo</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs font-medium">First Name</Label>
                      <div className="relative">
                        <User className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                        <Input
                          value={formData.firstName}
                          onChange={(e) => setFormData(prev => ({ ...prev, firstName: e.target.value }))}
                          className="pl-8 h-10 text-sm border border-border rounded-lg"
                          placeholder="John"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs font-medium">Last Name</Label>
                      <div className="relative">
                        <User className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                        <Input
                          value={formData.lastName}
                          onChange={(e) => setFormData(prev => ({ ...prev, lastName: e.target.value }))}
                          className="pl-8 h-10 text-sm border border-border rounded-lg"
                          placeholder="Doe"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                      <Input
                        value={userEmail}
                        disabled
                        className="pl-8 h-10 text-sm border border-border rounded-lg bg-muted/50"
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <CheckCircle2 className="w-2.5 h-2.5 text-green-500" />
                      Verified
                    </p>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Phone Number</Label>
                    <div className="relative">
                      <Phone className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                      <Input
                        type="tel"
                        value={formData.phone}
                        onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                        className="pl-8 h-10 text-sm border border-border rounded-lg"
                        placeholder="(555) 123-4567"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Location */}
              {currentStep === 2 && (
                <div className="space-y-4">
                  <div className="text-center mb-4">
                    <h2 className="text-base font-semibold">Your Location</h2>
                    <p className="text-xs text-muted-foreground">Where you work from</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs font-medium">State</Label>
                      <select
                        value={formData.state}
                        onChange={(e) => setFormData(prev => ({ ...prev, state: e.target.value }))}
                        className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm"
                      >
                        <option value="">Select</option>
                        {US_STATES.map(state => (
                          <option key={state} value={state}>{state}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs font-medium">ZIP Code</Label>
                      <div className="relative">
                        <MapPin className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                        <Input
                          value={formData.homeZip}
                          onChange={(e) => setFormData(prev => ({ ...prev, homeZip: e.target.value }))}
                          maxLength={5}
                          className="pl-8 h-10 text-sm border border-border rounded-lg"
                          placeholder="12345"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs font-medium flex items-center gap-1.5">
                      <Car className="w-3.5 h-3.5" />
                      Travel Distance
                    </Label>
                    <div className="grid grid-cols-5 gap-1.5">
                      {TRAVEL_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setFormData(prev => ({ ...prev, maxTravelMiles: option.value }))}
                          className={cn(
                            "py-2.5 rounded-lg border text-xs font-medium transition-all",
                            formData.maxTravelMiles === option.value
                              ? "border-primary bg-primary/5 text-primary"
                              : "border-border hover:border-primary/50"
                          )}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Pay Rate */}
                  <div className="bg-green-500/10 rounded-xl p-4 border border-green-500/20">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
                        <span className="text-green-600 font-bold text-sm">$</span>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Starting Rate</p>
                        <p className="text-xl font-bold text-green-600">$18/hr</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 3: Availability & Skills */}
              {currentStep === 3 && (
                <div className="space-y-4">
                  <div className="text-center mb-4">
                    <h2 className="text-base font-semibold">Schedule & Skills</h2>
                    <p className="text-xs text-muted-foreground">Your availability</p>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs font-medium flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5" />
                      Work Days
                    </Label>
                    <div className="grid grid-cols-7 gap-1.5">
                      {DAYS_OF_WEEK.map((day) => (
                        <button
                          key={day.id}
                          type="button"
                          onClick={() => toggleDay(day.id)}
                          className={cn(
                            "aspect-square rounded-lg font-semibold text-xs transition-all border",
                            formData.preferredWorkDays.includes(day.id)
                              ? "bg-primary text-white border-primary"
                              : "bg-muted text-muted-foreground border-border hover:border-primary/50"
                          )}
                        >
                          {day.label}
                        </button>
                      ))}
                    </div>
                    {formData.preferredWorkDays.length > 0 && (
                      <p className="text-[10px] text-muted-foreground">
                        {formData.preferredWorkDays.join(", ")}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs font-medium">Your Skills</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {SKILLSET_OPTIONS.map((skill) => (
                        <button
                          key={skill.id}
                          type="button"
                          onClick={() => toggleSkill(skill.id)}
                          className={cn(
                            "p-3 rounded-lg border text-left transition-all",
                            formData.skillset.includes(skill.id)
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-primary/50"
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-lg">{skill.icon}</span>
                            <div>
                              <p className="text-xs font-medium leading-tight">{skill.id.split(' ')[0]}</p>
                              <p className="text-[10px] text-muted-foreground">{skill.desc}</p>
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
                <div className="space-y-4">
                  <div className="text-center mb-4">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center mx-auto mb-2">
                      <CheckCircle2 className="w-6 h-6 text-white" />
                    </div>
                    <h2 className="text-base font-semibold">Review Profile</h2>
                    <p className="text-xs text-muted-foreground">Almost done!</p>
                  </div>

                  <div className="bg-muted/30 rounded-xl p-4 space-y-3 border border-border">
                    {/* Profile Header */}
                    <div className="flex items-center gap-3">
                      {avatarPreview ? (
                        <img src={avatarPreview} className="w-12 h-12 rounded-full object-cover border border-border" />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center border border-border">
                          <User className="w-6 h-6 text-primary/50" />
                        </div>
                      )}
                      <div>
                        <p className="font-semibold text-sm">{formData.firstName} {formData.lastName}</p>
                        <p className="text-xs text-muted-foreground">{userEmail}</p>
                      </div>
                    </div>

                    <div className="h-px bg-border" />

                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <p className="text-muted-foreground text-[10px] uppercase mb-0.5">Phone</p>
                        <p className="font-medium">{formData.phone}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-[10px] uppercase mb-0.5">Location</p>
                        <p className="font-medium">{formData.homeZip}, {formData.state}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-[10px] uppercase mb-0.5">Travel</p>
                        <p className="font-medium">{formData.maxTravelMiles} miles</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-[10px] uppercase mb-0.5">Pay</p>
                        <p className="font-medium text-green-600">$18/hr</p>
                      </div>
                    </div>

                    <div className="h-px bg-border" />

                    <div>
                      <p className="text-muted-foreground text-[10px] uppercase mb-1.5">Days</p>
                      <div className="flex gap-1 flex-wrap">
                        {formData.preferredWorkDays.map(day => (
                          <Badge key={day} variant="secondary" className="text-[10px] px-2 py-0.5 border border-border">{day}</Badge>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-muted-foreground text-[10px] uppercase mb-1.5">Skills</p>
                      <div className="flex gap-1 flex-wrap">
                        {formData.skillset.map(skill => (
                          <Badge key={skill} className="text-[10px] px-2 py-0.5 bg-primary/10 text-primary border border-primary/20">
                            {skill.split(' ')[0]}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="bg-blue-500/10 rounded-lg p-3 border border-blue-500/20">
                    <p className="text-xs text-blue-700 dark:text-blue-300">
                      <span className="font-semibold">Next:</span> Set up Stripe for payouts
                    </p>
                  </div>
                </div>
              )}

              {/* Navigation */}
              <div className="flex gap-2 mt-5">
                {currentStep > 1 && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleBack}
                    className="flex-1 h-10 text-sm border border-border"
                    disabled={isLoading}
                  >
                    <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
                    Back
                  </Button>
                )}

                {currentStep < 4 ? (
                  <Button
                    type="button"
                    onClick={handleNext}
                    className="flex-1 h-10 text-sm border border-primary/20"
                    disabled={isLoading}
                  >
                    Continue
                    <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    className="flex-1 h-10 text-sm bg-gradient-to-r from-primary to-purple-600 border-0"
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                        Complete Setup
                      </>
                    )}
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-[10px] text-muted-foreground mt-4">
          By continuing, you agree to our Terms
        </p>
      </div>
    </div>
  );
}
