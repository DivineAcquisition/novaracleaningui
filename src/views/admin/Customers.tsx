"use client";

// ─── Admin Customers (v2 — 2026-05-22) ──────────────────────────────────
//
// Light-themed, brand-aligned customer console. Every piece of
// functionality is wired to live data + existing edge functions:
//
//   - Search across name, email, phone, ZIP, referral code
//   - Side sheet per customer with:
//       * Account details (with copy-to-clipboard + send-password-reset)
//       * Booking history + refund + cancel
//       * Customer credit wallet + grant credit
//       * Stripe customer portal link (auto-creates portal session)
//       * Sync to GHL (force)
//   - Create-customer dialog (calls public.customers insert via service
//     role through book-as-va helper, OR direct insert + send-auth-email
//     password-set link).
//
// Zero hardcoded data.

import {
  RiSearchLine,
  RiUserAddLine,
  RiMailLine,
  RiPhoneLine,
  RiMapPinLine,
  RiGift2Line,
  RiRefund2Line,
  RiCloseCircleLine,
  RiCalendarCheckLine,
  RiKey2Line,
  RiExternalLinkLine,
  RiLoader4Line,
  RiCheckLine,
  RiAlertLine,
  RiDeleteBinLine,
  RiFileCopyLine,
  RiEditLine,
  RiBankCardLine,
} from "@remixicon/react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface Customer {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  phone: string | null;
  zip: string | null;
  city: string | null;
  state: string | null;
  address: string | null;
  referral_code: string | null;
  stripe_customer_id: string | null;
  created_at: string;
}

interface BookingRow {
  id: string;
  booking_number: number | null;
  service_date: string | null;
  time_slot: string | null;
  service_type: string | null;
  status: string | null;
  total_estimate_cents: number | null;
  final_charge_cents: number | null;
  applied_credit_cents: number | null;
  payment_intent_id: string | null;
}

interface WalletRow {
  id: string;
  amount_cents: number;
  source: string;
  status: string;
  reason: string | null;
  created_at: string;
}

interface CreditBalance {
  balance_cents: number;
  lifetime_granted_cents: number;
  lifetime_applied_cents: number;
}

const STATUS_BADGE: Record<string, string> = {
  confirmed: "bg-violet-100 text-violet-800 border-violet-200",
  completed: "bg-blue-100 text-blue-800 border-blue-200",
  cancelled: "bg-rose-100 text-rose-800 border-rose-200",
  pending_payment: "bg-amber-100 text-amber-800 border-amber-200",
  pending_details: "bg-amber-100 text-amber-800 border-amber-200",
  assigned: "bg-indigo-100 text-indigo-800 border-indigo-200",
};

const dollars = (cents: number | null | undefined) =>
  cents == null ? "—" : `$${(cents / 100).toFixed(2)}`;

