"use client";

import { useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { RiArrowRightLine, RiLoader4Line, RiLockLine, RiMailLine } from "@remixicon/react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AUTH_GRADIENT, AUTH_INPUT_CLS, GoogleIcon } from "@/components/auth/AuthScaffold";
import { createDocsBrowserClient } from "@/lib/docs/browser-client";
import { DOCS_AUTH_CALLBACK, DOCS_HOME } from "@/lib/docs/paths";

const emailSchema = z.string().email("Please enter a valid email address");
const passwordSchema = z.string().min(6, "Password must be at least 6 characters");

export function DocsSignIn() {
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const validate = () => {
    try {
      emailSchema.parse(email);
      passwordSchema.parse(password);
      return true;
    } catch (err) {
      if (err instanceof z.ZodError) toast.error(err.errors[0].message);
      return false;
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setIsLoading(true);
    const supabase = createDocsBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.message?.includes("Invalid login credentials")) {
        toast.error("Invalid email or password");
      } else {
        toast.error(error.message || "Failed to sign in");
      }
      setIsLoading(false);
      return;
    }
    // Full navigation so the server gate reads the cookies this client just set.
    window.location.assign(DOCS_HOME);
  };

  const handleGoogleSignIn = async () => {
    try {
      setIsLoading(true);
      const supabase = createDocsBrowserClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}${DOCS_AUTH_CALLBACK}`,
          queryParams: {
            access_type: "offline",
            prompt: "consent",
          },
        },
      });
      if (error) {
        toast.error("Google sign-in failed", { description: error.message });
        setIsLoading(false);
      }
    } catch (err) {
      toast.error("Google sign-in failed", {
        description: err instanceof Error ? err.message : String(err),
      });
      setIsLoading(false);
    }
  };

  return (
    <div className="mt-6 space-y-4 text-left">
      <Button
        type="button"
        variant="outline"
        className="h-11 w-full gap-2.5"
        onClick={() => void handleGoogleSignIn()}
        disabled={isLoading}
      >
        <GoogleIcon className="h-5 w-5" />
        Continue with Google
      </Button>

      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          or work email
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={(e) => void handleSignIn(e)} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="docs-email">Work email</Label>
          <div className="relative">
            <RiMailLine className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="docs-email"
              type="email"
              placeholder="you@novaracleaning.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={AUTH_INPUT_CLS}
              disabled={isLoading}
              autoComplete="email"
              required
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="docs-password">Password</Label>
          <div className="relative">
            <RiLockLine className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="docs-password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={AUTH_INPUT_CLS}
              disabled={isLoading}
              autoComplete="current-password"
              required
            />
          </div>
        </div>
        <Button
          type="submit"
          className="h-11 w-full text-white"
          style={{ background: AUTH_GRADIENT }}
          disabled={isLoading}
        >
          {isLoading ? (
            <>
              <RiLoader4Line className="h-4 w-4 animate-spin" />
              Signing in…
            </>
          ) : (
            <>
              Sign in
              <RiArrowRightLine className="h-4 w-4" />
            </>
          )}
        </Button>
      </form>
    </div>
  );
}
