"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { useBooking } from "@/contexts/BookingContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Calendar, 
  Clock, 
  Sparkles, 
  ArrowRight, 
  Loader2,
  User,
  CreditCard,
  Star,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { format } from "date-fns";

interface Cleaner {
  id: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  rating: number;
  total_cleans: number;
}

export default function PortalBook() {
  const router = useRouter();
  const { user, subscription } = useAuth();
  const { updateBookingData } = useBooking();

  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedTime, setSelectedTime] = useState("");
  const [membershipCredits, setMembershipCredits] = useState(2); // Default credits
  const [selectedCleaner, setSelectedCleaner] = useState<string | null>(null);
  const [availableCleaners, setAvailableCleaners] = useState<Cleaner[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!user) {
      router.push("/auth");
      return;
    }

    loadCleaners();
  }, [user, router]);

  const loadCleaners = async () => {
    try {
      const { data, error } = await supabase
        .from("cleaners")
        .select("id, first_name, last_name, avatar_url")
        .eq("approved", true)
        .eq("status", "active")
        .limit(10);

      if (error) throw error;

      // Add mock rating/cleans for display
      const cleanersWithStats = ((data || []) as any[]).map((c) => ({
        ...c,
        rating: 4.8 + Math.random() * 0.2,
        total_cleans: Math.floor(50 + Math.random() * 150),
      }));

      setAvailableCleaners(cleanersWithStats);
    } catch (error) {
      console.error("Error loading cleaners:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleBooking = async () => {
    if (!selectedDate || !selectedTime) {
      toast.error("Please select a date and time");
      return;
    }

    if (!subscription?.subscribed && membershipCredits <= 0) {
      toast.error("You need a membership or credits to book");
      router.push("/membership");
      return;
    }

    setIsSubmitting(true);

    try {
      const bookingData = {
        user_id: user?.id,
        first_name: "",
        last_name: "",
        email: user?.email || "",
        phone: "",
        address: "",
        city: "",
        state: "",
        zip_code: "",
        service_type: "Standard Clean",
        service_date: format(selectedDate, "yyyy-MM-dd"),
        time_slot: selectedTime,
        requested_cleaner_id: selectedCleaner,
        status: "confirmed",
        is_credit_booking: true,
        base_price_cents: 15000,
      };

      const { error } = await supabase
        .from("bookings")
        .insert(bookingData as any);

      if (error) throw error;

      setMembershipCredits((prev) => Math.max(0, prev - 1));
      toast.success("Booking confirmed!");
      router.push("/account");
    } catch (error: any) {
      console.error("Booking error:", error);
      toast.error("Failed to book. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const timeSlots = [
    { id: "8:00 AM - 10:00 AM", label: "Morning Early", time: "8:00 AM" },
    { id: "10:00 AM - 12:00 PM", label: "Morning Late", time: "10:00 AM" },
    { id: "1:00 PM - 3:00 PM", label: "Afternoon Early", time: "1:00 PM" },
    { id: "3:00 PM - 5:00 PM", label: "Afternoon Late", time: "3:00 PM" },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-hero flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-hero pb-24">
      {/* Header */}
      <header className="bg-background/80 backdrop-blur-lg border-b sticky top-0 z-50">
        <div className="container max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Use Your Credit</h1>
            <p className="text-sm text-muted-foreground">
              {membershipCredits} credit{membershipCredits !== 1 ? "s" : ""} available
            </p>
          </div>
          <Link href="/account">
            <Button variant="ghost" size="sm">
              Cancel
            </Button>
          </Link>
        </div>
      </header>

      <main className="container max-w-4xl mx-auto px-4 py-8 space-y-8">
        {/* Credits Card */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="bg-gradient-to-br from-primary to-purple-600 text-white border-0 shadow-xl">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white/80 text-sm">Available Credits</p>
                  <p className="text-4xl font-bold">{membershipCredits}</p>
                </div>
                <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center">
                  <CreditCard className="w-8 h-8" />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Date Selection */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-primary" />
                Select Date
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-7 gap-2">
                {Array.from({ length: 14 }).map((_, i) => {
                  const date = new Date();
                  date.setDate(date.getDate() + i + 1);
                  const isSelected = selectedDate?.toDateString() === date.toDateString();
                  
                  return (
                    <button
                      key={i}
                      onClick={() => setSelectedDate(date)}
                      className={`p-3 rounded-lg text-center transition-all ${
                        isSelected
                          ? "bg-primary text-white"
                          : "bg-muted hover:bg-muted/80"
                      }`}
                    >
                      <div className="text-xs font-medium">
                        {format(date, "EEE")}
                      </div>
                      <div className="text-lg font-bold">
                        {format(date, "d")}
                      </div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Time Selection */}
        {selectedDate && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-primary" />
                  Select Time
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3">
                  {timeSlots.map((slot) => (
                    <button
                      key={slot.id}
                      onClick={() => setSelectedTime(slot.id)}
                      className={`p-4 rounded-lg border-2 transition-all ${
                        selectedTime === slot.id
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      <p className="font-medium">{slot.time}</p>
                      <p className="text-xs text-muted-foreground">{slot.label}</p>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Cleaner Selection */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary" />
                Request a Cleaner (Optional)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Skip to let us assign the best available cleaner, or select your preferred cleaner.
              </p>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {/* No Preference Option */}
                <button
                  onClick={() => setSelectedCleaner(null)}
                  className={`p-4 rounded-xl border-2 text-left transition-all ${
                    selectedCleaner === null
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-2">
                    <User className="w-6 h-6 text-muted-foreground" />
                  </div>
                  <p className="font-medium text-sm">No Preference</p>
                  <p className="text-xs text-muted-foreground">Best available</p>
                </button>

                {/* Cleaners */}
                {availableCleaners.map((cleaner) => (
                  <button
                    key={cleaner.id}
                    onClick={() => setSelectedCleaner(cleaner.id)}
                    className={`p-4 rounded-xl border-2 text-left transition-all ${
                      selectedCleaner === cleaner.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    {cleaner.avatar_url ? (
                      <img
                        src={cleaner.avatar_url}
                        alt=""
                        className="w-12 h-12 rounded-full object-cover mb-2"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-gradient-primary flex items-center justify-center text-white font-bold mb-2">
                        {cleaner.first_name?.[0]}
                        {cleaner.last_name?.[0]}
                      </div>
                    )}
                    <p className="font-medium text-sm">
                      {cleaner.first_name} {cleaner.last_name?.[0]}.
                    </p>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                      {cleaner.rating.toFixed(1)} • {cleaner.total_cleans} cleans
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Book Button */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          <Button
            onClick={handleBooking}
            disabled={!selectedDate || !selectedTime || isSubmitting || membershipCredits <= 0}
            className="w-full h-14 bg-gradient-primary text-lg"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Booking...
              </>
            ) : membershipCredits <= 0 ? (
              "No Credits Available"
            ) : (
              <>
                Confirm Booking
                <ArrowRight className="w-5 h-5 ml-2" />
              </>
            )}
          </Button>
          <p className="text-xs text-center text-muted-foreground mt-2">
            This will use 1 cleaning credit
          </p>
        </motion.div>
      </main>
    </div>
  );
}
