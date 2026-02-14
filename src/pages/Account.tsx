import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  User, CreditCard, Calendar, LogOut, Loader2, CheckCircle2, Lock, Clock, MapPin,
  Package, AlertCircle, Home, X, ChevronDown, ChevronUp, Star, Sparkles, ArrowRight
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
    const configs: Record<string, { color: string; bg: string; label: string }> = {
      confirmed: { color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200", label: "Confirmed" },
      pending_payment: { color: "text-amber-700", bg: "bg-amber-50 border-amber-200", label: "Pending Payment" },
      cancelled: { color: "text-destructive", bg: "bg-destructive/10 border-destructive/20", label: "Cancelled" },
      completed: { color: "text-primary", bg: "bg-primary/10 border-primary/20", label: "Completed" },
    };
    return configs[status] || { color: "text-muted-foreground", bg: "bg-muted border-border", label: status };
  };

  const getCountdown = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const days = differenceInDays(date, now);
    if (days > 1) return `in ${days} days`;
    const hours = differenceInHours(date, now);
    if (hours > 0) return `in ${hours} hours`;
    return "today";
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

  const userName = user?.email?.split('@')[0]?.replace(/[._]/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'there';

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--gradient-hero)' }}>
      {/* Header */}
      <div className="border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-20">
        <div className="container max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl md:text-2xl font-bold">Welcome back, {userName} 👋</h1>
            <p className="text-sm text-muted-foreground">{user.email}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => navigate("/book/zip")}>
              <Calendar className="w-4 h-4 mr-1" /> Book
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
              <Home className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={handleSignOut}>
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="container max-w-5xl mx-auto px-4 py-6 space-y-6">

        {/* Incomplete Bookings Alert */}
        {incompleteBookings.length > 0 && (
          <Card className="border-2 border-amber-300 bg-amber-50/50">
            <CardContent className="p-4">
              {incompleteBookings.map(booking => (
                <div key={booking.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
                    <div>
                      <p className="font-semibold text-sm">Incomplete Booking</p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(booking.service_date), "MMMM d")} • {booking.service_type} • ${(booking.total_estimate_cents / 100).toFixed(2)}
                      </p>
                    </div>
                  </div>
                  <Button size="sm" className="bg-amber-600 hover:bg-amber-700 text-white"
                    onClick={() => navigate(`/book/checkout?booking_id=${booking.id}`)}>
                    Complete Payment <ArrowRight className="w-3 h-3 ml-1" />
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Hero: Next Booking */}
        {nextBooking ? (
          <Card className="border-2 border-primary/30 overflow-hidden">
            <div className="h-1.5 w-full" style={{ background: 'var(--gradient-primary)' }} />
            <CardContent className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-primary mb-1">Next Cleaning</p>
                  <h2 className="text-2xl md:text-3xl font-bold">
                    {format(new Date(nextBooking.service_date), "EEEE, MMMM d")}
                  </h2>
                  <p className="text-muted-foreground mt-1">{nextBooking.time_slot}</p>
                </div>
                <Badge variant="secondary" className="text-sm font-semibold bg-primary/10 text-primary border-primary/20">
                  <Sparkles className="w-3 h-3 mr-1" />
                  {getCountdown(nextBooking.service_date)}
                </Badge>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
                <div className="flex items-start gap-2">
                  <MapPin className="w-4 h-4 text-muted-foreground mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium">{nextBooking.address}</p>
                    <p className="text-muted-foreground">{nextBooking.city}, {nextBooking.state}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Package className="w-4 h-4 text-muted-foreground mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium">{nextBooking.service_type}</p>
                    <p className="text-muted-foreground">{nextBooking.home_size_id}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <CreditCard className="w-4 h-4 text-muted-foreground mt-0.5" />
                  <div className="text-sm">
                    <p className="font-semibold text-primary">${(nextBooking.total_estimate_cents / 100).toFixed(2)}</p>
                    {nextBooking.uses_credit && <p className="text-muted-foreground">Using credit</p>}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => handleModify(nextBooking)}>
                  Modify
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleReschedule(nextBooking)}>
                  <Calendar className="w-3 h-3 mr-1" /> Reschedule
                </Button>
                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => handleCancel(nextBooking)}>
                  <X className="w-3 h-3 mr-1" /> Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-2 border-dashed border-primary/30">
            <CardContent className="p-8 text-center">
              <Calendar className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
              <h2 className="text-lg font-semibold mb-1">No upcoming cleanings</h2>
              <p className="text-sm text-muted-foreground mb-4">Book your next cleaning today</p>
              <Button onClick={() => navigate("/book/zip")}>
                <Sparkles className="w-4 h-4 mr-1" /> Book a Cleaning
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Membership + Account Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Membership Credits */}
          {membershipCredits ? (
            <Card className="border-primary/20" style={{ background: 'var(--gradient-lavender)' }}>
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Package className="w-5 h-5 text-primary" />
                    <span className="font-semibold text-sm">
                      {membershipCredits.membership_plan.charAt(0).toUpperCase() + membershipCredits.membership_plan.slice(1)} Membership
                    </span>
                  </div>
                  <Badge variant="default" className="bg-primary">Active</Badge>
                </div>
                <div className="grid grid-cols-3 gap-3 text-center mb-4">
                  <div className="rounded-lg bg-background/60 p-3">
                    <p className="text-2xl font-bold text-primary">{membershipCredits.credits_remaining}</p>
                    <p className="text-xs text-muted-foreground">Available</p>
                  </div>
                  <div className="rounded-lg bg-background/60 p-3">
                    <p className="text-2xl font-bold">{membershipCredits.credits_used}</p>
                    <p className="text-xs text-muted-foreground">Used</p>
                  </div>
                  <div className="rounded-lg bg-background/60 p-3">
                    <p className="text-lg font-bold">{format(new Date(membershipCredits.current_period_end), "MMM d")}</p>
                    <p className="text-xs text-muted-foreground">Refreshes</p>
                  </div>
                </div>
                {membershipCredits.credits_remaining > 0 && (
                  <Button className="w-full" onClick={() => navigate("/portal/book")}>
                    <Calendar className="w-4 h-4 mr-2" /> Use Credit to Book
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card className="border-primary/20">
              <CardContent className="p-5 flex flex-col items-center justify-center text-center h-full">
                <Sparkles className="w-8 h-8 text-primary mb-2" />
                <p className="font-semibold mb-1">Save with a Membership</p>
                <p className="text-xs text-muted-foreground mb-3">Get monthly credits and save up to 20%</p>
                <Button variant="outline" size="sm" onClick={() => navigate("/membership")}>
                  View Plans
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Account & Quick Actions */}
          <Card className="border-border">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'var(--gradient-primary)' }}>
                  <User className="w-5 h-5 text-primary-foreground" />
                </div>
                <div>
                  <p className="font-semibold text-sm">Account</p>
                  <p className="text-xs text-muted-foreground">{user.email}</p>
                </div>
              </div>
              <Separator />
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" size="sm" className="justify-start text-xs h-9"
                  onClick={() => navigate("/book/zip")}>
                  <Calendar className="w-3 h-3 mr-1" /> Book Cleaning
                </Button>
                {subscription?.hasCustomer && (
                  <Button variant="outline" size="sm" className="justify-start text-xs h-9"
                    onClick={handleManageSubscription}>
                    <CreditCard className="w-3 h-3 mr-1" /> Billing
                  </Button>
                )}
                <Button variant="outline" size="sm" className="justify-start text-xs h-9"
                  onClick={handleChangePassword} disabled={isResettingPassword}>
                  <Lock className="w-3 h-3 mr-1" /> {isResettingPassword ? "Sending..." : "Password"}
                </Button>
                <Button variant="outline" size="sm" className="justify-start text-xs h-9"
                  onClick={() => navigate("/membership")}>
                  <Package className="w-3 h-3 mr-1" /> Plans
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Referral */}
        {user?.email && <ReferralSection email={user.email} />}

        {/* Other Upcoming Bookings */}
        {otherUpcoming.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Upcoming Bookings ({otherUpcoming.length})
            </h3>
            <div className="space-y-2">
              {otherUpcoming.map(booking => {
                const sc = getStatusConfig(booking.status);
                return (
                  <Card key={booking.id} className={cn("border", sc.bg)}>
                    <CardContent className="p-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-4">
                          <div className="text-center min-w-[50px]">
                            <p className="text-xs text-muted-foreground">{format(new Date(booking.service_date), 'MMM')}</p>
                            <p className="text-2xl font-bold">{format(new Date(booking.service_date), 'd')}</p>
                          </div>
                          <div>
                            <p className="font-medium text-sm">{booking.time_slot} • {booking.service_type}</p>
                            <p className="text-xs text-muted-foreground">{booking.address}, {booking.city}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm">${(booking.total_estimate_cents / 100).toFixed(2)}</span>
                          <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => handleReschedule(booking)}>Reschedule</Button>
                          <Button variant="ghost" size="sm" className="text-xs h-7 text-destructive" onClick={() => handleCancel(booking)}>Cancel</Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {/* Past Bookings - Collapsible */}
        {pastBookings.length > 0 && (
          <Collapsible open={pastBookingsOpen} onOpenChange={setPastBookingsOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="w-full justify-between text-muted-foreground hover:text-foreground">
                <span className="text-sm font-semibold uppercase tracking-wide">
                  Past Bookings ({pastBookings.length})
                </span>
                {pastBookingsOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2 mt-2">
              {pastBookings.map(booking => {
                const sc = getStatusConfig(booking.status);
                return (
                  <Card key={booking.id} className="border bg-muted/30">
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="text-center min-w-[40px]">
                            <p className="text-xs text-muted-foreground">{format(new Date(booking.service_date), 'MMM')}</p>
                            <p className="text-lg font-bold">{format(new Date(booking.service_date), 'd')}</p>
                          </div>
                          <div>
                            <p className="font-medium text-sm">{booking.service_type} • {booking.home_size_id}</p>
                            <p className="text-xs text-muted-foreground">{booking.city}, {booking.state}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={cn("text-xs", sc.color)}>{sc.label}</Badge>
                          <span className="text-sm font-medium">${(booking.total_estimate_cents / 100).toFixed(2)}</span>
                          {booking.status === "completed" && booking.cleaner_id && !booking.rating_submitted && (
                            <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => handleRating(booking)}>
                              <Star className="w-3 h-3 mr-1" /> Rate
                            </Button>
                          )}
                          {booking.rating_submitted && (
                            <Badge variant="secondary" className="text-xs"><Star className="w-3 h-3 mr-0.5 fill-current" /> Rated</Badge>
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
      </div>

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
