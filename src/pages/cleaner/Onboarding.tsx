import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { Loader2, MapPin, CheckCircle2, ArrowLeft, ArrowRight } from "lucide-react";
import { validatePhone, validateEmail, validateName } from "@/lib/form-validation";
import { processAvatarImage } from "@/lib/image-compression";

const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"
];

const DAYS_OF_WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const SKILLSET_OPTIONS = [
  "Standard Cleaning",
  "Deep Cleaning",
  "Move-In/Move-Out",
  "Vacation Rental Turnover",
  "Pet-Friendly Cleaning",
  "Eco-Friendly Products",
  "Window Cleaning",
  "Carpet Cleaning",
  "Post-Construction Cleaning",
  "Commercial Cleaning"
];

const STORAGE_KEY = 'cleaner-onboarding-form';

export default function CleanerOnboarding() {
  const navigate = useNavigate();
  const { toast } = useToast();
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

  // Auto-save to localStorage whenever formData changes (after initial load)
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
        toast({
          title: "Session Required",
          description: "Please verify your email to continue",
          variant: "destructive",
        });
        navigate("/cleaner/onboarding-landing");
        return;
      }
      
      console.log("[ONBOARDING] Session established for user:", session.user.id);
      
      setUserId(session.user.id);
      setFormData(prev => ({
        ...prev,
        email: session.user.email || ""
      }));
      
      // Check if cleaner profile already exists
      console.log("[ONBOARDING] Checking for existing cleaner profile...");
      const { data: existingCleaner, error: profileError } = await supabase
        .from("cleaners")
        .select("id, onboarding_complete")
        .eq("user_id", session.user.id)
        .maybeSingle();

      console.log("[ONBOARDING] Existing profile check:", {
        profileExists: !!existingCleaner,
        onboardingComplete: existingCleaner?.onboarding_complete,
        error: profileError
      });

      if (existingCleaner?.onboarding_complete) {
        console.log("[ONBOARDING] Profile already complete - redirecting to dashboard");
        clearSavedData();
        navigate("/cleaner/dashboard");
        return;
      }

      console.log("[ONBOARDING] Auth check complete - ready for onboarding");
      setCheckingAuth(false);
    } catch (error) {
      console.error("[ONBOARDING] Auth check error:", error);
      toast({
        title: "Authentication Error",
        description: "Unable to verify session. Please try again.",
        variant: "destructive"
      });
      navigate("/cleaner/onboarding-landing");
    }
  };

  const saveToLocalStorage = () => {
    try {
      const dataToSave = {
        formData: {
          ...formData,
          avatarFile: null // Don't save File objects
        },
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
        toast({
          title: "Progress restored",
          description: "Your previous progress has been restored",
        });
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
      
      toast({
        title: "Image ready",
        description: "Image compressed and ready for upload",
      });
    } catch (error: any) {
      toast({
        title: "Image processing failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const validateCurrentStep = () => {
    switch (currentStep) {
      case 1: // Personal Information
        const nameValidation = validateName(formData.firstName, "First name");
        if (!nameValidation.isValid) {
          toast({ title: "Error", description: nameValidation.error, variant: "destructive" });
          return false;
        }

        const lastNameValidation = validateName(formData.lastName, "Last name");
        if (!lastNameValidation.isValid) {
          toast({ title: "Error", description: lastNameValidation.error, variant: "destructive" });
          return false;
        }

        const emailValidation = validateEmail(formData.email);
        if (!emailValidation.isValid) {
          toast({ title: "Error", description: emailValidation.error, variant: "destructive" });
          return false;
        }

        const phoneValidation = validatePhone(formData.phone);
        if (!phoneValidation.isValid) {
          toast({ title: "Error", description: phoneValidation.error, variant: "destructive" });
          return false;
        }
        return true;

      case 2: // Location & Travel
        if (!formData.state) {
          toast({ title: "Error", description: "Please select a state", variant: "destructive" });
          return false;
        }
        if (!formData.homeZip || formData.homeZip.length !== 5) {
          toast({ title: "Error", description: "Please enter a valid 5-digit ZIP code", variant: "destructive" });
          return false;
        }
        return true;

      case 3: // Work Preferences
        if (formData.preferredWorkDays.length === 0) {
          toast({
            title: "Error",
            description: "Please select at least one preferred work day",
            variant: "destructive"
          });
          return false;
        }

        if (formData.skillset.length === 0) {
          toast({
            title: "Error",
            description: "Please select at least one skill or specialty",
            variant: "destructive"
          });
          return false;
        }
        return true;

      case 4: // Review - no validation needed
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
    
    console.log("[ONBOARDING] Starting submission...");
    
    if (!validateCurrentStep()) {
      console.warn("[ONBOARDING] Validation failed for step", currentStep);
      return;
    }

    setIsLoading(true);

    try {
      const finalUserId = userId;
      
      console.log("[ONBOARDING] Submission data:", {
        userId: finalUserId,
        email: formData.email,
        name: `${formData.firstName} ${formData.lastName}`,
        hasAvatar: !!formData.avatarFile
      });
      
      if (!finalUserId) {
        console.error("[ONBOARDING] No user ID - session lost");
        toast({ 
          title: "Session Lost", 
          description: "Your session expired. Please verify your email again.", 
          variant: "destructive" 
        });
        navigate("/cleaner/onboarding-landing");
        return;
      }
    
      // Upload avatar if provided (non-blocking)
      let avatarUrl = null;
      if (formData.avatarFile) {
        try {
          const fileExt = formData.avatarFile.name.split('.').pop();
          const baseName = `${crypto.randomUUID()}.${fileExt}`;
          const storagePath = `${finalUserId}/${Date.now()}-${baseName}`;
          
          const { error: uploadError } = await supabase.storage
            .from('cleaner-avatars')
            .upload(storagePath, formData.avatarFile, {
              contentType: formData.avatarFile.type,
              upsert: false
            });

          if (!uploadError) {
            const { data: { publicUrl } } = supabase.storage
              .from('cleaner-avatars')
              .getPublicUrl(storagePath);
            
            avatarUrl = publicUrl;
          } else {
            console.warn("Avatar upload failed:", uploadError);
            toast({ 
              title: "Could not upload photo", 
              description: "You can add your photo later in Profile.",
            });
          }
        } catch (e) {
          console.warn("Avatar upload exception:", e);
        }
      }

      // Geocode home address (non-blocking)
      let geoLat: number | null = null;
      let geoLng: number | null = null;
      try {
        const { data: geoData, error: geoError } = await supabase.functions.invoke("geocode-address", {
          body: {
            zip: formData.homeZip,
            state: formData.state
          }
        });
        
        if (!geoError && geoData) {
          geoLat = geoData.lat ?? null;
          geoLng = geoData.lng ?? null;
        }
      } catch {
        console.warn("Geocoding failed - continuing without location");
      }

      // Insert cleaner record with user_id
      console.log("[ONBOARDING] Creating cleaner profile in database...");
      const { data: cleanerData, error: insertError } = await supabase
        .from("cleaners")
        .insert({
          user_id: finalUserId,
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
          status_today: formData.preferredWorkDays.includes(new Date().toLocaleDateString('en-US', { weekday: 'long' }).substring(0, 3))
            ? "Available"
            : "Unavailable"
        })
        .select()
        .single();

      if (insertError) {
        console.error("[ONBOARDING] Database insert error:", insertError);
        
        if (insertError.code === '23505') {
          console.warn("[ONBOARDING] Duplicate profile detected");
          toast({
            title: "Profile Already Exists",
            description: "You already have a cleaner profile. Redirecting to dashboard...",
          });
          clearSavedData();
          navigate("/cleaner/dashboard");
          return;
        }
        
        toast({
          title: "Database Error",
          description: `Failed to create profile: ${insertError.message}`,
          variant: "destructive"
        });
        throw insertError;
      }
      
      console.log("[ONBOARDING] Cleaner profile created successfully:", cleanerData?.id);

      // Trigger Stripe Connect onboarding
      console.log("[ONBOARDING] Initiating Stripe Connect onboarding...");
      try {
        const { data: onboardingData, error: onboardingError } = await supabase.functions.invoke(
          "initiate-cleaner-stripe-connect"
        );

        console.log("[ONBOARDING] Stripe Connect response:", {
          hasUrl: !!onboardingData?.url,
          error: onboardingError
        });

        if (onboardingError) {
          console.error("[ONBOARDING] Stripe onboarding failed:", onboardingError);
          toast({
            title: "Profile Created",
            description: "Payment setup unavailable. Contact admin to complete setup.",
          });
          clearSavedData();
          navigate("/cleaner/dashboard");
          return;
        }
        
        if (onboardingData?.url) {
          console.log("[ONBOARDING] Redirecting to Stripe Connect:", onboardingData.url);
          toast({
            title: "Profile Created!",
            description: "Redirecting to payment setup...",
          });
          clearSavedData();
          setTimeout(() => {
            window.location.href = onboardingData.url;
          }, 1500);
          return;
        }
      } catch (onboardingError) {
        console.error("[ONBOARDING] Stripe onboarding exception:", onboardingError);
        toast({
          title: "Payment Setup Error",
          description: "Unable to initiate payment setup. You can complete this later in your profile.",
        });
      }

      console.log("[ONBOARDING] Onboarding complete - redirecting to dashboard");
      toast({
        title: "Profile Created!",
        description: "Your cleaner profile has been successfully created.",
      });

      clearSavedData();
      navigate("/cleaner/dashboard");

    } catch (error: any) {
      console.error("[ONBOARDING] Fatal error:", error);
      toast({
        title: "Onboarding Failed",
        description: error.message || "An unexpected error occurred. Please try again or contact support.",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-secondary/5 flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground">Verifying authentication...</p>
        </div>
      </div>
    );
  }

  const progressPercentage = (currentStep / 4) * 100;
  const stepTitles = ["Personal Information", "Location & Travel", "Work Preferences", "Review & Submit"];

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-2xl mx-auto pt-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Cleaner Onboarding</CardTitle>
            <CardDescription>
              Step {currentStep} of 4: {stepTitles[currentStep - 1]}
            </CardDescription>
            <Progress value={progressPercentage} className="mt-4" />
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              
              {/* Step 1: Personal Information */}
              {currentStep === 1 && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Personal Information</h3>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="firstName">First Name *</Label>
                      <Input
                        id="firstName"
                        required
                        value={formData.firstName}
                        onChange={(e) => setFormData(prev => ({ ...prev, firstName: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label htmlFor="lastName">Last Name *</Label>
                      <Input
                        id="lastName"
                        required
                        value={formData.lastName}
                        onChange={(e) => setFormData(prev => ({ ...prev, lastName: e.target.value }))}
                      />
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="email">Email *</Label>
                    <Input
                      id="email"
                      type="email"
                      value={formData.email}
                      disabled
                      readOnly
                      className="bg-muted"
                    />
                    <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3 text-primary" />
                      Verified via email link
                    </p>
                  </div>

                  <div>
                    <Label htmlFor="phone">Phone *</Label>
                    <Input
                      id="phone"
                      type="tel"
                      required
                      value={formData.phone}
                      onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                      placeholder="(555) 123-4567"
                    />
                  </div>

                  <div className="space-y-4">
                    <Label htmlFor="avatar">Profile Photo (Optional)</Label>
                    <div className="flex items-center gap-4">
                      {avatarPreview && (
                        <img 
                          src={avatarPreview} 
                          alt="Preview" 
                          className="w-24 h-24 rounded-full object-cover border-2 border-border"
                        />
                      )}
                      <Input
                        id="avatar"
                        type="file"
                        accept="image/*"
                        onChange={handleImageChange}
                        className="flex-1"
                      />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Upload a professional photo. This will be shown to customers. Max 5MB.
                    </p>
                  </div>
                </div>
              )}

              {/* Step 2: Location & Travel */}
              {currentStep === 2 && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <MapPin className="h-5 w-5" />
                    Location & Travel
                  </h3>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="state">State *</Label>
                      <select
                        id="state"
                        required
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        value={formData.state}
                        onChange={(e) => setFormData(prev => ({ ...prev, state: e.target.value }))}
                      >
                        <option value="">Select state</option>
                        {US_STATES.map(state => (
                          <option key={state} value={state}>{state}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label htmlFor="homeZip">Home ZIP Code *</Label>
                      <Input
                        id="homeZip"
                        required
                        maxLength={5}
                        value={formData.homeZip}
                        onChange={(e) => setFormData(prev => ({ ...prev, homeZip: e.target.value }))}
                        placeholder="12345"
                      />
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="maxTravelMiles">
                      Max Travel Distance (miles) *
                    </Label>
                    <select
                      id="maxTravelMiles"
                      required
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      value={formData.maxTravelMiles}
                      onChange={(e) => setFormData(prev => ({ ...prev, maxTravelMiles: parseInt(e.target.value) }))}
                    >
                      <option value={10}>10 miles</option>
                      <option value={15}>15 miles</option>
                      <option value={20}>20 miles</option>
                      <option value={25}>25 miles</option>
                      <option value={30}>30 miles</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Step 3: Work Preferences */}
              {currentStep === 3 && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Work Preferences</h3>
                  
                  <div>
                    <Label>Preferred Work Days *</Label>
                    <p className="text-sm text-muted-foreground mb-2">
                      Select the days you're available to work
                    </p>
                    <ToggleGroup 
                      type="multiple" 
                      value={formData.preferredWorkDays}
                      onValueChange={(value) => setFormData(prev => ({ ...prev, preferredWorkDays: value }))}
                      className="justify-start flex-wrap"
                    >
                      {DAYS_OF_WEEK.map(day => (
                        <ToggleGroupItem 
                          key={day} 
                          value={day}
                          className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                        >
                          {day}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </div>

                  <div className="p-4 bg-muted rounded-lg">
                    <p className="text-sm font-medium">Pay Rate</p>
                    <p className="text-2xl font-bold text-primary">$18.00/hour</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Standard hourly rate for all cleaners
                    </p>
                  </div>

                  <div className="space-y-4">
                    <Label>Your Skills & Specialties *</Label>
                    <p className="text-sm text-muted-foreground">
                      Select all services you're comfortable providing (select at least one)
                    </p>
                    <ToggleGroup 
                      type="multiple" 
                      value={formData.skillset}
                      onValueChange={(value) => setFormData(prev => ({ ...prev, skillset: value }))}
                      className="grid grid-cols-1 md:grid-cols-2 gap-2 justify-start"
                    >
                      {SKILLSET_OPTIONS.map((skill) => (
                        <ToggleGroupItem 
                          key={skill} 
                          value={skill}
                          className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground justify-start"
                        >
                          {skill}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </div>
                </div>
              )}

              {/* Step 4: Review & Submit */}
              {currentStep === 4 && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-primary" />
                    Review Your Information
                  </h3>

                  <div className="space-y-6 bg-muted/50 p-6 rounded-lg">
                    <div>
                      <h4 className="font-semibold text-foreground mb-2">Personal Information</h4>
                      <div className="space-y-1 text-sm text-muted-foreground">
                        <p><span className="font-medium">Name:</span> {formData.firstName} {formData.lastName}</p>
                        <p><span className="font-medium">Email:</span> {formData.email}</p>
                        <p><span className="font-medium">Phone:</span> {formData.phone}</p>
                        {avatarPreview && <p className="font-medium">✓ Profile photo uploaded</p>}
                      </div>
                    </div>

                    <div>
                      <h4 className="font-semibold text-foreground mb-2">Location & Travel</h4>
                      <div className="space-y-1 text-sm text-muted-foreground">
                        <p><span className="font-medium">State:</span> {formData.state}</p>
                        <p><span className="font-medium">ZIP Code:</span> {formData.homeZip}</p>
                        <p><span className="font-medium">Max Travel:</span> {formData.maxTravelMiles} miles</p>
                      </div>
                    </div>

                    <div>
                      <h4 className="font-semibold text-foreground mb-2">Work Preferences</h4>
                      <div className="space-y-2 text-sm text-muted-foreground">
                        <div>
                          <span className="font-medium">Preferred Days:</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {formData.preferredWorkDays.map((day) => (
                              <span key={day} className="bg-primary/10 text-primary px-2 py-1 rounded text-xs">
                                {day}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div>
                          <span className="font-medium">Skills:</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {formData.skillset.map((skill) => (
                              <span key={skill} className="bg-primary/10 text-primary px-2 py-1 rounded text-xs">
                                {skill}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Navigation Buttons */}
              <div className="flex justify-between gap-4 pt-4">
                {currentStep > 1 && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleBack}
                    disabled={isLoading}
                  >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back
                  </Button>
                )}
                
                {currentStep < 4 ? (
                  <Button
                    type="button"
                    onClick={handleNext}
                    className="ml-auto"
                  >
                    Next
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                ) : (
                  <Button 
                    type="submit" 
                    className="ml-auto" 
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Creating Profile...
                      </>
                    ) : (
                      <>
                        Complete Onboarding
                        <CheckCircle2 className="ml-2 h-4 w-4" />
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
