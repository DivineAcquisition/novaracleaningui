import { useState } from "react";
import { PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface StripePaymentFormProps {
  amount: number;
  onSuccess: () => void;
  onRetry?: () => void;
}

export function StripePaymentForm({ amount, onSuccess, onRetry }: StripePaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<string | null>(null);

  const getErrorMessage = (error: any): { title: string; message: string; type: string } => {
    const errorCode = error.code || error.type;
    
    switch (errorCode) {
      case 'card_declined':
        return {
          title: 'Card Declined',
          message: 'Your card was declined. Please try a different payment method or contact your bank.',
          type: 'card_declined'
        };
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
          message: 'There was a problem with the payment request. Please refresh and try again.',
          type: 'invalid_request'
        };
      default:
        return {
          title: 'Payment Failed',
          message: error.message || 'An unexpected error occurred. Please try again or use a different payment method.',
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
      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/book/success`,
        },
      });

      if (error) {
        const errorDetails = getErrorMessage(error);
        setPaymentError(errorDetails.message);
        setErrorType(errorDetails.type);
        
        toast({
          title: errorDetails.title,
          description: errorDetails.message,
          variant: "destructive",
        });
      }
    } catch (error: any) {
      const errorDetails = getErrorMessage(error);
      setPaymentError(errorDetails.message);
      setErrorType('general');
      
      toast({
        title: "Payment Error",
        description: errorDetails.message,
        variant: "destructive",
      });
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
          <AlertCircle className="h-4 w-4" />
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
                <RefreshCw className="w-4 h-4 mr-2" />
                Retry Payment
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      )}

      <div className="rounded-lg border border-border bg-card p-6">
        <PaymentElement 
          options={{
            layout: "tabs",
          }}
        />
      </div>
      
      <Button
        type="submit"
        disabled={!stripe || isProcessing}
        className="w-full h-14 text-lg font-semibold"
        size="lg"
      >
        {isProcessing ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Processing Payment...
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
