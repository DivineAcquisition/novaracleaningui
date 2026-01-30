import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "@/hooks/use-toast";
import { Loader2, Camera, ArrowLeft, Save, Mail, Phone, User, AlertCircle, X, MessageSquare, Bell, CheckCircle2, ShieldCheck } from "lucide-react";
import { processAvatarImage } from "@/lib/image-compression";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

interface CleanerProfile {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  avatar_url: string | null;
  available_for_bookings: boolean;
  max_weekly_bookings: number;
  sms_notifications_enabled: boolean | null;
  sms_quiet_hours_start: string | null;
  sms_quiet_hours_end: string | null;
  phone_verified?: boolean;
  phone_verified_at?: string | null;
}

export default function CleanerProfile() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [profile, setProfile] = useState<CleanerProfile | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  
  // Phone verification state
  const [showVerification, setShowVerification] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [codeSentAt, setCodeSentAt] = useState<Date | null>(null);

  useEffect(() => {
    if (!user) {
      navigate("/cleaner/auth");
      return;
    }
    fetchProfile();
  }, [user, navigate]);

  const fetchProfile = async () => {
    try {
      const { data, error } = await supabase
        .from("cleaners")
        .select("*")
        .eq("user_id", user?.id)
        .single();

      if (error) throw error;
      setProfile(data);
    } catch (error: any) {
      toast({
        title: "Error loading profile",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      // Validate and compress image
      const { file: processedFile, preview } = await processAvatarImage(file);
      
      setSelectedFile(processedFile);
      setAvatarPreview(preview);
      
      toast({
        title: "Photo selected",
        description: "Click 'Upload Photo' to save your new profile picture.",
      });
    } catch (error: any) {
      toast({
        title: "Image processing failed",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleAvatarUpload = async () => {
    if (!selectedFile || !user || !profile) return;

    try {
      setUploading(true);

      // Delete old avatar if exists
      if (profile.avatar_url) {
        const oldPath = profile.avatar_url.split('/').pop();
        if (oldPath) {
          await supabase.storage
            .from('cleaner-avatars')
            .remove([`${user.id}/${oldPath}`]);
        }
      }

      // Upload new avatar
      const fileExt = selectedFile.name.split('.').pop();
      const fileName = `${Date.now()}.${fileExt}`;
      const filePath = `${user.id}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('cleaner-avatars')
        .upload(filePath, selectedFile);

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('cleaner-avatars')
        .getPublicUrl(filePath);

      // Update database
      const { error: updateError } = await supabase
        .from('cleaners')
        .update({ avatar_url: publicUrl })
        .eq('id', profile.id);

      if (updateError) throw updateError;

      setProfile({ ...profile, avatar_url: publicUrl });
      setAvatarPreview("");
      setSelectedFile(null);
      
      toast({
        title: "Avatar updated",
        description: "Your profile photo has been updated successfully.",
      });
    } catch (error: any) {
      toast({
        title: "Upload failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleCancelUpload = () => {
    setAvatarPreview("");
    setSelectedFile(null);
  };

  const handleSaveProfile = async () => {
    if (!profile) return;

    try {
      setSaving(true);

      const { error } = await supabase
        .from('cleaners')
        .update({
          first_name: profile.first_name,
          last_name: profile.last_name,
          phone: profile.phone,
          available_for_bookings: profile.available_for_bookings,
          max_weekly_bookings: profile.max_weekly_bookings,
        })
        .eq('id', profile.id);

      if (error) throw error;

      toast({
        title: "Profile updated",
        description: "Your profile has been saved successfully.",
      });
    } catch (error: any) {
      toast({
        title: "Save failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  // Send phone verification code
  const handleSendVerificationCode = async () => {
    if (!profile?.phone) {
      toast({
        title: "Phone required",
        description: "Please enter your phone number first.",
        variant: "destructive",
      });
      return;
    }

    try {
      setSendingCode(true);

      const { error } = await supabase.functions.invoke('send-contractor-verification-sms', {
        body: {
          phone: profile.phone,
          cleanerId: profile.id,
          firstName: profile.first_name
        }
      });

      if (error) throw error;

      setShowVerification(true);
      setCodeSentAt(new Date());
      toast({
        title: "Code sent!",
        description: `A verification code has been sent to ${profile.phone}`,
      });
    } catch (error: any) {
      toast({
        title: "Failed to send code",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSendingCode(false);
    }
  };

  // Verify the code
  const handleVerifyCode = async () => {
    if (verificationCode.length !== 6) {
      toast({
        title: "Invalid code",
        description: "Please enter the 6-digit code.",
        variant: "destructive",
      });
      return;
    }

    try {
      setVerifyingCode(true);

      const { data, error } = await supabase.functions.invoke('verify-contractor-phone', {
        body: {
          phone: profile?.phone,
          code: verificationCode,
          cleanerId: profile?.id
        }
      });

      if (error) throw error;

      // Update local state
      if (profile) {
        setProfile({ 
          ...profile, 
          phone_verified: true, 
          phone_verified_at: new Date().toISOString(),
          sms_notifications_enabled: true
        });
      }

      setShowVerification(false);
      setVerificationCode("");

      toast({
        title: "Phone verified! ✓",
        description: "You'll now receive job offers via SMS.",
      });
    } catch (error: any) {
      toast({
        title: "Verification failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setVerifyingCode(false);
    }
  };

  // Check if can resend code (1 minute cooldown)
  const canResendCode = !codeSentAt || (new Date().getTime() - codeSentAt.getTime()) > 60000;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Profile not found</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-secondary/5 py-8 px-4">
      <div className="container max-w-2xl mx-auto">
        <Button
          variant="ghost"
          onClick={() => navigate("/cleaner/dashboard")}
          className="mb-6"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Dashboard
        </Button>

        <Card>
          <CardHeader>
            <CardTitle>Profile Settings</CardTitle>
            <CardDescription>
              Manage your profile information and availability
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Professional Photo Warning */}
            {!profile.avatar_url && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <strong>Professional photo required!</strong> You must upload a clear face photo to receive job assignments. 
                  This helps customers recognize you. A selfie is acceptable as long as your face is clearly visible.
                </AlertDescription>
              </Alert>
            )}

            {/* Avatar Section */}
            <div className="flex flex-col items-center space-y-4">
              <div className="relative">
                <Avatar className="w-32 h-32 border-2 border-border">
                  <AvatarImage src={avatarPreview || profile.avatar_url || undefined} />
                  <AvatarFallback className="text-2xl">
                    {profile.first_name[0]}{profile.last_name[0]}
                  </AvatarFallback>
                </Avatar>
                {avatarPreview && (
                  <Button
                    variant="destructive"
                    size="icon"
                    className="absolute -top-2 -right-2 h-8 w-8 rounded-full"
                    onClick={handleCancelUpload}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
              
              <div className="flex gap-2">
                <div>
                  <input
                    type="file"
                    id="avatar-upload"
                    accept="image/*"
                    className="hidden"
                    onChange={handleImageChange}
                    disabled={uploading}
                  />
                  <Button
                    variant="outline"
                    onClick={() => document.getElementById('avatar-upload')?.click()}
                    disabled={uploading}
                  >
                    <Camera className="mr-2 h-4 w-4" />
                    {avatarPreview ? "Choose Different" : "Choose Photo"}
                  </Button>
                </div>
                
                {avatarPreview && (
                  <Button
                    onClick={handleAvatarUpload}
                    disabled={uploading}
                  >
                    {uploading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    Upload Photo
                  </Button>
                )}
              </div>

              <p className="text-xs text-center text-muted-foreground max-w-md">
                Upload a clear, professional photo showing your face. This helps build trust with customers. 
                Even a selfie works as long as your face is visible and well-lit.
              </p>
            </div>

            {/* Contact Information */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Contact Information</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="firstName"
                      value={profile.first_name}
                      onChange={(e) => setProfile({ ...profile, first_name: e.target.value })}
                      className="pl-10"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="lastName"
                      value={profile.last_name}
                      onChange={(e) => setProfile({ ...profile, last_name: e.target.value })}
                      className="pl-10"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="email"
                    value={profile.email}
                    disabled
                    className="pl-10 bg-muted"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Email cannot be changed. Contact admin if needed.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="phone"
                    type="tel"
                    value={profile.phone}
                    onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                    className="pl-10"
                  />
                </div>
              </div>

              {/* Phone Verification Section */}
              <div className="p-4 border rounded-lg bg-muted/30 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className={`h-5 w-5 ${profile.phone_verified ? 'text-green-600' : 'text-yellow-600'}`} />
                    <div>
                      <p className="font-medium">Phone Verification</p>
                      <p className="text-sm text-muted-foreground">
                        {profile.phone_verified 
                          ? `Verified on ${new Date(profile.phone_verified_at!).toLocaleDateString()}`
                          : 'Verify your phone to receive SMS job offers'
                        }
                      </p>
                    </div>
                  </div>
                  {profile.phone_verified ? (
                    <div className="flex items-center gap-1 text-green-600 bg-green-100 px-3 py-1 rounded-full">
                      <CheckCircle2 className="h-4 w-4" />
                      <span className="text-sm font-medium">Verified</span>
                    </div>
                  ) : (
                    <Button
                      onClick={handleSendVerificationCode}
                      disabled={sendingCode || !profile.phone}
                      size="sm"
                    >
                      {sendingCode ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Sending...
                        </>
                      ) : (
                        'Verify Phone'
                      )}
                    </Button>
                  )}
                </div>

                {/* Verification Code Input */}
                {showVerification && !profile.phone_verified && (
                  <div className="pt-4 border-t space-y-4">
                    <div className="text-center">
                      <p className="text-sm text-muted-foreground mb-4">
                        Enter the 6-digit code sent to <strong>{profile.phone}</strong>
                      </p>
                      <div className="flex justify-center mb-4">
                        <InputOTP
                          maxLength={6}
                          value={verificationCode}
                          onChange={(value) => setVerificationCode(value)}
                        >
                          <InputOTPGroup>
                            <InputOTPSlot index={0} />
                            <InputOTPSlot index={1} />
                            <InputOTPSlot index={2} />
                            <InputOTPSlot index={3} />
                            <InputOTPSlot index={4} />
                            <InputOTPSlot index={5} />
                          </InputOTPGroup>
                        </InputOTP>
                      </div>
                      <div className="flex justify-center gap-2">
                        <Button
                          onClick={handleVerifyCode}
                          disabled={verifyingCode || verificationCode.length !== 6}
                        >
                          {verifyingCode ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Verifying...
                            </>
                          ) : (
                            'Verify Code'
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={handleSendVerificationCode}
                          disabled={sendingCode || !canResendCode}
                        >
                          Resend Code
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        Code expires in 10 minutes
                      </p>
                    </div>
                  </div>
                )}

                {!profile.phone_verified && (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      <strong>Why verify?</strong> Phone verification is required to receive job offers via SMS. 
                      You'll be able to accept or decline jobs by simply replying to text messages.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </div>

            {/* Availability Settings */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Availability</h3>
              
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="space-y-1">
                  <Label htmlFor="available">Available for Bookings</Label>
                  <p className="text-sm text-muted-foreground">
                    Turn off to temporarily stop receiving new bookings
                  </p>
                </div>
                <Switch
                  id="available"
                  checked={profile.available_for_bookings}
                  onCheckedChange={(checked) =>
                    setProfile({ ...profile, available_for_bookings: checked })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="maxBookings">Max Weekly Bookings</Label>
                <Input
                  id="maxBookings"
                  type="number"
                  min="1"
                  max="50"
                  value={profile.max_weekly_bookings}
                  onChange={(e) =>
                    setProfile({ ...profile, max_weekly_bookings: parseInt(e.target.value) })
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Maximum number of bookings you can accept per week
                </p>
              </div>
            </div>

            {/* SMS Notification Settings */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <MessageSquare className="h-5 w-5 text-primary" />
                  SMS Notifications
                </h3>
                <Link to="/sms-consent">
                  <Button variant="outline" size="sm">
                    <Bell className="mr-2 h-4 w-4" />
                    Manage Consent
                  </Button>
                </Link>
              </div>
              
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="space-y-1">
                  <Label htmlFor="smsEnabled">SMS Notifications</Label>
                  <p className="text-sm text-muted-foreground">
                    {profile.sms_notifications_enabled 
                      ? "You'll receive SMS updates for jobs and bookings" 
                      : "SMS notifications are currently disabled"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {profile.sms_notifications_enabled ? (
                    <span className="text-success text-sm font-medium">Enabled</span>
                  ) : (
                    <span className="text-muted-foreground text-sm">Disabled</span>
                  )}
                </div>
              </div>

              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  To change your SMS preferences or view consent details, visit the{" "}
                  <Link to="/sms-consent" className="text-primary hover:underline font-medium">
                    SMS Consent page
                  </Link>
                  . Reply STOP to any message to opt out.
                </AlertDescription>
              </Alert>
            </div>

            {/* Save Button */}
            <Button
              onClick={handleSaveProfile}
              disabled={saving}
              className="w-full"
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save Changes
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
