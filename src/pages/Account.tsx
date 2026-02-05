import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { 
  User, CreditCard, Calendar, LogOut, Settings, Loader2, CheckCircle2, 
  Lock, Clock, MapPin, Package, AlertCircle, Home, X, UserPlus,
  Pause, Play, RefreshCw, ChevronRight, Sparkles, Star, Bell,
  ArrowUpRight, Plus, Edit2, Shield, Zap, Gift, TrendingUp
} from "lucide-react";
import { ReferralSection } from "@/components/ReferralSection";
import { toast } from "sonner";
import { format, isPast, isFuture, differenceInDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RescheduleDialog } from "@/components/booking/RescheduleDialog";
import { ModifyBookingDialog } from "@/components/booking/ModifyBookingDialog";
import { RatingDialog } from "@/components/booking/RatingDialog";
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle,
  DialogFooter 
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import SEO from "@/components/SEO";

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
  subscription_id?: string;
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
  const [showMembershipDialog, setShowMembershipDialog] = useState(false);
  const [membershipAction, setMembershipAction] = useState<'pause' | 'cancel' | 'change' | null>(null);
  const [isProcessingMembership, setIsProcessingMembership] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'bookings' | 'settings'>('overview');

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

  const handleManagePayment = async () => {
    try {
      if (!subscription?.hasCustomer) {
        toast.error("Complete a booking first to add payment methods");
        return;
      }
      await openCustomerPortal();
    } catch (error: any) {
      toast.error(error.message || "Failed to open payment portal");
    }
  };

  const handleMembershipAction = async (action: 'pause' | 'cancel' | 'change') => {
    setMembershipAction(action);
    setShowMembershipDialog(true);
  };

  const confirmMembershipAction = async () => {
    if (!membershipAction || !membershipCredits?.subscription_id) return;
    
    setIsProcessingMembership(true);
    try {
      const endpoint = membershipAction === 'pause' 
        ? 'pause-subscription' 
        : membershipAction === 'cancel' 
        ? 'cancel-subscription'
        : 'modify-subscription';
      
      const { data, error } = await supabase.functions.invoke(endpoint, {
        body: { subscriptionId: membershipCredits.subscription_id }
      });

      if (error) throw error;

      toast.success(
        membershipAction === 'pause' 
          ? 'Membership paused successfully' 
          : membershipAction === 'cancel'
          ? 'Membership cancelled'
          : 'Redirecting to change plan...'
      );

      if (membershipAction === 'change' && data?.url) {
        window.open(data.url, '_blank');
      }

      setShowMembershipDialog(false);
      checkSubscription();
      fetchMembershipCredits();
    } catch (error: any) {
      toast.error(error.message || 'Failed to update membership');
    } finally {
      setIsProcessingMembership(false);
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

  const handleCancel = async (booking: Booking) => {
    if (!confirm('Are you sure you want to cancel this booking?')) return;
    
    try {
      const { error } = await supabase.functions.invoke('cancel-booking', {
        body: { bookingId: booking.id }
      });

      if (error) throw error;
      
      toast.success('Booking cancelled successfully');
      fetchBookings();
      if (booking.uses_credit) {
        fetchMembershipCredits();
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to cancel booking');
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { className: string, label: string }> = {
      confirmed: { className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300", label: "Confirmed" },
      booked: { className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300", label: "Confirmed" },
      pending_payment: { className: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300", label: "Pending" },
      cancelled: { className: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300", label: "Cancelled" },
      completed: { className: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300", label: "Completed" },
    };
    
    const config = variants[status] || { className: "bg-gray-100 text-gray-700", label: status };
    return <Badge className={cn("border-0 text-[10px]", config.className)}>{config.label}</Badge>;
  };

  const upcomingBookings = bookings.filter(b => 
    isFuture(new Date(b.service_date)) && 
    (b.status === 'confirmed' || b.status === 'booked')
  );
  const pastBookings = bookings.filter(b => 
    (isPast(new Date(b.service_date)) || b.status === 'completed' || b.status === 'cancelled') && 
    b.status !== 'pending_payment'
  );

  const nextBooking = upcomingBookings[0];
  const daysUntilNextClean = nextBooking 
    ? differenceInDays(new Date(nextBooking.service_date), new Date()) 
    : null;

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SEO 
        title="My Account | Dashboard | Novara Cleaning"
        description="Manage your bookings, membership, and account settings."
      />
      
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-lg border-b">
        <div className="max-w-6xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="font-semibold text-sm">Welcome back!</p>
                <p className="text-xs text-muted-foreground">{user.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="h-9 w-9">
                <Bell className="w-4 h-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigate("/")}>
                <Home className="w-4 h-4 md:mr-2" />
                <span className="hidden md:inline">Home</span>
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Tab Navigation */}
      <div className="md:hidden border-b bg-background sticky top-[57px] z-40">
        <div className="flex">
          {[
            { id: 'overview', label: 'Overview', icon: Home },
            { id: 'bookings', label: 'Bookings', icon: Calendar },
            { id: 'settings', label: 'Settings', icon: Settings },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={cn(
                "flex-1 py-3 text-xs font-medium flex flex-col items-center gap-1 transition-colors",
                activeTab === tab.id 
                  ? "text-violet-600 border-b-2 border-violet-600" 
                  : "text-muted-foreground"
              )}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Quick Stats - Mobile Optimized */}
        <div className={cn("grid grid-cols-2 md:grid-cols-4 gap-3", activeTab !== 'overview' && "hidden md:grid")}>
          <Card className="border bg-gradient-to-br from-violet-50 to-purple-50 dark:from-violet-950/30 dark:to-purple-950/30">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-violet-500 flex items-center justify-center flex-shrink-0">
                  <Calendar className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{daysUntilNextClean ?? '-'}</p>
                  <p className="text-[10px] text-muted-foreground">Days to Clean</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center flex-shrink-0">
                  <Package className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{membershipCredits?.credits_remaining ?? 0}</p>
                  <p className="text-[10px] text-muted-foreground">Credits Left</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500 flex items-center justify-center flex-shrink-0">
                  <TrendingUp className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{bookings.filter(b => b.status === 'completed').length}</p>
                  <p className="text-[10px] text-muted-foreground">Cleans Done</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500 flex items-center justify-center flex-shrink-0">
                  <Gift className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-2xl font-bold">$50</p>
                  <p className="text-[10px] text-muted-foreground">Referral Credit</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {/* Main Content Area */}
          <div className={cn("md:col-span-2 space-y-6", activeTab === 'settings' && "hidden md:block")}>
            {/* Next Booking Card */}
            {nextBooking && (activeTab === 'overview' || activeTab === 'bookings') && (
              <Card className="border-2 border-violet-200 dark:border-violet-800 overflow-hidden animate-in slide-in-from-bottom-4 duration-500">
                <div className="bg-gradient-to-r from-violet-500 to-purple-600 px-4 py-2">
                  <p className="text-white text-sm font-medium flex items-center gap-2">
                    <Zap className="w-4 h-4" />
                    Next Cleaning
                  </p>
                </div>
                <CardContent className="p-4 md:p-6">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-violet-500" />
                        <span className="font-semibold">
                          {format(new Date(nextBooking.service_date), "EEEE, MMM d")}
                        </span>
                        <span className="text-muted-foreground text-sm">
                          {nextBooking.time_slot}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <MapPin className="w-4 h-4" />
                        <span>{nextBooking.address}, {nextBooking.city}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {getStatusBadge(nextBooking.status)}
                        <Badge variant="outline" className="text-[10px]">{nextBooking.service_type}</Badge>
                        {nextBooking.uses_credit && (
                          <Badge className="bg-violet-100 text-violet-700 border-0 text-[10px]">Using Credit</Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => handleReschedule(nextBooking)}>
                        <RefreshCw className="w-3 h-3 mr-1" />
                        Reschedule
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => handleModify(nextBooking)}>
                        <Edit2 className="w-3 h-3 mr-1" />
                        Modify
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => handleCancel(nextBooking)}>
                        <X className="w-3 h-3 mr-1" />
                        Cancel
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Upcoming Bookings */}
            {(activeTab === 'overview' || activeTab === 'bookings') && (
              <Card className="animate-in slide-in-from-bottom-4 duration-500" style={{ animationDelay: '100ms' }}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-violet-500" />
                      Upcoming Cleanings
                    </CardTitle>
                    <Button 
                      size="sm" 
                      className="bg-gradient-to-r from-violet-600 to-purple-600 h-8"
                      onClick={() => navigate("/book/zip")}
                    >
                      <Plus className="w-3 h-3 mr-1" />
                      Book New
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {isLoadingBookings ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
                    </div>
                  ) : upcomingBookings.length === 0 ? (
                    <div className="text-center py-8">
                      <Calendar className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
                      <p className="text-muted-foreground text-sm mb-4">No upcoming cleanings</p>
                      <Button onClick={() => navigate("/book/zip")} className="bg-gradient-to-r from-violet-600 to-purple-600">
                        Schedule a Cleaning
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {upcomingBookings.slice(0, 5).map((booking, i) => (
                        <div 
                          key={booking.id} 
                          className="flex items-center justify-between p-3 rounded-xl border hover:border-violet-300 transition-all group"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-violet-100 dark:bg-violet-900 flex items-center justify-center">
                              <span className="text-sm font-bold text-violet-600 dark:text-violet-400">
                                {format(new Date(booking.service_date), "d")}
                              </span>
                            </div>
                            <div>
                              <p className="font-medium text-sm">
                                {format(new Date(booking.service_date), "EEE, MMM d")}
                              </p>
                              <p className="text-xs text-muted-foreground">{booking.time_slot}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {getStatusBadge(booking.status)}
                            <Button 
                              size="sm" 
                              variant="ghost" 
                              className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={() => handleReschedule(booking)}
                            >
                              <ChevronRight className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Past Bookings */}
            {activeTab === 'bookings' && pastBookings.length > 0 && (
              <Card className="animate-in slide-in-from-bottom-4 duration-500" style={{ animationDelay: '200ms' }}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Clock className="w-4 h-4 text-muted-foreground" />
                    Booking History
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {pastBookings.slice(0, 10).map((booking) => (
                      <div 
                        key={booking.id} 
                        className="flex items-center justify-between p-3 rounded-xl border"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                            <span className="text-sm font-medium text-muted-foreground">
                              {format(new Date(booking.service_date), "d")}
                            </span>
                          </div>
                          <div>
                            <p className="font-medium text-sm">
                              {format(new Date(booking.service_date), "MMM d, yyyy")}
                            </p>
                            <p className="text-xs text-muted-foreground">{booking.service_type}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {getStatusBadge(booking.status)}
                          {booking.status === 'completed' && !booking.rating_submitted && booking.cleaner_id && (
                            <Button size="sm" variant="outline" onClick={() => handleRating(booking)}>
                              <Star className="w-3 h-3 mr-1" />
                              Rate
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Sidebar */}
          <div className={cn("space-y-6", activeTab === 'bookings' && "hidden md:block")}>
            {/* Membership Card */}
            {(activeTab === 'overview' || activeTab === 'settings') && (
              <Card className="border-2 border-emerald-200 dark:border-emerald-800 animate-in slide-in-from-right-4 duration-500">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Package className="w-4 h-4 text-emerald-500" />
                    {membershipCredits ? 'Membership' : 'Go Unlimited'}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {membershipCredits ? (
                    <>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold capitalize">{membershipCredits.membership_plan} Plan</p>
                          <p className="text-xs text-muted-foreground">
                            Renews {format(new Date(membershipCredits.current_period_end), "MMM d")}
                          </p>
                        </div>
                        <Badge className="bg-emerald-100 text-emerald-700 border-0">Active</Badge>
                      </div>
                      
                      <div>
                        <div className="flex justify-between text-sm mb-2">
                          <span>Credits Used</span>
                          <span>{membershipCredits.credits_used} / {membershipCredits.credits_per_month}</span>
                        </div>
                        <Progress 
                          value={(membershipCredits.credits_used / membershipCredits.credits_per_month) * 100} 
                          className="h-2"
                        />
                      </div>

                      {membershipCredits.credits_remaining > 0 && (
                        <Button 
                          className="w-full bg-gradient-to-r from-emerald-500 to-teal-500 h-10"
                          onClick={() => navigate("/portal/book")}
                        >
                          <Sparkles className="w-4 h-4 mr-2" />
                          Use Credit
                        </Button>
                      )}

                      <Separator />

                      <div className="space-y-2">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="w-full justify-between"
                          onClick={() => handleMembershipAction('pause')}
                        >
                          <span className="flex items-center gap-2">
                            <Pause className="w-3 h-3" />
                            Pause Membership
                          </span>
                          <ChevronRight className="w-4 h-4" />
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="w-full justify-between"
                          onClick={() => handleMembershipAction('change')}
                        >
                          <span className="flex items-center gap-2">
                            <RefreshCw className="w-3 h-3" />
                            Change Plan
                          </span>
                          <ChevronRight className="w-4 h-4" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="w-full justify-between text-muted-foreground"
                          onClick={() => handleMembershipAction('cancel')}
                        >
                          <span className="flex items-center gap-2">
                            <X className="w-3 h-3" />
                            Cancel Membership
                          </span>
                          <ChevronRight className="w-4 h-4" />
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-2">
                      <p className="text-sm text-muted-foreground mb-4">
                        Save up to 40% with a membership
                      </p>
                      <Button 
                        className="w-full bg-gradient-to-r from-emerald-500 to-teal-500"
                        onClick={() => navigate("/membership")}
                      >
                        View Plans
                        <ArrowUpRight className="w-4 h-4 ml-2" />
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Payment Methods */}
            {(activeTab === 'overview' || activeTab === 'settings') && (
              <Card className="animate-in slide-in-from-right-4 duration-500" style={{ animationDelay: '100ms' }}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-violet-500" />
                    Payment Methods
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Button 
                    variant="outline" 
                    className="w-full justify-between"
                    onClick={handleManagePayment}
                    disabled={!subscription?.hasCustomer}
                  >
                    <span className="flex items-center gap-2">
                      <Shield className="w-4 h-4" />
                      Manage Cards
                    </span>
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                  {!subscription?.hasCustomer && (
                    <p className="text-xs text-muted-foreground mt-2 text-center">
                      Complete a booking to add payment methods
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Account Settings */}
            {activeTab === 'settings' && (
              <Card className="animate-in slide-in-from-right-4 duration-500" style={{ animationDelay: '200ms' }}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <User className="w-4 h-4 text-violet-500" />
                    Account
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="p-3 rounded-xl bg-muted/50">
                    <p className="text-xs text-muted-foreground">Email</p>
                    <p className="font-medium text-sm">{user.email}</p>
                  </div>
                  
                  <Button 
                    variant="outline" 
                    className="w-full justify-between"
                    onClick={handleChangePassword}
                    disabled={isResettingPassword}
                  >
                    <span className="flex items-center gap-2">
                      <Lock className="w-4 h-4" />
                      Change Password
                    </span>
                    {isResettingPassword ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                  </Button>
                  
                  <Button 
                    variant="ghost" 
                    className="w-full justify-between text-muted-foreground"
                    onClick={handleSignOut}
                  >
                    <span className="flex items-center gap-2">
                      <LogOut className="w-4 h-4" />
                      Sign Out
                    </span>
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Referral Section */}
            {(activeTab === 'overview' || activeTab === 'settings') && user?.email && (
              <div className="animate-in slide-in-from-right-4 duration-500" style={{ animationDelay: '300ms' }}>
                <ReferralSection email={user.email} />
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Membership Action Dialog */}
      <Dialog open={showMembershipDialog} onOpenChange={setShowMembershipDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {membershipAction === 'pause' && 'Pause Membership'}
              {membershipAction === 'cancel' && 'Cancel Membership'}
              {membershipAction === 'change' && 'Change Plan'}
            </DialogTitle>
            <DialogDescription>
              {membershipAction === 'pause' && 'Your membership will be paused. You can resume anytime.'}
              {membershipAction === 'cancel' && 'Are you sure? You will lose your remaining credits.'}
              {membershipAction === 'change' && 'You will be redirected to update your plan.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setShowMembershipDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={confirmMembershipAction}
              disabled={isProcessingMembership}
              variant={membershipAction === 'cancel' ? 'destructive' : 'default'}
            >
              {isProcessingMembership ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : null}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
