/**
 * PayoutForm - Form component for sending payouts to cleaners
 * 
 * Features:
 * - Amount input with dollar formatting
 * - Optional booking reference
 * - Description field
 * - Validation and error handling
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Loader2, 
  DollarSign, 
  CheckCircle2,
  AlertCircle,
  Send
} from 'lucide-react';
import { useStripeConnect } from '@/hooks/useStripeConnect';
import { cn } from '@/lib/utils';

interface PayoutFormProps {
  cleanerId: string;
  cleanerName?: string;
  bookingId?: string;
  suggestedAmount?: number; // In cents
  onSuccess?: (result: { payout_id: string; transfer_id: string; amount: number }) => void;
  onCancel?: () => void;
  className?: string;
}

export function PayoutForm({
  cleanerId,
  cleanerName,
  bookingId,
  suggestedAmount,
  onSuccess,
  onCancel,
  className,
}: PayoutFormProps) {
  const { processPayout, formatAmount, parseToCents, isLoading } = useStripeConnect();
  
  const [amount, setAmount] = useState(
    suggestedAmount ? (suggestedAmount / 100).toFixed(2) : ''
  );
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    payout_id: string;
    transfer_id: string;
    amount: number;
  } | null>(null);

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value;
    
    // Remove non-numeric characters except decimal
    value = value.replace(/[^0-9.]/g, '');
    
    // Ensure only one decimal point
    const parts = value.split('.');
    if (parts.length > 2) {
      value = parts[0] + '.' + parts.slice(1).join('');
    }
    
    // Limit to 2 decimal places
    if (parts[1]?.length > 2) {
      value = parts[0] + '.' + parts[1].slice(0, 2);
    }
    
    setAmount(value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate amount
    const amountFloat = parseFloat(amount);
    if (isNaN(amountFloat) || amountFloat <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    if (amountFloat < 1) {
      setError('Minimum payout is $1.00');
      return;
    }

    if (amountFloat > 10000) {
      setError('Maximum single payout is $10,000');
      return;
    }

    const amountCents = parseToCents(amount);

    const result = await processPayout(cleanerId, amountCents, {
      booking_id: bookingId,
      description: description || undefined,
    });

    if (result.success) {
      setSuccess({
        payout_id: result.payout_id!,
        transfer_id: result.transfer_id!,
        amount: result.amount!,
      });
      onSuccess?.({
        payout_id: result.payout_id!,
        transfer_id: result.transfer_id!,
        amount: result.amount!,
      });
    } else {
      // Map error codes to user-friendly messages
      let errorMessage = result.error || 'Failed to process payout';
      
      switch (result.code) {
        case 'NO_STRIPE_ACCOUNT':
          errorMessage = 'This cleaner has not set up their payment account yet.';
          break;
        case 'PAYOUTS_NOT_ENABLED':
          errorMessage = 'This cleaner needs to complete their payment account setup.';
          break;
        case 'DUPLICATE_PAYOUT':
          errorMessage = 'A payout for this booking has already been sent.';
          break;
        case 'INSUFFICIENT_FUNDS':
          errorMessage = 'Insufficient funds in platform account. Please add funds first.';
          break;
      }
      
      setError(errorMessage);
    }
  };

  // Success state
  if (success) {
    return (
      <div className={cn('space-y-4', className)}>
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mb-4">
            <CheckCircle2 className="w-6 h-6 text-green-600" />
          </div>
          <h3 className="text-lg font-semibold">Payout Sent!</h3>
          <p className="text-muted-foreground mb-2">
            {formatAmount(success.amount)} has been sent to {cleanerName || 'the cleaner'}
          </p>
          <code className="text-xs bg-muted px-2 py-1 rounded">
            Transfer: {success.transfer_id}
          </code>
        </div>
        <Button onClick={onCancel} className="w-full">
          Done
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className={cn('space-y-4', className)}>
      {/* Amount Field */}
      <div className="space-y-2">
        <Label htmlFor="amount">Amount</Label>
        <div className="relative">
          <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            id="amount"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={handleAmountChange}
            className="pl-10 text-lg font-medium"
            disabled={isLoading}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Minimum: $1.00 • Maximum: $10,000
        </p>
      </div>

      {/* Booking Reference (Optional) */}
      {bookingId && (
        <div className="space-y-2">
          <Label>Booking Reference</Label>
          <div className="text-sm bg-muted px-3 py-2 rounded-md">
            <code>{bookingId.slice(0, 8)}...</code>
          </div>
        </div>
      )}

      {/* Description Field */}
      <div className="space-y-2">
        <Label htmlFor="description">Description (Optional)</Label>
        <Textarea
          id="description"
          placeholder="e.g., Payout for cleaning job on Jan 19"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={isLoading}
          rows={2}
        />
      </div>

      {/* Error Alert */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="w-4 h-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Preview */}
      {amount && parseFloat(amount) > 0 && (
        <div className="bg-muted/50 border rounded-lg p-4">
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Sending to:</span>
            <span className="font-medium">{cleanerName || 'Cleaner'}</span>
          </div>
          <div className="flex justify-between items-center mt-2">
            <span className="text-sm text-muted-foreground">Amount:</span>
            <span className="text-lg font-bold text-green-600">
              ${parseFloat(amount).toFixed(2)}
            </span>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        {onCancel && (
          <Button 
            type="button" 
            variant="outline" 
            onClick={onCancel}
            disabled={isLoading}
            className="flex-1"
          >
            Cancel
          </Button>
        )}
        <Button 
          type="submit" 
          disabled={isLoading || !amount || parseFloat(amount) < 1}
          className={cn(
            'flex-1 bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] hover:opacity-90',
            onCancel ? '' : 'w-full'
          )}
        >
          {isLoading ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Send className="w-4 h-4 mr-2" />
          )}
          Send Payout
        </Button>
      </div>
    </form>
  );
}

export default PayoutForm;
