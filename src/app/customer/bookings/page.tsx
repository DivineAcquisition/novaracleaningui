"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { format, parseISO } from "date-fns";
import {
  Calendar,
  Plus,
  Eye,
  Clock,
  MapPin,
  Filter,
  Activity,
} from "lucide-react";

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

  const getStatusVariant = (status: string | null) => {
    switch (status) {
      case "confirmed": return "default";
      case "completed": return "secondary";
      case "cancelled": return "destructive";
      default: return "outline";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your Bookings</h1>
          <p className="text-sm text-muted-foreground">View and manage your cleaning appointments</p>
        </div>
        <Button asChild>
          <Link href="/customer/bookings/new">
            <Plus className="mr-2 h-4 w-4" />
            New Booking
          </Link>
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-3">
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
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : bookings.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Activity className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="font-medium mb-1">No bookings found</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {filter === "all" ? "You haven't made any bookings yet." : `No ${filter} bookings.`}
            </p>
            <Button asChild>
              <Link href="/customer/bookings/new">
                <Plus className="mr-2 h-4 w-4" />
                Book Your First Cleaning
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {bookings.map((booking) => (
            <Card key={booking.id} className="hover:border-primary/50 transition-colors">
              <CardContent className="p-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 flex-shrink-0">
                      <Calendar className="h-5 w-5 text-primary" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium">
                          {format(parseISO(booking.service_date), "EEEE, MMMM d, yyyy")}
                        </p>
                        <Badge variant={getStatusVariant(booking.status)}>
                          {booking.status || "Pending"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          {booking.time_slot}
                        </span>
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5" />
                          {booking.city}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{booking.service_type}</Badge>
                        {booking.booking_number && (
                          <span className="text-xs text-muted-foreground">#{booking.booking_number}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 md:flex-col md:items-end">
                    <p className="font-semibold">{formatCurrency(booking.total_estimate_cents)}</p>
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/customer/bookings/${booking.id}`}>
                        <Eye className="mr-2 h-4 w-4" />
                        View
                      </Link>
                    </Button>
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
