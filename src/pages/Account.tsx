import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import {
  User, CreditCard, Calendar, LogOut, Loader2, CheckCircle2, Lock, Clock, MapPin,
  Package, AlertCircle, Home, X, ChevronDown, ChevronUp, Star, Sparkles, ArrowRight,
  Settings, Bell, Gift, Shield, Ticket, ExternalLink
} from "lucide-react";
import { ReferralSection } from "@/components/ReferralSection";
import { toast } from "sonner";
import { format, isPast, isFuture, differenceInDays, differenceInHours } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { RescheduleDialog } from "@/components/booking/RescheduleDialog";
import { ModifyBookingDialog } from "@/components/booking/ModifyBookingDialog";
import { RatingDialog } from "@/components/booking/RatingDialog";
import { cn } from "@/lib/utils";

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

export default function Account() {
  const navigate = useNavigate();
  const { user, subscription, signOut, checkSubscription, openCustomerPortal, resetPassword } = useAuth();
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [membershipCredits, setMembershipCredits] = useState<MembershipCredit | null>(null);
  const [isLoadingBookings, setIsLoadingBookings] = useState(true);
  const [rescheduleBooking, setRescheduleBooking] = useState<Booking | null>(null);
  const [rescheduleDialogOpen, setRescheduleDialogOpen] = useState(false);
  const [modifyBooking, setModifyBooking] = useState<Booking | null>(null);
  const [modifyDialogOpen, setModifyDialogOpen] = useState(false);
  const [ratingBooking, setRatingBooking] = useState<Booking | null>(null);
  const [ratingDialogOpen, setRatingDialogOpen] = useState(false);
  const [pastBookingsOpen, setPastBookingsOpen] = useState(false);

  useEffect(() => {
    if (!user) {
      navigate("/auth");
    } else {
      checkSubscription();
      fetchBookings();
      fetchMembershipCredits();
    }
  }, [user, navigate]);

  const fetchBookings = async () => {
    if (!user?.email) return;
    setIsLoadingBookings(true);
    try {
      const { data, error } = await supabase
        .from('bookings')
        .select('*')
        .eq('email', user.email)
        .order('service_date', { ascending: false });
      if (error) throw error;
      setBookings(data || []);
    } catch (error: any) {
      console.error('Error fetching bookings:', error);
      toast.error('Failed to load booking history');
    } finally {
      setIsLoadingBookings(false);
    }
  };

  const fetchMembershipCredits = async () => {
    if (!user?.email) return;
    try {
      const { data, error } = await supabase
        .from('membership_credits')
        .select('*')
        .eq('email', user.email)
        .maybeSingle();
      if (error) throw error;
      setMembershipCredits(data);
    } catch (error: any) {
      console.error('Error fetching membership credits:', error);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    toast.success("Signed out successfully");
    navigate("/");
  };

  const handleManageSubscription = async () => {
    try {
      if (!subscription?.hasCustomer) {
        toast.error("Please complete a booking first to access the customer portal");
        return;
      }
      await openCustomerPortal();
    } catch (error: any) {
      const errorMessage = error.message || "Failed to open customer portal";
      if (errorMessage.includes("No Stripe customer found")) {
        toast.error("No payment methods on file. Complete a booking to add one.");
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

  const handleRating = (booking: Booking) => {
    setRatingBooking(booking);
    setRatingDialogOpen(true);
  };

  const handleRatingSubmitted = () => {
    setRatingDialogOpen(false);
    setRatingBooking(null);
    fetchBookings();
  };

  const handleCancel = (booking: Booking) => {
    const ghlFormUrl = 'https://novaracleaning.com/cancel-booking';
    const params = new URLSearchParams({
      booking_id: booking.id,
      email: user?.email || '',
      customer_name: user?.email?.split('@')[0] || '',
      service_date: booking.service_date,
      time_slot: booking.time_slot,
      service_type: booking.service_type,
      address: `${booking.address}, ${booking.city}, ${booking.state}`,
      total_amount: (booking.total_estimate_cents / 100).toFixed(2),
    });
    window.open(`${ghlFormUrl}?${params.toString()}`, '_blank');
  };

  const getStatusConfig = (status: string) => {
    const configs: Record<string, { color: string; bg: string; label: string; dot: string }> = {
      confirmed: { color: "text-emerald-700 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800", label: "Confirmed", dot: "bg-emerald-500" },
      pending_payment: { color: "text-amber-700 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800", label: "Pending Payment", dot: "bg-amber-500" },
      cancelled: { color: "text-red-600 dark:text-red-400", bg: "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800", label: "Cancelled", dot: "bg-red-500" },
      completed: { color: "text-primary", bg: "bg-primary/5 border-primary/20", label: "Completed", dot: "bg-primary" },
    };
    return configs[status] || { color: "text-muted-foreground", bg: "bg-muted border-border", label: status, dot: "bg-muted-foreground" };
  };

  const getCountdown = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const days = differenceInDays(date, now);
    if (days > 1) return `${days} days away`;
    const hours = differenceInHours(date, now);
    if (hours > 0) return `${hours}h away`;
    return "Today";
  };

  const upcomingBookings = bookings.filter(b =>
    isFuture(new Date(b.service_date)) && b.status === 'confirmed'
  );
  const nextBooking = upcomingBookings.length > 0 ? upcomingBookings[upcomingBookings.length - 1] : null;
  const otherUpcoming = upcomingBookings.filter(b => b.id !== nextBooking?.id);
  const pastBookings = bookings.filter(b =>
    (isPast(new Date(b.service_date)) || b.status === 'completed' || b.status === 'cancelled') && b.status !== 'pending_payment'
  );
  const incompleteBookings = bookings
    .filter(b => {
      if (b.status !== 'pending_payment') return false;
      const bookingCreatedAt = new Date(b.created_at);
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      return bookingCreatedAt > twentyFourHoursAgo;
    })
    .slice(0, 1);

  const userName = user?.user_metadata?.full_name
    || user?.email?.split('@')[0]?.replace(/[._]/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    || 'there';
  const userInitials = userName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const creditProgress = membershipCredits
    ? Math.round((membershipCredits.credits_used / membershipCredits.credits_per_month) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-background">
      {/* Dashboard Header */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0" style={{ background: 'var(--gradient-primary)', opacity: 0.06 }} />
        <div className="relative border-b border-border/50">
          <div className="container max-w-5xl mx-auto px-4 py-5 md:py-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 md:gap-4">
                <div className="w-12 h-12 md:w-14 md:h-14 rounded-2xl flex items-center justify-center text-primary-foreground font-bold text-lg shadow-lg" style={{ background: 'var(--gradient-primary)' }}>
                  {userInitials}
                </div>
                <div>
                  <h1 className="text-lg md:text-xl font-bold tracking-tight">
                    Welcome back, {userName.split(' ')[0]}
                  </h1>
                  <p className="text-xs md:text-sm text-muted-foreground">{user.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 md:gap-2">
                <Button size="sm" onClick={() => navigate("/book/zip")} className="h-9 px-3 md:px-4 bg-gradient-primary shadow-md hover:shadow-lg transition-shadow">
                  <Calendar className="w-4 h-4 md:mr-1.5" />
                  <span className="hidden md:inline">Book Now</span>
                </Button>
                <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => navigate("/")}>
                  <Home className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-destructive" onClick={handleSignOut}>
                  <LogOut className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="container max-w-5xl mx-auto px-4 py-5 md:py-8 space-y-5 md:space-y-6">

        {/* Incomplete Booking Alert */}
        {incompleteBookings.length > 0 && (
          <div className="animate-fade-in-up">
            {incompleteBookings.map(booking => (
              <Card key={booking.id} className="border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-950/20 shadow-md">
                <CardContent className="p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center flex-shrink-0">
                        <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                      </div>
                      <div>
                        <p className="font-semibold text-sm">Complete Your Booking</p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(booking.service_date), "MMMM d")} &middot; {booking.service_type} &middot; ${(booking.total_estimate_cents / 100).toFixed(2)}
                        </p>
                      </div>
                    </div>
                    <Button size="sm" className="bg-amber-600 hover:bg-amber-700 text-white shadow-sm"
                      onClick={() => navigate(`/book/checkout?booking_id=${booking.id}`)}>
                      Complete Payment <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Next Booking Hero */}
        {nextBooking ? (
          <Card className="animate-fade-in-up overflow-hidden shadow-lg border-0">
            <div className="h-1 w-full" style={{ background: 'var(--gradient-primary)' }} />
            <CardContent className="p-5 md:p-7">
              <div className="flex items-start justify-between mb-5">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-primary">Next Cleaning</span>
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  </div>
                  <h2 className="text-2xl md:text-3xl font-bold tracking-tight">
                    {format(new Date(nextBooking.service_date), "EEEE, MMMM d")}
                  </h2>
                  <p className="text-muted-foreground mt-0.5 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    {nextBooking.time_slot}
                  </p>
                </div>
                <Badge className="text-xs font-semibold bg-primary/10 text-primary border-primary/20 px-3 py-1.5">
                  {getCountdown(nextBooking.service_date)}
                </Badge>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 rounded-xl bg-muted/40 dark:bg-muted/20 mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <MapPin className="w-4 h-4 text-primary" />
                  </div>
                  <div className="text-sm min-w-0">
                    <p className="font-medium truncate">{nextBooking.address}</p>
                    <p className="text-muted-foreground text-xs">{nextBooking.city}, {nextBooking.state}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Sparkles className="w-4 h-4 text-primary" />
                  </div>
                  <div className="text-sm">
                    <p className="font-medium">{nextBooking.service_type}</p>
                    <p className="text-muted-foreground text-xs">{nextBooking.home_size_id}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <CreditCard className="w-4 h-4 text-primary" />
                  </div>
                  <div className="text-sm">
                    <p className="font-semibold text-primary">${(nextBooking.total_estimate_cents / 100).toFixed(2)}</p>
                    {nextBooking.uses_credit && <p className="text-muted-foreground text-xs">Using credit</p>}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" className="h-9 rounded-lg" onClick={() => handleModify(nextBooking)}>
                  <Settings className="w-3.5 h-3.5 mr-1.5" /> Modify
                </Button>
                <Button variant="outline" size="sm" className="h-9 rounded-lg" onClick={() => handleReschedule(nextBooking)}>
                  <Calendar className="w-3.5 h-3.5 mr-1.5" /> Reschedule
                </Button>
                <Button variant="ghost" size="sm" className="h-9 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={() => handleCancel(nextBooking)}>
                  <X className="w-3.5 h-3.5 mr-1.5" /> Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="animate-fade-in-up border-dashed border-2 border-border/60">
            <CardContent className="py-12 md:py-16 text-center">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                <Calendar className="w-8 h-8 text-primary/60" />
              </div>
              <h2 className="text-xl font-bold mb-1.5">No upcoming cleanings</h2>
              <p className="text-sm text-muted-foreground mb-5 max-w-xs mx-auto">
                Schedule your next professional cleaning and let us handle the rest.
              </p>
              <Button onClick={() => navigate("/book/zip")} className="bg-gradient-primary shadow-md h-11 px-6">
                <Sparkles className="w-4 h-4 mr-2" /> Book a Cleaning
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Membership + Account Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
          {/* Membership Credits Card */}
          {membershipCredits ? (
            <Card className="animate-fade-in-up stagger-1 shadow-md border-primary/15 overflow-hidden">
              <div className="h-0.5 w-full" style={{ background: 'var(--gradient-primary)' }} />
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: 'var(--gradient-primary)' }}>
                      <Ticket className="w-4.5 h-4.5 text-white" />
                    </div>
                    <div>
                      <span className="font-semibold text-sm">
                        {membershipCredits.membership_plan.charAt(0).toUpperCase() + membershipCredits.membership_plan.slice(1)} Plan
                      </span>
                      <p className="text-[11px] text-muted-foreground">Renews {format(new Date(membershipCredits.current_period_end), "MMM d")}</p>
                    </div>
                  </div>
                  <Badge className="bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 text-xs">Active</Badge>
                </div>

                <div className="mb-4">
                  <div className="flex items-end justify-between mb-2">
                    <div>
                      <span className="text-3xl font-bold text-primary">{membershipCredits.credits_remaining}</span>
                      <span className="text-sm text-muted-foreground ml-1">/ {membershipCredits.credits_per_month}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{membershipCredits.credits_used} used this cycle</span>
                  </div>
                  <Progress value={creditProgress} className="h-2" />
                </div>

                {membershipCredits.credits_remaining > 0 && (
                  <Button className="w-full h-10 bg-gradient-primary shadow-sm" onClick={() => navigate("/portal/book")}>
                    <Calendar className="w-4 h-4 mr-2" /> Use Credit to Book
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card className="animate-fade-in-up stagger-1 border-dashed border-2 border-primary/20">
              <CardContent className="p-5 flex flex-col items-center justify-center text-center h-full min-h-[200px]">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
                  <Gift className="w-6 h-6 text-primary" />
                </div>
                <p className="font-semibold mb-1">Save with a Membership</p>
                <p className="text-xs text-muted-foreground mb-4 max-w-[200px]">Get monthly credits and save up to 30% on every clean</p>
                <Button variant="outline" size="sm" onClick={() => navigate("/membership")} className="rounded-lg">
                  View Plans <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Account & Quick Actions */}
          <Card className="animate-fade-in-up stagger-2 shadow-md">
            <CardContent className="p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
                  <User className="w-5 h-5 text-foreground" />
                </div>
                <div>
                  <p className="font-semibold text-sm">Account Settings</p>
                  <p className="text-xs text-muted-foreground truncate max-w-[180px]">{user.email}</p>
                </div>
              </div>
              <Separator className="mb-4" />
              <div className="grid grid-cols-2 gap-2.5">
                <Button variant="outline" size="sm" className="justify-start text-xs h-10 rounded-lg"
                  onClick={() => navigate("/book/zip")}>
                  <Calendar className="w-4 h-4 mr-2 text-primary" /> Book Cleaning
                </Button>
                {subscription?.hasCustomer && (
                  <Button variant="outline" size="sm" className="justify-start text-xs h-10 rounded-lg"
                    onClick={handleManageSubscription}>
                    <CreditCard className="w-4 h-4 mr-2 text-primary" /> Billing
                  </Button>
                )}
                <Button variant="outline" size="sm" className="justify-start text-xs h-10 rounded-lg"
                  onClick={handleChangePassword} disabled={isResettingPassword}>
                  <Lock className="w-4 h-4 mr-2 text-primary" /> {isResettingPassword ? "Sending..." : "Password"}
                </Button>
                <Button variant="outline" size="sm" className="justify-start text-xs h-10 rounded-lg"
                  onClick={() => navigate("/membership")}>
                  <Package className="w-4 h-4 mr-2 text-primary" /> Membership
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Referral */}
        <div className="animate-fade-in-up stagger-3">
          {user?.email && <ReferralSection email={user.email} />}
        </div>

        {/* Other Upcoming Bookings */}
        {otherUpcoming.length > 0 && (
          <div className="space-y-3 animate-fade-in-up stagger-4">
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-[0.1em] px-1">
              Upcoming ({otherUpcoming.length})
            </h3>
            <div className="space-y-2.5">
              {otherUpcoming.map(booking => {
                const sc = getStatusConfig(booking.status);
                return (
                  <Card key={booking.id} className="shadow-sm hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-4">
                          <div className="text-center min-w-[48px] py-2 px-3 rounded-xl bg-primary/5">
                            <p className="text-[10px] uppercase tracking-wider font-semibold text-primary">{format(new Date(booking.service_date), 'MMM')}</p>
                            <p className="text-xl font-bold leading-tight">{format(new Date(booking.service_date), 'd')}</p>
                          </div>
                          <div>
                            <p className="font-medium text-sm">{booking.time_slot} &middot; {booking.service_type}</p>
                            <p className="text-xs text-muted-foreground">{booking.address}, {booking.city}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 pl-16 sm:pl-0">
                          <span className="font-semibold text-sm">${(booking.total_estimate_cents / 100).toFixed(2)}</span>
                          <Button variant="outline" size="sm" className="text-xs h-8 rounded-lg" onClick={() => handleReschedule(booking)}>Reschedule</Button>
                          <Button variant="ghost" size="sm" className="text-xs h-8 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={() => handleCancel(booking)}>Cancel</Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {/* Past Bookings */}
        {pastBookings.length > 0 && (
          <Collapsible open={pastBookingsOpen} onOpenChange={setPastBookingsOpen}>
            <CollapsibleTrigger asChild>
              <button className="w-full flex items-center justify-between py-3 px-1 text-muted-foreground hover:text-foreground transition-colors group">
                <span className="text-xs font-bold uppercase tracking-[0.1em]">
                  Past Bookings ({pastBookings.length})
                </span>
                <ChevronDown className={cn("w-4 h-4 transition-transform duration-200", pastBookingsOpen && "rotate-180")} />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2 mt-1">
              {pastBookings.map(booking => {
                const sc = getStatusConfig(booking.status);
                return (
                  <Card key={booking.id} className="bg-muted/20 border-border/60 shadow-none">
                    <CardContent className="p-3.5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="text-center min-w-[40px]">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{format(new Date(booking.service_date), 'MMM')}</p>
                            <p className="text-base font-bold leading-tight">{format(new Date(booking.service_date), 'd')}</p>
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate">{booking.service_type} &middot; {booking.home_size_id}</p>
                            <p className="text-xs text-muted-foreground truncate">{booking.city}, {booking.state}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <div className="flex items-center gap-1.5">
                            <div className={cn("w-1.5 h-1.5 rounded-full", sc.dot)} />
                            <span className={cn("text-xs font-medium", sc.color)}>{sc.label}</span>
                          </div>
                          <span className="text-sm font-medium ml-1">${(booking.total_estimate_cents / 100).toFixed(2)}</span>
                          {booking.status === "completed" && booking.cleaner_id && !booking.rating_submitted && (
                            <Button size="sm" variant="outline" className="text-xs h-7 rounded-lg ml-1" onClick={() => handleRating(booking)}>
                              <Star className="w-3 h-3 mr-1" /> Rate
                            </Button>
                          )}
                          {booking.rating_submitted && (
                            <Badge variant="secondary" className="text-[10px] h-6"><Star className="w-3 h-3 mr-0.5 fill-current text-amber-500" /> Rated</Badge>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Loading state for bookings */}
        {isLoadingBookings && bookings.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Loading your bookings...</p>
            </div>
          </div>
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
          cleanerName="Your Cleaner"
          onRatingSubmitted={handleRatingSubmitted}
        />
      )}
    </div>
  );
}
