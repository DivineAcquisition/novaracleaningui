"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  RiSearchLine,
  RiLoader4Line,
  RiCalendarLine,
  RiMapPinLine,
  RiTimeLine,
  RiSparklingLine,
  RiBankCardLine,
  RiCheckboxCircleLine,
  RiCloseLine,
  RiArrowLeftLine,
  RiSettings3Line,
  RiAlertLine,
  RiVipCrownLine,
  RiPhoneLine,
  RiMailLine,
} from "@remixicon/react";
import { format, isFuture } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { RescheduleDialog } from "@/components/booking/RescheduleDialog";
import { CancelBookingDialog } from "@/components/booking/CancelBookingDialog";
import { SEO } from "@/components/SEO";
import { parseServiceDate } from "@/lib/service-date";

const logo = "/novara-logo.png";

interface Booking {
  id: string;
  service_date: string;
  time_slot: string;
  service_type: string;
  status: string;
  address: string;
  city: string;
  state: string;
  zip_code: string;
  total_estimate_cents: number;
  uses_credit: boolean;
  home_size_id: string;
  service_duration?: number;
  add_ons: string[];
  bedrooms: number | null;
  bathrooms: number | null;
  dwelling_type: string | null;
  membership_plan: string;
  rating_submitted: boolean;
  cleaner_id: string | null;
  created_at: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
}

interface MembershipCredit {
  id: string;
  email: string;
  membership_plan: string;
  credits_per_month: number;
  credits_remaining: number;
  credits_used: number;
  current_period_start: string;
  current_period_end: string;
}

function getStatusConfig(status: string) {
  const configs: Record<string, { label: string; class: string; dot: string }> = {
    confirmed: {
      label: "Confirmed",
      class: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400",
      dot: "bg-emerald-500",
    },
    pending_payment: {
      label: "Pending Payment",
      class: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400",
      dot: "bg-amber-500",
    },
    cancelled: {
      label: "Cancelled",
      class: "bg-red-50 text-red-600 border-red-200 dark:bg-red-950/30 dark:text-red-400",
      dot: "bg-red-500",
    },
    completed: {
      label: "Completed",
      class: "bg-primary/5 text-primary border-primary/20",
      dot: "bg-primary",
    },
  };
  return configs[status] || { label: status, class: "bg-muted text-muted-foreground", dot: "bg-muted-foreground" };
}

