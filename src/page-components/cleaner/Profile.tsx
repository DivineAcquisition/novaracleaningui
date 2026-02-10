"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Loader2, Camera, ArrowLeft, Save, Mail, Phone, User, AlertCircle, X, MessageSquare, Bell, CreditCard, ExternalLink, CheckCircle2 } from "lucide-react";
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
  const router = useRouter();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [profile, setProfile] = useState<CleanerProfile | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  useEffect(() => {
    if (!user) {
      router.push("/cleaner/auth");
      return;
    }
    fetchProfile();
  }, [user, router]);

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

  const [isInitiatingStripe, setIsInitiatingStripe] = useState(false);

  const handleStripeConnect = async () => {
    setIsInitiatingStripe(true);
    try {
      const { data, error } = await supabase.functions.invoke('initiate-cleaner-stripe-connect');

      if (error) throw error;

      if (data?.url) {
        window.location.href = data.url;
      }
    } catch (error: any) {
      toast({
        title: "Failed to connect Stripe",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsInitiatingStripe(false);
    }
  };

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Profile not found</p>
      </div>
    );
  }

  const stripeConnected = profile.stripe_account_id && profile.payouts_enabled;

  return (
    <div className="min-h-screen bg-background py-4 px-3 sm:py-6 sm:px-4">
      <div className="container max-w-lg mx-auto">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/cleaner/dashboard")}
          className="mb-3"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Dashboard
        </Button>

        <Card>
          <CardHeader className="pb-3 pt-4 px-4">
            <CardTitle className="text-lg">Profile Settings</CardTitle>
            <CardDescription className="text-sm">
              Manage your profile and availability
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 px-4 pb-4">
            {/* Professional Photo Warning */}
            {!profile.avatar_url && (
              <Alert variant="destructive" className="py-2">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  <strong>Photo required</strong> to receive job assignments.
                </AlertDescription>
              </Alert>
            )}

            {/* Avatar Section - Compact */}
            <div className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg">
              <div className="relative shrink-0">
                <Avatar className="w-16 h-16 border-2 border-border">
                  <AvatarImage src={avatarPreview || profile.avatar_url || undefined} />
                  <AvatarFallback className="text-lg">
                    {profile.first_name[0]}{profile.last_name[0]}
                  </AvatarFallback>
                </Avatar>
                {avatarPreview && (
                  <Button
                    variant="destructive"
                    size="icon"
                    className="absolute -top-1 -right-1 h-5 w-5 rounded-full"
                    onClick={handleCancelUpload}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
              
              <div className="flex-1 space-y-2">
                <input
                  type="file"
                  id="avatar-upload"
                  accept="image/*"
                  className="hidden"
                  onChange={handleImageChange}
                  disabled={uploading}
                />
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => document.getElementById('avatar-upload')?.click()}
                    disabled={uploading}
                  >
                    <Camera className="mr-1 h-3 w-3" />
                    {avatarPreview ? "Change" : "Photo"}
                  </Button>
                  
                  {avatarPreview && (
                    <Button
                      size="sm"
                      onClick={handleAvatarUpload}
                      disabled={uploading}
                    >
                      {uploading ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        "Upload"
                      )}
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Clear face photo for customers
                </p>
              </div>
            </div>

            {/* Stripe Connect Section */}
            <div className="p-3 border rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">Payout Account</span>
                </div>
                {stripeConnected ? (
                  <Badge variant="secondary" className="bg-green-100 text-green-700 text-xs">
                    <CheckCircle2 className="mr-1 h-3 w-3" />
                    Connected
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs">Not Set Up</Badge>
                )}
              </div>
              {!stripeConnected && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={handleStripeConnect}
                  disabled={isInitiatingStripe}
                >
                  {isInitiatingStripe ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ExternalLink className="mr-2 h-4 w-4" />
                  )}
                  Setup Stripe Payouts
                </Button>
              )}
              <p className="text-xs text-muted-foreground">
                {stripeConnected 
                  ? "You can receive payments for completed jobs"
                  : "Required to receive payments for jobs"
                }
              </p>
            </div>

            {/* Contact Information - Compact */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Contact Info</h3>
              
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="firstName" className="text-xs">First Name</Label>
                  <Input
                    id="firstName"
                    value={profile.first_name}
                    onChange={(e) => setProfile({ ...profile, first_name: e.target.value })}
                    className="h-9"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="lastName" className="text-xs">Last Name</Label>
                  <Input
                    id="lastName"
                    value={profile.last_name}
                    onChange={(e) => setProfile({ ...profile, last_name: e.target.value })}
                    className="h-9"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="email" className="text-xs">Email</Label>
                <Input
                  id="email"
                  value={profile.email}
                  disabled
                  className="h-9 bg-muted text-sm"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="phone" className="text-xs">Phone</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={profile.phone}
                  onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                  className="h-9"
                />
              </div>
            </div>

            {/* Availability Settings - Compact */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Availability</h3>
              
              <div className="flex items-center justify-between p-3 border rounded-lg">
                <div>
                  <Label htmlFor="available" className="text-sm">Available for Jobs</Label>
                  <p className="text-xs text-muted-foreground">
                    Toggle off to pause receiving offers
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
                <Label htmlFor="maxBookings" className="text-xs">Max Jobs/Week</Label>
                <Input
                  id="maxBookings"
                  type="number"
                  min="1"
                  max="50"
                  value={profile.max_weekly_bookings}
                  onChange={(e) =>
                    setProfile({ ...profile, max_weekly_bookings: parseInt(e.target.value) })
                  }
                  className="h-9"
                />
              </div>
            </div>

            {/* SMS Settings - Compact */}
            <div className="p-3 border rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">SMS Notifications</span>
                </div>
                {profile.sms_notifications_enabled ? (
                  <Badge variant="secondary" className="bg-green-100 text-green-700 text-xs">On</Badge>
                ) : (
                  <Badge variant="outline" className="text-xs">Off</Badge>
                )}
              </div>
              <Link href="/sms-consent">
                <Button variant="ghost" size="sm" className="w-full h-8 text-xs">
                  <Bell className="mr-1 h-3 w-3" />
                  Manage SMS Preferences
                </Button>
              </Link>
            </div>

            {/* Save Button */}
            <Button
              onClick={handleSaveProfile}
              disabled={saving}
              className="w-full"
              size="lg"
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
