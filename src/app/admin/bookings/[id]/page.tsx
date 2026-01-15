"use client";
export const dynamic = "force-dynamic";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  Calendar,
  Clock,
  MapPin,
  User,
  Phone,
  Mail,
  CreditCard,
  Home,
  Star,
  CheckCircle,
  XCircle,
  UserPlus,
  CalendarClock,
  RefreshCcw,
  ExternalLink,
  AlertTriangle,
  MessageSquare,
} from "lucide-react";
import { toast } from "sonner";

interface BookingDetails {
  id: string;
  booking_number: number | null;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip_code: string;
  service_date: string;
  time_slot: string;
  service_type: string;
  status: string | null;
  payment_method: string | null;
  payment_option: string | null;
  payment_intent_id: string | null;
  total_estimate_cents: number;
  base_price_cents: number;
  deposit_cents: number;
  tax_cents: number | null;
  tip_cents: number | null;
  home_size_id: string;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  dwelling_type: string | null;
  flooring_type: string | null;
  pets: string | null;
  add_ons: string[] | null;
  access_notes: string | null;
  team_notes: string | null;
  cleaner_id: string | null;
  cleaner_payout_cents: number | null;
  membership_plan: string | null;
  uses_credit: boolean | null;
  created_at: string | null;
  completed_at: string | null;
  cancel_reason: string | null;
  before_photos: string[] | null;
  after_photos: string[] | null;
  rating_submitted: boolean | null;
  cleaners?: {
    id: string;
    first_name: string;
    last_name: string;
    phone: string;
    email: string;
    avatar_url: string | null;
  };
  cleaner_ratings?: {
    rating: number;
    review: string | null;
    created_at: string;
  }[];
}

interface Cleaner {
  id: string;
  first_name: string;
  last_name: string;
  status: string;
}

