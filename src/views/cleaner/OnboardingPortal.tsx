"use client";

import {
  RiArrowRightLine,
  RiBankCardLine,
  RiCheckboxCircleFill,
  RiLoader4Line,
  RiLockLine,
  RiLogoutBoxRLine,
  RiPhoneLine,
  RiSparklingLine,
  RiTimeLine,
} from "@remixicon/react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { SEO } from "@/components/SEO";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  resolveCleanerAuth,
  isBlockedCleanerStatus,
  BLOCKED_CLEANER_STATUSES,
} from "@/lib/cleaner-auth";
import { PhoneVerificationDialog } from "@/components/cleaner/PhoneVerificationDialog";

const logo = "/novara-logo.png";

// ─── Types ──────────────────────────────────────────────
//
// The onboarding portal now tracks a streamlined two-step checklist:
//   1. Phone number verification (via send-phone-verification + verify-phone-code)
//   2. Stripe Connect payouts setup
//
// Legacy fields (ob_agreement_signed, ob_google_chat_joined,
// ob_supplies_checklist_viewed, ob_training_accessed) stay on the
// cleaners row for back-compat but are no longer surfaced in the UI.
interface CleanerProfile {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  status: string;
  stripe_account_id: string | null;
  payouts_enabled: boolean;
  phone_verified: boolean;
  onboarding_complete: boolean;
  pay_tier?: string;
  pay_percentage?: number;
  ob_payouts_setup: boolean;
  ob_payouts_setup_at: string | null;
}

