import {
  RiArrowLeftLine,
  RiArrowRightLine,
  RiBriefcaseLine,
  RiCalendarLine,
  RiCameraLine,
  RiCheckboxCircleLine,
  RiLoader4Line,
  RiMailLine,
  RiMapPinLine,
  RiMoneyDollarCircleLine,
  RiPhoneLine,
  RiSparklingLine,
  RiUserLine
} from "@remixicon/react";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { SEO } from "@/components/SEO";

import { validatePhone, validateEmail, validateName } from "@/lib/form-validation";
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
  { id: "Standard Cleaning", icon: "🏠" },
  { id: "Deep Cleaning", icon: "✨" },
  { id: "Move-In/Move-Out", icon: "📦" },
  { id: "Vacation Rental", icon: "🏖️" },
  { id: "Pet-Friendly", icon: "🐾" },
  { id: "Eco-Friendly", icon: "🌿" },
];

const STEPS = [
  { id: 1, title: "Personal Info", icon: RiUserLine },
  { id: 2, title: "Location", icon: RiMapPinLine },
  { id: 3, title: "Availability", icon: RiCalendarLine },
  { id: 4, title: "Review", icon: RiCheckboxCircleLine },
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
      
      // Check if already onboarded
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
      // Upload avatar if provided
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

      // Create cleaner record
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

      // Geocode home ZIP to populate home_lat/home_lng for dispatch eligibility
      if (formData.homeZip) {
        try {
          const { data: geoData } = await supabase.functions.invoke('geocode-address', {
            body: { zip: formData.homeZip }
          });
          if (geoData?.lat && geoData?.lng) {
            await supabase
              .from("cleaners")
              .update({ home_lat: geoData.lat, home_lng: geoData.lng })
              .eq("user_id", userId);
          }
        } catch (geoErr) {
          console.warn("Geocoding failed (non-critical):", geoErr);
        }
      }

      // Initiate Stripe Connect
      toast.success("Profile created! Setting up payments...");
      
      const { data: stripeData, error: stripeError } = await supabase.functions.invoke(
        "initiate-cleaner-stripe-connect"
      );

      if (stripeError || !stripeData?.url) {
        toast.info("Profile saved! You can set up payments later.");
        navigate("/cleaner/dashboard");
        return;
      }

      // Redirect to Stripe Connect onboarding
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
          <RiLoader4Line className="w-10 h-10 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground">Verifying session...</p>
        </div>
      </div>
    );
  }

  const progress = (currentStep / 4) * 100;

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/10 py-8 px-4">
      <SEO title="Contractor Onboarding" noindex />
      <div className="max-w-lg mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-primary shadow-lg mb-4">
            <RiBriefcaseLine className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold">Join Our Team</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Complete your profile to start accepting jobs
          </p>
        </div>

        {/* Progress Steps */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            {STEPS.map((step, index) => {
              const Icon = step.icon;
              const isActive = currentStep === step.id;
              const isComplete = currentStep > step.id;
              
              return (
                <div key={step.id} className="flex flex-col items-center flex-1">
                  <div className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center transition-all",
                    isActive && "bg-primary text-white shadow-lg",
                    isComplete && "bg-green-500 text-white",
                    !isActive && !isComplete && "bg-muted text-muted-foreground"
                  )}>
                    {isComplete ? <RiCheckboxCircleLine className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
                  </div>
                  <span className={cn(
                    "text-xs mt-2 font-medium",
                    isActive && "text-primary",
                    isComplete && "text-green-600",
                    !isActive && !isComplete && "text-muted-foreground"
                  )}>
                    {step.title}
                  </span>
                </div>
              );
            })}
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        {/* Form Card */}
        <Card className="border-0 shadow-xl">
          <CardContent className="p-6">
            <form onSubmit={handleSubmit}>
              {/* Step 1: Personal Info */}
              {currentStep === 1 && (
                <div className="space-y-5">
                  <div className="text-center mb-6">
                    <h2 className="text-lg font-semibold">Personal Information</h2>
                    <p className="text-sm text-muted-foreground">Tell us about yourself</p>
                  </div>

                  {/* Avatar Upload */}
                  <div className="flex justify-center">
                    <div className="relative">
                      <div className={cn(
                        "w-24 h-24 rounded-full border-4 border-dashed flex items-center justify-center overflow-hidden transition-all",
                        avatarPreview ? "border-primary" : "border-muted-foreground/30"
                      )}>
                        {avatarPreview ? (
                          <img src={avatarPreview} alt="Preview" className="w-full h-full object-cover" />
                        ) : (
                          <RiCameraLine className="w-8 h-8 text-muted-foreground/50" />
                        )}
                      </div>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleImageChange}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                      <div className="absolute -bottom-1 -right-1 w-8 h-8 bg-primary rounded-full flex items-center justify-center shadow-lg">
                        <RiCameraLine className="w-4 h-4 text-white" />
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-center text-muted-foreground">
                    Add a professional photo (optional)
                  </p>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">First Name</Label>
                      <div className="relative">
                        <RiUserLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          value={formData.firstName}
                          onChange={(e) => setFormData(prev => ({ ...prev, firstName: e.target.value }))}
                          className="pl-10 h-11"
                          placeholder="John"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Last Name</Label>
                      <div className="relative">
                        <RiUserLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          value={formData.lastName}
                          onChange={(e) => setFormData(prev => ({ ...prev, lastName: e.target.value }))}
                          className="pl-10 h-11"
                          placeholder="Doe"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Email</Label>
                    <div className="relative">
                      <RiMailLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        value={userEmail}
                        disabled
                        className="pl-10 h-11 bg-muted/50"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <RiCheckboxCircleLine className="w-3 h-3 text-green-500" />
                      Verified
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Phone Number</Label>
                    <div className="relative">
                      <RiPhoneLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        type="tel"
                        value={formData.phone}
                        onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                        className="pl-10 h-11"
                        placeholder="(555) 123-4567"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Location */}
              {currentStep === 2 && (
                <div className="space-y-5">
                  <div className="text-center mb-6">
                    <h2 className="text-lg font-semibold">Your Location</h2>
                    <p className="text-sm text-muted-foreground">Where are you based?</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">State</Label>
                      <select
                        value={formData.state}
                        onChange={(e) => setFormData(prev => ({ ...prev, state: e.target.value }))}
                        className="w-full h-11 rounded-lg border border-input bg-background px-3 text-sm"
                      >
                        <option value="">Select</option>
                        {US_STATES.map(state => (
                          <option key={state} value={state}>{state}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">ZIP Code</Label>
                      <div className="relative">
                        <RiMapPinLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          value={formData.homeZip}
                          onChange={(e) => setFormData(prev => ({ ...prev, homeZip: e.target.value }))}
                          maxLength={5}
                          className="pl-10 h-11"
                          placeholder="12345"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Max Travel Distance</Label>
                    <select
                      value={formData.maxTravelMiles}
                      onChange={(e) => setFormData(prev => ({ ...prev, maxTravelMiles: parseInt(e.target.value) }))}
                      className="w-full h-11 rounded-lg border border-input bg-background px-3 text-sm"
                    >
                      <option value={10}>10 miles</option>
                      <option value={15}>15 miles</option>
                      <option value={20}>20 miles</option>
                      <option value={25}>25 miles</option>
                      <option value={30}>30 miles</option>
                    </select>
                    <p className="text-xs text-muted-foreground">
                      You'll only receive jobs within this radius
                    </p>
                  </div>

                  {/* Pay Rate Display */}
                  <div className="bg-gradient-to-r from-green-500/10 to-emerald-500/10 rounded-xl p-4 border border-green-500/20">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                        <RiMoneyDollarCircleLine className="w-5 h-5 text-green-600" />
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Your Pay Rate</p>
                        <p className="text-2xl font-bold text-green-600">$18/hour</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 3: Availability & Skills */}
              {currentStep === 3 && (
                <div className="space-y-5">
                  <div className="text-center mb-6">
                    <h2 className="text-lg font-semibold">Availability & Skills</h2>
                    <p className="text-sm text-muted-foreground">When can you work?</p>
                  </div>

                  <div className="space-y-3">
                    <Label className="text-sm font-medium">Available Days</Label>
                    <div className="flex gap-2 justify-center">
                      {DAYS_OF_WEEK.map((day) => (
                        <button
                          key={day.id}
                          type="button"
                          onClick={() => toggleDay(day.id)}
                          className={cn(
                            "w-10 h-10 rounded-full font-medium text-sm transition-all",
                            formData.preferredWorkDays.includes(day.id)
                              ? "bg-primary text-white shadow-lg"
                              : "bg-muted text-muted-foreground hover:bg-muted/80"
                          )}
                        >
                          {day.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <Label className="text-sm font-medium">Your Skills</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {SKILLSET_OPTIONS.map((skill) => (
                        <button
                          key={skill.id}
                          type="button"
                          onClick={() => toggleSkill(skill.id)}
                          className={cn(
                            "p-3 rounded-xl border-2 text-left transition-all",
                            formData.skillset.includes(skill.id)
                              ? "border-primary bg-primary/5"
                              : "border-transparent bg-muted/50 hover:bg-muted"
                          )}
                        >
                          <span className="text-lg">{skill.icon}</span>
                          <p className="text-xs font-medium mt-1">{skill.id}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Step 4: Review */}
              {currentStep === 4 && (
                <div className="space-y-5">
                  <div className="text-center mb-6">
                    <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-3">
                      <RiSparklingLine className="w-8 h-8 text-green-500" />
                    </div>
                    <h2 className="text-lg font-semibold">Review Your Profile</h2>
                    <p className="text-sm text-muted-foreground">Make sure everything looks good</p>
                  </div>

                  <div className="space-y-4 bg-muted/30 rounded-xl p-4">
                    <div className="flex items-center gap-3">
                      {avatarPreview ? (
                        <img src={avatarPreview} className="w-12 h-12 rounded-full object-cover" />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                          <RiUserLine className="w-6 h-6 text-muted-foreground" />
                        </div>
                      )}
                      <div>
                        <p className="font-semibold">{formData.firstName} {formData.lastName}</p>
                        <p className="text-sm text-muted-foreground">{userEmail}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-muted-foreground">Phone</p>
                        <p className="font-medium">{formData.phone}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Location</p>
                        <p className="font-medium">{formData.homeZip}, {formData.state}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Travel Range</p>
                        <p className="font-medium">{formData.maxTravelMiles} miles</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Pay Rate</p>
                        <p className="font-medium text-green-600">$18/hour</p>
                      </div>
                    </div>

                    <div>
                      <p className="text-sm text-muted-foreground mb-2">Available Days</p>
                      <div className="flex gap-1 flex-wrap">
                        {formData.preferredWorkDays.map(day => (
                          <Badge key={day} variant="secondary" className="text-xs">{day}</Badge>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-sm text-muted-foreground mb-2">Skills</p>
                      <div className="flex gap-1 flex-wrap">
                        {formData.skillset.map(skill => (
                          <Badge key={skill} className="text-xs bg-primary/10 text-primary border-0">
                            {skill}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="bg-blue-500/10 rounded-xl p-4 border border-blue-500/20">
                    <p className="text-sm text-blue-700 dark:text-blue-300">
                      <strong>Next step:</strong> After submitting, you'll be redirected to Stripe to set up your payment account for receiving payouts.
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
                    className="flex-1 h-11"
                    disabled={isLoading}
                  >
                    <RiArrowLeftLine className="w-4 h-4 mr-2" />
                    Back
                  </Button>
                )}

                {currentStep < 4 ? (
                  <Button
                    type="button"
                    onClick={handleNext}
                    className="flex-1 h-11"
                    disabled={isLoading}
                  >
                    Continue
                    <RiArrowRightLine className="w-4 h-4 ml-2" />
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    className="flex-1 h-11"
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <>
                        <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" />
                        Creating Profile...
                      </>
                    ) : (
                      <>
                        <RiCheckboxCircleLine className="w-4 h-4 mr-2" />
                        Complete & Setup Payments
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
