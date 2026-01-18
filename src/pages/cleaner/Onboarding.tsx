import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { 
  Loader2, 
  MapPin, 
  CheckCircle2, 
  ArrowLeft, 
  ArrowRight, 
  User, 
  Calendar, 
  Briefcase,
  Camera,
  Phone,
  Mail
} from "lucide-react";
import { validatePhone, validateEmail, validateName } from "@/lib/form-validation";
import { processAvatarImage } from "@/lib/image-compression";
import logo from "@/assets/logo.png";

const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"
];

const DAYS_OF_WEEK = [
  { key: "Mon", label: "Monday" },
  { key: "Tue", label: "Tuesday" },
  { key: "Wed", label: "Wednesday" },
  { key: "Thu", label: "Thursday" },
  { key: "Fri", label: "Friday" },
  { key: "Sat", label: "Saturday" },
  { key: "Sun", label: "Sunday" }
];

const SKILLSET_OPTIONS = [
  { id: "Standard Cleaning", label: "Standard Cleaning", description: "Regular home cleaning" },
  { id: "Deep Cleaning", label: "Deep Cleaning", description: "Thorough top-to-bottom cleaning" },
  { id: "Move-In/Move-Out", label: "Move-In/Out", description: "Cleaning for moving" },
  { id: "Vacation Rental Turnover", label: "Vacation Rentals", description: "Quick turnovers" },
  { id: "Pet-Friendly Cleaning", label: "Pet-Friendly", description: "Comfortable with pets" },
  { id: "Eco-Friendly Products", label: "Eco-Friendly", description: "Green cleaning products" },
];

const STEPS = [
  { id: 1, title: "Personal Info", icon: User },
  { id: 2, title: "Location", icon: MapPin },
  { id: 3, title: "Preferences", icon: Calendar },
  { id: 4, title: "Review", icon: CheckCircle2 }
];

const STORAGE_KEY = 'cleaner-onboarding-form';

