"use client";
export const dynamic = "force-dynamic";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  Mail,
  Phone,
  MapPin,
  Calendar,
  DollarSign,
  Crown,
  CreditCard,
  Eye,
  RefreshCcw,
  Share2,
  Users,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";

interface CustomerProfile {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  referral_code: string | null;
  created_at: string;
}

interface Booking {
  id: string;
  booking_number: number | null;
  service_date: string;
  time_slot: string;
  service_type: string;
  status: string | null;
  total_estimate_cents: number;
}

interface MembershipCredit {
  id: string;
  membership_plan: string;
  credits_remaining: number;
  credits_per_month: number;
  current_period_end: string;
  subscription_id: string;
}

interface Address {
  id: string;
  street: string;
  unit: string | null;
  city: string;
  state: string;
  zip: string;
  sqft_tier: string;
}

interface Referral {
  id: string;
  code: string;
  status: string;
  referred_email: string | null;
  credit_cents: number | null;
  created_at: string;
}

export default function CustomerProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const [customer, setCustomer] = useState<CustomerProfile | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [membership, setMembership] = useState<MembershipCredit | null>(null);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState({
    totalBookings: 0,
    totalSpent: 0,
    referralCount: 0,
  });

  const fetchCustomerData = async () => {
    setIsLoading(true);
    try {
      // Fetch customer
      const { data: customerData, error: customerError } = await supabase
        .from("customers")
        .select("*")
        .eq("id", resolvedParams.id)
        .single();

      if (customerError) throw customerError;
      setCustomer(customerData);

      // Fetch bookings
      const { data: bookingsData } = await supabase
        .from("bookings")
        .select("id, booking_number, service_date, time_slot, service_type, status, total_estimate_cents")
        .eq("customer_id", resolvedParams.id)
        .order("service_date", { ascending: false });

      setBookings(bookingsData || []);

      // Calculate stats
      const totalSpent = (bookingsData || []).reduce(
        (sum, b) => sum + (b.total_estimate_cents || 0),
        0
      );

      // Fetch membership
      const { data: membershipData } = await supabase
        .from("membership_credits")
        .select("*")
        .eq("customer_id", resolvedParams.id)
        .single();

      setMembership(membershipData);

      // Fetch addresses
      const { data: addressesData } = await supabase
        .from("addresses")
        .select("*")
        .eq("customer_id", resolvedParams.id);

      setAddresses(addressesData || []);

      // Fetch referrals
      const { data: referralsData } = await supabase
        .from("referrals")
        .select("*")
        .eq("customer_id", resolvedParams.id)
        .order("created_at", { ascending: false });

      setReferrals(referralsData || []);

      setStats({
        totalBookings: bookingsData?.length || 0,
        totalSpent,
        referralCount: referralsData?.filter((r) => r.status === "redeemed").length || 0,
      });
    } catch (error) {
      console.error("Error fetching customer data:", error);
      toast.error("Failed to load customer profile");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomerData();
  }, [resolvedParams.id]);

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(cents / 100);
  };

  const getStatusBadgeVariant = (status: string | null) => {
    switch (status) {
      case "confirmed":
        return "default";
      case "completed":
        return "secondary";
      case "cancelled":
        return "destructive";
      default:
        return "outline";
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-64 w-full" />
          <div className="lg:col-span-2">
            <Skeleton className="h-96 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-lg font-medium text-muted-foreground">
          Customer not found
        </p>
        <Link href="/portal/customers" className="mt-4">
          <Button variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Customers
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/portal/customers">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">
              {customer.first_name} {customer.last_name}
            </h1>
            {membership && (
              <Badge variant="secondary" className="gap-1">
                <Crown className="h-3 w-3" />
                Member
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground">
            Customer since {format(parseISO(customer.created_at), "MMMM yyyy")}
          </p>
        </div>
        <Button variant="outline" onClick={fetchCustomerData}>
          <RefreshCcw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Sidebar */}
        <div className="space-y-6">
          {/* Contact Card */}
          <Card>
            <CardHeader>
              <CardTitle>Contact Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Avatar className="h-16 w-16">
                  <AvatarFallback className="text-lg">
                    {customer.first_name[0]}
                    {customer.last_name[0]}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-medium">
                    {customer.first_name} {customer.last_name}
                  </p>
                  <p className="text-sm text-muted-foreground">Customer</p>
                </div>
              </div>
              <Separator />
              <div className="space-y-3">
                <a
                  href={`mailto:${customer.email}`}
                  className="flex items-center gap-2 text-sm hover:text-primary"
                >
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  {customer.email}
                </a>
                {customer.phone && (
                  <a
                    href={`tel:${customer.phone}`}
                    className="flex items-center gap-2 text-sm hover:text-primary"
                  >
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    {customer.phone}
                  </a>
                )}
                {customer.address && (
                  <div className="flex items-start gap-2 text-sm">
                    <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground" />
                    <span>
                      {customer.address}
                      {customer.city && (
                        <>
                          <br />
                          {customer.city}, {customer.state} {customer.zip}
                        </>
                      )}
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Stats Card */}
          <Card>
            <CardHeader>
              <CardTitle>Statistics</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Calendar className="h-4 w-4" />
                  Total Bookings
                </div>
                <span className="font-medium">{stats.totalBookings}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <DollarSign className="h-4 w-4" />
                  Lifetime Value
                </div>
                <span className="font-medium">{formatCurrency(stats.totalSpent)}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Users className="h-4 w-4" />
                  Referrals
                </div>
                <span className="font-medium">{stats.referralCount}</span>
              </div>
              {customer.referral_code && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Share2 className="h-4 w-4" />
                    Referral Code
                  </div>
                  <Badge variant="outline">{customer.referral_code}</Badge>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Membership Card */}
          {membership && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Crown className="h-5 w-5" />
                  Membership
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Plan</span>
                  <Badge>{membership.membership_plan}</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Credits</span>
                  <span className="font-medium">
                    {membership.credits_remaining} / {membership.credits_per_month}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Renews</span>
                  <span className="text-sm">
                    {format(parseISO(membership.current_period_end), "MMM d, yyyy")}
                  </span>
                </div>
                <Button variant="outline" className="w-full" asChild>
                  <a
                    href={`https://dashboard.stripe.com/subscriptions/${membership.subscription_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    View in Stripe
                  </a>
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Main Content */}
        <div className="lg:col-span-2">
          <Tabs defaultValue="bookings">
            <TabsList>
              <TabsTrigger value="bookings">Bookings</TabsTrigger>
              <TabsTrigger value="addresses">Addresses</TabsTrigger>
              <TabsTrigger value="referrals">Referrals</TabsTrigger>
            </TabsList>

            <TabsContent value="bookings" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Booking History</CardTitle>
                  <CardDescription>
                    All bookings for this customer
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {bookings.length === 0 ? (
                    <p className="text-center py-8 text-muted-foreground">
                      No bookings yet
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Booking #</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Service</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {bookings.map((booking) => (
                          <TableRow key={booking.id}>
                            <TableCell className="font-medium">
                              #{booking.booking_number || "N/A"}
                            </TableCell>
                            <TableCell>
                              <div>
                                <div>{format(parseISO(booking.service_date), "MMM d, yyyy")}</div>
                                <div className="text-xs text-muted-foreground">
                                  {booking.time_slot}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">{booking.service_type}</Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant={getStatusBadgeVariant(booking.status)}>
                                {booking.status || "Pending"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(booking.total_estimate_cents)}
                            </TableCell>
                            <TableCell>
                              <Link href={`/portal/bookings/${booking.id}`}>
                                <Button variant="ghost" size="icon">
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </Link>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="addresses" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Saved Addresses</CardTitle>
                  <CardDescription>
                    Customer's saved service addresses
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {addresses.length === 0 ? (
                    <p className="text-center py-8 text-muted-foreground">
                      No saved addresses
                    </p>
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-2">
                      {addresses.map((address) => (
                        <Card key={address.id}>
                          <CardContent className="pt-4">
                            <div className="space-y-2">
                              <div className="flex items-start gap-2">
                                <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground" />
                                <div>
                                  <p className="font-medium">{address.street}</p>
                                  {address.unit && (
                                    <p className="text-sm text-muted-foreground">
                                      {address.unit}
                                    </p>
                                  )}
                                  <p className="text-sm text-muted-foreground">
                                    {address.city}, {address.state} {address.zip}
                                  </p>
                                </div>
                              </div>
                              <Badge variant="outline">{address.sqft_tier}</Badge>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="referrals" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Referrals</CardTitle>
                  <CardDescription>
                    Referral history and credits earned
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {referrals.length === 0 ? (
                    <p className="text-center py-8 text-muted-foreground">
                      No referrals yet
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Code</TableHead>
                          <TableHead>Referred</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Credit</TableHead>
                          <TableHead>Date</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {referrals.map((referral) => (
                          <TableRow key={referral.id}>
                            <TableCell className="font-mono">
                              {referral.code}
                            </TableCell>
                            <TableCell>
                              {referral.referred_email || "—"}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  referral.status === "redeemed"
                                    ? "default"
                                    : referral.status === "pending"
                                    ? "outline"
                                    : "secondary"
                                }
                              >
                                {referral.status}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {referral.credit_cents
                                ? formatCurrency(referral.credit_cents)
                                : "—"}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {format(parseISO(referral.created_at), "MMM d, yyyy")}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
