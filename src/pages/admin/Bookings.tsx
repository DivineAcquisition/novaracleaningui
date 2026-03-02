import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/admin/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";
import { Search, X, ExternalLink, Save } from "lucide-react";
import { CancelBookingDialog } from "@/components/admin/CancelBookingDialog";
import { SEO } from "@/components/SEO";

type Booking = {
  id: string;
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
  arrival_window: string | null;
  service_type: string;
  home_size_id: string;
  add_ons: string[] | null;
  frequency: string | null;
  status: string | null;
  payment_method: string | null;
  payment_option: string | null;
  base_price_cents: number;
  deposit_cents: number;
  total_estimate_cents: number;
  final_charge_cents: number | null;
  hosted_invoice_url: string | null;
  cleaner_id: string | null;
  access_notes: string | null;
  team_notes: string | null;
  dispatch_notes: string | null;
  cancel_reason: string | null;
  check_in_time: string | null;
  check_out_time: string | null;
  before_photos: string[] | null;
  after_photos: string[] | null;
  created_at: string | null;
  booking_number: number | null;
  sqft: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
};

const STATUSES = ["all", "pending_payment", "confirmed", "assigned", "completed", "cancelled"];

const statusColor = (status: string) => {
  const map: Record<string, string> = {
    confirmed: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    completed: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    cancelled: "bg-red-500/20 text-red-400 border-red-500/30",
    pending_payment: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    assigned: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  };
  return map[status] || "bg-slate-500/20 text-slate-400 border-slate-500/30";
};

