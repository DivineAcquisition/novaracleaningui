"use client";

import { useEffect, useMemo, useState } from "react";
import {
  RiCalendarCheckLine,
  RiExternalLinkLine,
  RiFileCopyLine,
  RiLoader4Line,
  RiMailSendLine,
  RiSearch2Line,
  RiUserStarLine,
} from "@remixicon/react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { PROPOSAL_STATUS_LABELS, walkthroughLink, walkthroughStaffPath, type ProposalRequestStatus } from "@/lib/proposal-request";
import { proposalApi } from "@/lib/proposal-request-api";

interface SiteRow {
  id: string;
  nickname?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  walkthrough_id?: string | null;
  client_stated_sqft?: number | null;
  assignment_token?: string | null;
  walkthrough_status?: string | null;
  pdf_url?: string | null;
}

interface RequestRow {
  id: string;
  property_type_key: string;
  status: ProposalRequestStatus;
  status_label?: string;
  requester_name: string;
  requester_company?: string | null;
  requester_email: string;
  requester_phone?: string | null;
  desired_frequency?: string | null;
  created_at: string;
  scheduled_at?: string | null;
  assigned_cleaner_id?: string | null;
  business_account_id?: string | null;
  sites: SiteRow[];
}

const STATUS_CHIP: Record<string, string> = {
  pending_assign: "bg-amber-100 text-amber-800",
  walkthrough_scheduled: "bg-blue-100 text-blue-700",
  walkthrough_conducted: "bg-violet-100 text-violet-800",
  firm_price_set: "bg-emerald-100 text-emerald-800",
  excluded: "bg-rose-100 text-rose-800",
  cancelled: "bg-slate-100 text-slate-500",
};

interface Candidate {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  novara_score: number | null;
  home_zip: string | null;
  distance_miles: number | null;
  match_score: number;
  available: boolean;
  reason?: string;
}

export default function ProposalRequestQueue({
  rows,
  loading,
  onRefresh,
  onSend,
}: {
  rows: RequestRow[];
  loading: boolean;
  onRefresh: () => void;
  onSend?: (accountId: string) => void;
}) {
  const [filter, setFilter] = useState("pending_assign");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<RequestRow | null>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.status] = (c[r.status] || 0) + 1;
    return c;
  }, [rows]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (filter !== "all" && r.status !== filter) return false;
    if (!search) return true;
    const hay = `${r.requester_name} ${r.requester_company || ""} ${r.requester_email} ${r.property_type_key}`;
    return hay.toLowerCase().includes(search.toLowerCase());
  }), [rows, filter, search]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {[
          ["pending_assign", "Pending assign"],
          ["walkthrough_scheduled", "Scheduled"],
          ["walkthrough_conducted", "Conducted"],
          ["firm_price_set", "Firm price"],
          ["excluded", "Excluded"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={cn(
              "rounded-xl border px-3 py-2 text-left",
              filter === id ? "border-violet-400 bg-violet-50" : "border-slate-200 bg-white",
            )}
          >
            <p className="text-lg font-bold text-slate-900">{counts[id] || 0}</p>
            <p className="text-[11px] text-slate-500">{label}</p>
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <RiSearch2Line className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" placeholder="Search requester, company, type…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Button variant="outline" onClick={() => setFilter("all")}>All</Button>
      </div>

      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-slate-500 py-8 text-center">No proposal requests in this view.</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => {
            const addr = r.sites?.[0]
              ? [r.sites[0].address, r.sites[0].city].filter(Boolean).join(", ")
              : "";
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setOpen(r)}
                className="w-full text-left rounded-xl border border-slate-200 bg-white px-4 py-3 hover:border-violet-300 transition"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 truncate">{r.requester_name}{r.requester_company ? ` · ${r.requester_company}` : ""}</p>
                    <p className="text-xs text-slate-500 truncate">{addr || r.requester_email}{r.sites?.length > 1 ? ` · ${r.sites.length} sites` : ""}</p>
                  </div>
                  <Badge className={cn("shrink-0", STATUS_CHIP[r.status] || "bg-slate-100")}>
                    {r.status_label || PROPOSAL_STATUS_LABELS[r.status]}
                  </Badge>
                </div>
                <p className="text-[11px] text-slate-400 mt-1 capitalize">{r.property_type_key.replace(/_/g, " ")} · {new Date(r.created_at).toLocaleString("en-US", { timeZone: "America/New_York" })}</p>
              </button>
            );
          })}
        </div>
      )}

      <AssignSheet
        row={open}
        onClose={() => setOpen(null)}
        onDone={() => { setOpen(null); onRefresh(); }}
        onSend={onSend}
      />
    </div>
  );
}

