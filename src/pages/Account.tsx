import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { User, CreditCard, Calendar, LogOut, Settings, Loader2, CheckCircle2, Lock, Clock, MapPin, Package, AlertCircle, Home, X, UserPlus } from "lucide-react";
import { ReferralSection } from "@/components/ReferralSection";
import { toast } from "sonner";
import { format, isPast, isFuture } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
      // Check if user has a Stripe customer record
      if (!subscription?.hasCustomer) {
        toast.error("Please complete a booking first to access the customer portal");
        return;
      }
      
      await openCustomerPortal();
    } catch (error: any) {
      const errorMessage = error.message || "Failed to open customer portal";
      
      // Provide more specific error messages
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
    // Open GoHighLevel form with pre-filled booking data
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
    const variants: Record<string, { variant: "default" | "secondary" | "destructive" | "outline", label: string }> = {
      confirmed: { variant: "default", label: "Confirmed" },
      pending_payment: { variant: "secondary", label: "Pending Payment" },
      cancelled: { variant: "destructive", label: "Cancelled" },
      completed: { variant: "outline", label: "Completed" },
    };
    
    const config = variants[status] || { variant: "outline", label: status };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  // Only show incomplete bookings from last 24 hours
  const incompleteBookings = bookings
    .filter(b => {
      if (b.status !== 'pending_payment') return false;
      const bookingCreatedAt = new Date(b.created_at);
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      return bookingCreatedAt > twentyFourHoursAgo;
    })
    .slice(0, 1); // Limit to only 1 most recent incomplete booking
  
  const upcomingBookings = bookings.filter(b => 
    isFuture(new Date(b.service_date)) && 
    b.status === 'confirmed'
  );
  const pastBookings = bookings.filter(b => (isPast(new Date(b.service_date)) || b.status === 'completed' || b.status === 'cancelled') && b.status !== 'pending_payment');

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-hero flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-hero">
      <div className="container max-w-7xl mx-auto px-4 py-12">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold font-jakarta mb-2">My Account</h1>
            <p className="text-muted-foreground">Manage your profile, bookings, and subscriptions</p>
          </div>
          <Button variant="outline" onClick={() => navigate("/")}>
            <Home className="w-4 h-4 mr-2" />
            Home
          </Button>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Profile Card */}
          <Card className="border-2 border-primary/30 shadow-card">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-gradient-primary rounded-full flex items-center justify-center shadow-lavender">
                  <User className="w-6 h-6 text-white" />
                </div>
                <div>
                  <CardTitle className="font-semibold">Profile</CardTitle>
                  <CardDescription>Your account information</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground">Email</p>
                <p className="font-medium">{user.email}</p>
              </div>
              <Separator />
              <Button
                variant="outline"
                className="w-full"
                onClick={handleChangePassword}
                disabled={isResettingPassword}
              >
                {isResettingPassword ? (
                  <>
                    <Loader2 className="mr-2 w-4 h-4 animate-spin" />
                    Sending reset link...
                  </>
                ) : (
                  <>
                    <Lock className="mr-2 w-4 h-4" />
                    Change Password
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={handleSignOut}
              >
                <LogOut className="mr-2 w-4 h-4" />
                Sign Out
              </Button>
            </CardContent>
          </Card>

          {/* Subscription Card */}
          <Card className="border-2 border-primary/30 shadow-card">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-gradient-primary rounded-full flex items-center justify-center shadow-lavender">
                  <CreditCard className="w-6 h-6 text-white" />
                </div>
                <div>
                  <CardTitle className="font-semibold">Subscription</CardTitle>
                  <CardDescription>Your current plan</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {subscription?.subscribed ? (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold">{subscription.plan_name}</p>
                      <p className="text-sm text-muted-foreground">
                        Status: <Badge variant="default" className="ml-1">Active</Badge>
                      </p>
                    </div>
                    <CheckCircle2 className="w-8 h-8 text-success" />
                  </div>
                  
                  {subscription.subscription_end && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Calendar className="w-4 h-4" />
                      <span>
                        Renews {format(new Date(subscription.subscription_end), "MMM d, yyyy")}
                      </span>
                    </div>
                  )}
                  
                  <Separator />
                  
                  <Button
                    className="w-full bg-gradient-primary hover:opacity-90"
                    onClick={handleManageSubscription}
                  >
                    <Settings className="mr-2 w-4 h-4" />
                    Manage Subscription
                  </Button>
                </>
              ) : (
                <>
                  <div className="text-center py-6">
                    <p className="text-muted-foreground mb-4">
                      {subscription?.hasCustomer 
                        ? "No active subscription"
                        : "Start your cleaning journey"}
                    </p>
                    <Button
                      className="bg-gradient-primary hover:opacity-90 shadow-lavender"
                      onClick={() => navigate("/book/zip")}
                    >
                      Book Your First Cleaning
                    </Button>
                  </div>
                  
                  {subscription?.hasCustomer && (
                    <>
                      <Separator />
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={handleManageSubscription}
                      >
                        <Settings className="mr-2 w-4 h-4" />
                        View Billing History
                      </Button>
                    </>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Membership Credits */}
        {membershipCredits && (
          <Card className="mt-6 border-2 border-primary/40 bg-gradient-lavender shadow-card">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 font-semibold">
                    <Package className="w-5 h-5 text-primary" />
                    Membership Credits
                  </CardTitle>
                  <CardDescription>
                    {membershipCredits.membership_plan.charAt(0).toUpperCase() + membershipCredits.membership_plan.slice(1)} Plan
                  </CardDescription>
                </div>
                <div className="text-right">
                  <p className="text-2xl md:text-3xl font-bold text-primary">{membershipCredits.credits_remaining}</p>
                  <p className="text-sm text-muted-foreground">Credits Available</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-xl font-semibold">{membershipCredits.credits_per_month}</p>
                  <p className="text-xs text-muted-foreground">Per Month</p>
                </div>
                <div>
                  <p className="text-xl font-semibold">{membershipCredits.credits_used}</p>
                  <p className="text-xs text-muted-foreground">Used</p>
                </div>
                <div>
                  <p className="text-xl font-semibold">
                    {format(new Date(membershipCredits.current_period_end), "MMM d")}
                  </p>
                  <p className="text-xs text-muted-foreground">Next Refresh</p>
                </div>
              </div>
              
              {/* Use Credit Button */}
              {membershipCredits.credits_remaining > 0 && (
                <Button 
                  className="w-full bg-gradient-primary hover:opacity-90 shadow-lavender h-12 text-lg"
                  onClick={() => navigate("/portal/book")}
                >
                  <Calendar className="w-5 h-5 mr-2" />
                  Use Credit to Book a Cleaning
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* Referral Section */}
        {user?.email && (
          <div className="mt-6">
            <ReferralSection email={user.email} />
          </div>
        )}

        {/* Incomplete Bookings */}
        {incompleteBookings.length > 0 && (
          <Card className="mt-6 border-2 border-warning/60 bg-warning/5 shadow-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 font-semibold">
                <AlertCircle className="w-5 h-5 text-warning" />
                Incomplete Bookings
              </CardTitle>
              <CardDescription>Complete your payment to confirm these bookings</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {incompleteBookings.map((booking) => (
                  <Alert key={booking.id} className="border-warning/50">
                    <AlertCircle className="h-4 w-4 text-warning" />
                    <AlertDescription>
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="space-y-2">
                          <p className="font-semibold">
                            {format(new Date(booking.service_date), "EEEE, MMMM d, yyyy")} at {booking.time_slot}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {booking.address}, {booking.city}, {booking.state}
                          </p>
                          <div className="flex gap-2">
                            <Badge variant="outline">{booking.service_type}</Badge>
                            <Badge variant="secondary">Payment Pending</Badge>
                          </div>
                        </div>
                        <div className="text-right space-y-2">
                          <p className="text-xl font-bold text-warning">
                            ${(booking.total_estimate_cents / 100).toFixed(2)}
                          </p>
                          <Button
                            size="sm"
                            className="bg-warning hover:bg-warning/90 text-warning-foreground"
                            onClick={() => navigate(`/book/checkout?booking_id=${booking.id}`)}
                          >
                            Complete Payment
                          </Button>
                        </div>
                      </div>
                    </AlertDescription>
                  </Alert>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Upcoming Services */}
        <Card className="mt-6 border-primary/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-semibold">
              <Calendar className="w-5 h-5 text-primary" />
              Upcoming Services
            </CardTitle>
            <CardDescription>Your confirmed cleanings</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingBookings ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : upcomingBookings.length === 0 ? (
              <div className="text-center py-8">
                <Calendar className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground mb-4">No upcoming cleanings scheduled</p>
                <Button onClick={() => navigate("/book/zip")} className="bg-gradient-primary">
                  Book a Cleaning
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {upcomingBookings.map((booking) => (
                  <Card key={booking.id} className="border-primary/20">
                    <CardContent className="pt-6">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="space-y-3 flex-1">
                          <div className="flex items-start gap-3">
                            <Clock className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                            <div>
                              <p className="font-semibold text-lg">
                                {format(new Date(booking.service_date), "EEEE, MMMM d, yyyy")}
                              </p>
                              <p className="text-sm text-muted-foreground">{booking.time_slot}</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-3">
                            <MapPin className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                            <div>
                              <p className="font-medium">{booking.address}</p>
                              <p className="text-sm text-muted-foreground">
                                {booking.city}, {booking.state} {booking.zip_code}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-4 flex-wrap">
                            <Badge variant="outline">{booking.service_type}</Badge>
                            <Badge variant="outline">{booking.home_size_id}</Badge>
                            {booking.uses_credit && <Badge className="bg-primary">Using Credit</Badge>}
                            {getStatusBadge(booking.status)}
                          </div>
                        </div>
                        <div className="text-right space-y-2">
                          <p className="text-2xl font-bold text-primary">
                            ${(booking.total_estimate_cents / 100).toFixed(2)}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleModify(booking)}
                            >
                              Modify
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleReschedule(booking)}
                            >
                              Reschedule
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => handleCancel(booking)}
                            >
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

        {/* Booking History */}
        <Card className="mt-6 border-primary/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-primary" />
              Booking History
            </CardTitle>
            <CardDescription>Your past cleanings</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingBookings ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : pastBookings.length === 0 ? (
              <div className="text-center py-8">
                <AlertCircle className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground">No booking history yet</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Service</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                     {pastBookings.map((booking) => (
                      <TableRow key={booking.id}>
                        <TableCell className="font-medium">
                          {format(new Date(booking.service_date), "MMM d, yyyy")}
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium">{booking.service_type}</p>
                            <p className="text-xs text-muted-foreground">{booking.home_size_id}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <p className="text-sm">{booking.city}, {booking.state}</p>
                        </TableCell>
                        <TableCell>{getStatusBadge(booking.status)}</TableCell>
                        <TableCell className="text-right font-semibold">
                          ${(booking.total_estimate_cents / 100).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right">
                          {booking.status === "completed" && booking.cleaner_id && !booking.rating_submitted ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleRating(booking)}
                            >
                              Rate Cleaner
                            </Button>
                          ) : booking.rating_submitted ? (
                            <Badge variant="secondary">Rated</Badge>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card className="mt-6 border-primary/20">
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Common tasks and shortcuts</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Button
                variant="outline"
                className="h-auto py-4 justify-start"
                onClick={() => navigate("/book/zip")}
              >
                <div className="flex items-start gap-3">
                  <Calendar className="w-5 h-5 text-primary mt-0.5" />
                  <div className="text-left">
                    <p className="font-semibold">Book a Cleaning</p>
                    <p className="text-xs text-muted-foreground">Schedule your next service</p>
                  </div>
                </div>
              </Button>
              
              {subscription?.hasCustomer && (
                <Button
                  variant="outline"
                  className="h-auto py-4 justify-start"
                  onClick={handleManageSubscription}
                >
                  <div className="flex items-start gap-3">
                    <CreditCard className="w-5 h-5 text-primary mt-0.5" />
                    <div className="text-left">
                      <p className="font-semibold">Payment Methods</p>
                      <p className="text-xs text-muted-foreground">Update your billing info</p>
                    </div>
                  </div>
                </Button>
              )}

              <Button
                variant="outline"
                className="h-auto py-4 justify-start"
                onClick={() => navigate("/membership")}
              >
                <div className="flex items-start gap-3">
                  <Package className="w-5 h-5 text-primary mt-0.5" />
                  <div className="text-left">
                    <p className="font-semibold">Membership Plans</p>
                    <p className="text-xs text-muted-foreground">Save with a membership</p>
                  </div>
                </div>
              </Button>
            </div>
          </CardContent>
        </Card>
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
          cleanerName={`Your Cleaner`}
          onRatingSubmitted={handleRatingSubmitted}
        />
      )}
    </div>
  );
}
