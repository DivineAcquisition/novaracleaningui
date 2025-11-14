import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Loader2, MapPin } from "lucide-react";
import { validatePhone, validateEmail, validateName } from "@/lib/form-validation";

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

export default function CleanerOnboarding() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [userId, setUserId] = useState<string | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
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

  // Check authentication and existing profile
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError || !session) {
          toast({
            title: "Authentication Required",
            description: "Please sign in to complete your profile.",
            variant: "destructive",
          });
          navigate("/cleaner/auth");
          return;
        }

        setUserId(session.user.id);

        // Check if cleaner profile already exists
        const { data: existingCleaner, error: checkError } = await supabase
          .from("cleaners")
          .select("id, onboarding_complete")
          .eq("user_id", session.user.id)
          .maybeSingle();

        if (checkError) {
          console.error("Error checking cleaner profile:", checkError);
        }

        if (existingCleaner) {
          if (existingCleaner.onboarding_complete) {
            // Already completed onboarding, redirect to dashboard
            navigate("/cleaner/dashboard");
            return;
          }
        }

        setCheckingAuth(false);
      } catch (error) {
        console.error("Auth check error:", error);
        navigate("/cleaner/auth");
      }
    };

    checkAuth();
  }, [navigate, toast]);

  const handleDayToggle = (day: string) => {
    setFormData(prev => ({
      ...prev,
      preferredWorkDays: prev.preferredWorkDays.includes(day)
        ? prev.preferredWorkDays.filter(d => d !== day)
        : [...prev.preferredWorkDays, day]
    }));
  };

  const handleSkillToggle = (skill: string) => {
    setFormData(prev => ({
      ...prev,
      skillset: prev.skillset.includes(skill)
        ? prev.skillset.filter(s => s !== skill)
        : [...prev.skillset, skill]
    }));
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        toast({ title: "Error", description: "Please upload an image file", variant: "destructive" });
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        toast({ title: "Error", description: "Image must be less than 5MB", variant: "destructive" });
        return;
      }
      setFormData(prev => ({ ...prev, avatarFile: file }));
      setAvatarPreview(URL.createObjectURL(file));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!userId) {
      toast({
        title: "Authentication Error",
        description: "Please sign in again to continue.",
        variant: "destructive",
      });
      navigate("/cleaner/auth");
      return;
    }
    
    // Validate all fields
    const nameValidation = validateName(formData.firstName, "First name");
    if (!nameValidation.isValid) {
      toast({ title: "Error", description: nameValidation.error, variant: "destructive" });
      return;
    }

    const lastNameValidation = validateName(formData.lastName, "Last name");
    if (!lastNameValidation.isValid) {
      toast({ title: "Error", description: lastNameValidation.error, variant: "destructive" });
      return;
    }

    const emailValidation = validateEmail(formData.email);
    if (!emailValidation.isValid) {
      toast({ title: "Error", description: emailValidation.error, variant: "destructive" });
      return;
    }

    const phoneValidation = validatePhone(formData.phone);
    if (!phoneValidation.isValid) {
      toast({ title: "Error", description: phoneValidation.error, variant: "destructive" });
      return;
    }

    if (!formData.state) {
      toast({ title: "Error", description: "Please select a state", variant: "destructive" });
      return;
    }

    if (formData.preferredWorkDays.length === 0) {
      toast({
        title: "Error",
        description: "Please select at least one preferred work day",
        variant: "destructive"
      });
      return;
    }

    if (formData.skillset.length === 0) {
      toast({
        title: "Error",
        description: "Please select at least one skill or specialty",
        variant: "destructive"
      });
      return;
    }

    setIsLoading(true);

    try {
      // Upload avatar if provided
      let avatarUrl = null;
      if (formData.avatarFile) {
        const fileExt = formData.avatarFile.name.split('.').pop();
        const fileName = `${crypto.randomUUID()}.${fileExt}`;
        
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('cleaner-avatars')
          .upload(fileName, formData.avatarFile, {
            contentType: formData.avatarFile.type,
            upsert: false
          });

        if (uploadError) {
          toast({ title: "Error", description: "Failed to upload profile photo", variant: "destructive" });
          throw uploadError;
        }

        const { data: { publicUrl } } = supabase.storage
          .from('cleaner-avatars')
          .getPublicUrl(fileName);
        
        avatarUrl = publicUrl;
      }

      // Geocode home address
      const { data: geoData, error: geoError } = await supabase.functions.invoke("geocode-address", {
        body: {
          zip: formData.homeZip,
          state: formData.state
        }
      });

      if (geoError) throw geoError;

      // Insert cleaner record with user_id
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
          home_lat: geoData.lat,
          home_lng: geoData.lng,
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
        // Check if it's a unique constraint violation
        if (insertError.code === '23505') {
          toast({
            title: "Profile Already Exists",
            description: "You already have a cleaner profile. Redirecting to dashboard...",
          });
          navigate("/cleaner/dashboard");
          return;
        }
        throw insertError;
      }

      // Trigger Stripe Connect onboarding
      try {
        const { data: onboardingData, error: onboardingError } = await supabase.functions.invoke(
          "onboard-cleaner",
          { body: { cleanerId: cleanerData.id } }
        );

        if (onboardingError) {
          console.error("Failed to start Stripe onboarding:", onboardingError);
          toast({
            title: "Profile Created",
            description: "Please contact admin to complete payment setup.",
          });
          navigate("/cleaner/dashboard");
          return;
        }
        
        if (onboardingData?.url) {
          toast({
            title: "Profile Created!",
            description: "Redirecting to payment setup...",
          });
          setTimeout(() => {
            window.location.href = onboardingData.url;
          }, 1500);
          return;
        }
      } catch (onboardingError) {
        console.error("Stripe onboarding error:", onboardingError);
      }

      toast({
        title: "Profile Created!",
        description: "Your cleaner profile has been successfully created.",
      });

      navigate("/cleaner/dashboard");

    } catch (error: any) {
      console.error("Onboarding error:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to complete onboarding",
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

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-2xl mx-auto pt-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Cleaner Onboarding</CardTitle>
            <CardDescription>
              Complete your profile to start receiving job assignments
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Personal Information */}
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
                    required
                    value={formData.email}
                    onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                  />
                </div>

                <div>
                  <Label htmlFor="phone">Phone *</Label>
                  <Input
                    id="phone"
                    type="tel"
                    required
                    value={formData.phone}
                    onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                  />
                </div>

                {/* Profile Photo */}
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

              {/* Location Information */}
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
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="maxTravelMiles">
                    Max Travel Distance (miles) *
                  </Label>
                  <Input
                    id="maxTravelMiles"
                    type="number"
                    required
                    min={1}
                    max={100}
                    value={formData.maxTravelMiles}
                    onChange={(e) => setFormData(prev => ({ ...prev, maxTravelMiles: parseInt(e.target.value) }))}
                  />
                </div>
              </div>

              {/* Work Preferences */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Work Preferences</h3>
                
                <div>
                  <Label>Preferred Work Days *</Label>
                  <div className="grid grid-cols-4 gap-3 mt-2">
                    {DAYS_OF_WEEK.map(day => (
                      <div key={day} className="flex items-center space-x-2">
                        <Checkbox
                          id={day}
                          checked={formData.preferredWorkDays.includes(day)}
                          onCheckedChange={() => handleDayToggle(day)}
                        />
                        <label
                          htmlFor={day}
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                        >
                          {day}
                        </label>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-sm font-medium">Pay Rate</p>
                  <p className="text-2xl font-bold text-primary">$18.00/hour</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Standard hourly rate for all cleaners
                  </p>
                </div>

                {/* Skills & Specialties */}
                <div className="space-y-4">
                  <Label>Your Skills & Specialties *</Label>
                  <p className="text-sm text-muted-foreground">
                    Select all services you're comfortable providing (select at least one)
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {SKILLSET_OPTIONS.map((skill) => (
                      <div key={skill} className="flex items-center space-x-2">
                        <Checkbox
                          id={skill}
                          checked={formData.skillset.includes(skill)}
                          onCheckedChange={() => handleSkillToggle(skill)}
                        />
                        <Label htmlFor={skill} className="font-normal cursor-pointer">
                          {skill}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating Profile...
                  </>
                ) : (
                  "Complete Onboarding"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
