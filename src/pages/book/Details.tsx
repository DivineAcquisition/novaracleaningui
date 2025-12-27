import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { z } from "zod";
import { format, addDays } from "date-fns";
import {
  MapPin,
  Calendar,
  Clock,
  FileText,
  Loader2,
  ArrowRight,
  Home,
  CheckCircle,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BookingProgressBar } from "@/components/booking/BookingProgressBar";
import { GoogleGuaranteedBadge } from "@/components/booking/GoogleGuaranteedBadge";
import { BookingFooter } from "@/components/booking/BookingFooter";
import { AvailabilityCalendar } from "@/components/booking/AvailabilityCalendar";
import { US_STATES } from "@/lib/us-states";

// Time blocks
const TIME_BLOCKS = [
  { id: "8-12", label: "Morning (8 AM - 12 PM)" },
  { id: "12-16", label: "Afternoon (12 PM - 4 PM)" },
  { id: "16-20", label: "Evening (4 PM - 8 PM)" },
];

// Validation schema
const addressSchema = z.object({
  address: z.string().min(5, "Please enter a valid street address"),
  address2: z.string().optional(),
  city: z.string().min(2, "Please enter a valid city"),
  state: z.string().length(2, "Please select a state"),
  zipCode: z.string().regex(/^\d{5}$/, "Please enter a valid ZIP code"),
});

