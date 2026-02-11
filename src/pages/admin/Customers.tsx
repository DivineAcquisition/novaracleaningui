import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/admin/AdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, ChevronDown, ChevronUp } from "lucide-react";

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
  service_date: string;
  service_type: string;
  status: string | null;
  total_estimate_cents: number;
}

interface MembershipCredit {
  membership_plan: string;
  credits_remaining: number;
  credits_per_month: number;
  current_period_end: string;
}

export default function AdminCustomers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedBookings, setExpandedBookings] = useState<CustomerBooking[]>([]);
  const [expandedCredits, setExpandedCredits] = useState<MembershipCredit[]>([]);
  const [expandLoading, setExpandLoading] = useState(false);

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

    const [{ data: bData }, { data: mData }] = await Promise.all([
      supabase
        .from("bookings")
        .select("id, service_date, service_type, status, total_estimate_cents")
        .eq("email", customer.email)
        .order("service_date", { ascending: false })
        .limit(20),
      supabase
        .from("membership_credits")
        .select("membership_plan, credits_remaining, credits_per_month, current_period_end")
        .eq("email", customer.email)
        .limit(5),
    ]);

    setExpandedBookings(bData || []);
    setExpandedCredits(mData || []);
    setExpandLoading(false);
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
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-white">Customers</h1>

        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
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
                                <ChevronUp className="h-4 w-4 text-slate-500" />
                              ) : (
                                <ChevronDown className="h-4 w-4 text-slate-500" />
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
                                  <div className="grid md:grid-cols-2 gap-6">
                                    {/* Booking History */}
                                    <div>
                                      <h4 className="text-xs font-semibold uppercase text-slate-500 mb-2">
                                        Booking History ({expandedBookings.length})
                                      </h4>
                                      {expandedBookings.length === 0 ? (
                                        <p className="text-sm text-slate-500">No bookings</p>
                                      ) : (
                                        <div className="space-y-2">
                                          {expandedBookings.map((b) => (
                                            <div key={b.id} className="flex items-center justify-between text-sm bg-slate-800/50 rounded px-3 py-2">
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
      </div>
    </AdminLayout>
  );
}
