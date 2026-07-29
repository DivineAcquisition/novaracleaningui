"use client";

import {
  RiExternalLinkLine,
  RiMoneyDollarCircleLine
} from "@remixicon/react";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";

interface EarningsPayoutsProps {
  payouts: any[];
}

export function EarningsPayouts({ payouts }: EarningsPayoutsProps) {
  if (payouts.length === 0) {
    return (
      <div className="text-center py-8">
        <RiMoneyDollarCircleLine className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">No payouts yet</p>
        <p className="text-xs text-muted-foreground mt-1">
          Complete jobs to start earning
        </p>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "default";
      case "processing":
        return "secondary";
      case "failed":
        return "destructive";
      default:
        return "outline";
    }
  };

  const totalEarnings = payouts
    .filter((p) => p.status === "completed")
    .reduce((sum, p) => sum + p.cleaner_payout_cents, 0);

  const processingAmount = payouts
    .filter((p) => p.status === "processing")
    .reduce((sum, p) => sum + p.cleaner_payout_cents, 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground mb-1">Total Paid Out</div>
          <div className="text-2xl font-bold text-green-600">
            ${(totalEarnings / 100).toFixed(2)}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground mb-1">Processing</div>
          <div className="text-2xl font-bold text-yellow-600">
            ${(processingAmount / 100).toFixed(2)}
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            Usually arrives in 1-2 business days
          </p>
        </Card>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Job Address</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payouts.map((payout) => (
              <TableRow key={payout.id}>
                <TableCell>
                  {format(new Date(payout.created_at), "MMM d, yyyy")}
                </TableCell>
                <TableCell className="max-w-xs truncate">
                  {payout.booking?.address || "—"}
                </TableCell>
                <TableCell className="text-right font-medium">
                  ${(payout.cleaner_payout_cents / 100).toFixed(2)}
                </TableCell>
                <TableCell>
                  <Badge variant={getStatusColor(payout.status)}>
                    {payout.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  {payout.stripe_transfer_id && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        window.open(
                          `https://dashboard.stripe.com/transfers/${payout.stripe_transfer_id}`,
                          "_blank"
                        )
                      }
                    >
                      <RiExternalLinkLine className="w-4 h-4" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card className="p-4 bg-muted/50">
        <h4 className="text-sm font-semibold mb-2">How Payouts Work</h4>
        <ul className="text-xs space-y-1 text-muted-foreground">
          <li>• Payouts are processed automatically when jobs are marked complete</li>
          <li>• Money is transferred to your linked bank account via Stripe</li>
          <li>• Transfers typically arrive in 1-2 business days</li>
          <li>• You earn a percentage of every job&apos;s value, set by your tier</li>
          <li>
            • Working with a crew earns a <strong>higher</strong> rate than working solo — two
            cleaners don&apos;t halve the work, so the crew rate rises to keep your hourly fair
          </li>
          <li>
            • On a crew job the percentage is the share paid to the <strong>whole crew</strong> and
            divided between you — it isn&apos;t paid to each person
          </li>
          <li>
            • Your pay is based on the final value of the job and the size of the crew assigned. If
            the job&apos;s value changes or the crew changes, your pay is recalculated to match
          </li>
          <li>• Every job in your history shows the crew size and the rate applied</li>
        </ul>
      </Card>
    </div>
  );
}
