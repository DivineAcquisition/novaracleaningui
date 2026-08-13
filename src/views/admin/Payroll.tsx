"use client";

// ─── /admin/payroll ────────────────────────────────────────────────────
//
// Four tabs only:
//   Custom Payout — confirm the job amount; Stripe Connect pays if funds exist
//   Extra Pay     — supplies / mileage / surge / OT / job-value (paid via Connect)
//   Pay Rates     — crew-size revenue-share configuration
//   Run Payroll   — Stripe Connect batch of whatever is actually in Custom
//                   Payout + Extra Pay (not auto-calculated booking share)

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import SimplePayoutTab from "@/components/admin/payroll/SimplePayoutTab";
import RunPayrollTab from "@/components/admin/payroll/RunPayrollTab";
import ExtraPayTab from "@/components/admin/payroll/ExtraPayTab";
import CrewPayRatesCard from "@/components/admin/payroll/CrewPayRatesCard";
import { loadActiveCleaners, type PayrollCleaner } from "@/components/admin/payroll/shared";

export default function AdminPayroll() {
  const [cleaners, setCleaners] = useState<PayrollCleaner[]>([]);

  useEffect(() => {
    loadActiveCleaners()
      .then(setCleaners)
      .catch((err) => toast.error(err instanceof Error ? err.message : "Failed to load cleaners"));
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-jakarta text-2xl font-bold text-slate-900 tracking-tight">Payroll</h1>
        <p className="text-sm text-slate-500 mt-1">
          Confirm amounts in Custom Payout and Extra Pay, then send them through Stripe Connect.
          Run Payroll pays exactly those confirmed amounts — as long as funds are available in Stripe.
        </p>
      </div>
      <Tabs defaultValue="payout" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="payout">Custom Payout</TabsTrigger>
          <TabsTrigger value="cleaner">Extra Pay</TabsTrigger>
          <TabsTrigger value="rates">Pay Rates</TabsTrigger>
          <TabsTrigger value="run">Run Payroll</TabsTrigger>
        </TabsList>
        <TabsContent value="payout"><SimplePayoutTab /></TabsContent>
        <TabsContent value="cleaner"><ExtraPayTab cleaners={cleaners} /></TabsContent>
        <TabsContent value="rates"><CrewPayRatesCard /></TabsContent>
        <TabsContent value="run"><RunPayrollTab cleaners={cleaners} /></TabsContent>
      </Tabs>
    </div>
  );
}