export default function CleanerOnboarding() {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    state: "",
    homeZip: "",
    maxTravelMiles: 20,
    preferredWorkDays: [] as string[],
    skillset: [] as string[],
    avatarFile: null as File | null
  });
  const [avatarPreview, setAvatarPreview] = useState<string>("");

  // Check authentication and pre-fill email
  useEffect(() => {
    checkAuth();
    loadSavedData();
  }, []);

  // Auto-save to localStorage
  useEffect(() => {
    if (!checkingAuth) {
      saveToLocalStorage();
    }
  }, [formData, avatarPreview, currentStep, checkingAuth]);

  const checkAuth = async () => {
    console.log("[ONBOARDING] Starting auth check...");
    
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      
      console.log("[ONBOARDING] Session check result:", {
        hasSession: !!session,
        userId: session?.user?.id,
        email: session?.user?.email,
        error: sessionError
      });
      
      if (!session) {
        console.warn("[ONBOARDING] No session found - redirecting to landing");
        toast.error("Please verify your email first");
        navigate("/cleaner/onboarding-landing");
        return;
      }
      
      setUserId(session.user.id);
      setFormData(prev => ({
        ...prev,
        email: session.user.email || ""
      }));
      
      // Check if cleaner profile already exists
      const { data: existingCleaner } = await supabase
        .from("cleaners")
        .select("id, onboarding_complete")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (existingCleaner?.onboarding_complete) {
        clearSavedData();
        navigate("/cleaner/dashboard");
        return;
      }

      setCheckingAuth(false);
    } catch (error) {
      console.error("[ONBOARDING] Auth check error:", error);
      toast.error("Session expired. Please verify your email again.");
      navigate("/cleaner/onboarding-landing");
    }
  };

  const saveToLocalStorage = () => {
    try {
      const dataToSave = {
        formData: { ...formData, avatarFile: null },
        avatarPreview,
        currentStep,
        timestamp: Date.now(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));
    } catch (error) {
      console.error("Failed to save to localStorage:", error);
    }
  };

  const loadSavedData = () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const { formData: savedForm, avatarPreview: savedAvatar, currentStep: savedStep } = JSON.parse(saved);
        setFormData(prev => ({ ...prev, ...savedForm }));
        setAvatarPreview(savedAvatar || "");
        setCurrentStep(savedStep || 1);
      }
    } catch (error) {
      console.error("Failed to load from localStorage:", error);
    }
  };

  const clearSavedData = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.error("Failed to clear localStorage:", error);
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
      toast.success("Photo uploaded successfully");
    } catch (error: any) {
      toast.error(error.message || "Failed to process image");
    } finally {
      setIsLoading(false);
    }
  };

  const validateCurrentStep = () => {
    switch (currentStep) {
      case 1:
        const nameValidation = validateName(formData.firstName, "First name");
        if (!nameValidation.isValid) {
          toast.error(nameValidation.error);
          return false;
        }

        const lastNameValidation = validateName(formData.lastName, "Last name");
        if (!lastNameValidation.isValid) {
          toast.error(lastNameValidation.error);
          return false;
        }

        const phoneValidation = validatePhone(formData.phone);
        if (!phoneValidation.isValid) {
          toast.error(phoneValidation.error);
          return false;
        }
        return true;

      case 2:
        if (!formData.state) {
          toast.error("Please select a state");
          return false;
        }
        if (!formData.homeZip || formData.homeZip.length !== 5) {
          toast.error("Please enter a valid 5-digit ZIP code");
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
    if (validateCurrentStep()) {
      setCurrentStep(prev => Math.min(prev + 1, 4));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleBack = () => {
    setCurrentStep(prev => Math.max(prev - 1, 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateCurrentStep()) return;
    if (!userId) {
      toast.error("Session expired. Please verify your email again.");
      navigate("/cleaner/onboarding-landing");
      return;
    }

    setIsLoading(true);

    try {
      // Upload avatar if provided
      let avatarUrl = null;
      if (formData.avatarFile) {
        try {
          const fileExt = formData.avatarFile.name.split('.').pop();
          const storagePath = `${userId}/${Date.now()}-${crypto.randomUUID()}.${fileExt}`;
          
          const { error: uploadError } = await supabase.storage
            .from('cleaner-avatars')
            .upload(storagePath, formData.avatarFile, { contentType: formData.avatarFile.type });

          if (!uploadError) {
            const { data: { publicUrl } } = supabase.storage
              .from('cleaner-avatars')
              .getPublicUrl(storagePath);
            avatarUrl = publicUrl;
          }
        } catch (e) {
          console.warn("Avatar upload failed:", e);
        }
      }

      // Geocode home address
      let geoLat: number | null = null;
      let geoLng: number | null = null;
      try {
        const { data: geoData } = await supabase.functions.invoke("geocode-address", {
          body: { zip: formData.homeZip, state: formData.state }
        });
        if (geoData) {
          geoLat = geoData.lat ?? null;
          geoLng = geoData.lng ?? null;
        }
      } catch {
        console.warn("Geocoding failed");
      }

      // Insert cleaner record
      const { data: cleanerData, error: insertError } = await supabase
        .from("cleaners")
        .insert({
          user_id: userId,
          first_name: formData.firstName,
          last_name: formData.lastName,
          phone: formData.phone,
          email: formData.email,
          state: formData.state,
          home_zip: formData.homeZip,
          home_lat: geoLat,
          home_lng: geoLng,
          max_travel_miles: formData.maxTravelMiles,
          preferred_work_days: formData.preferredWorkDays,
          avatar_url: avatarUrl,
          skillset: formData.skillset,
          pay_rate_hr: 18.00,
          status: "active",
          approved: true,
          onboarding_complete: true,
          activated_at: new Date().toISOString(),
          status_today: formData.preferredWorkDays.includes(
            new Date().toLocaleDateString('en-US', { weekday: 'long' }).substring(0, 3)
          ) ? "Available" : "Unavailable"
        })
        .select()
        .single();

      if (insertError) {
        if (insertError.code === '23505') {
          toast.success("Profile already exists! Redirecting...");
          clearSavedData();
          navigate("/cleaner/dashboard");
          return;
        }
        throw insertError;
      }

      // Trigger Stripe Connect onboarding
      try {
        const { data: onboardingData, error: onboardingError } = await supabase.functions.invoke(
          "initiate-cleaner-stripe-connect"
        );

        if (!onboardingError && onboardingData?.url) {
          toast.success("Profile created! Setting up payments...");
          clearSavedData();
          setTimeout(() => {
            window.location.href = onboardingData.url;
          }, 1500);
          return;
        }
      } catch (onboardingError) {
        console.error("Stripe onboarding error:", onboardingError);
      }

      toast.success("Profile created successfully!");
      clearSavedData();
      navigate("/cleaner/dashboard");

    } catch (error: any) {
      console.error("Onboarding error:", error);
      toast.error(error.message || "Failed to create profile. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#5500FF]/5 via-background to-[#8F7BFD]/10 flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="w-12 h-12 animate-spin text-[#5500FF] mx-auto" />
          <p className="text-muted-foreground">Loading your profile...</p>
        </div>
      </div>
    );
  }

  const progressPercentage = (currentStep / 4) * 100;

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#5500FF]/5 via-background to-[#8F7BFD]/10 pb-8">
      {/* Header */}
      <header className="bg-card/80 backdrop-blur border-b border-border sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src={logo} alt="Novara" className="w-8 h-8 rounded-lg" />
              <span className="font-bold">Complete Your Profile</span>
            </div>
            <Badge variant="secondary" className="bg-[#5500FF]/10 text-[#5500FF]">
              Step {currentStep} of 4
            </Badge>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 max-w-3xl">
        {/* Progress Steps */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            {STEPS.map((step, index) => (
              <div key={step.id} className="flex items-center">
                <div className={`
                  flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all
                  ${currentStep >= step.id 
                    ? 'bg-gradient-to-br from-[#5500FF] to-[#8F7BFD] border-[#5500FF] text-white' 
                    : 'border-border bg-card text-muted-foreground'
                  }
                `}>
                  {currentStep > step.id ? (
                    <CheckCircle2 className="w-5 h-5" />
                  ) : (
                    <step.icon className="w-5 h-5" />
                  )}
                </div>
                {index < STEPS.length - 1 && (
                  <div className={`w-12 md:w-24 h-0.5 mx-2 ${
                    currentStep > step.id ? 'bg-[#5500FF]' : 'bg-border'
                  }`} />
                )}
              </div>
            ))}
          </div>
          <Progress value={progressPercentage} className="h-2" />
        </div>

        {/* Form Card */}
        <Card className="shadow-xl border-[#5500FF]/20">
          <CardHeader className="pb-4">
            <CardTitle className="text-2xl">
              {STEPS[currentStep - 1].title}
            </CardTitle>
            <CardDescription>
              {currentStep === 1 && "Tell us about yourself"}
              {currentStep === 2 && "Where are you located?"}
              {currentStep === 3 && "Set your availability and skills"}
              {currentStep === 4 && "Review and confirm your information"}
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              
              {/* Step 1: Personal Info */}
              {currentStep === 1 && (
                <div className="space-y-6">
                  {/* Avatar Upload */}
                  <div className="flex flex-col items-center gap-4">
                    <div className="relative">
                      <div className={`
                        w-24 h-24 rounded-full border-4 border-dashed border-border
                        flex items-center justify-center overflow-hidden
                        ${avatarPreview ? 'border-[#5500FF] border-solid' : ''}
                      `}>
                        {avatarPreview ? (
                          <img src={avatarPreview} alt="Preview" className="w-full h-full object-cover" />
                        ) : (
                          <Camera className="w-8 h-8 text-muted-foreground" />
                        )}
                      </div>
                      <label className="absolute -bottom-1 -right-1 w-8 h-8 bg-[#5500FF] rounded-full flex items-center justify-center cursor-pointer hover:bg-[#4400DD] transition-colors">
                        <Camera className="w-4 h-4 text-white" />
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleImageChange}
                          className="hidden"
                        />
                      </label>
                    </div>
                    <p className="text-sm text-muted-foreground">Add a profile photo (optional)</p>
                  </div>

                  {/* Name Fields */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="firstName">First Name *</Label>
                      <Input
                        id="firstName"
                        value={formData.firstName}
                        onChange={(e) => setFormData(prev => ({ ...prev, firstName: e.target.value }))}
                        placeholder="John"
                        className="h-12"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="lastName">Last Name *</Label>
                      <Input
                        id="lastName"
                        value={formData.lastName}
                        onChange={(e) => setFormData(prev => ({ ...prev, lastName: e.target.value }))}
                        placeholder="Doe"
                        className="h-12"
                        required
                      />
                    </div>
                  </div>

                  {/* Email (Read-only) */}
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                      <Input
                        id="email"
                        type="email"
                        value={formData.email}
                        disabled
                        className="pl-10 h-12 bg-muted"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3 text-[#5500FF]" />
                      Verified email address
                    </p>
                  </div>

                  {/* Phone */}
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone Number *</Label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                      <Input
                        id="phone"
                        type="tel"
                        value={formData.phone}
                        onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                        placeholder="(555) 123-4567"
                        className="pl-10 h-12"
                        required
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Location */}
              {currentStep === 2 && (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="state">State *</Label>
                      <select
                        id="state"
                        value={formData.state}
                        onChange={(e) => setFormData(prev => ({ ...prev, state: e.target.value }))}
                        className="flex h-12 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5500FF] focus-visible:ring-offset-2"
                        required
                      >
                        <option value="">Select state</option>
                        {US_STATES.map(state => (
                          <option key={state} value={state}>{state}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="homeZip">ZIP Code *</Label>
                      <Input
                        id="homeZip"
                        value={formData.homeZip}
                        onChange={(e) => setFormData(prev => ({ ...prev, homeZip: e.target.value.replace(/\D/g, '').slice(0, 5) }))}
                        placeholder="12345"
                        maxLength={5}
                        className="h-12"
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-3">
                    <Label>Maximum Travel Distance *</Label>
                    <p className="text-sm text-muted-foreground">How far are you willing to travel for jobs?</p>
                    <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
                      {[10, 15, 20, 25, 30].map((miles) => (
                        <button
                          key={miles}
                          type="button"
                          onClick={() => setFormData(prev => ({ ...prev, maxTravelMiles: miles }))}
                          className={`
                            p-3 rounded-lg border-2 text-center transition-all
                            ${formData.maxTravelMiles === miles 
                              ? 'border-[#5500FF] bg-[#5500FF]/10 text-[#5500FF]' 
                              : 'border-border hover:border-[#5500FF]/50'
                            }
                          `}
                        >
                          <span className="font-semibold">{miles}</span>
                          <span className="text-xs block text-muted-foreground">miles</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Step 3: Preferences */}
              {currentStep === 3 && (
                <div className="space-y-8">
                  {/* Work Days */}
                  <div className="space-y-3">
                    <Label>Preferred Work Days *</Label>
                    <p className="text-sm text-muted-foreground">Select the days you're available to work</p>
                    <div className="grid grid-cols-4 md:grid-cols-7 gap-2">
                      {DAYS_OF_WEEK.map((day) => (
                        <button
                          key={day.key}
                          type="button"
                          onClick={() => {
                            const newDays = formData.preferredWorkDays.includes(day.key)
                              ? formData.preferredWorkDays.filter(d => d !== day.key)
                              : [...formData.preferredWorkDays, day.key];
                            setFormData(prev => ({ ...prev, preferredWorkDays: newDays }));
                          }}
                          className={`
                            p-3 rounded-lg border-2 text-center transition-all
                            ${formData.preferredWorkDays.includes(day.key)
                              ? 'border-[#5500FF] bg-[#5500FF]/10 text-[#5500FF]' 
                              : 'border-border hover:border-[#5500FF]/50'
                            }
                          `}
                        >
                          <span className="font-semibold text-sm">{day.key}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Skills */}
                  <div className="space-y-3">
                    <Label>Your Skills *</Label>
                    <p className="text-sm text-muted-foreground">Select the services you can provide</p>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {SKILLSET_OPTIONS.map((skill) => (
                        <button
                          key={skill.id}
                          type="button"
                          onClick={() => {
                            const newSkills = formData.skillset.includes(skill.id)
                              ? formData.skillset.filter(s => s !== skill.id)
                              : [...formData.skillset, skill.id];
                            setFormData(prev => ({ ...prev, skillset: newSkills }));
                          }}
                          className={`
                            p-4 rounded-lg border-2 text-left transition-all
                            ${formData.skillset.includes(skill.id)
                              ? 'border-[#5500FF] bg-[#5500FF]/10' 
                              : 'border-border hover:border-[#5500FF]/50'
                            }
                          `}
                        >
                          <span className={`font-semibold text-sm block ${formData.skillset.includes(skill.id) ? 'text-[#5500FF]' : ''}`}>
                            {skill.label}
                          </span>
                          <span className="text-xs text-muted-foreground">{skill.description}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Pay Rate Info */}
                  <div className="p-4 rounded-lg bg-gradient-to-r from-[#5500FF]/10 to-[#8F7BFD]/10 border border-[#5500FF]/20">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#5500FF] to-[#8F7BFD] flex items-center justify-center">
                        <Briefcase className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <p className="font-semibold">Starting Pay Rate</p>
                        <p className="text-2xl font-bold text-[#5500FF]">$18.00<span className="text-sm font-normal text-muted-foreground">/hour</span></p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 4: Review */}
              {currentStep === 4 && (
                <div className="space-y-6">
                  {/* Personal Info Summary */}
                  <div className="p-4 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-3 mb-3">
                      <User className="w-5 h-5 text-[#5500FF]" />
                      <h4 className="font-semibold">Personal Information</h4>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">Name:</span>
                        <span className="ml-2 font-medium">{formData.firstName} {formData.lastName}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Phone:</span>
                        <span className="ml-2 font-medium">{formData.phone}</span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-muted-foreground">Email:</span>
                        <span className="ml-2 font-medium">{formData.email}</span>
                      </div>
                    </div>
                  </div>

                  {/* Location Summary */}
                  <div className="p-4 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-3 mb-3">
                      <MapPin className="w-5 h-5 text-[#5500FF]" />
                      <h4 className="font-semibold">Location</h4>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">State:</span>
                        <span className="ml-2 font-medium">{formData.state}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">ZIP:</span>
                        <span className="ml-2 font-medium">{formData.homeZip}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Travel:</span>
                        <span className="ml-2 font-medium">{formData.maxTravelMiles} miles</span>
                      </div>
                    </div>
                  </div>

                  {/* Preferences Summary */}
                  <div className="p-4 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-3 mb-3">
                      <Calendar className="w-5 h-5 text-[#5500FF]" />
                      <h4 className="font-semibold">Work Preferences</h4>
                    </div>
                    <div className="space-y-3">
                      <div>
                        <span className="text-sm text-muted-foreground block mb-1">Available Days:</span>
                        <div className="flex flex-wrap gap-1">
                          {formData.preferredWorkDays.map(day => (
                            <Badge key={day} variant="secondary" className="bg-[#5500FF]/10 text-[#5500FF]">
                              {day}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      <div>
                        <span className="text-sm text-muted-foreground block mb-1">Skills:</span>
                        <div className="flex flex-wrap gap-1">
                          {formData.skillset.map(skill => (
                            <Badge key={skill} variant="secondary" className="bg-[#5500FF]/10 text-[#5500FF]">
                              {skill}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Navigation Buttons */}
              <div className="flex justify-between gap-4 pt-6 border-t">
                {currentStep > 1 && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleBack}
                    disabled={isLoading}
                    className="h-12"
                  >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back
                  </Button>
                )}
                
                {currentStep < 4 ? (
                  <Button
                    type="button"
                    onClick={handleNext}
                    className="ml-auto h-12 bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] hover:opacity-90"
                  >
                    Continue
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                ) : (
                  <Button 
                    type="submit" 
                    className="ml-auto h-12 bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] hover:opacity-90" 
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        Creating Profile...
                      </>
                    ) : (
                      <>
                        Complete Setup
                        <CheckCircle2 className="ml-2 h-5 w-5" />
                      </>
                    )}
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