export default function BookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const router = useRouter();
  const [booking, setBooking] = useState<BookingDetails | null>(null);
  const [cleaners, setCleaners] = useState<Cleaner[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [selectedCleaner, setSelectedCleaner] = useState<string>("");
  const [cancelReason, setCancelReason] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  const fetchBooking = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("bookings")
        .select(`
          *,
          cleaners (
            id,
            first_name,
            last_name,
            phone,
            email,
            avatar_url
          ),
          cleaner_ratings (
            rating,
            review,
            created_at
          )
        `)
        .eq("id", resolvedParams.id)
        .single();

      if (error) throw error;
      // Ensure cleaner_ratings is always an array
      const bookingData = {
        ...data,
        cleaner_ratings: Array.isArray(data.cleaner_ratings) 
          ? data.cleaner_ratings 
          : data.cleaner_ratings 
            ? [data.cleaner_ratings] 
            : [],
      };
      setBooking(bookingData as BookingDetails);
    } catch (error) {
      console.error("Error fetching booking:", error);
      toast.error("Failed to load booking details");
    } finally {
      setIsLoading(false);
    }
  };

  const fetchCleaners = async () => {
    const { data } = await supabase
      .from("cleaners")
      .select("id, first_name, last_name, status")
      .eq("status", "active")
      .order("first_name");
    setCleaners(data || []);
  };

  useEffect(() => {
    fetchBooking();
    fetchCleaners();
  }, [resolvedParams.id]);

  const handleAssignCleaner = async () => {
    if (!selectedCleaner || !booking) return;
    setIsProcessing(true);

    try {
      const { error } = await supabase.functions.invoke("assign-cleaner", {
        body: {
          bookingId: booking.id,
          cleanerId: selectedCleaner,
          role: "lead",
        },
      });

      if (error) throw error;

      toast.success("Cleaner assigned successfully");
      setAssignDialogOpen(false);
      fetchBooking();
    } catch (error) {
      console.error("Error assigning cleaner:", error);
      toast.error("Failed to assign cleaner");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancelBooking = async () => {
    if (!booking) return;
    setIsProcessing(true);

    try {
      const { error } = await supabase.functions.invoke("cancel-booking", {
        body: {
          bookingId: booking.id,
          reason: cancelReason,
          refundType: "full",
        },
      });

      if (error) throw error;

      toast.success("Booking cancelled successfully");
      setCancelDialogOpen(false);
      fetchBooking();
    } catch (error) {
      console.error("Error cancelling booking:", error);
      toast.error("Failed to cancel booking");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCompleteBooking = async () => {
    if (!booking) return;
    setIsProcessing(true);

    try {
      const { error } = await supabase.functions.invoke("complete-booking", {
        body: {
          bookingId: booking.id,
        },
      });

      if (error) throw error;

      toast.success("Booking marked as complete");
      fetchBooking();
    } catch (error) {
      console.error("Error completing booking:", error);
      toast.error("Failed to complete booking");
    } finally {
      setIsProcessing(false);
    }
  };

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
          <div className="lg:col-span-2 space-y-6">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-lg font-medium text-muted-foreground">
          Booking not found
        </p>
        <Link href="/portal/bookings" className="mt-4">
          <Button variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Bookings
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/portal/bookings">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
              Booking #{booking.booking_number || "N/A"}
              <Badge variant={getStatusBadgeVariant(booking.status)}>
                {booking.status || "Pending"}
              </Badge>
            </h1>
            <p className="text-muted-foreground">
              Created {booking.created_at ? format(parseISO(booking.created_at), "MMM d, yyyy 'at' h:mm a") : "N/A"}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchBooking}>
            <RefreshCcw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          {booking.status !== "cancelled" && booking.status !== "completed" && (
            <>
              <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline">
                    <UserPlus className="mr-2 h-4 w-4" />
                    {booking.cleaner_id ? "Reassign" : "Assign"} Cleaner
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Assign Cleaner</DialogTitle>
                    <DialogDescription>
                      Select a cleaner to assign to this booking.
                    </DialogDescription>
                  </DialogHeader>
                  <Select value={selectedCleaner} onValueChange={setSelectedCleaner}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a cleaner" />
                    </SelectTrigger>
                    <SelectContent>
                      {cleaners.map((cleaner) => (
                        <SelectItem key={cleaner.id} value={cleaner.id}>
                          {cleaner.first_name} {cleaner.last_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <DialogFooter>
                    <Button
                      onClick={handleAssignCleaner}
                      disabled={!selectedCleaner || isProcessing}
                    >
                      {isProcessing ? "Assigning..." : "Assign"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Button onClick={handleCompleteBooking} disabled={isProcessing}>
                <CheckCircle className="mr-2 h-4 w-4" />
                Complete
              </Button>

              <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="destructive">
                    <XCircle className="mr-2 h-4 w-4" />
                    Cancel
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Cancel Booking</DialogTitle>
                    <DialogDescription>
                      Are you sure you want to cancel this booking? This action cannot be undone.
                    </DialogDescription>
                  </DialogHeader>
                  <Textarea
                    placeholder="Reason for cancellation (optional)"
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                  />
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setCancelDialogOpen(false)}
                    >
                      Keep Booking
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleCancelBooking}
                      disabled={isProcessing}
                    >
                      {isProcessing ? "Cancelling..." : "Cancel Booking"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {/* Customer Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Customer Information
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-sm text-muted-foreground">Name</p>
                <p className="font-medium">{booking.first_name} {booking.last_name}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Email</p>
                <a href={`mailto:${booking.email}`} className="font-medium text-primary hover:underline flex items-center gap-1">
                  <Mail className="h-4 w-4" />
                  {booking.email}
                </a>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Phone</p>
                <a href={`tel:${booking.phone}`} className="font-medium text-primary hover:underline flex items-center gap-1">
                  <Phone className="h-4 w-4" />
                  {booking.phone}
                </a>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Address</p>
                <p className="font-medium flex items-start gap-1">
                  <MapPin className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>
                    {booking.address}<br />
                    {booking.city}, {booking.state} {booking.zip_code}
                  </span>
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Service Details */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Home className="h-5 w-5" />
                Service Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <p className="text-sm text-muted-foreground">Service Type</p>
                  <Badge variant="outline" className="mt-1">{booking.service_type}</Badge>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Home Size</p>
                  <p className="font-medium">{booking.home_size_id}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Square Footage</p>
                  <p className="font-medium">{booking.sqft ? `${booking.sqft} sq ft` : "N/A"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Bedrooms</p>
                  <p className="font-medium">{booking.bedrooms || "N/A"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Bathrooms</p>
                  <p className="font-medium">{booking.bathrooms || "N/A"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Dwelling Type</p>
                  <p className="font-medium">{booking.dwelling_type || "N/A"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Flooring Type</p>
                  <p className="font-medium">{booking.flooring_type || "N/A"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Pets</p>
                  <p className="font-medium">{booking.pets || "None"}</p>
                </div>
              </div>

              {booking.add_ons && booking.add_ons.length > 0 && (
                <div>
                  <p className="text-sm text-muted-foreground mb-2">Add-ons</p>
                  <div className="flex flex-wrap gap-2">
                    {booking.add_ons.map((addon, i) => (
                      <Badge key={i} variant="secondary">{addon}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {booking.access_notes && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Access Notes</p>
                  <p className="text-sm bg-muted p-3 rounded-lg">{booking.access_notes}</p>
                </div>
              )}

              {booking.team_notes && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Team Notes</p>
                  <p className="text-sm bg-muted p-3 rounded-lg">{booking.team_notes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Cleaner Assignment */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserPlus className="h-5 w-5" />
                Assigned Cleaner
              </CardTitle>
            </CardHeader>
            <CardContent>
              {booking.cleaners ? (
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">
                      {booking.cleaners.first_name} {booking.cleaners.last_name}
                    </p>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <a href={`mailto:${booking.cleaners.email}`} className="hover:text-primary">
                        {booking.cleaners.email}
                      </a>
                      <a href={`tel:${booking.cleaners.phone}`} className="hover:text-primary">
                        {booking.cleaners.phone}
                      </a>
                    </div>
                  </div>
                  <Link href={`/portal/cleaners/${booking.cleaners.id}`} className="ml-auto">
                    <Button variant="outline" size="sm">
                      View Profile
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="flex items-center justify-between py-4">
                  <div className="flex items-center gap-3 text-muted-foreground">
                    <AlertTriangle className="h-5 w-5 text-orange-500" />
                    <span>No cleaner assigned yet</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAssignDialogOpen(true)}
                  >
                    <UserPlus className="mr-2 h-4 w-4" />
                    Assign Cleaner
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Rating */}
          {booking.cleaner_ratings && booking.cleaner_ratings.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Star className="h-5 w-5" />
                  Customer Review
                </CardTitle>
              </CardHeader>
              <CardContent>
                {booking.cleaner_ratings.map((rating, i) => (
                  <div key={i} className="space-y-2">
                    <div className="flex items-center gap-2">
                      {[...Array(5)].map((_, j) => (
                        <Star
                          key={j}
                          className={`h-5 w-5 ${
                            j < rating.rating
                              ? "fill-yellow-400 text-yellow-400"
                              : "text-muted"
                          }`}
                        />
                      ))}
                      <span className="text-sm text-muted-foreground ml-2">
                        {format(parseISO(rating.created_at), "MMM d, yyyy")}
                      </span>
                    </div>
                    {rating.review && (
                      <p className="text-sm text-muted-foreground">{rating.review}</p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Schedule Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Schedule
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground">Service Date</p>
                <p className="text-xl font-bold">
                  {format(parseISO(booking.service_date), "EEEE, MMMM d, yyyy")}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Time Slot</p>
                <p className="font-medium flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  {booking.time_slot}
                </p>
              </div>
              {booking.status !== "cancelled" && booking.status !== "completed" && (
                <Button variant="outline" className="w-full" asChild>
                  <Link href={`/portal/bookings/${booking.id}/reschedule`}>
                    <CalendarClock className="mr-2 h-4 w-4" />
                    Reschedule
                  </Link>
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Payment Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                Payment
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Base Price</span>
                  <span>{formatCurrency(booking.base_price_cents)}</span>
                </div>
                {booking.tax_cents && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Tax</span>
                    <span>{formatCurrency(booking.tax_cents)}</span>
                  </div>
                )}
                {booking.tip_cents && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Tip</span>
                    <span>{formatCurrency(booking.tip_cents)}</span>
                  </div>
                )}
                <Separator />
                <div className="flex justify-between font-medium">
                  <span>Total</span>
                  <span className="text-lg">{formatCurrency(booking.total_estimate_cents)}</span>
                </div>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Payment Method</span>
                  <span className="capitalize">{booking.payment_method || "N/A"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Payment Option</span>
                  <span className="capitalize">{booking.payment_option || "N/A"}</span>
                </div>
                {booking.membership_plan && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Membership</span>
                    <Badge variant="outline">{booking.membership_plan}</Badge>
                  </div>
                )}
                {booking.uses_credit && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Using Credit</span>
                    <Badge variant="secondary">Yes</Badge>
                  </div>
                )}
              </div>

              {booking.payment_intent_id && (
                <Button variant="outline" className="w-full" asChild>
                  <a
                    href={`https://dashboard.stripe.com/payments/${booking.payment_intent_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    View in Stripe
                  </a>
                </Button>
              )}

              {booking.cleaner_payout_cents && (
                <div className="pt-4 border-t">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Cleaner Payout</span>
                    <span className="font-medium">{formatCurrency(booking.cleaner_payout_cents)}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
