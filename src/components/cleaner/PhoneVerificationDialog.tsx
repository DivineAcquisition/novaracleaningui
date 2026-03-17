"use client";

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
import { RiLoader4Line, RiPhoneLine, RiShieldCheckLine } from "@remixicon/react";
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
    if (cleaned.length >= 4) {
      return `(***) ***-${cleaned.slice(-4)}`;
    }
    return phone;
  };

  const sendCode = async () => {
    if (!phone || phone.replace(/\D/g, "").length < 10) {
      toast.error("Please enter a valid phone number first");
      return;
    }

    setIsSending(true);
    try {
      const response = await supabase.functions.invoke("send-phone-verification", {
        body: { phone },
      });

      if (response.error) {
        const msg = typeof response.error === "object" && "message" in response.error
          ? (response.error as any).message
          : String(response.error);
        throw new Error(msg);
      }

      if (response.data?.error) {
        throw new Error(response.data.error);
      }

      toast.success("Verification code sent via SMS!");
      setCodeSent(true);
      setCountdown(60);

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
      toast.error(error?.message || "Failed to send code. Please try again.");
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
      const response = await supabase.functions.invoke("verify-phone-code", {
        body: { code, phone },
      });

      if (response.error) {
        const msg = typeof response.error === "object" && "message" in response.error
          ? (response.error as any).message
          : String(response.error);
        throw new Error(msg);
      }

      if (response.data?.error) {
        throw new Error(response.data.error);
      }

      toast.success("Phone verified successfully!");
      onSuccess();
      onOpenChange(false);
      setCode("");
      setCodeSent(false);
    } catch (error: any) {
      toast.error(error?.message || "Invalid code. Please try again.");
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="mx-auto w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-2">
            {codeSent ? (
              <RiShieldCheckLine className="w-6 h-6 text-primary" />
            ) : (
              <RiPhoneLine className="w-6 h-6 text-primary" />
            )}
          </div>
          <DialogTitle className="text-center">Verify Phone Number</DialogTitle>
          <DialogDescription className="text-center">
            {codeSent
              ? `Enter the 6-digit code sent to ${maskPhone(phone)}`
              : `We'll send a verification code to ${maskPhone(phone)}`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {!codeSent ? (
            <Button
              onClick={sendCode}
              disabled={isSending}
              className="w-full h-11"
            >
              {isSending ? (
                <>
                  <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" />
                  Sending code...
                </>
              ) : (
                "Send Verification Code"
              )}
            </Button>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="code" className="text-sm font-medium">
                  Verification Code
                </Label>
                <Input
                  id="code"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                  className="text-center text-2xl tracking-[0.3em] h-12 font-mono"
                  autoFocus
                />
              </div>

              <Button
                onClick={verifyCode}
                disabled={isVerifying || code.length !== 6}
                className="w-full h-11"
              >
                {isVerifying ? (
                  <>
                    <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  "Verify Code"
                )}
              </Button>

              <Button
                variant="ghost"
                onClick={sendCode}
                disabled={countdown > 0 || isSending}
                className="w-full text-sm"
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
