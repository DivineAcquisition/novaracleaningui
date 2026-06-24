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
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, PauseCircle, PlayCircle, Calendar as CalendarIcon } from "lucide-react";
import { format, addDays, addMonths } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface PauseResumeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPaused: boolean;
  resumesAt?: string;
  onSuccess: () => void;
}

export function PauseResumeDialog({
  open,
  onOpenChange,
  isPaused,
  resumesAt,
  onSuccess
}: PauseResumeDialogProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [resumeDate, setResumeDate] = useState<Date>();

  const handlePause = async () => {
    setIsProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke("pause-subscription", {
        body: { resumeAt: resumeDate?.toISOString() }
      });

      if (error) throw error;

      toast.success(data.message || "Subscription paused successfully");
      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      console.error("Pause error:", error);
      toast.error(error.message || "Failed to pause subscription");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleResume = async () => {
    setIsProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke("resume-subscription");

      if (error) throw error;

      toast.success(data.message || "Subscription resumed successfully");
      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      console.error("Resume error:", error);
      toast.error(error.message || "Failed to resume subscription");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isPaused ? (
              <>
                <PlayCircle className="w-5 h-5 text-success" />
                Resume Your Subscription
              </>
            ) : (
              <>
                <PauseCircle className="w-5 h-5 text-warning" />
                Pause Your Subscription
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {isPaused ? (
              <>
                Your subscription is currently paused
                {resumesAt && (
                  <span className="block mt-1 text-foreground font-medium">
                    Scheduled to resume on {new Date(resumesAt).toLocaleDateString()}
                  </span>
                )}
              </>
            ) : (
              "Temporarily pause your membership without losing your benefits"
            )}
          </DialogDescription>
        </DialogHeader>

        {!isPaused && (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">What happens when you pause?</Label>
              <ul className="text-sm text-muted-foreground space-y-1.5">
                <li className="flex items-start gap-2">
                  <span className="text-success mt-0.5">✓</span>
                  <span>Your billing will be paused - no charges while paused</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-success mt-0.5">✓</span>
                  <span>Your unused credits will be saved for when you resume</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-success mt-0.5">✓</span>
                  <span>Your membership tier and pricing are locked in</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-success mt-0.5">✓</span>
                  <span>Resume anytime with one click</span>
                </li>
              </ul>
            </div>

            <div className="space-y-2">
              <Label htmlFor="resumeDate" className="text-sm font-medium">
                Auto-Resume Date (Optional)
              </Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !resumeDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {resumeDate ? format(resumeDate, "PPP") : "Leave paused until I resume manually"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={resumeDate}
                    onSelect={setResumeDate}
                    disabled={(date) => date < addDays(new Date(), 1) || date > addMonths(new Date(), 6)}
                    initialFocus
                  />
                  {resumeDate && (
                    <div className="p-3 border-t">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full"
                        onClick={() => setResumeDate(undefined)}
                      >
                        Clear Date
                      </Button>
                    </div>
                  )}
                </PopoverContent>
              </Popover>
              <p className="text-xs text-muted-foreground">
                {resumeDate 
                  ? `Your subscription will automatically resume on ${format(resumeDate, "MMMM d, yyyy")}`
                  : "Pause indefinitely until you choose to resume"
                }
              </p>
            </div>
          </div>
        )}

        {isPaused && (
          <div className="space-y-4 py-4">
            <div className="rounded-lg bg-muted/50 p-4 space-y-2">
              <p className="text-sm text-muted-foreground">
                Ready to continue your membership? Resume now to reactivate your benefits and billing.
              </p>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li className="flex items-center gap-2">
                  <span className="text-success">✓</span>
                  <span>Instant access to your saved credits</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-success">✓</span>
                  <span>Billing resumes at your current rate</span>
                </li>
              </ul>
            </div>
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isProcessing}
          >
            Cancel
          </Button>
          {isPaused ? (
            <Button
              onClick={handleResume}
              disabled={isProcessing}
              className="bg-success hover:bg-success/90"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Resuming...
                </>
              ) : (
                <>
                  <PlayCircle className="mr-2 h-4 w-4" />
                  Resume Subscription
                </>
              )}
            </Button>
          ) : (
            <Button
              onClick={handlePause}
              disabled={isProcessing}
              variant="outline"
              className="border-warning text-warning hover:bg-warning/10"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Pausing...
                </>
              ) : (
                <>
                  <PauseCircle className="mr-2 h-4 w-4" />
                  Pause Subscription
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
