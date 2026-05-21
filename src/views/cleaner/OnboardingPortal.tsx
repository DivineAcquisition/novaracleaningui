"use client";

import {
  RiAlertLine,
  RiArrowRightLine,
  RiArrowRightSLine,
  RiBankCardLine,
  RiChat1Line,
  RiCheckboxCircleLine,
  RiCircleLine,
  RiClipboardLine,
  RiExternalLinkLine,
  RiFileTextLine,
  RiGraduationCapLine,
  RiLoader4Line,
  RiLockLine,
  RiLogoutBoxRLine,
  RiShieldLine,
  RiSparklingLine
} from "@remixicon/react";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { SEO } from "@/components/SEO";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
const logo = "/novara-logo.png";

// ─── Types ──────────────────────────────────────────────
// Note: onboarding_complete is controlled by the main Onboarding.tsx wizard.
// This portal tracks its own completion via portal_checklist_complete.
interface CleanerProfile {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  status: string;
  stripe_account_id: string | null;
  payouts_enabled: boolean;
  onboarding_complete: boolean;
  portal_checklist_complete?: boolean;
  pay_rate_hr?: number;
  ob_agreement_signed: boolean;
  ob_agreement_signed_at: string | null;
  ob_google_chat_joined: boolean;
  ob_google_chat_joined_at: string | null;
  ob_supplies_checklist_viewed: boolean;
  ob_supplies_checklist_viewed_at: string | null;
  ob_payouts_setup: boolean;
  ob_payouts_setup_at: string | null;
  ob_training_accessed: boolean;
  ob_training_accessed_at: string | null;
}

// ─── Agreement Link ─────────────────────────────────────
const AGREEMENT_URL =
  "https://link.novaracleaning.com/documents/doc-form/68fe8f402c7279d7984c4e99?locale=en_US";

// ─── Supplies Checklist (from official NovaraCleaning Supply Checklist) ───
const SUPPLIES_ESSENTIAL = [
  {
    category: "Cleaning Solutions",
    items: [
      "All-purpose cleaner",
      "Glass & mirror cleaner",
      "Disinfectant spray",
      "Bathroom cleaner (soap scum remover)",
      "Toilet bowl cleaner",
      "Kitchen degreaser",
    ],
  },
  {
    category: "Tools",
    items: [
      "Vacuum with attachments",
      "Mop & bucket (or spray mop)",
      "Microfiber cloths (10-15)",
      "Scrub brush (tile/grout)",
      "Toilet brush",
      "Cleaning toothbrush",
      "White scrub pads (non-scratch)",
      "Duster (microfiber or feather)",
      "Spray bottles",
      "Cleaning tote or caddy",
    ],
  },
  {
    category: "Safety & Personal",
    items: [
      "Rubber gloves",
      "Non-slip shoes",
      "Cleaning apron with pockets",
    ],
  },
];

const SUPPLIES_OPTIONAL = [
  "Stainless steel cleaner & polish",
  "Wood furniture polish",
  "Stone cleaner (pH neutral)",
  "Oven cleaner (for add-on service)",
  "Squeegee",
  "Whisk broom",
  "Step stool (2-step max)",
  "Mask/respirator (ovens, showers)",
  "Separate toilet toothbrush (different color)",
  "Leather cleaner (rare)",
];

