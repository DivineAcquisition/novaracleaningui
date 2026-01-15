"use client";
export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format, startOfWeek, endOfWeek, eachDayOfInterval, addWeeks, subWeeks, isSameDay, parseISO } from "date-fns";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  RefreshCcw,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Booking {
  id: string;
  booking_number: number | null;
  first_name: string;
  last_name: string;
  service_date: string;
  time_slot: string;
  status: string | null;
  cleaner_id: string | null;
  cleaners?: {
    first_name: string;
    last_name: string;
  };
}

export default function DispatchCalendarPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());

  const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 });
  const weekEnd = endOfWeek(currentDate, { weekStartsOn: 0 });
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });

  const fetchBookings = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("bookings")
        .select(`
          id,
          booking_number,
          first_name,
          last_name,
          service_date,
          time_slot,
          status,
          cleaner_id,
          cleaners (first_name, last_name)
        `)
        .gte("service_date", format(weekStart, "yyyy-MM-dd"))
        .lte("service_date", format(weekEnd, "yyyy-MM-dd"))
        .order("time_slot");

      if (error) throw error;
      setBookings(data || []);
    } catch (error) {
      console.error("Error fetching bookings:", error);
      toast.error("Failed to load calendar data");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchBookings();
  }, [currentDate]);

  const getBookingsForDay = (day: Date) => {
    return bookings.filter((b) =>
      isSameDay(parseISO(b.service_date), day)
    );
  };

  const getStatusColor = (status: string | null) => {
    switch (status) {
      case "confirmed":
        return "bg-green-100 text-green-800 border-green-200";
      case "completed":
        return "bg-blue-100 text-blue-800 border-blue-200";
      case "cancelled":
        return "bg-red-100 text-red-800 border-red-200";
      default:
        return "bg-yellow-100 text-yellow-800 border-yellow-200";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/portal/dispatch">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Dispatch Calendar</h1>
          <p className="text-muted-foreground">
            Weekly view of scheduled cleanings
          </p>
        </div>
        <Button variant="outline" onClick={fetchBookings}>
          <RefreshCcw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Week Navigation */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              onClick={() => setCurrentDate(subWeeks(currentDate, 1))}
            >
              <ChevronLeft className="mr-2 h-4 w-4" />
              Previous Week
            </Button>
            <div className="text-center">
              <h2 className="text-lg font-semibold">
                {format(weekStart, "MMMM d")} - {format(weekEnd, "MMMM d, yyyy")}
              </h2>
              <Button
                variant="link"
                className="text-sm"
                onClick={() => setCurrentDate(new Date())}
              >
                Today
              </Button>
            </div>
            <Button
              variant="outline"
              onClick={() => setCurrentDate(addWeeks(currentDate, 1))}
            >
              Next Week
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Calendar Grid */}
      {isLoading ? (
        <div className="grid grid-cols-7 gap-4">
          {[...Array(7)].map((_, i) => (
            <Skeleton key={i} className="h-64 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-2">
          {weekDays.map((day) => {
            const dayBookings = getBookingsForDay(day);
            const isToday = isSameDay(day, new Date());

            return (
              <Card
                key={day.toISOString()}
                className={cn(
                  "min-h-[300px]",
                  isToday && "ring-2 ring-primary"
                )}
              >
                <CardHeader className="pb-2">
                  <CardTitle
                    className={cn(
                      "text-sm",
                      isToday && "text-primary"
                    )}
                  >
                    {format(day, "EEEE")}
                  </CardTitle>
                  <CardDescription>
                    {format(day, "MMM d")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {dayBookings.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">
                      No bookings
                    </p>
                  ) : (
                    dayBookings.map((booking) => (
                      <Link
                        key={booking.id}
                        href={`/portal/bookings/${booking.id}`}
                      >
                        <div
                          className={cn(
                            "p-2 rounded-lg border text-xs cursor-pointer hover:shadow-sm transition-shadow",
                            getStatusColor(booking.status)
                          )}
                        >
                          <div className="font-medium">
                            {booking.time_slot.split(" - ")[0]}
                          </div>
                          <div className="truncate">
                            {booking.first_name} {booking.last_name}
                          </div>
                          {booking.cleaners ? (
                            <div className="text-xs opacity-75 truncate">
                              {booking.cleaners.first_name} {booking.cleaners.last_name}
                            </div>
                          ) : (
                            <Badge variant="outline" className="text-xs mt-1">
                              Unassigned
                            </Badge>
                          )}
                        </div>
                      </Link>
                    ))
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Legend */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-yellow-100 border border-yellow-200" />
              <span className="text-sm">Pending</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-green-100 border border-green-200" />
              <span className="text-sm">Confirmed</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-blue-100 border border-blue-200" />
              <span className="text-sm">Completed</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-red-100 border border-red-200" />
              <span className="text-sm">Cancelled</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
