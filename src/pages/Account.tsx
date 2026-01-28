import { useState, useEffect, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { 
  User, CreditCard, Calendar, LogOut, Settings, Loader2, CheckCircle2, 
  Lock, Clock, MapPin, Package, AlertCircle, Home, X, UserPlus,
  TrendingUp, DollarSign, Star, RefreshCw, ChevronRight,
  Sparkles, ArrowRight, Shield, Crown, Zap, Plus, CalendarPlus
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
  const [bookingDialogOpen, setBookingDialogOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Computed metrics
  const [metrics, setMetrics] = useState<TransactionMetrics>({
    totalSpent: 0,
    bookingsCount: 0,
    avgBookingValue: 0,
    creditsUsed: 0,
    savingsFromMembership: 0,
  });

  useEffect(() => {
    setMounted(true);
  }, []);

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
        savingsFromMembership: creditsUsedCount * 50,
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

  // Book using credit
  const handleBookWithCredit = () => {
    navigate('/book/zip?use_credit=true');
    setBookingDialogOpen(false);
  };

  // Book one-time (pay)
  const handleBookOneTime = () => {
    navigate('/book/zip');
    setBookingDialogOpen(false);
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
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased selection:bg-primary/20 selection:text-primary overflow-x-hidden">
      
      {/* Grid Background */}
      <div className="fixed inset-0 pointer-events-none grid-pattern opacity-30" />

      {/* Background Glow Effects */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div 
          className="absolute top-[-10%] right-[-5%] w-[600px] h-[600px]"
          style={{
            background: 'radial-gradient(ellipse at center, hsl(260 100% 50% / 0.06) 0%, transparent 60%)',
            filter: 'blur(80px)',
          }}
        />
        <div 
          className="absolute bottom-[-5%] left-[-5%] w-[400px] h-[400px]"
          style={{
            background: 'radial-gradient(circle, hsl(200 100% 60% / 0.08) 0%, transparent 60%)',
            filter: 'blur(60px)',
          }}
        />
      </div>

      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 h-14 sm:h-16 border-b border-slate-200/50 bg-white/90 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto h-full px-3 sm:px-6 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 group">
            <img 
              src="/novara-logo.png" 
              alt="Novara" 
              className="h-8 w-8 sm:h-9 sm:w-9 rounded-xl group-hover:opacity-80 transition-opacity"
            />
            <div className="hidden sm:block">
              <span className="font-bold text-slate-900">My Account</span>
            </div>
          </Link>
          
          <div className="flex items-center gap-1.5 sm:gap-2">
            <Button 
              variant="ghost" 
              size="icon"
              onClick={fetchData}
              disabled={isRefreshing}
              className="h-8 w-8 sm:h-9 sm:w-9"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => navigate("/")}
              className="h-8 sm:h-9 text-xs sm:text-sm px-2 sm:px-3"
            >
              <Home className="w-4 h-4" />
              <span className="hidden sm:inline ml-1.5">Home</span>
            </Button>
            <Button 
              size="sm" 
              onClick={() => setBookingDialogOpen(true)}
              className="h-8 sm:h-9 text-xs sm:text-sm px-2 sm:px-3 bg-primary"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline ml-1.5">Book</span>
            </Button>
          </div>
        </div>
      </nav>

      <div className="relative z-10 max-w-7xl mx-auto px-3 sm:px-6 pt-16 sm:pt-20 pb-6 space-y-4 sm:space-y-6">
        
        {/* Welcome & Quick Stats */}
        <div className={`${mounted ? 'animate-fade-in' : 'opacity-0'}`}>
          {/* Hero Stats Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
            {/* Next Cleaning - Prominent Card */}
            <Card className="col-span-2 bg-gradient-to-br from-primary via-primary to-purple-600 text-white border-0 overflow-hidden relative">
              <div className="absolute inset-0 opacity-20" style={{
                backgroundImage: 'radial-gradient(circle at 100% 0%, white 0%, transparent 50%)'
              }} />
              <CardContent className="p-4 sm:p-6 relative">
                {nextCleaning ? (
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-white/70 text-xs sm:text-sm font-medium">Next Cleaning</p>
                      <p className="text-2xl sm:text-4xl font-bold mt-1">
                        {daysUntilNext === 0 ? 'Today!' : `${daysUntilNext} days`}
                      </p>
                      <p className="text-white/90 text-xs sm:text-sm mt-1 sm:mt-2">
                        {format(new Date(nextCleaning.service_date), "EEE, MMM d")} • {nextCleaning.time_slot}
                      </p>
                    </div>
                    <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-white/20 flex items-center justify-center">
                      <Calendar className="w-6 h-6 sm:w-8 sm:h-8 text-white" />
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-white/70 text-xs sm:text-sm">No Upcoming Cleanings</p>
                      <Button 
                        size="sm" 
                        className="mt-2 sm:mt-3 bg-white text-primary hover:bg-white/90 text-xs sm:text-sm h-8 sm:h-9"
                        onClick={() => setBookingDialogOpen(true)}
                      >
                        Book Now
                      </Button>
                    </div>
                    <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-white/20 flex items-center justify-center">
                      <CalendarPlus className="w-6 h-6 sm:w-8 sm:h-8 text-white" />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Total Spent */}
            <Card className="border-slate-200 hover:border-primary/30 hover:shadow-lg transition-all">
              <CardContent className="p-3 sm:p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-slate-500 text-[10px] sm:text-xs font-medium">Total Spent</p>
                    <p className="text-xl sm:text-2xl font-bold text-slate-900 mt-0.5">
                      ${metrics.totalSpent.toFixed(0)}
                    </p>
                  </div>
                  <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-green-100 flex items-center justify-center">
                    <DollarSign className="w-4 h-4 sm:w-5 sm:h-5 text-green-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Cleanings Count */}
            <Card className="border-slate-200 hover:border-primary/30 hover:shadow-lg transition-all">
              <CardContent className="p-3 sm:p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-slate-500 text-[10px] sm:text-xs font-medium">Cleanings</p>
                    <p className="text-xl sm:text-2xl font-bold text-slate-900 mt-0.5">
                      {metrics.bookingsCount}
                    </p>
                  </div>
                  <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Membership Credits Card */}
        {membershipCredits && (
          <Card className={`border-2 border-primary/30 bg-gradient-to-r from-primary/5 via-purple-50/50 to-white overflow-hidden
            ${mounted ? 'animate-fade-in animation-delay-100' : 'opacity-0'}`}
            style={{ boxShadow: '0 10px 40px hsl(260 100% 50% / 0.1)' }}
          >
            <CardContent className="p-3 sm:p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
                <div className="flex items-center gap-3 sm:gap-4">
                  <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-br from-primary to-purple-600 flex items-center justify-center shadow-lg shadow-primary/30">
                    <Crown className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
                  </div>
                  <div>
                    <p className="text-xs sm:text-sm text-slate-500 font-medium">Membership Credits</p>
                    <div className="flex items-baseline gap-1.5">
                      <p className="text-2xl sm:text-3xl font-bold text-primary">{membershipCredits.credits_remaining}</p>
                      <span className="text-xs sm:text-sm text-slate-400">available</span>
                    </div>
                  </div>
                </div>
                <div className="flex-1 max-w-xs">
                  <div className="flex justify-between text-xs sm:text-sm mb-1.5 sm:mb-2">
                    <span className="text-slate-500">Used this period</span>
                    <span className="font-medium">{membershipCredits.credits_used}/{membershipCredits.credits_per_month}</span>
                  </div>
                  <Progress 
                    value={(membershipCredits.credits_used / membershipCredits.credits_per_month) * 100} 
                    className="h-2"
                  />
                  <p className="text-[10px] sm:text-xs text-slate-400 mt-1.5">
                    Refreshes {format(new Date(membershipCredits.current_period_end), "MMM d")}
                  </p>
                </div>
              </div>
              {metrics.savingsFromMembership > 0 && (
                <div className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-primary/10 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-green-600" />
                  <span className="text-xs sm:text-sm text-green-600 font-medium">
                    You've saved ~${metrics.savingsFromMembership} with your membership!
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* No Membership - Upgrade CTA */}
        {!subscription?.subscribed && !membershipCredits && (
          <Card className={`border-primary/20 bg-gradient-to-r from-primary/5 to-purple-50 overflow-hidden
            ${mounted ? 'animate-fade-in animation-delay-100' : 'opacity-0'}`}
          >
            <CardContent className="p-4 sm:p-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                    <Crown className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm sm:text-base">Become a Member</h3>
                    <p className="text-xs sm:text-sm text-slate-500">Save up to 30% with monthly credits</p>
                  </div>
                </div>
                <Button 
                  onClick={() => navigate('/membership')}
                  className="bg-gradient-to-r from-primary to-purple-600 shadow-lg shadow-primary/25 w-full sm:w-auto text-xs sm:text-sm h-9 sm:h-10"
                >
                  View Plans
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Pending Payments Alert */}
        {pendingBookings.length > 0 && (
          <Alert className="border-amber-300 bg-amber-50">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3">
              <span className="text-amber-800 text-xs sm:text-sm">
                {pendingBookings.length} booking{pendingBookings.length > 1 ? 's' : ''} awaiting payment
              </span>
              <Button 
                size="sm" 
                className="bg-amber-600 hover:bg-amber-700 text-xs h-8"
                onClick={() => navigate(`/book/checkout?booking_id=${pendingBookings[0].id}`)}
              >
                Complete Payment
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Main Content Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4 sm:space-y-6">
          <TabsList className="grid w-full grid-cols-4 h-10 sm:h-11 p-1 bg-slate-100/80 backdrop-blur rounded-xl">
            <TabsTrigger value="overview" className="text-[10px] sm:text-sm rounded-lg">Overview</TabsTrigger>
            <TabsTrigger value="bookings" className="text-[10px] sm:text-sm rounded-lg">Bookings</TabsTrigger>
            <TabsTrigger value="billing" className="text-[10px] sm:text-sm rounded-lg">Billing</TabsTrigger>
            <TabsTrigger value="settings" className="text-[10px] sm:text-sm rounded-lg">Settings</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4 sm:space-y-6 mt-4 sm:mt-6">
            {/* Upcoming Cleanings */}
            <Card className="border-slate-200">
              <CardHeader className="pb-2 sm:pb-3 px-3 sm:px-6">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm sm:text-lg flex items-center gap-2">
                    <Calendar className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
                    Upcoming Cleanings
                  </CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => setActiveTab("bookings")} className="text-xs h-7 sm:h-8">
                    View All <ChevronRight className="w-3 h-3 sm:w-4 sm:h-4 ml-1" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="px-3 sm:px-6 pb-3 sm:pb-6">
                {isLoadingBookings ? (
                  <div className="flex items-center justify-center py-6 sm:py-8">
                    <Loader2 className="w-5 h-5 sm:w-6 sm:h-6 animate-spin text-primary" />
                  </div>
                ) : upcomingBookings.length === 0 ? (
                  <div className="text-center py-6 sm:py-8">
                    <div className="w-12 h-12 sm:w-14 sm:h-14 mx-auto rounded-full bg-slate-100 flex items-center justify-center mb-3">
                      <Calendar className="w-6 h-6 sm:w-7 sm:h-7 text-slate-300" />
                    </div>
                    <p className="text-slate-500 text-xs sm:text-sm mb-3 sm:mb-4">No upcoming cleanings</p>
                    <Button onClick={() => setBookingDialogOpen(true)} className="text-xs sm:text-sm h-9 sm:h-10">
                      Book a Cleaning
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2 sm:space-y-3">
                    {upcomingBookings.slice(0, 3).map((booking) => (
                      <div 
                        key={booking.id} 
                        className="flex flex-col sm:flex-row sm:items-center justify-between p-3 sm:p-4 rounded-xl bg-slate-50 border border-slate-100 gap-2 sm:gap-3 hover:border-primary/30 transition-all"
                      >
                        <div className="flex items-start gap-2.5 sm:gap-3">
                          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                            <Calendar className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
                          </div>
                          <div>
                            <p className="font-semibold text-slate-900 text-sm sm:text-base">
                              {format(new Date(booking.service_date), "EEE, MMM d")}
                            </p>
                            <p className="text-xs sm:text-sm text-slate-500">{booking.time_slot}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 ml-12 sm:ml-0">
                          {getStatusBadge(booking.status)}
                          <Button variant="outline" size="sm" onClick={() => handleReschedule(booking)} className="text-[10px] sm:text-xs h-7 sm:h-8">
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
              <Button 
                variant="outline" 
                className="h-auto py-3 sm:py-4 flex-col gap-1.5 sm:gap-2 hover:border-primary/50 hover:bg-primary/5 transition-all"
                onClick={() => setBookingDialogOpen(true)}
              >
                <CalendarPlus className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
                <span className="text-[10px] sm:text-xs font-medium">Book Cleaning</span>
              </Button>
              <Button 
                variant="outline" 
                className="h-auto py-3 sm:py-4 flex-col gap-1.5 sm:gap-2 hover:border-primary/50 hover:bg-primary/5 transition-all"
                onClick={handleManageSubscription}
                disabled={!subscription?.hasCustomer}
              >
                <CreditCard className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
                <span className="text-[10px] sm:text-xs font-medium">Payment</span>
              </Button>
              <Button 
                variant="outline" 
                className="h-auto py-3 sm:py-4 flex-col gap-1.5 sm:gap-2 hover:border-primary/50 hover:bg-primary/5 transition-all"
                onClick={() => navigate("/membership")}
              >
                <Crown className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
                <span className="text-[10px] sm:text-xs font-medium">Membership</span>
              </Button>
              <Button 
                variant="outline" 
                className="h-auto py-3 sm:py-4 flex-col gap-1.5 sm:gap-2 hover:border-primary/50 hover:bg-primary/5 transition-all"
                onClick={() => setActiveTab("settings")}
              >
                <Settings className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
                <span className="text-[10px] sm:text-xs font-medium">Settings</span>
              </Button>
            </div>

            {/* Referral Section */}
            {user?.email && <ReferralSection email={user.email} />}
          </TabsContent>

          {/* Bookings Tab */}
          <TabsContent value="bookings" className="space-y-4 sm:space-y-6 mt-4 sm:mt-6">
            {/* Upcoming */}
            <Card>
              <CardHeader className="px-3 sm:px-6 pb-2 sm:pb-3">
                <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
                  <Calendar className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
                  Upcoming ({upcomingBookings.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3 sm:px-6 pb-3 sm:pb-6">
                {upcomingBookings.length === 0 ? (
                  <div className="text-center py-6 sm:py-8">
                    <p className="text-slate-500 text-xs sm:text-sm mb-3 sm:mb-4">No upcoming cleanings</p>
                    <Button onClick={() => setBookingDialogOpen(true)} className="text-xs sm:text-sm h-9">Book Now</Button>
                  </div>
                ) : (
                  <div className="space-y-3 sm:space-y-4">
                    {upcomingBookings.map((booking) => (
                      <Card key={booking.id} className="border-primary/20">
                        <CardContent className="p-3 sm:p-4">
                          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 sm:gap-4">
                            <div className="space-y-1.5 sm:space-y-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-primary" />
                                <span className="font-semibold text-xs sm:text-sm">
                                  {format(new Date(booking.service_date), "EEE, MMM d, yyyy")}
                                </span>
                                <Badge variant="outline" className="text-[10px] sm:text-xs">{booking.time_slot}</Badge>
                              </div>
                              <div className="flex items-center gap-2 text-[10px] sm:text-sm text-slate-500">
                                <MapPin className="w-3 h-3 sm:w-4 sm:h-4" />
                                {booking.address}, {booking.city}
                              </div>
                              <div className="flex flex-wrap gap-1.5 sm:gap-2">
                                <Badge variant="secondary" className="text-[10px] sm:text-xs">{booking.service_type}</Badge>
                                {booking.uses_credit && <Badge className="bg-primary text-[10px] sm:text-xs">Credit</Badge>}
                                {getStatusBadge(booking.status)}
                              </div>
                            </div>
                            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3">
                              <p className="text-lg sm:text-2xl font-bold text-primary">
                                ${(booking.total_estimate_cents / 100).toFixed(0)}
                              </p>
                              <div className="flex flex-wrap gap-1.5 sm:gap-2">
                                <Button size="sm" variant="outline" onClick={() => handleModify(booking)} className="text-[10px] sm:text-xs h-7 sm:h-8 px-2 sm:px-3">
                                  Modify
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => handleReschedule(booking)} className="text-[10px] sm:text-xs h-7 sm:h-8 px-2 sm:px-3">
                                  Reschedule
                                </Button>
                                <Button size="sm" variant="destructive" onClick={() => handleCancel(booking)} className="text-[10px] sm:text-xs h-7 sm:h-8 px-2 sm:px-3">
                                  <X className="w-3 h-3 mr-0.5" />
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
              <CardHeader className="px-3 sm:px-6 pb-2 sm:pb-3">
                <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
                  <Clock className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400" />
                  Past Cleanings ({pastBookings.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3 sm:px-6 pb-3 sm:pb-6">
                {pastBookings.length === 0 ? (
                  <p className="text-center py-6 sm:py-8 text-slate-500 text-xs sm:text-sm">No past cleanings yet</p>
                ) : (
                  <div className="space-y-2 sm:space-y-3">
                    {pastBookings.slice(0, 10).map((booking) => (
                      <div 
                        key={booking.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between p-3 sm:p-4 rounded-lg bg-slate-50 gap-2 sm:gap-3"
                      >
                        <div className="flex-1">
                          <p className="font-medium text-slate-900 text-xs sm:text-sm">
                            {format(new Date(booking.service_date), "MMM d, yyyy")}
                          </p>
                          <p className="text-[10px] sm:text-sm text-slate-500">
                            {booking.service_type} • {booking.city}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 sm:gap-3">
                          {getStatusBadge(booking.status)}
                          <span className="font-semibold text-xs sm:text-sm">${(booking.total_estimate_cents / 100).toFixed(0)}</span>
                          {booking.status === "completed" && booking.cleaner_id && !booking.rating_submitted && (
                            <Button size="sm" variant="outline" onClick={() => handleRating(booking)} className="text-[10px] sm:text-xs h-7 sm:h-8">
                              <Star className="w-3 h-3 mr-1" />
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
          <TabsContent value="billing" className="space-y-4 sm:space-y-6 mt-4 sm:mt-6">
            <Card>
              <CardHeader className="px-3 sm:px-6 pb-2 sm:pb-3">
                <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
                  <CreditCard className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
                  Subscription & Billing
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 sm:space-y-6 px-3 sm:px-6 pb-4 sm:pb-6">
                {subscription?.subscribed ? (
                  <div className="flex items-center justify-between p-3 sm:p-4 bg-green-50 rounded-xl border border-green-200">
                    <div className="flex items-center gap-2.5 sm:gap-3">
                      <CheckCircle2 className="w-6 h-6 sm:w-8 sm:h-8 text-green-600" />
                      <div>
                        <p className="font-semibold text-green-800 text-sm sm:text-base">{subscription.plan_name}</p>
                        <p className="text-xs sm:text-sm text-green-600">
                          Renews {subscription.subscription_end && format(new Date(subscription.subscription_end), "MMM d, yyyy")}
                        </p>
                      </div>
                    </div>
                    <Badge className="bg-green-500 text-[10px] sm:text-xs">Active</Badge>
                  </div>
                ) : (
                  <div className="text-center py-4 sm:py-6 bg-slate-50 rounded-xl">
                    <p className="text-slate-600 text-xs sm:text-sm mb-3 sm:mb-4">No active subscription</p>
                    <Button onClick={() => navigate("/membership")} className="text-xs sm:text-sm h-9 sm:h-10">
                      View Membership Options
                    </Button>
                  </div>
                )}

                <Separator />

                {/* Payment Management */}
                <div>
                  <h3 className="font-semibold text-slate-900 mb-3 sm:mb-4 text-sm sm:text-base">Payment Methods</h3>
                  {subscription?.hasCustomer ? (
                    <Button 
                      variant="outline" 
                      className="w-full justify-between h-11 sm:h-12 text-xs sm:text-sm"
                      onClick={handleManageSubscription}
                    >
                      <div className="flex items-center gap-2 sm:gap-3">
                        <CreditCard className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
                        <span>Manage Payment Methods</span>
                      </div>
                      <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />
                    </Button>
                  ) : (
                    <div className="p-3 sm:p-4 bg-slate-50 rounded-xl text-center">
                      <p className="text-[10px] sm:text-sm text-slate-500 mb-2 sm:mb-3">
                        Complete a booking to add a payment method
                      </p>
                      <Button size="sm" onClick={() => setBookingDialogOpen(true)} className="text-xs h-8">
                        Book Your First Cleaning
                      </Button>
                    </div>
                  )}
                </div>

                <Separator />

                {/* Transaction Summary */}
                <div>
                  <h3 className="font-semibold text-slate-900 mb-3 sm:mb-4 text-sm sm:text-base">Transaction Summary</h3>
                  <div className="grid grid-cols-2 gap-2 sm:gap-4">
                    <div className="p-3 sm:p-4 bg-slate-50 rounded-xl">
                      <p className="text-[10px] sm:text-sm text-slate-500">Total Spent</p>
                      <p className="text-lg sm:text-2xl font-bold text-slate-900">${metrics.totalSpent.toFixed(2)}</p>
                    </div>
                    <div className="p-3 sm:p-4 bg-slate-50 rounded-xl">
                      <p className="text-[10px] sm:text-sm text-slate-500">Avg. Booking</p>
                      <p className="text-lg sm:text-2xl font-bold text-slate-900">${metrics.avgBookingValue.toFixed(0)}</p>
                    </div>
                    <div className="p-3 sm:p-4 bg-slate-50 rounded-xl">
                      <p className="text-[10px] sm:text-sm text-slate-500">Credits Used</p>
                      <p className="text-lg sm:text-2xl font-bold text-slate-900">{metrics.creditsUsed}</p>
                    </div>
                    <div className="p-3 sm:p-4 bg-green-50 rounded-xl">
                      <p className="text-[10px] sm:text-sm text-green-600">Est. Savings</p>
                      <p className="text-lg sm:text-2xl font-bold text-green-600">${metrics.savingsFromMembership}</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Settings Tab */}
          <TabsContent value="settings" className="space-y-4 sm:space-y-6 mt-4 sm:mt-6">
            {/* Profile */}
            <Card>
              <CardHeader className="px-3 sm:px-6 pb-2 sm:pb-3">
                <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
                  <User className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
                  Profile
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 sm:space-y-4 px-3 sm:px-6 pb-4 sm:pb-6">
                <div className="flex items-center gap-3 sm:gap-4 p-3 sm:p-4 bg-slate-50 rounded-xl">
                  <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-gradient-to-br from-primary to-purple-600 flex items-center justify-center">
                    <User className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900 text-sm sm:text-base">{user.email}</p>
                    <p className="text-[10px] sm:text-sm text-slate-500">Member since {format(new Date(user.created_at || Date.now()), "MMM yyyy")}</p>
                  </div>
                </div>

                <Button
                  variant="outline"
                  className="w-full justify-between h-11 sm:h-12 text-xs sm:text-sm"
                  onClick={handleChangePassword}
                  disabled={isResettingPassword}
                >
                  <div className="flex items-center gap-2 sm:gap-3">
                    <Lock className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
                    <span>{isResettingPassword ? "Sending reset link..." : "Change Password"}</span>
                  </div>
                  {isResettingPassword && <Loader2 className="w-4 h-4 animate-spin" />}
                </Button>
              </CardContent>
            </Card>

            {/* Security */}
            <Card>
              <CardHeader className="px-3 sm:px-6 pb-2 sm:pb-3">
                <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
                  <Shield className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
                  Security
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 sm:space-y-4 px-3 sm:px-6 pb-4 sm:pb-6">
                <div className="flex items-center justify-between p-3 sm:p-4 bg-slate-50 rounded-xl">
                  <div className="flex items-center gap-2 sm:gap-3">
                    <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-green-600" />
                    <span className="text-xs sm:text-sm">Email verified</span>
                  </div>
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-[10px] sm:text-xs">Verified</Badge>
                </div>

                <Button
                  variant="outline"
                  className="w-full justify-between text-red-600 hover:text-red-700 hover:bg-red-50 h-11 sm:h-12 text-xs sm:text-sm"
                  onClick={handleSignOut}
                >
                  <div className="flex items-center gap-2 sm:gap-3">
                    <LogOut className="w-4 h-4 sm:w-5 sm:h-5" />
                    <span>Sign Out</span>
                  </div>
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Last Updated */}
        <p className="text-center text-[10px] sm:text-xs text-slate-400 pb-4">
          Last updated: {format(lastUpdated, "h:mm a")}
        </p>
      </div>

      {/* Booking Dialog - Choose between credit or one-time */}
      <Dialog open={bookingDialogOpen} onOpenChange={setBookingDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg sm:text-xl">Book a Cleaning</DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              Choose how you'd like to book your next cleaning
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-3 py-4">
            {/* Use Credit Option */}
            {membershipCredits && membershipCredits.credits_remaining > 0 && (
              <button
                onClick={handleBookWithCredit}
                className="w-full p-4 rounded-xl border-2 border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-all text-left group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center group-hover:scale-110 transition-transform">
                      <Zap className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-semibold text-sm sm:text-base">Use Membership Credit</p>
                      <p className="text-xs sm:text-sm text-slate-500">{membershipCredits.credits_remaining} credit{membershipCredits.credits_remaining > 1 ? 's' : ''} available</p>
                    </div>
                  </div>
                  <Badge className="bg-primary text-[10px] sm:text-xs">Recommended</Badge>
                </div>
              </button>
            )}

            {/* One-Time Booking Option */}
            <button
              onClick={handleBookOneTime}
              className="w-full p-4 rounded-xl border-2 border-slate-200 hover:border-primary/30 hover:bg-slate-50 transition-all text-left group"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <CalendarPlus className="w-5 h-5 text-slate-600" />
                </div>
                <div>
                  <p className="font-semibold text-sm sm:text-base">Book One-Time Cleaning</p>
                  <p className="text-xs sm:text-sm text-slate-500">Pay per service, no commitment</p>
                </div>
              </div>
            </button>

            {/* Become a Member Option */}
            {!subscription?.subscribed && (
              <button
                onClick={() => {
                  setBookingDialogOpen(false);
                  navigate('/membership');
                }}
                className="w-full p-4 rounded-xl border-2 border-amber-200 bg-amber-50 hover:bg-amber-100 transition-all text-left group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Crown className="w-5 h-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm sm:text-base text-amber-800">Become a Member</p>
                    <p className="text-xs sm:text-sm text-amber-600">Save up to 30% with monthly credits</p>
                  </div>
                </div>
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>

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
