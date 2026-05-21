"use client";

import {
  RiArrowDownSLine,
  RiArrowUpSLine,
  RiSearchLine,
  RiGift2Line,
  RiMoneyDollarCircleLine,
  RiCloseCircleLine,
  RiRefund2Line,
} from "@remixicon/react";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/admin/AdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

import { SEO } from "@/components/SEO";

interface Customer {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  zip: string | null;
  referral_code: string | null;
  created_at: string;
}

interface CustomerBooking {
  id: string;
  booking_number?: number | null;
  service_date: string;
  service_type: string;
  status: string | null;
  total_estimate_cents: number;
  applied_credit_cents?: number | null;
  payment_intent_id?: string | null;
}

interface MembershipCredit {
  membership_plan: string;
  credits_remaining: number;
  credits_per_month: number;
  current_period_end: string;
}

interface WalletCreditRow {
  id: string;
  amount_cents: number;
  source: string;
  status: string;
  reason: string | null;
  created_at: string;
  applied_at: string | null;
  expires_at: string | null;
}

interface CreditBalance {
  balance_cents: number;
  lifetime_granted_cents: number;
  lifetime_applied_cents: number;
  open_count: number;
}

export default function AdminCustomers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedBookings, setExpandedBookings] = useState<CustomerBooking[]>([]);
  const [expandedCredits, setExpandedCredits] = useState<MembershipCredit[]>([]);
  const [expandedWallet, setExpandedWallet] = useState<WalletCreditRow[]>([]);
  const [expandedBalance, setExpandedBalance] = useState<CreditBalance | null>(null);
  const [expandLoading, setExpandLoading] = useState(false);
  const [grantDialogFor, setGrantDialogFor] = useState<Customer | null>(null);
  const [grantForm, setGrantForm] = useState({ amountDollars: "50", source: "admin_grant", reason: "" });
  const [grantBusy, setGrantBusy] = useState(false);
  const [busyBookingId, setBusyBookingId] = useState<string | null>(null);

  // Booking counts per customer email
  const [bookingCounts, setBookingCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    fetchCustomers();
  }, []);

  const fetchCustomers = async () => {
    const { data, error } = await supabase
      .from("customers")
      .select("id, first_name, last_name, email, phone, zip, referral_code, created_at")
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) console.error(error);
    setCustomers(data || []);

    // Fetch booking counts grouped by email
    const { data: bookings } = await supabase
      .from("bookings")
      .select("email");

    const counts: Record<string, number> = {};
    (bookings || []).forEach((b: { email: string }) => {
      counts[b.email] = (counts[b.email] || 0) + 1;
    });
    setBookingCounts(counts);

    setLoading(false);
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return customers;
    const q = search.toLowerCase();
    return customers.filter(
      (c) =>
        c.first_name.toLowerCase().includes(q) ||
        c.last_name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        (c.phone || "").includes(q) ||
        (c.zip || "").includes(q)
    );
  }, [customers, search]);

  const toggleExpand = async (customer: Customer) => {
    if (expandedId === customer.id) {
      setExpandedId(null);
      return;
    }

    setExpandedId(customer.id);
    setExpandLoading(true);

    const [{ data: bData }, { data: mData }, { data: wData }, { data: balData }] = await Promise.all([
      (supabase.from as any)("bookings")
        .select("id, booking_number, service_date, service_type, status, total_estimate_cents, applied_credit_cents, payment_intent_id")
        .eq("email", customer.email)
        .order("service_date", { ascending: false })
        .limit(20),
      supabase
        .from("membership_credits")
        .select("membership_plan, credits_remaining, credits_per_month, current_period_end")
        .eq("email", customer.email)
        .limit(5),
      (supabase.from as any)("customer_credits")
        .select("id, amount_cents, source, status, reason, created_at, applied_at, expires_at")
        .eq("customer_id", customer.id)
        .order("created_at", { ascending: false })
        .limit(50),
      (supabase.rpc as any)("get_customer_credit_balance", { _customer_id: customer.id }),
    ]);

    setExpandedBookings((bData as unknown as CustomerBooking[]) || []);
    setExpandedCredits((mData as unknown as MembershipCredit[]) || []);
    setExpandedWallet((wData as unknown as WalletCreditRow[]) || []);
    setExpandedBalance((balData as unknown as CreditBalance) || null);
    setExpandLoading(false);
  };

  const refreshExpanded = async (customer: Customer) => {
    const [{ data: wData }, { data: balData }] = await Promise.all([
      (supabase.from as any)("customer_credits")
        .select("id, amount_cents, source, status, reason, created_at, applied_at, expires_at")
        .eq("customer_id", customer.id)
        .order("created_at", { ascending: false })
        .limit(50),
      (supabase.rpc as any)("get_customer_credit_balance", { _customer_id: customer.id }),
    ]);
    setExpandedWallet((wData as unknown as WalletCreditRow[]) || []);
    setExpandedBalance((balData as unknown as CreditBalance) || null);
  };

  const handleGrant = async () => {
    if (!grantDialogFor) return;
    const dollars = Number(grantForm.amountDollars);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      toast.error("Amount must be > 0");
      return;
    }
    setGrantBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-grant-credit", {
        body: {
          action: "grant",
          customerId: grantDialogFor.id,
          amountCents: Math.round(dollars * 100),
          source: grantForm.source,
          reason: grantForm.reason || null,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(`Granted $${dollars.toFixed(2)} to ${grantDialogFor.first_name}`);
      setGrantDialogFor(null);
      setGrantForm({ amountDollars: "50", source: "admin_grant", reason: "" });
      await refreshExpanded(grantDialogFor);
    } catch (e) {
      toast.error(`Grant failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGrantBusy(false);
    }
  };

  const handleRefund = async (booking: CustomerBooking, customer: Customer) => {
    if (!confirm(`Issue a full refund + cancel for booking ${booking.booking_number || booking.id.slice(0, 8)}?`)) return;
    setBusyBookingId(booking.id);
    try {
      const { data, error } = await supabase.functions.invoke("admin-refund-booking", {
        body: { bookingId: booking.id, reason: "admin_refund", markCancelled: true },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Refunded + cancelled");
      await toggleExpand(customer);
    } catch (e) {
      toast.error(`Refund failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyBookingId(null);
    }
  };

  const handleCancel = async (booking: CustomerBooking, customer: Customer) => {
    if (!confirm(`Cancel booking ${booking.booking_number || booking.id.slice(0, 8)} (NO refund)?`)) return;
    setBusyBookingId(booking.id);
    try {
      const { data, error } = await supabase.functions.invoke("cancel-booking", {
        body: { bookingId: booking.id, cancelReason: "admin_cancellation", refundType: "none", source: "admin" },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Cancelled");
      await toggleExpand(customer);
    } catch (e) {
      toast.error(`Cancel failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyBookingId(null);
    }
  };

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

  return (
    <AdminLayout>
      <SEO title="Customer Management" noindex />
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-white">Customers</h1>

        <div className="relative max-w-md">
          <RiSearchLine className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <Input
            placeholder="Search name, email, phone, ZIP…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 bg-slate-800/50 border-white/10 text-white placeholder:text-slate-500"
          />
        </div>

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
                      <th className="text-left py-3 px-4 font-medium">Name</th>
                      <th className="text-left py-3 px-4 font-medium">Email</th>
                      <th className="text-left py-3 px-4 font-medium hidden md:table-cell">Phone</th>
                      <th className="text-left py-3 px-4 font-medium hidden md:table-cell">ZIP</th>
                      <th className="text-center py-3 px-4 font-medium">Bookings</th>
                      <th className="text-left py-3 px-4 font-medium hidden lg:table-cell">Referral</th>
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center py-8 text-slate-500">
                          No customers found
                        </td>
                      </tr>
                    ) : (
                      filtered.map((c) => (
                        <>
                          <tr
                            key={c.id}
                            className="border-b border-white/5 hover:bg-white/5 cursor-pointer transition-colors"
                            onClick={() => toggleExpand(c)}
                          >
                            <td className="py-3 px-4 text-white">{c.first_name} {c.last_name}</td>
                            <td className="py-3 px-4 text-slate-400">{c.email}</td>
                            <td className="py-3 px-4 text-slate-400 hidden md:table-cell">{c.phone || "—"}</td>
                            <td className="py-3 px-4 text-slate-400 hidden md:table-cell">{c.zip || "—"}</td>
                            <td className="py-3 px-4 text-center text-white">{bookingCounts[c.email] || 0}</td>
                            <td className="py-3 px-4 text-slate-400 hidden lg:table-cell">{c.referral_code || "—"}</td>
                            <td className="py-3 px-4">
                              {expandedId === c.id ? (
                                <RiArrowUpSLine className="h-4 w-4 text-slate-500" />
                              ) : (
                                <RiArrowDownSLine className="h-4 w-4 text-slate-500" />
                              )}
                            </td>
                          </tr>
                          {expandedId === c.id && (
                            <tr key={`${c.id}-expand`}>
                              <td colSpan={7} className="bg-slate-900/50 px-6 py-4">
                                {expandLoading ? (
                                  <div className="space-y-2">
                                    <Skeleton className="h-6 w-48 bg-slate-700" />
                                    <Skeleton className="h-6 w-64 bg-slate-700" />
                                  </div>
                                ) : (
                                  <div className="space-y-6">
                                    {/* Wallet Credits + Grant action */}
                                    <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-4">
                                      <div className="flex items-center justify-between mb-3">
                                        <div>
                                          <h4 className="text-xs font-semibold uppercase text-emerald-400 flex items-center gap-2">
                                            <RiMoneyDollarCircleLine className="w-4 h-4" />
                                            Wallet Credits
                                          </h4>
                                          <p className="text-2xl font-bold text-emerald-400 mt-1">
                                            ${((expandedBalance?.balance_cents || 0) / 100).toFixed(2)}
                                          </p>
                                          <p className="text-xs text-slate-500">
                                            Lifetime granted: ${((expandedBalance?.lifetime_granted_cents || 0) / 100).toFixed(2)} •
                                            Applied: ${((expandedBalance?.lifetime_applied_cents || 0) / 100).toFixed(2)}
                                          </p>
                                        </div>
                                        <Button
                                          size="sm"
                                          className="bg-emerald-500 text-slate-950 hover:bg-emerald-400"
                                          onClick={() => setGrantDialogFor(c)}
                                        >
                                          <RiGift2Line className="w-4 h-4 mr-1" />
                                          Grant Credit
                                        </Button>
                                      </div>
                                      {expandedWallet.length > 0 && (
                                        <div className="max-h-40 overflow-y-auto space-y-1">
                                          {expandedWallet.slice(0, 8).map((w) => (
                                            <div key={w.id} className="flex items-center justify-between text-xs bg-slate-900/50 rounded px-3 py-2">
                                              <div className="flex-1">
                                                <span className={w.amount_cents > 0 ? "text-emerald-400" : "text-red-400"}>
                                                  {w.amount_cents > 0 ? "+" : ""}${(w.amount_cents / 100).toFixed(2)}
                                                </span>
                                                <span className="text-slate-500 ml-2">{w.source}</span>
                                                {w.reason && <span className="text-slate-600 ml-2">— {w.reason}</span>}
                                              </div>
                                              <Badge variant="outline" className="text-[10px]">
                                                {w.status}
                                              </Badge>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>

                                    <div className="grid md:grid-cols-2 gap-6">
                                      {/* Booking History with admin actions */}
                                      <div>
                                        <h4 className="text-xs font-semibold uppercase text-slate-500 mb-2">
                                          Booking History ({expandedBookings.length})
                                        </h4>
                                        {expandedBookings.length === 0 ? (
                                          <p className="text-sm text-slate-500">No bookings</p>
                                        ) : (
                                          <div className="space-y-2">
                                            {expandedBookings.map((b) => (
                                              <div key={b.id} className="text-sm bg-slate-800/50 rounded px-3 py-2 space-y-2">
                                                <div className="flex items-center justify-between">
                                                  <div>
                                                    <span className="text-white">{b.service_date}</span>
                                                    <span className="text-slate-500 ml-2">{b.service_type}</span>
                                                  </div>
                                                  <div className="flex items-center gap-2">
                                                    <Badge variant="outline" className={statusColor(b.status || "")}>
                                                      {(b.status || "").replace(/_/g, " ")}
                                                    </Badge>
                                                    <span className="text-white">${((b.total_estimate_cents || 0) / 100).toFixed(2)}</span>
                                                  </div>
                                                </div>
                                                {(b.applied_credit_cents || 0) > 0 && (
                                                  <p className="text-xs text-emerald-400">
                                                    Credit applied: ${((b.applied_credit_cents || 0) / 100).toFixed(2)}
                                                  </p>
                                                )}
                                                {b.status !== "cancelled" && b.status !== "completed" && (
                                                  <div className="flex items-center gap-2 pt-1">
                                                    {b.payment_intent_id && (
                                                      <Button
                                                        variant="ghost" size="sm"
                                                        className="h-7 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                                        disabled={busyBookingId === b.id}
                                                        onClick={(e) => { e.stopPropagation(); handleRefund(b, c); }}
                                                      >
                                                        <RiRefund2Line className="w-3 h-3 mr-1" /> Refund + Cancel
                                                      </Button>
                                                    )}
                                                    <Button
                                                      variant="ghost" size="sm"
                                                      className="h-7 text-xs text-slate-400 hover:text-white hover:bg-white/5"
                                                      disabled={busyBookingId === b.id}
                                                      onClick={(e) => { e.stopPropagation(); handleCancel(b, c); }}
                                                    >
                                                      <RiCloseCircleLine className="w-3 h-3 mr-1" /> Cancel (no refund)
                                                    </Button>
                                                  </div>
                                                )}
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>

                                      {/* Membership */}
                                      <div>
                                        <h4 className="text-xs font-semibold uppercase text-slate-500 mb-2">
                                          Membership Credits
                                        </h4>
                                        {expandedCredits.length === 0 ? (
                                          <p className="text-sm text-slate-500">No membership</p>
                                        ) : (
                                          <div className="space-y-2">
                                            {expandedCredits.map((m, i) => (
                                              <div key={i} className="text-sm bg-slate-800/50 rounded px-3 py-2 space-y-1">
                                                <div className="flex justify-between">
                                                  <span className="text-amber-400 font-medium">{m.membership_plan}</span>
                                                  <span className="text-white">{m.credits_remaining}/{m.credits_per_month} credits</span>
                                                </div>
                                                <p className="text-slate-500 text-xs">
                                                  Renews: {new Date(m.current_period_end).toLocaleDateString()}
                                                </p>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Grant Credit Dialog */}
        <Dialog open={grantDialogFor !== null} onOpenChange={(v) => { if (!v) setGrantDialogFor(null); }}>
          <DialogContent className="bg-slate-900 border-white/10 text-white max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <RiGift2Line className="w-5 h-5 text-emerald-400" />
                Grant credit to {grantDialogFor?.first_name} {grantDialogFor?.last_name}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div>
                <Label className="text-xs text-slate-400">Amount (USD)</Label>
                <Input
                  type="number" min="1" step="0.01"
                  value={grantForm.amountDollars}
                  onChange={(e) => setGrantForm({ ...grantForm, amountDollars: e.target.value })}
                  className="bg-slate-800 border-white/10 text-white"
                />
              </div>
              <div>
                <Label className="text-xs text-slate-400">Source</Label>
                <Select value={grantForm.source} onValueChange={(v) => setGrantForm({ ...grantForm, source: v })}>
                  <SelectTrigger className="bg-slate-800 border-white/10 text-white"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin_grant">Admin grant</SelectItem>
                    <SelectItem value="perk">Special perk</SelectItem>
                    <SelectItem value="refund_credit">Refund as credit</SelectItem>
                    <SelectItem value="promo">Promo</SelectItem>
                    <SelectItem value="adjustment">Adjustment</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-slate-400">Reason / note</Label>
                <Input
                  value={grantForm.reason}
                  onChange={(e) => setGrantForm({ ...grantForm, reason: e.target.value })}
                  placeholder="Goodwill, complaint resolution, NPS reward..."
                  className="bg-slate-800 border-white/10 text-white"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setGrantDialogFor(null)} disabled={grantBusy}>Cancel</Button>
              <Button onClick={handleGrant} disabled={grantBusy} className="bg-emerald-500 text-slate-950 hover:bg-emerald-400">
                {grantBusy ? "Granting..." : "Grant Credit"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
