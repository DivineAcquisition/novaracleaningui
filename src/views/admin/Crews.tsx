"use client";

// ─── /admin/crews — Cleaner crews / groups ──────────────────────────────────
//
// Organise cleaners into named crews with a lead. A crew powers the contractor
// portal "hand the clean to someone in my crew" action: a cleaner can only
// re-assign their job to another active member of the SAME crew.

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  RiLoader4Line, RiGroup2Line, RiAddLine, RiCloseLine, RiUserAddLine,
  RiDeleteBinLine, RiStarLine, RiUserUnfollowLine,
} from "@remixicon/react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Crew {
  id: string; name: string; lead_cleaner_id: string | null; notes: string | null; active: boolean;
}
interface Cleaner {
  id: string; first_name: string | null; last_name: string | null; status: string | null; crew_id: string | null;
}

const name = (c?: Cleaner | null) => (c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Cleaner" : "—");

export default function AdminCrews() {
  const [loading, setLoading] = useState(true);
  const [crews, setCrews] = useState<Crew[]>([]);
  const [cleaners, setCleaners] = useState<Cleaner[]>([]);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: cr }, { data: cl }] = await Promise.all([
      (supabase.from as any)("crews").select("*").order("created_at", { ascending: true }),
      (supabase.from as any)("cleaners").select("id, first_name, last_name, status, crew_id").order("first_name"),
    ]);
    setCrews((cr as Crew[]) || []);
    setCleaners((cl as Cleaner[]) || []);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const byCrew = useMemo(() => {
    const m: Record<string, Cleaner[]> = {};
    for (const c of cleaners) {
      if (c.crew_id) (m[c.crew_id] ||= []).push(c);
    }
    return m;
  }, [cleaners]);

  const unassigned = useMemo(
    () => cleaners.filter((c) => !c.crew_id && (c.status === "active" || c.status == null)),
    [cleaners],
  );

  const createCrew = async () => {
    if (!newName.trim()) { toast.error("Name the crew first."); return; }
    setCreating(true);
    const { error } = await (supabase.from as any)("crews").insert({ name: newName.trim() });
    setCreating(false);
    if (error) { toast.error(error.message); return; }
    setNewName("");
    toast.success("Crew created.");
    load();
  };

  const assignCleaner = async (cleanerId: string, crewId: string | null) => {
    setBusy(cleanerId);
    const { error } = await (supabase.from as any)("cleaners").update({ crew_id: crewId }).eq("id", cleanerId);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    load();
  };

  const patchCrew = async (id: string, fields: Record<string, unknown>) => {
    const { error } = await (supabase.from as any)("crews").update(fields).eq("id", id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  const deleteCrew = async (id: string) => {
    if (!confirm("Delete this crew? Members will be unassigned.")) return;
    setBusy(id);
    // Unassign members first (FK is ON DELETE SET NULL, but do it explicitly
    // so the UI reflects it immediately and is order-independent).
    await (supabase.from as any)("cleaners").update({ crew_id: null }).eq("crew_id", id);
    const { error } = await (supabase.from as any)("crews").delete().eq("id", id);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Crew deleted.");
    load();
  };

  if (loading) return <div className="flex justify-center py-20"><RiLoader4Line className="w-8 h-8 animate-spin text-primary" /></div>;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <RiGroup2Line className="w-6 h-6 text-violet-700" /> Crews
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Group cleaners into crews with a lead. A lead can hand any of their cleans to another active member of the same crew from the contractor portal.
        </p>
      </div>

      <Card className="border-violet-200">
        <CardHeader className="pb-2"><CardTitle className="text-base">New crew</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-2">
          <Input placeholder="Crew name (e.g. North Team)" value={newName} className="max-w-xs"
            onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createCrew()} />
          <Button onClick={createCrew} disabled={creating}>
            {creating ? <RiLoader4Line className="w-4 h-4 animate-spin mr-1.5" /> : <RiAddLine className="w-4 h-4 mr-1.5" />}
            Create crew
          </Button>
        </CardContent>
      </Card>

      {crews.length === 0 && (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No crews yet. Create one above.</CardContent></Card>
      )}

      {crews.map((crew) => {
        const members = byCrew[crew.id] || [];
        const lead = members.find((m) => m.id === crew.lead_cleaner_id) || null;
        return (
          <Card key={crew.id} className={crew.active ? "" : "bg-slate-50/60"}>
            <CardContent className="py-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Input
                    defaultValue={crew.name}
                    className="h-8 font-semibold text-sm max-w-[220px]"
                    onBlur={(e) => e.target.value.trim() && e.target.value !== crew.name && patchCrew(crew.id, { name: e.target.value.trim() })}
                  />
                  <Badge className="bg-slate-100 text-slate-600 text-[11px]">{members.length} member{members.length === 1 ? "" : "s"}</Badge>
                  {lead && <Badge className="bg-amber-100 text-amber-700 text-[11px]"><RiStarLine className="w-3 h-3 mr-0.5" />Lead: {name(lead)}</Badge>}
                </div>
                <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700" disabled={busy === crew.id} onClick={() => deleteCrew(crew.id)}>
                  <RiDeleteBinLine className="w-4 h-4" />
                </Button>
              </div>

              {members.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {members.map((m) => (
                    <span key={m.id} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white pl-2.5 pr-1 py-1 text-xs">
                      {name(m)}
                      {crew.lead_cleaner_id === m.id ? (
                        <Badge className="bg-amber-100 text-amber-700 text-[10px] h-4 px-1">Lead</Badge>
                      ) : (
                        <button className="text-slate-400 hover:text-amber-600" title="Make lead" onClick={() => patchCrew(crew.id, { lead_cleaner_id: m.id })}>
                          <RiStarLine className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button className="text-slate-400 hover:text-red-600" title="Remove from crew" disabled={busy === m.id} onClick={() => assignCleaner(m.id, null)}>
                        <RiUserUnfollowLine className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2 border-t pt-3">
                <RiUserAddLine className="w-4 h-4 text-slate-400" />
                <Select value="" onValueChange={(v) => v && assignCleaner(v, crew.id)}>
                  <SelectTrigger className="h-8 w-[220px] text-xs"><SelectValue placeholder="Add a cleaner…" /></SelectTrigger>
                  <SelectContent>
                    {unassigned.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">No unassigned cleaners</div>}
                    {unassigned.map((c) => <SelectItem key={c.id} value={c.id}>{name(c)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        );
      })}

      {unassigned.length > 0 && (
        <Card className="border-dashed">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-slate-500">Unassigned cleaners ({unassigned.length})</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-1.5">
            {unassigned.map((c) => (
              <Badge key={c.id} className="bg-slate-100 text-slate-600 text-[11px]">{name(c)}</Badge>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
