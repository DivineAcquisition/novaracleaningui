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
import { Loader2, Camera, ArrowLeft, Save, Mail, Phone, User, AlertCircle, X, MessageSquare, Bell, CreditCard, ExternalLink, CheckCircle2, LogOut } from "lucide-react";
import { processAvatarImage } from "@/lib/image-compression";

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
  stripe_account_id: string | null;
  payouts_enabled: boolean | null;
}

export default function CleanerProfile() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [stripeLoading, setStripeLoading] = useState(false);
  const [profile, setProfile] = useState<CleanerProfile | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  useEffect(() => {
    if (!user) {
      navigate("/cleaner/auth");
      return;
    }
    fetchProfile();
    
    // Check for Stripe return
    const params = new URLSearchParams(window.location.search);
    if (params.get('stripe') === 'complete') {
      checkStripeStatus();
      window.history.replaceState({}, '', '/cleaner/profile');
    }
  }, [user, navigate]);

  const checkStripeStatus = async () => {
    if (!profile?.id) return;
    try {
      const { data, error } = await supabase.functions.invoke('check-cleaner-status', {
        body: { cleanerId: profile.id }
      });
      if (!error && data?.success) {
        toast({
          title: "Stripe Connected!",
          description: "Your payment setup is complete.",
        });
        fetchProfile();
      }
    } catch (error) {
      console.error('Error checking Stripe status:', error);
    }
  };

  const handleStripeConnect = async () => {
    setStripeLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('initiate-cleaner-stripe-connect');
      if (error) throw error;
      if (data?.url) {
        window.location.href = data.url;
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to start Stripe setup",
        variant: "destructive",
      });
    } finally {
      setStripeLoading(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/cleaner/auth");
  };

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
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-secondary/5 py-4 px-3 sm:py-8 sm:px-4">
      <div className="container max-w-lg mx-auto">
        <Button
          variant="ghost"
          onClick={() => navigate("/cleaner/dashboard")}
          className="mb-4 h-9"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>

        <Card className="shadow-lg">
          <CardHeader className="pb-3 pt-4 px-4 sm:px-6">
            <CardTitle className="text-lg sm:text-xl">Profile Settings</CardTitle>
            <CardDescription className="text-sm">
              Manage your account
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 sm:space-y-5 px-4 sm:px-6 pb-4">
            {/* Professional Photo Warning */}
            {!profile.avatar_url && (
              <Alert variant="destructive" className="text-xs">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <strong>Photo required!</strong> Upload a clear face photo to receive job assignments.
                </AlertDescription>
              </Alert>
            )}

            {/* Avatar Section */}
            <div className="flex flex-col items-center space-y-3">
              <div className="relative">
                <Avatar className="w-20 h-20 sm:w-24 sm:h-24 border-2 border-border">
                  <AvatarImage src={avatarPreview || profile.avatar_url || undefined} />
                  <AvatarFallback className="text-lg">
                    {profile.first_name[0]}{profile.last_name[0]}
                  </AvatarFallback>
                </Avatar>
                {avatarPreview && (
                  <Button
                    variant="destructive"
                    size="icon"
                    className="absolute -top-1 -right-1 h-6 w-6 rounded-full"
                    onClick={handleCancelUpload}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
              
              <div className="flex gap-2">
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
                  size="sm"
                  onClick={() => document.getElementById('avatar-upload')?.click()}
                  disabled={uploading}
                  className="h-9"
                >
                  <Camera className="mr-1.5 h-4 w-4" />
                  {avatarPreview ? "Change" : "Choose"}
                </Button>
                
                {avatarPreview && (
                  <Button
                    size="sm"
                    onClick={handleAvatarUpload}
                    disabled={uploading}
                    className="h-9"
                  >
                    {uploading ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-1.5 h-4 w-4" />
                    )}
                    Upload
                  </Button>
                )}
              </div>
            </div>

            {/* Stripe Connect Section */}
            <div className="space-y-3 p-3 border rounded-lg bg-muted/30">
              <div className="flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">Payment Setup</h3>
              </div>
              
              {profile.stripe_account_id && profile.payouts_enabled ? (
                <div className="flex items-center gap-2 text-sm text-green-600">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Stripe Connected - Ready to receive payments</span>
                </div>
              ) : profile.stripe_account_id ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Stripe setup incomplete. Complete setup to receive payments.
                  </p>
                  <Button
                    size="sm"
                    onClick={handleStripeConnect}
                    disabled={stripeLoading}
                    className="h-9"
                  >
                    {stripeLoading ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <ExternalLink className="mr-1.5 h-4 w-4" />
                    )}
                    Complete Setup
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Connect Stripe to receive payments for completed jobs.
                  </p>
                  <Button
                    size="sm"
                    onClick={handleStripeConnect}
                    disabled={stripeLoading}
                    className="h-9"
                  >
                    {stripeLoading ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <ExternalLink className="mr-1.5 h-4 w-4" />
                    )}
                    Setup Stripe
                  </Button>
                </div>
              )}
            </div>

            {/* Contact Information */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Contact Info</h3>
              
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="firstName" className="text-xs">First Name</Label>
                  <Input
                    id="firstName"
                    value={profile.first_name}
                    onChange={(e) => setProfile({ ...profile, first_name: e.target.value })}
                    className="h-10 text-sm"
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="lastName" className="text-xs">Last Name</Label>
                  <Input
                    id="lastName"
                    value={profile.last_name}
                    onChange={(e) => setProfile({ ...profile, last_name: e.target.value })}
                    className="h-10 text-sm"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="email" className="text-xs">Email</Label>
                <Input
                  id="email"
                  value={profile.email}
                  disabled
                  className="h-10 text-sm bg-muted"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="phone" className="text-xs">Phone</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={profile.phone}
                  onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                  className="h-10 text-sm"
                />
              </div>
            </div>

            {/* Availability Settings */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Availability</h3>
              
              <div className="flex items-center justify-between p-3 border rounded-lg">
                <div className="space-y-0.5">
                  <Label htmlFor="available" className="text-sm">Available for Jobs</Label>
                  <p className="text-xs text-muted-foreground">
                    Turn off to pause receiving offers
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

              <div className="space-y-1">
                <Label htmlFor="maxBookings" className="text-xs">Max Weekly Bookings</Label>
                <Input
                  id="maxBookings"
                  type="number"
                  min="1"
                  max="50"
                  value={profile.max_weekly_bookings}
                  onChange={(e) =>
                    setProfile({ ...profile, max_weekly_bookings: parseInt(e.target.value) })
                  }
                  className="h-10 text-sm"
                />
              </div>
            </div>

            {/* SMS Notification Settings */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold flex items-center gap-1.5">
                  <MessageSquare className="h-4 w-4 text-primary" />
                  SMS Notifications
                </h3>
                <Link to="/sms-consent">
                  <Button variant="ghost" size="sm" className="h-8 text-xs">
                    <Bell className="mr-1 h-3 w-3" />
                    Manage
                  </Button>
                </Link>
              </div>
              
              <div className="flex items-center justify-between p-3 border rounded-lg">
                <span className="text-sm">SMS Status</span>
                {profile.sms_notifications_enabled ? (
                  <span className="text-green-600 text-sm font-medium">Enabled</span>
                ) : (
                  <span className="text-muted-foreground text-sm">Disabled</span>
                )}
              </div>
            </div>

            {/* Save Button */}
            <Button
              onClick={handleSaveProfile}
              disabled={saving}
              className="w-full h-10"
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

            {/* Sign Out */}
            <Button
              variant="outline"
              onClick={handleSignOut}
              className="w-full h-10"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
