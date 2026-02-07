import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
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
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  Loader2,
  Shield,
  FileSignature,
  MessageCircle,
  ClipboardList,
  CreditCard,
  GraduationCap,
  CheckCircle2,
  Lock,
  ExternalLink,
  AlertTriangle,
  LogOut,
  ChevronRight,
  Sparkles,
  ArrowRight,
  Circle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import logo from "@/assets/logo.png";

// ─── Types ──────────────────────────────────────────────
interface CleanerProfile {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  status: string;
  stripe_account_id: string | null;
  payouts_enabled: boolean;
  onboarding_complete: boolean;
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

// ─── Agreement Content ──────────────────────────────────
const AGREEMENT_SECTIONS = [
  {
    title: "1. Independent Contractor Status",
    content:
      'You are engaged as an independent contractor and not an employee of Novara Cleaning LLC. You are responsible for your own taxes, insurance, and business obligations.',
  },
  {
    title: "2. Service Standards",
    content:
      "You agree to uphold Novara Cleaning's quality standards at all times. This includes following the 40-point cleaning checklist, arriving on time, wearing professional attire, and treating all client property with care and respect.",
  },
  {
    title: "3. Confidentiality & Privacy",
    content:
      "You agree to keep all client information, addresses, access codes, and personal details strictly confidential. Sharing client information with unauthorized third parties is grounds for immediate termination.",
  },
  {
    title: "4. Payment Terms",
    content:
      "Payment is processed through Stripe Connect. You will receive payouts within 2-3 business days of job completion. Your current pay rate is $18/hour. Rates may be adjusted based on performance and market conditions with advance notice.",
  },
  {
    title: "5. Cancellation & No-Show Policy",
    content:
      "You must provide at least 24 hours notice for cancellations. Repeated no-shows or last-minute cancellations may result in account suspension or termination. Emergency exceptions will be reviewed on a case-by-case basis.",
  },
  {
    title: "6. Equipment & Supplies",
    content:
      "Novara Cleaning will provide a starter supplies kit. You are responsible for maintaining your equipment in working order. Lost or damaged equipment beyond normal wear must be replaced at your expense.",
  },
  {
    title: "7. Background Check & Insurance",
    content:
      "You consent to a background check as a condition of engagement. You are covered under Novara Cleaning's general liability insurance while performing services. You are responsible for your own health insurance and personal liability.",
  },
  {
    title: "8. Termination",
    content:
      "Either party may terminate this agreement at any time with 7 days written notice. Novara Cleaning reserves the right to terminate immediately for violations of this agreement, client complaints, or policy violations.",
  },
];

// ─── Supplies Checklist ─────────────────────────────────
const SUPPLIES_CHECKLIST = [
  {
    category: "Cleaning Solutions",
    items: [
      "All-purpose cleaner (provided)",
      "Glass cleaner (provided)",
      "Bathroom disinfectant (provided)",
      "Stainless steel cleaner",
      "Wood floor cleaner",
    ],
  },
  {
    category: "Tools & Equipment",
    items: [
      "Microfiber cloths (10+ recommended)",
      "Scrub sponges (non-scratch)",
      "Toilet brush",
      "Duster with extension pole",
      "Spray bottles",
      "Vacuum cleaner (HEPA preferred)",
      "Mop and bucket",
    ],
  },
  {
    category: "Protective Gear",
    items: [
      "Rubber gloves (multiple pairs)",
      "Knee pads (optional but recommended)",
      "Non-slip shoes",
    ],
  },
  {
    category: "Professional Appearance",
    items: [
      "Novara-branded shirt (provided after first 5 jobs)",
      "Clean, professional attire",
      "ID badge (provided)",
    ],
  },
];

// Google Chat link - replace with actual link
const GOOGLE_CHAT_LINK = "https://chat.google.com/room/AAAA_placeholder";

// ─── Blocked Status Screen ──────────────────────────────
function BlockedScreen({ status }: { status: string }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-destructive/5 via-background to-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full border-destructive/20 shadow-xl">
        <CardContent className="pt-8 pb-8 text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
            <Lock className="w-8 h-8 text-destructive" />
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
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<CleanerProfile | null>(null);
  const [activeStep, setActiveStep] = useState<number | null>(null);
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockedStatus, setBlockedStatus] = useState("");

