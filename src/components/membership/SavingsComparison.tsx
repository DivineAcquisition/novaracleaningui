import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingDown } from "lucide-react";

interface SavingsComparisonProps {
  monthlyPrice: number;
  regularCleanPrice: number;
  creditsPerMonth: number;
}

export function SavingsComparison({ monthlyPrice, regularCleanPrice, creditsPerMonth }: SavingsComparisonProps) {
  // Calculate costs for different periods
  const calculateSavings = (months: number) => {
    const membershipCost = monthlyPrice * months;
    const totalCredits = creditsPerMonth * months;
    const regularCost = regularCleanPrice * totalCredits;
    const savings = regularCost - membershipCost;
    const savingsPercent = ((savings / regularCost) * 100).toFixed(0);
    
    return {
      membershipCost,
      regularCost,
      savings,
      savingsPercent,
      totalCleans: totalCredits
    };
  };

  const threeMonths = calculateSavings(3);
  const sixMonths = calculateSavings(6);
  const twelveMonths = calculateSavings(12);

  return (
    <Card className="border-2 border-primary/20">
      <CardHeader className="text-center pb-4">
        <div className="mx-auto w-12 h-12 bg-gradient-primary rounded-full flex items-center justify-center mb-2">
          <TrendingDown className="w-6 h-6 text-white" />
        </div>
        <CardTitle className="text-2xl font-jakarta">Membership Savings Calculator</CardTitle>
        <p className="text-sm text-muted-foreground mt-2">
          See how much you save compared to paying per clean
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          {/* 3 Months */}
          <div className="bg-accent/30 rounded-lg p-4 space-y-3">
            <div className="text-center">
              <h4 className="text-lg font-semibold text-foreground">3 Months</h4>
              <p className="text-xs text-muted-foreground">{threeMonths.totalCleans} cleanings</p>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Per-Clean Cost:</span>
                <span className="font-medium line-through text-muted-foreground">${threeMonths.regularCost}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Membership Cost:</span>
                <span className="font-medium text-foreground">${threeMonths.membershipCost}</span>
              </div>
              <div className="pt-2 border-t border-border">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-foreground">You Save:</span>
                  <div className="text-right">
                    <div className="font-bold text-primary">${threeMonths.savings}</div>
                    <div className="text-xs text-primary">({threeMonths.savingsPercent}% off)</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 6 Months */}
          <div className="bg-primary/10 rounded-lg p-4 space-y-3 ring-2 ring-primary">
            <div className="text-center">
              <h4 className="text-lg font-semibold text-foreground">6 Months</h4>
              <p className="text-xs text-muted-foreground">{sixMonths.totalCleans} cleanings</p>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Per-Clean Cost:</span>
                <span className="font-medium line-through text-muted-foreground">${sixMonths.regularCost}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Membership Cost:</span>
                <span className="font-medium text-foreground">${sixMonths.membershipCost}</span>
              </div>
              <div className="pt-2 border-t border-border">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-foreground">You Save:</span>
                  <div className="text-right">
                    <div className="font-bold text-primary">${sixMonths.savings}</div>
                    <div className="text-xs text-primary">({sixMonths.savingsPercent}% off)</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 12 Months */}
          <div className="bg-accent/30 rounded-lg p-4 space-y-3">
            <div className="text-center">
              <h4 className="text-lg font-semibold text-foreground">12 Months</h4>
              <p className="text-xs text-muted-foreground">{twelveMonths.totalCleans} cleanings</p>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Per-Clean Cost:</span>
                <span className="font-medium line-through text-muted-foreground">${twelveMonths.regularCost}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Membership Cost:</span>
                <span className="font-medium text-foreground">${twelveMonths.membershipCost}</span>
              </div>
              <div className="pt-2 border-t border-border">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-foreground">You Save:</span>
                  <div className="text-right">
                    <div className="font-bold text-primary">${twelveMonths.savings}</div>
                    <div className="text-xs text-primary">({twelveMonths.savingsPercent}% off)</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="text-center text-xs text-muted-foreground pt-2">
          * Based on standard cleaning rate of ${regularCleanPrice} per clean
        </div>
      </CardContent>
    </Card>
  );
}
