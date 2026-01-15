"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { format, parseISO } from "date-fns";
import { formatCurrency } from "@/lib/utils";
import {
  CreditCard,
  ExternalLink,
  Receipt,
  Loader2,
  Calendar,
} from "lucide-react";
import { toast } from "sonner";

interface Transaction {
  id: string;
  service_date: string;
  service_type: string;
  total_estimate_cents: number;
  status: string | null;
  payment_intent_id: string | null;
}

export default function PaymentsPage() {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    const fetchTransactions = async () => {
      if (!user?.email) return;

      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from("bookings")
          .select("id, service_date, service_type, total_estimate_cents, status, payment_intent_id")
          .eq("email", user.email)
          .not("payment_intent_id", "is", null)
          .order("service_date", { ascending: false })
          .limit(50);

        if (error) throw error;
        setTransactions(data || []);
      } catch (error) {
        console.error("Error fetching transactions:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchTransactions();
  }, [user]);

  const handleManageBilling = async () => {
    setIsProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke("customer-portal", {
        body: { email: user?.email },
      });

      if (error) throw error;
      if (data?.url) {
        window.open(data.url, "_blank");
      }
    } catch (error) {
      console.error("Error:", error);
      toast.error("Failed to open billing portal");
    } finally {
      setIsProcessing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Payments</h1>
          <p className="text-muted-foreground">
            View your payment history
          </p>
        </div>
        <Button onClick={handleManageBilling} disabled={isProcessing}>
          {isProcessing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <CreditCard className="h-4 w-4 mr-2" />
              Manage Payment Methods
              <ExternalLink className="h-4 w-4 ml-2" />
            </>
          )}
        </Button>
      </div>

      {transactions.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Receipt className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No transactions yet</h3>
            <p className="text-muted-foreground">
              Your payment history will appear here
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Transaction History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {transactions.map((transaction) => (
                <div
                  key={transaction.id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                      <Receipt className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">{transaction.service_type}</p>
                      <p className="text-sm text-muted-foreground flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {format(parseISO(transaction.service_date), "MMM d, yyyy")}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">
                      {formatCurrency(transaction.total_estimate_cents)}
                    </p>
                    <Badge
                      variant={
                        transaction.status === "completed"
                          ? "secondary"
                          : transaction.status === "confirmed"
                          ? "default"
                          : "outline"
                      }
                    >
                      {transaction.status || "Pending"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Need Help?</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            For billing questions or to request a refund, please contact our support team.
          </p>
          <Button variant="outline" asChild>
            <a href="mailto:support@novaracleaning.com">
              Contact Support
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
