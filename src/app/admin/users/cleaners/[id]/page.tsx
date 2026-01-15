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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
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
import {
  ArrowLeft,
  Mail,
  Phone,
  MapPin,
  Calendar,
  DollarSign,
  Star,
  Edit,
  CheckCircle,
  Clock,
  Briefcase,
  ExternalLink,
  RefreshCcw,
  Key,
  UserX,
  Trash2,
  CreditCard,
  MessageSquare,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";

interface CleanerProfile {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  avatar_url: string | null;
  status: string;
  home_zip: string | null;
  service_zip_codes: string[] | null;
  max_travel_miles: number | null;
  average_rating: number | null;
  completed_bookings: number | null;
  acceptance_rate: number | null;
  on_time_rate: number | null;
  total_earnings_cents: number | null;
  onboarding_complete: boolean | null;
  stripe_account_id: string | null;
  payouts_enabled: boolean | null;
  pay_rate_hr: number;
  created_at: string;
}

interface JobAssignment {
  id: string;
  status: string;
  role: string;
  assigned_at: string;
  responded_at: string | null;
  estimated_pay_cents: number | null;
  jobs: {
    id: string;
    address: string;
    city: string;
    service_type: string;
    start_datetime: string;
    status: string;
  };
}

interface Payout {
  id: string;
  cleaner_payout_cents: number;
  platform_fee_cents: number;
  status: string;
  created_at: string;
  processed_at: string | null;
}

interface Review {
  id: string;
  rating: number;
  review: string | null;
  created_at: string;
  customer_email: string;
}

export default function CleanerProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const [cleaner, setCleaner] = useState<CleanerProfile | null>(null);
  const [jobs, setJobs] = useState<JobAssignment[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [suspendDialogOpen, setSuspendDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const fetchCleanerData = async () => {
    setIsLoading(true);
    try {
      // Fetch cleaner
      const { data: cleanerData, error: cleanerError } = await supabase
        .from("cleaners")
        .select("*")
        .eq("id", resolvedParams.id)
        .single();

      if (cleanerError) throw cleanerError;
      setCleaner(cleanerData);

      // Fetch job assignments
      const { data: jobsData } = await supabase
        .from("job_assignments")
        .select(`
          *,
          jobs (id, address, city, service_type, start_datetime, status)
        `)
        .eq("cleaner_id", resolvedParams.id)
        .order("assigned_at", { ascending: false })
        .limit(50);

      setJobs(jobsData || []);

      // Fetch payouts
      const { data: payoutsData } = await supabase
        .from("payouts")
        .select("*")
        .eq("cleaner_id", resolvedParams.id)
        .order("created_at", { ascending: false })
        .limit(50);

      setPayouts(payoutsData || []);

      // Fetch reviews
      const { data: reviewsData } = await supabase
        .from("cleaner_ratings")
        .select("*")
        .eq("cleaner_id", resolvedParams.id)
        .order("created_at", { ascending: false });

      setReviews(reviewsData || []);
    } catch (error) {
      console.error("Error fetching cleaner data:", error);
      toast.error("Failed to load cleaner profile");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCleanerData();
  }, [resolvedParams.id]);

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(cents / 100);
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!cleaner) return;
    setIsProcessing(true);
    try {
      const { error } = await supabase
        .from("cleaners")
        .update({ status: newStatus })
        .eq("id", cleaner.id);

      if (error) throw error;
      toast.success(`Status updated to ${newStatus}`);
      fetchCleanerData();
    } catch (error) {
      console.error("Error updating status:", error);
      toast.error("Failed to update status");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!cleaner) return;
    setIsProcessing(true);
    try {
      const { error } = await supabase
        .from("cleaners")
        .delete()
        .eq("id", cleaner.id);

      if (error) throw error;

      toast.success("Cleaner account deleted");
      window.location.href = "/portal/users/cleaners";
    } catch (error) {
      console.error("Error deleting account:", error);
      toast.error("Failed to delete account");
    } finally {
      setIsProcessing(false);
    }
  };

  const totalEarnings = payouts.reduce((sum, p) => sum + p.cleaner_payout_cents, 0);
  const pendingPayouts = payouts.filter((p) => p.status === "pending");

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!cleaner) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-lg font-medium text-muted-foreground">
          Cleaner not found
        </p>
        <Link href="/portal/users/cleaners" className="mt-4">
          <Button variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Cleaners
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/portal/users/cleaners">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Cleaner Profile</h1>
          <p className="text-muted-foreground">
            Joined {format(parseISO(cleaner.created_at), "MMMM yyyy")}
          </p>
        </div>
        <Button variant="outline" onClick={fetchCleanerData}>
          <RefreshCcw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
        <Link href={`/portal/users/cleaners/${cleaner.id}/edit`}>
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
                <AvatarImage src={cleaner.avatar_url || undefined} />
                <AvatarFallback className="text-2xl">
                  {cleaner.first_name[0]}
                  {cleaner.last_name[0]}
                </AvatarFallback>
              </Avatar>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-2xl font-bold">
                    {cleaner.first_name} {cleaner.last_name}
                  </h2>
                  <Badge
                    variant={
                      cleaner.status === "active"
                        ? "default"
                        : cleaner.status === "inactive"
                        ? "secondary"
                        : "outline"
                    }
                  >
                    {cleaner.status}
                  </Badge>
                  {cleaner.onboarding_complete && (
                    <Badge variant="secondary" className="gap-1">
                      <CheckCircle className="h-3 w-3" />
                      Verified
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                  <a href={`mailto:${cleaner.email}`} className="flex items-center gap-1 hover:text-primary">
                    <Mail className="h-4 w-4" />
                    {cleaner.email}
                  </a>
                  <a href={`tel:${cleaner.phone}`} className="flex items-center gap-1 hover:text-primary">
                    <Phone className="h-4 w-4" />
                    {cleaner.phone}
                  </a>
                </div>
                {cleaner.home_zip && (
                  <div className="flex items-center gap-1 mt-1 text-sm text-muted-foreground">
                    <MapPin className="h-4 w-4" />
                    Based in {cleaner.home_zip}
                  </div>
                )}
              </div>
            </div>
            
            <div className="flex-1" />
            
            {/* Stats */}
            <div className="grid grid-cols-4 gap-4">
              <div className="text-center p-4 bg-muted rounded-lg">
                <div className="text-2xl font-bold flex items-center justify-center gap-1">
                  {cleaner.average_rating?.toFixed(1) || "—"}
                  {cleaner.average_rating && (
                    <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                  )}
                </div>
                <div className="text-xs text-muted-foreground">Rating</div>
              </div>
              <div className="text-center p-4 bg-muted rounded-lg">
                <div className="text-2xl font-bold">{cleaner.completed_bookings || 0}</div>
                <div className="text-xs text-muted-foreground">Jobs</div>
              </div>
              <div className="text-center p-4 bg-muted rounded-lg">
                <div className="text-2xl font-bold">
                  {cleaner.acceptance_rate
                    ? `${Math.round(cleaner.acceptance_rate * 100)}%`
                    : "—"}
                </div>
                <div className="text-xs text-muted-foreground">Acceptance</div>
              </div>
              <div className="text-center p-4 bg-muted rounded-lg">
                <div className="text-2xl font-bold">{formatCurrency(cleaner.total_earnings_cents || 0)}</div>
                <div className="text-xs text-muted-foreground">Earnings</div>
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
              <TabsTrigger value="jobs">Jobs</TabsTrigger>
              <TabsTrigger value="earnings">Earnings</TabsTrigger>
              <TabsTrigger value="reviews">Reviews</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-4 space-y-6">
              {/* Performance Metrics */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5" />
                    Performance Metrics
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-6 sm:grid-cols-2">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-muted-foreground">Acceptance Rate</span>
                      <span className="font-medium">
                        {cleaner.acceptance_rate
                          ? `${Math.round(cleaner.acceptance_rate * 100)}%`
                          : "N/A"}
                      </span>
                    </div>
                    <Progress
                      value={(cleaner.acceptance_rate || 0) * 100}
                      className="h-2"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-muted-foreground">On-Time Rate</span>
                      <span className="font-medium">
                        {cleaner.on_time_rate
                          ? `${Math.round(cleaner.on_time_rate * 100)}%`
                          : "N/A"}
                      </span>
                    </div>
                    <Progress
                      value={(cleaner.on_time_rate || 0) * 100}
                      className="h-2"
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Service Coverage */}
              <Card>
                <CardHeader>
                  <CardTitle>Service Coverage</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <p className="text-sm text-muted-foreground">Home ZIP</p>
                    <p className="font-medium">{cleaner.home_zip || "Not set"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Max Travel</p>
                    <p className="font-medium">
                      {cleaner.max_travel_miles ? `${cleaner.max_travel_miles} miles` : "Not set"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Pay Rate</p>
                    <p className="font-medium">${cleaner.pay_rate_hr}/hr</p>
                  </div>
                  <div className="sm:col-span-3">
                    <p className="text-sm text-muted-foreground mb-2">Service ZIP Codes</p>
                    {cleaner.service_zip_codes && cleaner.service_zip_codes.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {cleaner.service_zip_codes.map((zip) => (
                          <Badge key={zip} variant="outline">
                            {zip}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-muted-foreground">No ZIP codes configured</p>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Stripe Connect */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CreditCard className="h-5 w-5" />
                    Stripe Connect
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">
                        {cleaner.payouts_enabled
                          ? "Payouts Enabled"
                          : cleaner.stripe_account_id
                          ? "Setup Incomplete"
                          : "Not Connected"}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {cleaner.stripe_account_id
                          ? `Account: ${cleaner.stripe_account_id}`
                          : "No Stripe account linked"}
                      </p>
                    </div>
                    {cleaner.stripe_account_id && (
                      <Button variant="outline" asChild>
                        <a
                          href={`https://dashboard.stripe.com/connect/accounts/${cleaner.stripe_account_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="mr-2 h-4 w-4" />
                          View in Stripe
                        </a>
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="jobs" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Job History</CardTitle>
                  <CardDescription>Recent job assignments</CardDescription>
                </CardHeader>
                <CardContent>
                  {jobs.length === 0 ? (
                    <p className="text-center py-8 text-muted-foreground">No jobs yet</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Location</TableHead>
                          <TableHead>Service</TableHead>
                          <TableHead>Role</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Pay</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {jobs.map((job) => (
                          <TableRow key={job.id}>
                            <TableCell>
                              {format(parseISO(job.jobs.start_datetime), "MMM d, yyyy")}
                            </TableCell>
                            <TableCell>{job.jobs.city}</TableCell>
                            <TableCell>
                              <Badge variant="outline">{job.jobs.service_type}</Badge>
                            </TableCell>
                            <TableCell className="capitalize">{job.role}</TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  job.status === "accepted"
                                    ? "default"
                                    : job.status === "declined"
                                    ? "destructive"
                                    : "outline"
                                }
                              >
                                {job.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              {job.estimated_pay_cents
                                ? formatCurrency(job.estimated_pay_cents)
                                : "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="earnings" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Earnings & Payouts</CardTitle>
                  <CardDescription>
                    Total earned: {formatCurrency(totalEarnings)}
                    {pendingPayouts.length > 0 && (
                      <span className="ml-2">
                        ({pendingPayouts.length} pending)
                      </span>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {payouts.length === 0 ? (
                    <p className="text-center py-8 text-muted-foreground">No payouts yet</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Amount</TableHead>
                          <TableHead>Platform Fee</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Processed</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {payouts.map((payout) => (
                          <TableRow key={payout.id}>
                            <TableCell>
                              {format(parseISO(payout.created_at), "MMM d, yyyy")}
                            </TableCell>
                            <TableCell className="font-medium">
                              {formatCurrency(payout.cleaner_payout_cents)}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {formatCurrency(payout.platform_fee_cents)}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  payout.status === "completed"
                                    ? "default"
                                    : payout.status === "failed"
                                    ? "destructive"
                                    : "outline"
                                }
                              >
                                {payout.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {payout.processed_at
                                ? format(parseISO(payout.processed_at), "MMM d, yyyy")
                                : "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="reviews" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Customer Reviews</CardTitle>
                  <CardDescription>
                    {reviews.length} review{reviews.length !== 1 ? "s" : ""} •{" "}
                    {cleaner.average_rating?.toFixed(1) || "No"} avg rating
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {reviews.length === 0 ? (
                    <p className="text-center py-8 text-muted-foreground">No reviews yet</p>
                  ) : (
                    <div className="space-y-4">
                      {reviews.map((review) => (
                        <div key={review.id} className="border-b pb-4 last:border-0">
                          <div className="flex items-center gap-2 mb-2">
                            <div className="flex">
                              {[...Array(5)].map((_, i) => (
                                <Star
                                  key={i}
                                  className={`h-4 w-4 ${
                                    i < review.rating
                                      ? "fill-yellow-400 text-yellow-400"
                                      : "text-muted"
                                  }`}
                                />
                              ))}
                            </div>
                            <span className="text-sm text-muted-foreground">
                              {format(parseISO(review.created_at), "MMM d, yyyy")}
                            </span>
                          </div>
                          {review.review && (
                            <p className="text-sm">{review.review}</p>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">
                            From: {review.customer_email}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
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
                <a href={`mailto:${cleaner.email}`}>
                  <Mail className="mr-2 h-4 w-4" />
                  Send Email
                </a>
              </Button>
              <Button variant="outline" className="w-full justify-start" asChild>
                <a href={`sms:${cleaner.phone}`}>
                  <MessageSquare className="mr-2 h-4 w-4" />
                  Send SMS
                </a>
              </Button>

              <Separator className="my-4" />

              {cleaner.status === "active" ? (
                <Button
                  variant="outline"
                  className="w-full justify-start text-orange-600 hover:text-orange-700"
                  onClick={() => handleStatusChange("inactive")}
                  disabled={isProcessing}
                >
                  <UserX className="mr-2 h-4 w-4" />
                  Deactivate
                </Button>
              ) : (
                <Button
                  variant="outline"
                  className="w-full justify-start text-green-600 hover:text-green-700"
                  onClick={() => handleStatusChange("active")}
                  disabled={isProcessing}
                >
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Activate
                </Button>
              )}

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
                      Are you sure you want to permanently delete this cleaner's account?
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

          {/* Cleaner ID Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cleaner ID</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs font-mono text-muted-foreground break-all">
                {cleaner.id}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
