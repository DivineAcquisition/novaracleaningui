import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface PhoneVerificationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  phone: string;
  onSuccess: () => void;
}

export function PhoneVerificationDialog({
  open,
  onOpenChange,
  phone,
  onSuccess,
}: PhoneVerificationDialogProps) {
  const [code, setCode] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [countdown, setCountdown] = useState(0);

  const maskPhone = (phone: string) => {
    if (!phone) return "";
    const cleaned = phone.replace(/\D/g, "");
    if (cleaned.length === 10) {
      return `(***) ***-${cleaned.slice(-4)}`;
    }
    return phone;
  };

  const sendCode = async () => {
    setIsSending(true);
    try {
      const { error } = await supabase.functions.invoke("send-phone-verification");

      if (error) throw error;

      toast.success("Verification code sent!");
      setCodeSent(true);
      setCountdown(60);

      // Countdown timer
      const interval = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(interval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (error: any) {
      toast.error(error.message || "Failed to send code");
    } finally {
      setIsSending(false);
    }
  };

  const verifyCode = async () => {
    if (code.length !== 6) {
      toast.error("Please enter a 6-digit code");
      return;
    }

    setIsVerifying(true);
    try {
      const { error } = await supabase.functions.invoke("verify-phone-code", {
        body: { code },
      });

      if (error) throw error;

      toast.success("Phone verified successfully!");
      onSuccess();
      onOpenChange(false);
      setCode("");
      setCodeSent(false);
    } catch (error: any) {
      toast.error(error.message || "Invalid code");
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Verify Phone Number</DialogTitle>
          <DialogDescription>
            We'll send a 6-digit code to {maskPhone(phone)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {!codeSent ? (
            <Button
              onClick={sendCode}
              disabled={isSending}
              className="w-full"
            >
              {isSending ? "Sending..." : "Send Verification Code"}
            </Button>
          ) : (
            <>
              <div>
                <Label htmlFor="code">Verification Code</Label>
                <Input
                  id="code"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="Enter 6-digit code"
                  className="text-center text-2xl tracking-widest"
                />
              </div>

              <Button
                onClick={verifyCode}
                disabled={isVerifying || code.length !== 6}
                className="w-full"
              >
                {isVerifying ? "Verifying..." : "Verify Code"}
              </Button>

              <Button
                variant="ghost"
                onClick={sendCode}
                disabled={countdown > 0 || isSending}
                className="w-full"
              >
                {countdown > 0
                  ? `Resend code in ${countdown}s`
                  : "Resend Code"}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
