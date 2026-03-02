import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Calendar, MapPin, Upload, CheckCircle2, Loader2 } from "lucide-react";
import { processAvatarImage } from "@/lib/image-compression";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";

const DAYS_OF_WEEK = [
  { value: "Mon", label: "Monday" },
  { value: "Tue", label: "Tuesday" },
  { value: "Wed", label: "Wednesday" },
  { value: "Thu", label: "Thursday" },
  { value: "Fri", label: "Friday" },
  { value: "Sat", label: "Saturday" },
  { value: "Sun", label: "Sunday" },
];

interface ProfileCompletionWizardProps {
  open: boolean;
  cleaner: any;
  onComplete: () => void;
}

export function ProfileCompletionWizard({ open, cleaner, onComplete }: ProfileCompletionWizardProps) {
  const [step, setStep] = useState(1);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // Step 1: Availability
  const [statusToday, setStatusToday] = useState<string>("available");
  const [preferredDays, setPreferredDays] = useState<string[]>([]);
  const [availableForBookings, setAvailableForBookings] = useState(true);

  // Step 2: Service Areas
  const [serviceZipCodes, setServiceZipCodes] = useState<string>("");

  // Step 3: Profile Photo
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(cleaner?.avatar_url || null);

  const totalSteps = 3;
  const progress = (step / totalSteps) * 100;

  const handleDayToggle = (day: string) => {
    setPreferredDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const { file: processedFile, preview } = await processAvatarImage(file);
      setAvatarFile(processedFile);
      setAvatarPreview(preview);
    } catch (error: any) {
      toast.error(error.message || "Failed to process image");
    }
  };

  const saveStep1 = async () => {
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from("cleaners")
        .update({
          status_today: statusToday,
          preferred_work_days: preferredDays,
          available_for_bookings: availableForBookings,
          updated_at: new Date().toISOString(),
        })
        .eq("id", cleaner.id);

      if (error) throw error;
      setStep(2);
    } catch (error) {
      console.error("Error saving availability:", error);
      toast.error("Failed to save availability");
    } finally {
      setIsSaving(false);
    }
  };

  const saveStep2 = async () => {
    setIsSaving(true);
    try {
      // Parse ZIP codes from comma-separated input
      const zipCodes = serviceZipCodes
        .split(",")
        .map((zip) => zip.trim())
        .filter((zip) => zip.length === 5 && /^\d+$/.test(zip));

      if (zipCodes.length === 0) {
        toast.error("Please enter at least one valid 5-digit ZIP code");
        setIsSaving(false);
        return;
      }

      const { error } = await supabase
        .from("cleaners")
        .update({
          service_zip_codes: zipCodes,
          updated_at: new Date().toISOString(),
        })
        .eq("id", cleaner.id);

      if (error) throw error;
      setStep(3);
    } catch (error) {
      console.error("Error saving service areas:", error);
      toast.error("Failed to save service areas");
    } finally {
      setIsSaving(false);
    }
  };

  const saveStep3 = async () => {
    setIsSaving(true);
    setIsUploading(true);
    try {
      let avatarUrl = cleaner.avatar_url;

      // Upload avatar if changed
      if (avatarFile) {
        const fileExt = avatarFile.name.split(".").pop();
        const fileName = `${cleaner.id}-${Date.now()}.${fileExt}`;
        const filePath = `avatars/${fileName}`;

        // Delete old avatar if exists
        if (cleaner.avatar_url) {
          const oldPath = cleaner.avatar_url.split("/").pop();
          if (oldPath) {
            await supabase.storage.from("cleaner-avatars").remove([`avatars/${oldPath}`]);
          }
        }

        // Upload new avatar
        const { error: uploadError } = await supabase.storage
          .from("cleaner-avatars")
          .upload(filePath, avatarFile, { upsert: true });

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage.from("cleaner-avatars").getPublicUrl(filePath);
        avatarUrl = urlData.publicUrl;
      }

      // Mark onboarding as complete
      const { error } = await supabase
        .from("cleaners")
        .update({
          avatar_url: avatarUrl,
          onboarding_complete: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", cleaner.id);

      if (error) throw error;

      toast.success("Profile setup complete! Welcome to the team.");
      onComplete();
    } catch (error) {
      console.error("Error completing profile:", error);
      toast.error("Failed to complete profile setup");
    } finally {
      setIsSaving(false);
      setIsUploading(false);
    }
  };

  const handleNext = () => {
    if (step === 1) {
      if (preferredDays.length === 0) {
        toast.error("Please select at least one preferred work day");
        return;
      }
      saveStep1();
    } else if (step === 2) {
      saveStep2();
    } else if (step === 3) {
      saveStep3();
    }
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

  const canSkipStep3 = !!cleaner?.avatar_url;

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="text-2xl">Complete Your Profile</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Let's get you set up to start receiving job offers
          </p>
        </DialogHeader>

        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>Step {step} of {totalSteps}</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        {/* Step Content */}
        <div className="py-4">
          {/* Step 1: Availability */}
          {step === 1 && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 pb-4 border-b">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <Calendar className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold">Set Your Availability</h3>
                  <p className="text-sm text-muted-foreground">
                    Choose your preferred work schedule
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <Label className="text-base font-medium mb-3 block">Today's Status</Label>
                  <RadioGroup value={statusToday} onValueChange={setStatusToday}>
                    <div className="flex items-center space-x-2 p-3 rounded-lg border">
                      <RadioGroupItem value="available" id="av1" />
                      <Label htmlFor="av1" className="cursor-pointer flex-1 font-normal">
                        Available - Ready to accept job offers
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2 p-3 rounded-lg border">
                      <RadioGroupItem value="unavailable" id="av2" />
                      <Label htmlFor="av2" className="cursor-pointer flex-1 font-normal">
                        Unavailable - Not available for work today
                      </Label>
                    </div>
                  </RadioGroup>
                </div>

                <div>
                  <Label className="text-base font-medium mb-3 block">Preferred Work Days *</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {DAYS_OF_WEEK.map((day) => (
                      <div
                        key={day.value}
                        className="flex items-center space-x-2 p-3 rounded-lg border hover:bg-accent transition-colors"
                      >
                        <Checkbox
                          id={`day-${day.value}`}
                          checked={preferredDays.includes(day.value)}
                          onCheckedChange={() => handleDayToggle(day.value)}
                        />
                        <Label
                          htmlFor={`day-${day.value}`}
                          className="cursor-pointer font-normal flex-1"
                        >
                          {day.label}
                        </Label>
                        {preferredDays.includes(day.value) && (
                          <CheckCircle2 className="w-4 h-4 text-primary" />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Service Areas */}
          {step === 2 && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 pb-4 border-b">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <MapPin className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold">Service Areas</h3>
                  <p className="text-sm text-muted-foreground">
                    Enter ZIP codes where you can work
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <Label htmlFor="zip-codes" className="text-base font-medium mb-2 block">
                    ZIP Codes *
                  </Label>
                  <Input
                    id="zip-codes"
                    placeholder="e.g., 10001, 10002, 10003"
                    value={serviceZipCodes}
                    onChange={(e) => setServiceZipCodes(e.target.value)}
                    className="text-base"
                  />
                  <p className="text-sm text-muted-foreground mt-2">
                    Enter multiple ZIP codes separated by commas. You'll receive job offers for bookings in these areas.
                  </p>
                </div>

                <Card className="bg-muted/50">
                  <CardContent className="pt-4">
                    <div className="flex gap-2 text-sm">
                      <div className="text-muted-foreground">💡</div>
                      <p className="text-muted-foreground">
                        Tip: Start with areas closest to your home to minimize travel time and maximize your earnings.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          {/* Step 3: Profile Photo */}
          {step === 3 && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 pb-4 border-b">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <Upload className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold">Profile Photo</h3>
                  <p className="text-sm text-muted-foreground">
                    Add a professional photo {canSkipStep3 && "(optional)"}
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex flex-col items-center gap-4">
                  <Avatar className="w-32 h-32">
                    <AvatarImage src={avatarPreview || undefined} />
                    <AvatarFallback className="text-3xl">
                      {cleaner?.first_name?.[0]}{cleaner?.last_name?.[0]}
                    </AvatarFallback>
                  </Avatar>

                  <div className="text-center">
                    <Label
                      htmlFor="avatar-upload"
                      className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 rounded-md border bg-background hover:bg-accent transition-colors"
                    >
                      <Upload className="w-4 h-4" />
                      {avatarPreview ? "Change Photo" : "Upload Photo"}
                    </Label>
                    <Input
                      id="avatar-upload"
                      type="file"
                      accept="image/*"
                      onChange={handleImageChange}
                      className="hidden"
                    />
                    <p className="text-sm text-muted-foreground mt-2">
                      JPG, PNG, or WEBP (max 2MB)
                    </p>
                  </div>
                </div>

                <Card className="bg-muted/50">
                  <CardContent className="pt-4">
                    <div className="flex gap-2 text-sm">
                      <div className="text-muted-foreground">💡</div>
                      <p className="text-muted-foreground">
                        A professional photo helps build trust with customers and can improve your booking rate.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </div>

        {/* Navigation Buttons */}
        <div className="flex gap-3 pt-4 border-t">
          {step > 1 && (
            <Button
              variant="outline"
              onClick={handleBack}
              disabled={isSaving}
              className="flex-1"
            >
              Back
            </Button>
          )}
          {step === 3 && canSkipStep3 && (
            <Button
              variant="outline"
              onClick={() => saveStep3()}
              disabled={isSaving}
              className="flex-1"
            >
              Skip
            </Button>
          )}
          <Button
            onClick={handleNext}
            disabled={isSaving}
            className="flex-1"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {isUploading ? "Uploading..." : "Saving..."}
              </>
            ) : step === totalSteps ? (
              <>
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Complete Setup
              </>
            ) : (
              "Continue"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
