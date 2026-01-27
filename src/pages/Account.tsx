import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { 
  User, CreditCard, Calendar, LogOut, Settings, Loader2, CheckCircle2, 
  Lock, Clock, MapPin, Package, AlertCircle, Home, X, UserPlus,
  TrendingUp, DollarSign, Star, RefreshCw, Bell, ChevronRight,
  Sparkles, ArrowRight, Eye, EyeOff, Shield
} from "lucide-react";
import { ReferralSection } from "@/components/ReferralSection";
import { toast } from "sonner";
import { format, isPast, isFuture, differenceInDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RescheduleDialog } from "@/components/booking/RescheduleDialog";
import { ModifyBookingDialog } from "@/components/booking/ModifyBookingDialog";
import { RatingDialog } from "@/components/booking/RatingDialog";

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

interface TransactionMetrics {
  totalSpent: number;
  bookingsCount: number;
  avgBookingValue: number;
  creditsUsed: number;
  savingsFromMembership: number;
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
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [activeTab, setActiveTab] = useState("overview");

  // Computed metrics
  const [metrics, setMetrics] = useState<TransactionMetrics>({
    totalSpent: 0,
    bookingsCount: 0,
    avgBookingValue: 0,
    creditsUsed: 0,
    savingsFromMembership: 0,
  });

  const fetchData = useCallback(async () => {
    if (!user?.email) return;
    
    setIsRefreshing(true);
    try {
      // Fetch bookings
      const { data: bookingsData, error: bookingsError } = await supabase
        .from('bookings')
        .select('*')
        .eq('email', user.email)
        .order('service_date', { ascending: false });

      if (bookingsError) throw bookingsError;
      setBookings(bookingsData || []);

      // Calculate metrics
      const completedBookings = (bookingsData || []).filter(b => b.status === 'completed' || b.status === 'confirmed');
      const totalSpent = completedBookings.reduce((acc, b) => acc + (b.total_estimate_cents / 100), 0);
      const creditsUsedCount = completedBookings.filter(b => b.uses_credit).length;
      
      setMetrics({
        totalSpent,
        bookingsCount: completedBookings.length,
        avgBookingValue: completedBookings.length > 0 ? totalSpent / completedBookings.length : 0,
        creditsUsed: creditsUsedCount,
        savingsFromMembership: creditsUsedCount * 50, // Estimated $50 savings per credit
      });

      // Fetch membership credits
      const { data: creditsData, error: creditsError } = await supabase
        .from('membership_credits')
        .select('*')
        .eq('email', user.email)
        .maybeSingle();

      if (creditsError) throw creditsError;
      setMembershipCredits(creditsData);
      
      setLastUpdated(new Date());
    } catch (error: any) {
      console.error('Error fetching data:', error);
      toast.error('Failed to load account data');
    } finally {
      setIsLoadingBookings(false);
      setIsRefreshing(false);
    }
  }, [user?.email]);

  useEffect(() => {
    if (!user) {
      navigate("/auth");
    } else {
      checkSubscription();
      fetchData();
    }
  }, [user, navigate, checkSubscription, fetchData]);

