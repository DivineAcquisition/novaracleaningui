"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  RiFileEditLine,
  RiFileTextLine,
  RiLoader4Line,
  RiMailSendLine,
  RiRulerLine,
  RiUserStarLine,
} from "@remixicon/react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { DEFAULT_CHECKLISTS, DEFAULT_PROPOSAL_SETTINGS, type ProposalChecklists, type ProposalRequestSettings } from "@/lib/proposal-request";
import { proposalApi } from "@/lib/proposal-request-api";
import { proposalsHubTab } from "@/lib/commercial-proposal";
import ProposalRequestIntake from "@/views/admin/ProposalRequestIntake";
import ProposalRequestQueue from "@/views/admin/ProposalRequestQueue";
import ProposalChecklistEditor from "@/views/admin/ProposalChecklistEditor";
import ProposalRequestSettingsView from "@/views/admin/ProposalRequestSettings";
import CommercialWalkthroughs from "@/views/admin/CommercialWalkthroughs";
import ProposalSendHub from "@/views/admin/ProposalSendHub";
import CommercialProposals from "@/views/admin/CommercialProposals";
import { isProposalSendFlow, type ProposalSendFlow } from "@/lib/proposal-offer-send";

const WORK_TABS = [
  { id: "new", label: "New request", icon: RiFileEditLine },
  { id: "queue", label: "Queue", icon: RiUserStarLine },
  { id: "price", label: "Firm price", icon: RiRulerLine },
  { id: "send", label: "Send", icon: RiMailSendLine },
  { id: "pipeline", label: "Pipeline", icon: RiFileTextLine },
] as const;

const CONFIG_TABS = [
  { id: "checklists", label: "Site findings" },
  { id: "settings", label: "Settings" },
] as const;

const ALL_TABS = [...WORK_TABS, ...CONFIG_TABS] as const;
type Tab = (typeof ALL_TABS)[number]["id"];

function isTab(raw: string): raw is Tab {
  return ALL_TABS.some((t) => t.id === raw);
}

export default function ProposalsHub() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const raw = searchParams?.get("tab") || "new";
  const tab: Tab = isTab(raw) ? raw : "new";
  const accountFromUrl = searchParams?.get("account") || "";
  const hostFromUrl = searchParams?.get("host") || "";
  const pmFromUrl = searchParams?.get("pm") || "";
  const flowFromUrl = searchParams?.get("flow") || "";
  const onConfig = tab === "checklists" || tab === "settings";

  const [catalog, setCatalog] = useState<ProposalChecklists>(DEFAULT_CHECKLISTS);
  const [settings, setSettings] = useState<ProposalRequestSettings>(DEFAULT_PROPOSAL_SETTINGS);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const setTab = (next: Tab, extra?: Record<string, string>) => {
    const params = new URLSearchParams(searchParams?.toString() || "");
    params.set("tab", next);
    if (next !== "send") {
      params.delete("account");
      params.delete("host");
      params.delete("pm");
      params.delete("flow");
    }
    if (extra) {
      for (const [k, v] of Object.entries(extra)) {
        if (v) params.set(k, v);
        else params.delete(k);
      }
    }
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

  const catalogTabs = tab === "new" || tab === "queue" || tab === "checklists" || tab === "settings";

  return (
    <div className="max-w-[1240px] mx-auto px-1 sm:px-4 py-2 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold tracking-[0.12em] uppercase text-violet-700/80 bg-violet-50 border border-violet-200/70 rounded-full px-2 py-0.5">
              Proposals
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
              STR · Office · Commercial · Property Manager
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Office and commercial: request creates a searchable prospect, then queue → firm price → send.
            STR and property managers start on Send with the home details. A request never creates a job.
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2 pt-1">
          {CONFIG_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "text-[11px] font-medium",
                tab === t.id ? "text-violet-700" : "text-slate-400 hover:text-slate-600",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1">
        {WORK_TABS.map((t) => {
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

      {onConfig && (
        <p className="text-xs text-slate-500 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          Configuration — not part of the daily strip.{" "}
          <button type="button" className="font-semibold text-violet-700 hover:underline" onClick={() => setTab("new")}>
            Back to requests
          </button>
        </p>
      )}

      {loading && catalogTabs && tab !== "new" ? (
        <p className="text-sm text-slate-500 flex items-center gap-2 py-8 justify-center">
          <RiLoader4Line className="w-4 h-4 animate-spin" /> Loading…
        </p>
      ) : tab === "new" ? (
        <ProposalRequestIntake catalog={catalog} onCreated={() => { void load(); setTab("queue"); }} />
      ) : tab === "queue" ? (
        <ProposalRequestQueue
          rows={rows}
          loading={loading}
          onRefresh={() => void load()}
          onSend={(target) => setTab("send", {
            flow: target.flow,
            account: target.accountId || "",
            host: target.hostId || "",
            pm: target.pmAccountId || "",
          })}
        />
      ) : tab === "price" ? (
        <CommercialWalkthroughs />
      ) : tab === "send" ? (
        <ProposalSendHub
          flow={isProposalSendFlow(flowFromUrl) ? flowFromUrl : ""}
          accountId={accountFromUrl}
          hostId={hostFromUrl}
          pmAccountId={pmFromUrl}
          walkthroughsHref={proposalsHubTab("price")}
          onChooseFlow={(next: ProposalSendFlow | "") => setTab("send", { flow: next })}
        />
      ) : tab === "pipeline" ? (
        <CommercialProposals />
      ) : tab === "checklists" ? (
        <ProposalChecklistEditor catalog={catalog} onSaved={setCatalog} />
      ) : (
        <ProposalRequestSettingsView settings={settings} onSaved={setSettings} />
      )}
    </div>
  );
}
