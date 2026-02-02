"use client";

import { Card } from "@/components/ui/card";
import { DollarSign, Briefcase, Star, TrendingUp } from "lucide-react";

interface DashboardStatsProps {
  stats: {
    totalEarnings: number;
    jobsCompleted: number;
    averageRating: number;
    totalRatings: number;
    acceptanceRate: number;
  };
}

export function DashboardStats({ stats }: DashboardStatsProps) {
  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(cents / 100);
  };

  const cards = [
    {
      title: "Total Earnings",
      value: formatCurrency(stats.totalEarnings),
      icon: DollarSign,
      color: "text-green-500",
      bgColor: "bg-green-500/10",
    },
    {
      title: "Jobs Completed",
      value: stats.jobsCompleted.toString(),
      subtitle: "jobs",
      icon: Briefcase,
      color: "text-blue-500",
      bgColor: "bg-blue-500/10",
    },
    {
      title: "Average Rating",
      value: stats.averageRating > 0 ? stats.averageRating.toFixed(1) : "—",
      subtitle: stats.totalRatings > 0 ? `${stats.totalRatings} reviews` : "No ratings yet",
      icon: Star,
      color: "text-yellow-500",
      bgColor: "bg-yellow-500/10",
    },
    {
      title: "Acceptance Rate",
      value: `${Math.round(stats.acceptanceRate)}%`,
      icon: TrendingUp,
      color: "text-purple-500",
      bgColor: "bg-purple-500/10",
    },
  ];

  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4 mb-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <Card key={card.title} className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  {card.title}
                </p>
                <div className="flex items-baseline gap-2 mt-1">
                  <h3 className="text-xl font-bold">{card.value}</h3>
                  {card.subtitle && (
                    <span className="text-xs text-muted-foreground">
                      {card.subtitle}
                    </span>
                  )}
                </div>
              </div>
              <div className={`p-2 rounded-full ${card.bgColor}`}>
                <Icon className={`w-4 h-4 ${card.color}`} />
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
