"use client";

import {
  RiStarLine
} from "@remixicon/react";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface RatingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookingId: string;
  cleanerName: string;
  onRatingSubmitted: () => void;
}

const TIP_PRESETS = [500, 1000, 2000];

export const RatingDialog = ({
  open,
  onOpenChange,
  bookingId,
  cleanerName,
  onRatingSubmitted,
}: RatingDialogProps) => {
  const [rating, setRating] = useState(0);
  const [hoveredRating, setHoveredRating] = useState(0);
  const [review, setReview] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showTip, setShowTip] = useState(false);
  const [tipCents, setTipCents] = useState<number | null>(null);
  const [customTip, setCustomTip] = useState("");
  const [tipLoading, setTipLoading] = useState(false);

  const handleSubmit = async () => {
    if (rating === 0) {
      toast.error("Please select a rating");
      return;
    }

    setIsSubmitting(true);

    try {
      const { error } = await supabase.functions.invoke("submit-rating", {
        body: {
          bookingId,
          rating,
          review: review.trim() || null,
        },
      });

      if (error) throw error;

      toast.success("Thank you for your rating!");
      onRatingSubmitted();
      // Offer a tip after the rating (100% goes to the crew).
      setShowTip(true);
    } catch (error: any) {
      console.error("Error submitting rating:", error);
      toast.error(error.message || "Failed to submit rating");
    } finally {
      setIsSubmitting(false);
    }
  };

  const startTip = async () => {
    const amount = tipCents ?? Math.round((parseFloat(customTip) || 0) * 100);
    if (!amount || amount < 100) {
      toast.error("Pick a tip amount (minimum $1).");
      return;
    }
    setTipLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("tip-cleaner", {
        body: { action: "checkout", bookingId, amountCents: amount },
      });
      if (error) throw error;
      const d = data as { ok?: boolean; url?: string; error?: string };
      if (!d?.ok || !d.url) throw new Error(d?.error || "Couldn't start the tip");
      window.location.href = d.url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start the tip");
      setTipLoading(false);
    }
  };

  const closeAll = () => {
    onOpenChange(false);
    setShowTip(false);
    setRating(0);
    setReview("");
    setTipCents(null);
    setCustomTip("");
  };

  if (showTip) {
    return (
      <Dialog open={open} onOpenChange={(o) => { if (!o) closeAll(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Leave a tip for {cleanerName}?</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              100% of your tip goes to your cleaning crew — Novara takes nothing.
              If more than one cleaner worked your home, the tip splits equally
              between them.
            </p>
            <div className="grid grid-cols-3 gap-2">
              {TIP_PRESETS.map((cents) => (
                <Button
                  key={cents}
                  type="button"
                  variant={tipCents === cents ? "default" : "outline"}
                  onClick={() => { setTipCents(cents); setCustomTip(""); }}
                >
                  ${cents / 100}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Custom: $</span>
              <input
                type="number"
                min={1}
                max={500}
                step="1"
                value={customTip}
                onChange={(e) => { setCustomTip(e.target.value); setTipCents(null); }}
                className="w-24 rounded-md border px-2 py-1.5 text-sm"
                placeholder="15"
              />
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={closeAll} disabled={tipLoading}>
                No thanks
              </Button>
              <Button className="flex-1" onClick={startTip} disabled={tipLoading}>
                {tipLoading ? "Opening checkout…" : "Tip the crew"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rate Your Cleaner</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="text-center">
            <p className="text-sm text-muted-foreground mb-4">
              How was your experience with {cleanerName}?
            </p>
            
            <div className="flex justify-center gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  className="transition-transform hover:scale-110"
                  onMouseEnter={() => setHoveredRating(star)}
                  onMouseLeave={() => setHoveredRating(0)}
                  onClick={() => setRating(star)}
                >
                  <RiStarLine
                    className={`h-8 w-8 ${
                      star <= (hoveredRating || rating)
                        ? "fill-yellow-400 text-yellow-400"
                        : "text-muted-foreground"
                    }`}
                  />
                </button>
              ))}
            </div>
            
            {rating > 0 && (
              <p className="text-sm text-muted-foreground mt-2">
                {rating === 5 && "Excellent!"}
                {rating === 4 && "Great!"}
                {rating === 3 && "Good"}
                {rating === 2 && "Fair"}
                {rating === 1 && "Poor"}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">
              Review (Optional)
            </label>
            <Textarea
              placeholder="Share your experience..."
              value={review}
              onChange={(e) => setReview(e.target.value)}
              rows={4}
              maxLength={500}
            />
            <p className="text-xs text-muted-foreground text-right">
              {review.length}/500
            </p>
          </div>

          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1"
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              className="flex-1"
              disabled={isSubmitting || rating === 0}
            >
              {isSubmitting ? "Submitting..." : "Submit Rating"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