function AssignSheet({
  row,
  onClose,
  onDone,
  onSend,
}: {
  row: RequestRow | null;
  onClose: () => void;
  onDone: () => void;
  onSend?: (accountId: string) => void;
}) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [cleanerId, setCleanerId] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);

  const load = async (id: string) => {
    setLoading(true);
    try {
      const out = await proposalApi.candidates(id);
      setCandidates((out.candidates || []) as Candidate[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load eligible contractors");
    } finally {
      setLoading(false);
    }
  };

  const open = Boolean(row);
  useEffect(() => {
    if (row) void load(row.id);
    else {
      setCandidates([]);
      setCleanerId("");
      setScheduledAt("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.id]);

  const picked = candidates.find((c) => c.id === cleanerId);

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Could not copy");
    }
  };

  const resend = async () => {
    if (!row) return;
    setResending(true);
    try {
      const out = await proposalApi.resendDocs(row.id);
      toast.success(
        out.agentTexted || out.agentEmailed
          ? "Documentation link sent to the walkthrough agent (email and SMS)."
          : "Link is ready — assign an agent to send it, or open it from this sheet.",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not resend");
    } finally {
      setResending(false);
    }
  };

  const assign = async () => {
    if (!row || !cleanerId || !scheduledAt) {
      toast.error("Pick an agent and a date/time.");
      return;
    }
    setBusy(true);
    try {
      await proposalApi.assign(row.id, {
        cleanerId,
        scheduledAt: new Date(scheduledAt).toISOString(),
      });
      toast.success("Walkthrough scheduled — requester notified, agent emailed and texted the site findings link. Pay is owed whether or not this converts.");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Assignment failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) { onClose(); setCandidates([]); setCleanerId(""); } }}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Assign walkthrough agent</SheetTitle>
          <SheetDescription>
            {row ? `${row.requester_name} · ${row.property_type_key}` : ""}
          </SheetDescription>
        </SheetHeader>
        {row && (
          <div className="mt-4 space-y-4">
            <div className="rounded-lg border border-slate-200 p-3 text-xs text-slate-600 space-y-1">
              {(row.sites || []).map((s) => (
                <p key={s.id}>{[s.nickname, s.address, s.city, s.state].filter(Boolean).join(" · ")}</p>
              ))}
              <p className="text-slate-400">This is paid contractor work, not unpaid prospecting.</p>
            </div>

            {row.status === "pending_assign" && (
              <>
                <div>
                  <Label className="text-xs">Visit date &amp; time *</Label>
                  <Input type="datetime-local" className="mt-1" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-700 flex items-center gap-1 mb-2">
                    <RiUserStarLine className="w-3.5 h-3.5" /> Walkthrough-eligible contractors
                  </p>
                  {loading ? <Skeleton className="h-24" /> : candidates.length === 0 ? (
                    <p className="text-xs text-amber-700">No contractors flagged walkthrough-eligible. Flag them on the Cleaners tab.</p>
                  ) : (
                    <div className="space-y-1.5 max-h-64 overflow-y-auto">
                      {candidates.map((c) => {
                        const on = cleanerId === c.id;
                        const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || "Contractor";
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => setCleanerId(c.id)}
                            className={cn(
                              "w-full text-left rounded-lg border px-3 py-2",
                              on ? "border-violet-500 bg-violet-50" : "border-slate-200",
                              !c.available && "opacity-60",
                            )}
                          >
                            <div className="flex justify-between gap-2">
                              <span className="text-sm font-semibold text-slate-900">{name}</span>
                              <span className="text-[11px] text-slate-500">Novara {c.novara_score != null ? Math.round(c.novara_score) : "—"}</span>
                            </div>
                            <p className="text-[11px] text-slate-500">
                              {c.distance_miles != null ? `${c.distance_miles} mi` : c.home_zip ? `ZIP ${c.home_zip}` : "distance unknown"}
                              {c.reason === "too_far" ? " · outside travel radius" : ""}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <Button className="w-full" disabled={busy || !cleanerId || !scheduledAt} onClick={() => void assign()}>
                  {busy ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiCalendarCheckLine className="w-4 h-4 mr-1.5" />}
                  Assign {picked ? [picked.first_name, picked.last_name].filter(Boolean).join(" ") : "agent"}
                </Button>
              </>
            )}

            {row.status !== "pending_assign" && (
              <p className="text-sm text-slate-600">
                Status is {PROPOSAL_STATUS_LABELS[row.status]}. Onsite documentation is the same tokenized document the agent uses — VA and admin can add to it from here.
              </p>
            )}

            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-700">Onsite documentation</p>
              {(row.sites || []).map((s) => {
                const token = s.assignment_token;
                if (!token) {
                  return (
                    <p key={s.id} className="text-xs text-amber-700">
                      {[s.nickname, s.address].filter(Boolean).join(" · ") || "Site"} — token not minted yet.
                    </p>
                  );
                }
                const office = walkthroughStaffPath(token);
                const agent = walkthroughLink(token);
                return (
                  <div key={s.id} className="rounded-lg border border-slate-200 p-2 space-y-1.5">
                    <p className="text-xs font-medium text-slate-800">
                      {[s.nickname, s.address, s.city].filter(Boolean).join(" · ")}
                      {s.walkthrough_status ? ` · ${s.walkthrough_status}` : ""}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      <Button size="sm" variant="outline" className="h-8" asChild>
                        <a href={office}>
                          <RiExternalLinkLine className="w-3.5 h-3.5 mr-1" /> Open (VA / admin)
                        </a>
                      </Button>
                      <Button size="sm" variant="outline" className="h-8" onClick={() => void copy(agent, "Agent link")}>
                        <RiFileCopyLine className="w-3.5 h-3.5 mr-1" /> Copy agent link
                      </Button>
                    </div>
                  </div>
                );
              })}
              <Button variant="outline" className="w-full" disabled={resending} onClick={() => void resend()}>
                {resending ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiMailSendLine className="w-4 h-4 mr-1.5" />}
                {row.assigned_cleaner_id ? "Resend docs to walkthrough agent" : "Prepare agent link"}
              </Button>
            </div>

            {row.business_account_id && (row.status === "walkthrough_conducted" || row.status === "firm_price_set") && (
              <Button
                className="w-full"
                onClick={() => {
                  onSend?.(row.business_account_id!);
                  onClose();
                }}
              >
                <RiMailSendLine className="w-4 h-4 mr-1.5" /> Send proposal
              </Button>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