export default function AdminBookings() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState<Booking | null>(null);
  const [editNotes, setEditNotes] = useState({ team_notes: "", dispatch_notes: "", access_notes: "" });
  const [editStatus, setEditStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  useEffect(() => {
    fetchBookings();
  }, []);

  const fetchBookings = async () => {
    const { data, error } = await supabase
      .from("bookings")
      .select("*")
      .order("service_date", { ascending: false })
      .limit(500);

    if (error) {
      toast.error("Failed to load bookings");
      console.error(error);
    }
    setBookings((data as Booking[]) || []);
    setLoading(false);
  };

  const filtered = useMemo(() => {
    let list = bookings;
    if (statusFilter !== "all") {
      list = list.filter((b) => b.status === statusFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (b) =>
          b.first_name.toLowerCase().includes(q) ||
          b.last_name.toLowerCase().includes(q) ||
          b.email.toLowerCase().includes(q) ||
          b.address.toLowerCase().includes(q) ||
          b.phone.includes(q)
      );
    }
    return list;
  }, [bookings, statusFilter, search]);

  const openDetail = (b: Booking) => {
    setSelected(b);
    setEditNotes({
      team_notes: b.team_notes || "",
      dispatch_notes: b.dispatch_notes || "",
      access_notes: b.access_notes || "",
    });
    setEditStatus(b.status || "pending_payment");
  };

  const saveChanges = async () => {
    if (!selected) return;
    setSaving(true);
    const { error } = await supabase
      .from("bookings")
      .update({
        status: editStatus,
        team_notes: editNotes.team_notes,
        dispatch_notes: editNotes.dispatch_notes,
        access_notes: editNotes.access_notes,
      })
      .eq("id", selected.id);

    if (error) {
      toast.error("Failed to save changes");
    } else {
      toast.success("Booking updated");
      setBookings((prev) =>
        prev.map((b) =>
          b.id === selected.id
            ? { ...b, status: editStatus, ...editNotes }
            : b
        )
      );
      setSelected((prev) => prev ? { ...prev, status: editStatus, ...editNotes } : null);
    }
    setSaving(false);
  };

  const handleCancelled = () => {
    if (!selected) return;
    setBookings((prev) => prev.map((b) => (b.id === selected.id ? { ...b, status: "cancelled" } : b)));
    setSelected((prev) => prev ? { ...prev, status: "cancelled" } : null);
    setEditStatus("cancelled");
    setCancelOpen(false);
  };

  return (
    <AdminLayout>
      <SEO title="Manage Bookings" noindex />
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-white">Bookings</h1>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
            <Input
              placeholder="Search name, email, phone, address…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 bg-slate-800/50 border-white/10 text-white placeholder:text-slate-500"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-48 bg-slate-800/50 border-white/10 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s === "all" ? "All Statuses" : s.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <Card className="bg-slate-800/50 border-white/10">
          <CardContent className="p-0">
            {loading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full bg-slate-700" />
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-slate-500 border-b border-white/10">
                      <th className="text-left py-3 px-4 font-medium">#</th>
                      <th className="text-left py-3 px-4 font-medium">Date</th>
                      <th className="text-left py-3 px-4 font-medium">Customer</th>
                      <th className="text-left py-3 px-4 font-medium hidden md:table-cell">Address</th>
                      <th className="text-left py-3 px-4 font-medium">Service</th>
                      <th className="text-left py-3 px-4 font-medium">Status</th>
                      <th className="text-right py-3 px-4 font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center py-8 text-slate-500">
                          No bookings found
                        </td>
                      </tr>
                    ) : (
                      filtered.map((b) => (
                        <tr
                          key={b.id}
                          className="border-b border-white/5 hover:bg-white/5 cursor-pointer transition-colors"
                          onClick={() => openDetail(b)}
                        >
                          <td className="py-3 px-4 text-slate-400">{b.booking_number || "—"}</td>
                          <td className="py-3 px-4 text-white">{b.service_date}</td>
                          <td className="py-3 px-4 text-white">
                            {b.first_name} {b.last_name}
                          </td>
                          <td className="py-3 px-4 text-slate-400 hidden md:table-cell truncate max-w-[200px]">
                            {b.address}, {b.city}
                          </td>
                          <td className="py-3 px-4 text-slate-400">{b.service_type}</td>
                          <td className="py-3 px-4">
                            <Badge variant="outline" className={statusColor(b.status || "")}>
                              {(b.status || "").replace(/_/g, " ")}
                            </Badge>
                          </td>
                          <td className="py-3 px-4 text-right text-white">
                            ${((b.total_estimate_cents || 0) / 100).toFixed(2)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Detail Sheet */}
        <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
          <SheetContent className="bg-slate-900 border-white/10 text-white w-full sm:max-w-lg overflow-y-auto">
            {selected && (
              <>
                <SheetHeader>
                  <SheetTitle className="text-white">
                    Booking #{selected.booking_number || "—"}
                  </SheetTitle>
                </SheetHeader>

                <div className="mt-6 space-y-6">
                  {/* Customer Info */}
                  <section>
                    <h3 className="text-xs font-semibold uppercase text-slate-500 mb-2">Customer</h3>
                    <div className="space-y-1 text-sm">
                      <p>{selected.first_name} {selected.last_name}</p>
                      <p className="text-slate-400">{selected.email}</p>
                      <p className="text-slate-400">{selected.phone}</p>
                    </div>
                  </section>

                  {/* Service Details */}
                  <section>
                    <h3 className="text-xs font-semibold uppercase text-slate-500 mb-2">Service</h3>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div><span className="text-slate-500">Type:</span> {selected.service_type}</div>
                      <div><span className="text-slate-500">Home:</span> {selected.home_size_id}</div>
                      <div><span className="text-slate-500">Sqft:</span> {selected.sqft || "—"}</div>
                      <div><span className="text-slate-500">Bed/Bath:</span> {selected.bedrooms || "—"}/{selected.bathrooms || "—"}</div>
                      <div><span className="text-slate-500">Frequency:</span> {selected.frequency || "One-Time"}</div>
                      <div><span className="text-slate-500">Add-ons:</span> {(selected.add_ons || []).join(", ") || "None"}</div>
                    </div>
                  </section>

                  {/* Schedule */}
                  <section>
                    <h3 className="text-xs font-semibold uppercase text-slate-500 mb-2">Schedule</h3>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div><span className="text-slate-500">Date:</span> {selected.service_date}</div>
                      <div><span className="text-slate-500">Slot:</span> {selected.time_slot}</div>
                      <div className="col-span-2"><span className="text-slate-500">Arrival:</span> {selected.arrival_window || "—"}</div>
                      <div className="col-span-2"><span className="text-slate-500">Address:</span> {selected.address}, {selected.city}, {selected.state} {selected.zip_code}</div>
                    </div>
                  </section>

                  {/* Status */}
                  <section>
                    <h3 className="text-xs font-semibold uppercase text-slate-500 mb-2">Status</h3>
                    <Select value={editStatus} onValueChange={setEditStatus}>
                      <SelectTrigger className="bg-slate-800/50 border-white/10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUSES.filter((s) => s !== "all").map((s) => (
                          <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </section>

                  {/* Payment */}
                  <section>
                    <h3 className="text-xs font-semibold uppercase text-slate-500 mb-2">Payment</h3>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div><span className="text-slate-500">Method:</span> {selected.payment_method || "Card"}</div>
                      <div><span className="text-slate-500">Option:</span> {selected.payment_option || "deposit"}</div>
                      <div><span className="text-slate-500">Base:</span> ${(selected.base_price_cents / 100).toFixed(2)}</div>
                      <div><span className="text-slate-500">Deposit:</span> ${(selected.deposit_cents / 100).toFixed(2)}</div>
                      <div><span className="text-slate-500">Total:</span> ${(selected.total_estimate_cents / 100).toFixed(2)}</div>
                      <div><span className="text-slate-500">Final:</span> {selected.final_charge_cents != null ? `$${(selected.final_charge_cents / 100).toFixed(2)}` : "—"}</div>
                    </div>
                    {selected.hosted_invoice_url && (
                      <a
                        href={selected.hosted_invoice_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 mt-2 text-xs text-amber-400 hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" /> View Invoice
                      </a>
                    )}
                  </section>

                  {/* Check-in/out */}
                  {(selected.check_in_time || selected.check_out_time) && (
                    <section>
                      <h3 className="text-xs font-semibold uppercase text-slate-500 mb-2">Check In / Out</h3>
                      <div className="text-sm space-y-1">
                        <p><span className="text-slate-500">In:</span> {selected.check_in_time || "—"}</p>
                        <p><span className="text-slate-500">Out:</span> {selected.check_out_time || "—"}</p>
                      </div>
                    </section>
                  )}

                  {/* Notes */}
                  <section className="space-y-3">
                    <h3 className="text-xs font-semibold uppercase text-slate-500">Notes</h3>
                    <div>
                      <Label className="text-xs text-slate-400">Access Notes</Label>
                      <Textarea
                        value={editNotes.access_notes}
                        onChange={(e) => setEditNotes((n) => ({ ...n, access_notes: e.target.value }))}
                        className="mt-1 bg-slate-800/50 border-white/10 text-white text-sm"
                        rows={2}
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-slate-400">Team Notes</Label>
                      <Textarea
                        value={editNotes.team_notes}
                        onChange={(e) => setEditNotes((n) => ({ ...n, team_notes: e.target.value }))}
                        className="mt-1 bg-slate-800/50 border-white/10 text-white text-sm"
                        rows={2}
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-slate-400">Dispatch Notes</Label>
                      <Textarea
                        value={editNotes.dispatch_notes}
                        onChange={(e) => setEditNotes((n) => ({ ...n, dispatch_notes: e.target.value }))}
                        className="mt-1 bg-slate-800/50 border-white/10 text-white text-sm"
                        rows={2}
                      />
                    </div>
                  </section>

                  {/* Actions */}
                  <div className="flex gap-3 pt-2">
                    <Button
                      onClick={saveChanges}
                      disabled={saving}
                      className="flex-1 bg-amber-500 hover:bg-amber-600 text-white"
                    >
                      <Save className="h-4 w-4 mr-2" />
                      {saving ? "Saving…" : "Save Changes"}
                    </Button>
                    {selected.status !== "cancelled" && (
                      <Button
                        variant="destructive"
                        onClick={() => setCancelOpen(true)}
                        className="flex-shrink-0"
                      >
                        Cancel Booking
                      </Button>
                    )}
                  </div>
                </div>

                <CancelBookingDialog
                  bookingId={selected.id}
                  bookingNumber={selected.booking_number || 0}
                  open={cancelOpen}
                  onOpenChange={setCancelOpen}
                  onSuccess={handleCancelled}
                />
              </>
            )}
          </SheetContent>
        </Sheet>
      </div>
    </AdminLayout>
  );
}
