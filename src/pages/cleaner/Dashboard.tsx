import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { DollarSign, Calendar, Clock, MapPin, CheckCircle2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface CleanerProfile {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  total_bookings: number;
  completed_bookings: number;
  total_earnings_cents: number;
  payouts_enabled: boolean;
  onboarding_complete: boolean;
}

interface Booking {
  id: string;
  service_date: string;
  time_slot: string;
  service_type: string;
  address: string;
  city: string;
  state: string;
  zip_code: string;
  cleaner_payout_cents: number;
  status: string;
  payout_status: string;
  first_name: string;
  last_name: string;
}

interface Payout {
  id: string;
  created_at: string;
  cleaner_payout_cents: number;
  status: string;
  processed_at: string | null;
  stripe_transfer_id: string | null;
  booking_id: string;
}

export default function CleanerDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<CleanerProfile | null>(null);
  const [upcomingBookings, setUpcomingBookings] = useState<Booking[]>([]);
  const [pastBookings, setPastBookings] = useState<Booking[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      navigate("/auth");
      return;
    }
    fetchCleanerData();
  }, [user, navigate]);

  const fetchCleanerData = async () => {
    try {
      // Fetch cleaner profile
      const { data: profileData, error: profileError } = await supabase
        .from("cleaners")
        .select("*")
        .eq("user_id", user?.id)
        .single();

      if (profileError) throw profileError;
      setProfile(profileData);

      const cleanerId = profileData.id;

      // Fetch upcoming bookings
      const today = new Date().toISOString().split("T")[0];
      const { data: upcomingData, error: upcomingError } = await supabase
        .from("bookings")
        .select("*")
        .eq("cleaner_id", cleanerId)
        .gte("service_date", today)
        .in("status", ["confirmed", "booked"])
        .order("service_date", { ascending: true });

      if (upcomingError) throw upcomingError;
      setUpcomingBookings(upcomingData || []);

      // Fetch past bookings
      const { data: pastData, error: pastError } = await supabase
        .from("bookings")
        .select("*")
        .eq("cleaner_id", cleanerId)
        .lt("service_date", today)
        .order("service_date", { ascending: false })
        .limit(10);

      if (pastError) throw pastError;
      setPastBookings(pastData || []);

      // Fetch payouts
      const { data: payoutData, error: payoutError } = await supabase
        .from("payouts")
        .select("*")
        .eq("cleaner_id", cleanerId)
        .order("created_at", { ascending: false })
        .limit(10);

      if (payoutError) throw payoutError;
      setPayouts(payoutData || []);
    } catch (error: any) {
      toast({
        title: "Error loading data",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatTimeSlot = (slot: string) => {
    const slots: Record<string, string> = {
      morning: "8:00 AM - 12:00 PM",
      afternoon: "12:00 PM - 4:00 PM",
      evening: "4:00 PM - 8:00 PM",
    };
    return slots[slot] || slot;
  };

  const formatServiceType = (type: string) => {
    const types: Record<string, string> = {
      standard: "Standard Cleaning",
      deep: "Deep Cleaning",
      moveInOut: "Move In/Out",
    };
    return types[type] || type;
  };

  const getPayoutStatusBadge = (status: string) => {
    const badges: Record<string, { variant: any; label: string }> = {
      pending: { variant: "secondary", label: "Pending" },
      processing: { variant: "default", label: "Processing" },
      completed: { variant: "default", label: "Completed" },
      failed: { variant: "destructive", label: "Failed" },
    };
    const badge = badges[status] || badges.pending;
    return <Badge variant={badge.variant}>{badge.label}</Badge>;
  };

  if (loading) {
    return (
      <div className="container mx-auto py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-1/4"></div>
          <div className="h-64 bg-muted rounded"></div>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="container mx-auto py-8 px-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">
              Cleaner profile not found. Please contact support.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const thisMonthEarnings = payouts
    .filter((p) => {
      const payoutDate = new Date(p.created_at);
      const now = new Date();
      return (
        p.status === "completed" &&
        payoutDate.getMonth() === now.getMonth() &&
        payoutDate.getFullYear() === now.getFullYear()
      );
    })
    .reduce((sum, p) => sum + p.cleaner_payout_cents, 0);

  const pendingEarnings = payouts
    .filter((p) => p.status === "pending" || p.status === "processing")
    .reduce((sum, p) => sum + p.cleaner_payout_cents, 0);

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="mb-8">
        <h1 className="text-4xl font-bold">
          Welcome back, {profile.first_name}!
        </h1>
        <p className="text-muted-foreground mt-2">
          Track your bookings and earnings
        </p>
      </div>

      {!profile.onboarding_complete && (
        <Card className="mb-8 border-yellow-500 bg-yellow-50">
          <CardContent className="pt-6">
            <p className="font-medium">
              Complete your Stripe onboarding to start receiving payments.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-4 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Earnings</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${(profile.total_earnings_cents / 100).toFixed(2)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">This Month</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${(thisMonthEarnings / 100).toFixed(2)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${(pendingEarnings / 100).toFixed(2)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Jobs Completed</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {profile.completed_bookings}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-8 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Upcoming Bookings</CardTitle>
          </CardHeader>
          <CardContent>
            {upcomingBookings.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No upcoming bookings
              </p>
            ) : (
              <div className="space-y-4">
                {upcomingBookings.map((booking) => (
                  <div
                    key={booking.id}
                    className="border rounded-lg p-4 space-y-2"
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-medium">
                          {formatServiceType(booking.service_type)}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {booking.first_name} {booking.last_name}
                        </p>
                      </div>
                      <Badge className="bg-green-500">
                        ${(booking.cleaner_payout_cents / 100).toFixed(2)}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Calendar className="h-4 w-4" />
                      {formatDate(booking.service_date)}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Clock className="h-4 w-4" />
                      {formatTimeSlot(booking.time_slot)}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <MapPin className="h-4 w-4" />
                      {booking.address}, {booking.city}, {booking.state}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Payouts</CardTitle>
          </CardHeader>
          <CardContent>
            {payouts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No payouts yet</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payouts.map((payout) => (
                    <TableRow key={payout.id}>
                      <TableCell>
                        {formatDate(payout.processed_at || payout.created_at)}
                      </TableCell>
                      <TableCell className="font-medium">
                        ${(payout.cleaner_payout_cents / 100).toFixed(2)}
                      </TableCell>
                      <TableCell>{getPayoutStatusBadge(payout.status)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
