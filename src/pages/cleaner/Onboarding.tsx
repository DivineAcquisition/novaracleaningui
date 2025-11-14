import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Loader2, MapPin } from "lucide-react";

const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"
];

const DAYS_OF_WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function CleanerOnboarding() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    state: "",
    homeZip: "",
    maxTravelMiles: 20,
    preferredWorkDays: [] as string[]
  });

  const handleDayToggle = (day: string) => {
    setFormData(prev => ({
      ...prev,
      preferredWorkDays: prev.preferredWorkDays.includes(day)
        ? prev.preferredWorkDays.filter(d => d !== day)
        : [...prev.preferredWorkDays, day]
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (formData.preferredWorkDays.length === 0) {
      toast({
        title: "Error",
        description: "Please select at least one preferred work day",
        variant: "destructive"
      });
      return;
    }

    setIsLoading(true);

    try {
      // Geocode home address
      const { data: geoData, error: geoError } = await supabase.functions.invoke("geocode-address", {
        body: {
          zip: formData.homeZip,
          state: formData.state
        }
      });

      if (geoError) throw geoError;

      // Insert cleaner record
      const { error: insertError } = await supabase
        .from("cleaners")
        .insert({
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
          pay_rate_hr: 18.00,
          status_today: formData.preferredWorkDays.includes(new Date().toLocaleDateString('en-US', { weekday: 'long' }).substring(0, 3))
            ? "Available"
            : "Unavailable"
        });

      if (insertError) throw insertError;

      toast({
        title: "Success!",
        description: "Your profile has been created. You'll be notified when approved."
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
