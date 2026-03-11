"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  RiCalendarLine,
  RiLoader4Line,
  RiCheckboxCircleFill,
  RiLockLine,
  RiTimeLine,
  RiMapPinLine,
  RiBankCardLine,
  RiAlertLine,
  RiCloseLine,
  RiArrowDownSLine,
  RiStarLine,
  RiSparklingLine,
  RiArrowRightLine,
  RiSettings3Line,
  RiGiftLine,
  RiCoupon3Line,
  RiExternalLinkLine,
  RiStarFill,
  RiRefreshLine,
  RiCheckDoubleLine,
  RiCloseCircleLine,
  RiTimerLine,
  RiBox3Line,
  RiFileListLine,
  RiArrowUpLine,
  RiArrowDownLine,
} from "@remixicon/react";
import { ReferralSection } from "@/components/ReferralSection";
import { PortalLayout } from "@/components/portal/PortalLayout";
import { toast } from "sonner";
import {
  format,
  isPast,
  isFuture,
  differenceInDays,
  differenceInHours,
  isToday,
} from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { RescheduleDialog } from "@/components/booking/RescheduleDialog";
import { ModifyBookingDialog } from "@/components/booking/ModifyBookingDialog";
import { RatingDialog } from "@/components/booking/RatingDialog";
import { CancelBookingDialog } from "@/components/booking/CancelBookingDialog";
import { cn } from "@/lib/utils";
import { SEO } from "@/components/SEO";

const BOOKING_URL = "https://try.novaracleaning.com/book/zip";
const goToBooking = () => {
  window.location.href = BOOKING_URL;
};

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
}

interface MembershipCredit {
  membership_plan: string;
  credits_per_month: number;
  credits_remaining: number;
  credits_used: number;
  current_period_start: string;
  current_period_end: string;
}

function MetricCard({
  label,
  value,
  subtext,
  icon: Icon,
  trend,
  accentClass,
}: {
  label: string;
  value: string | number;
  subtext?: string;
  icon: React.ElementType;
  trend?: "up" | "down" | "neutral";
  accentClass?: string;
}) {
  return (
    <Card className="shadow-sm border-border/60 hover:shadow-md transition-shadow">
      <CardContent className="p-4 md:p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {label}
            </p>
            <p className="text-2xl md:text-3xl font-bold tracking-tight">
              {value}
            </p>
            {subtext && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                {trend === "up" && (
                  <RiArrowUpLine className="w-3 h-3 text-emerald-500" />
                )}
                {trend === "down" && (
                  <RiArrowDownLine className="w-3 h-3 text-red-500" />
                )}
                {subtext}
              </p>
            )}
          </div>
          <div
            className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0",
              accentClass || "bg-primary/10"
            )}
          >
            <Icon
              className={cn(
                "w-5 h-5",
                accentClass ? "text-white" : "text-primary"
              )}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    confirmed: "bg-emerald-500",
    pending_payment: "bg-amber-500",
    cancelled: "bg-red-500",
    completed: "bg-primary",
  };
  return (
    <span className="relative flex h-2.5 w-2.5">
      {status === "confirmed" && (
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-50" />
      )}
      <span
        className={cn(
          "relative inline-flex rounded-full h-2.5 w-2.5",
          colors[status] || "bg-muted-foreground"
        )}
      />
    </span>
  );
}

function getStatusLabel(status: string) {
  const labels: Record<string, string> = {
    confirmed: "Confirmed",
    pending_payment: "Pending Payment",
    cancelled: "Cancelled",
    completed: "Completed",
  };
  return labels[status] || status;
}

function getStatusBadgeClass(status: string) {
  const classes: Record<string, string> = {
    confirmed:
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800",
    pending_payment:
      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800",
    cancelled:
      "bg-red-50 text-red-600 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800",
    completed:
      "bg-primary/5 text-primary border-primary/20",
  };
  return classes[status] || "bg-muted text-muted-foreground border-border";
}

