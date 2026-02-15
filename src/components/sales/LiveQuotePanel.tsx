import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SERVICE_TIERS, ADD_ONS } from "@/config/brand-config";
import { calculateQuote, formatCents } from "@/lib/sales-pricing";
import { Copy, Mail, Calculator, TrendingDown, Loader2 } from "lucide-react";
import { formatQuoteText } from "@/lib/sales-pricing";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface LiveQuotePanelProps {
  homeSizeId: string;
  serviceType: string;
  frequency: string;
  addOns: string[];
  isNewCustomer?: boolean;
  customDiscount?: number;
  bedrooms?: number;
  bathrooms?: number;
  leadEmail?: string;
  leadId?: string | null;
  leadFirstName?: string;
  onStatusAdvance?: (status: string) => void;
}

export function LiveQuotePanel({
  homeSizeId,
  serviceType,
  frequency,
  addOns,
  isNewCustomer,
  customDiscount = 0,
  bedrooms,
  bathrooms,
  leadEmail,
  leadId,
  leadFirstName,
  onStatusAdvance,
}: LiveQuotePanelProps) {
  const [sendingEmail, setSendingEmail] = useState(false);

  const quote = useMemo(
    () =>
      calculateQuote({
        homeSizeId,
        serviceType,
        frequency,
        addOnIds: addOns,
        customDiscountCents: customDiscount * 100,
      }),
    [homeSizeId, serviceType, frequency, addOns, customDiscount]
  );

  const serviceName = SERVICE_TIERS.find((t) => t.id === serviceType)?.name || "Standard Clean";
  const selectedAddOns = addOns.map((id) => ADD_ONS.find((a) => a.id === id)).filter(Boolean);

  const saveQuoteToDb = async (sentVia: string) => {
    if (!leadId || !homeSizeId) return;
    try {
      await supabase.from("sales_quotes").insert({
        lead_id: leadId,
        service_type: serviceType,
        home_size_id: homeSizeId,
        frequency,
        add_ons: addOns,
        base_price_cents: quote.basePriceCents,
        add_ons_total_cents: quote.addOnsCents,
        discount_pct: quote.discountPct,
        discount_amount_cents: quote.discountCents,
        final_price_cents: quote.finalPriceCents,
        deposit_cents: quote.depositCents,
        monthly_total_cents: quote.monthlyTotalCents,
        bedrooms: bedrooms || null,
        bathrooms: bathrooms || null,
        sent_via: sentVia,
        sent_at: new Date().toISOString(),
      } as any);
    } catch (err) {
      console.error("Failed to save quote:", err);
    }
  };

  const handleCopy = async () => {
    const text = formatQuoteText(quote, { serviceName, frequency, bedrooms, bathrooms, isNewCustomer });
    navigator.clipboard.writeText(text);
    toast.success("Quote copied to clipboard");
    await saveQuoteToDb("clipboard");
    if (leadId) {
      await supabase.from("leads").update({ status: "quoted" } as any).eq("id", leadId);
      onStatusAdvance?.("quoted");
    }
  };

  const handleEmailQuote = async () => {
    if (!leadEmail) return;
    setSendingEmail(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-sales-quote-email", {
        body: {
          email: leadEmail,
          firstName: leadFirstName || "there",
          serviceName,
          homeSizeLabel: quote.homeSizeLabel,
          frequency,
          bedrooms,
          bathrooms,
          basePriceCents: quote.basePriceCents,
          serviceTierCost: quote.serviceTierCost,
          addOnsCents: quote.addOnsCents,
          discountPct: quote.discountPct,
          discountCents: quote.discountCents,
          finalPriceCents: quote.finalPriceCents,
          depositCents: quote.depositCents,
          balanceDueCents: quote.balanceDueCents,
          monthlyTotalCents: quote.monthlyTotalCents,
          isNewCustomer,
          addOns: selectedAddOns.map((a) => a!.name),
        },
      });

      if (error) throw error;
      toast.success(`Quote emailed to ${leadEmail}`);
      await saveQuoteToDb("email");
      if (leadId) {
        await supabase.from("leads").update({ status: "quoted" } as any).eq("id", leadId);
        onStatusAdvance?.("quoted");
      }

      if (leadId) {
        await supabase.from("lead_activity_log").insert({
          lead_id: leadId,
          action: "quote_emailed",
          notes: `Quote for ${formatCents(quote.finalPriceCents)}/clean emailed to ${leadEmail}`,
        } as any);
      }
    } catch (err: any) {
      toast.error("Failed to send quote: " + err.message);
    } finally {
      setSendingEmail(false);
    }
  };

  if (!homeSizeId) {
    return (
      <div className="p-6 text-center text-gray-400">
        <Calculator className="w-10 h-10 mx-auto mb-3 opacity-50" />
        <p className="text-sm">Select a home size to see pricing</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          <Calculator className="w-4 h-4 text-emerald-600" />
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
        <div className="flex justify-between text-gray-600">
          <span>{serviceName}</span>
          <span>{formatCents(quote.basePriceCents)}</span>
        </div>
        {quote.homeSizeLabel && (
          <div className="text-xs text-gray-400">{quote.homeSizeLabel} • ~{quote.estimatedHours}hrs</div>
        )}

        {quote.serviceTierCost > 0 && (
          <div className="flex justify-between text-gray-500">
            <span>Service upgrade</span>
            <span>+{formatCents(quote.serviceTierCost)}</span>
          </div>
        )}

        {selectedAddOns.length > 0 && (
          <>
            <Separator className="bg-gray-200" />
            {selectedAddOns.map((addon) => (
              <div key={addon!.id} className="flex justify-between text-gray-500 text-xs">
                <span>{addon!.name}</span>
                <span>+${addon!.price}</span>
              </div>
            ))}
          </>
        )}

      {(quote.discountCents > 0 || customDiscount > 0) && (
          <>
            <Separator className="bg-gray-200" />
            {quote.discountCents > 0 && (
              <div className="flex justify-between text-emerald-400">
                <span>{frequency} discount</span>
                <span>-{formatCents(quote.discountCents)}</span>
              </div>
            )}
            {customDiscount > 0 && (
              <div className="flex justify-between text-emerald-400">
                <span>Custom discount</span>
                <span>-${customDiscount.toFixed(2)}</span>
              </div>
            )}
          </>
        )}
      </div>

      <Separator className="bg-gray-300" />

      <div className="space-y-2">
        <div className="flex justify-between text-gray-900 font-bold text-lg">
          <span>Per Clean</span>
          <span>{formatCents(quote.perCleanCents)}</span>
        </div>
        {quote.subtotalCents !== quote.finalPriceCents && (
          <div className="flex justify-between text-gray-400 text-xs">
            <span>Was</span>
            <span className="line-through">{formatCents(quote.subtotalCents)}</span>
          </div>
        )}
      </div>

      <div className="bg-gray-50 rounded-lg p-3 space-y-2 text-sm">
        <div className="flex justify-between text-emerald-600 font-semibold">
          <span>💰 Deposit Today</span>
          <span>{formatCents(quote.depositCents)}</span>
        </div>
        <div className="flex justify-between text-gray-600">
          <span>Balance After Service</span>
          <span>{formatCents(quote.balanceDueCents)}</span>
        </div>
        {frequency !== "One-Time" && (
          <div className="flex justify-between text-gray-600">
            <span>📅 Monthly Total</span>
            <span>{formatCents(quote.monthlyTotalCents)}</span>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 border-gray-300 text-gray-600 hover:bg-gray-100 hover:text-gray-900"
          onClick={handleCopy}
        >
          <Copy className="w-3 h-3 mr-1" /> Copy Quote
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1 border-gray-300 text-gray-600 hover:bg-gray-100 hover:text-gray-900"
          disabled={!leadEmail || sendingEmail}
          onClick={handleEmailQuote}
        >
          {sendingEmail ? (
            <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Sending...</>
          ) : (
            <><Mail className="w-3 h-3 mr-1" /> Email Quote</>
          )}
        </Button>
      </div>
    </div>
  );
}
