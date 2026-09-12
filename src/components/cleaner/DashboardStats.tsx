"use client";

import {
  RiArrowRightUpLine,
  RiBriefcaseLine,
  RiMoneyDollarCircleLine,
  RiStarLine
} from "@remixicon/react";
import { Card } from "@/components/ui/card";
import { TOUR, tourAnchor, type TourAnchor } from "@/lib/tours/anchors";

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

  // `anchor` ties a tile to a walkthrough step. Set per tile rather than by
  // position, so reordering the tiles can't leave a step pointing at the
  // wrong number.
  const cards: Array<{
    title: string;
    value: string;
    subtitle?: string;
    icon: typeof RiStarLine;
    color: string;
    bgColor: string;
    anchor?: TourAnchor;
  }> = [
    {
      title: "Total Earnings",
      value: formatCurrency(stats.totalEarnings),
      icon: RiMoneyDollarCircleLine,
      color: "text-green-500",
      bgColor: "bg-green-500/10",
      anchor: TOUR.statEarnings,
    },
    {
      title: "Jobs Completed",
      value: stats.jobsCompleted.toString(),
      subtitle: "jobs",
      icon: RiBriefcaseLine,
      color: "text-blue-500",
      bgColor: "bg-blue-500/10",
      anchor: TOUR.statJobsCompleted,
    },
    {
      title: "Average Rating",
      value: stats.averageRating > 0 ? stats.averageRating.toFixed(1) : "—",
      subtitle: stats.totalRatings > 0 ? `${stats.totalRatings} reviews` : "No ratings yet",
      icon: RiStarLine,
      color: "text-yellow-500",
      bgColor: "bg-yellow-500/10",
      anchor: TOUR.statRating,
    },
    {
      title: "Acceptance Rate",
      value: `${Math.round(stats.acceptanceRate)}%`,
      icon: RiArrowRightUpLine,
      color: "text-purple-500",
      bgColor: "bg-purple-500/10",
    },
  ];

  return (
    <div
      className="grid gap-3 md:grid-cols-2 lg:grid-cols-4 mb-4"
      {...tourAnchor(TOUR.dashboardStats)}
    >
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <Card
            key={card.title}
            className="p-4"
            {...(card.anchor ? tourAnchor(card.anchor) : {})}
          >
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
