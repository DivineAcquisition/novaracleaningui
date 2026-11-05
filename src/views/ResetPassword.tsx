"use client";

import {
  RiArrowLeftLine,
  RiCheckboxCircleLine,
  RiLoader4Line
} from "@remixicon/react";
import { useState } from "react";
import Link from "next/link";
import { CustomerAuthShell, authField, authLabel, authOutline, authPrimary } from "@/components/auth/CustomerAuthShell";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

import { z } from "zod";
import { useAuth } from "@/contexts/AuthContext";
import { SEO } from "@/components/SEO";

const emailSchema = z.string().email("Please enter a valid email address");

export default function ResetPassword() {
  const { resetPassword } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [emailSent, setEmailSent] = useState(false);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      emailSchema.parse(email);
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast.error(error.errors[0].message);
        return;
      }
    }

    setIsLoading(true);
    // Routes through send-auth-email so the link arrives in our brand
    // template even if Supabase Auth's default SMTP is misconfigured.
    const { error } = await resetPassword(email);

    if (error) {
      toast.error(error.message || "Failed to send reset email");
    } else {
      setEmailSent(true);
      toast.success("Password reset link sent! Check your email.");
    }
    setIsLoading(false);
  };

  return (
    <CustomerAuthShell
      eyebrow="Account security"
      title="Reset your password."
      lead="Enter the email on your account and we will send you a link to choose a new password."
      footer={
        <p className="text-center text-[13px] text-[#5F5B6B]">
          <Link href="/auth" className="inline-flex items-center gap-1 font-medium text-[#0B0A11] underline-offset-4 hover:underline">
            <RiArrowLeftLine className="h-4 w-4" aria-hidden="true" />
            Back to sign in
          </Link>
        </p>
      }
    >
      <SEO title="Reset Password" description="Reset your Novara Cleaning account password." noindex />
      {emailSent ? (
        <div role="status">
          <p className="flex items-center gap-2 text-[22px] font-medium tracking-[-0.03em]">
            <RiCheckboxCircleLine className="h-6 w-6 text-emerald-600" aria-hidden="true" />
            Check your email.
          </p>
          <p className="mt-2 text-[14.5px] text-[#5F5B6B]">
            If <strong className="font-medium text-[#0B0A11]">{email}</strong> has an account, a reset link is on its way.
          </p>
          <Link href="/auth" className={cn(authOutline, "mt-6")}>
            Back to sign in
          </Link>
        </div>
      ) : (
        <>
          <h2 className="text-[26px] font-medium leading-tight tracking-[-0.03em]">Reset your password.</h2>
          <p className="mt-1.5 text-[14.5px] text-[#5F5B6B]">We will email you a reset link.</p>
          <form onSubmit={handleResetPassword} className="mt-6 space-y-4">
            <div>
              <label htmlFor="email" className={authLabel}>Email</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={authField}
                disabled={isLoading}
                required
              />
            </div>
            <button type="submit" className={authPrimary} disabled={isLoading}>
              {isLoading ? <RiLoader4Line className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {isLoading ? "Sending…" : "Send reset link"}
            </button>
          </form>
        </>
      )}
    </CustomerAuthShell>
  );
}