// ─── Blocked Status Screen ──────────────────────────────
function BlockedScreen({ status }: { status: string }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-destructive/5 via-background to-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full border-destructive/20 shadow-xl">
        <CardContent className="pt-8 pb-8 text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
            <RiLockLine className="w-8 h-8 text-destructive" />
          </div>
          <h1 className="text-2xl font-bold">Access Denied</h1>
          <p className="text-muted-foreground">
            {status === "suspended"
              ? "Your account has been suspended. Please contact support for more information."
              : status === "terminated" || status === "fired"
              ? "Your contractor agreement has been terminated. You no longer have access to this portal."
              : "Your account status does not allow access to the onboarding portal."}
          </p>
          <Separator />
          <p className="text-sm text-muted-foreground">
            If you believe this is an error, please contact{" "}
            <a
              href="mailto:support@novaracleaning.com"
              className="text-primary hover:underline"
            >
              support@novaracleaning.com
            </a>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────
export default function OnboardingPortal() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<CleanerProfile | null>(null);
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockedStatus, setBlockedStatus] = useState("");
  const [phoneDialogOpen, setPhoneDialogOpen] = useState(false);
  const [stripeLoading, setStripeLoading] = useState(false);

  useEffect(() => {
    void checkAuthAndLoad();
  }, []);

  const checkAuthAndLoad = async () => {
    try {
      const { cleaner: resolved, routing } = await resolveCleanerAuth();
      if (routing === "auth") {
        toast.error("Please sign in to access the onboarding portal");
        router.replace("/cleaner/auth");
        return;
      }
      if (!resolved) {
        toast.info("Please complete your profile first");
        router.replace("/cleaner/onboarding");
        return;
      }
      if (isBlockedCleanerStatus(resolved.status)) {
        setIsBlocked(true);
        setBlockedStatus(resolved.status || "blocked");
        setLoading(false);
        return;
      }
      const { data: cleaner, error } = await supabase
        .from("cleaners")
        .select("*")
        .eq("id", resolved.id)
        .maybeSingle();
      if (error) throw error;
      if (!cleaner) {
        toast.info("Please complete your profile first");
        router.replace("/cleaner/onboarding");
        return;
      }
      setProfile(cleaner as unknown as CleanerProfile);
    } catch (err) {
      console.error("[OnboardingPortal] auth/load error:", err);
      toast.error("Failed to load your profile");
      router.replace("/cleaner/auth");
    } finally {
      setLoading(false);
    }
  };

  // Re-pull the cleaner row after a step finishes so the local UI
  // reflects the new flag (phone_verified / stripe_account_id) without
  // a hard reload.
  const refreshProfile = async () => {
    if (!profile) return;
    const { data } = await supabase
      .from("cleaners")
      .select("*")
      .eq("id", profile.id)
      .maybeSingle();
    if (data) setProfile(data as unknown as CleanerProfile);
  };

  const handlePhoneVerifySuccess = async () => {
    setPhoneDialogOpen(false);
    toast.success("Phone verified!");
    // verify-phone-code flips phone_verified server-side. Mirror that
    // locally + fire-and-forget GHL sync so the contractor's tags pick
    // up phone-verified.
    await supabase
      .from("cleaners")
      .update({ phone_verified: true })
      .eq("id", profile!.id);
    supabase.functions.invoke("sync-cleaner-to-ghl", {
      body: { cleanerId: profile!.id },
    }).catch(() => {/* non-blocking */});
    await refreshProfile();
  };

  const handleSetupPayouts = async () => {
    if (!profile) return;
    setStripeLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "initiate-cleaner-stripe-connect",
      );
      if (error) throw error;
      if (data?.url) {
        // Mark step "started" so the dashboard reflects intent even if
        // the cleaner bounces from the Stripe hosted onboarding before
        // finishing. payouts_enabled is the source of truth for pay
        // eligibility — set by stripe-webhook account.updated.
        await supabase
          .from("cleaners")
          .update({
            ob_payouts_setup: true,
            ob_payouts_setup_at: new Date().toISOString(),
          })
          .eq("id", profile.id);
        window.location.href = data.url;
      } else {
        toast.error("Could not start Stripe onboarding. Please try again.");
      }
    } catch (err) {
      console.error("[OnboardingPortal] stripe setup error:", err);
      toast.error("Failed to set up payouts. Please try again.");
    } finally {
      setStripeLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/cleaner/auth");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/10 flex items-center justify-center">
        <div className="text-center space-y-4">
          <RiLoader4Line className="w-10 h-10 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground text-sm">
            Verifying access...
          </p>
        </div>
      </div>
    );
  }

  if (isBlocked) {
    return <BlockedScreen status={blockedStatus} />;
  }

  if (!profile) return null;

  // ─── Step state derived from profile ─────────────────────
  const phoneStepDone = !!profile.phone_verified;
  // Stripe step is "done" once the cleaner has a Connect account AND
  // payouts are enabled. ob_payouts_setup just records that they
  // started the flow.
  const stripeStepDone = !!profile.stripe_account_id && !!profile.payouts_enabled;
  const stripeStepStarted = !!profile.stripe_account_id || !!profile.ob_payouts_setup;

  const completed = [phoneStepDone, stripeStepDone].filter(Boolean).length;
  const total = 2;
  const allComplete = completed === total;
  const progressPercent = (completed / total) * 100;

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/10">
      <SEO title="Onboarding Portal" noindex />

      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/40">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src={logo} alt="Novara" className="h-7 w-auto" />
            <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
              Onboarding
            </Badge>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSignOut}
            className="text-muted-foreground"
          >
            <RiLogoutBoxRLine className="w-4 h-4 mr-1.5" />
            Sign out
          </Button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 sm:py-10 space-y-6">
        {/* Welcome card */}
        <Card className="border-primary/20 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <RiSparklingLine className="w-6 h-6 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <CardTitle className="text-xl font-jakarta tracking-tight">
                  Welcome, {profile.first_name}!
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Two quick steps to start receiving job offers and getting
                  paid. Cleaners are paid 1–2 business days after each
                  completed clean.
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between text-xs font-medium mb-2">
              <span className="text-muted-foreground">
                {completed} of {total} complete
              </span>
              {allComplete ? (
                <span className="text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1">
                  <RiCheckboxCircleFill className="w-3.5 h-3.5" /> All set!
                </span>
              ) : (
                <span className="text-muted-foreground">
                  {Math.round(progressPercent)}%
                </span>
              )}
            </div>
            <Progress value={progressPercent} className="h-2" />
          </CardContent>
        </Card>

        {/* Step 1 — Phone verification */}
        <StepCard
          number={1}
          title="Verify your phone number"
          description="We'll text you a 6-digit code so dispatch can reach you for job offers."
          icon={RiPhoneLine}
          done={phoneStepDone}
          started={false}
        >
          {phoneStepDone ? (
            <p className="text-sm text-muted-foreground">
              Verified ·{" "}
              <span className="font-medium text-foreground">
                {profile.phone || "(no phone on file)"}
              </span>
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Phone on file:{" "}
                <span className="font-medium text-foreground">
                  {profile.phone || "—"}
                </span>
                {!profile.phone && (
                  <>
                    {" "}—{" "}
                    <a
                      href="/cleaner/profile"
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      add a phone number first
                    </a>
                  </>
                )}
              </p>
              <Button
                size="lg"
                onClick={() => setPhoneDialogOpen(true)}
                disabled={!profile.phone}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                <RiPhoneLine className="w-4 h-4 mr-1.5" />
                Send verification code
                <RiArrowRightLine className="w-4 h-4 ml-1.5" />
              </Button>
            </>
          )}
        </StepCard>

        {/* Step 2 — Stripe Connect */}
        <StepCard
          number={2}
          title="Connect your bank for payouts"
          description="Link your bank account through Stripe so we can deposit your earnings."
          icon={RiBankCardLine}
          done={stripeStepDone}
          started={stripeStepStarted && !stripeStepDone}
          locked={!phoneStepDone}
        >
          {stripeStepDone ? (
            <p className="text-sm text-muted-foreground">
              Stripe Connect linked · payouts enabled.{" "}
              <button
                onClick={handleSetupPayouts}
                className="text-primary underline-offset-2 hover:underline"
              >
                Update bank info
              </button>
            </p>
          ) : !phoneStepDone ? (
            <p className="text-sm text-muted-foreground inline-flex items-center gap-1.5">
              <RiLockLine className="w-3.5 h-3.5" />
              Verify your phone first to unlock payouts.
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Stripe collects the bank info + tax identity (W-9) needed for
                1099 reporting. You'll be redirected to a hosted Stripe page —
                we never see your account number.
              </p>
              <div className="flex flex-col sm:flex-row gap-2.5 sm:items-center">
                <Button
                  size="lg"
                  onClick={handleSetupPayouts}
                  disabled={stripeLoading}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  {stripeLoading ? (
                    <>
                      <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" />
                      Opening Stripe…
                    </>
                  ) : (
                    <>
                      <RiBankCardLine className="w-4 h-4 mr-1.5" />
                      {stripeStepStarted ? "Resume Stripe setup" : "Set up payouts"}
                      <RiArrowRightLine className="w-4 h-4 ml-1.5" />
                    </>
                  )}
                </Button>
                <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                  <RiTimeLine className="w-3.5 h-3.5" />
                  Payouts arrive 1–2 business days after each completed clean
                </span>
              </div>
            </>
          )}
        </StepCard>

        {/* Done banner */}
        {allComplete && (
          <Card className="border-emerald-300 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/20 shadow-sm">
            <CardContent className="pt-5 pb-5 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center mx-auto">
                <RiCheckboxCircleFill className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
              </div>
              <h2 className="text-lg font-bold font-jakarta">
                You're all set, {profile.first_name}!
              </h2>
              <p className="text-sm text-muted-foreground">
                Job offers will start coming through SMS and your dashboard.
                Earnings deposit 1–2 business days after each completed clean.
              </p>
              <Button
                onClick={() => router.push("/cleaner/dashboard")}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                Go to dashboard
                <RiArrowRightLine className="w-4 h-4 ml-1.5" />
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Pay model footer hint — kept since revenue share is core to
            the offer; helps a brand-new contractor know what they signed
            up for. */}
        <p className="text-center text-xs text-muted-foreground">
          You earn{" "}
          <span className="font-semibold text-foreground">
            {profile.pay_percentage ?? 35}%
          </span>{" "}
          of every job's revenue ({profile.pay_tier || "foundation"} tier).
          Move to Proven (40%) and Elite (45%) as you complete more jobs.
        </p>
      </main>

      <PhoneVerificationDialog
        open={phoneDialogOpen}
        onOpenChange={setPhoneDialogOpen}
        phone={profile.phone || ""}
        onSuccess={handlePhoneVerifySuccess}
      />
    </div>
  );
}

