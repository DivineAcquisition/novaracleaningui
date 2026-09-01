"use client";

// ─── Cleaner Training Portal ───────────────────────────────────────────
//
// The landing page contractors reach from:
//   1. The "Open Training Portal" CTA on /cleaner/ob-portal (step 5)
//   2. The training link inside the post-onboarding welcome SMS / email
//
// Auth-gated for cleaners. Visiting this page also stamps
// `cleaners.ob_training_accessed = true` + timestamp so the onboarding
// checklist auto-marks step 5 complete (no separate button required).
//
// Content is intentionally self-contained (no external service round-trip
// required to render). The Google Drive training library URL can be
// configured via the optional `get-contractor-training` edge function —
// when present, the page offers a "Open full library" button + embed.
// When absent or the function 404s, the page still ships a useful first
// pass of training modules + SOPs + safety guidance.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  RiAlertLine,
  RiBookOpenLine,
  RiCheckboxCircleLine,
  RiCheckLine,
  RiClipboardLine,
  RiDropLine,
  RiExternalLinkLine,
  RiGraduationCapLine,
  RiHomeSmileLine,
  RiLoader4Line,
  RiPlayCircleLine,
  RiShieldCheckLine,
  RiSparklingLine,
  RiTimeLine,
  RiToolsLine,
  RiUserSmileLine,
} from "@remixicon/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { SEO } from "@/components/SEO";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { resolveCleanerAuth, isBlockedCleanerStatus } from "@/lib/cleaner-auth";

interface TrainingConfig {
  url: string | null;
  embedUrl: string | null;
  configured: boolean;
}

interface CleanerLite {
  id: string;
  first_name: string | null;
  ob_training_accessed: boolean | null;
  ob_payouts_setup: boolean | null;
  ob_agreement_signed: boolean | null;
  ob_google_chat_joined: boolean | null;
  ob_supplies_checklist_viewed: boolean | null;
}

interface TrainingModule {
  id: string;
  title: string;
  duration: string;
  description: string;
  bullets: string[];
  icon: typeof RiPlayCircleLine;
  tone: "emerald" | "amber" | "sky" | "rose" | "violet";
}

const MODULES: TrainingModule[] = [
  {
    id: "welcome",
    title: "Welcome to Novara",
    duration: "5 min",
    description:
      "Who we are, how the business runs, and what makes a Novara cleaner different from every other cleaning gig.",
    bullets: [
      "The Novara promise — Google Guaranteed quality",
      "How dispatch, ratings, and payouts fit together",
      "Independent contractor mindset",
    ],
    icon: RiSparklingLine,
    tone: "emerald",
  },
  {
    id: "standards",
    title: "The Standard Clean checklist",
    duration: "12 min",
    description:
      "Room-by-room walkthrough of every surface, fixture, and detail that has to be touched on a Standard Clean — and why Deep and Move-In/Out are longer lists, not shorter ones.",
    bullets: [
      "Kitchen: 9 checkpoints (counters → appliance exteriors → floor → trash)",
      "Bathrooms: 9 checkpoints (mirror, tub, toilet, floor, trash)",
      "All rooms: 14 checkpoints (dust, vacuum/mop, linens, door glass)",
      "Standard is occupied-home maintenance — Deep and Move-In/Out add work on top",
    ],
    icon: RiHomeSmileLine,
    tone: "sky",
  },
  {
    id: "deep-clean",
    title: "Deep Clean & Move-In/Out",
    duration: "8 min",
    description:
      "What changes when a Standard turns into a Deep Clean or a Move-In/Out. Move is the longest list: everything in Deep, plus interiors and included fridge/oven.",
    bullets: [
      "Deep: hand-wipe instead of dust, plus under-burner and carpet-edge detail",
      "Move-In/Out: everything in Deep, plus inside cabinets, pantry, built-ins, fridge, and oven",
      "Empty homes: skip occupied-only lines (furniture, linens, rugs) with a reason",
    ],
    icon: RiToolsLine,
    tone: "violet",
  },
  {
    id: "client-interaction",
    title: "Client Interaction",
    duration: "6 min",
    description:
      "How to show up, communicate, and leave the home so the client books again — and tells their friends.",
    bullets: [
      "Arrival, intro, walkthrough scripts",
      "Handling change requests on-site",
      "The 30-second close — what to say before you leave",
    ],
    icon: RiUserSmileLine,
    tone: "amber",
  },
  {
    id: "safety",
    title: "Safety & Chemicals",
    duration: "7 min",
    description:
      "Working safely with cleaning chemicals, ladders, and the homes themselves. Includes natural-stone restrictions.",
    bullets: [
      "Never mix bleach + ammonia",
      "Natural stone (granite/marble/quartz) — pH-neutral ONLY",
      "Step stool rules, no ladders over 2 steps",
      "When to STOP and call dispatch",
    ],
    icon: RiShieldCheckLine,
    tone: "rose",
  },
  {
    id: "app",
    title: "Using the Novara App",
    duration: "6 min",
    description:
      "Accepting jobs, checking in, uploading before/after photos, completing the wrap-up form, and getting paid.",
    bullets: [
      "Job offer SMS → accept inside the app",
      "Check-in and check-out — why timestamps matter",
      "Before / after photo capture",
      "Completion wrap-up + payout timing",
    ],
    icon: RiPlayCircleLine,
    tone: "emerald",
  },
];

