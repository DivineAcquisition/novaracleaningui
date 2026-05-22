"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  RiGraduationCapLine,
  RiArrowLeftLine,
  RiExternalLinkLine,
  RiLoader4Line,
  RiAlertLine,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SEO } from "@/components/SEO";
import { supabase } from "@/integrations/supabase/client";

interface TrainingConfig {
  url: string | null;
  embedUrl: string | null;
  configured: boolean;
}

export default function CleanerTrainingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<TrainingConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      try {
        // Gate on auth — cleaner-only page.
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          router.replace("/cleaner/auth");
          return;
        }
        const { data, error: invokeError } = await supabase.functions.invoke(
          "get-contractor-training",
          { body: { mode: "open" } },
        );
        if (invokeError) throw invokeError;
        setConfig(data as TrainingConfig);
      } catch (err: any) {
        setError(err?.message || "Failed to load training portal");
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-3">
          <RiLoader4Line className="w-8 h-8 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground">Loading training portal…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="Cleaner Training Portal — Novara"
        description="Training videos, SOPs, and certifications for Novara Cleaning contractors."
        canonical="https://contractor.novaracleaning.com/cleaner/training"
      />
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/cleaner/ob-portal")}
            className="gap-2"
          >
            <RiArrowLeftLine className="w-4 h-4" />
            Back to checklist
          </Button>
          <div className="flex items-center gap-2">
            <RiGraduationCapLine className="w-5 h-5 text-primary" />
            <h1 className="font-semibold">Training Portal</h1>
          </div>
          {config?.url && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(config.url!, "_blank", "noopener,noreferrer")}
              className="gap-2"
            >
              Open in Drive
              <RiExternalLinkLine className="w-4 h-4" />
            </Button>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {error && (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardHeader>
              <CardTitle className="text-destructive flex items-center gap-2">
                <RiAlertLine className="w-5 h-5" />
                Couldn't load training portal
              </CardTitle>
              <CardDescription>{error}</CardDescription>
            </CardHeader>
          </Card>
        )}

        {!error && config && !config.configured && (
          <Card>
            <CardHeader>
              <CardTitle>Training portal isn't set up yet</CardTitle>
              <CardDescription>
                Your training materials are coming soon. Reach out to{" "}
                <a href="mailto:support@novaracleaning.com" className="underline">support@novaracleaning.com</a>{" "}
                if you need access in the meantime.
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {!error && config?.configured && config.embedUrl && (
          <Card className="overflow-hidden">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle>Novara Contractor Training</CardTitle>
                  <CardDescription>
                    Watch videos, review SOPs, and complete every module before your first job.
                  </CardDescription>
                </div>
                <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                  Auto-tracked
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="relative w-full" style={{ paddingBottom: "75%" }}>
                <iframe
                  src={config.embedUrl}
                  className="absolute inset-0 w-full h-full border-0"
                  title="Cleaner Training (Google Drive)"
                  allow="autoplay; encrypted-media; fullscreen"
                  allowFullScreen
                />
              </div>
            </CardContent>
          </Card>
        )}

        {!error && config?.configured && !config.embedUrl && config.url && (
          <Card>
            <CardHeader>
              <CardTitle>Novara Contractor Training</CardTitle>
              <CardDescription>
                Your training library lives in Google Drive. Click below to open it in a new tab —
                we'll automatically mark this step complete on your onboarding checklist.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                size="lg"
                onClick={() => window.open(config.url!, "_blank", "noopener,noreferrer")}
                className="gap-2"
              >
                <RiGraduationCapLine className="w-5 h-5" />
                Open Training Drive
                <RiExternalLinkLine className="w-4 h-4 ml-1" />
              </Button>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
