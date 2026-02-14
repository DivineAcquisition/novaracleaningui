import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SERVICE_TIERS, ADD_ONS } from "@/config/brand-config";
import { calculateQuote, formatCents } from "@/lib/sales-pricing";
import { Copy, Mail, Calculator, TrendingDown } from "lucide-react";
import { formatQuoteText } from "@/lib/sales-pricing";
import { toast } from "sonner";

interface LiveQuotePanelProps {
  homeSizeId: string;
  serviceType: string;
  frequency: string;
  addOns: string[];
  isNewCustomer: boolean;
  bedrooms?: number;
  bathrooms?: number;
  leadEmail?: string;
}

export function LiveQuotePanel({
  homeSizeId,
  serviceType,
  frequency,
  addOns,
  isNewCustomer,
  bedrooms,
  bathrooms,
  leadEmail,
}: LiveQuotePanelProps) {
  const quote = useMemo(
    () =>
      calculateQuote({
        homeSizeId,
        serviceType,
        frequency,
        addOnIds: addOns,
        isNewCustomer,
      }),
    [homeSizeId, serviceType, frequency, addOns, isNewCustomer]
  );

  const serviceName = SERVICE_TIERS.find((t) => t.id === serviceType)?.name || "Standard Clean";
  const selectedAddOns = addOns.map((id) => ADD_ONS.find((a) => a.id === id)).filter(Boolean);

  const handleCopy = () => {
    const text = formatQuoteText(quote, { serviceName, frequency, bedrooms, bathrooms, isNewCustomer });
    navigator.clipboard.writeText(text);
    toast.success("Quote copied to clipboard");
  };

  if (!homeSizeId) {
    return (
      <div className="p-6 text-center text-slate-500">
        <Calculator className="w-10 h-10 mx-auto mb-3 opacity-50" />
        <p className="text-sm">Select a home size to see pricing</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-white flex items-center gap-2">
          <Calculator className="w-4 h-4 text-amber-400" />
          Live Quote
        </h3>
        {quote.discountPct > 0 && (
          <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">
            <TrendingDown className="w-3 h-3 mr-1" />
            {quote.discountPct}% off
          </Badge>
        )}
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between text-slate-300">
          <span>{serviceName}</span>
          <span>{formatCents(quote.basePriceCents)}</span>
        </div>
        {quote.homeSizeLabel && (
          <div className="text-xs text-slate-500">{quote.homeSizeLabel} • ~{quote.estimatedHours}hrs</div>
        )}

        {quote.serviceTierCost > 0 && (
          <div className="flex justify-between text-slate-400">
            <span>Service upgrade</span>
            <span>+{formatCents(quote.serviceTierCost)}</span>
          </div>
        )}

        {selectedAddOns.length > 0 && (
          <>
            <Separator className="bg-slate-700" />
            {selectedAddOns.map((addon) => (
              <div key={addon!.id} className="flex justify-between text-slate-400 text-xs">
                <span>{addon!.name}</span>
                <span>+${addon!.price}</span>
              </div>
            ))}
          </>
        )}

        {(quote.discountCents > 0 || isNewCustomer) && (
          <>
            <Separator className="bg-slate-700" />
            {quote.discountCents > 0 && (
              <div className="flex justify-between text-emerald-400">
                <span>{frequency} discount</span>
                <span>-{formatCents(quote.discountCents)}</span>
              </div>
            )}
            {isNewCustomer && (
              <div className="flex justify-between text-emerald-400">
                <span>New customer discount</span>
                <span>-$60.00</span>
              </div>
            )}
          </>
        )}
      </div>

      <Separator className="bg-slate-600" />

      <div className="space-y-2">
        <div className="flex justify-between text-white font-bold text-lg">
          <span>Per Clean</span>
          <span>{formatCents(quote.perCleanCents)}</span>
        </div>
        {quote.subtotalCents !== quote.finalPriceCents && (
          <div className="flex justify-between text-slate-500 text-xs">
            <span>Was</span>
            <span className="line-through">{formatCents(quote.subtotalCents)}</span>
          </div>
        )}
      </div>

      <div className="bg-slate-800/50 rounded-lg p-3 space-y-2 text-sm">
        <div className="flex justify-between text-amber-400 font-semibold">
          <span>💰 Deposit Today</span>
          <span>{formatCents(quote.depositCents)}</span>
        </div>
        <div className="flex justify-between text-slate-300">
          <span>Balance After Service</span>
          <span>{formatCents(quote.balanceDueCents)}</span>
        </div>
        {frequency !== "One-Time" && (
          <div className="flex justify-between text-slate-300">
            <span>📅 Monthly Total</span>
            <span>{formatCents(quote.monthlyTotalCents)}</span>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white"
          onClick={handleCopy}
        >
          <Copy className="w-3 h-3 mr-1" /> Copy Quote
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1 border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white"
          disabled={!leadEmail}
          onClick={() => toast.info("Email quote feature coming in Phase 2")}
        >
          <Mail className="w-3 h-3 mr-1" /> Email Quote
        </Button>
      </div>
    </div>
  );
}
