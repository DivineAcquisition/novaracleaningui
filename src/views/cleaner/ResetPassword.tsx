"use client";

import {
  RiArrowLeftLine,
  RiCheckboxCircleLine,
  RiLoader4Line,
  RiMailLine
} from "@remixicon/react";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { SEO } from "@/components/SEO";

const emailSchema = z.string().email("Please enter a valid email address");

export default function CleanerResetPassword() {
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

    // Route through send-auth-email so cleaners get a branded green
    // Novara email even if Supabase Auth's default SMTP is broken.
    // The function pins the redirectTo to contractor.novaracleaning.com.
    const { error } = await supabase.functions.invoke("send-auth-email", {
      body: { kind: "password_reset_cleaner", email },
    });

    if (error) {
      toast.error(error.message || "Failed to send reset email");
    } else {
      setEmailSent(true);
      toast.success("Password reset link sent! Check your email.");
    }

    setIsLoading(false);
  };

  return (
    <div className="min-h-screen bg-gradient-hero flex items-center justify-center px-4 py-6">
      <SEO title="Reset Password" noindex />
      <Card className="max-w-sm w-full shadow-xl border-primary/20">
        <CardHeader className="text-center space-y-1 pb-3 pt-5">
          <CardTitle className="text-2xl font-bold">Reset Password</CardTitle>
          <CardDescription className="text-sm">
            {emailSent 
              ? "Check your email for the reset link"
              : "We'll send you a reset link"
            }
          </CardDescription>
        </CardHeader>
        
        <CardContent className="px-5 pb-5">
          {emailSent ? (
            <div className="space-y-4 text-center">
              <div className="mx-auto w-12 h-12 bg-gradient-primary rounded-full flex items-center justify-center shadow-lavender">
                <RiCheckboxCircleLine className="w-6 h-6 text-white" />
              </div>
              <div className="space-y-1">
                <p className="font-medium text-sm">Email sent!</p>
                <p className="text-xs text-muted-foreground">
                  Reset link sent to <strong>{email}</strong>
                </p>
              </div>
              <Link href="/cleaner/auth">
                <Button variant="outline" className="w-full" size="sm">
                  <RiArrowLeftLine className="mr-1 w-4 h-4" />
                  Back to Sign In
                </Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={handleResetPassword} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-sm">Email</Label>
                <div className="relative">
                  <RiMailLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-9 h-10"
                    disabled={isLoading}
                    required
                  />
                </div>
              </div>

              <Button
                type="submit"
                className="w-full"
                size="lg"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <RiLoader4Line className="mr-2 w-4 h-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  "Send Reset Link"
                )}
              </Button>

              <Link href="/cleaner/auth">
                <Button variant="ghost" className="w-full" size="sm">
                  <RiArrowLeftLine className="mr-1 w-4 h-4" />
                  Back to Sign In
                </Button>
              </Link>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
