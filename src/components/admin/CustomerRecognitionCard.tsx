"use client";

import {
  RiCheckboxCircleLine,
  RiSparklingLine,
  RiVipCrownLine
} from "@remixicon/react";
import { Card } from "@/components/ui/card";

export interface CustomerStatus {
  isNew: boolean;
  hasMembership: boolean;
  membershipPlan?: string;
  creditsRemaining?: number;
  creditsPerMonth?: number;
  currentPeriodEnd?: string;
}

interface CustomerRecognitionCardProps {
  status: CustomerStatus | null;
}

export function CustomerRecognitionCard({ status }: CustomerRecognitionCardProps) {
  if (!status) return null;

  if (status.isNew) {
    return (
      <Card className="p-4 bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800">
        <div className="flex items-start gap-3">
          <RiSparklingLine className="w-5 h-5 text-green-600 dark:text-green-400 mt-0.5" />
          <div>
            <h4 className="font-semibold text-green-900 dark:text-green-100">New Customer</h4>
            <p className="text-sm text-green-700 dark:text-green-300">$30 discount will be applied</p>
          </div>
        </div>
      </Card>
    );
  }

  if (status.hasMembership && status.membershipPlan) {
    const formatDate = (dateStr: string) => {
      return new Date(dateStr).toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric' 
      });
    };

    return (
      <Card className="p-4 bg-purple-50 dark:bg-purple-950 border-purple-200 dark:border-purple-800">
        <div className="flex items-start gap-3">
          <RiVipCrownLine className="w-5 h-5 text-purple-600 dark:text-purple-400 mt-0.5" />
          <div className="space-y-1">
            <h4 className="font-semibold text-purple-900 dark:text-purple-100">
              Active Member - {status.membershipPlan}
            </h4>
            <ul className="text-sm text-purple-700 dark:text-purple-300 space-y-0.5">
              <li>• Discount on extras applies automatically</li>
              {status.creditsRemaining !== undefined && status.creditsRemaining > 0 && (
                <li>
                  • {status.creditsRemaining} credit{status.creditsRemaining > 1 ? 's' : ''} available
                  {status.currentPeriodEnd && ` (expires ${formatDate(status.currentPeriodEnd)})`}
                </li>
              )}
              <li>• Credits cover standard cleans only</li>
            </ul>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4 bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
      <div className="flex items-start gap-3">
        <RiCheckboxCircleLine className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5" />
        <div>
          <h4 className="font-semibold text-blue-900 dark:text-blue-100">Returning Customer</h4>
          <p className="text-sm text-blue-700 dark:text-blue-300">Email found in system</p>
        </div>
      </div>
    </Card>
  );
}
