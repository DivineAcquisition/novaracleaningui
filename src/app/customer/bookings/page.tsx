"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { format, parseISO } from "date-fns";
import {
  Calendar,
  Plus,
  Eye,
  Clock,
  MapPin,
  Loader2,
  Filter,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Booking {
  id: string;
  booking_number: number | null;
  service_date: string;
  time_slot: string;
  service_type: string;
  status: string | null;
  address: string;
  city: string;
  total_estimate_cents: number;
}

export default function CustomerBookingsPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    const fetchBookings = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.email) return;

      setIsLoading(true);
      try {
        const today = format(new Date(), "yyyy-MM-dd");
        let query = supabase
          .from("bookings")
          .select("id, booking_number, service_date, time_slot, service_type, status, address, city, total_estimate_cents")
          .eq("email", session.user.email)
          .order("service_date", { ascending: false });

        if (filter === "upcoming") {
          query = query.gte("service_date", today).eq("status", "confirmed");
        } else if (filter === "completed") {
          query = query.eq("status", "completed");
        } else if (filter === "cancelled") {
          query = query.eq("status", "cancelled");
        }

        const { data, error } = await query;

        if (error) throw error;
        setBookings(data || []);
      } catch (error) {
        console.error("Error fetching bookings:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchBookings();
  }, [filter]);

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

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Your Bookings</h1>
          <p className="text-muted-foreground">
            View and manage your cleaning appointments
          </p>
        </div>
        <Link href="/customer/bookings/new">
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            New Booking
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Filter bookings" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Bookings</SelectItem>
                <SelectItem value="upcoming">Upcoming</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Bookings List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : bookings.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No bookings found</h3>
            <p className="text-muted-foreground mb-4">
              {filter === "all"
                ? "You haven't made any bookings yet."
                : `No ${filter} bookings.`}
            </p>
            <Link href="/customer/bookings/new">
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Book Your First Cleaning
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {bookings.map((booking) => (
            <Card key={booking.id}>
              <CardContent className="p-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Calendar className="h-6 w-6 text-primary" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">
                          {format(parseISO(booking.service_date), "EEEE, MMMM d, yyyy")}
                        </h3>
                        <Badge variant={getStatusBadgeVariant(booking.status)}>
                          {booking.status || "Pending"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-4 w-4" />
                          {booking.time_slot}
                        </span>
                        <span className="flex items-center gap-1">
                          <MapPin className="h-4 w-4" />
                          {booking.city}
                        </span>
                      </div>
                      <p className="text-sm">
                        <Badge variant="outline">{booking.service_type}</Badge>
                        {booking.booking_number && (
                          <span className="ml-2 text-muted-foreground">
                            #{booking.booking_number}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <p className="text-lg font-semibold">
                      {formatCurrency(booking.total_estimate_cents)}
                    </p>
                    <Link href={`/customer/bookings/${booking.id}`}>
                      <Button variant="outline">
                        <Eye className="h-4 w-4 mr-2" />
                        View
                      </Button>
                    </Link>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
