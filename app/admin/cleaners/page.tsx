"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
  Search,
  Users,
  CheckCircle,
  XCircle,
  Shield,
  UserPlus,
} from "lucide-react";
import { motion } from "framer-motion";
import { ProtectedRoute } from "@/components/ProtectedRoute";

interface Cleaner {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  status: string;
  approved: boolean;
  state: string;
  home_zip: string;
  created_at: string;
}

function AdminCleanersContent() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [cleaners, setCleaners] = useState<Cleaner[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    loadCleaners();
  }, []);

  const loadCleaners = async () => {
    try {
      const { data, error } = await supabase
        .from("cleaners")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setCleaners(data || []);
    } catch (error) {
      console.error("Error loading cleaners:", error);
      toast.error("Failed to load cleaners");
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/admin/auth");
  };

  const toggleApproval = async (cleanerId: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase
        .from("cleaners")
        .update({ approved: !currentStatus })
        .eq("id", cleanerId);

      if (error) throw error;

      setCleaners((prev) =>
        prev.map((c) => (c.id === cleanerId ? { ...c, approved: !currentStatus } : c))
      );

      toast.success(`Cleaner ${!currentStatus ? "approved" : "unapproved"}`);
    } catch (error) {
      toast.error("Failed to update status");
    }
  };

  const filteredCleaners = cleaners.filter(
    (c) =>
      c.first_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.last_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.email?.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
              <p className="text-xs text-slate-400">Cleaner Management</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={handleSignOut} className="text-slate-400 hover:text-white">
            <LogOut className="w-5 h-5" />
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="bg-slate-800/50 border-slate-700">
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center">
                    <Users className="w-6 h-6 text-blue-400" />
                  </div>
                  <div>
                    <p className="text-sm text-slate-400">Total Cleaners</p>
                    <p className="text-2xl font-bold text-white">{cleaners.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <Card className="bg-slate-800/50 border-slate-700">
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center">
                    <CheckCircle className="w-6 h-6 text-green-400" />
                  </div>
                  <div>
                    <p className="text-sm text-slate-400">Approved</p>
                    <p className="text-2xl font-bold text-white">
                      {cleaners.filter((c) => c.approved).length}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <Card className="bg-slate-800/50 border-slate-700">
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-amber-500/20 flex items-center justify-center">
                    <UserPlus className="w-6 h-6 text-amber-400" />
                  </div>
                  <div>
                    <p className="text-sm text-slate-400">Pending</p>
                    <p className="text-2xl font-bold text-white">
                      {cleaners.filter((c) => !c.approved).length}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {/* Cleaners Table */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-white">Cleaners</CardTitle>
                <div className="relative w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <Input
                    placeholder="Search cleaners..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 bg-slate-900/50 border-slate-600 text-white placeholder:text-slate-500"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border border-slate-700 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-700 hover:bg-slate-800/50">
                      <TableHead className="text-slate-400">Name</TableHead>
                      <TableHead className="text-slate-400">Email</TableHead>
                      <TableHead className="text-slate-400">Phone</TableHead>
                      <TableHead className="text-slate-400">Location</TableHead>
                      <TableHead className="text-slate-400">Status</TableHead>
                      <TableHead className="text-slate-400">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredCleaners.map((cleaner) => (
                      <TableRow key={cleaner.id} className="border-slate-700 hover:bg-slate-800/50">
                        <TableCell className="text-white font-medium">
                          {cleaner.first_name} {cleaner.last_name}
                        </TableCell>
                        <TableCell className="text-slate-300">{cleaner.email}</TableCell>
                        <TableCell className="text-slate-300">{cleaner.phone}</TableCell>
                        <TableCell className="text-slate-300">
                          {cleaner.home_zip}, {cleaner.state}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={cleaner.approved ? "default" : "secondary"}
                            className={
                              cleaner.approved
                                ? "bg-green-500/20 text-green-400 border-green-500/30"
                                : "bg-amber-500/20 text-amber-400 border-amber-500/30"
                            }
                          >
                            {cleaner.approved ? "Approved" : "Pending"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant={cleaner.approved ? "outline" : "default"}
                            onClick={() => toggleApproval(cleaner.id, cleaner.approved)}
                            className={
                              cleaner.approved
                                ? "border-slate-600 text-slate-300 hover:bg-slate-700"
                                : "bg-green-600 hover:bg-green-700"
                            }
                          >
                            {cleaner.approved ? (
                              <>
                                <XCircle className="w-4 h-4 mr-1" />
                                Revoke
                              </>
                            ) : (
                              <>
                                <CheckCircle className="w-4 h-4 mr-1" />
                                Approve
                              </>
                            )}
                          </Button>
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

export default function AdminCleaners() {
  return (
    <ProtectedRoute requiredRole="admin">
      <AdminCleanersContent />
    </ProtectedRoute>
  );
}