// Discord server invite link
const DISCORD_INVITE_LINK = "https://discord.gg/YJ4CfWeFpe";

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
  const [activeStep, setActiveStep] = useState<number | null>(null);
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockedStatus, setBlockedStatus] = useState("");

  // Agreement state
  const [agreementChecked, setAgreementChecked] = useState(false);
  const [signatureName, setSignatureName] = useState("");
  const [signingAgreement, setSigningAgreement] = useState(false);

  // Other step states
  const [savingStep, setSavingStep] = useState(false);
  const [stripeLoading, setStripeLoading] = useState(false);

  const BLOCKED_STATUSES = [
    "suspended",
    "terminated",
    "fired",
    "inactive",
    "deactivated",
  ];

  useEffect(() => {
    checkAuthAndLoad();
  }, []);

  const checkAuthAndLoad = async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        toast.error("Please sign in to access the onboarding portal");
        router.replace("/cleaner/auth");
        return;
      }

      // Fetch cleaner profile
      const { data: cleaner, error } = await supabase
        .from("cleaners")
        .select("*")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (error) throw error;

      if (!cleaner) {
        toast.info("Please complete your profile first");
        router.replace("/cleaner/onboarding");
        return;
      }

      // Security check: block fired/suspended cleaners
      if (BLOCKED_STATUSES.includes(cleaner.status?.toLowerCase())) {
        setIsBlocked(true);
        setBlockedStatus(cleaner.status);
        setLoading(false);
        return;
      }

      setProfile(cleaner as unknown as CleanerProfile);

      // Determine first incomplete step
      const firstIncomplete = getFirstIncompleteStep(
        cleaner as unknown as CleanerProfile
      );
      if (firstIncomplete !== null) {
        setActiveStep(firstIncomplete);
      }
    } catch (error) {
      console.error("Auth/load error:", error);
      toast.error("Failed to load your profile");
      router.replace("/cleaner/auth");
    } finally {
      setLoading(false);
    }
  };

  const getFirstIncompleteStep = (p: CleanerProfile): number | null => {
    if (!p.ob_agreement_signed) return 0;
    if (!p.ob_google_chat_joined) return 1;
    if (!p.ob_supplies_checklist_viewed) return 2;
    if (!p.ob_payouts_setup) return 3;
    if (!p.ob_training_accessed) return 4;
    return null;
  };

  const completedCount = profile
    ? [
        profile.ob_agreement_signed,
        profile.ob_google_chat_joined,
        profile.ob_supplies_checklist_viewed,
        profile.ob_payouts_setup,
        profile.ob_training_accessed,
      ].filter(Boolean).length
    : 0;

  const allComplete = completedCount === 5;
  const progressPercent = (completedCount / 5) * 100;

  const updateStep = async (field: string, atField: string) => {
    if (!profile) return;
    setSavingStep(true);
    try {
      // This portal does NOT set onboarding_complete — Onboarding.tsx handles that.
      // We track our own 5-step checklist completion via portal_checklist_complete.
      const updatePayload: Record<string, unknown> = {
        [field]: true,
        [atField]: new Date().toISOString(),
      };
      if (completedCount === 4) {
        updatePayload.portal_checklist_complete = true;
      }

      const { error } = await supabase
        .from("cleaners")
        .update(updatePayload)
        .eq("id", profile.id);

      if (error) throw error;

      // Update local state
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              [field]: true,
              [atField]: new Date().toISOString(),
              ...(completedCount === 4 ? { portal_checklist_complete: true } : {}),
            }
          : prev
      );

      toast.success("Step completed!");

      // Mirror the milestone into the contractor's GHL contact (tags +
      // custom fields). Fire-and-forget — portal still advances if GHL
      // is down. send-post-booking-sms / send-ghl-sms patterns mean
      // sync-cleaner-to-ghl will retry gracefully on a future event.
      supabase.functions.invoke("sync-cleaner-to-ghl", {
        body: { cleanerId: profile.id },
      }).catch((e) => console.warn("[OnboardingPortal] GHL sync failed (non-blocking):", e));

      // Auto-advance to next step
      const nextStep =
        activeStep !== null && activeStep < 4 ? activeStep + 1 : null;
      setActiveStep(nextStep);
    } catch (error) {
      console.error("Error updating step:", error);
      toast.error("Failed to save progress. Please try again.");
    } finally {
      setSavingStep(false);
    }
  };

  // ─── Agreement Handlers ───────────────────────────────
  const handleSignAgreement = async () => {
    if (!agreementChecked || !signatureName.trim() || !profile) return;

    const expectedName =
      `${profile.first_name} ${profile.last_name}`.toLowerCase();
    if (signatureName.trim().toLowerCase() !== expectedName) {
      toast.error(
        `Please type your full legal name: ${profile.first_name} ${profile.last_name}`
      );
      return;
    }

    setSigningAgreement(true);
    await updateStep("ob_agreement_signed", "ob_agreement_signed_at");
    setSigningAgreement(false);
  };

  // ─── Payout Setup Handler ─────────────────────────────
  const handleSetupPayouts = async () => {
    if (!profile) return;
    setStripeLoading(true);

    try {
      // Always route to Stripe Connect onboarding flow
      // This handles both new accounts and incomplete onboarding
      const { data, error } = await supabase.functions.invoke(
        "initiate-cleaner-stripe-connect"
      );

      if (error) throw error;
      if (data?.url) {
        // Mark step complete before redirecting
        await updateStep("ob_payouts_setup", "ob_payouts_setup_at");
        window.location.href = data.url;
      } else {
        toast.error("Could not start Stripe onboarding. Please try again.");
      }
    } catch (error) {
      console.error("Stripe setup error:", error);
      toast.error("Failed to set up payouts. Please try again.");
    } finally {
      setStripeLoading(false);
    }
  };

  // ─── Training Portal Handler ──────────────────────────
  const handleAccessTraining = async () => {
    await updateStep("ob_training_accessed", "ob_training_accessed_at");
    window.open("https://training.novaracleaning.com", "_blank");
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/cleaner/auth");
  };

  // ─── Loading State ────────────────────────────────────
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

  // ─── Blocked State ────────────────────────────────────
  if (isBlocked) {
    return <BlockedScreen status={blockedStatus} />;
  }

  if (!profile) return null;

  // ─── Step Definitions ─────────────────────────────────
  const steps = [
    {
      id: 0,
      title: "Sign Contractor Agreement",
      description: "Review and sign the independent contractor agreement",
      icon: RiFileTextLine,
      completed: profile.ob_agreement_signed,
      completedAt: profile.ob_agreement_signed_at,
    },
    {
      id: 1,
      title: "Join Team Discord",
      description: "Download Discord and join our team server",
      icon: RiChat1Line,
      completed: profile.ob_google_chat_joined,
      completedAt: profile.ob_google_chat_joined_at,
    },
    {
      id: 2,
      title: "Review Supplies Checklist",
      description: "See what you need to get started",
      icon: RiClipboardLine,
      completed: profile.ob_supplies_checklist_viewed,
      completedAt: profile.ob_supplies_checklist_viewed_at,
    },
    {
      id: 3,
      title: "Setup Payouts",
      description: "Connect your bank account via Stripe",
      icon: RiBankCardLine,
      completed: profile.ob_payouts_setup,
      completedAt: profile.ob_payouts_setup_at,
    },
    {
      id: 4,
      title: "Access Training Portal",
      description: "Complete your required training modules",
      icon: RiGraduationCapLine,
      completed: profile.ob_training_accessed,
      completedAt: profile.ob_training_accessed_at,
    },
  ];

  // ─── Render ───────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/10">
      <SEO title="Onboarding Portal" noindex />
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/40">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={logo} alt="Novara" className="w-8 h-8 rounded-lg" />
            <div>
              <span className="text-sm font-bold font-jakarta">
                Novara<span className="text-primary">Cleaning</span>
              </span>
              <p className="text-[10px] text-muted-foreground leading-none">
                Contractor Onboarding
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {profile.onboarding_complete && (
              <Badge variant="outline" className="text-xs bg-green-500/10 text-green-700 border-green-500/30">
                <RiCheckboxCircleLine className="w-3 h-3 mr-1" />
                Onboarding Complete
              </Badge>
            )}
            <Badge variant="secondary" className="text-xs hidden sm:flex">
              <RiShieldLine className="w-3 h-3 mr-1" />
              {profile.first_name} {profile.last_name}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleSignOut}
            >
              <RiLogoutBoxRLine className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Progress Header */}
        <div className="space-y-4">
          <div className="text-center space-y-2">
            {allComplete ? (
              <>
                <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto">
                  <RiSparklingLine className="w-8 h-8 text-green-500" />
                </div>
                <h1 className="text-2xl font-bold font-jakarta">
                  You're All Set!
                </h1>
                <p className="text-muted-foreground text-sm">
                  You've completed all onboarding steps. Welcome to the Novara
                  team!
                </p>
              </>
            ) : (
              <>
                <h1 className="text-2xl font-bold font-jakarta">
                  Welcome, {profile.first_name}!
                </h1>
                <p className="text-muted-foreground text-sm">
                  Complete all 5 steps below to finish your onboarding and start
                  receiving jobs.
                </p>
              </>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Onboarding Progress</span>
              <span className="font-semibold">
                {completedCount}/5 Complete
              </span>
            </div>
            <Progress value={progressPercent} className="h-2.5" />
          </div>
        </div>

        {/* Steps List */}
        <div className="space-y-3">
          {steps.map((step) => {
            const Icon = step.icon;
            const isActive = activeStep === step.id;
            const isLocked =
              step.id > 0 && !steps[step.id - 1].completed;

            return (
              <div key={step.id}>
                {/* Step Card */}
                <Card
                  className={cn(
                    "border transition-all duration-200 cursor-pointer",
                    step.completed &&
                      "border-green-500/30 bg-green-500/[0.02]",
                    isActive &&
                      !step.completed &&
                      "border-primary/40 shadow-md",
                    isLocked && "opacity-60",
                    !isActive &&
                      !step.completed &&
                      !isLocked &&
                      "hover:border-primary/20"
                  )}
                  onClick={() => {
                    if (!isLocked) setActiveStep(isActive ? null : step.id);
                  }}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center gap-4">
                      {/* Status Icon */}
                      <div
                        className={cn(
                          "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors",
                          step.completed && "bg-green-500/10",
                          isActive && !step.completed && "bg-primary/10",
                          !step.completed && !isActive && "bg-muted"
                        )}
                      >
                        {step.completed ? (
                          <RiCheckboxCircleLine className="w-5 h-5 text-green-600" />
                        ) : isLocked ? (
                          <RiLockLine className="w-5 h-5 text-muted-foreground" />
                        ) : (
                          <Icon
                            className={cn(
                              "w-5 h-5",
                              isActive
                                ? "text-primary"
                                : "text-muted-foreground"
                            )}
                          />
                        )}
                      </div>

                      {/* Text */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3
                            className={cn(
                              "font-semibold text-sm",
                              step.completed && "text-green-700"
                            )}
                          >
                            {step.title}
                          </h3>
                          {step.completed && (
                            <Badge
                              variant="secondary"
                              className="bg-green-500/10 text-green-600 text-[10px] px-1.5 py-0"
                            >
                              Done
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {step.description}
                        </p>
                      </div>

                      {/* Arrow */}
                      {!step.completed && !isLocked && (
                        <RiArrowRightSLine
                          className={cn(
                            "w-5 h-5 text-muted-foreground transition-transform",
                            isActive && "rotate-90"
                          )}
                        />
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Expanded Step Content */}
                {isActive && !step.completed && (
                  <Card className="mt-2 border-primary/20 shadow-lg animate-in slide-in-from-top-2 duration-200">
                    <CardContent className="p-5">
                      {/* Step 0: Sign Agreement (external document) */}
                      {step.id === 0 && (
                        <div className="space-y-4">
                          <div className="flex items-center gap-2 mb-2">
                            <RiFileTextLine className="w-5 h-5 text-primary" />
                            <h3 className="font-semibold">
                              Independent Contractor Agreement
                            </h3>
                          </div>

                          <div className="bg-muted/30 rounded-lg p-4 space-y-3">
                            <p className="text-sm text-muted-foreground">
                              You must review and sign the official Novara Cleaning
                              Independent Contractor Agreement before proceeding.
                              The document will open in a new tab.
                            </p>
                            <ul className="space-y-2">
                              {[
                                "Review all terms and conditions carefully",
                                "Fill in your information on the form",
                                "Sign the document electronically",
                                "Come back here and confirm you've signed",
                              ].map((item, idx) => (
                                <li
                                  key={idx}
                                  className="flex items-center gap-2 text-sm"
                                >
                                  <span className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-primary">
                                    {idx + 1}
                                  </span>
                                  {item}
                                </li>
                              ))}
                            </ul>
                          </div>

                          <div className="bg-amber-500/10 rounded-lg p-3 border border-amber-500/20">
                            <p className="text-xs text-amber-700 font-medium flex items-start gap-2">
                              <RiAlertLine className="w-4 h-4 flex-shrink-0 mt-0.5" />
                              You MUST complete and sign the agreement before continuing. Do not just open it — fill in all fields and submit your signature.
                            </p>
                          </div>

                          <Button
                            variant="outline"
                            className="w-full h-12 text-sm font-semibold border-primary/30"
                            onClick={() =>
                              window.open(AGREEMENT_URL, "_blank")
                            }
                          >
                            <RiExternalLinkLine className="w-4 h-4 mr-2" />
                            Open & Sign Agreement Document
                          </Button>

                          <Separator />

                          <div className="space-y-3">
                            <div className="flex items-start gap-3">
                              <Checkbox
                                id="agree"
                                checked={agreementChecked}
                                onCheckedChange={(v) =>
                                  setAgreementChecked(v === true)
                                }
                              />
                              <label
                                htmlFor="agree"
                                className="text-xs leading-relaxed cursor-pointer"
                              >
                                I have read, completed, and signed the
                                Independent Contractor Agreement. I understand
                                that I am joining as an independent contractor,
                                not an employee of Novara Cleaning LLC.
                              </label>
                            </div>

                            <div className="space-y-1.5">
                              <label className="text-xs font-semibold">
                                Type your full legal name to confirm
                              </label>
                              <Input
                                value={signatureName}
                                onChange={(e) =>
                                  setSignatureName(e.target.value)
                                }
                                placeholder={`${profile.first_name} ${profile.last_name}`}
                                className="h-11 font-serif italic text-lg"
                                disabled={!agreementChecked}
                              />
                            </div>

                            <Button
                              onClick={handleSignAgreement}
                              disabled={
                                !agreementChecked ||
                                !signatureName.trim() ||
                                signingAgreement
                              }
                              className="w-full h-11"
                            >
                              {signingAgreement ? (
                                <>
                                  <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" />
                                  Confirming...
                                </>
                              ) : (
                                <>
                                  <RiFileTextLine className="w-4 h-4 mr-2" />
                                  Confirm Agreement Signed
                                </>
                              )}
                            </Button>
                          </div>
                        </div>
                      )}

                      {/* Step 1: Discord */}
                      {step.id === 1 && (
                        <div className="space-y-4">
                          <div className="flex items-center gap-2 mb-2">
                            <RiChat1Line className="w-5 h-5 text-primary" />
                            <h3 className="font-semibold">
                              Join Team Discord
                            </h3>
                          </div>

                          <div className="bg-muted/30 rounded-lg p-4 space-y-3">
                            <p className="text-sm text-muted-foreground">
                              Our team communicates through Discord. This is
                              where you'll receive:
                            </p>
                            <ul className="space-y-2">
                              {[
                                "Job assignments and updates",
                                "Schedule changes and announcements",
                                "Tips and best practices from the team",
                                "Direct support from management",
                              ].map((item, idx) => (
                                <li
                                  key={idx}
                                  className="flex items-center gap-2 text-sm"
                                >
                                  <RiCircleLine className="w-1.5 h-1.5 fill-primary text-primary flex-shrink-0" />
                                  {item}
                                </li>
                              ))}
                            </ul>
                          </div>

                          {/* Discord setup instructions */}
                          <div className="bg-[#5865F2]/10 rounded-lg p-4 border border-[#5865F2]/20 space-y-3">
                            <p className="text-xs font-bold text-[#5865F2] uppercase tracking-wider">
                              Required Steps
                            </p>
                            <ol className="space-y-2">
                              {[
                                "Download the Discord app on your phone (App Store / Google Play)",
                                "Create a free Discord account if you don't have one",
                                "Click the invite link below to join our server",
                                "Introduce yourself in the #introductions channel",
                              ].map((item, idx) => (
                                <li
                                  key={idx}
                                  className="flex items-start gap-2 text-sm"
                                >
                                  <span className="w-5 h-5 rounded-full bg-[#5865F2]/20 flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-[#5865F2]">
                                    {idx + 1}
                                  </span>
                                  <span className="text-xs">{item}</span>
                                </li>
                              ))}
                            </ol>
                          </div>

                          <div className="bg-amber-500/10 rounded-lg p-3 border border-amber-500/20">
                            <p className="text-xs text-amber-700 font-medium flex items-start gap-2">
                              <RiAlertLine className="w-4 h-4 flex-shrink-0 mt-0.5" />
                              You must download the Discord app and create an account. This is how all team communication happens — do not skip this step.
                            </p>
                          </div>

                          <div className="space-y-2">
                            <Button
                              variant="outline"
                              className="w-full h-12 text-sm font-semibold border-[#5865F2]/30 text-[#5865F2] hover:bg-[#5865F2]/5"
                              onClick={() =>
                                window.open(DISCORD_INVITE_LINK, "_blank")
                              }
                            >
                              <RiExternalLinkLine className="w-4 h-4 mr-2" />
                              Join Novara Discord Server
                            </Button>
                            <Button
                              className="w-full h-11"
                              onClick={() =>
                                updateStep(
                                  "ob_google_chat_joined",
                                  "ob_google_chat_joined_at"
                                )
                              }
                              disabled={savingStep}
                            >
                              {savingStep ? (
                                <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" />
                              ) : (
                                <RiCheckboxCircleLine className="w-4 h-4 mr-2" />
                              )}
                              I've Downloaded Discord & Joined the Server
                            </Button>
                          </div>
                        </div>
                      )}

                      {/* Step 2: Supplies Checklist */}
                      {step.id === 2 && (
                        <div className="space-y-4">
                          <div className="flex items-center gap-2 mb-2">
                            <RiClipboardLine className="w-5 h-5 text-primary" />
                            <h3 className="font-semibold">
                              Supply Checklist
                            </h3>
                          </div>

                          <p className="text-sm text-muted-foreground">
                            As an independent contractor, you provide your own supplies.
                            <span className="font-semibold text-foreground"> Not all supplies need to be purchased right away</span> — start with the essentials and add optional items as you take on more specialized jobs.
                          </p>

                          {/* No reimbursement notice */}
                          <div className="bg-amber-500/10 rounded-lg p-3 border border-amber-500/20">
                            <p className="text-xs text-amber-700 font-medium flex items-start gap-2">
                              <RiAlertLine className="w-4 h-4 flex-shrink-0 mt-0.5" />
                              There are no reimbursements for supplies. All supply costs are your responsibility as an independent contractor.
                            </p>
                          </div>

                          {/* Screenshot / Download option */}
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex-1 h-9 text-xs"
                              onClick={() => {
                                // Create a printable text version for download
                                const text = [
                                  "NOVARA CLEANING — SUPPLY CHECKLIST",
                                  "===================================",
                                  "",
                                  "ESSENTIAL — Get These Before Your First Job",
                                  "",
                                  "Cleaning Solutions:",
                                  "  [ ] All-purpose cleaner",
                                  "  [ ] Glass & mirror cleaner",
                                  "  [ ] Disinfectant spray",
                                  "  [ ] Bathroom cleaner (soap scum remover)",
                                  "  [ ] Toilet bowl cleaner",
                                  "  [ ] Kitchen degreaser",
                                  "",
                                  "Tools:",
                                  "  [ ] Vacuum with attachments",
                                  "  [ ] Mop & bucket (or spray mop)",
                                  "  [ ] Microfiber cloths (10-15)",
                                  "  [ ] Scrub brush (tile/grout)",
                                  "  [ ] Toilet brush",
                                  "  [ ] Cleaning toothbrush",
                                  "  [ ] White scrub pads (non-scratch)",
                                  "  [ ] Duster (microfiber or feather)",
                                  "  [ ] Spray bottles",
                                  "  [ ] Cleaning tote or caddy",
                                  "",
                                  "Safety & Personal:",
                                  "  [ ] Rubber gloves",
                                  "  [ ] Non-slip shoes",
                                  "  [ ] Cleaning apron with pockets",
                                  "",
                                  "OPTIONAL — Add Later for Premium Jobs",
                                  "",
                                  "  [ ] Stainless steel cleaner & polish",
                                  "  [ ] Wood furniture polish",
                                  "  [ ] Stone cleaner (pH neutral)",
                                  "  [ ] Oven cleaner (for add-on service)",
                                  "  [ ] Squeegee",
                                  "  [ ] Whisk broom",
                                  "  [ ] Step stool (2-step max)",
                                  "  [ ] Mask/respirator (ovens, showers)",
                                  "  [ ] Separate toilet toothbrush (different color)",
                                  "  [ ] Leather cleaner (rare)",
                                  "",
                                  "WARNING: NEVER use vinegar, toilet bowl cleaner, CLR,",
                                  "Lime-A-Way, or citrus-based cleaners on natural stone",
                                  "(granite, marble, quartz, travertine).",
                                  "",
                                  "No reimbursements. All supply costs are your responsibility.",
                                  "",
                                  "CONFIDENTIAL — Property of NovaraCleaning.",
                                ].join("\n");
                                const blob = new Blob([text], { type: "text/plain" });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement("a");
                                a.href = url;
                                a.download = "NovaraCleaning_Supply_Checklist.txt";
                                a.click();
                                URL.revokeObjectURL(url);
                                toast.success("Checklist downloaded!");
                              }}
                            >
                              <RiClipboardLine className="w-3 h-3 mr-1" />
                              Download Checklist
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex-1 h-9 text-xs"
                              onClick={() => {
                                toast.info("Take a screenshot of this page for your records!");
                              }}
                            >
                              <RiExternalLinkLine className="w-3 h-3 mr-1" />
                              Screenshot This Page
                            </Button>
                          </div>

                          {/* Essential Supplies */}
                          <div className="space-y-4">
                            <div className="flex items-center gap-2">
                              <Badge className="bg-primary/10 text-primary border-0 text-[10px] uppercase tracking-wider font-bold">
                                Essential
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                Get these before your first job
                              </span>
                            </div>

                            {SUPPLIES_ESSENTIAL.map((category, catIdx) => (
                              <div key={catIdx}>
                                <h4 className="text-xs font-bold uppercase tracking-wider text-foreground mb-2">
                                  {category.category}
                                </h4>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                  {category.items.map((item, itemIdx) => (
                                    <div
                                      key={itemIdx}
                                      className="flex items-center gap-2"
                                    >
                                      <div className="w-4 h-4 rounded border-2 border-primary/30 flex-shrink-0" />
                                      <span className="text-xs">{item}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>

                          <Separator />

                          {/* Optional Supplies */}
                          <div className="space-y-3">
                            <div className="flex items-center gap-2">
                              <Badge variant="secondary" className="text-[10px] uppercase tracking-wider font-bold">
                                Optional
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                Add later for deep cleans & specialty surfaces
                              </span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                              {SUPPLIES_OPTIONAL.map((item, idx) => (
                                <div
                                  key={idx}
                                  className="flex items-center gap-2"
                                >
                                  <div className="w-4 h-4 rounded border border-border/60 flex-shrink-0" />
                                  <span className="text-xs text-muted-foreground">
                                    {item}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>

                          <Separator />

                          {/* Warning about natural stone */}
                          <div className="bg-destructive/5 rounded-lg p-3 border border-destructive/20">
                            <div className="flex items-start gap-2">
                              <RiAlertLine className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                              <div>
                                <p className="text-xs font-bold text-destructive">
                                  NEVER USE ON NATURAL STONE
                                </p>
                                <p className="text-[11px] text-destructive/80 mt-1">
                                  Granite, marble, quartz, and travertine are
                                  damaged by acidic products. Do NOT use vinegar,
                                  toilet bowl cleaner, CLR, Lime-A-Way, or
                                  citrus-based cleaners. Use pH-neutral stone
                                  cleaner only. When in doubt, ASK before cleaning.
                                </p>
                              </div>
                            </div>
                          </div>

                          {/* Pro Tip */}
                          <div className="bg-primary/5 rounded-lg p-3 border border-primary/20">
                            <p className="text-xs text-primary/90">
                              <span className="font-bold">PRO TIP:</span> Keep
                              your supplies organized in two totes — one for
                              bathrooms ("dirty") and one for the rest of the
                              house ("clean"). This prevents cross-contamination
                              and keeps you efficient.
                            </p>
                          </div>

                          <Button
                            className="w-full h-11"
                            onClick={() =>
                              updateStep(
                                "ob_supplies_checklist_viewed",
                                "ob_supplies_checklist_viewed_at"
                              )
                            }
                            disabled={savingStep}
                          >
                            {savingStep ? (
                              <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" />
                            ) : (
                              <RiCheckboxCircleLine className="w-4 h-4 mr-2" />
                            )}
                            I've Reviewed the Checklist
                          </Button>
                        </div>
                      )}

                      {/* Step 3: Setup Payouts */}
                      {step.id === 3 && (
                        <div className="space-y-4">
                          <div className="flex items-center gap-2 mb-2">
                            <RiBankCardLine className="w-5 h-5 text-primary" />
                            <h3 className="font-semibold">Setup Payouts</h3>
                          </div>

                          {/* 1099 notice */}
                          <div className="bg-primary/5 rounded-lg p-3 border border-primary/20">
                            <p className="text-xs text-primary/90">
                              <span className="font-bold">This is a 1099 independent contractor role.</span>{" "}
                              You are responsible for reporting your own income and paying your own taxes. Novara Cleaning does not withhold taxes from your payouts.
                            </p>
                          </div>

                          <div className="bg-muted/30 rounded-lg p-4 space-y-3">
                            <p className="text-sm text-muted-foreground">
                              We use Stripe Connect to process your payouts securely.
                              You'll be redirected to Stripe to complete onboarding:
                            </p>
                            <ul className="space-y-2">
                              {[
                                "Verify your identity (SSN & date of birth)",
                                "Connect your bank account or debit card",
                                "Provide your legal name and address for tax reporting",
                              ].map((item, idx) => (
                                <li
                                  key={idx}
                                  className="flex items-center gap-2 text-sm"
                                >
                                  <span className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-primary">
                                    {idx + 1}
                                  </span>
                                  <span className="text-xs">{item}</span>
                                </li>
                              ))}
                            </ul>
                          </div>

                          <div className="bg-green-500/5 rounded-lg p-3 border border-green-500/20">
                            <p className="text-xs text-green-700">
                              Payouts are processed within 2-3 business days
                              after each completed job. Your rate: <span className="font-bold">${profile?.pay_rate_hr || 18}/hour</span>.
                            </p>
                          </div>

                          <Button
                            className="w-full h-12 text-sm font-semibold"
                            onClick={handleSetupPayouts}
                            disabled={stripeLoading}
                          >
                            {stripeLoading ? (
                              <>
                                <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" />
                                Redirecting to Stripe...
                              </>
                            ) : (
                              <>
                                <RiBankCardLine className="w-4 h-4 mr-2" />
                                Start Stripe Connect Onboarding
                                <RiArrowRightLine className="w-4 h-4 ml-2" />
                              </>
                            )}
                          </Button>

                          <p className="text-[11px] text-center text-muted-foreground">
                            You'll be redirected to Stripe's secure onboarding page.
                            Complete all steps there, then return here.
                          </p>
                        </div>
                      )}

                      {/* Step 4: Training Portal */}
                      {step.id === 4 && (
                        <div className="space-y-4">
                          <div className="flex items-center gap-2 mb-2">
                            <RiGraduationCapLine className="w-5 h-5 text-primary" />
                            <h3 className="font-semibold">Training Portal</h3>
                          </div>

                          <div className="bg-muted/30 rounded-lg p-4 space-y-3">
                            <p className="text-sm text-muted-foreground">
                              Complete your training to learn our standards and
                              procedures:
                            </p>
                            <ul className="space-y-2">
                              {[
                                "40-point cleaning checklist walkthrough",
                                "Client interaction best practices",
                                "Safety and chemical handling",
                                "Time management and efficiency tips",
                                "How to use the Novara app",
                              ].map((item, idx) => (
                                <li
                                  key={idx}
                                  className="flex items-center gap-2 text-sm"
                                >
                                  <RiGraduationCapLine className="w-3 h-3 text-primary flex-shrink-0" />
                                  {item}
                                </li>
                              ))}
                            </ul>
                          </div>

                          <Button
                            className="w-full h-11"
                            onClick={handleAccessTraining}
                            disabled={savingStep}
                          >
                            {savingStep ? (
                              <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" />
                            ) : (
                              <>
                                <RiGraduationCapLine className="w-4 h-4 mr-2" />
                                Open Training Portal
                                <RiExternalLinkLine className="w-4 h-4 ml-2" />
                              </>
                            )}
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>
            );
          })}
        </div>

        {/* All Complete CTA */}
        {allComplete && (
          <Card className="border-green-500/30 bg-gradient-to-br from-green-500/5 to-emerald-500/5 shadow-lg">
            <CardContent className="p-6 text-center space-y-4">
              <RiCheckboxCircleLine className="w-12 h-12 text-green-500 mx-auto" />
              <div>
                <h3 className="font-bold text-lg">Onboarding Complete!</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  You're ready to start accepting cleaning jobs. Head to your
                  dashboard to view assignments.
                </p>
              </div>
              <Button
                className="w-full h-12"
                onClick={() => router.push("/cleaner/dashboard")}
              >
                Go to Dashboard
                <RiArrowRightLine className="w-4 h-4 ml-2" />
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Footer */}
        <p className="text-xs text-center text-muted-foreground pb-6">
          Need help? Contact{" "}
          <a
            href="mailto:support@novaracleaning.com"
            className="text-primary hover:underline"
          >
            support@novaracleaning.com
          </a>
        </p>
      </main>
    </div>
  );
}
