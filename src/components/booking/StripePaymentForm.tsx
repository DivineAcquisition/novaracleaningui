import { useState, useEffect } from "react";
import { PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, AlertCircle, RefreshCw, CreditCard, Lock, Check, ChevronRight } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

interface StripePaymentFormProps {
  amount: number;
  onSuccess: () => void;
  onRetry?: () => void;
  customerEmail?: string;
}

export function StripePaymentForm({ amount, onSuccess, onRetry, customerEmail }: StripePaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const { user } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<string | null>(null);
  const [savedPaymentMethods, setSavedPaymentMethods] = useState<any[]>([]);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>("new");
  const [loadingPaymentMethods, setLoadingPaymentMethods] = useState(false);
  const [saveForFuture, setSaveForFuture] = useState(true);
  const [isReady, setIsReady] = useState(false);

  // Load saved payment methods for returning customers
  useEffect(() => {
    const loadPaymentMethods = async () => {
      if (!user || !customerEmail) return;
      
      setLoadingPaymentMethods(true);
      try {
        const { data, error } = await supabase.functions.invoke("get-saved-payment-methods", {
          body: { email: customerEmail }
        });

        if (error) throw error;
        
        if (data && data.paymentMethods && data.paymentMethods.length > 0) {
          setSavedPaymentMethods(data.paymentMethods);
          // Auto-select the first saved method
          setSelectedPaymentMethod(data.paymentMethods[0].id);
        }
      } catch (error: any) {
        console.error("Error loading payment methods:", error);
      } finally {
        setLoadingPaymentMethods(false);
      }
    };

    loadPaymentMethods();
  }, [user, customerEmail]);

  const getErrorMessage = (error: any): { title: string; message: string; type: string } => {
    const errorCode = error.code || error.type;
    
    switch (errorCode) {
      case 'card_declined':
        return {
          title: 'Card Declined',
          message: 'Your card was declined. Please try a different card or contact your bank.',
          type: 'card_declined'
        };
      case 'insufficient_funds':
        return {
          title: 'Insufficient Funds',
          message: 'Your card has insufficient funds. Please use a different card.',
          type: 'insufficient_funds'
        };
      case 'expired_card':
        return {
          title: 'Card Expired',
          message: 'Your card has expired. Please use a different card.',
          type: 'expired_card'
        };
      case 'incorrect_cvc':
        return {
          title: 'Incorrect CVC',
          message: 'The security code is incorrect. Please check and try again.',
          type: 'incorrect_cvc'
        };
      case 'processing_error':
        return {
          title: 'Processing Error',
          message: 'An error occurred while processing. Please try again.',
          type: 'processing_error'
        };
      default:
        return {
          title: 'Payment Failed',
          message: error.message || 'Something went wrong. Please try again.',
          type: 'general'
        };
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setIsProcessing(true);
    setPaymentError(null);
    setErrorType(null);

    try {
      // If using saved payment method
      if (selectedPaymentMethod !== "new" && savedPaymentMethods.length > 0) {
        const paymentMethod = savedPaymentMethods.find(pm => pm.id === selectedPaymentMethod);
        if (paymentMethod) {
          const { error } = await stripe.confirmPayment({
            elements,
            confirmParams: {
              return_url: `${window.location.origin}/book/success`,
              payment_method: selectedPaymentMethod,
            },
          });

          if (error) {
            const errorDetails = getErrorMessage(error);
            setPaymentError(errorDetails.message);
            setErrorType(errorDetails.type);
            toast.error(errorDetails.title);
          }
          return;
        }
      }

      // New payment method
      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/book/success`,
          save_payment_method: saveForFuture,
        },
      });

      if (error) {
        const errorDetails = getErrorMessage(error);
        setPaymentError(errorDetails.message);
        setErrorType(errorDetails.type);
        toast.error(errorDetails.title);
      }
    } catch (error: any) {
      const errorDetails = getErrorMessage(error);
      setPaymentError(errorDetails.message);
      setErrorType('general');
      toast.error("Payment Error");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRetry = () => {
    setPaymentError(null);
    setErrorType(null);
    if (onRetry) {
      onRetry();
    }
  };

  const getCardBrandIcon = (brand: string) => {
    // Return brand-specific styling
    const brandColors: Record<string, string> = {
      visa: "bg-blue-600",
      mastercard: "bg-red-500",
      amex: "bg-blue-400",
      discover: "bg-orange-500",
    };
    return brandColors[brand?.toLowerCase()] || "bg-gray-500";
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Error Alert */}
      {paymentError && (
        <Alert variant="destructive" className="border-red-200 bg-red-50">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle className="font-semibold">Payment Failed</AlertTitle>
          <AlertDescription className="mt-2">
            <p className="mb-3">{paymentError}</p>
            {(errorType === 'card_declined' || errorType === 'insufficient_funds') && (
              <div className="text-sm space-y-1 mb-3">
                <p className="font-medium">Try these:</p>
                <ul className="list-disc list-inside pl-1 space-y-0.5 text-red-700">
                  <li>Use a different card</li>
                  <li>Contact your bank</li>
                  <li>Check card details</li>
                </ul>
              </div>
            )}
            {(errorType === 'processing_error' || errorType === 'general') && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleRetry}
                className="bg-white"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Try Again
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Saved Payment Methods */}
      {savedPaymentMethods.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-muted-foreground">Saved Cards</p>
          <RadioGroup value={selectedPaymentMethod} onValueChange={setSelectedPaymentMethod} className="space-y-2">
            {savedPaymentMethods.map((pm) => (
              <label
                key={pm.id}
                className={cn(
                  "flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all",
                  selectedPaymentMethod === pm.id 
                    ? "border-[#5500FF] bg-[#5500FF]/5" 
                    : "border-border hover:border-[#5500FF]/50"
                )}
              >
                <RadioGroupItem value={pm.id} id={pm.id} className="sr-only" />
                <div className={cn(
                  "w-10 h-7 rounded flex items-center justify-center text-white text-[10px] font-bold",
                  getCardBrandIcon(pm.card?.brand)
                )}>
                  {pm.card?.brand?.toUpperCase().slice(0, 4)}
                </div>
                <div className="flex-1">
                  <p className="font-medium">•••• •••• •••• {pm.card?.last4}</p>
                  <p className="text-xs text-muted-foreground">Expires {pm.card?.exp_month}/{pm.card?.exp_year}</p>
                </div>
                {selectedPaymentMethod === pm.id && (
                  <div className="w-6 h-6 rounded-full bg-[#5500FF] flex items-center justify-center">
                    <Check className="w-4 h-4 text-white" />
                  </div>
                )}
              </label>
            ))}
            
            {/* New Card Option */}
            <label
              className={cn(
                "flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all",
                selectedPaymentMethod === "new" 
                  ? "border-[#5500FF] bg-[#5500FF]/5" 
                  : "border-border hover:border-[#5500FF]/50"
              )}
            >
              <RadioGroupItem value="new" id="new" className="sr-only" />
              <div className="w-10 h-7 rounded bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] flex items-center justify-center">
                <CreditCard className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1">
                <p className="font-medium">Add new card</p>
                <p className="text-xs text-muted-foreground">Credit or debit card</p>
              </div>
              {selectedPaymentMethod === "new" && (
                <div className="w-6 h-6 rounded-full bg-[#5500FF] flex items-center justify-center">
                  <Check className="w-4 h-4 text-white" />
                </div>
              )}
            </label>
          </RadioGroup>
        </div>
      )}

      {/* Stripe Payment Element */}
      {selectedPaymentMethod === "new" && (
        <div className="space-y-4">
          <div className="rounded-xl border-2 border-border bg-white p-4 focus-within:border-[#5500FF]/50 transition-colors">
            <PaymentElement 
              onReady={() => setIsReady(true)}
              options={{
                layout: {
                  type: "tabs",
                  defaultCollapsed: false,
                },
                business: {
                  name: "Novara Cleaning"
                }
              }}
            />
          </div>
          
          {/* Save for future */}
          {user && (
            <label className="flex items-center gap-3 cursor-pointer group">
              <Checkbox
                id="save-payment"
                checked={saveForFuture}
                onCheckedChange={(checked) => setSaveForFuture(checked as boolean)}
                className="data-[state=checked]:bg-[#5500FF] data-[state=checked]:border-[#5500FF]"
              />
              <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">
                Save this card for faster checkout next time
              </span>
            </label>
          )}
        </div>
      )}
      
      {/* Submit Button */}
      <Button
        type="submit"
        disabled={!stripe || isProcessing || (!isReady && selectedPaymentMethod === "new")}
        className={cn(
          "w-full h-14 text-lg font-semibold rounded-xl transition-all",
          "bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] hover:opacity-90",
          "disabled:opacity-50 disabled:cursor-not-allowed"
        )}
        size="lg"
      >
        {isProcessing ? (
          <span className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            Processing...
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            Pay ${(amount / 100).toFixed(2)}
            <ChevronRight className="h-5 w-5" />
          </span>
        )}
      </Button>
      
      {/* Security Footer */}
      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Lock className="w-3.5 h-3.5" />
        <span>Payments secured by</span>
        <svg className="h-4" viewBox="0 0 60 25" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M59.64 14.28h-8.06c.19 1.93 1.6 2.55 3.2 2.55 1.64 0 2.96-.37 4.05-.95v3.32a13.13 13.13 0 01-5.11.95c-4.92 0-7.71-2.93-7.71-7.78 0-4.33 2.67-7.93 7.15-7.93 4.36 0 6.51 3.44 6.51 7.59 0 .7-.03 1.52-.03 2.25zm-8.06-2.78h4.06c0-1.52-.66-2.89-2.03-2.89s-2.03 1.37-2.03 2.89zM37.7 5.48h4.81l.66 1.71c1.32-1.41 2.96-2.22 4.92-2.22l-.66 4.48c-1.89 0-3.73.74-4.92 2.15v9.19H37.7V5.48zM27.73 20.8h4.81v-9.41c0-1.67.96-2.67 2.22-2.67.74 0 1.41.3 1.93.74l1.78-4.26A4.54 4.54 0 0035.7 4.5c-1.56 0-2.81.67-3.92 1.93l-.48-1.41h-3.55V20.8h-.02zm-8.88-5.56c0 1.04.74 1.78 2.59 2.22 1.78.41 2.29.59 2.29 1.19 0 .48-.52.89-1.41.89-1.26 0-2.96-.52-4.29-1.26l-.96 3.33c1.48.81 3.59 1.26 5.33 1.26 3.33 0 5.48-1.56 5.48-4.48 0-1.67-.89-2.81-2.96-3.33-1.59-.41-2.15-.52-2.15-1.11 0-.44.48-.81 1.37-.81 1.19 0 2.59.41 3.85 1.11l.96-3.33c-1.37-.7-2.96-1.15-4.74-1.15-3.11 0-5.37 1.67-5.37 4.48v.99h.01zM0 10.77l.03 9.24a.76.76 0 00.76.76h4.02V7.55L0 10.77zm0-5.37l4.81 2.55V4.99a.76.76 0 00-.76-.76H.76a.76.76 0 00-.76.76v.41z" fill="#635BFF"/>
        </svg>
      </div>

      {/* Help Text */}
      {paymentError && (
        <p className="text-xs text-center text-muted-foreground">
          Need help? Contact us at{" "}
          <a href="mailto:hello@novaracleaning.com" className="text-[#5500FF] hover:underline">
            hello@novaracleaning.com
          </a>
        </p>
      )}
    </form>
  );
}