export default function ManageBooking() {
  const [lookupType, setLookupType] = useState<"email" | "phone">("email");
  const [lookupValue, setLookupValue] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [membership, setMembership] = useState<MembershipCredit | null>(null);
  const [customerName, setCustomerName] = useState("");

  const [rescheduleBooking, setRescheduleBooking] = useState<Booking | null>(null);
  const [rescheduleDialogOpen, setRescheduleDialogOpen] = useState(false);
  const [cancelBookingItem, setCancelBookingItem] = useState<Booking | null>(null);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lookupValue.trim()) {
      toast.error("Please enter your email or phone number");
      return;
    }

    setIsSearching(true);
    setSearched(false);
    try {
      const filterColumn = lookupType === "email" ? "email" : "phone";
      const cleanValue =
        lookupType === "phone"
          ? lookupValue.replace(/\D/g, "").replace(/^1/, "")
          : lookupValue.trim().toLowerCase();
      const searchValue =
        lookupType === "phone" && cleanValue.length === 10
          ? `+1${cleanValue}`
          : lookupType === "phone"
            ? cleanValue
            : lookupValue.trim().toLowerCase();

      const { data: bookingData, error: bookingError } = await supabase
        .from("bookings")
        .select("*")
        .ilike(filterColumn, lookupType === "phone" ? `%${cleanValue.slice(-10)}%` : searchValue)
        .order("service_date", { ascending: false })
        .limit(20);

      if (bookingError) throw bookingError;

      setBookings(bookingData || []);

      if (bookingData && bookingData.length > 0) {
        const first = bookingData[0];
        setCustomerName(`${first.first_name || ""} ${first.last_name || ""}`.trim());

        const { data: creditData } = await supabase
          .from("membership_credits")
          .select("*")
          .eq("email", first.email)
          .maybeSingle();

        setMembership(creditData);
      } else {
        setCustomerName("");
        setMembership(null);
      }

      setSearched(true);
    } catch (error: any) {
      console.error("Search error:", error);
      toast.error("Failed to look up bookings. Please try again.");
    } finally {
      setIsSearching(false);
    }
  };

  const refreshBookings = async () => {
    if (!bookings.length) return;
    const email = bookings[0].email;
    const { data } = await supabase
      .from("bookings")
      .select("*")
      .eq("email", email)
      .order("service_date", { ascending: false })
      .limit(20);
    if (data) setBookings(data);
  };

  const handleReschedule = (booking: Booking) => {
    setRescheduleBooking(booking);
    setRescheduleDialogOpen(true);
  };

  const handleCancel = (booking: Booking) => {
    setCancelBookingItem(booking);
    setCancelDialogOpen(true);
  };

  const handleReset = () => {
    setSearched(false);
    setBookings([]);
    setMembership(null);
    setCustomerName("");
    setLookupValue("");
  };

  // Keep Cancel available after dispatch — status flips to "assigned" but the
  // appointment is still cancellable (same as SMS cancel + cancel-booking).
  const upcomingBookings = bookings.filter(
    (b) =>
      isFuture(parseServiceDate(b.service_date)) &&
      (b.status === "confirmed" || b.status === "assigned")
  );
  const pastBookings = bookings.filter(
    (b) => b.status === "completed" || b.status === "cancelled"
  );

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="Manage Your Booking"
        description="Look up, reschedule, or cancel your Novara Cleaning booking. Manage your membership and view booking history."
      />

      {/* Header */}
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="container max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2.5 group">
            <img
              src={logo}
              alt="Novara"
              className="w-8 h-8 rounded-xl shadow-sm"
            />
            <span className="font-bold text-sm">Novara Cleaning</span>
          </a>
          {searched && (
            <Button variant="ghost" size="sm" onClick={handleReset}>
              <RiArrowLeftLine className="w-4 h-4 mr-1" /> New Search
            </Button>
          )}
        </div>
      </header>

      <div className="container max-w-4xl mx-auto px-4 py-8 md:py-12">
        {!searched ? (
          /* Search Form */
          <div className="max-w-md mx-auto space-y-8 animate-fade-in">
            <div className="text-center space-y-2">
              <div
                className="mx-auto w-16 h-16 rounded-2xl flex items-center justify-center shadow-lg mb-4"
                style={{ background: "var(--gradient-primary)" }}
              >
                <RiSearchLine className="w-8 h-8 text-white" />
              </div>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
                Manage Your Booking
              </h1>
              <p className="text-muted-foreground text-sm">
                Look up your booking to reschedule, cancel, or view details
              </p>
            </div>

            <Card className="shadow-lg border-0">
              <CardContent className="p-6">
                <form onSubmit={handleSearch} className="space-y-5">
                  <Tabs
                    value={lookupType}
                    onValueChange={(v) =>
                      setLookupType(v as "email" | "phone")
                    }
                  >
                    <TabsList className="grid w-full grid-cols-2 mb-4">
                      <TabsTrigger value="email" className="text-sm">
                        <RiMailLine className="w-4 h-4 mr-1.5" /> Email
                      </TabsTrigger>
                      <TabsTrigger value="phone" className="text-sm">
                        <RiPhoneLine className="w-4 h-4 mr-1.5" /> Phone
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="email" className="mt-0">
                      <div className="space-y-2">
                        <Label>Email address</Label>
                        <div className="relative">
                          <RiMailLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                          <Input
                            type="email"
                            placeholder="you@example.com"
                            value={lookupValue}
                            onChange={(e) => setLookupValue(e.target.value)}
                            className="pl-10 h-11"
                            required
                          />
                        </div>
                      </div>
                    </TabsContent>
                    <TabsContent value="phone" className="mt-0">
                      <div className="space-y-2">
                        <Label>Phone number</Label>
                        <div className="relative">
                          <RiPhoneLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                          <Input
                            type="tel"
                            placeholder="(555) 123-4567"
                            value={lookupValue}
                            onChange={(e) => setLookupValue(e.target.value)}
                            className="pl-10 h-11"
                            required
                          />
                        </div>
                      </div>
                    </TabsContent>
                  </Tabs>

                  <Button
                    type="submit"
                    className="w-full h-11"
                    disabled={isSearching}
                  >
                    {isSearching ? (
                      <>
                        <RiLoader4Line className="mr-2 w-4 h-4 animate-spin" />
                        Searching...
                      </>
                    ) : (
                      <>
                        <RiSearchLine className="mr-2 w-4 h-4" />
                        Look Up Booking
                      </>
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>

            <p className="text-center text-xs text-muted-foreground">
              Need help?{" "}
              <a
                href="tel:+18447352070"
                className="text-primary hover:underline"
              >
                Call (844) 735-2070
              </a>
            </p>
          </div>
        ) : bookings.length === 0 ? (
          /* No results */
          <div className="max-w-md mx-auto text-center space-y-4 animate-fade-in py-12">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-muted flex items-center justify-center">
              <RiSearchLine className="w-7 h-7 text-muted-foreground" />
            </div>
            <h2 className="text-xl font-bold">No bookings found</h2>
            <p className="text-sm text-muted-foreground">
              We couldn't find any bookings for that{" "}
              {lookupType === "email" ? "email address" : "phone number"}.
              Please check and try again.
            </p>
            <Button variant="outline" onClick={handleReset}>
              Try Again
            </Button>
          </div>
        ) : (
          /* Results */
          <div className="space-y-6 animate-fade-in">
            {/* Customer header */}
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl md:text-2xl font-bold tracking-tight">
                  {customerName ? `Hi, ${customerName.split(" ")[0]}` : "Your Bookings"}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {bookings.length} booking{bookings.length !== 1 ? "s" : ""} found
                </p>
              </div>
            </div>

            {/* Membership card */}
            {membership && (
              <Card className="shadow-sm border-primary/15 overflow-hidden">
                <div
                  className="h-0.5 w-full"
                  style={{ background: "var(--gradient-primary)" }}
                />
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-9 h-9 rounded-xl flex items-center justify-center"
                        style={{ background: "var(--gradient-primary)" }}
                      >
                        <RiVipCrownLine className="w-4 h-4 text-white" />
                      </div>
                      <div>
                        <p className="font-semibold text-sm">
                          {membership.membership_plan.charAt(0).toUpperCase() +
                            membership.membership_plan.slice(1)}{" "}
                          Plan
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {membership.credits_remaining} of{" "}
                          {membership.credits_per_month} credits remaining
                          &middot; Renews{" "}
                          {format(
                            new Date(membership.current_period_end),
                            "MMM d"
                          )}
                        </p>
                      </div>
                    </div>
                    <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]">
                      Active
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Upcoming bookings */}
            {upcomingBookings.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest px-1">
                  Upcoming Bookings
                </h2>
                {upcomingBookings.map((booking) => {
                  const sc = getStatusConfig(booking.status);
                  return (
                    <Card key={booking.id} className="shadow-sm hover:shadow-md transition-shadow">
                      <CardContent className="p-4 md:p-5">
                        <div className="flex flex-col gap-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <div className="text-center min-w-[48px] py-2 px-3 rounded-xl bg-primary/5">
                                <p className="text-[10px] uppercase tracking-wider font-semibold text-primary">
                                  {format(parseServiceDate(booking.service_date), "MMM")}
                                </p>
                                <p className="text-xl font-bold leading-tight">
                                  {format(parseServiceDate(booking.service_date), "d")}
                                </p>
                              </div>
                              <div>
                                <p className="font-semibold text-sm">
                                  {format(parseServiceDate(booking.service_date), "EEEE")}
                                </p>
                                <p className="text-xs text-muted-foreground flex items-center gap-1">
                                  <RiTimeLine className="w-3 h-3" />
                                  {booking.time_slot}
                                </p>
                              </div>
                            </div>
                            <Badge
                              variant="outline"
                              className={cn("text-[10px]", sc.class)}
                            >
                              <span className={cn("w-1.5 h-1.5 rounded-full mr-1", sc.dot)} />
                              {sc.label}
                            </Badge>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 rounded-xl bg-muted/30">
                            <div className="flex items-center gap-2 text-sm">
                              <RiMapPinLine className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                              <span className="truncate text-xs">
                                {booking.address}, {booking.city}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-sm">
                              <RiSparklingLine className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                              <span className="text-xs">{booking.service_type}</span>
                            </div>
                            <div className="flex items-center gap-2 text-sm">
                              <RiBankCardLine className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                              <span className="font-semibold text-xs">
                                ${(booking.total_estimate_cents / 100).toFixed(2)}
                                {booking.uses_credit && (
                                  <span className="font-normal text-muted-foreground ml-1">
                                    (credit)
                                  </span>
                                )}
                              </span>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-xs h-8"
                              onClick={() => handleReschedule(booking)}
                            >
                              <RiCalendarLine className="w-3.5 h-3.5 mr-1" />
                              Reschedule
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs h-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                              onClick={() => handleCancel(booking)}
                            >
                              <RiCloseLine className="w-3.5 h-3.5 mr-1" />
                              Cancel
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}

            {/* Past bookings */}
            {pastBookings.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest px-1">
                  Past Bookings
                </h2>
                {pastBookings.slice(0, 5).map((booking) => {
                  const sc = getStatusConfig(booking.status);
                  return (
                    <Card key={booking.id} className="bg-muted/20 border-border/60 shadow-none">
                      <CardContent className="p-3.5">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="text-center min-w-[40px]">
                              <p className="text-[9px] uppercase tracking-wider text-muted-foreground">
                                {format(parseServiceDate(booking.service_date), "MMM")}
                              </p>
                              <p className="text-base font-bold leading-tight">
                                {format(parseServiceDate(booking.service_date), "d")}
                              </p>
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-sm truncate">
                                {booking.service_type}
                              </p>
                              <p className="text-xs text-muted-foreground truncate">
                                {booking.city}, {booking.state}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <Badge
                              variant="outline"
                              className={cn("text-[10px]", sc.class)}
                            >
                              {sc.label}
                            </Badge>
                            <span className="text-sm font-medium">
                              ${(booking.total_estimate_cents / 100).toFixed(2)}
                            </span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}

            {upcomingBookings.length === 0 && pastBookings.length === 0 && (
              <Card className="border-dashed">
                <CardContent className="py-12 text-center">
                  <p className="text-muted-foreground">
                    No active or past bookings found.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>

      {/* Dialogs */}
      {rescheduleBooking && (
        <RescheduleDialog
          open={rescheduleDialogOpen}
          onOpenChange={setRescheduleDialogOpen}
          booking={rescheduleBooking}
          onSuccess={refreshBookings}
        />
      )}
      {cancelBookingItem && (
        <CancelBookingDialog
          open={cancelDialogOpen}
          onOpenChange={setCancelDialogOpen}
          booking={cancelBookingItem}
          onSuccess={refreshBookings}
        />
      )}
    </div>
  );
}
