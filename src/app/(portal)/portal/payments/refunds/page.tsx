"use client";
export const dynamic = "force-dynamic";

import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, RefreshCcw, ExternalLink } from "lucide-react";

export default function RefundsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/portal/payments">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Refunds</h1>
          <p className="text-muted-foreground">
            Manage refund requests and processing
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Refund Management</CardTitle>
          <CardDescription>
            Process refunds through Stripe Dashboard
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            Refunds are processed directly through Stripe. Click the button below to access the Stripe Dashboard where you can:
          </p>
          <ul className="list-disc list-inside text-muted-foreground space-y-1">
            <li>Issue full or partial refunds</li>
            <li>View refund history</li>
            <li>Track refund status</li>
          </ul>
          <Button asChild>
            <a
              href="https://dashboard.stripe.com/payments"
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              Open Stripe Dashboard
            </a>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Refund Policy</CardTitle>
        </CardHeader>
        <CardContent className="prose prose-sm max-w-none text-muted-foreground">
          <p>
            <strong>Full Refund:</strong> Available for cancellations made at least 24 hours before the scheduled service.
          </p>
          <p>
            <strong>Partial Refund:</strong> 50% refund for cancellations made less than 24 hours but more than 2 hours before service.
          </p>
          <p>
            <strong>No Refund:</strong> Cancellations made within 2 hours of scheduled service are non-refundable.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
