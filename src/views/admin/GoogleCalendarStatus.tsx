"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  RiCalendarCheckLine,
  RiCalendarLine,
  RiErrorWarningLine,
  RiExternalLinkLine,
  RiLoader4Line,
  RiRefreshLine,
  RiSparklingLine,
} from "@remixicon/react";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { SEO } from "@/components/SEO";

interface HealthResponse {
  ok: boolean;
  step?: string;
  http_status?: number;
  error?: string;
  hint?: string;
  fix_url?: string;
  calendar_id?: string;
  service_account_email?: string;
  calendar_summary?: string;
  calendar_timezone?: string;
  upcoming_events_count?: number;
  upcoming_events?: { summary: string; start: string; end: string; html_link: string }[];
  checked_at?: string;
}

const HEALTH_URL = "https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/google-calendar-health";

export default function GoogleCalendarStatus() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [missingCount, setMissingCount] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(HEALTH_URL);
      const json = await res.json();
      setHealth(json);
    } catch (err) {
      setHealth({ ok: false, step: "fetch", error: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }

    // Count confirmed future bookings missing an event id
    try {
      const { count } = await supabase
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("status", "confirmed")
        .is("google_calendar_event_id", null)
        .gte("service_date", new Date().toISOString().slice(0, 10));
      setMissingCount(count ?? 0);
    } catch {
      setMissingCount(null);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-google-calendar");
      if (error) throw new Error(error.message);
      toast.success(`Sync done. ${(data as any)?.eventsProcessed ?? 0} events scanned.`);
      await refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Sync failed: ${msg}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleBackfill = async () => {
    setBackfilling(true);
    try {
      const { data: rows, error } = await supabase
        .from("bookings")
        .select("id")
        .eq("status", "confirmed")
        .is("google_calendar_event_id", null)
        .gte("service_date", new Date().toISOString().slice(0, 10))
        .limit(50);
      if (error) throw error;
      const ids = (rows || []).map((r) => r.id);
      let ok = 0;
      let fail = 0;
      for (const id of ids) {
        try {
          await supabase.functions.invoke("create-google-calendar-event", { body: { bookingId: id } });
          ok += 1;
        } catch {
          fail += 1;
        }
      }
      toast.success(`Backfill done — ${ok} created${fail ? `, ${fail} failed` : ""}.`);
      await refresh();
    } catch (err) {
      toast.error(`Backfill failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBackfilling(false);
    }
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <SEO title="Google Calendar Status" description="Diagnose and manage the Google Calendar integration." noindex />
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="space-y-1">
          <h1 className="font-jakarta text-2xl font-bold">Google Calendar</h1>
          <p className="text-sm text-muted-foreground">
            Two-way sync between Novara bookings and your shared Google Calendar.
          </p>
        </div>

        {/* Connection status card */}
        <Card className="overflow-hidden border-primary/20 shadow-md">
          <CardHeader className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-xl",
                    loading
                      ? "bg-muted text-muted-foreground"
                      : health?.ok
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-destructive/10 text-destructive",
                  )}
                >
                  {loading ? (
                    <RiLoader4Line className="h-5 w-5 animate-spin" />
                  ) : health?.ok ? (
                    <RiCalendarCheckLine className="h-5 w-5" />
                  ) : (
                    <RiErrorWarningLine className="h-5 w-5" />
                  )}
                </div>
                <div>
                  <CardTitle className="text-lg">
                    {loading ? "Checking…" : health?.ok ? "Connected & Healthy" : "Not Connected"}
                  </CardTitle>
                  <CardDescription>
                    {health?.checked_at
                      ? `Last checked ${format(new Date(health.checked_at), "MMM d, h:mm a")}`
                      : "Live health check"}
                  </CardDescription>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={refresh}
                disabled={loading}
                className="shrink-0 rounded-full"
              >
                <RiRefreshLine className={cn("mr-1.5 h-3.5 w-3.5", loading && "animate-spin")} />
                Re-check
              </Button>
            </div>
          </CardHeader>

          <CardContent className="space-y-4 p-5">
            {/* Credentials in use */}
            <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3 text-xs">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Service account</span>
                <code className="break-all text-right font-mono">
                  {health?.service_account_email || "—"}
                </code>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Calendar ID</span>
                <code className="break-all text-right font-mono">
                  {health?.calendar_id ? `${health.calendar_id.slice(0, 28)}…` : "—"}
                </code>
              </div>
              {health?.calendar_summary && (
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Calendar name</span>
                  <span className="font-medium">{health.calendar_summary}</span>
                </div>
              )}
              {health?.calendar_timezone && (
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Timezone</span>
                  <span>{health.calendar_timezone}</span>
                </div>
              )}
            </div>

            {/* Error / hint */}
            {!loading && !health?.ok && (
              <Alert variant="destructive">
                <RiErrorWarningLine className="h-4 w-4" />
                <AlertDescription className="space-y-2 text-xs">
                  <div>
                    <strong>Step failed:</strong> {health?.step || "unknown"}
                    {health?.http_status ? ` (HTTP ${health.http_status})` : ""}
                  </div>
                  <div className="break-words">{health?.error}</div>
                  {health?.hint && (
                    <div className="rounded-md bg-background/60 p-2 text-foreground">
                      <strong>Fix:</strong> {health.hint}
                    </div>
                  )}
                  {health?.fix_url && (
                    <Button
                      variant="default"
                      size="sm"
                      asChild
                      className="mt-2"
                    >
                      <a href={health.fix_url} target="_blank" rel="noopener noreferrer">
                        <RiExternalLinkLine className="mr-1.5 h-3.5 w-3.5" />
                        Open Fix URL
                      </a>
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {/* Upcoming events preview */}
            {health?.ok && (health.upcoming_events?.length ?? 0) > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Next {health.upcoming_events?.length} events on the calendar
                </p>
                <div className="space-y-1.5">
                  {health.upcoming_events?.map((ev, i) => (
                    <a
                      key={i}
                      href={ev.html_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs hover:bg-muted"
                    >
                      <div className="flex items-center gap-2">
                        <RiCalendarLine className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="font-medium">{ev.summary || "(untitled)"}</span>
                      </div>
                      <span className="text-muted-foreground">
                        {ev.start ? format(new Date(ev.start), "MMM d · h:mm a") : ""}
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            )}
            {health?.ok && (health.upcoming_events?.length ?? 0) === 0 && (
              <p className="text-xs text-muted-foreground">No upcoming events on the calendar yet.</p>
            )}
          </CardContent>
        </Card>

        {/* Operations */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Operations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Backfill */}
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
              <div>
                <p className="text-sm font-semibold">Backfill missing calendar events</p>
                <p className="text-xs text-muted-foreground">
                  {missingCount === null
                    ? "Counting…"
                    : missingCount === 0
                      ? "All confirmed bookings already have a calendar event."
                      : `${missingCount} confirmed future booking(s) missing a calendar event.`}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleBackfill}
                disabled={!health?.ok || !missingCount || backfilling}
              >
                {backfilling ? <RiLoader4Line className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RiSparklingLine className="mr-1.5 h-3.5 w-3.5" />}
                Backfill {missingCount || ""}
              </Button>
            </div>

            {/* Manual sync */}
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
              <div>
                <p className="text-sm font-semibold">Sync availability from Google</p>
                <p className="text-xs text-muted-foreground">
                  Pulls upcoming events and blocks any overlapping slots. Runs automatically every 15 min.
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={handleSync} disabled={!health?.ok || syncing}>
                {syncing ? <RiLoader4Line className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RiRefreshLine className="mr-1.5 h-3.5 w-3.5" />}
                Sync now
              </Button>
            </div>

            <Separator />

            <div className="space-y-1 text-[11px] text-muted-foreground">
              <p>
                <strong>Cron:</strong> <code>sync-google-calendar-every-15min</code> · runs every 15 min via pg_cron.
              </p>
              <p>
                <strong>Lifecycle:</strong> Stripe payment_succeeded → creates event · Reschedule → updates event · Cancel
                → deletes event. All automatic.
              </p>
              <p>
                <strong>Setup guide:</strong>{" "}
                <code className="rounded bg-muted px-1 py-0.5">docs/google-calendar/setup-guide.md</code>
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Tag the role badge clearly */}
        <div className="flex items-center justify-center">
          <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
            Admin · System Integration
          </Badge>
        </div>
      </div>
    </div>
  );
}
