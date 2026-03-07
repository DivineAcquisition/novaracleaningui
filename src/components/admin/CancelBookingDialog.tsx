import {
  RiCloseCircleLine
} from "@remixicon/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface CancelBookingDialogProps {
  bookingId: string;
  bookingNumber: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export const CancelBookingDialog = ({
  bookingId,
  bookingNumber,
  open,
  onOpenChange,
  onSuccess,
}: CancelBookingDialogProps) => {
  const [cancelReason, setCancelReason] = useState("");
  const [refundType, setRefundType] = useState<"full" | "partial" | "none">("full");
  const [loading, setLoading] = useState(false);

  const handleCancel = async () => {
    if (!cancelReason.trim()) {
      toast.error("Please provide a cancellation reason");
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("cancel-booking", {
        body: {
          bookingId,
          cancelReason: cancelReason.trim(),
          refundType,
        },
      });

      if (error) throw error;

      toast.success("Booking cancelled successfully", {
        description: data.refundAmount ? `Refund: ${data.refundAmount}` : "No refund processed",
      });

      onOpenChange(false);
      setCancelReason("");
      setRefundType("full");
      onSuccess?.();
    } catch (error: any) {
      toast.error("Failed to cancel booking", {
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RiCloseCircleLine className="h-5 w-5 text-destructive" />
            Cancel Booking #{String(bookingNumber).padStart(5, "0")}
          </DialogTitle>
          <DialogDescription>
            This action will cancel the booking and optionally process a refund. This
            cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="refund-type">Refund Type</Label>
            <Select value={refundType} onValueChange={(value: any) => setRefundType(value)}>
              <SelectTrigger id="refund-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full">Full Refund</SelectItem>
                <SelectItem value="partial">Partial Refund (50% if within 24h)</SelectItem>
                <SelectItem value="none">No Refund</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cancel-reason">Cancellation Reason *</Label>
            <Textarea
              id="cancel-reason"
              placeholder="Enter the reason for cancellation..."
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={4}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Keep Booking
          </Button>
          <Button
            variant="destructive"
            onClick={handleCancel}
            disabled={loading}
          >
            {loading ? "Cancelling..." : "Cancel Booking"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
