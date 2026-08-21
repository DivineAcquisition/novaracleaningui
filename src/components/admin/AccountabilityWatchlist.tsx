"use client";

// ─── Accountability watchlist (admin dashboard panel) ────────────────────
//
// Surfaces the cleaners who need review: currently suspended, carrying
// active strikes, and repeat offenders (multiple strikes inside the review
// window even if some expired). Data comes from the cleaner-accountability
// edge function's dashboard action, which also runs the auto-restore/expiry
// sweep so the panel is always truthful.

import { useCallback, useEffect, useState } from "react";
import { RiAlarmWarningLine, RiLoader4Line, RiPauseCircleLine, RiRepeatLine } from "@remixicon/react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface SuspendedEntry {
  cleanerId: string;
  name: string;
  suspendedUntil: string | null;
  reason: string | null;
  activeStrikes: number;
}
interface StrikeEntry {
  cleanerId: string;
  name: string;
  status: string;
  activeStrikes: number;
  latestStrikeAt: string;
}
interface RepeatEntry {
  cleanerId: string;
  name: string;
  status: string;
  strikesInWindow: number;
  windowDays: number;
}
interface RepeatRecleanEntry {
  cleanerId: string;
  name: string;
  status: string;
  qualityMissRecleans: number;
  windowDays: number;
}

const fmtDT = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";

export default function AccountabilityWatchlist({
  onSelectCleaner,
}: {
  onSelectCleaner?: (cleanerId: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [suspended, setSuspended] = useState<SuspendedEntry[]>([]);
  const [activeStrikes, setActiveStrikes] = useState<StrikeEntry[]>([]);
  const [repeatOffenders, setRepeatOffenders] = useState<RepeatEntry[]>([]);
  const [repeatRecleans, setRepeatRecleans] = useState<RepeatRecleanEntry[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("cleaner-accountability", {
        body: { action: "dashboard" },
      });
      if (error) throw error;
      const d = data as {
        ok?: boolean;
        suspended?: SuspendedEntry[];
        activeStrikes?: StrikeEntry[];
        repeatOffenders?: RepeatEntry[];
        repeatQualityMissRecleans?: RepeatRecleanEntry[];
      };
      if (d?.ok === false) return;
      setSuspended(d.suspended || []);
      setActiveStrikes(d.activeStrikes || []);
      setRepeatOffenders(d.repeatOffenders || []);
      setRepeatRecleans(d.repeatQualityMissRecleans || []);
    } catch {
      // Watchlist is advisory — never block the directory on it.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <Card className="border-slate-200">
        <CardContent className="p-4 flex items-center gap-2 text-sm text-slate-400">
          <RiLoader4Line className="w-4 h-4 animate-spin" /> Loading accountability watchlist…
        </CardContent>
      </Card>
    );
  }

  const empty = suspended.length === 0 && activeStrikes.length === 0 && repeatOffenders.length === 0 && repeatRecleans.length === 0;
  if (empty) return null; // nothing to review — keep the directory clean

  const Row = ({ id, children }: { id: string; children: React.ReactNode }) => (
    <button
      type="button"
      onClick={() => onSelectCleaner?.(id)}
      className={cn(
        "w-full text-left rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs flex flex-wrap items-center gap-1.5",
        onSelectCleaner && "hover:border-violet-300 hover:shadow-sm transition-all",
      )}
    >
      {children}
    </button>
  );

  return (
    <Card className="border-amber-200 bg-amber-50/30">
      <CardContent className="p-4">
        <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5 mb-3">
          <RiAlarmWarningLine className="w-4 h-4 text-amber-600" /> Accountability watchlist
        </p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="space-y-1.5">
            <p className="text-[11px] uppercase tracking-wide font-semibold text-orange-700 flex items-center gap-1">
              <RiPauseCircleLine className="w-3.5 h-3.5" /> Suspended ({suspended.length})
            </p>
            {suspended.length === 0 && <p className="text-xs text-slate-400">None.</p>}
            {suspended.map((s) => (
              <Row key={s.cleanerId} id={s.cleanerId}>
                <span className="font-semibold text-slate-800">{s.name}</span>
                <Badge className="bg-orange-100 text-orange-800 border-0 text-[10px] ml-auto">
                  until {fmtDT(s.suspendedUntil)}
                </Badge>
              </Row>
            ))}
          </div>
          <div className="space-y-1.5">
            <p className="text-[11px] uppercase tracking-wide font-semibold text-amber-700 flex items-center gap-1">
              <RiAlarmWarningLine className="w-3.5 h-3.5" /> Active strikes ({activeStrikes.length})
            </p>
            {activeStrikes.length === 0 && <p className="text-xs text-slate-400">None.</p>}
            {activeStrikes.map((s) => (
              <Row key={s.cleanerId} id={s.cleanerId}>
                <span className="font-semibold text-slate-800">{s.name}</span>
                <Badge className={cn(
                  "border-0 text-[10px] ml-auto",
                  s.activeStrikes >= 3 ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800",
                )}>
                  {s.activeStrikes} strike{s.activeStrikes === 1 ? "" : "s"}
                </Badge>
              </Row>
            ))}
          </div>
          <div className="space-y-1.5">
            <p className="text-[11px] uppercase tracking-wide font-semibold text-rose-700 flex items-center gap-1">
              <RiRepeatLine className="w-3.5 h-3.5" /> Repeat offenders ({repeatOffenders.length})
            </p>
            {repeatOffenders.length === 0 && <p className="text-xs text-slate-400">None.</p>}
            {repeatOffenders.map((s) => (
              <Row key={s.cleanerId} id={s.cleanerId}>
                <span className="font-semibold text-slate-800">{s.name}</span>
                <Badge className="bg-rose-100 text-rose-700 border-0 text-[10px] ml-auto">
                  {s.strikesInWindow} in {s.windowDays}d
                </Badge>
              </Row>
            ))}
          </div>
          <div className="space-y-1.5">
            <p className="text-[11px] uppercase tracking-wide font-semibold text-violet-700 flex items-center gap-1">
              <RiRepeatLine className="w-3.5 h-3.5" /> Quality-miss re-cleans ({repeatRecleans.length})
            </p>
            {repeatRecleans.length === 0 && <p className="text-xs text-slate-400">None.</p>}
            {repeatRecleans.map((s) => (
              <Row key={s.cleanerId} id={s.cleanerId}>
                <span className="font-semibold text-slate-800">{s.name}</span>
                <Badge className="bg-violet-100 text-violet-800 border-0 text-[10px] ml-auto">
                  {s.qualityMissRecleans} in {s.windowDays}d
                </Badge>
              </Row>
            ))}
          </div>
        </div>
        <p className="text-[10px] text-slate-400 mt-3">
          Repeat offenders count all strikes in the window, including expired ones — patterns matter.
          Repeat quality-miss re-cleans are a coaching signal; nothing auto-penalizes.
          Click a cleaner to open their record.
        </p>
      </CardContent>
    </Card>
  );
}