// ─── Step card ──────────────────────────────────────────
function StepCard({
  number,
  title,
  description,
  icon: Icon,
  done,
  started,
  locked,
  children,
}: {
  number: number;
  title: string;
  description: string;
  icon: typeof RiPhoneLine;
  done: boolean;
  started: boolean;
  locked?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card
      className={cn(
        "shadow-sm transition-all",
        done
          ? "border-emerald-300/60 bg-emerald-50/30 dark:border-emerald-900/40 dark:bg-emerald-950/10"
          : locked
          ? "border-border/40 opacity-70"
          : "border-border/60",
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 font-bold",
              done
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                : locked
                ? "bg-muted text-muted-foreground"
                : "bg-primary/10 text-primary",
            )}
          >
            {done ? <RiCheckboxCircleFill className="w-5 h-5" /> : number}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="text-base font-jakarta">{title}</CardTitle>
              {done && (
                <Badge
                  variant="outline"
                  className="bg-emerald-100/70 text-emerald-700 border-emerald-300 text-[10px] dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
                >
                  Complete
                </Badge>
              )}
              {!done && started && (
                <Badge
                  variant="outline"
                  className="bg-amber-100/70 text-amber-700 border-amber-300 text-[10px] dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800"
                >
                  In progress
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              {description}
            </p>
          </div>
          <Icon
            className={cn(
              "w-5 h-5 shrink-0 mt-1",
              done
                ? "text-emerald-500 dark:text-emerald-400"
                : locked
                ? "text-muted-foreground"
                : "text-primary",
            )}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

// Re-export blocked-status constants so existing imports keep working.
export { BLOCKED_CLEANER_STATUSES };