const SOPS = [
  {
    title: "Bathroom SOP",
    icon: RiDropLine,
    items: [
      "Pre-treat soap scum (start of visit, finish at the end)",
      "Toilet from cleanest to dirtiest (lid → bowl → base)",
      "Mirror last — wipe top to bottom in S-pattern",
    ],
  },
  {
    title: "Kitchen SOP",
    icon: RiClipboardLine,
    items: [
      "Pull everything off counters — wipe surface and items",
      "Degrease stove + range hood — let solution dwell",
      "Sink + faucet polish to a streak-free shine",
    ],
  },
  {
    title: "Living + Bedrooms SOP",
    icon: RiBookOpenLine,
    items: [
      "Top to bottom — dust then vacuum",
      "Touch every soft surface (lamps, frames, baseboards)",
      "Make the bed exactly as you found it (unless asked)",
    ],
  },
] as const;

const SAFETY_RULES = [
  "NEVER use vinegar, CLR, or citrus cleaners on natural stone.",
  "NEVER mix bleach with ammonia, vinegar, or rubbing alcohol.",
  "ALWAYS wear gloves when handling oven cleaner or disinfectant.",
  "If you smell gas, see standing water, or feel unsafe — leave and call dispatch immediately.",
];

const TONE_BG: Record<TrainingModule["tone"], string> = {
  emerald: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20",
  amber: "bg-amber-500/10 text-amber-700 border-amber-500/20",
  sky: "bg-sky-500/10 text-sky-700 border-sky-500/20",
  rose: "bg-rose-500/10 text-rose-700 border-rose-500/20",
  violet: "bg-violet-500/10 text-violet-700 border-violet-500/20",
};