export default function BookingDetails() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { updateBookingData } = useBooking();
  const bookingId = searchParams.get("booking_id");

  // Loading state
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [booking, setBooking] = useState<any>(null);

  // Form state
  const [formData, setFormData] = useState({
    address: "",
    address2: "",
    city: "",
    state: "",
    zipCode: "",
    notes: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Date/time state
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedTime, setSelectedTime] = useState("");

  const minDate = addDays(new Date(), 3);

  // Fetch booking on mount
  useEffect(() => {
    const fetchBooking = async () => {
      if (!bookingId) {
        toast.error("No booking found");
        navigate("/book/zip");
        return;
      }

      try {
        const { data, error } = await supabase
          .from("bookings")
          .select("*")
          .eq("id", bookingId)
          .single();

        if (error || !data) {
          toast.error("Booking not found");
          navigate("/book/zip");
          return;
        }

        // Check payment status
        if (data.status !== "confirmed" && data.status !== "pending_payment") {
          toast.error("Invalid booking status");
          navigate("/book/zip");
          return;
        }

        setBooking(data);

        // Pre-fill form if data exists
        if (data.address && data.address !== "TBD") {
          setFormData({
            address: data.address || "",
            address2: "",
            city: data.city || "",
            state: data.state || "",
            zipCode: data.zip_code || "",
            notes: data.access_notes || "",
          });
        } else {
          // Pre-fill city/state/zip from booking context
          setFormData(prev => ({
            ...prev,
            city: data.city || "",
            state: data.state || "",
            zipCode: data.zip_code || "",
          }));
        }

        // Pre-fill date/time if exists
        if (data.service_date) {
          setSelectedDate(new Date(data.service_date + "T12:00:00"));
        }
        if (data.time_slot) {
          setSelectedTime(data.time_slot);
        }
      } catch (err) {
        console.error("[Details] Fetch error:", err);
        toast.error("Failed to load booking");
      } finally {
        setIsLoading(false);
      }
    };

    fetchBooking();
  }, [bookingId, navigate]);

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: "" }));
    }
  };

  const handleDateSelect = (date: Date) => {
    setSelectedDate(date);
  };

  const handleSlotSelect = (date: Date, timeSlot: string) => {
    setSelectedDate(date);
    setSelectedTime(timeSlot);
  };

  const validateForm = () => {
    const result = addressSchema.safeParse({
      address: formData.address,
      address2: formData.address2,
      city: formData.city,
      state: formData.state,
      zipCode: formData.zipCode,
    });

    if (!result.success) {
      const newErrors: Record<string, string> = {};
      result.error.errors.forEach((err) => {
        const field = err.path[0] as string;
        newErrors[field] = err.message;
      });
      setErrors(newErrors);
      return false;
    }

    if (!selectedDate) {
      toast.error("Please select a preferred date");
      return false;
    }

    if (!selectedTime) {
      toast.error("Please select a time block");
      return false;
    }

    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) return;

    setIsSubmitting(true);

    try {
      const dateStr = format(selectedDate!, "yyyy-MM-dd");

      // Update booking
      const { error: bookingError } = await supabase
        .from("bookings")
        .update({
          address: formData.address + (formData.address2 ? `, ${formData.address2}` : ""),
          city: formData.city,
          state: formData.state,
          zip_code: formData.zipCode,
          service_date: dateStr,
          time_slot: selectedTime,
          access_notes: formData.notes || null,
          status: "confirmed",
        })
        .eq("id", bookingId);

      if (bookingError) throw bookingError;

      // Update customer if exists
      if (booking?.customer_id) {
        await supabase
          .from("customers")
          .update({
            address: formData.address,
            city: formData.city,
            state: formData.state,
            zip: formData.zipCode,
          })
          .eq("id", booking.customer_id);
      }

      // Update booking context
      updateBookingData({
        address: formData.address,
        city: formData.city,
        state: formData.state,
        serviceDate: dateStr,
        timeSlot: selectedTime,
      });

      toast.success("Details saved successfully!");
      navigate(`/book/confirmation?booking_id=${bookingId}`);
    } catch (err: any) {
      console.error("[Details] Submit error:", err);
      toast.error("Failed to save details. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground">Loading your booking...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <BookingProgressBar currentStep={5} totalSteps={6} />

      <div className="container max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="mx-auto w-14 h-14 bg-primary/10 rounded-full flex items-center justify-center">
            <Home className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">
            Almost Done! Let's Schedule Your Clean
          </h1>
          <p className="text-muted-foreground">
            Tell us where and when you'd like us to clean
          </p>
          <div className="flex justify-center">
            <GoogleGuaranteedBadge />
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Service Address Card */}
          <Card className="border-2 border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <MapPin className="h-5 w-5 text-primary" />
                Service Address
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="address">Street Address *</Label>
                <Input
                  id="address"
                  placeholder="123 Main Street"
                  value={formData.address}
                  onChange={(e) => handleChange("address", e.target.value)}
                  className={errors.address ? "border-destructive" : ""}
                />
                {errors.address && (
                  <p className="text-xs text-destructive">{errors.address}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="address2">Apt, Suite, Unit (Optional)</Label>
                <Input
                  id="address2"
                  placeholder="Apt 4B"
                  value={formData.address2}
                  onChange={(e) => handleChange("address2", e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="city">City *</Label>
                  <Input
                    id="city"
                    placeholder="City"
                    value={formData.city}
                    onChange={(e) => handleChange("city", e.target.value)}
                    className={errors.city ? "border-destructive" : ""}
                  />
                  {errors.city && (
                    <p className="text-xs text-destructive">{errors.city}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="state">State *</Label>
                  <Select
                    value={formData.state}
                    onValueChange={(value) => handleChange("state", value)}
                  >
                    <SelectTrigger className={errors.state ? "border-destructive" : ""}>
                      <SelectValue placeholder="State" />
                    </SelectTrigger>
                    <SelectContent>
                      {US_STATES.map((state) => (
                        <SelectItem key={state.value} value={state.value}>
                          {state.value} - {state.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.state && (
                    <p className="text-xs text-destructive">{errors.state}</p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="zipCode">ZIP Code *</Label>
                <Input
                  id="zipCode"
                  placeholder="12345"
                  value={formData.zipCode}
                  onChange={(e) => handleChange("zipCode", e.target.value.replace(/\D/g, "").slice(0, 5))}
                  className={errors.zipCode ? "border-destructive" : ""}
                  maxLength={5}
                />
                {errors.zipCode && (
                  <p className="text-xs text-destructive">{errors.zipCode}</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Scheduling Card */}
          <Card className="border-2 border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Calendar className="h-5 w-5 text-primary" />
                Preferred Date & Time
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <AvailabilityCalendar
                selectedDate={selectedDate}
                selectedTime={selectedTime}
                onSelectSlot={handleSlotSelect}
                onDateSelect={handleDateSelect}
                minDate={minDate}
              />

              {selectedDate && selectedTime && (
                <div className="flex items-center gap-2 p-3 bg-primary/10 rounded-lg">
                  <CheckCircle className="h-5 w-5 text-primary" />
                  <span className="font-medium">
                    {format(selectedDate, "EEEE, MMMM d, yyyy")} •{" "}
                    {TIME_BLOCKS.find((t) => t.id === selectedTime)?.label}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Additional Notes Card */}
          <Card className="border-2 border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                Additional Notes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                placeholder="Gate code, parking instructions, pets, special requests..."
                value={formData.notes}
                onChange={(e) => handleChange("notes", e.target.value)}
                rows={4}
              />
            </CardContent>
          </Card>

          {/* Submit Button */}
          <Button
            type="submit"
            size="lg"
            className="w-full h-14 text-lg"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                Complete Booking
                <ArrowRight className="ml-2 h-5 w-5" />
              </>
            )}
          </Button>
        </form>
      </div>

      <BookingFooter />
    </div>
  );
}
