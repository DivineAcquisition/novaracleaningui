"use client";

import {
  RiArrowLeftLine,
  RiCalendarLine,
  RiCheckboxCircleLine,
  RiLoader4Line
} from "@remixicon/react";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

import { Checkbox } from "@/components/ui/checkbox";

const DAYS_OF_WEEK = [
  { value: "Mon", label: "Monday" },
  { value: "Tue", label: "Tuesday" },
  { value: "Wed", label: "Wednesday" },
  { value: "Thu", label: "Thursday" },
  { value: "Fri", label: "Friday" },
  { value: "Sat", label: "Saturday" },
  { value: "Sun", label: "Sunday" },
];

export default function CleanerAvailability() {
  const router = useRouter();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [cleanerId, setCleanerId] = useState<string>("");
  const [statusToday, setStatusToday] = useState<string>("available");
  const [preferredDays, setPreferredDays] = useState<string[]>([]);
  const [availableForBookings, setAvailableForBookings] = useState(true);

  useEffect(() => {
    fetchCleanerData();
  }, []);

  const fetchCleanerData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/cleaner/auth");
        return;
      }

      const { data: cleanerData, error } = await supabase
        .from("cleaners")
        .select("id, status_today, preferred_work_days, available_for_bookings")
        .eq("user_id", user.id)
        .single();

      if (error || !cleanerData) {
        toast({
          title: "Error",
          description: "Failed to load cleaner profile",
          variant: "destructive",
        });
        router.replace("/cleaner/dashboard");
        return;
      }

      setCleanerId(cleanerData.id);
      setStatusToday(cleanerData.status_today || "available");
      setPreferredDays(cleanerData.preferred_work_days || []);
      setAvailableForBookings(cleanerData.available_for_bookings ?? true);
    } catch (error) {
      console.error("Error fetching cleaner data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDayToggle = (day: string) => {
    setPreferredDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const handleSave = async () => {
    if (!cleanerId) return;

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
        .eq("id", cleanerId);

      if (error) throw error;

      toast({
        title: "Saved",
        description: "Your availability has been updated successfully",
      });

      router.replace("/cleaner/dashboard");
    } catch (error: any) {
      console.error("Error saving availability:", error);
      toast({
        title: "Error",
        description: "Failed to update availability",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <RiLoader4Line className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push("/cleaner/dashboard")}
          >
            <RiArrowLeftLine className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-foreground">Manage Your Availability</h1>
            <p className="text-muted-foreground">Update your work schedule and preferences</p>
          </div>
        </div>

        {/* Today's Status */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RiCalendarLine className="w-5 h-5" />
              Today's Status
            </CardTitle>
            <CardDescription>
              Set your current availability status for today
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RadioGroup value={statusToday} onValueChange={setStatusToday}>
              <div className="flex items-center space-x-2 p-3 rounded-lg border hover:bg-accent transition-colors">
                <RadioGroupItem value="available" id="available" />
                <Label htmlFor="available" className="cursor-pointer flex-1">
                  <div className="font-medium">Available</div>
                  <div className="text-sm text-muted-foreground">Ready to accept job offers</div>
                </Label>
              </div>
              <div className="flex items-center space-x-2 p-3 rounded-lg border hover:bg-accent transition-colors">
                <RadioGroupItem value="unavailable" id="unavailable" />
                <Label htmlFor="unavailable" className="cursor-pointer flex-1">
                  <div className="font-medium">Unavailable</div>
                  <div className="text-sm text-muted-foreground">Not available for work today</div>
                </Label>
              </div>
              <div className="flex items-center space-x-2 p-3 rounded-lg border hover:bg-accent transition-colors">
                <RadioGroupItem value="on_break" id="on_break" />
                <Label htmlFor="on_break" className="cursor-pointer flex-1">
                  <div className="font-medium">On Break</div>
                  <div className="text-sm text-muted-foreground">Temporarily away, back soon</div>
                </Label>
              </div>
            </RadioGroup>
          </CardContent>
        </Card>

        {/* Preferred Work Days */}
        <Card>
          <CardHeader>
            <CardTitle>Preferred Work Days</CardTitle>
            <CardDescription>
              Select the days you prefer to work (helps with job matching)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {DAYS_OF_WEEK.map((day) => (
                <div
                  key={day.value}
                  className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-accent transition-colors"
                >
                  <Checkbox
                    id={day.value}
                    checked={preferredDays.includes(day.value)}
                    onCheckedChange={() => handleDayToggle(day.value)}
                  />
                  <Label
                    htmlFor={day.value}
                    className="cursor-pointer font-medium flex-1"
                  >
                    {day.label}
                  </Label>
                  {preferredDays.includes(day.value) && (
                    <RiCheckboxCircleLine className="w-4 h-4 text-primary" />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Booking Availability */}
        <Card>
          <CardHeader>
            <CardTitle>Accept New Job Offers</CardTitle>
            <CardDescription>
              Control whether you want to receive new job offer notifications
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between p-4 rounded-lg border">
              <div className="flex-1">
                <div className="font-medium">Available for new bookings</div>
                <div className="text-sm text-muted-foreground">
                  {availableForBookings
                    ? "You will receive job offers"
                    : "You won't receive new job offers"}
                </div>
              </div>
              <Switch
                checked={availableForBookings}
                onCheckedChange={setAvailableForBookings}
              />
            </div>
          </CardContent>
        </Card>

        {/* Save Button */}
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={() => router.push("/cleaner/dashboard")}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving} className="flex-1">
            {isSaving ? (
              <>
                <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <RiCheckboxCircleLine className="w-4 h-4 mr-2" />
                Save Changes
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
