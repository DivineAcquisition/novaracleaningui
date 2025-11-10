import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { Plus, UserCheck, UserX, DollarSign, MapPin, Mail, Phone } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface Cleaner {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone: string;
  stripe_account_id: string | null;
  onboarding_complete: boolean;
  payouts_enabled: boolean;
  status: string;
  available_for_bookings: boolean;
  service_zip_codes: string[];
  total_bookings: number;
  completed_bookings: number;
  total_earnings_cents: number;
  created_at: string;
}

export default function AdminCleaners() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [cleaners, setCleaners] = useState<Cleaner[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newCleaner, setNewCleaner] = useState({
    email: "",
    firstName: "",
    lastName: "",
    phone: "",
  });

  useEffect(() => {
    if (!user) {
      navigate("/auth");
      return;
    }
    fetchCleaners();
  }, [user, navigate]);

  const fetchCleaners = async () => {
    try {
      const { data, error } = await supabase
        .from("cleaners")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setCleaners(data || []);
    } catch (error: any) {
      toast({
        title: "Error loading cleaners",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAddCleaner = async () => {
    try {
      const { data, error } = await supabase
        .from("cleaners")
        .insert({
          email: newCleaner.email,
          first_name: newCleaner.firstName,
          last_name: newCleaner.lastName,
          phone: newCleaner.phone,
          status: "pending",
          invited_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw error;

      toast({
        title: "Cleaner added",
        description: `${newCleaner.firstName} ${newCleaner.lastName} has been invited.`,
      });

      // Send invitation email
      await supabase.functions.invoke("send-cleaner-email", {
        body: {
          type: "invitation",
          email: newCleaner.email,
          data: {
            firstName: newCleaner.firstName,
            lastName: newCleaner.lastName,
            email: newCleaner.email,
            onboardingUrl: `${window.location.origin}/cleaner/auth`,
          },
        },
      });

      setIsAddDialogOpen(false);
      setNewCleaner({ email: "", firstName: "", lastName: "", phone: "" });
      fetchCleaners();
    } catch (error: any) {
      toast({
        title: "Error adding cleaner",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleOnboardCleaner = async (cleanerId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke("onboard-cleaner", {
        body: { cleanerId },
      });

      if (error) throw error;

      if (data?.url) {
        window.open(data.url, "_blank");
        toast({
          title: "Onboarding link opened",
          description: "Complete the Stripe Connect onboarding in the new tab.",
        });
      }
    } catch (error: any) {
      toast({
        title: "Error starting onboarding",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleCheckStatus = async (cleanerId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke("check-cleaner-status", {
        body: { cleanerId },
      });

      if (error) throw error;

      toast({
        title: "Status updated",
        description: data.onboarding_complete
          ? "Onboarding complete!"
          : "Onboarding still in progress",
      });

      fetchCleaners();
    } catch (error: any) {
      toast({
        title: "Error checking status",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const getStatusBadge = (cleaner: Cleaner) => {
    if (cleaner.status === "active" && cleaner.payouts_enabled) {
      return <Badge className="bg-green-500">Active</Badge>;
    }
    if (cleaner.onboarding_complete) {
      return <Badge className="bg-yellow-500">Onboarding Complete</Badge>;
    }
    if (cleaner.stripe_account_id) {
      return <Badge className="bg-blue-500">Onboarding Started</Badge>;
    }
    return <Badge variant="secondary">Pending</Badge>;
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

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-4xl font-bold">Cleaner Management</h1>
          <p className="text-muted-foreground mt-2">
            Manage your cleaning team and track their performance
          </p>
        </div>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Cleaner
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Cleaner</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div>
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  value={newCleaner.firstName}
                  onChange={(e) =>
                    setNewCleaner({ ...newCleaner, firstName: e.target.value })
                  }
                />
              </div>
              <div>
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  value={newCleaner.lastName}
                  onChange={(e) =>
                    setNewCleaner({ ...newCleaner, lastName: e.target.value })
                  }
                />
              </div>
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={newCleaner.email}
                  onChange={(e) =>
                    setNewCleaner({ ...newCleaner, email: e.target.value })
                  }
                />
              </div>
              <div>
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={newCleaner.phone}
                  onChange={(e) =>
                    setNewCleaner({ ...newCleaner, phone: e.target.value })
                  }
                />
              </div>
              <Button onClick={handleAddCleaner} className="w-full">
                Add Cleaner
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-3 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Cleaners</CardTitle>
            <UserCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{cleaners.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Cleaners</CardTitle>
            <UserCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {cleaners.filter((c) => c.status === "active").length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Payouts</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              $
              {(
                cleaners.reduce((sum, c) => sum + c.total_earnings_cents, 0) / 100
              ).toFixed(2)}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cleaners List</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Bookings</TableHead>
                <TableHead>Earnings</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cleaners.map((cleaner) => (
                <TableRow key={cleaner.id}>
                  <TableCell className="font-medium">
                    {cleaner.first_name} {cleaner.last_name}
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1 text-sm">
                      <div className="flex items-center gap-2">
                        <Mail className="h-3 w-3 text-muted-foreground" />
                        {cleaner.email}
                      </div>
                      <div className="flex items-center gap-2">
                        <Phone className="h-3 w-3 text-muted-foreground" />
                        {cleaner.phone}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>{getStatusBadge(cleaner)}</TableCell>
                  <TableCell>
                    {cleaner.completed_bookings} / {cleaner.total_bookings}
                  </TableCell>
                  <TableCell>
                    ${(cleaner.total_earnings_cents / 100).toFixed(2)}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      {!cleaner.onboarding_complete && (
                        <Button
                          size="sm"
                          onClick={() => handleOnboardCleaner(cleaner.id)}
                        >
                          Start Onboarding
                        </Button>
                      )}
                      {cleaner.stripe_account_id && !cleaner.payouts_enabled && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleCheckStatus(cleaner.id)}
                        >
                          Check Status
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
