"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { RiLoader4Line } from "@remixicon/react";
import { z } from "zod";
import { SEO } from "@/components/SEO";
import { GoogleIcon } from "@/components/auth/AuthScaffold";
import { CustomerAuthShell, authField, authLabel, authOutline, authPrimary } from "@/components/auth/CustomerAuthShell";
import { cn } from "@/lib/utils";
import { ADMIN_AUTH_URL, isStaffCustomerEmail, looksLikeNovaraStaffEmail, STAFF_CUSTOMER_ERROR } from "@/lib/staff-customer";

const emailSchema = z.string().email("Please enter a valid email address");
const passwordSchema = z.string().min(6, "Password must be at least 6 characters");

export default function Auth() {
  const router = useRouter();
  const { user, signIn, signUp, signInWithGoogle, signOut } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");

  useEffect(() => {
    const guestEmail = localStorage.getItem('guestBookingEmail');
    if (guestEmail) {
      setEmail(guestEmail);
      localStorage.removeItem('guestBookingEmail');
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      if (await isStaffCustomerEmail(user.email)) {
        if (cancelled) return;
        toast.message("Staff accounts use the admin workspace, not the customer portal.");
        await signOut();
        window.location.assign(ADMIN_AUTH_URL);
        return;
      }
      if (!cancelled) router.replace("/account");
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, router]);

  const validateInputs = () => {
    try {
      emailSchema.parse(email);
      passwordSchema.parse(password);
      return true;
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast.error(error.errors[0].message);
      }
      return false;
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateInputs()) return;
    if (looksLikeNovaraStaffEmail(email)) {
      toast.error(STAFF_CUSTOMER_ERROR);
      window.location.assign(ADMIN_AUTH_URL);
      return;
    }

    setIsLoading(true);
    const { error } = await signIn(email, password);
    
    if (error) {
      if (error.message.includes("Invalid login credentials")) {
        toast.error("Invalid email or password");
      } else {
        toast.error(error.message || "Failed to sign in");
      }
    } else {
      toast.success("Welcome back!");
      router.push("/account");
    }
    setIsLoading(false);
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateInputs()) return;
    if (looksLikeNovaraStaffEmail(email)) {
      toast.error(STAFF_CUSTOMER_ERROR);
      window.location.assign(ADMIN_AUTH_URL);
      return;
    }

    setIsLoading(true);
    // signUp() now routes through our send-auth-email function so the
    // confirmation always arrives in the brand template. The function
    // never reveals whether the email already exists (no enumeration),
    // so the UX is a uniform "check your email" regardless.
    const { error } = await signUp(email, password);

    if (error) {
      toast.error(error.message || "Failed to sign up");
    } else {
      toast.success("Check your email — we've sent a confirmation link.");
    }
    setIsLoading(false);
  };

  const signingIn = mode === "signin";

  return (
    <CustomerAuthShell
      title="Your bookings, in one place."
      lead="Sign in to see your visits, use membership credits, and change anything about an upcoming clean."
      footer={
        <p className="text-center text-[13px] text-[#5F5B6B]">
          Cleaning with us?{" "}
          <Link href="/cleaner/auth" className="font-medium text-[#0B0A11] underline-offset-4 hover:underline">
            Cleaner sign in
          </Link>
          <span aria-hidden="true"> · </span>
          <button
            type="button"
            className="underline-offset-4 hover:text-[#0B0A11] hover:underline"
            onClick={() => window.dispatchEvent(new CustomEvent("novara:cookie-settings"))}
          >
            Cookie settings
          </button>
        </p>
      }
    >
      <SEO title="Sign In" description="Sign in to your Novara Cleaning account to manage bookings, membership credits, and upcoming cleans." />
      <h2 className="text-[26px] font-medium leading-tight tracking-[-0.03em]">{signingIn ? "Welcome back." : "Create your account."}</h2>
      <p className="mt-1.5 text-[14.5px] text-[#5F5B6B]">
        {signingIn ? "Sign in with the email you booked with." : "Use the email you booked with so your visits show up."}
      </p>

      <button type="button" className={cn(authOutline, "mt-6")} onClick={() => signInWithGoogle("/auth/callback")} disabled={isLoading}>
        <GoogleIcon className="h-5 w-5" />
        Continue with Google
      </button>

      <div className="my-5 flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-[#E9E7EE]" />
        <span className="text-[12px] text-[#5F5B6B]">or with email</span>
        <span className="h-px flex-1 bg-[#E9E7EE]" />
      </div>

      <div role="tablist" aria-label="Account" className="mb-5 grid grid-cols-2 gap-1 rounded-[10px] border border-[#E9E7EE] bg-[#F6F5F9] p-1">
        {(["signin", "signup"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={cn(
              "rounded-[7px] py-2 text-[14px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6810FE]",
              mode === m ? "bg-white text-[#0B0A11] shadow-[0_1px_3px_rgba(11,10,17,0.12)]" : "text-[#5F5B6B] hover:text-[#0B0A11]",
            )}
          >
            {m === "signin" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>

      <form onSubmit={signingIn ? handleSignIn : handleSignUp} className="space-y-4">
        <div>
          <label htmlFor="auth-email" className={authLabel}>Email</label>
          <input
            id="auth-email"
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
        <div>
          <div className="flex items-center justify-between">
            <label htmlFor="auth-password" className={authLabel}>Password</label>
            {signingIn ? (
              <Link href="/reset-password" className="mb-1.5 text-[13px] font-medium text-[#5A1FD6] hover:underline">
                Forgot password?
              </Link>
            ) : null}
          </div>
          <input
            id="auth-password"
            type="password"
            autoComplete={signingIn ? "current-password" : "new-password"}
            placeholder={signingIn ? "Your password" : "At least 6 characters"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={authField}
            disabled={isLoading}
            required
          />
        </div>
        <button type="submit" className={authPrimary} disabled={isLoading}>
          {isLoading ? <RiLoader4Line className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {isLoading ? (signingIn ? "Signing in…" : "Creating account…") : signingIn ? "Sign in" : "Create account"}
        </button>
      </form>
    </CustomerAuthShell>
  );
}
