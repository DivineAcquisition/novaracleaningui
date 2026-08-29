"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  RiFileEditLine,
  RiFileList3Line,
  RiLoader4Line,
  RiMailSendLine,
  RiSettings3Line,
} from "@remixicon/react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { DEFAULT_CHECKLISTS, DEFAULT_PROPOSAL_SETTINGS, type ProposalChecklists, type ProposalRequestSettings } from "@/lib/proposal-request";
import { proposalApi } from "@/lib/proposal-request-api";
import ProposalRequestIntake from "@/views/admin/ProposalRequestIntake";
import ProposalRequestQueue from "@/views/admin/ProposalRequestQueue";
import ProposalChecklistEditor from "@/views/admin/ProposalChecklistEditor";
import ProposalRequestSettingsView from "@/views/admin/ProposalRequestSettings";

const TABS = [
  { id: "new", label: "New request", icon: RiFileEditLine },
  { id: "queue", label: "Queue", icon: RiMailSendLine },
  { id: "checklists", label: "Checklists", icon: RiFileList3Line },
  { id: "settings", label: "Settings", icon: RiSettings3Line },
] as const;
type Tab = (typeof TABS)[number]["id"];

export default function ProposalsHub() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const raw = searchParams?.get("tab") || "new";
  const tab: Tab = TABS.some((t) => t.id === raw) ? (raw as Tab) : "new";

  const [catalog, setCatalog] = useState<ProposalChecklists>(DEFAULT_CHECKLISTS);
  const [settings, setSettings] = useState<ProposalRequestSettings>(DEFAULT_PROPOSAL_SETTINGS);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const setTab = (next: Tab) => {
    const params = new URLSearchParams(searchParams?.toString() || "");
    params.set("tab", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cl, st, list] = await Promise.all([
        proposalApi.checklists(),
        proposalApi.settings(),
        proposalApi.list(),
      ]);
      if (cl.catalog) setCatalog(cl.catalog);
      if (st.settings) setSettings(st.settings);
      setRows(list.requests || []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load proposals");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="max-w-[1240px] mx-auto px-1 sm:px-4 py-2 space-y-4">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-bold tracking-[0.12em] uppercase text-violet-700/80 bg-violet-50 border border-violet-200/70 rounded-full px-2 py-0.5">
            Proposals
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
            STR · Commercial · Office
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Quote requests that need an on-site walkthrough. Separate from Internal Booking — submitting here never creates a job.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium",
                on ? "bg-violet-600 text-white" : "text-slate-600 hover:bg-slate-50",
              )}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {loading && tab !== "new" ? (
        <p className="text-sm text-slate-500 flex items-center gap-2 py-8 justify-center">
          <RiLoader4Line className="w-4 h-4 animate-spin" /> Loading…
        </p>
      ) : tab === "new" ? (
        <ProposalRequestIntake catalog={catalog} onCreated={() => { void load(); setTab("queue"); }} />
      ) : tab === "queue" ? (
        <ProposalRequestQueue rows={rows} loading={loading} onRefresh={() => void load()} />
      ) : tab === "checklists" ? (
        <ProposalChecklistEditor catalog={catalog} onSaved={setCatalog} />
      ) : (
        <ProposalRequestSettingsView settings={settings} onSaved={setSettings} />
      )}
    </div>
  );
}