export default function CleanerTrainingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [cleaner, setCleaner] = useState<CleanerLite | null>(null);
  const [config, setConfig] = useState<TrainingConfig | null>(null);
  const [openModule, setOpenModule] = useState<string | null>("welcome");
  const [completedModules, setCompletedModules] = useState<Set<string>>(
    () => new Set<string>(),
  );

  const completedCount = completedModules.size;
  const progressPercent = useMemo(
    () => Math.round((completedCount / MODULES.length) * 100),
    [completedCount],
  );

  useEffect(() => {
    void initialize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initialize = async () => {
    try {
      // resolveCleanerAuth() handles session + auto-link by email
      // + onboarding_complete auto-promote in a single round trip.
      const { cleaner: resolved, routing } = await resolveCleanerAuth();

      if (routing === "auth") {
        toast.error("Please sign in to access training");
        router.replace("/cleaner/auth");
        return;
      }
      if (!resolved) {
        toast.info("Please complete your profile first");
        router.replace("/cleaner/onboarding");
        return;
      }
      if (isBlockedCleanerStatus(resolved.status)) {
        toast.error("Your account is not currently active. Contact support.");
        router.replace("/cleaner/auth");
        return;
      }

      // Resolver only returns a subset; pull the ob_* milestone fields.
      const { data: cleanerRow, error } = await supabase
        .from("cleaners")
        .select(
          "id, first_name, ob_training_accessed, ob_payouts_setup, ob_agreement_signed, ob_google_chat_joined, ob_supplies_checklist_viewed",
        )
        .eq("id", resolved.id)
        .maybeSingle();

      if (error) throw error;
      if (!cleanerRow) {
        toast.info("Please complete your profile first");
        router.replace("/cleaner/onboarding");
        return;
      }

      setCleaner(cleanerRow as unknown as CleanerLite);

      // Auto-stamp training accessed on first visit. Don't await — non-
      // blocking; portal sync runs in the background.
      if (!cleanerRow.ob_training_accessed) {
        void supabase
          .from("cleaners")
          .update({
            ob_training_accessed: true,
            ob_training_accessed_at: new Date().toISOString(),
          })
          .eq("id", cleanerRow.id)
          .then(() => {
            void supabase.functions
              .invoke("sync-cleaner-to-ghl", { body: { cleanerId: cleanerRow.id } })
              .catch(() => null);
          });
      }

      // Restore in-page progress (per-cleaner localStorage key)
      try {
        const saved = window.localStorage.getItem(
          `novara.training.modules.${cleanerRow.id}`,
        );
        if (saved) setCompletedModules(new Set(JSON.parse(saved)));
      } catch {
        // localStorage unavailable — ignore.
      }

      // Best-effort Drive embed lookup — gracefully degrade.
      try {
        const { data } = await supabase.functions.invoke("get-contractor-training", {
          body: { mode: "open" },
        });
        if (data) setConfig(data as TrainingConfig);
      } catch {
        setConfig({ url: null, embedUrl: null, configured: false });
      }
    } catch (err) {
      console.error("[Training] load error", err);
      toast.error("Could not load training. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const markModule = (id: string) => {
    setCompletedModules((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      try {
        if (cleaner?.id) {
          window.localStorage.setItem(
            `novara.training.modules.${cleaner.id}`,
            JSON.stringify(Array.from(next)),
          );
        }
      } catch {
        // ignore
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-center space-y-4">
          <RiLoader4Line className="w-10 h-10 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground text-sm">Loading training portal…</p>
        </div>
      </div>
    );
  }

  if (!cleaner) return null;

  const allComplete = completedCount === MODULES.length;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <SEO title="Cleaner Training Portal" noindex />

      <main className="space-y-6">
        {/* Hero */}
        <section className="text-center space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
            <RiGraduationCapLine className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold font-jakarta tracking-tight">
            Welcome, {cleaner.first_name?.trim() || "team"}.
          </h1>
          <p className="text-muted-foreground text-sm max-w-md mx-auto">
            Six short modules cover everything you need to deliver a
            Novara-grade clean. Knock them out before your first job —
            most cleaners finish in under 45 minutes.
          </p>

          <div className="max-w-md mx-auto space-y-1.5 pt-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Module progress</span>
              <span className="font-semibold text-foreground">
                {completedCount} / {MODULES.length}
              </span>
            </div>
            <Progress value={progressPercent} className="h-2" />
          </div>
        </section>

        {/* All complete celebration */}
        {allComplete && (
          <Card className="border-emerald-500/30 bg-gradient-to-br from-emerald-500/5 to-primary/5">
            <CardContent className="p-5 text-center space-y-3">
              <RiCheckboxCircleLine className="w-10 h-10 text-emerald-500 mx-auto" />
              <h3 className="font-bold text-base">
                Training complete — you're cleared to clean.
              </h3>
              <p className="text-xs text-muted-foreground">
                Head back to the onboarding checklist to wrap up the final
                step, or jump straight to your dashboard.
              </p>
              <div className="flex flex-col sm:flex-row gap-2 justify-center pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => router.push("/cleaner/ob-portal")}
                >
                  Back to Onboarding
                </Button>
                <Button size="sm" onClick={() => router.push("/cleaner/dashboard")}>
                  Go to Dashboard
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Module cards */}
        <section className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground px-1">
            Training Modules
          </h2>

          {MODULES.map((mod, idx) => {
            const isCompleted = completedModules.has(mod.id);
            const isOpen = openModule === mod.id;
            const Icon = mod.icon;

            return (
              <Card
                key={mod.id}
                className={cn(
                  "border transition-all duration-200",
                  isCompleted && "border-emerald-500/30 bg-emerald-500/[0.02]",
                  isOpen && !isCompleted && "border-primary/40 shadow-md",
                )}
              >
                <CardContent className="p-0">
                  <button
                    type="button"
                    onClick={() => setOpenModule(isOpen ? null : mod.id)}
                    className="w-full text-left p-4 flex items-center gap-3"
                  >
                    <div
                      className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border",
                        TONE_BG[mod.tone],
                      )}
                    >
                      {isCompleted ? (
                        <RiCheckboxCircleLine className="w-5 h-5" />
                      ) : (
                        <Icon className="w-5 h-5" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                          Module {idx + 1}
                        </span>
                        <span className="text-muted-foreground/40">·</span>
                        <span className="text-[10px] font-semibold text-muted-foreground flex items-center gap-1">
                          <RiTimeLine className="w-3 h-3" />
                          {mod.duration}
                        </span>
                        {isCompleted && (
                          <Badge
                            variant="secondary"
                            className="bg-emerald-500/10 text-emerald-600 text-[10px] px-1.5 py-0 ml-1"
                          >
                            Done
                          </Badge>
                        )}
                      </div>
                      <h3 className="font-semibold text-sm mt-0.5 truncate">
                        {mod.title}
                      </h3>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 sm:line-clamp-none">
                        {mod.description}
                      </p>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="px-4 pb-4 -mt-1 space-y-3 animate-in slide-in-from-top-1 duration-200">
                      <Separator />
                      <ul className="space-y-1.5 pt-1">
                        {mod.bullets.map((b, i) => (
                          <li
                            key={i}
                            className="text-xs flex items-start gap-2 text-foreground/90"
                          >
                            <RiCheckLine className="w-3.5 h-3.5 text-primary flex-shrink-0 mt-0.5" />
                            <span>{b}</span>
                          </li>
                        ))}
                      </ul>

                      <div className="flex flex-col sm:flex-row gap-2 pt-1">
                        <Button
                          size="sm"
                          variant={isCompleted ? "outline" : "default"}
                          onClick={() => markModule(mod.id)}
                          className="flex-1"
                        >
                          {isCompleted ? (
                            <>
                              <RiCheckboxCircleLine className="w-4 h-4 mr-2" />
                              Marked complete
                            </>
                          ) : (
                            <>
                              <RiCheckLine className="w-4 h-4 mr-2" />
                              Mark module complete
                            </>
                          )}
                        </Button>
                        {idx < MODULES.length - 1 && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setOpenModule(MODULES[idx + 1].id)}
                          >
                            Next module →
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </section>

        {/* Optional embedded library */}
        {config?.configured && (config.embedUrl || config.url) && (
          <section className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground px-1">
              Video Library
            </h2>
            <Card className="overflow-hidden">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">
                      Novara Drive — full training library
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Watch every module video, SOP, and demo recording.
                    </CardDescription>
                  </div>
                  {config.url && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        window.open(config.url!, "_blank", "noopener,noreferrer")
                      }
                      className="gap-2 flex-shrink-0"
                    >
                      Open
                      <RiExternalLinkLine className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </CardHeader>
              {config.embedUrl && (
                <CardContent className="p-0">
                  <div
                    className="relative w-full bg-muted/30"
                    style={{ paddingBottom: "62%" }}
                  >
                    <iframe
                      src={config.embedUrl}
                      className="absolute inset-0 w-full h-full border-0"
                      title="Cleaner training (Google Drive)"
                      allow="autoplay; encrypted-media; fullscreen"
                      allowFullScreen
                    />
                  </div>
                </CardContent>
              )}
            </Card>
          </section>
        )}

        {/* SOPs */}
        <section className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground px-1">
            Quick-Reference SOPs
          </h2>
          <div className="grid sm:grid-cols-3 gap-3">
            {SOPS.map((sop) => {
              const Icon = sop.icon;
              return (
                <Card key={sop.title} className="border-border/60">
                  <CardContent className="p-4 space-y-2">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Icon className="w-4 h-4 text-primary" />
                    </div>
                    <h3 className="text-sm font-semibold">{sop.title}</h3>
                    <ul className="space-y-1">
                      {sop.items.map((item, i) => (
                        <li
                          key={i}
                          className="text-[11px] text-muted-foreground flex items-start gap-1.5 leading-snug"
                        >
                          <span className="text-primary mt-1">•</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        {/* Safety rules */}
        <Card className="border-rose-500/30 bg-rose-500/5">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2">
              <RiAlertLine className="w-5 h-5 text-rose-600" />
              <h3 className="font-bold text-sm text-rose-700">
                Non-negotiable safety rules
              </h3>
            </div>
            <ul className="space-y-1.5">
              {SAFETY_RULES.map((rule, i) => (
                <li
                  key={i}
                  className="text-[11px] text-rose-900/80 flex items-start gap-1.5 leading-snug"
                >
                  <RiCheckLine className="w-3 h-3 text-rose-600 mt-1 flex-shrink-0" />
                  <span>{rule}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* Footer */}
        <p className="text-xs text-center text-muted-foreground pb-8">
          Stuck on a module? Email{" "}
          <a
            href="mailto:support@novaracleaning.com"
            className="text-primary hover:underline"
          >
            support@novaracleaning.com
          </a>{" "}
          and a Novara team lead will jump on it.
        </p>
      </main>
    </div>
  );
}