export default function Account() {
  const router = useRouter();
  const {
    user,
    subscription,
    signOut,
    checkSubscription,
    openCustomerPortal,
    resetPassword,
  } = useAuth();
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [membershipCredits, setMembershipCredits] =
    useState<MembershipCredit | null>(null);
  const [isLoadingBookings, setIsLoadingBookings] = useState(true);
  const [rescheduleBooking, setRescheduleBooking] = useState<Booking | null>(
    null
  );
  const [rescheduleDialogOpen, setRescheduleDialogOpen] = useState(false);
  const [modifyBooking, setModifyBooking] = useState<Booking | null>(null);
  const [modifyDialogOpen, setModifyDialogOpen] = useState(false);
  const [ratingBooking, setRatingBooking] = useState<Booking | null>(null);
  const [ratingDialogOpen, setRatingDialogOpen] = useState(false);
  const [cancelBookingItem, setCancelBookingItem] = useState<Booking | null>(null);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cleanerNames, setCleanerNames] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!user) {
      router.push("/auth");
    } else {
      checkSubscription();
      fetchBookings();
      fetchMembershipCredits();
    }
  }, [user, router]);

  const fetchBookings = async () => {
    if (!user?.email) return;
    setIsLoadingBookings(true);
    setLoadError(false);
    try {
      const { data, error } = await supabase
        .from("bookings")
        .select("*")
        .eq("email", user.email)
        .order("service_date", { ascending: false });
      if (error) throw error;
      setBookings(data || []);
    } catch (error: any) {
      console.error("Error fetching bookings:", error);
      toast.error("Failed to load booking history");
      setLoadError(true);
    } finally {
      setIsLoadingBookings(false);
    }
  };

  const fetchMembershipCredits = async () => {
    if (!user?.email) return;
    try {
      const { data, error } = await supabase
        .from("membership_credits")
        .select("*")
        .eq("email", user.email)
        .maybeSingle();
      if (error) throw error;
      setMembershipCredits(data);
    } catch (error: any) {
      console.error("Error fetching membership credits:", error);
    }
  };

  const refreshData = () => {
    fetchBookings();
    fetchMembershipCredits();
  };

  useEffect(() => {
    if (!user?.email) return;
    const channel = supabase
      .channel("portal-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "bookings",
          filter: `email=eq.${user.email}`,
        },
        () => {
          fetchBookings();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "membership_credits",
          filter: `email=eq.${user.email}`,
        },
        () => {
          fetchMembershipCredits();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.email]);

  const handleManageSubscription = async () => {
    try {
      if (!subscription?.hasCustomer) {
        toast.error(
          "Please complete a booking first to access the customer portal"
        );
        return;
      }
      await openCustomerPortal();
    } catch (error: any) {
      const errorMessage = error.message || "Failed to open customer portal";
      if (errorMessage.includes("No Stripe customer found")) {
        toast.error(
          "No payment methods on file. Complete a booking to add one."
        );
      } else {
        toast.error(errorMessage);
      }
    }
  };

  const handleChangePassword = async () => {
    if (!user?.email) return;
    setIsResettingPassword(true);
    const { error } = await resetPassword(user.email);
    if (error) {
      toast.error(error.message || "Failed to send reset email");
    } else {
      toast.success("Password reset link sent to your email!");
    }
    setIsResettingPassword(false);
  };

  const handleReschedule = (booking: Booking) => {
    setRescheduleBooking(booking);
    setRescheduleDialogOpen(true);
  };

  const handleRescheduleSuccess = () => {
    fetchBookings();
    fetchMembershipCredits();
  };

  const handleModify = (booking: Booking) => {
    setModifyBooking(booking);
    setModifyDialogOpen(true);
  };

  const handleModifySuccess = () => {
    fetchBookings();
    fetchMembershipCredits();
  };

  const handleRating = async (booking: Booking) => {
    if (booking.cleaner_id && !cleanerNames[booking.cleaner_id]) {
      try {
        const { data } = await supabase
          .from("cleaners")
          .select("first_name, last_name")
          .eq("id", booking.cleaner_id)
          .single();
        if (data) {
          const fullName = [data.first_name, data.last_name].filter(Boolean).join(" ").trim();
          if (fullName) {
            setCleanerNames((prev) => ({ ...prev, [booking.cleaner_id!]: fullName }));
          }
        }
      } catch {
        // Use fallback "Your Cleaner" on error
      }
    }
    setRatingBooking(booking);
    setRatingDialogOpen(true);
  };

  const handleRatingSubmitted = () => {
    setRatingDialogOpen(false);
    setRatingBooking(null);
    fetchBookings();
  };

  const handleCancel = (booking: Booking) => {
    setCancelBookingItem(booking);
    setCancelDialogOpen(true);
  };

  const handleCancelSuccess = () => {
    fetchBookings();
    fetchMembershipCredits();
  };

  const getCountdown = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    if (isToday(date)) return "Today";
    const days = differenceInDays(date, now);
    if (days === 1) return "Tomorrow";
    if (days > 1) return `In ${days} days`;
    const hours = differenceInHours(date, now);
    if (hours > 0) return `In ${hours}h`;
    return "Today";
  };

  const upcomingBookings = bookings.filter(
    (b) => isFuture(new Date(b.service_date)) && b.status === "confirmed"
  );
  const nextBooking =
    upcomingBookings.length > 0
      ? upcomingBookings[upcomingBookings.length - 1]
      : null;
  const otherUpcoming = upcomingBookings.filter(
    (b) => b.id !== nextBooking?.id
  );
  const pastBookings = bookings.filter(
    (b) =>
      (isPast(new Date(b.service_date)) ||
        b.status === "completed" ||
        b.status === "cancelled") &&
      b.status !== "pending_payment"
  );
  const incompleteBookings = bookings
    .filter((b) => {
      if (b.status !== "pending_payment") return false;
      const bookingCreatedAt = new Date(b.created_at);
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      return bookingCreatedAt > twentyFourHoursAgo;
    })
    .slice(0, 1);

  const userName =
    user?.user_metadata?.full_name ||
    user?.email
      ?.split("@")[0]
      ?.replace(/[._]/g, " ")
      .replace(/\b\w/g, (l: string) => l.toUpperCase()) ||
    "there";

  const totalBookings = bookings.length;
  const completedBookings = bookings.filter(
    (b) => b.status === "completed"
  ).length;

  const creditProgress = membershipCredits
    ? Math.round(
        (membershipCredits.credits_used / membershipCredits.credits_per_month) *
          100
      )
    : 0;

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <RiLoader4Line className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <PortalLayout>
      <SEO
        title="Dashboard"
        description="Your Novara Cleaning control center. Track bookings, manage credits, and stay updated."
        noindex
      />

      <div className="p-4 md:p-6 lg:p-8 space-y-6 max-w-6xl">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <h1 className="text-xl md:text-2xl font-bold tracking-tight">
              Welcome back, {userName.split(" ")[0]}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Here's what's happening with your cleanings
            </p>
          </div>
          <Button
            size="sm"
            className="bg-gradient-primary shadow-md h-9 px-4 self-start sm:self-auto"
            onClick={goToBooking}
          >
            <RiCalendarLine className="w-4 h-4 mr-1.5" />
            Book Now
          </Button>
        </div>

        {/* Alert: Incomplete Booking */}
        {incompleteBookings.length > 0 &&
          incompleteBookings.map((booking) => (
            <Card
              key={booking.id}
              className="border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-950/20 shadow-md animate-fade-in-up"
            >
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center flex-shrink-0">
                      <RiAlertLine className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                    </div>
                    <div>
                      <p className="font-semibold text-sm">
                        Complete Your Booking
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(booking.service_date), "MMMM d")}{" "}
                        &middot; {booking.service_type} &middot; $
                        {(booking.total_estimate_cents / 100).toFixed(2)}
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="bg-amber-600 hover:bg-amber-700 text-white shadow-sm"
                    onClick={() =>
                      router.push(`/book/checkout?booking_id=${booking.id}`)
                    }
                  >
                    Complete Payment{" "}
                    <RiArrowRightLine className="w-3.5 h-3.5 ml-1.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}

        {/* Metrics Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <MetricCard
            label="Upcoming"
            value={upcomingBookings.length}
            subtext={
              nextBooking
                ? getCountdown(nextBooking.service_date)
                : "None scheduled"
            }
            icon={RiCalendarLine}
            trend={upcomingBookings.length > 0 ? "up" : "neutral"}
          />
          <MetricCard
            label="Completed"
            value={completedBookings}
            subtext={`of ${totalBookings} total`}
            icon={RiCheckDoubleLine}
          />
          <MetricCard
            label="Credits"
            value={membershipCredits?.credits_remaining ?? "—"}
            subtext={
              membershipCredits
                ? `${membershipCredits.credits_used} used this cycle`
                : "No active plan"
            }
            icon={RiCoupon3Line}
            accentClass={
              membershipCredits ? "bg-gradient-primary" : undefined
            }
          />
          <MetricCard
            label="Plan"
            value={
              membershipCredits
                ? membershipCredits.membership_plan
                    .charAt(0)
                    .toUpperCase() +
                  membershipCredits.membership_plan.slice(1)
                : "Free"
            }
            subtext={
              membershipCredits
                ? `Renews ${format(new Date(membershipCredits.current_period_end), "MMM d")}`
                : "Upgrade for savings"
            }
            icon={RiBox3Line}
          />
        </div>

        {/* Main Content: 2-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Left Column: Booking Tracker (2/3 width) */}
          <div className="lg:col-span-2 space-y-5">
            {/* Next Booking - Hero Card */}
            {nextBooking ? (
              <Card className="shadow-lg border-0 overflow-hidden animate-fade-in-up">
                <div
                  className="h-1 w-full"
                  style={{ background: "var(--gradient-primary)" }}
                />
                <CardHeader className="pb-0 pt-5 px-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <StatusDot status="confirmed" />
                      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-primary">
                        Next Cleaning
                      </span>
                    </div>
                    <Badge className="text-xs font-semibold bg-primary/10 text-primary border-primary/20 px-3 py-1">
                      {getCountdown(nextBooking.service_date)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="p-5 pt-3 space-y-4">
                  <div>
                    <h2 className="text-xl md:text-2xl font-bold tracking-tight">
                      {format(
                        new Date(nextBooking.service_date),
                        "EEEE, MMMM d"
                      )}
                    </h2>
                    <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-0.5">
                      <RiTimeLine className="w-3.5 h-3.5" />
                      {nextBooking.time_slot}
                    </p>
                  </div>

                  {/* Booking details grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 rounded-xl bg-muted/40 dark:bg-muted/20">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <RiMapPinLine className="w-4 h-4 text-primary" />
                      </div>
                      <div className="text-sm min-w-0">
                        <p className="font-medium truncate text-xs">
                          {nextBooking.address}
                        </p>
                        <p className="text-muted-foreground text-[11px]">
                          {nextBooking.city}, {nextBooking.state}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <RiSparklingLine className="w-4 h-4 text-primary" />
                      </div>
                      <div className="text-sm">
                        <p className="font-medium text-xs">
                          {nextBooking.service_type}
                        </p>
                        <p className="text-muted-foreground text-[11px]">
                          {nextBooking.home_size_id}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <RiBankCardLine className="w-4 h-4 text-primary" />
                      </div>
                      <div className="text-sm">
                        <p className="font-semibold text-primary text-xs">
                          $
                          {(nextBooking.total_estimate_cents / 100).toFixed(2)}
                        </p>
                        {nextBooking.uses_credit && (
                          <p className="text-muted-foreground text-[11px]">
                            Using credit
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 rounded-lg text-xs"
                      onClick={() => handleModify(nextBooking)}
                    >
                      <RiSettings3Line className="w-3.5 h-3.5 mr-1.5" />{" "}
                      Modify
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 rounded-lg text-xs"
                      onClick={() => handleReschedule(nextBooking)}
                    >
                      <RiCalendarLine className="w-3.5 h-3.5 mr-1.5" />{" "}
                      Reschedule
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 rounded-lg text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      onClick={() => handleCancel(nextBooking)}
                    >
                      <RiCloseLine className="w-3.5 h-3.5 mr-1.5" /> Cancel
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="border-dashed border-2 border-border/60 animate-fade-in-up">
                <CardContent className="py-10 md:py-14 text-center">
                  <div className="w-14 h-14 mx-auto rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                    <RiCalendarLine className="w-7 h-7 text-primary/60" />
                  </div>
                  <h2 className="text-lg font-bold mb-1">
                    No upcoming cleanings
                  </h2>
                  <p className="text-sm text-muted-foreground mb-5 max-w-xs mx-auto">
                    Schedule your next professional cleaning and let us handle
                    the rest.
                  </p>
                  <Button
                    onClick={goToBooking}
                    className="bg-gradient-primary shadow-md h-10 px-5"
                  >
                    <RiSparklingLine className="w-4 h-4 mr-2" /> Book a
                    Cleaning
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Booking History Tabs */}
            <Card className="shadow-sm">
              <Tabs defaultValue="upcoming" className="w-full">
                <CardHeader className="pb-0 px-5 pt-4">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold">
                      Booking History
                    </CardTitle>
                    <TabsList className="h-8 p-0.5 bg-muted/50 rounded-lg">
                      <TabsTrigger
                        value="upcoming"
                        className="text-xs h-7 rounded-md px-3 data-[state=active]:bg-background data-[state=active]:shadow-sm"
                      >
                        Upcoming
                        {otherUpcoming.length > 0 && (
                          <Badge
                            variant="secondary"
                            className="ml-1.5 h-4 px-1 text-[10px]"
                          >
                            {otherUpcoming.length}
                          </Badge>
                        )}
                      </TabsTrigger>
                      <TabsTrigger
                        value="past"
                        className="text-xs h-7 rounded-md px-3 data-[state=active]:bg-background data-[state=active]:shadow-sm"
                      >
                        Past
                      </TabsTrigger>
                    </TabsList>
                  </div>
                </CardHeader>
                <CardContent className="px-5 pb-4 pt-3">
                  <TabsContent value="upcoming" className="mt-0 space-y-2">
                    {otherUpcoming.length > 0 ? (
                      otherUpcoming.map((booking) => (
                        <div
                          key={booking.id}
                          className="flex items-center justify-between gap-3 p-3 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors group"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="text-center min-w-[44px] py-1.5 px-2.5 rounded-lg bg-primary/5">
                              <p className="text-[9px] uppercase tracking-wider font-semibold text-primary">
                                {format(
                                  new Date(booking.service_date),
                                  "MMM"
                                )}
                              </p>
                              <p className="text-lg font-bold leading-tight">
                                {format(new Date(booking.service_date), "d")}
                              </p>
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-sm truncate">
                                {booking.time_slot} &middot;{" "}
                                {booking.service_type}
                              </p>
                              <p className="text-xs text-muted-foreground truncate">
                                {booking.address}, {booking.city}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
                            <span className="font-semibold text-sm">
                              ${(booking.total_estimate_cents / 100).toFixed(2)}
                            </span>
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-xs h-7 rounded-lg px-2"
                              onClick={() => handleReschedule(booking)}
                            >
                              Reschedule
                            </Button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="py-8 text-center">
                        <RiFileListLine className="w-8 h-8 mx-auto text-muted-foreground/40 mb-2" />
                        <p className="text-sm text-muted-foreground">
                          No other upcoming bookings
                        </p>
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="past" className="mt-0 space-y-2">
                    {pastBookings.length > 0 ? (
                      pastBookings.slice(0, 10).map((booking) => (
                        <div
                          key={booking.id}
                          className="flex items-center justify-between gap-3 p-3 rounded-xl bg-muted/20 hover:bg-muted/30 transition-colors"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="text-center min-w-[40px]">
                              <p className="text-[9px] uppercase tracking-wider text-muted-foreground">
                                {format(
                                  new Date(booking.service_date),
                                  "MMM"
                                )}
                              </p>
                              <p className="text-base font-bold leading-tight">
                                {format(new Date(booking.service_date), "d")}
                              </p>
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-sm truncate">
                                {booking.service_type} &middot;{" "}
                                {booking.home_size_id}
                              </p>
                              <p className="text-xs text-muted-foreground truncate">
                                {booking.city}, {booking.state}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px] h-5 px-1.5",
                                getStatusBadgeClass(booking.status)
                              )}
                            >
                              {getStatusLabel(booking.status)}
                            </Badge>
                            <span className="text-sm font-medium">
                              $
                              {(booking.total_estimate_cents / 100).toFixed(2)}
                            </span>
                            {booking.status === "completed" &&
                              booking.cleaner_id &&
                              !booking.rating_submitted && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-xs h-6 rounded-lg px-2"
                                  onClick={() => handleRating(booking)}
                                >
                                  <RiStarLine className="w-3 h-3 mr-1" />{" "}
                                  Rate
                                </Button>
                              )}
                            {booking.rating_submitted && (
                              <Badge
                                variant="secondary"
                                className="text-[10px] h-5 px-1.5"
                              >
                                <RiStarFill className="w-3 h-3 text-amber-500" />
                              </Badge>
                            )}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="py-8 text-center">
                        <RiFileListLine className="w-8 h-8 mx-auto text-muted-foreground/40 mb-2" />
                        <p className="text-sm text-muted-foreground">
                          No past bookings yet
                        </p>
                      </div>
                    )}
                  </TabsContent>
                </CardContent>
              </Tabs>
            </Card>
          </div>

          {/* Right Column: Side Panels (1/3 width) */}
          <div className="space-y-5">
            {/* Membership Credits Panel */}
            {membershipCredits ? (
              <Card className="shadow-sm border-primary/15 overflow-hidden">
                <div
                  className="h-0.5 w-full"
                  style={{ background: "var(--gradient-primary)" }}
                />
                <CardContent className="p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center"
                        style={{ background: "var(--gradient-primary)" }}
                      >
                        <RiCoupon3Line className="w-4 h-4 text-white" />
                      </div>
                      <span className="font-semibold text-sm">
                        {membershipCredits.membership_plan
                          .charAt(0)
                          .toUpperCase() +
                          membershipCredits.membership_plan.slice(1)}{" "}
                        Plan
                      </span>
                    </div>
                    <Badge className="bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 text-[10px]">
                      Active
                    </Badge>
                  </div>

                  <div>
                    <div className="flex items-end justify-between mb-1.5">
                      <div>
                        <span className="text-2xl font-bold text-primary">
                          {membershipCredits.credits_remaining}
                        </span>
                        <span className="text-xs text-muted-foreground ml-1">
                          / {membershipCredits.credits_per_month}
                        </span>
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        {membershipCredits.credits_used} used
                      </span>
                    </div>
                    <Progress value={creditProgress} className="h-1.5" />
                    <p className="text-[10px] text-muted-foreground mt-1.5">
                      Renews{" "}
                      {format(
                        new Date(membershipCredits.current_period_end),
                        "MMM d, yyyy"
                      )}
                    </p>
                  </div>

                  {membershipCredits.credits_remaining > 0 && (
                    <Button
                      className="w-full h-9 bg-gradient-primary shadow-sm text-sm"
                      onClick={() => router.push("/portal/book")}
                    >
                      <RiCalendarLine className="w-4 h-4 mr-1.5" /> Use
                      Credit to Book
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card className="border-dashed border-2 border-primary/20">
                <CardContent className="p-4 text-center space-y-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mx-auto">
                    <RiGiftLine className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">
                      Save with a Membership
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Get monthly credits and save up to 42%
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-lg"
                    onClick={() => router.push("/membership")}
                  >
                    View Plans{" "}
                    <RiArrowRightLine className="w-3.5 h-3.5 ml-1.5" />
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Quick Actions */}
            <Card className="shadow-sm" id="settings">
              <CardHeader className="px-4 pt-4 pb-0">
                <CardTitle className="text-sm font-semibold">
                  Quick Actions
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-3 space-y-1.5">
                <button
                  onClick={goToBooking}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm hover:bg-muted/60 transition-colors text-left"
                >
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <RiCalendarLine className="w-4 h-4 text-primary" />
                  </div>
                  <span className="flex-1 font-medium">Book a Cleaning</span>
                  <RiArrowRightLine className="w-4 h-4 text-muted-foreground" />
                </button>

                {subscription?.hasCustomer && (
                  <button
                    onClick={handleManageSubscription}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm hover:bg-muted/60 transition-colors text-left"
                  >
                    <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                      <RiBankCardLine className="w-4 h-4 text-foreground" />
                    </div>
                    <span className="flex-1 font-medium">
                      Manage Billing
                    </span>
                    <RiExternalLinkLine className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                )}

                <button
                  onClick={() => router.push("/membership")}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm hover:bg-muted/60 transition-colors text-left"
                >
                  <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                    <RiBox3Line className="w-4 h-4 text-foreground" />
                  </div>
                  <span className="flex-1 font-medium">Membership</span>
                  <RiArrowRightLine className="w-4 h-4 text-muted-foreground" />
                </button>

                <button
                  onClick={handleChangePassword}
                  disabled={isResettingPassword}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm hover:bg-muted/60 transition-colors text-left disabled:opacity-50"
                >
                  <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                    <RiLockLine className="w-4 h-4 text-foreground" />
                  </div>
                  <span className="flex-1 font-medium">
                    {isResettingPassword
                      ? "Sending link..."
                      : "Change Password"}
                  </span>
                  <RiArrowRightLine className="w-4 h-4 text-muted-foreground" />
                </button>
              </CardContent>
            </Card>

            {/* Referral */}
            {user?.email && <ReferralSection email={user.email} />}
          </div>
        </div>

        {/* Loading state */}
        {isLoadingBookings && bookings.length === 0 && !loadError && (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <RiLoader4Line className="w-6 h-6 animate-spin text-primary mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                Loading your dashboard...
              </p>
            </div>
          </div>
        )}

        {/* Error state with retry */}
        {loadError && bookings.length === 0 && (
          <Card className="border-destructive/50">
            <CardContent className="py-8 text-center">
              <RiCloseCircleLine className="w-10 h-10 text-destructive mx-auto mb-3" />
              <p className="font-medium mb-1">Failed to load</p>
              <p className="text-sm text-muted-foreground mb-4">Try again</p>
              <Button variant="outline" onClick={refreshData}>
                <RiRefreshLine className="w-4 h-4 mr-2" />
                Retry
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Dialogs */}
      {rescheduleBooking && (
        <RescheduleDialog
          open={rescheduleDialogOpen}
          onOpenChange={setRescheduleDialogOpen}
          booking={rescheduleBooking}
          onSuccess={handleRescheduleSuccess}
        />
      )}
      {modifyBooking && (
        <ModifyBookingDialog
          open={modifyDialogOpen}
          onOpenChange={setModifyDialogOpen}
          booking={modifyBooking}
          onSuccess={handleModifySuccess}
        />
      )}
      {ratingBooking && (
        <RatingDialog
          open={ratingDialogOpen}
          onOpenChange={setRatingDialogOpen}
          bookingId={ratingBooking.id}
          cleanerName={
            ratingBooking.cleaner_id && cleanerNames[ratingBooking.cleaner_id]
              ? cleanerNames[ratingBooking.cleaner_id]
              : "Your Cleaner"
          }
          onRatingSubmitted={handleRatingSubmitted}
        />
      )}
      {cancelBookingItem && (
        <CancelBookingDialog
          open={cancelDialogOpen}
          onOpenChange={setCancelDialogOpen}
          booking={cancelBookingItem}
          onSuccess={handleCancelSuccess}
        />
      )}
    </PortalLayout>
  );
}