  // Set up real-time subscription for bookings
  useEffect(() => {
    if (!user?.email) return;

    const channel = supabase
      .channel('bookings-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bookings',
          filter: `email=eq.${user.email}`,
        },
        () => {
          // Refresh data when bookings change
          fetchData();
          toast.info('Booking updated', { duration: 2000 });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.email, fetchData]);

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

  const handleModify = (booking: Booking) => {
    setModifyBooking(booking);
    setModifyDialogOpen(true);
  };

  const handleRating = (booking: Booking) => {
    setRatingBooking(booking);
    setRatingDialogOpen(true);
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

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { variant: "default" | "secondary" | "destructive" | "outline", label: string, className?: string }> = {
      confirmed: { variant: "default", label: "Confirmed", className: "bg-green-500" },
      pending_payment: { variant: "secondary", label: "Pending", className: "bg-amber-500 text-white" },
      cancelled: { variant: "destructive", label: "Cancelled" },
      completed: { variant: "outline", label: "Completed" },
    };
    
    const config = variants[status] || { variant: "outline", label: status };
    return <Badge variant={config.variant} className={config.className}>{config.label}</Badge>;
  };

  const upcomingBookings = bookings.filter(b => 
    isFuture(new Date(b.service_date)) && 
    b.status === 'confirmed'
  );
  const pastBookings = bookings.filter(b => 
    (isPast(new Date(b.service_date)) || b.status === 'completed' || b.status === 'cancelled') && 
    b.status !== 'pending_payment'
  );
  const pendingBookings = bookings.filter(b => b.status === 'pending_payment');

  // Next cleaning countdown
  const nextCleaning = upcomingBookings[0];
  const daysUntilNext = nextCleaning ? differenceInDays(new Date(nextCleaning.service_date), new Date()) : null;

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-hero flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Mobile-optimized Header */}
      <header className="sticky top-0 z-50 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src="/novara-logo.png" alt="Novara" className="h-9 w-9 rounded-xl" />
              <div className="hidden sm:block">
                <h1 className="font-bold text-lg text-slate-900">My Account</h1>
                <p className="text-xs text-slate-500">Welcome back!</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button 
                variant="ghost" 
                size="icon"
                onClick={fetchData}
                disabled={isRefreshing}
                className="relative"
              >
                <RefreshCw className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`} />
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigate("/")}>
                <Home className="w-4 h-4 sm:mr-2" />
                <span className="hidden sm:inline">Home</span>
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Quick Stats - Mobile Optimized Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {/* Next Cleaning */}
          <Card className="col-span-2 bg-gradient-to-br from-primary to-primary/80 text-white border-0">
            <CardContent className="p-4 sm:p-6">
              {nextCleaning ? (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-white/80 text-sm">Next Cleaning</p>
                    <p className="text-2xl sm:text-3xl font-bold">
                      {daysUntilNext === 0 ? 'Today!' : `${daysUntilNext} days`}
                    </p>
                    <p className="text-white/90 text-sm mt-1">
                      {format(new Date(nextCleaning.service_date), "EEE, MMM d")} • {nextCleaning.time_slot}
                    </p>
                  </div>
                  <Calendar className="w-12 h-12 text-white/30" />
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-white/80 text-sm">No Upcoming Cleanings</p>
                    <Button 
                      size="sm" 
                      className="mt-2 bg-white text-primary hover:bg-white/90"
                      onClick={() => navigate("/book/zip")}
                    >
                      Book Now
                    </Button>
                  </div>
                  <Calendar className="w-12 h-12 text-white/30" />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Total Spent */}
          <Card className="border-slate-200">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-500 text-xs sm:text-sm">Total Spent</p>
                  <p className="text-xl sm:text-2xl font-bold text-slate-900">
                    ${metrics.totalSpent.toFixed(0)}
                  </p>
                </div>
                <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                  <DollarSign className="w-5 h-5 text-green-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Bookings Count */}
          <Card className="border-slate-200">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-500 text-xs sm:text-sm">Cleanings</p>
                  <p className="text-xl sm:text-2xl font-bold text-slate-900">
                    {metrics.bookingsCount}
                  </p>
                </div>
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Membership Credits Card */}
        {membershipCredits && (
          <Card className="border-2 border-primary/30 bg-gradient-to-r from-primary/5 to-white overflow-hidden">
            <CardContent className="p-4 sm:p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center shadow-lg shadow-primary/30">
                    <Package className="w-7 h-7 text-white" />
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">Membership Credits</p>
                    <p className="text-3xl font-bold text-primary">{membershipCredits.credits_remaining}</p>
                    <p className="text-xs text-slate-500">
                      Refreshes {format(new Date(membershipCredits.current_period_end), "MMM d")}
                    </p>
                  </div>
                </div>
                <div className="flex-1 max-w-xs">
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-slate-600">Used this period</span>
                    <span className="font-medium">{membershipCredits.credits_used}/{membershipCredits.credits_per_month}</span>
                  </div>
                  <Progress 
                    value={(membershipCredits.credits_used / membershipCredits.credits_per_month) * 100} 
                    className="h-2"
                  />
                </div>
              </div>
              {metrics.savingsFromMembership > 0 && (
                <div className="mt-4 pt-4 border-t border-primary/10 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-green-600" />
                  <span className="text-sm text-green-600 font-medium">
                    You've saved ~${metrics.savingsFromMembership} with your membership!
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Pending Payments Alert */}
        {pendingBookings.length > 0 && (
          <Alert className="border-amber-300 bg-amber-50">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <span className="text-amber-800">
                You have {pendingBookings.length} booking{pendingBookings.length > 1 ? 's' : ''} awaiting payment
              </span>
              <Button 
                size="sm" 
                className="bg-amber-600 hover:bg-amber-700"
                onClick={() => navigate(`/book/checkout?booking_id=${pendingBookings[0].id}`)}
              >
                Complete Payment
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Main Content Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-4 h-12 p-1 bg-slate-100">
            <TabsTrigger value="overview" className="text-xs sm:text-sm">Overview</TabsTrigger>
            <TabsTrigger value="bookings" className="text-xs sm:text-sm">Bookings</TabsTrigger>
            <TabsTrigger value="billing" className="text-xs sm:text-sm">Billing</TabsTrigger>
            <TabsTrigger value="settings" className="text-xs sm:text-sm">Settings</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6 mt-6">
            {/* Upcoming Cleanings */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Calendar className="w-5 h-5 text-primary" />
                    Upcoming Cleanings
                  </CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => setActiveTab("bookings")}>
                    View All <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {isLoadingBookings ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  </div>
                ) : upcomingBookings.length === 0 ? (
                  <div className="text-center py-8">
                    <Calendar className="w-12 h-12 mx-auto text-slate-300 mb-3" />
                    <p className="text-slate-500 mb-4">No upcoming cleanings</p>
                    <Button onClick={() => navigate("/book/zip")} className="bg-primary">
                      Book a Cleaning
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {upcomingBookings.slice(0, 3).map((booking) => (
                      <div 
                        key={booking.id} 
                        className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-100 gap-3"
                      >
                        <div className="flex items-start gap-3">
                          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                            <Calendar className="w-6 h-6 text-primary" />
                          </div>
                          <div>
                            <p className="font-semibold text-slate-900">
                              {format(new Date(booking.service_date), "EEE, MMM d")}
                            </p>
                            <p className="text-sm text-slate-500">{booking.time_slot}</p>
                            <p className="text-xs text-slate-400 mt-1">{booking.address}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 ml-15 sm:ml-0">
                          {getStatusBadge(booking.status)}
                          <Button variant="outline" size="sm" onClick={() => handleReschedule(booking)}>
                            Reschedule
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Quick Actions */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Button 
                variant="outline" 
                className="h-auto py-4 flex-col gap-2"
                onClick={() => navigate("/book/zip")}
              >
                <Calendar className="w-6 h-6 text-primary" />
                <span className="text-xs">Book Cleaning</span>
              </Button>
              <Button 
                variant="outline" 
                className="h-auto py-4 flex-col gap-2"
                onClick={handleManageSubscription}
                disabled={!subscription?.hasCustomer}
              >
                <CreditCard className="w-6 h-6 text-primary" />
                <span className="text-xs">Payment</span>
              </Button>
              <Button 
                variant="outline" 
                className="h-auto py-4 flex-col gap-2"
                onClick={() => navigate("/membership")}
              >
                <Package className="w-6 h-6 text-primary" />
                <span className="text-xs">Membership</span>
              </Button>
              <Button 
                variant="outline" 
                className="h-auto py-4 flex-col gap-2"
                onClick={() => setActiveTab("settings")}
              >
                <Settings className="w-6 h-6 text-primary" />
                <span className="text-xs">Settings</span>
              </Button>
            </div>

            {/* Referral Section */}
            {user?.email && <ReferralSection email={user.email} />}
          </TabsContent>

          {/* Bookings Tab */}
          <TabsContent value="bookings" className="space-y-6 mt-6">
            {/* Upcoming */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-primary" />
                  Upcoming Cleanings ({upcomingBookings.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {upcomingBookings.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-slate-500 mb-4">No upcoming cleanings scheduled</p>
                    <Button onClick={() => navigate("/book/zip")}>Book Now</Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {upcomingBookings.map((booking) => (
                      <Card key={booking.id} className="border-primary/20">
                        <CardContent className="p-4">
                          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                            <div className="space-y-2">
                              <div className="flex items-center gap-2">
                                <Clock className="w-4 h-4 text-primary" />
                                <span className="font-semibold">
                                  {format(new Date(booking.service_date), "EEEE, MMMM d, yyyy")}
                                </span>
                                <Badge variant="outline">{booking.time_slot}</Badge>
                              </div>
                              <div className="flex items-center gap-2 text-sm text-slate-500">
                                <MapPin className="w-4 h-4" />
                                {booking.address}, {booking.city}, {booking.state}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Badge variant="secondary">{booking.service_type}</Badge>
                                {booking.uses_credit && <Badge className="bg-primary">Credit</Badge>}
                                {getStatusBadge(booking.status)}
                              </div>
                            </div>
                            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                              <p className="text-2xl font-bold text-primary">
                                ${(booking.total_estimate_cents / 100).toFixed(0)}
                              </p>
                              <div className="flex flex-wrap gap-2">
                                <Button size="sm" variant="outline" onClick={() => handleModify(booking)}>
                                  Modify
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => handleReschedule(booking)}>
                                  Reschedule
                                </Button>
                                <Button size="sm" variant="destructive" onClick={() => handleCancel(booking)}>
                                  <X className="w-3 h-3 mr-1" />
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Past Bookings */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-slate-400" />
                  Past Cleanings ({pastBookings.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {pastBookings.length === 0 ? (
                  <p className="text-center py-8 text-slate-500">No past cleanings yet</p>
                ) : (
                  <div className="space-y-3">
                    {pastBookings.slice(0, 10).map((booking) => (
                      <div 
                        key={booking.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-lg bg-slate-50 gap-3"
                      >
                        <div className="flex-1">
                          <p className="font-medium text-slate-900">
                            {format(new Date(booking.service_date), "MMM d, yyyy")}
                          </p>
                          <p className="text-sm text-slate-500">
                            {booking.service_type} • {booking.city}, {booking.state}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          {getStatusBadge(booking.status)}
                          <span className="font-semibold">${(booking.total_estimate_cents / 100).toFixed(0)}</span>
                          {booking.status === "completed" && booking.cleaner_id && !booking.rating_submitted && (
                            <Button size="sm" variant="outline" onClick={() => handleRating(booking)}>
                              <Star className="w-4 h-4 mr-1" />
                              Rate
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Billing Tab */}
          <TabsContent value="billing" className="space-y-6 mt-6">
            {/* Subscription Status */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="w-5 h-5 text-primary" />
                  Subscription & Billing
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {subscription?.subscribed ? (
                  <div className="flex items-center justify-between p-4 bg-green-50 rounded-xl border border-green-200">
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="w-8 h-8 text-green-600" />
                      <div>
                        <p className="font-semibold text-green-800">{subscription.plan_name}</p>
                        <p className="text-sm text-green-600">
                          Renews {subscription.subscription_end && format(new Date(subscription.subscription_end), "MMM d, yyyy")}
                        </p>
                      </div>
                    </div>
                    <Badge className="bg-green-500">Active</Badge>
                  </div>
                ) : (
                  <div className="text-center py-6 bg-slate-50 rounded-xl">
                    <p className="text-slate-600 mb-4">No active subscription</p>
                    <Button onClick={() => navigate("/membership")} className="bg-primary">
                      View Membership Options
                    </Button>
                  </div>
                )}

                <Separator />

                {/* Payment Management */}
                <div>
                  <h3 className="font-semibold text-slate-900 mb-4">Payment Methods</h3>
                  {subscription?.hasCustomer ? (
                    <Button 
                      variant="outline" 
                      className="w-full justify-between"
                      onClick={handleManageSubscription}
                    >
                      <div className="flex items-center gap-3">
                        <CreditCard className="w-5 h-5 text-primary" />
                        <span>Manage Payment Methods</span>
                      </div>
                      <ChevronRight className="w-5 h-5" />
                    </Button>
                  ) : (
                    <div className="p-4 bg-slate-50 rounded-xl text-center">
                      <p className="text-sm text-slate-500 mb-3">
                        Complete a booking to add a payment method
                      </p>
                      <Button size="sm" onClick={() => navigate("/book/zip")}>
                        Book Your First Cleaning
                      </Button>
                    </div>
                  )}
                </div>

                <Separator />

                {/* Transaction Summary */}
                <div>
                  <h3 className="font-semibold text-slate-900 mb-4">Transaction Summary</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-slate-50 rounded-xl">
                      <p className="text-sm text-slate-500">Total Spent</p>
                      <p className="text-2xl font-bold text-slate-900">${metrics.totalSpent.toFixed(2)}</p>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-xl">
                      <p className="text-sm text-slate-500">Avg. Booking</p>
                      <p className="text-2xl font-bold text-slate-900">${metrics.avgBookingValue.toFixed(0)}</p>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-xl">
                      <p className="text-sm text-slate-500">Credits Used</p>
                      <p className="text-2xl font-bold text-slate-900">{metrics.creditsUsed}</p>
                    </div>
                    <div className="p-4 bg-green-50 rounded-xl">
                      <p className="text-sm text-green-600">Est. Savings</p>
                      <p className="text-2xl font-bold text-green-600">${metrics.savingsFromMembership}</p>
                    </div>
                  </div>
                </div>

                {subscription?.hasCustomer && (
                  <>
                    <Separator />
                    <Button 
                      variant="outline" 
                      className="w-full"
                      onClick={handleManageSubscription}
                    >
                      <Settings className="w-4 h-4 mr-2" />
                      View Full Billing History
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Settings Tab */}
          <TabsContent value="settings" className="space-y-6 mt-6">
            {/* Profile */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="w-5 h-5 text-primary" />
                  Profile
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-xl">
                  <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="w-7 h-7 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">{user.email}</p>
                    <p className="text-sm text-slate-500">Member since {format(new Date(user.created_at || Date.now()), "MMMM yyyy")}</p>
                  </div>
                </div>

                <Button
                  variant="outline"
                  className="w-full justify-between"
                  onClick={handleChangePassword}
                  disabled={isResettingPassword}
                >
                  <div className="flex items-center gap-3">
                    <Lock className="w-5 h-5 text-primary" />
                    <span>{isResettingPassword ? "Sending reset link..." : "Change Password"}</span>
                  </div>
                  {isResettingPassword && <Loader2 className="w-4 h-4 animate-spin" />}
                </Button>
              </CardContent>
            </Card>

            {/* Security */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="w-5 h-5 text-primary" />
                  Security
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                    <span className="text-sm">Email verified</span>
                  </div>
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">Verified</Badge>
                </div>

                <Button
                  variant="outline"
                  className="w-full justify-between text-red-600 hover:text-red-700 hover:bg-red-50"
                  onClick={handleSignOut}
                >
                  <div className="flex items-center gap-3">
                    <LogOut className="w-5 h-5" />
                    <span>Sign Out</span>
                  </div>
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Last Updated */}
        <p className="text-center text-xs text-slate-400">
          Last updated: {format(lastUpdated, "h:mm a")}
        </p>
      </div>

      {/* Dialogs */}
      {rescheduleBooking && (
        <RescheduleDialog
          open={rescheduleDialogOpen}
          onOpenChange={setRescheduleDialogOpen}
          booking={rescheduleBooking}
          onSuccess={fetchData}
        />
      )}

      {modifyBooking && (
        <ModifyBookingDialog
          open={modifyDialogOpen}
          onOpenChange={setModifyDialogOpen}
          booking={modifyBooking}
          onSuccess={fetchData}
        />
      )}

      {ratingBooking && (
        <RatingDialog
          open={ratingDialogOpen}
          onOpenChange={setRatingDialogOpen}
          bookingId={ratingBooking.id}
          cleanerName="Your Cleaner"
          onRatingSubmitted={() => {
            setRatingDialogOpen(false);
            setRatingBooking(null);
            fetchData();
          }}
        />
      )}
    </div>
  );
}
