"use client";
export const dynamic = "force-dynamic";

import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function OperationsReportPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/portal/reports">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Operations Report</h1>
          <p className="text-muted-foreground">
            Operational metrics and performance analysis
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Coming Soon</CardTitle>
          <CardDescription>
            Operational reports are being developed
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            This page will include operational metrics such as:
          </p>
          <ul className="list-disc list-inside mt-4 text-muted-foreground space-y-1">
            <li>Cleaner performance rankings</li>
            <li>Dispatch efficiency metrics</li>
            <li>Cancellation rates</li>
            <li>Average response times</li>
            <li>Customer satisfaction scores</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
