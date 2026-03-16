"use client";

import {
  RiAddLine,
  RiCheckboxCircleLine,
  RiCloseCircleLine,
  RiEyeLine,
  RiMailLine,
  RiMapPinLine,
  RiMoneyDollarCircleLine,
  RiPencilLine,
  RiPhoneLine,
  RiSearchLine,
  RiStarLine,
  RiUserFollowLine,
  RiUserUnfollowLine
} from "@remixicon/react";
import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";

import { useRouter } from "next/navigation";
import { US_STATES } from "@/lib/us-states";
import { SEO } from "@/components/SEO";

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
  state: string | null;
  home_zip: string | null;
  pay_rate_hr: number;
  average_rating: number | null;
  total_ratings: number | null;
  max_travel_miles: number | null;
}

export default function AdminCleaners() {
  const router = useRouter();
  const [cleaners, setCleaners] = useState<Cleaner[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editCleaner, setEditCleaner] = useState<Cleaner | null>(null);
  const DEFAULT_PAY_RATE = "18";
  const DEFAULT_MAX_TRAVEL = "20";
  const [editForm, setEditForm] = useState({ firstName: "", lastName: "", phone: "", state: "", homeZip: "", serviceZipCodes: "", payRateHr: DEFAULT_PAY_RATE, maxTravelMiles: DEFAULT_MAX_TRAVEL });
  const [newCleaner, setNewCleaner] = useState({
    email: "", firstName: "", lastName: "", phone: "", state: "", homeZip: "", serviceZipCodes: "", payRateHr: DEFAULT_PAY_RATE,
  });

  useEffect(() => { fetchCleaners(); }, []);

  const fetchCleaners = async () => {
    try {
      const { data, error } = await supabase.from("cleaners").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      setCleaners((data as any[]) || []);
    } catch (error: any) {
      toast({ title: "Error loading cleaners", description: error.message, variant: "destructive" });
    } finally { setLoading(false); }
  };

  const filteredCleaners = useMemo(() => {
    return cleaners.filter(c => {
      const matchesSearch = !searchQuery || 
        `${c.first_name} ${c.last_name}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.phone.includes(searchQuery);
      const matchesStatus = statusFilter === "all" || 
        (statusFilter === "active" && c.status === "active") ||
        (statusFilter === "inactive" && c.status === "inactive") ||
        (statusFilter === "pending" && !c.approved);
      return matchesSearch && matchesStatus;
    });
  }, [cleaners, searchQuery, statusFilter]);

  const stats = useMemo(() => ({
    total: cleaners.length,
    active: cleaners.filter(c => c.status === "active").length,
    pending: cleaners.filter(c => !c.approved).length,
    totalBookings: cleaners.reduce((s, c) => s + (c.completed_bookings || 0), 0),
    avgRating: cleaners.filter(c => c.average_rating).length > 0
      ? (cleaners.reduce((s, c) => s + (c.average_rating || 0), 0) / cleaners.filter(c => c.average_rating).length).toFixed(1)
      : "N/A",
    totalPayouts: cleaners.reduce((s, c) => s + (c.total_earnings_cents || 0), 0) / 100,
  }), [cleaners]);

  const handleAddCleaner = async () => {
    if (!newCleaner.email || !newCleaner.firstName || !newCleaner.lastName || !newCleaner.phone || !newCleaner.state || !newCleaner.homeZip || !newCleaner.serviceZipCodes) {
      toast({ title: "Missing fields", description: "Please fill in all required fields", variant: "destructive" }); return;
    }
    const zipCodes = newCleaner.serviceZipCodes.split(',').map(z => z.trim()).filter(Boolean);
    if (zipCodes.length === 0) { toast({ title: "Invalid ZIP codes", variant: "destructive" }); return; }

    try {
      const { data: createData, error: createError } = await supabase.functions.invoke("create-cleaner-account", {
        body: { email: newCleaner.email, firstName: newCleaner.firstName, lastName: newCleaner.lastName, phone: newCleaner.phone, state: newCleaner.state, homeZip: newCleaner.homeZip, serviceZipCodes: zipCodes, payRateHr: parseFloat(newCleaner.payRateHr) },
      });
      if (createError) throw createError;
      if (!createData?.success) throw new Error("Failed to create cleaner account");

      await supabase.functions.invoke("send-cleaner-email", {
        body: { type: "invitation", email: newCleaner.email, data: { firstName: newCleaner.firstName, lastName: newCleaner.lastName, email: newCleaner.email, onboardingUrl: "https://try.novaracleaning.com/cleaner/onboarding-landing" } },
      }).catch(console.error);

      toast({ title: "Cleaner invited", description: `Invitation sent to ${newCleaner.firstName} ${newCleaner.lastName}.` });
      setIsAddDialogOpen(false);
      setNewCleaner({ email: "", firstName: "", lastName: "", phone: "", state: "", homeZip: "", serviceZipCodes: "", payRateHr: DEFAULT_PAY_RATE });
      fetchCleaners();
    } catch (error: any) {
      toast({ title: "Error adding cleaner", description: error.message, variant: "destructive" });
    }
  };

  const handleToggleStatus = async (cleaner: Cleaner) => {
    const newStatus = cleaner.status === "active" ? "inactive" : "active";
    const newAvailable = newStatus === "active";
    try {
      const { error } = await supabase.from("cleaners").update({ status: newStatus, available_for_bookings: newAvailable } as any).eq("id", cleaner.id);
      if (error) throw error;
      toast({ title: `Cleaner ${newStatus === "active" ? "activated" : "deactivated"}` });
      fetchCleaners();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const handleApproveCleaner = async (cleanerId: string) => {
    try {
      const { error } = await supabase.from("cleaners").update({ approved: true } as any).eq("id", cleanerId);
      if (error) throw error;
      toast({ title: "Cleaner approved" });
      fetchCleaners();
    } catch (error: any) {
      toast({ title: "Error approving", description: error.message, variant: "destructive" });
    }
  };

  const handleOnboardCleaner = async (cleanerId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke("onboard-cleaner", { body: { cleanerId } });
      if (error) throw error;
      if (data?.url) { window.open(data.url, "_blank"); toast({ title: "Onboarding link opened" }); }
    } catch (error: any) {
      toast({ title: "Error starting onboarding", description: error.message, variant: "destructive" });
    }
  };

  const handleCheckStatus = async (cleanerId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke("check-cleaner-status", { body: { cleanerId } });
      if (error) throw error;
      toast({ title: "Status updated", description: data.onboarding_complete ? "Onboarding complete!" : "Still in progress" });
      fetchCleaners();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const openEditDialog = (cleaner: Cleaner) => {
    setEditCleaner(cleaner);
    setEditForm({
      firstName: cleaner.first_name, lastName: cleaner.last_name, phone: cleaner.phone,
      state: cleaner.state || "", homeZip: cleaner.home_zip || "",
      serviceZipCodes: (cleaner.service_zip_codes || []).join(", "),
      payRateHr: String(cleaner.pay_rate_hr || 18),
      maxTravelMiles: String(cleaner.max_travel_miles || 20),
    });
  };

  const handleSaveEdit = async () => {
    if (!editCleaner) return;
    const zipCodes = editForm.serviceZipCodes.split(',').map(z => z.trim()).filter(Boolean);
    try {
      const { error } = await supabase.from("cleaners").update({
        first_name: editForm.firstName, last_name: editForm.lastName, phone: editForm.phone,
        state: editForm.state || null, home_zip: editForm.homeZip || null,
        service_zip_codes: zipCodes, pay_rate_hr: parseFloat(editForm.payRateHr) || 18,
        max_travel_miles: parseInt(editForm.maxTravelMiles) || 20,
      } as any).eq("id", editCleaner.id);
      if (error) throw error;
      toast({ title: "Cleaner updated" });
      setEditCleaner(null);
      fetchCleaners();
    } catch (error: any) {
      toast({ title: "Error updating", description: error.message, variant: "destructive" });
    }
  };

  const getStatusBadge = (cleaner: Cleaner) => {
    if (!cleaner.approved) return <Badge variant="destructive">Pending Approval</Badge>;
    if (!cleaner.user_id) return <Badge className="bg-blue-500 text-white">Approved - No Account</Badge>;
    if (cleaner.status === "active" && cleaner.payouts_enabled) return <Badge className="bg-green-500 text-white">Active</Badge>;
    if (cleaner.status === "inactive") return <Badge variant="secondary">Inactive</Badge>;
    if (cleaner.onboarding_complete) return <Badge className="bg-yellow-500 text-white">Onboarding Complete</Badge>;
    if (cleaner.stripe_account_id) return <Badge className="bg-blue-500 text-white">Onboarding Started</Badge>;
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
      <SEO title="Cleaner Management" noindex />
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-4xl font-bold font-jakarta">Cleaner Management</h1>
          <p className="text-muted-foreground mt-2">Manage your cleaning team and track performance</p>
        </div>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button><RiAddLine className="mr-2 h-4 w-4" /> Add Cleaner</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add New Cleaner</DialogTitle>
              <DialogDescription>Enter cleaner details. A login account will be created automatically.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2"><Label>Email *</Label><Input type="email" value={newCleaner.email} onChange={(e) => setNewCleaner({ ...newCleaner, email: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2"><Label>First Name *</Label><Input value={newCleaner.firstName} onChange={(e) => setNewCleaner({ ...newCleaner, firstName: e.target.value })} /></div>
                <div className="grid gap-2"><Label>Last Name *</Label><Input value={newCleaner.lastName} onChange={(e) => setNewCleaner({ ...newCleaner, lastName: e.target.value })} /></div>
              </div>
              <div className="grid gap-2"><Label>Phone *</Label><Input type="tel" value={newCleaner.phone} onChange={(e) => setNewCleaner({ ...newCleaner, phone: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2"><Label>State *</Label>
                  <Select value={newCleaner.state} onValueChange={(v) => setNewCleaner({ ...newCleaner, state: v })}>
                    <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
                    <SelectContent>{US_STATES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2"><Label>Home ZIP *</Label><Input maxLength={5} value={newCleaner.homeZip} onChange={(e) => setNewCleaner({ ...newCleaner, homeZip: e.target.value })} /></div>
              </div>
              <div className="grid gap-2"><Label>Service ZIP Codes *</Label><Input placeholder="12345, 12346" value={newCleaner.serviceZipCodes} onChange={(e) => setNewCleaner({ ...newCleaner, serviceZipCodes: e.target.value })} /><p className="text-xs text-muted-foreground">Comma-separated</p></div>
              <div className="grid gap-2"><Label>Pay Rate ($/hr)</Label><Input type="number" min="15" max="50" value={newCleaner.payRateHr} onChange={(e) => setNewCleaner({ ...newCleaner, payRateHr: e.target.value })} /></div>
              <Button onClick={handleAddCleaner} className="w-full">Create Cleaner Account</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-5 mb-8">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Total</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{stats.total}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Active</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-green-600">{stats.active}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Pending Approval</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-yellow-600">{stats.pending}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Avg Rating</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold flex items-center gap-1"><RiStarLine className="w-4 h-4 text-yellow-500" />{stats.avgRating}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Total Payouts</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">${stats.totalPayouts.toFixed(0)}</div></CardContent></Card>
      </div>

      {/* Search & Filter */}
      <div className="flex gap-4 mb-6">
        <div className="relative flex-1">
          <RiSearchLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search by name, email, or phone..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Filter status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Cleaners</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="pending">Pending Approval</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Rate</TableHead>
                <TableHead>Rating</TableHead>
                <TableHead>Bookings</TableHead>
                <TableHead>Earnings</TableHead>
                <TableHead>Service ZIPs</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCleaners.map((cleaner) => (
                <TableRow key={cleaner.id}>
                  <TableCell className="font-medium">{cleaner.first_name} {cleaner.last_name}</TableCell>
                  <TableCell>
                    <div className="space-y-1 text-xs">
                      <div className="flex items-center gap-1"><RiMailLine className="h-3 w-3 text-muted-foreground" />{cleaner.email}</div>
                      <div className="flex items-center gap-1"><RiPhoneLine className="h-3 w-3 text-muted-foreground" />{cleaner.phone}</div>
                    </div>
                  </TableCell>
                  <TableCell>{getStatusBadge(cleaner)}</TableCell>
                  <TableCell>
                    <div className="text-xs">
                      {cleaner.state && <div>{cleaner.state}</div>}
                      {cleaner.home_zip && <div className="text-muted-foreground">{cleaner.home_zip}</div>}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">${cleaner.pay_rate_hr || 18}/hr</TableCell>
                  <TableCell>
                    {cleaner.average_rating ? (
                      <div className="flex items-center gap-1 text-sm">
                        <RiStarLine className="w-3 h-3 text-yellow-500 fill-yellow-500" />
                        {Number(cleaner.average_rating).toFixed(1)}
                        <span className="text-xs text-muted-foreground">({cleaner.total_ratings || 0})</span>
                      </div>
                    ) : <span className="text-xs text-muted-foreground">No ratings</span>}
                  </TableCell>
                  <TableCell className="text-sm">{cleaner.completed_bookings || 0} / {cleaner.total_bookings || 0}</TableCell>
                  <TableCell className="text-sm">${((cleaner.total_earnings_cents || 0) / 100).toFixed(0)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1 max-w-[120px]">
                      {(cleaner.service_zip_codes || []).slice(0, 3).map(z => (
                        <Badge key={z} variant="outline" className="text-xs">{z}</Badge>
                      ))}
                      {(cleaner.service_zip_codes || []).length > 3 && (
                        <Badge variant="outline" className="text-xs">+{(cleaner.service_zip_codes || []).length - 3}</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {!cleaner.approved && (
                        <Button size="sm" variant="default" onClick={() => handleApproveCleaner(cleaner.id)}>Approve</Button>
                      )}
                      {cleaner.approved && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => openEditDialog(cleaner)}><RiPencilLine className="w-3 h-3" /></Button>
                          <Button size="sm" variant={cleaner.status === "active" ? "destructive" : "default"} onClick={() => handleToggleStatus(cleaner)}>
                            {cleaner.status === "active" ? <RiCloseCircleLine className="w-3 h-3" /> : <RiCheckboxCircleLine className="w-3 h-3" />}
                          </Button>
                          {cleaner.user_id && !cleaner.onboarding_complete && (
                            <Button size="sm" variant="outline" onClick={() => handleOnboardCleaner(cleaner.id)}>Stripe</Button>
                          )}
                          {cleaner.stripe_account_id && !cleaner.payouts_enabled && (
                            <Button size="sm" variant="outline" onClick={() => handleCheckStatus(cleaner.id)}>Check</Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => router.push(`/admin/directory?cleaner=${cleaner.id}`)}><RiEyeLine className="w-3 h-3" /></Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {filteredCleaners.length === 0 && (
                <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">No cleaners found</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={!!editCleaner} onOpenChange={(open) => !open && setEditCleaner(null)}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit Cleaner</DialogTitle>
            <DialogDescription>{editCleaner?.first_name} {editCleaner?.last_name}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2"><Label>First Name</Label><Input value={editForm.firstName} onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })} /></div>
              <div className="grid gap-2"><Label>Last Name</Label><Input value={editForm.lastName} onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })} /></div>
            </div>
            <div className="grid gap-2"><Label>Phone</Label><Input value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2"><Label>State</Label>
                <Select value={editForm.state} onValueChange={(v) => setEditForm({ ...editForm, state: v })}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{US_STATES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid gap-2"><Label>Home ZIP</Label><Input maxLength={5} value={editForm.homeZip} onChange={(e) => setEditForm({ ...editForm, homeZip: e.target.value })} /></div>
            </div>
            <div className="grid gap-2"><Label>Service ZIP Codes</Label><Input value={editForm.serviceZipCodes} onChange={(e) => setEditForm({ ...editForm, serviceZipCodes: e.target.value })} /><p className="text-xs text-muted-foreground">Comma-separated</p></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2"><Label>Pay Rate ($/hr)</Label><Input type="number" value={editForm.payRateHr} onChange={(e) => setEditForm({ ...editForm, payRateHr: e.target.value })} /></div>
              <div className="grid gap-2"><Label>Max Travel (mi)</Label><Input type="number" value={editForm.maxTravelMiles} onChange={(e) => setEditForm({ ...editForm, maxTravelMiles: e.target.value })} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditCleaner(null)}>Cancel</Button>
            <Button onClick={handleSaveEdit}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
