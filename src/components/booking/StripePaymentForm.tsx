"use client";

import {
  RiBankCardLine,
  RiErrorWarningLine,
  RiLoader4Line,
  RiRefreshLine
} from "@remixicon/react";
import { useState, useEffect } from "react";
import { PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface StripePaymentFormProps {
  amount: number;
  /** Called after a successful (or processing) confirm with the PaymentIntent id. */
  onSuccess: (paymentIntentId?: string) => void;
  onRetry?: () => void;
  customerEmail?: string;
  bookingId?: string | null;
  /** PaymentIntent client secret — required to confirm with a saved card. */
  clientSecret?: string;
  /** Where redirect-based methods (3DS) land afterwards. Defaults to the booking-funnel confirmation page. */
  returnUrl?: string;
}

export function StripePaymentForm({ amount, onSuccess, onRetry, customerEmail, bookingId, clientSecret, returnUrl: returnUrlProp }: StripePaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const { user } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<string | null>(null);
  const [savedPaymentMethods, setSavedPaymentMethods] = useState<any[]>([]);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>("new");
  const [loadingPaymentMethods, setLoadingPaymentMethods] = useState(false);
  const [saveForFuture, setSaveForFuture] = useState(true);
  const [elementReady, setElementReady] = useState(false);

  // Defer saved-card lookup so PaymentElement can mount first.
  useEffect(() => {
    if (!user || !customerEmail) return;

    const timer = window.setTimeout(async () => {
      setLoadingPaymentMethods(true);
      try {
        const { data, error } = await supabase.functions.invoke("get-saved-payment-methods", {
          body: { email: customerEmail },
        });
        if (error) throw error;
        // Only card PMs render meaningfully (brand + last4); Link/wallet
        // methods would show a blank row and can't be confirmed this way.
        const cards = (data?.paymentMethods || []).filter((pm: any) => pm?.card);
        if (cards.length > 0) {
          setSavedPaymentMethods(cards);
        }
      } catch (error: unknown) {
        console.error("Error loading payment methods:", error);
      } finally {
        setLoadingPaymentMethods(false);
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, [user, customerEmail]);

  const getErrorMessage = (error: any): { title: string; message: string; type: string } => {
    const errorCode = error?.code || error?.type;
    const declineCode = error?.decline_code;
    // Stripe's own message is usually the most specific — prefer it.
    const stripeMessage =
      typeof error?.message === "string" && error.message.trim() ? error.message : null;

    // Incomplete/invalid form input (caught by elements.submit() or confirm).
    if (error?.type === 'validation_error') {
      return {
        title: 'Check Your Card Details',
        message: stripeMessage || 'Some of your card details look incomplete or invalid. Please review them and try again.',
        type: 'validation_error'
      };
    }

    if (errorCode === 'card_declined') {
      if (declineCode === 'insufficient_funds') {
        return {
          title: 'Insufficient Funds',
          message: 'Your card has insufficient funds. Please use a different payment method.',
          type: 'insufficient_funds'
        };
      }
      if (declineCode === 'lost_card' || declineCode === 'stolen_card') {
        return {
          title: 'Card Declined',
          message: 'This card can\'t be used. Please try a different payment method.',
          type: 'card_declined'
        };
      }
      return {
        title: 'Card Declined',
        message: stripeMessage || 'Your card was declined. Please try a different payment method or contact your bank.',
        type: 'card_declined'
      };
    }

    switch (errorCode) {
      case 'insufficient_funds':
        return {
          title: 'Insufficient Funds',
          message: 'Your card has insufficient funds. Please use a different payment method.',
          type: 'insufficient_funds'
        };
      case 'expired_card':
        return {
          title: 'Card Expired',
          message: 'Your card has expired. Please use a different payment method.',
          type: 'expired_card'
        };
      case 'incorrect_cvc':
        return {
          title: 'Incorrect CVC',
          message: 'The CVC code is incorrect. Please check and try again.',
          type: 'incorrect_cvc'
        };
      case 'processing_error':
        return {
          title: 'Processing Error',
          message: 'An error occurred while processing your card. Please try again.',
          type: 'processing_error'
        };
      case 'invalid_request_error':
        return {
          title: 'Invalid Request',
          message: stripeMessage || 'There was a problem with the payment request. Please refresh and try again.',
          type: 'invalid_request'
        };
      default:
        return {
          title: 'Payment Failed',
          message: stripeMessage || 'An unexpected error occurred. Please try again or use a different payment method.',
          type: 'general'
        };
    }
  };

  const showError = (error: any) => {
    const errorDetails = getErrorMessage(error);
    setPaymentError(errorDetails.message);
    setErrorType(errorDetails.type);
    toast({
      title: errorDetails.title,
      description: errorDetails.message,
      variant: "destructive",
    });
  };

  // Shared post-confirm handling: every outcome surfaces something —
  // success, processing, or an explicit error. Never a silent dead end.
  const handleConfirmResult = (error: any, paymentIntent: any) => {
    if (error) {
      showError(error);
      return;
    }
    if (paymentIntent && (paymentIntent.status === 'succeeded' || paymentIntent.status === 'requires_capture')) {
      onSuccess(paymentIntent.id);
      return;
    }
    if (paymentIntent && paymentIntent.status === 'processing') {
      // Bank is still processing — hand off to the confirmation page,
      // which verifies the PaymentIntent server-side.
      toast({
        title: "Payment Processing",
        description: "Your payment is being processed — we'll confirm it on the next page.",
      });
      onSuccess(paymentIntent.id);
      return;
    }
    // No redirect happened, no error object, but the payment didn't
    // complete (e.g. abandoned wallet sheet). Tell the customer.
    showError({
      message: 'Your payment didn\'t complete. Please try again or use a different payment method.',
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      // Never fail silently — tell the customer the form isn't ready yet.
      toast({
        title: "Payment Form Loading",
        description: "The secure payment form is still loading. Give it a second and try again.",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    setPaymentError(null);
    setErrorType(null);

    try {
      // Build the return URL with booking_id for redirect-based payment methods (e.g. 3DS)
      const returnUrl = returnUrlProp
        ? new URL(returnUrlProp, window.location.origin)
        : new URL(`${window.location.origin}/book/confirmation`);
      if (bookingId) {
        returnUrl.searchParams.set('booking_id', bookingId);
      }

      // Saved payment method: confirm against the client secret directly.
      // (Passing both `elements` and a `payment_method` id conflicts —
      // Stripe takes payment data from the Element and ignores/errors on
      // the saved card.)
      if (selectedPaymentMethod !== "new" && savedPaymentMethods.some(pm => pm.id === selectedPaymentMethod)) {
        if (!clientSecret) {
          setSelectedPaymentMethod("new");
          showError({
            message: 'Saved cards aren\'t available right now — please enter your card details instead.',
          });
          return;
        }
        const { error, paymentIntent } = await stripe.confirmPayment({
          clientSecret,
          confirmParams: {
            return_url: returnUrl.toString(),
            payment_method: selectedPaymentMethod,
          },
          redirect: 'if_required',
        });
        handleConfirmResult(error, paymentIntent);
        return;
      }

      // New payment method: validate the Payment Element FIRST so
      // incomplete card details surface a visible error instead of a
      // silent no-op (customers "trying 4 cards" with nothing reaching
      // Stripe was exactly this gap).
      try {
        const { error: submitError } = await elements.submit();
        if (submitError) {
          showError(submitError);
          return;
        }
      } catch {
        // elements.submit() unavailable in this mode — confirmPayment
        // performs its own validation below.
      }

      // Confirm and optionally save.
      // Use redirect: 'if_required' so cards without 3DS don't redirect.
      // Guests: the PaymentIntent's own setup_future_usage governs card
      // saving — don't send a redundant save_payment_method flag.
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: returnUrl.toString(),
          ...(user ? { save_payment_method: saveForFuture } : {}),
        },
        redirect: 'if_required',
      });
      handleConfirmResult(error, paymentIntent);
    } catch (error: any) {
      showError(error);
      setErrorType('general');
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

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Error Alert */}
      {paymentError && (
        <Alert variant="destructive" className="animate-in slide-in-from-top">
          <RiErrorWarningLine className="h-4 w-4" />
          <AlertTitle>Payment Failed</AlertTitle>
          <AlertDescription className="mt-2 space-y-3">
            <p>{paymentError}</p>
            {errorType === 'card_declined' || errorType === 'insufficient_funds' ? (
              <div className="space-y-2 text-sm">
                <p className="font-medium">Try these solutions:</p>
                <ul className="list-disc list-inside space-y-1 pl-2">
                  <li>Use a different credit or debit card</li>
                  <li>Contact your bank to authorize the payment</li>
                  <li>Check that your card details are correct</li>
                </ul>
              </div>
            ) : errorType === 'processing_error' || errorType === 'invalid_request' ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleRetry}
                className="mt-2"
              >
                <RiRefreshLine className="w-4 h-4 mr-2" />
                Retry Payment
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      )}

      {/* Saved Payment Methods for Returning Customers */}
      {savedPaymentMethods.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <h4 className="font-semibold mb-4 flex items-center gap-2">
              <RiBankCardLine className="w-5 h-5" />
              Select Payment Method
            </h4>
            <RadioGroup value={selectedPaymentMethod} onValueChange={setSelectedPaymentMethod}>
              {savedPaymentMethods.map((pm) => (
                <div key={pm.id} className="flex items-center space-x-2 p-3 border rounded-lg hover:bg-accent/50 transition-colors">
                  <RadioGroupItem value={pm.id} id={pm.id} />
                  <Label htmlFor={pm.id} className="flex-1 cursor-pointer">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">
                        {pm.card?.brand?.toUpperCase()} •••• {pm.card?.last4}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        Exp {pm.card?.exp_month}/{pm.card?.exp_year}
                      </span>
                    </div>
                  </Label>
                </div>
              ))}
              <div className="flex items-center space-x-2 p-3 border rounded-lg hover:bg-accent/50 transition-colors">
                <RadioGroupItem value="new" id="new" />
                <Label htmlFor="new" className="flex-1 cursor-pointer">
                  <span className="font-medium">Use a new payment method</span>
                </Label>
              </div>
            </RadioGroup>
          </CardContent>
        </Card>
      )}

      {/* Show Payment Element only for new payment method */}
      {selectedPaymentMethod === "new" && (
        <>
          <div className="rounded-lg border border-border bg-card p-6">
            <PaymentElement 
              options={{
                layout: "tabs",
                ...(customerEmail
                  ? { defaultValues: { billingDetails: { email: customerEmail } } }
                  : {}),
              }}
              onReady={() => setElementReady(true)}
            />
          </div>
          
          {user && (
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="save-payment"
                checked={saveForFuture}
                onChange={(e) => setSaveForFuture(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              <Label htmlFor="save-payment" className="text-sm cursor-pointer">
                Save payment method for future bookings
              </Label>
            </div>
          )}
        </>
      )}
      
      <Button
        type="submit"
        disabled={!stripe || !elements || isProcessing || (selectedPaymentMethod === "new" && !elementReady)}
        className="w-full h-14 text-lg font-semibold"
        size="lg"
      >
        {isProcessing ? (
          <>
            <RiLoader4Line className="mr-2 h-5 w-5 animate-spin" />
            Processing Payment...
          </>
        ) : selectedPaymentMethod === "new" && !elementReady ? (
          <>
            <RiLoader4Line className="mr-2 h-5 w-5 animate-spin" />
            Loading Secure Form...
          </>
        ) : (
          `Pay $${(amount / 100).toFixed(2)}`
        )}
      </Button>
      
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground text-center">
          🔒 Secure payment powered by Stripe
        </p>
        {paymentError && (
          <p className="text-xs text-center text-muted-foreground">
            Having trouble? Contact us at support@novaracleaning.com
          </p>
        )}
      </div>
    </form>
  );
}
