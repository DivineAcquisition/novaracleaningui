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
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft,
  Mail,
  Phone,
  MapPin,
  Calendar,
  DollarSign,
  Crown,
  Star,
  Edit,
  MoreHorizontal,
  Key,
  Gift,
  UserX,
  Trash2,
  ExternalLink,
  Eye,
  RefreshCcw,
  Share2,
  Users,
  CreditCard,
  Activity,
  MessageSquare,
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
  address: string;
  city: string;
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
    avgRating: 0,
    referralCount: 0,
  });
  
  // Dialog states
  const [creditDialogOpen, setCreditDialogOpen] = useState(false);
  const [creditAmount, setCreditAmount] = useState("");
  const [suspendDialogOpen, setSuspendDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

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
        .select("id, booking_number, service_date, time_slot, service_type, status, total_estimate_cents, address, city")
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
        avgRating: 4.8, // Placeholder
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

  const handleResetPassword = async () => {
    if (!customer) return;
    setIsProcessing(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(customer.email);
      if (error) throw error;
      toast.success("Password reset email sent");
    } catch (error) {
      console.error("Error sending password reset:", error);
      toast.error("Failed to send password reset email");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAddCredit = async () => {
    if (!customer || !creditAmount) return;
    setIsProcessing(true);
    try {
      // This would integrate with your credit system
      toast.success(`Added ${formatCurrency(parseFloat(creditAmount) * 100)} credit`);
      setCreditDialogOpen(false);
      setCreditAmount("");
    } catch (error) {
      console.error("Error adding credit:", error);
      toast.error("Failed to add credit");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!customer) return;
    setIsProcessing(true);
    try {
      const { error } = await supabase
        .from("customers")
        .delete()
        .eq("id", customer.id);

      if (error) throw error;

      toast.success("Customer account deleted");
      window.location.href = "/portal/users/customers";
    } catch (error) {
      console.error("Error deleting account:", error);
      toast.error("Failed to delete account");
    } finally {
      setIsProcessing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-lg font-medium text-muted-foreground">
          Customer not found
        </p>
        <Link href="/portal/users/customers" className="mt-4">
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
        <Link href="/portal/users/customers">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Customer Profile</h1>
          <p className="text-muted-foreground">
            Member since {format(parseISO(customer.created_at), "MMMM yyyy")}
          </p>
        </div>
        <Button variant="outline" onClick={fetchCustomerData}>
          <RefreshCcw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
        <Link href={`/portal/users/customers/${customer.id}/edit`}>
          <Button variant="outline">
            <Edit className="mr-2 h-4 w-4" />
            Edit
          </Button>
        </Link>
      </div>

      {/* Profile Header Card */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-6">
            <div className="flex items-start gap-4">
              <Avatar className="h-20 w-20">
                <AvatarFallback className="text-2xl">
                  {customer.first_name[0]}
                  {customer.last_name[0]}
                </AvatarFallback>
              </Avatar>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-2xl font-bold">
                    {customer.first_name} {customer.last_name}
                  </h2>
                  {membership && (
                    <Badge variant="secondary" className="gap-1">
                      <Crown className="h-3 w-3" />
                      Member
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                  <a href={`mailto:${customer.email}`} className="flex items-center gap-1 hover:text-primary">
                    <Mail className="h-4 w-4" />
                    {customer.email}
                  </a>
                  {customer.phone && (
                    <a href={`tel:${customer.phone}`} className="flex items-center gap-1 hover:text-primary">
                      <Phone className="h-4 w-4" />
                      {customer.phone}
                    </a>
                  )}
                </div>
                {customer.city && (
                  <div className="flex items-center gap-1 mt-1 text-sm text-muted-foreground">
                    <MapPin className="h-4 w-4" />
                    {customer.city}, {customer.state}
                  </div>
                )}
              </div>
            </div>
            
            <div className="flex-1" />
            
            {/* Stats */}
            <div className="grid grid-cols-4 gap-4">
              <div className="text-center p-4 bg-muted rounded-lg">
                <div className="text-2xl font-bold">{formatCurrency(stats.totalSpent)}</div>
                <div className="text-xs text-muted-foreground">Total Spent</div>
              </div>
              <div className="text-center p-4 bg-muted rounded-lg">
                <div className="text-2xl font-bold">{stats.totalBookings}</div>
                <div className="text-xs text-muted-foreground">Bookings</div>
              </div>
              <div className="text-center p-4 bg-muted rounded-lg">
                <div className="text-2xl font-bold flex items-center justify-center gap-1">
                  {stats.avgRating}
                  <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                </div>
                <div className="text-xs text-muted-foreground">Avg Rating</div>
              </div>
              <div className="text-center p-4 bg-muted rounded-lg">
                <div className="text-2xl font-bold">{stats.referralCount}</div>
                <div className="text-xs text-muted-foreground">Referrals</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-4">
        {/* Main Content */}
        <div className="lg:col-span-3">
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="bookings">Bookings</TabsTrigger>
              <TabsTrigger value="payments">Payments</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-4 space-y-6">
              {/* Contact Information */}
              <Card>
                <CardHeader>
                  <CardTitle>Contact Information</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-sm text-muted-foreground">Email</p>
                    <p className="font-medium">{customer.email}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Phone</p>
                    <p className="font-medium">{customer.phone || "Not provided"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Address</p>
                    <p className="font-medium">
                      {customer.address ? (
                        <>
                          {customer.address}<br />
                          {customer.city}, {customer.state} {customer.zip}
                        </>
                      ) : (
                        "Not provided"
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Referral Code</p>
                    <p className="font-medium font-mono">{customer.referral_code || "None"}</p>
                  </div>
                </CardContent>
              </Card>

              {/* Membership */}
              {membership && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Crown className="h-5 w-5" />
                      Membership
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-4 sm:grid-cols-3">
                    <div>
                      <p className="text-sm text-muted-foreground">Plan</p>
                      <Badge variant="secondary">{membership.membership_plan}</Badge>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Credits</p>
                      <p className="font-medium">
                        {membership.credits_remaining} / {membership.credits_per_month}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Renews</p>
                      <p className="font-medium">
                        {format(parseISO(membership.current_period_end), "MMM d, yyyy")}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Saved Addresses */}
              <Card>
                <CardHeader>
                  <CardTitle>Saved Addresses</CardTitle>
                </CardHeader>
                <CardContent>
                  {addresses.length === 0 ? (
                    <p className="text-muted-foreground">No saved addresses</p>
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-2">
                      {addresses.map((address) => (
                        <div key={address.id} className="p-4 border rounded-lg">
                          <div className="flex items-start gap-2">
                            <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground" />
                            <div>
                              <p className="font-medium">{address.street}</p>
                              {address.unit && (
                                <p className="text-sm text-muted-foreground">{address.unit}</p>
                              )}
                              <p className="text-sm text-muted-foreground">
                                {address.city}, {address.state} {address.zip}
                              </p>
                              <Badge variant="outline" className="mt-2">{address.sqft_tier}</Badge>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Referrals */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Share2 className="h-5 w-5" />
                    Referrals
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {referrals.length === 0 ? (
                    <p className="text-muted-foreground">No referrals yet</p>
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
                            <TableCell className="font-mono">{referral.code}</TableCell>
                            <TableCell>{referral.referred_email || "—"}</TableCell>
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

            <TabsContent value="bookings" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Booking History</CardTitle>
                  <CardDescription>All bookings for this customer</CardDescription>
                </CardHeader>
                <CardContent>
                  {bookings.length === 0 ? (
                    <p className="text-center py-8 text-muted-foreground">No bookings yet</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Booking #</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Service</TableHead>
                          <TableHead>Location</TableHead>
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
                                <div className="text-xs text-muted-foreground">{booking.time_slot}</div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">{booking.service_type}</Badge>
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {booking.city}
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

            <TabsContent value="payments" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Payment History</CardTitle>
                  <CardDescription>Transaction history and invoices</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-center py-8 text-muted-foreground">
                    Payment history is managed through Stripe. 
                    <Button variant="link" asChild className="px-1">
                      <a href="https://dashboard.stripe.com/customers" target="_blank" rel="noopener noreferrer">
                        View in Stripe <ExternalLink className="ml-1 h-3 w-3" />
                      </a>
                    </Button>
                  </p>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="activity" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Activity Log</CardTitle>
                  <CardDescription>Recent account activity</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-center py-8 text-muted-foreground">
                    Activity logging coming soon
                  </p>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Admin Actions Sidebar */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Admin Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button variant="outline" className="w-full justify-start" asChild>
                <a href={`mailto:${customer.email}`}>
                  <Mail className="mr-2 h-4 w-4" />
                  Send Email
                </a>
              </Button>
              {customer.phone && (
                <Button variant="outline" className="w-full justify-start" asChild>
                  <a href={`sms:${customer.phone}`}>
                    <MessageSquare className="mr-2 h-4 w-4" />
                    Send SMS
                  </a>
                </Button>
              )}
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={handleResetPassword}
                disabled={isProcessing}
              >
                <Key className="mr-2 h-4 w-4" />
                Reset Password
              </Button>
              
              <Dialog open={creditDialogOpen} onOpenChange={setCreditDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="w-full justify-start">
                    <Gift className="mr-2 h-4 w-4" />
                    Add Credit
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add Account Credit</DialogTitle>
                    <DialogDescription>
                      Add credit to this customer's account
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>Credit Amount ($)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="25.00"
                        value={creditAmount}
                        onChange={(e) => setCreditAmount(e.target.value)}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setCreditDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleAddCredit} disabled={isProcessing || !creditAmount}>
                      Add Credit
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Separator className="my-4" />

              <AlertDialog open={suspendDialogOpen} onOpenChange={setSuspendDialogOpen}>
                <Button
                  variant="outline"
                  className="w-full justify-start text-orange-600 hover:text-orange-700"
                  onClick={() => setSuspendDialogOpen(true)}
                >
                  <UserX className="mr-2 h-4 w-4" />
                  Suspend Account
                </Button>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Suspend Account</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to suspend this customer's account?
                      They will not be able to log in or make bookings.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction className="bg-orange-600 hover:bg-orange-700">
                      Suspend Account
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <Button
                  variant="outline"
                  className="w-full justify-start text-red-600 hover:text-red-700"
                  onClick={() => setDeleteDialogOpen(true)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete Account
                </Button>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Account</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to permanently delete this customer's account?
                      This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-red-600 hover:bg-red-700"
                      onClick={handleDeleteAccount}
                    >
                      Delete Account
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>

          {/* Customer ID Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Customer ID</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs font-mono text-muted-foreground break-all">
                {customer.id}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