  // Agreement state
  const [agreementScrolled, setAgreementScrolled] = useState(false);
  const [agreementChecked, setAgreementChecked] = useState(false);
  const [signatureName, setSignatureName] = useState("");
  const [signingAgreement, setSigningAgreement] = useState(false);
  const agreementRef = useRef<HTMLDivElement>(null);

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
        navigate("/cleaner/auth");
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
        navigate("/cleaner/onboarding");
        return;
      }

      // Security check: block fired/suspended cleaners
      if (BLOCKED_STATUSES.includes(cleaner.status?.toLowerCase())) {
        setIsBlocked(true);
        setBlockedStatus(cleaner.status);
        setLoading(false);
        return;
      }

      setProfile(cleaner as CleanerProfile);

      // Determine first incomplete step
      const firstIncomplete = getFirstIncompleteStep(
        cleaner as CleanerProfile
      );
      if (firstIncomplete !== null) {
        setActiveStep(firstIncomplete);
      }
    } catch (error) {
      console.error("Auth/load error:", error);
      toast.error("Failed to load your profile");
      navigate("/cleaner/auth");
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
      const { error } = await supabase
        .from("cleaners")
        .update({
          [field]: true,
          [atField]: new Date().toISOString(),
        })
        .eq("id", profile.id);

      if (error) throw error;

      // Update local state
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              [field]: true,
              [atField]: new Date().toISOString(),
            }
          : prev
      );

      toast.success("Step completed!");

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
  const handleAgreementScroll = () => {
    if (!agreementRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = agreementRef.current;
    if (scrollTop + clientHeight >= scrollHeight - 20) {
      setAgreementScrolled(true);
    }
  };

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
      if (profile.stripe_account_id && profile.payouts_enabled) {
        // Already set up - mark complete and open dashboard
        await updateStep("ob_payouts_setup", "ob_payouts_setup_at");

        const { data, error } = await supabase.functions.invoke(
          "create-stripe-login-link",
          { body: { stripe_account_id: profile.stripe_account_id } }
        );

        if (!error && data?.url) {
          window.open(data.url, "_blank");
        }
      } else {
        // Need to set up Stripe Connect
        const { data, error } = await supabase.functions.invoke(
          "initiate-cleaner-stripe-connect"
        );

        if (error) throw error;
        if (data?.url) {
          // Mark step as in-progress (we'll check on return)
          await updateStep("ob_payouts_setup", "ob_payouts_setup_at");
          window.location.href = data.url;
        }
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
    navigate("/cleaner/auth");
  };

  // ─── Loading State ────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/10 flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto" />
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
      icon: FileSignature,
      completed: profile.ob_agreement_signed,
      completedAt: profile.ob_agreement_signed_at,
    },
    {
      id: 1,
      title: "Join Team Google Chat",
      description: "Join our team communication channel",
      icon: MessageCircle,
      completed: profile.ob_google_chat_joined,
      completedAt: profile.ob_google_chat_joined_at,
    },
    {
      id: 2,
      title: "Review Supplies Checklist",
      description: "See what you need to get started",
      icon: ClipboardList,
      completed: profile.ob_supplies_checklist_viewed,
      completedAt: profile.ob_supplies_checklist_viewed_at,
    },
    {
      id: 3,
      title: "Setup Payouts",
      description: "Connect your bank account via Stripe",
      icon: CreditCard,
      completed: profile.ob_payouts_setup,
      completedAt: profile.ob_payouts_setup_at,
    },
    {
      id: 4,
      title: "Access Training Portal",
      description: "Complete your required training modules",
      icon: GraduationCap,
      completed: profile.ob_training_accessed,
      completedAt: profile.ob_training_accessed_at,
    },
  ];

  // ─── Render ───────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/10">
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
            <Badge variant="secondary" className="text-xs hidden sm:flex">
              <Shield className="w-3 h-3 mr-1" />
              {profile.first_name} {profile.last_name}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleSignOut}
            >
              <LogOut className="w-4 h-4" />
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
                  <Sparkles className="w-8 h-8 text-green-500" />
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
                          <CheckCircle2 className="w-5 h-5 text-green-600" />
                        ) : isLocked ? (
                          <Lock className="w-5 h-5 text-muted-foreground" />
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
                        <ChevronRight
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
                      {/* Step 0: Sign Agreement */}
                      {step.id === 0 && (
                        <div className="space-y-4">
                          <div className="flex items-center gap-2 mb-2">
                            <FileSignature className="w-5 h-5 text-primary" />
                            <h3 className="font-semibold">
                              Independent Contractor Agreement
                            </h3>
                          </div>

                          <div
                            ref={agreementRef}
                            onScroll={handleAgreementScroll}
                            className="h-64 overflow-y-auto rounded-lg border bg-muted/30 p-4 space-y-4 text-sm"
                          >
                            <div className="text-center pb-2 border-b">
                              <p className="font-bold text-base">
                                NOVARA CLEANING LLC
                              </p>
                              <p className="text-muted-foreground text-xs">
                                Independent Contractor Agreement
                              </p>
                            </div>
                            {AGREEMENT_SECTIONS.map((section, idx) => (
                              <div key={idx} className="space-y-1.5">
                                <h4 className="font-semibold text-xs">
                                  {section.title}
                                </h4>
                                <p className="text-xs text-muted-foreground leading-relaxed">
                                  {section.content}
                                </p>
                              </div>
                            ))}
                            <div className="pt-4 border-t text-center">
                              <p className="text-xs text-muted-foreground">
                                By signing below, you acknowledge that you have
                                read, understood, and agree to all terms above.
                              </p>
                            </div>
                          </div>

                          {!agreementScrolled && (
                            <p className="text-xs text-amber-600 flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" />
                              Please scroll to the bottom to read the full
                              agreement
                            </p>
                          )}

                          <div className="space-y-3 pt-2">
                            <div className="flex items-start gap-3">
                              <Checkbox
                                id="agree"
                                checked={agreementChecked}
                                onCheckedChange={(v) =>
                                  setAgreementChecked(v === true)
                                }
                                disabled={!agreementScrolled}
                              />
                              <label
                                htmlFor="agree"
                                className="text-xs leading-relaxed cursor-pointer"
                              >
                                I have read and agree to the Independent
                                Contractor Agreement. I understand that I am
                                joining as an independent contractor, not an
                                employee.
                              </label>
                            </div>

                            <div className="space-y-1.5">
                              <label className="text-xs font-semibold">
                                Type your full legal name to sign
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
                                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                  Signing...
                                </>
                              ) : (
                                <>
                                  <FileSignature className="w-4 h-4 mr-2" />
                                  Sign Agreement
                                </>
                              )}
                            </Button>
                          </div>
                        </div>
                      )}

                      {/* Step 1: Google Chat */}
                      {step.id === 1 && (
                        <div className="space-y-4">
                          <div className="flex items-center gap-2 mb-2">
                            <MessageCircle className="w-5 h-5 text-primary" />
                            <h3 className="font-semibold">
                              Join Team Google Chat
                            </h3>
                          </div>

                          <div className="bg-muted/30 rounded-lg p-4 space-y-3">
                            <p className="text-sm text-muted-foreground">
                              Our team communicates through Google Chat. This is
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
                                  <Circle className="w-1.5 h-1.5 fill-primary text-primary flex-shrink-0" />
                                  {item}
                                </li>
                              ))}
                            </ul>
                          </div>

                          <div className="space-y-2">
                            <Button
                              variant="outline"
                              className="w-full h-11"
                              onClick={() =>
                                window.open(GOOGLE_CHAT_LINK, "_blank")
                              }
                            >
                              <ExternalLink className="w-4 h-4 mr-2" />
                              Open Google Chat Invite
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
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              ) : (
                                <CheckCircle2 className="w-4 h-4 mr-2" />
                              )}
                              I've Joined the Chat
                            </Button>
                          </div>
                        </div>
                      )}

                      {/* Step 2: Supplies Checklist */}
                      {step.id === 2 && (
                        <div className="space-y-4">
                          <div className="flex items-center gap-2 mb-2">
                            <ClipboardList className="w-5 h-5 text-primary" />
                            <h3 className="font-semibold">
                              Supplies Checklist
                            </h3>
                          </div>

                          <p className="text-sm text-muted-foreground">
                            Make sure you have these supplies ready before your
                            first job. Items marked "(provided)" will be
                            included in your starter kit.
                          </p>

                          <div className="space-y-4">
                            {SUPPLIES_CHECKLIST.map((category, catIdx) => (
                              <div key={catIdx}>
                                <h4 className="text-xs font-bold uppercase tracking-wider text-primary mb-2">
                                  {category.category}
                                </h4>
                                <div className="space-y-1.5">
                                  {category.items.map((item, itemIdx) => (
                                    <div
                                      key={itemIdx}
                                      className="flex items-center gap-2 text-sm"
                                    >
                                      <div className="w-4 h-4 rounded border border-border flex items-center justify-center flex-shrink-0">
                                        {item.includes("(provided)") && (
                                          <CheckCircle2 className="w-3 h-3 text-green-500" />
                                        )}
                                      </div>
                                      <span
                                        className={cn(
                                          "text-xs",
                                          item.includes("(provided)") &&
                                            "text-green-700"
                                        )}
                                      >
                                        {item}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
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
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            ) : (
                              <CheckCircle2 className="w-4 h-4 mr-2" />
                            )}
                            I've Reviewed the Checklist
                          </Button>
                        </div>
                      )}

                      {/* Step 3: Setup Payouts */}
                      {step.id === 3 && (
                        <div className="space-y-4">
                          <div className="flex items-center gap-2 mb-2">
                            <CreditCard className="w-5 h-5 text-primary" />
                            <h3 className="font-semibold">Setup Payouts</h3>
                          </div>

                          <div className="bg-muted/30 rounded-lg p-4 space-y-3">
                            <p className="text-sm text-muted-foreground">
                              We use Stripe to process your payouts securely.
                              You'll need to:
                            </p>
                            <ul className="space-y-2">
                              {[
                                "Verify your identity",
                                "Connect your bank account or debit card",
                                "Provide tax information (W-9)",
                              ].map((item, idx) => (
                                <li
                                  key={idx}
                                  className="flex items-center gap-2 text-sm"
                                >
                                  <ArrowRight className="w-3 h-3 text-primary flex-shrink-0" />
                                  {item}
                                </li>
                              ))}
                            </ul>
                          </div>

                          <div className="bg-green-500/5 rounded-lg p-3 border border-green-500/20">
                            <p className="text-xs text-green-700">
                              Payouts are processed within 2-3 business days
                              after each completed job. Your rate: $18/hour.
                            </p>
                          </div>

                          <Button
                            className="w-full h-11"
                            onClick={handleSetupPayouts}
                            disabled={stripeLoading}
                          >
                            {stripeLoading ? (
                              <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Setting up...
                              </>
                            ) : profile.stripe_account_id ? (
                              <>
                                <CreditCard className="w-4 h-4 mr-2" />
                                Complete Stripe Setup
                                <ExternalLink className="w-4 h-4 ml-2" />
                              </>
                            ) : (
                              <>
                                <CreditCard className="w-4 h-4 mr-2" />
                                Connect with Stripe
                                <ExternalLink className="w-4 h-4 ml-2" />
                              </>
                            )}
                          </Button>
                        </div>
                      )}

                      {/* Step 4: Training Portal */}
                      {step.id === 4 && (
                        <div className="space-y-4">
                          <div className="flex items-center gap-2 mb-2">
                            <GraduationCap className="w-5 h-5 text-primary" />
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
                                  <GraduationCap className="w-3 h-3 text-primary flex-shrink-0" />
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
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            ) : (
                              <>
                                <GraduationCap className="w-4 h-4 mr-2" />
                                Open Training Portal
                                <ExternalLink className="w-4 h-4 ml-2" />
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
              <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto" />
              <div>
                <h3 className="font-bold text-lg">Onboarding Complete!</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  You're ready to start accepting cleaning jobs. Head to your
                  dashboard to view assignments.
                </p>
              </div>
              <Button
                className="w-full h-12"
                onClick={() => navigate("/cleaner/dashboard")}
              >
                Go to Dashboard
                <ArrowRight className="w-4 h-4 ml-2" />
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
