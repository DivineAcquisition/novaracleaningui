"use client";

import {
  RiArrowRightLine,
  RiCheckboxCircleFill,
  RiFileTextLine,
  RiGraduationCapLine,
  RiListCheck2,
  RiLoader4Line,
  RiLockLine,
  RiLogoutBoxRLine,
  RiPhoneLine,
  RiRoadMapLine,
  RiSparklingLine,
  RiTShirtLine,
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
import { PortalAgreementForm } from "@/components/cleaner/PortalAgreementForm";
import { SupplyChecklistForm } from "@/components/cleaner/SupplyChecklistForm";
import { JobDayGuides } from "@/components/cleaner/JobDayGuides";
import { onboardingGuide } from "@/lib/cleaner-onboarding-guides";
import {
  SUPPLY_ITEMS,
  cleanerSetupSteps,
  isAgreementSigned,
  isDressCodeAgreed,
  isJobDayAcknowledged,
  isRequiredTrainingComplete,
  isSetupStepUnlocked,
  isSupplyChecklistSubmitted,
  sanitizeSupplyInventory,
  scoreSupplyInventory,
  supplySubmissionEvent,
  supplySubmissionPatch,
  type CleanerSetupStepId,
  type SupplyInventory,
} from "@/lib/cleaner-supplies";

const logo = "/novara-logo.png";

// ─── Types ──────────────────────────────────────────────
//
// The portal walks the sequence defined by cleanerSetupSteps():
//   1. Independent Contractor Agreement
//   2. Phone number verification
//   3. Supply checkoff
//   4. Dress code graphic — must agree, not merely view
//   5. Job-day journey graphic
//   6. Training hub (videos they must watch) — last card routes there
//
// A contractor with zero completed jobs cannot be offered work until every
// step, including the videos, is done. See isCleanerReadyForFirstJob().
// Legacy fields
// (ob_agreement_signed, ob_google_chat_joined, ob_training_accessed) stay on
// the cleaners row for back-compat but are not surfaced here.
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
  ob_agreement_signed: boolean | null;
  ob_agreement_signed_at: string | null;
  ob_job_day_guides_ack: boolean | null;
  ob_job_day_guides_ack_at: string | null;
  ob_dress_code_ack: boolean | null;
  ob_dress_code_ack_at: string | null;
  ob_training_complete: boolean | null;
  supply_inventory: SupplyInventory | null;
  supply_checklist_submitted_at: string | null;
  ob_supplies_checklist_viewed: boolean | null;
  home_address: string | null;
  home_city: string | null;
  state: string | null;
  home_zip: string | null;
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
  // Thirty-odd checkboxes are collapsed once submitted, so a returning
  // contractor sees their standing rather than the whole form again. Two
  // full-width graphics get the same treatment.
  const [suppliesOpen, setSuppliesOpen] = useState(false);
  const [dressOpen, setDressOpen] = useState(false);
  const [jobDayOpen, setJobDayOpen] = useState(false);

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

  const handleAgreementSigned = async () => {
    if (!profile) throw new Error("Session expired — reload the page.");
    const now = new Date().toISOString();
    const { error } = await (supabase as any)
      .from("cleaners")
      .update({
        ob_agreement_signed: true,
        ob_agreement_signed_at: now,
        updated_at: now,
      })
      .eq("id", profile.id);
    if (error) throw new Error(error.message || "Couldn't save the agreement.");
    await refreshProfile();
  };

  const handleAcknowledgeDressCode = async () => {
    if (!profile) throw new Error("Session expired — reload the page.");
    const now = new Date().toISOString();
    const { error } = await (supabase as any)
      .from("cleaners")
      .update({
        ob_dress_code_ack: true,
        ob_dress_code_ack_at: now,
        updated_at: now,
      })
      .eq("id", profile.id);
    if (error) throw new Error(error.message || "Couldn't save that. Try again.");
    void (supabase as any)
      .from("events")
      .insert({
        event_type: "cleaner.dress_code_agreed",
        cleaner_id: profile.id,
        source: "cleaner-ob-portal",
        summary: `${profile.first_name || "Cleaner"} agreed to the dress code`,
      })
      .then(() => undefined, () => undefined);
    setDressOpen(true);
    await refreshProfile();
  };

  const handleAcknowledgeJobDay = async () => {
    if (!profile) throw new Error("Session expired — reload the page.");
    const now = new Date().toISOString();
    const { error } = await (supabase as any)
      .from("cleaners")
      .update({
        ob_job_day_guides_ack: true,
        ob_job_day_guides_ack_at: now,
        updated_at: now,
      })
      .eq("id", profile.id);
    if (error) throw new Error(error.message || "Couldn't save that. Try again.");
    void (supabase as any)
      .from("events")
      .insert({
        event_type: "cleaner.job_day_journey_acknowledged",
        cleaner_id: profile.id,
        source: "cleaner-ob-portal",
        summary: `${profile.first_name || "Cleaner"} read the job-day journey`,
      })
      .then(() => undefined, () => undefined);
    setJobDayOpen(true);
    await refreshProfile();
  };

  // Writes the same columns the tokenized checklist route writes, so a
  // contractor who starts on the emailed link and finishes here (or the other
  // way round) is never asked twice.
  const handleSaveSupplies = async (owned: SupplyInventory): Promise<SupplyInventory> => {
    if (!profile) throw new Error("Session expired — reload the page.");
    const inventory = sanitizeSupplyInventory(owned);
    // Cast as elsewhere in the app: supply_inventory and events postdate the
    // generated Supabase types.
    const { error } = await (supabase as any)
      .from("cleaners")
      .update(supplySubmissionPatch(inventory))
      .eq("id", profile.id);
    if (error) throw new Error(error.message || "Couldn't save your checklist.");

    void (supabase as any)
      .from("events")
      .insert(
        supplySubmissionEvent({
          cleanerId: profile.id,
          firstName: profile.first_name,
          inventory,
          source: "cleaner-ob-portal",
        }),
      )
      .then(() => undefined, () => undefined);

    // Stay expanded so the form's own "Saved" confirmation is still on screen
    // when the step header flips to Complete.
    setSuppliesOpen(true);
    await refreshProfile();
    return inventory;
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
  const steps = cleanerSetupSteps(profile);
  const agreementDone = isAgreementSigned(profile);
  const phoneStepDone = !!profile.phone_verified;
  const suppliesStepDone = isSupplyChecklistSubmitted(profile);
  const dressDone = isDressCodeAgreed(profile);
  const jobDayDone = isJobDayAcknowledged(profile);
  const trainingDone = isRequiredTrainingComplete(profile);

  const supplyInventory = (profile.supply_inventory || {}) as SupplyInventory;
  const supplyScore = scoreSupplyInventory(supplyInventory);
  const homeLine = [profile.home_address, profile.home_city, profile.state, profile.home_zip]
    .filter(Boolean)
    .join(", ");

  const completed = steps.filter((s) => s.done).length;
  const total = steps.length;
  const allComplete = completed === total;
  const progressPercent = (completed / total) * 100;
  const lockMsg = (text: string) => (
    <p className="text-sm text-muted-foreground inline-flex items-center gap-1.5">
      <RiLockLine className="w-3.5 h-3.5" />
      {text}
    </p>
  );
  const LOCK_COPY: Record<CleanerSetupStepId, string> = {
    agreement: "Sign the agreement first.",
    phone: "Verify your phone first.",
    supplies: "Check off your supplies first.",
    dress_code: "Agree to the dress code first.",
    job_day: "Read the job-day journey first.",
    training: "Watch the training videos first.",
  };
  const lockFor = (id: CleanerSetupStepId) => {
    const idx = steps.findIndex((s) => s.id === id);
    const first = steps.slice(0, idx).find((s) => !s.done);
    return first ? LOCK_COPY[first.id] : "Finish the steps above first.";
  };
  const phoneUnlocked = isSetupStepUnlocked(profile, "phone");
  const suppliesUnlocked = isSetupStepUnlocked(profile, "supplies");
  const dressUnlocked = isSetupStepUnlocked(profile, "dress_code");
  const jobDayUnlocked = isSetupStepUnlocked(profile, "job_day");
  const trainingUnlocked = isSetupStepUnlocked(profile, "training");

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
                  Sign the agreement, verify your phone, check off supplies,
                  agree to the dress code, read the job-day journey, then watch
                  the training videos. You won&apos;t be offered a job until
                  that&apos;s done.
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

        {/* Step 1 — Agreement */}
        <StepCard
          number={1}
          title="Sign the contractor agreement"
          description="The Independent Contractor Agreement. Read it, sign it, and a copy is emailed to you."
          icon={RiFileTextLine}
          done={agreementDone}
          started={false}
        >
          {agreementDone ? (
            <p className="text-sm text-muted-foreground">
              Signed and on file
              {profile.ob_agreement_signed_at
                ? ` · ${new Date(profile.ob_agreement_signed_at).toLocaleDateString()}`
                : "."}
            </p>
          ) : (
            <PortalAgreementForm
              firstName={profile.first_name}
              lastName={profile.last_name}
              phone={profile.phone}
              address={homeLine}
              signedAt={profile.ob_agreement_signed_at}
              onSigned={handleAgreementSigned}
            />
          )}
        </StepCard>

        {/* Step 2 — Phone verification */}
        <StepCard
          number={2}
          title="Verify your phone number"
          description="We'll text you a 6-digit code so dispatch can reach you for job offers."
          icon={RiPhoneLine}
          done={phoneStepDone}
          started={false}
          locked={!phoneUnlocked}
        >
          {!phoneUnlocked ? (
            lockMsg(lockFor("phone"))
          ) : phoneStepDone ? (
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

        {/* Step 3 — Supply checkoff */}
        <StepCard
          number={3}
          title="Check off your supplies"
          description="Tell us what kit you already own so dispatch knows which jobs you're equipped for."
          icon={RiListCheck2}
          done={suppliesStepDone}
          started={false}
          locked={!suppliesUnlocked}
        >
          {!suppliesUnlocked ? (
            lockMsg(lockFor("supplies"))
          ) : suppliesStepDone && !suppliesOpen ? (
            <>
              <p className="text-sm text-muted-foreground">
                Submitted ·{" "}
                <span className="font-medium text-foreground">
                  {supplyScore.ownedNeeded} of {supplyScore.totalNeeded} job-needed items
                </span>{" "}
                ({supplyScore.percent}%)
                {supplyScore.ready
                  ? " — you have enough to work a standard clean."
                  : ` — ${supplyScore.threshold - supplyScore.ownedNeeded} more gets you to job-ready.`}
              </p>
              <Button variant="outline" onClick={() => setSuppliesOpen(true)}>
                <RiListCheck2 className="w-4 h-4 mr-1.5" />
                Review my supplies
              </Button>
            </>
          ) : (
            <>
              <SupplyChecklistForm
                items={SUPPLY_ITEMS}
                inventory={supplyInventory}
                submittedAt={profile.supply_checklist_submitted_at}
                onSave={handleSaveSupplies}
                variant="plain"
                saveLabel="Save my supplies"
              />
              {suppliesStepDone && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-muted-foreground"
                  onClick={() => setSuppliesOpen(false)}
                >
                  Hide checklist
                </Button>
              )}
            </>
          )}
        </StepCard>

        {/* Step 4 — Dress code */}
        <StepCard
          number={4}
          title="Agree to the dress code"
          description="What to wear on every job. You have to agree — viewing isn't enough."
          icon={RiTShirtLine}
          done={dressDone}
          started={false}
          locked={!dressUnlocked}
        >
          {!dressUnlocked ? (
            lockMsg(lockFor("dress_code"))
          ) : dressDone && !dressOpen ? (
            <>
              <p className="text-sm text-muted-foreground">
                Agreed · <span className="font-medium text-foreground">dress code</span>
              </p>
              <Button variant="outline" onClick={() => setDressOpen(true)}>
                <RiTShirtLine className="w-4 h-4 mr-1.5" />
                Look again
              </Button>
            </>
          ) : (
            <>
              <JobDayGuides
                guide={onboardingGuide("dress_code")}
                acknowledgedAt={profile.ob_dress_code_ack_at || profile.ob_job_day_guides_ack_at}
                onAcknowledge={handleAcknowledgeDressCode}
                variant="plain"
              />
              {dressDone && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-muted-foreground"
                  onClick={() => setDressOpen(false)}
                >
                  Hide this
                </Button>
              )}
            </>
          )}
        </StepCard>

        {/* Step 5 — Job-day journey */}
        <StepCard
          number={5}
          title="Read the job-day journey"
          description="What a job looks like from the offer through to getting paid."
          icon={RiRoadMapLine}
          done={jobDayDone}
          started={false}
          locked={!jobDayUnlocked}
        >
          {!jobDayUnlocked ? (
            lockMsg(lockFor("job_day"))
          ) : jobDayDone && !jobDayOpen ? (
            <>
              <p className="text-sm text-muted-foreground">
                Read · <span className="font-medium text-foreground">job-day journey</span>
              </p>
              <Button variant="outline" onClick={() => setJobDayOpen(true)}>
                <RiRoadMapLine className="w-4 h-4 mr-1.5" />
                Look again
              </Button>
            </>
          ) : (
            <>
              <JobDayGuides
                guide={onboardingGuide("job_day")}
                acknowledgedAt={profile.ob_job_day_guides_ack_at}
                onAcknowledge={handleAcknowledgeJobDay}
                variant="plain"
              />
              {jobDayDone && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-muted-foreground"
                  onClick={() => setJobDayOpen(false)}
                >
                  Hide this
                </Button>
              )}
            </>
          )}
        </StepCard>

        {/* Step 6 — Training hub */}
        <StepCard
          number={6}
          title="Watch the training videos"
          description="Seven walkthroughs of the real app. You must finish them before your first job."
          icon={RiGraduationCapLine}
          done={trainingDone}
          started={false}
          locked={!trainingUnlocked}
        >
          {!trainingUnlocked ? (
            lockMsg(lockFor("training"))
          ) : trainingDone ? (
            <>
              <p className="text-sm text-muted-foreground">
                All required walkthroughs finished. You can rewatch them anytime.
              </p>
              <Button variant="outline" onClick={() => router.push("/cleaner/training")}>
                <RiGraduationCapLine className="w-4 h-4 mr-1.5" />
                Open training hub
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Watch each clip (or run the live walkthrough) on the training
                hub. Skipping does not count.
              </p>
              <Button
                size="lg"
                onClick={() => router.push("/cleaner/training")}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                <RiGraduationCapLine className="w-4 h-4 mr-1.5" />
                Open training hub
                <RiArrowRightLine className="w-4 h-4 ml-1.5" />
              </Button>
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
                Training is done. Job offers can start coming through SMS and
                your dashboard. Earnings deposit 1–2 business days after each
                completed clean.
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
