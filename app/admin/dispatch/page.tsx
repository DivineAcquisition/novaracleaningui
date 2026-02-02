"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  Loader2,
  LogOut,
  Calendar,
  MapPin,
  User,
  Shield,
  Clock,
  CheckCircle,
} from "lucide-react";
import { motion } from "framer-motion";
import { format } from "date-fns";
import { ProtectedRoute } from "@/components/ProtectedRoute";

interface Booking {
  id: string;
  first_name: string | null;
  last_name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  service_date: string | null;
  time_slot: string | null;
  service_type: string | null;
  status: string | null;
  assigned_cleaner_id?: string | null;
}

interface Cleaner {
  id: string;
  first_name: string;
  last_name: string;
  status: string;
}

function AdminDispatchContent() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [cleaners, setCleaners] = useState<Cleaner[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [bookingsRes, cleanersRes] = await Promise.all([
        supabase
          .from("bookings")
          .select("*")
          .order("service_date", { ascending: true }),
        supabase
          .from("cleaners")
          .select("id, first_name, last_name, status")
          .eq("approved", true)
          .eq("status", "active"),
      ]);

      if (bookingsRes.error) throw bookingsRes.error;
      if (cleanersRes.error) throw cleanersRes.error;

      setBookings((bookingsRes.data || []) as Booking[]);
      setCleaners((cleanersRes.data || []) as Cleaner[]);
    } catch (error) {
      console.error("Error loading data:", error);
      toast.error("Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/admin/auth");
  };

  const assignCleaner = async (bookingId: string, cleanerId: string) => {
    try {
      const { error } = await supabase
        .from("bookings")
        .update({
          assigned_cleaner_id: cleanerId,
          status: "assigned",
        })
        .eq("id", bookingId);

      if (error) throw error;

      setBookings((prev) =>
        prev.map((b) =>
          b.id === bookingId
            ? { ...b, assigned_cleaner_id: cleanerId, status: "assigned" }
            : b
        )
      );

      toast.success("Cleaner assigned successfully");
    } catch (error) {
      toast.error("Failed to assign cleaner");
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "confirmed":
      case "completed":
        return "bg-green-500/20 text-green-400";
      case "assigned":
        return "bg-blue-500/20 text-blue-400";
      case "pending":
        return "bg-amber-500/20 text-amber-400";
      default:
        return "bg-slate-500/20 text-slate-400";
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-slate-900/80 backdrop-blur-lg border-b border-slate-700">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="font-semibold text-white">Admin Portal</p>
              <p className="text-xs text-slate-400">Dispatch Center</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleSignOut}
            className="text-slate-400 hover:text-white"
          >
            <LogOut className="w-5 h-5" />
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="bg-slate-800/50 border-slate-700">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <Calendar className="w-8 h-8 text-blue-400" />
                  <div>
                    <p className="text-2xl font-bold text-white">{bookings.length}</p>
                    <p className="text-xs text-slate-400">Total Bookings</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <Card className="bg-slate-800/50 border-slate-700">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <Clock className="w-8 h-8 text-amber-400" />
                  <div>
                    <p className="text-2xl font-bold text-white">
                      {bookings.filter((b) => b.status === "pending").length}
                    </p>
                    <p className="text-xs text-slate-400">Pending</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <Card className="bg-slate-800/50 border-slate-700">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <User className="w-8 h-8 text-purple-400" />
                  <div>
                    <p className="text-2xl font-bold text-white">
                      {bookings.filter((b) => b.status === "assigned").length}
                    </p>
                    <p className="text-xs text-slate-400">Assigned</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
            <Card className="bg-slate-800/50 border-slate-700">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <CheckCircle className="w-8 h-8 text-green-400" />
                  <div>
                    <p className="text-2xl font-bold text-white">
                      {bookings.filter((b) => b.status === "completed").length}
                    </p>
                    <p className="text-xs text-slate-400">Completed</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {/* Bookings Table */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white">Bookings</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border border-slate-700 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-700 hover:bg-slate-800/50">
                      <TableHead className="text-slate-400">Customer</TableHead>
                      <TableHead className="text-slate-400">Location</TableHead>
                      <TableHead className="text-slate-400">Date/Time</TableHead>
                      <TableHead className="text-slate-400">Service</TableHead>
                      <TableHead className="text-slate-400">Status</TableHead>
                      <TableHead className="text-slate-400">Assigned To</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bookings.map((booking) => (
                      <TableRow key={booking.id} className="border-slate-700 hover:bg-slate-800/50">
                        <TableCell className="text-white font-medium">
                          {booking.first_name} {booking.last_name}
                        </TableCell>
                        <TableCell className="text-slate-300">
                          <div className="flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {booking.city}, {booking.state} {booking.zip_code}
                          </div>
                        </TableCell>
                        <TableCell className="text-slate-300">
                          <div>
                            {booking.service_date &&
                              format(new Date(booking.service_date + "T12:00:00"), "MMM d, yyyy")}
                          </div>
                          <div className="text-xs text-slate-500">{booking.time_slot}</div>
                        </TableCell>
                        <TableCell className="text-slate-300">{booking.service_type}</TableCell>
                        <TableCell>
                          <Badge className={getStatusColor(booking.status)}>{booking.status}</Badge>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={booking.assigned_cleaner_id || ""}
                            onValueChange={(value) => assignCleaner(booking.id, value)}
                          >
                            <SelectTrigger className="w-[180px] bg-slate-900/50 border-slate-600 text-white">
                              <SelectValue placeholder="Select cleaner" />
                            </SelectTrigger>
                            <SelectContent className="bg-slate-800 border-slate-700">
                              {cleaners.map((cleaner) => (
                                <SelectItem
                                  key={cleaner.id}
                                  value={cleaner.id}
                                  className="text-white hover:bg-slate-700"
                                >
                                  {cleaner.first_name} {cleaner.last_name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </main>
    </div>
  );
}

export default function AdminDispatch() {
  return (
    <ProtectedRoute requiredRole="admin">
      <AdminDispatchContent />
    </ProtectedRoute>
  );
}
