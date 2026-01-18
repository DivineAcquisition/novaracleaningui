import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Plus, UserCheck, UserX, DollarSign, MapPin, Mail, Phone } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { US_STATES } from "@/lib/us-states";

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
  approved: boolean;
  user_id: string | null;
}

export default function AdminCleaners() {
  const [cleaners, setCleaners] = useState<Cleaner[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newCleaner, setNewCleaner] = useState({
    email: "",
    firstName: "",
    lastName: "",
    phone: "",
    state: "",
    homeZip: "",
    serviceZipCodes: "",
    payRateHr: "18",
  });

  useEffect(() => {
    fetchCleaners();
  }, []);

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
    if (!newCleaner.email || !newCleaner.firstName || !newCleaner.lastName || 
        !newCleaner.phone || !newCleaner.state || !newCleaner.homeZip || 
        !newCleaner.serviceZipCodes) {
      toast({
        title: "Missing fields",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    // Validate ZIP codes
    const zipCodes = newCleaner.serviceZipCodes.split(',').map(z => z.trim()).filter(Boolean);
    if (zipCodes.length === 0) {
      toast({
        title: "Invalid ZIP codes",
        description: "Please enter at least one service ZIP code",
        variant: "destructive",
      });
      return;
    }

    // Validate pay rate
    const payRate = parseFloat(newCleaner.payRateHr);
    if (isNaN(payRate) || payRate < 15 || payRate > 50) {
      toast({
        title: "Invalid pay rate",
        description: "Pay rate must be between $15 and $50 per hour",
        variant: "destructive",
      });
      return;
    }

    try {
      // Create cleaner account with auto-generated password
      const { data: createData, error: createError } = await supabase.functions.invoke(
        "create-cleaner-account",
        {
          body: {
            email: newCleaner.email,
            firstName: newCleaner.firstName,
            lastName: newCleaner.lastName,
            phone: newCleaner.phone,
            state: newCleaner.state,
            homeZip: newCleaner.homeZip,
            serviceZipCodes: zipCodes,
            payRateHr: payRate,
          },
        }
      );

      if (createError) throw createError;
      if (!createData?.success) throw new Error("Failed to create cleaner account");

      // Send invitation email directing to onboarding landing
      const { error: emailError } = await supabase.functions.invoke("send-cleaner-email", {
        body: {
          type: "invitation",
          email: newCleaner.email,
          data: {
            firstName: newCleaner.firstName,
            lastName: newCleaner.lastName,
            email: newCleaner.email,
            onboardingUrl: "https://contractor.novaracleaning.com/cleaner/onboarding-landing",
          },
        },
      });

      if (emailError) {
        console.error("Failed to send credentials email:", emailError);
      }

      toast({
        title: "Cleaner invited",
        description: `Invitation email sent to ${newCleaner.firstName} ${newCleaner.lastName}.`,
      });

      setIsAddDialogOpen(false);
      setNewCleaner({
        email: "",
        firstName: "",
        lastName: "",
        phone: "",
        state: "",
        homeZip: "",
        serviceZipCodes: "",
        payRateHr: "18",
      });
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

  const handleApproveCleaner = async (cleanerId: string) => {
    try {
      const { error } = await supabase
        .from("cleaners")
        .update({ approved: true })
        .eq("id", cleanerId);

      if (error) throw error;

      toast({
        title: "Cleaner approved",
        description: "The cleaner can now create their account.",
      });

      fetchCleaners();
    } catch (error: any) {
      toast({
        title: "Error approving cleaner",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const getStatusBadge = (cleaner: Cleaner) => {
    if (!cleaner.approved) {
      return <Badge variant="destructive">Pending Approval</Badge>;
    }
    if (!cleaner.user_id) {
      return <Badge className="bg-blue-500">Approved - No Account</Badge>;
    }
    if (cleaner.status === "active" && cleaner.payouts_enabled) {
      return <Badge className="bg-[#5500FF]">Active</Badge>;
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
          <h1 className="text-4xl font-bold font-jakarta">Cleaner Management</h1>
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
          <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add New Cleaner</DialogTitle>
              <DialogDescription>
                Enter cleaner details. A login account will be created automatically.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-6 py-4">
              {/* Personal Information */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium">Personal Information</h3>
                <div className="grid gap-3">
                  <div className="grid gap-2">
                    <Label htmlFor="email">Email *</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="cleaner@example.com"
                      value={newCleaner.email}
                      onChange={(e) => setNewCleaner({ ...newCleaner, email: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-2">
                      <Label htmlFor="firstName">First Name *</Label>
                      <Input
                        id="firstName"
                        placeholder="John"
                        value={newCleaner.firstName}
                        onChange={(e) => setNewCleaner({ ...newCleaner, firstName: e.target.value })}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="lastName">Last Name *</Label>
                      <Input
                        id="lastName"
                        placeholder="Doe"
                        value={newCleaner.lastName}
                        onChange={(e) => setNewCleaner({ ...newCleaner, lastName: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="phone">Phone *</Label>
                    <Input
                      id="phone"
                      type="tel"
                      placeholder="(555) 555-5555"
                      value={newCleaner.phone}
                      onChange={(e) => setNewCleaner({ ...newCleaner, phone: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              {/* Location & Service Areas */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium">Location & Service Areas</h3>
                <div className="grid gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-2">
                      <Label htmlFor="state">State *</Label>
                      <Select
                        value={newCleaner.state}
                        onValueChange={(value) => setNewCleaner({ ...newCleaner, state: value })}
                      >
                        <SelectTrigger id="state">
                          <SelectValue placeholder="Select state" />
                        </SelectTrigger>
                        <SelectContent>
                          {US_STATES.map((state) => (
                            <SelectItem key={state.value} value={state.value}>
                              {state.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="homeZip">Home ZIP Code *</Label>
                      <Input
                        id="homeZip"
                        placeholder="12345"
                        maxLength={5}
                        value={newCleaner.homeZip}
                        onChange={(e) => setNewCleaner({ ...newCleaner, homeZip: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="serviceZipCodes">Service ZIP Codes *</Label>
                    <Input
                      id="serviceZipCodes"
                      placeholder="12345, 12346, 12347"
                      value={newCleaner.serviceZipCodes}
                      onChange={(e) => setNewCleaner({ ...newCleaner, serviceZipCodes: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">
                      Enter multiple ZIP codes separated by commas
                    </p>
                  </div>
                </div>
              </div>

              {/* Pay Configuration */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium">Pay Configuration</h3>
                <div className="grid gap-2">
                  <Label htmlFor="payRateHr">Hourly Pay Rate *</Label>
                  <div className="flex items-center gap-2">
                    <span className="text-sm">$</span>
                    <Input
                      id="payRateHr"
                      type="number"
                      min="15"
                      max="50"
                      step="0.50"
                      placeholder="18.00"
                      value={newCleaner.payRateHr}
                      onChange={(e) => setNewCleaner({ ...newCleaner, payRateHr: e.target.value })}
                      className="flex-1"
                    />
                    <span className="text-sm text-muted-foreground">/hr</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Typical range: $18-22/hour based on experience
                  </p>
                </div>
              </div>

              <Button onClick={handleAddCleaner} className="w-full">
                Create Cleaner Account
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
                    <div className="flex gap-2 flex-wrap">
                      {!cleaner.approved && (
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => handleApproveCleaner(cleaner.id)}
                        >
                          Approve
                        </Button>
                      )}
                      {cleaner.approved && !cleaner.user_id && (
                        <Badge variant="outline" className="text-xs">
                          Waiting for signup
                        </Badge>
                      )}
                      {cleaner.user_id && !cleaner.onboarding_complete && (
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