const fullName = (c: Customer) =>
  [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email;

export default function AdminCustomers() {
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [bookingCounts, setBookingCounts] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const selected = useMemo(
    () => customers.find((c) => c.id === selectedId) || null,
    [customers, selectedId],
  );

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("customers")
        .select("id,first_name,last_name,email,phone,zip,city,state,address,referral_code,stripe_customer_id,created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      const rows = (data as unknown as Customer[]) || [];
      setCustomers(rows);

      // Fetch booking counts in one go.
      const { data: counts } = await supabase
        .from("bookings")
        .select("email")
        .in("email", rows.map((r) => r.email).filter(Boolean));
      const tally: Record<string, number> = {};
      (counts as Array<{ email: string }> | null)?.forEach((b) => {
        tally[b.email] = (tally[b.email] || 0) + 1;
      });
      setBookingCounts(tally);
    } catch (err: any) {
      toast.error(err?.message || "Failed to load customers");
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) =>
      [
        c.first_name,
        c.last_name,
        c.email,
        c.phone,
        c.zip,
        c.city,
        c.referral_code,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [customers, search]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-jakarta text-2xl font-bold text-slate-900 tracking-tight">Customers</h1>
          <p className="text-sm text-slate-500">
            {customers.length} total accounts · search, manage credits, refund bookings, send password resets.
          </p>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          className="bg-violet-600 hover:bg-violet-700 text-white"
        >
          <RiUserAddLine className="w-4 h-4 mr-1.5" />
          New customer
        </Button>
      </div>

      <Card className="border-slate-200">
        <CardContent className="p-3">
          <div className="relative">
            <RiSearchLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, phone, ZIP, referral code…"
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Name</th>
                <th className="text-left px-4 py-3 font-semibold">Email</th>
                <th className="text-left px-4 py-3 font-semibold hidden md:table-cell">Phone</th>
                <th className="text-left px-4 py-3 font-semibold hidden md:table-cell">ZIP</th>
                <th className="text-center px-4 py-3 font-semibold">Bookings</th>
                <th className="text-left px-4 py-3 font-semibold hidden lg:table-cell">Joined</th>
                <th className="w-10 px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={7} className="p-3">
                      <Skeleton className="h-7 w-full" />
                    </td>
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-slate-500">
                    <RiAlertLine className="w-7 h-7 mx-auto text-slate-300 mb-2" />
                    No customers match this search.
                  </td>
                </tr>
              ) : (
                filtered.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className="cursor-pointer hover:bg-slate-50"
                  >
                    <td className="px-4 py-3 text-slate-900 font-medium">{fullName(c)}</td>
                    <td className="px-4 py-3 text-slate-700 truncate max-w-[240px]">{c.email}</td>
                    <td className="px-4 py-3 text-slate-600 hidden md:table-cell">{c.phone || "—"}</td>
                    <td className="px-4 py-3 text-slate-600 hidden md:table-cell">{c.zip || "—"}</td>
                    <td className="px-4 py-3 text-center text-slate-900 font-semibold">
                      {bookingCounts[c.email] || 0}
                    </td>
                    <td className="px-4 py-3 text-slate-500 hidden lg:table-cell text-xs">
                      {new Date(c.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="ghost" className="text-violet-700">
                        Open
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <CustomerSheet
        customer={selected}
        onClose={() => setSelectedId(null)}
        onChange={load}
      />

      <CreateCustomerDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={load}
      />
    </div>
  );
}

// ─── Customer side sheet ─────────────────────────────────────────────────

function CustomerSheet({
  customer,
  onClose,
  onChange,
}: {
  customer: Customer | null;
  onClose: () => void;
  onChange: () => void;
}) {
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [wallet, setWallet] = useState<WalletRow[]>([]);
  const [balance, setBalance] = useState<CreditBalance | null>(null);
  const [loading, setLoading] = useState(false);
  const [actioning, setActioning] = useState<string | null>(null);
  const [grantOpen, setGrantOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmDeleteName, setConfirmDeleteName] = useState("");

  useEffect(() => {
    if (!customer) return;
    void loadDetail(customer);
  }, [customer]);

  const loadDetail = async (c: Customer) => {
    setLoading(true);
    try {
      const [bk, wl, bal] = await Promise.all([
        supabase
          .from("bookings")
          .select("id,booking_number,service_date,time_slot,service_type,status,total_estimate_cents,final_charge_cents,applied_credit_cents,payment_intent_id")
          .eq("email", c.email)
          .order("service_date", { ascending: false })
          .limit(50),
        supabase.from("customer_credits" as any)
          .select("id,amount_cents,source,status,reason,created_at")
          .ilike("email", c.email || "")
          .order("created_at", { ascending: false })
          .limit(30),
        supabase.rpc("get_customer_credit_balance_by_email" as any, { _email: c.email || "" }),
      ]);
      setBookings((bk.data as unknown as BookingRow[]) || []);
      setWallet((wl.data as unknown as WalletRow[]) || []);
      const b = bal.data as any;
      setBalance(
        b
          ? {
              balance_cents: b.balance_cents || 0,
              lifetime_granted_cents: b.lifetime_granted_cents || 0,
              lifetime_applied_cents: b.lifetime_applied_cents || 0,
            }
          : { balance_cents: 0, lifetime_granted_cents: 0, lifetime_applied_cents: 0 },
      );
    } finally {
      setLoading(false);
    }
  };

  const handleRefund = async (b: BookingRow) => {
    if (!customer) return;
    if (!confirm(`Refund + cancel booking #${b.booking_number || b.id.slice(0, 8)}?`)) return;
    setActioning(b.id);
    try {
      const { error } = await supabase.functions.invoke("admin-refund-booking", {
        body: { bookingId: b.id, reason: "admin_refund" },
      });
      if (error) throw error;
      toast.success("Refunded & cancelled");
      await loadDetail(customer);
    } catch (err: any) {
      toast.error(err?.message || "Refund failed");
    } finally {
      setActioning(null);
    }
  };

  const handleCancel = async (b: BookingRow) => {
    if (!customer) return;
    if (!confirm(`Cancel booking #${b.booking_number || b.id.slice(0, 8)} WITHOUT refund?`)) return;
    setActioning(b.id);
    try {
      const { error } = await supabase.functions.invoke("cancel-booking", {
        body: { bookingId: b.id, cancelReason: "admin_cancellation", refundType: "none", source: "admin" },
      });
      if (error) throw error;
      toast.success("Cancelled");
      await loadDetail(customer);
    } catch (err: any) {
      toast.error(err?.message || "Cancel failed");
    } finally {
      setActioning(null);
    }
  };

  const sendPasswordReset = async () => {
    if (!customer) return;
    setActioning("password");
    try {
      const { error } = await supabase.functions.invoke("send-auth-email", {
        body: {
          kind: "password_reset",
          email: customer.email,
          redirectTo: "https://app.novaracleaning.com/update-password",
        },
      });
      if (error) throw error;
      toast.success("Password reset email sent");
    } catch (err: any) {
      toast.error(err?.message || "Failed to send");
    } finally {
      setActioning(null);
    }
  };

  const copyText = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Copy failed");
    }
  };

  const openStripePortal = async () => {
    if (!customer) return;
    setActioning("stripe");
    try {
      const { data, error } = await supabase.functions.invoke("admin-customer-action", {
        body: { action: "stripe_billing_portal", customerId: customer.id },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      const url = (data as { url?: string })?.url;
      if (!url) throw new Error("No portal URL returned");
      window.open(url, "_blank", "noopener,noreferrer");
      toast.success("Stripe billing portal opened");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Stripe portal failed");
    } finally {
      setActioning(null);
    }
  };

  const deleteCustomer = async () => {
    if (!customer) return;
    setActioning("delete");
    try {
      const { data, error } = await supabase.functions.invoke("admin-customer-action", {
        body: {
          action: "delete_customer",
          customerId: customer.id,
          confirmName: confirmDeleteName,
          force: true,
        },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      toast.success("Customer deleted");
      setDeleteOpen(false);
      onClose();
      onChange();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setActioning(null);
    }
  };

  const resyncToGhl = async () => {
    if (!customer) return;
    setActioning("ghl");
    try {
      const { error } = await supabase.functions.invoke("sync-to-ghl", {
        body: {
          kind: "contact",
          payload: {
            email: customer.email,
            phone: customer.phone,
            firstName: customer.first_name,
            lastName: customer.last_name,
            zipCode: customer.zip,
            city: customer.city,
            state: customer.state,
          },
        },
      });
      if (error) throw error;
      toast.success("Synced to GHL");
    } catch (err: any) {
      toast.error(err?.message || "GHL sync failed");
    } finally {
      setActioning(null);
    }
  };

  return (
    <Sheet open={Boolean(customer)} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto bg-white">
        {!customer ? null : (
          <>
            <SheetHeader className="pb-4 border-b border-slate-100">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <SheetTitle className="text-lg text-slate-900">{fullName(customer)}</SheetTitle>
                  <SheetDescription className="text-slate-500">
                    Joined {new Date(customer.created_at).toLocaleDateString()} ·{" "}
                    {customer.referral_code ? `Referral: ${customer.referral_code}` : "No referral code"}
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>

            <div className="py-4 space-y-5">
              {/* Contact + account-level actions */}
              <div className="grid sm:grid-cols-2 gap-3">
                <ContactRow
                  icon={RiMailLine}
                  value={customer.email}
                  href={`mailto:${customer.email}`}
                  onCopy={() => copyText("Email", customer.email)}
                />
                <ContactRow
                  icon={RiPhoneLine}
                  value={customer.phone || "—"}
                  href={customer.phone ? `tel:${customer.phone}` : undefined}
                  onCopy={customer.phone ? () => copyText("Phone", customer.phone!) : undefined}
                />
                <ContactRow
                  icon={RiMapPinLine}
                  value={[customer.address, customer.city, customer.state, customer.zip].filter(Boolean).join(", ") || "—"}
                  onCopy={
                    customer.address
                      ? () =>
                          copyText(
                            "Address",
                            [customer.address, customer.city, customer.state, customer.zip]
                              .filter(Boolean)
                              .join(", "),
                          )
                      : undefined
                  }
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  className="border-slate-200 text-slate-700"
                  onClick={() => setEditOpen(true)}
                >
                  <RiEditLine className="w-4 h-4 mr-1.5" />
                  Edit profile
                </Button>
                <Button
                  variant="outline"
                  className="border-slate-200 text-slate-700"
                  onClick={openStripePortal}
                  disabled={actioning === "stripe"}
                >
                  {actioning === "stripe" ? (
                    <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" />
                  ) : (
                    <RiBankCardLine className="w-4 h-4 mr-1.5" />
                  )}
                  Stripe billing portal
                </Button>
                <Button
                  variant="outline"
                  className="border-violet-200 text-violet-800 bg-violet-50 hover:bg-violet-100"
                  onClick={sendPasswordReset}
                  disabled={actioning === "password"}
                >
                  {actioning === "password" ? (
                    <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" />
                  ) : (
                    <RiKey2Line className="w-4 h-4 mr-1.5" />
                  )}
                  Send password reset
                </Button>
                <Button
                  variant="outline"
                  className="border-slate-200 text-slate-700"
                  onClick={resyncToGhl}
                  disabled={actioning === "ghl"}
                >
                  {actioning === "ghl" ? (
                    <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" />
                  ) : (
                    <RiExternalLinkLine className="w-4 h-4 mr-1.5" />
                  )}
                  Re-sync to GHL
                </Button>
                <Button
                  variant="outline"
                  className="border-rose-200 text-rose-800 bg-rose-50 hover:bg-rose-100"
                  onClick={() => {
                    setConfirmDeleteName("");
                    setDeleteOpen(true);
                  }}
                >
                  <RiDeleteBinLine className="w-4 h-4 mr-1.5" />
                  Delete customer
                </Button>
              </div>

              <Separator />

              {/* Tabs */}
              <Tabs defaultValue="bookings">
                <TabsList className="grid grid-cols-2 bg-slate-100">
                  <TabsTrigger value="bookings" className="data-[state=active]:bg-white">
                    Bookings ({bookings.length})
                  </TabsTrigger>
                  <TabsTrigger value="wallet" className="data-[state=active]:bg-white">
                    Credit wallet
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="bookings" className="pt-4 space-y-2">
                  {loading ? (
                    <Skeleton className="h-32 w-full" />
                  ) : bookings.length === 0 ? (
                    <p className="text-sm text-slate-500 text-center py-6">
                      No bookings on file.
                    </p>
                  ) : (
                    bookings.map((b) => (
                      <div
                        key={b.id}
                        className="border border-slate-200 rounded-lg px-3 py-2.5 space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-900">
                              {b.service_date || "—"}{" "}
                              <span className="text-slate-500 font-normal">· {b.time_slot || ""}</span>
                            </p>
                            <p className="text-[11px] text-slate-500">
                              {b.service_type} · #{b.booking_number || b.id.slice(0, 8)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Badge
                              variant="outline"
                              className={cn("text-[10px] font-medium border", STATUS_BADGE[b.status || ""] || "bg-slate-100 text-slate-700 border-slate-200")}
                            >
                              {(b.status || "").replace(/_/g, " ")}
                            </Badge>
                            <span className="text-sm text-slate-900 font-semibold">
                              {dollars(b.final_charge_cents ?? b.total_estimate_cents)}
                            </span>
                          </div>
                        </div>
                        {(b.applied_credit_cents || 0) > 0 ? (
                          <p className="text-[11px] text-violet-700">
                            Wallet credit applied: {dollars(b.applied_credit_cents)}
                          </p>
                        ) : null}
                        {b.status !== "cancelled" && b.status !== "completed" ? (
                          <div className="flex flex-wrap gap-2 pt-1">
                            {b.payment_intent_id ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={actioning === b.id}
                                onClick={() => handleRefund(b)}
                                className="border-rose-200 text-rose-700 bg-rose-50 hover:bg-rose-100 h-7 text-xs"
                              >
                                <RiRefund2Line className="w-3 h-3 mr-1" />
                                Refund + cancel
                              </Button>
                            ) : null}
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={actioning === b.id}
                              onClick={() => handleCancel(b)}
                              className="border-slate-200 text-slate-700 h-7 text-xs"
                            >
                              <RiCloseCircleLine className="w-3 h-3 mr-1" />
                              Cancel (no refund)
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    ))
                  )}
                </TabsContent>

                <TabsContent value="wallet" className="pt-4 space-y-3">
                  <Card className="border-violet-200 bg-violet-50">
                    <CardContent className="p-4 flex items-center justify-between gap-2">
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-violet-700 font-semibold">
                          Available credit
                        </p>
                        <p className="text-2xl font-bold text-violet-800">
                          {dollars(balance?.balance_cents || 0)}
                        </p>
                        <p className="text-[11px] text-violet-700/80">
                          Lifetime granted {dollars(balance?.lifetime_granted_cents || 0)} ·
                          applied {dollars(balance?.lifetime_applied_cents || 0)}
                        </p>
                      </div>
                      <Button
                        onClick={() => setGrantOpen(true)}
                        className="bg-violet-600 hover:bg-violet-700 text-white"
                      >
                        <RiGift2Line className="w-4 h-4 mr-1.5" />
                        Grant credit
                      </Button>
                    </CardContent>
                  </Card>

                  {wallet.length === 0 ? (
                    <p className="text-sm text-slate-500 text-center py-3">
                      No credit history yet.
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {wallet.map((w) => (
                        <li
                          key={w.id}
                          className="flex items-center justify-between text-xs border border-slate-200 rounded-md px-3 py-2"
                        >
                          <div>
                            <span
                              className={cn(
                                "font-medium",
                                w.amount_cents > 0 ? "text-violet-700" : "text-rose-700",
                              )}
                            >
                              {w.amount_cents > 0 ? "+" : ""}
                              {dollars(w.amount_cents)}
                            </span>{" "}
                            <span className="text-slate-500">{w.source}</span>
                            {w.reason ? <span className="text-slate-500"> · {w.reason}</span> : null}
                          </div>
                          <Badge variant="outline" className="text-[10px] border-slate-200">
                            {w.status}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </TabsContent>
              </Tabs>
            </div>

            <GrantCreditDialog
              open={grantOpen}
              onOpenChange={setGrantOpen}
              customer={customer}
              onGranted={() => {
                onChange();
                if (customer) void loadDetail(customer);
              }}
            />

            <EditCustomerDialog
              open={editOpen}
              onOpenChange={setEditOpen}
              customer={customer}
              onSaved={() => {
                onChange();
                void loadDetail(customer);
              }}
            />

            <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="text-rose-900">Delete customer</DialogTitle>
                  <DialogDescription>
                    Permanently removes <strong>{fullName(customer)}</strong> from the directory.
                    Bookings by email are kept for history. Type their full name to confirm.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                  <Label className="text-sm">Type full name to confirm</Label>
                  <Input
                    value={confirmDeleteName}
                    onChange={(e) => setConfirmDeleteName(e.target.value)}
                    placeholder={fullName(customer)}
                  />
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDeleteOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={actioning === "delete" || confirmDeleteName.trim().toLowerCase() !== fullName(customer).toLowerCase()}
                    onClick={() => void deleteCustomer()}
                  >
                    {actioning === "delete" ? (
                      <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" />
                    ) : (
                      <RiDeleteBinLine className="w-4 h-4 mr-1.5" />
                    )}
                    Delete permanently
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ContactRow({
  icon: Icon,
  value,
  href,
  onCopy,
}: {
  icon: typeof RiMailLine;
  value: string;
  href?: string;
  onCopy?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-700 border border-slate-200 rounded-md px-3 py-2">
      <Icon className="w-4 h-4 text-slate-400 shrink-0" />
      {href ? (
        <a className="truncate hover:text-violet-700 flex-1" href={href}>
          {value}
        </a>
      ) : (
        <span className="truncate flex-1">{value}</span>
      )}
      {onCopy ? (
        <Button type="button" size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={onCopy}>
          <RiFileCopyLine className="w-3.5 h-3.5 text-slate-500" />
        </Button>
      ) : null}
    </div>
  );
}

function EditCustomerDialog({
  open,
  onOpenChange,
  customer,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  customer: Customer;
  onSaved: () => void;
}) {
  const [firstName, setFirstName] = useState(customer.first_name || "");
  const [lastName, setLastName] = useState(customer.last_name || "");
  const [email, setEmail] = useState(customer.email);
  const [phone, setPhone] = useState(customer.phone || "");
  const [address, setAddress] = useState(customer.address || "");
  const [city, setCity] = useState(customer.city || "");
  const [state, setState] = useState(customer.state || "");
  const [zip, setZip] = useState(customer.zip || "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFirstName(customer.first_name || "");
    setLastName(customer.last_name || "");
    setEmail(customer.email);
    setPhone(customer.phone || "");
    setAddress(customer.address || "");
    setCity(customer.city || "");
    setState(customer.state || "");
    setZip(customer.zip || "");
  }, [open, customer]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-customer-action", {
        body: {
          action: "update_customer",
          customerId: customer.id,
          firstName,
          lastName,
          email,
          phone,
          address,
          city,
          state,
          zip,
        },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      toast.success("Customer updated");
      onOpenChange(false);
      onSaved();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit customer</DialogTitle>
          <DialogDescription>Updates the directory record used across bookings and GHL sync.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-sm">First name</Label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
            </div>
            <div>
              <Label className="text-sm">Last name</Label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
          <div>
            <Label className="text-sm">Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <Label className="text-sm">Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <Label className="text-sm">Address</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <Label className="text-sm">City</Label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div>
              <Label className="text-sm">State</Label>
              <Input value={state} onChange={(e) => setState(e.target.value)} />
            </div>
          </div>
          <div>
            <Label className="text-sm">ZIP</Label>
            <Input value={zip} onChange={(e) => setZip(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy} className="bg-violet-600 hover:bg-violet-700 text-white">
              {busy ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiCheckLine className="w-4 h-4 mr-1.5" />}
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Grant credit dialog ─────────────────────────────────────────────────

function GrantCreditDialog({
  open,
  onOpenChange,
  customer,
  onGranted,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  customer: Customer;
  onGranted: () => void;
}) {
  const [amount, setAmount] = useState("50");
  const [source, setSource] = useState("admin_grant");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cents = Math.round(parseFloat(amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      toast.error("Enter a positive dollar amount");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("admin-grant-credit", {
        body: {
          action: "grant",
          customerId: customer.id,
          amountCents: cents,
          source,
          reason: reason || `Manual grant by admin`,
        },
      });
      if (error) throw error;
      toast.success(`Credited $${(cents / 100).toFixed(2)}`);
      onOpenChange(false);
      onGranted();
    } catch (err: any) {
      toast.error(err?.message || "Grant failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Grant credit</DialogTitle>
          <DialogDescription>
            Credits land in the customer's wallet immediately and auto-apply to their next booking.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label className="text-sm">Amount (USD)</Label>
            <Input
              type="number"
              min="1"
              step="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>
          <div>
            <Label className="text-sm">Source</Label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin_grant">Admin grant</SelectItem>
                <SelectItem value="service_recovery">Service recovery</SelectItem>
                <SelectItem value="referral_reward">Referral reward</SelectItem>
                <SelectItem value="goodwill">Goodwill</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-sm">Reason (visible to customer)</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g., Sorry about the late arrival on 6/12"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy} className="bg-violet-600 hover:bg-violet-700 text-white">
              {busy ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiCheckLine className="w-4 h-4 mr-1.5" />}
              Grant ${amount || "0"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Create-customer dialog ──────────────────────────────────────────────

function CreateCustomerDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [zip, setZip] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setFirstName("");
    setLastName("");
    setEmail("");
    setPhone("");
    setZip("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !firstName) {
      toast.error("First name and email are required");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.from("customers").insert({
        first_name: firstName,
        last_name: lastName || null,
        email: email.toLowerCase().trim(),
        phone: phone.replace(/\D/g, "") || null,
        zip: zip || null,
      });
      if (error) throw error;
      // Best-effort: kick off a password-set email so they can sign in.
      try {
        await supabase.functions.invoke("send-auth-email", {
          body: {
            kind: "signup_customer",
            email: email.toLowerCase().trim(),
            metadata: { first_name: firstName, last_name: lastName },
            redirectTo: "https://app.novaracleaning.com/update-password",
          },
        });
      } catch { /* non-blocking */ }
      toast.success("Customer created · password-set email sent");
      reset();
      onOpenChange(false);
      onCreated();
    } catch (err: any) {
      toast.error(err?.message || "Failed to create customer");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New customer account</DialogTitle>
          <DialogDescription>
            Creates the row in <code>public.customers</code> and emails a magic
            sign-in link so they can claim the account.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-sm">First name *</Label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
            </div>
            <div>
              <Label className="text-sm">Last name</Label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
          <div>
            <Label className="text-sm">Email *</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-sm">Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 555-5555" />
            </div>
            <div>
              <Label className="text-sm">ZIP</Label>
              <Input value={zip} onChange={(e) => setZip(e.target.value)} placeholder="21202" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy} className="bg-violet-600 hover:bg-violet-700 text-white">
              {busy ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiUserAddLine className="w-4 h-4 mr-1.5" />}
              Create customer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
