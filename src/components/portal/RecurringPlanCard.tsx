"use client";

// Customer-facing recurring plan management (member portal / My Account).
// Reads the customer's recurring schedule and lets them pause/resume, skip the
// next clean, change their time window, or request a different cleaner — all
// via the customer-manage-recurring edge function (auth-gated to their email).

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { RiRepeatLine, RiLoader4Line, RiPauseLine, RiPlayLine, RiSkipForwardLine, RiUserStarLine } from "@remixicon/react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Schedule {
  id: string; cadence: string; preferred_time_slot: string | null; preferred_cleaner_id: string | null;
  next_service_date: string | null; active: boolean;
}
interface Upcoming { id: string; service_date: string; time_slot: string | null; status: string; }

const TIME_SLOTS = [
  "8:00 AM - 9:00 AM", "9:00 AM - 10:00 AM", "10:00 AM - 11:00 AM", "11:00 AM - 12:00 PM",
  "12:00 PM - 1:00 PM", "1:00 PM - 2:00 PM", "2:00 PM - 3:00 PM", "3:00 PM - 4:00 PM",
  "4:00 PM - 5:00 PM", "5:00 PM - 6:00 PM",
];
const cadenceLabel: Record<string, string> = { weekly: "Weekly", biweekly: "Every 2 weeks", monthly: "Monthly" };

export function RecurringPlanCard() {
  const [loading, setLoading] = useState(true);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [upcoming, setUpcoming] = useState<Upcoming[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("customer-manage-recurring", { body: { action: "get" } });
      if (error) throw error;
      setSchedule((data as any)?.schedule || null);
      setUpcoming(((data as any)?.upcoming as Upcoming[]) || []);
    } catch {
      setSchedule(null);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const act = async (action: string, extra?: Record<string, unknown>, successMsg?: string) => {
    setBusy(action);
    try {
      const { data, error } = await supabase.functions.invoke("customer-manage-recurring", { body: { action, ...extra } });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(successMsg || "Updated");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (loading) return null;
  if (!schedule) return null; // not a recurring customer — render nothing

  return (
    <Card className="animate-fade-in-up shadow-md border-primary/15 overflow-hidden">
      <div className="h-0.5 w-full" style={{ background: "var(--gradient-primary)" }} />
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "var(--gradient-primary)" }}>
              <RiRepeatLine className="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <span className="font-semibold text-sm">Recurring cleaning</span>
              <p className="text-[11px] text-muted-foreground">{cadenceLabel[schedule.cadence] || schedule.cadence}</p>
            </div>
          </div>
          <Badge className={schedule.active ? "bg-emerald-100 text-emerald-700 text-xs" : "bg-slate-200 text-slate-600 text-xs"}>
            {schedule.active ? "Active" : "Paused"}
          </Badge>
        </div>

        <div className="rounded-lg bg-muted/50 p-3 mb-3 text-sm">
          <p className="text-muted-foreground text-xs">Next clean</p>
          <p className="font-semibold">
            {schedule.next_service_date ? format(new Date(`${schedule.next_service_date}T12:00:00`), "EEEE, MMM d") : "—"}
            {schedule.preferred_time_slot ? ` · ${schedule.preferred_time_slot}` : ""}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {schedule.preferred_cleaner_id ? "Your regular cleaner is reserved" : "Next available cleaner"}
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-20">Time</span>
            <Select value={schedule.preferred_time_slot || ""} onValueChange={(v) => act("set_time", { preferred_time_slot: v }, "Time window updated")}>
              <SelectTrigger className="h-9 flex-1"><SelectValue placeholder="Choose a time" /></SelectTrigger>
              <SelectContent>{TIME_SLOTS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="sm" disabled={busy === "skip_next"} onClick={() => act("skip_next", undefined, "Next clean skipped")}>
              <RiSkipForwardLine className="w-4 h-4 mr-1.5" /> Skip next
            </Button>
            {schedule.active ? (
              <Button variant="outline" size="sm" disabled={busy === "pause"} onClick={() => act("pause", undefined, "Recurring paused")}>
                <RiPauseLine className="w-4 h-4 mr-1.5" /> Pause
              </Button>
            ) : (
              <Button size="sm" disabled={busy === "resume"} onClick={() => act("resume", undefined, "Recurring resumed")}>
                <RiPlayLine className="w-4 h-4 mr-1.5" /> Resume
              </Button>
            )}
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="w-full text-muted-foreground"
            disabled={busy === "request_new_cleaner"}
            onClick={() => act("request_new_cleaner", undefined, "We'll assign a new cleaner for your next clean")}
          >
            <RiUserStarLine className="w-4 h-4 mr-1.5" /> Request a different cleaner
          </Button>
        </div>

        {upcoming.length > 0 && (
          <div className="mt-3 border-t pt-2">
            <p className="text-[11px] text-muted-foreground mb-1">Upcoming</p>
            <div className="space-y-1">
              {upcoming.slice(0, 3).map((u) => (
                <div key={u.id} className="flex items-center justify-between text-xs">
                  <span>{format(new Date(`${u.service_date}T12:00:00`), "EEE, MMM d")}{u.time_slot ? ` · ${u.time_slot}` : ""}</span>
                  <Badge variant="outline" className="text-[10px] capitalize">{u.status.replace(/_/g, " ")}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
