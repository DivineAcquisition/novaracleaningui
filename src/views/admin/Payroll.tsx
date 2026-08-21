"use client";

// ─── /admin/payroll ────────────────────────────────────────────────────
//
// Tabs:
//   Custom Payout — confirm the job amount, notify the cleaner, mark paid
//   Extra Pay     — supplies / mileage / surge / OT / job-value (paid via Connect)
//   Pay Rates     — crew-size revenue-share configuration
//   Run Payroll   — Stripe Connect batch of Extra Pay (Custom Payout Stripe paused)
//   Tax Forms     — calendar-year 1099-NEC prep + Stripe Tax Reporting links

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import SimplePayoutTab from "@/components/admin/payroll/SimplePayoutTab";
import RunPayrollTab from "@/components/admin/payroll/RunPayrollTab";
import ExtraPayTab from "@/components/admin/payroll/ExtraPayTab";
import CrewPayRatesCard from "@/components/admin/payroll/CrewPayRatesCard";
import Tax1099Tab from "@/components/admin/payroll/Tax1099Tab";
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
          Confirm amounts in Custom Payout (notifies the cleaner) and Extra Pay.
          Stripe transfers for Custom Payout are paused — mark paid when you&apos;ve paid them.
          Run Payroll still sends Extra Pay through Stripe Connect when funds are available.
        </p>
      </div>
      <Tabs defaultValue="payout" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="payout">Custom Payout</TabsTrigger>
          <TabsTrigger value="cleaner">Extra Pay</TabsTrigger>
          <TabsTrigger value="rates">Pay Rates</TabsTrigger>
          <TabsTrigger value="run">Run Payroll</TabsTrigger>
          <TabsTrigger value="tax1099">Tax Forms (1099)</TabsTrigger>
        </TabsList>
        <TabsContent value="payout"><SimplePayoutTab /></TabsContent>
        <TabsContent value="cleaner"><ExtraPayTab cleaners={cleaners} /></TabsContent>
        <TabsContent value="rates"><CrewPayRatesCard /></TabsContent>
        <TabsContent value="run"><RunPayrollTab cleaners={cleaners} /></TabsContent>
        <TabsContent value="tax1099"><Tax1099Tab /></TabsContent>
      </Tabs>
    </div>
  );
}
