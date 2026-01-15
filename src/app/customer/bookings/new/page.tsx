"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { format, addDays, isBefore, startOfDay } from "date-fns";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MapPin,
  CalendarDays,
  Clock,
  ArrowRight,
  Loader2,
  CheckCircle,
  Crown,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

interface Address {
  id: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  sqft_tier: string | null;
}

interface MembershipCredits {
  credits_remaining: number;
  membership_plan: string;
}

const timeSlots = [
  "8:00 AM - 10:00 AM",
  "9:00 AM - 11:00 AM",
  "10:00 AM - 12:00 PM",
  "11:00 AM - 1:00 PM",
  "12:00 PM - 2:00 PM",
  "1:00 PM - 3:00 PM",
  "2:00 PM - 4:00 PM",
  "3:00 PM - 5:00 PM",
];

const serviceTypes = [
  { id: "standard", label: "Standard Clean", price: 14900 },
  { id: "deep", label: "Deep Clean", price: 19900 },
  { id: "move", label: "Move In/Out Clean", price: 24900 },
];

export default function NewBookingPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [membership, setMembership] = useState<MembershipCredits | null>(null);
  
  const [selectedAddress, setSelectedAddress] = useState("");
  const [selectedService, setSelectedService] = useState("standard");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [selectedTime, setSelectedTime] = useState("");
  const [useCredit, setUseCredit] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);

  const minDate = addDays(new Date(), 2);
  const maxDate = addDays(new Date(), 60);

  useEffect(() => {
    const fetchData = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      
      setUser(session.user);

      setIsLoading(true);
      try {
        // Fetch addresses
        const { data: customerData } = await supabase
          .from("customers")
          .select("id")
          .eq("email", session.user.email)
          .maybeSingle();

        if (customerData) {
          const { data: addressData } = await supabase
            .from("addresses")
            .select("id, street, city, state, zip, sqft_tier")
            .eq("customer_id", customerData.id);

          setAddresses(addressData || []);
          if (addressData && addressData.length > 0) {
            setSelectedAddress(addressData[0].id);
          }
        }

        // Fetch membership
        const { data: membershipData } = await supabase
          .from("membership_credits")
          .select("credits_remaining, membership_plan")
          .eq("email", session.user.email)
          .maybeSingle();

        setMembership(membershipData);
        if (membershipData?.credits_remaining && membershipData.credits_remaining > 0) {
          setUseCredit(true);
        }
      } catch (error) {
        console.error("Error fetching data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, []);

  const selectedServiceData = serviceTypes.find((s) => s.id === selectedService);
  const price = useCredit ? 0 : (selectedServiceData?.price || 0);

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(cents / 100);
  };

  const handleSubmit = async () => {
    if (!selectedAddress) {
      toast.error("Please select an address");
      return;
    }
    if (!selectedDate) {
      toast.error("Please select a date");
      return;
    }
    if (!selectedTime) {
      toast.error("Please select a time slot");
      return;
    }

    setIsSubmitting(true);
    try {
      const address = addresses.find((a) => a.id === selectedAddress);
      if (!address) throw new Error("Address not found");

      // Create booking
      const { data: booking, error } = await supabase
        .from("bookings")
        .insert({
          email: user?.email,
          first_name: user?.user_metadata?.first_name || "",
          last_name: user?.user_metadata?.last_name || "",
          phone: user?.user_metadata?.phone || "",
          address: address.street,
          city: address.city,
          state: address.state,
          zip_code: address.zip,
          home_size_id: address.sqft_tier || "md",
          service_type: selectedServiceData?.label || "Standard Clean",
          service_date: format(selectedDate, "yyyy-MM-dd"),
          time_slot: selectedTime,
          base_price_cents: selectedServiceData?.price || 14900,
          deposit_cents: 0,
          total_estimate_cents: price,
          payment_option: useCredit ? "membership" : "one_time",
          uses_credit: useCredit,
          status: "confirmed",
        })
        .select()
        .single();

      if (error) throw error;

      // Deduct credit if using membership
      if (useCredit && membership) {
        await supabase
          .from("membership_credits")
          .update({
            credits_remaining: membership.credits_remaining - 1,
          })
          .eq("email", user?.email);
      }

      toast.success("Booking confirmed!");
      router.push(`/customer/bookings/${booking.id}`);
    } catch (error) {
      console.error("Booking error:", error);
      toast.error("Failed to create booking. Please try again.");
    } finally {
      setIsSubmitting(false);
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
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Book a Cleaning</h1>
        <p className="text-muted-foreground">
          Schedule your next cleaning appointment
        </p>
      </div>

      {/* Address Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Select Address
          </CardTitle>
        </CardHeader>
        <CardContent>
          {addresses.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-muted-foreground mb-4">No saved addresses</p>
              <Link href="/customer/addresses/new">
                <Button variant="outline">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Address
                </Button>
              </Link>
            </div>
          ) : (
            <Select value={selectedAddress} onValueChange={setSelectedAddress}>
              <SelectTrigger>
                <SelectValue placeholder="Choose an address" />
              </SelectTrigger>
              <SelectContent>
                {addresses.map((address) => (
                  <SelectItem key={address.id} value={address.id}>
                    {address.street}, {address.city}, {address.state}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </CardContent>
      </Card>

      {/* Service Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Select Service</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3">
            {serviceTypes.map((service) => (
              <div
                key={service.id}
                className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                  selectedService === service.id
                    ? "border-primary bg-primary/5"
                    : "hover:border-muted-foreground/50"
                }`}
                onClick={() => setSelectedService(service.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {selectedService === service.id && (
                      <CheckCircle className="h-5 w-5 text-primary" />
                    )}
                    <span className="font-medium">{service.label}</span>
                  </div>
                  <span className="font-semibold">{formatCurrency(service.price)}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Date & Time Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <CalendarDays className="h-5 w-5" />
            Date & Time
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-start text-left">
                <CalendarDays className="mr-2 h-4 w-4" />
                {selectedDate ? (
                  format(selectedDate, "EEEE, MMMM d, yyyy")
                ) : (
                  <span className="text-muted-foreground">Pick a date</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(date) => {
                  setSelectedDate(date);
                  setCalendarOpen(false);
                }}
                disabled={(date) =>
                  isBefore(date, startOfDay(minDate)) || isBefore(maxDate, date)
                }
                initialFocus
              />
            </PopoverContent>
          </Popover>

          <div className="grid grid-cols-2 gap-2">
            {timeSlots.map((slot) => (
              <Button
                key={slot}
                variant={selectedTime === slot ? "default" : "outline"}
                className="h-auto py-2 text-sm"
                onClick={() => setSelectedTime(slot)}
              >
                <Clock className="h-3 w-3 mr-1.5" />
                {slot}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Use Credits */}
      {membership && membership.credits_remaining > 0 && (
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Crown className="h-5 w-5 text-primary" />
                <div>
                  <p className="font-medium">Use Membership Credit</p>
                  <p className="text-sm text-muted-foreground">
                    {membership.credits_remaining} credit{membership.credits_remaining !== 1 ? "s" : ""} remaining
                  </p>
                </div>
              </div>
              <Button
                variant={useCredit ? "default" : "outline"}
                onClick={() => setUseCredit(!useCredit)}
              >
                {useCredit ? "Using Credit" : "Use Credit"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary & Submit */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-4">
            <span className="text-lg font-medium">Total</span>
            <span className="text-2xl font-bold">
              {useCredit ? (
                <span className="flex items-center gap-2">
                  <span className="line-through text-muted-foreground text-lg">
                    {formatCurrency(selectedServiceData?.price || 0)}
                  </span>
                  <Badge variant="secondary">1 Credit</Badge>
                </span>
              ) : (
                formatCurrency(price)
              )}
            </span>
          </div>

          <Button
            className="w-full"
            size="lg"
            onClick={handleSubmit}
            disabled={isSubmitting || !selectedAddress || !selectedDate || !selectedTime}
          >
            {isSubmitting ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                Confirm Booking
                <ArrowRight className="ml-2 h-5 w-5" />
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
