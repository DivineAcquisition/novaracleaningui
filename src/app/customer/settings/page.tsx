"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import {
  User,
  Mail,
  Phone,
  Lock,
  Bell,
  Loader2,
  Save,
} from "lucide-react";
import { toast } from "sonner";

export default function SettingsPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    sms_consent: true,
    email_notifications: true,
    marketing_opt_in: false,
  });

  const [passwordData, setPasswordData] = useState({
    newPassword: "",
    confirmPassword: "",
  });

  useEffect(() => {
    const fetchProfile = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      
      setUser(session.user);

      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from("customers")
          .select("*")
          .eq("email", session.user.email)
          .maybeSingle();

        if (error && error.code !== "PGRST116") throw error;

        if (data) {
          setProfile({
            first_name: data.first_name || "",
            last_name: data.last_name || "",
            email: data.email || session.user.email,
            phone: data.phone || "",
            sms_consent: data.sms_consent ?? true,
            email_notifications: data.email_notifications ?? true,
            marketing_opt_in: data.marketing_opt_in ?? false,
          });
        } else {
          setProfile((prev) => ({
            ...prev,
            email: session.user.email || "",
            first_name: session.user.user_metadata?.first_name || "",
            last_name: session.user.user_metadata?.last_name || "",
          }));
        }
      } catch (error) {
        console.error("Error fetching profile:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchProfile();
  }, []);

  const handleSaveProfile = async () => {
    if (!user?.email) return;

    setIsSaving(true);
    try {
      const { error } = await supabase
        .from("customers")
        .upsert({
          email: user.email,
          first_name: profile.first_name,
          last_name: profile.last_name,
          phone: profile.phone,
          sms_consent: profile.sms_consent,
          email_notifications: profile.email_notifications,
          marketing_opt_in: profile.marketing_opt_in,
        }, { onConflict: "email" });

      if (error) throw error;
      toast.success("Profile updated successfully");
    } catch (error) {
      console.error("Error saving profile:", error);
      toast.error("Failed to update profile");
    } finally {
      setIsSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    if (passwordData.newPassword.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }

    setIsSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: passwordData.newPassword,
      });
      if (error) throw error;

      toast.success("Password updated successfully");
      setPasswordData({ newPassword: "", confirmPassword: "" });
    } catch (error) {
      console.error("Error changing password:", error);
      toast.error("Failed to change password");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">
          Manage your account preferences
        </p>
      </div>

      {/* Profile Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Profile Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firstName">First Name</Label>
              <Input
                id="firstName"
                value={profile.first_name}
                onChange={(e) => setProfile({ ...profile, first_name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last Name</Label>
              <Input
                id="lastName"
                value={profile.last_name}
                onChange={(e) => setProfile({ ...profile, last_name: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="email"
                type="email"
                value={profile.email}
                disabled
                className="pl-10 bg-muted"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Contact support to change your email address
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

          <Button onClick={handleSaveProfile} disabled={isSaving}>
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Save Changes
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Notifications Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Notifications
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Email Reminders</Label>
              <p className="text-sm text-muted-foreground">
                Receive booking reminders and updates via email
              </p>
            </div>
            <Switch
              checked={profile.email_notifications}
              onCheckedChange={(checked) =>
                setProfile({ ...profile, email_notifications: checked })
              }
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>SMS Notifications</Label>
              <p className="text-sm text-muted-foreground">
                Receive text message reminders
              </p>
            </div>
            <Switch
              checked={profile.sms_consent}
              onCheckedChange={(checked) =>
                setProfile({ ...profile, sms_consent: checked })
              }
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Marketing Communications</Label>
              <p className="text-sm text-muted-foreground">
                Receive promotions and special offers
              </p>
            </div>
            <Switch
              checked={profile.marketing_opt_in}
              onCheckedChange={(checked) =>
                setProfile({ ...profile, marketing_opt_in: checked })
              }
            />
          </div>

          <Button variant="outline" onClick={handleSaveProfile} disabled={isSaving}>
            Save Preferences
          </Button>
        </CardContent>
      </Card>

      {/* Password Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            Change Password
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="newPassword">New Password</Label>
            <Input
              id="newPassword"
              type="password"
              value={passwordData.newPassword}
              onChange={(e) =>
                setPasswordData({ ...passwordData, newPassword: e.target.value })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm Password</Label>
            <Input
              id="confirmPassword"
              type="password"
              value={passwordData.confirmPassword}
              onChange={(e) =>
                setPasswordData({ ...passwordData, confirmPassword: e.target.value })
              }
            />
          </div>

          <Button
            onClick={handleChangePassword}
            disabled={isSaving || !passwordData.newPassword}
          >
            Update Password
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
