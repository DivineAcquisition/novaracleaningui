"use client";

import {
  RiArrowLeftLine,
  RiBuilding2Line,
  RiHotelLine,
  RiMailSendLine,
  RiUserStarLine,
} from "@remixicon/react";
import { cn } from "@/lib/utils";
import {
  PROPOSAL_SEND_FLOW_DEFS,
  isProposalSendFlow,
  type ProposalSendFlow,
} from "@/lib/proposal-offer-send";
import CommercialProposalSend from "@/views/admin/CommercialProposalSend";
import StrProposalSend from "@/views/admin/StrProposalSend";
import PmProposalSend from "@/views/admin/PmProposalSend";

const ICONS: Record<ProposalSendFlow, typeof RiHotelLine> = {
  str: RiHotelLine,
  office: RiBuilding2Line,
  commercial: RiBuilding2Line,
  property_manager: RiUserStarLine,
};

export default function ProposalSendHub({
  flow,
  accountId,
  hostId,
  pmAccountId,
  walkthroughsHref,
  onChooseFlow,
}: {
  flow?: string;
  accountId?: string;
  hostId?: string;
  pmAccountId?: string;
  walkthroughsHref?: string;
  onChooseFlow: (next: ProposalSendFlow | "") => void;
}) {
  const selected = isProposalSendFlow(flow) ? flow : "";

  if (!selected) {
    return (
      <div className="max-w-3xl space-y-4">
        <div>
          <h2 className="font-jakarta text-[22px] font-bold tracking-tight text-slate-900">
            Send an offer
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Four unique mail paths. Each one sends the agreement and payment setup for that line of business — same motion as Internal Booking, different document.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          {PROPOSAL_SEND_FLOW_DEFS.map((def) => {
            const Icon = ICONS[def.id];
            return (
              <button
                key={def.id}
                type="button"
                onClick={() => onChooseFlow(def.id)}
                className="text-left rounded-2xl border border-slate-200 bg-white p-4 hover:border-violet-400 hover:shadow-sm transition"
              >
                <div className="flex items-center gap-2">
                  <span className="w-8 h-8 rounded-lg bg-violet-50 text-violet-700 flex items-center justify-center">
                    <Icon className="w-4 h-4" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{def.label}</p>
                    <p className="text-[11px] text-violet-700 font-medium">{def.mails}</p>
                  </div>
                </div>
                <p className="text-xs text-slate-500 mt-2 leading-relaxed">{def.detail}</p>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const def = PROPOSAL_SEND_FLOW_DEFS.find((f) => f.id === selected);

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => onChooseFlow("")}
        className={cn("inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800")}
      >
        <RiArrowLeftLine className="w-3.5 h-3.5" />
        All four flows
      </button>
      <p className="flex items-center gap-1.5 text-[11px] text-slate-500 -mt-2">
        <RiMailSendLine className="w-3.5 h-3.5 text-violet-600" />
        {def?.mails}
      </p>
      {selected === "str" ? (
        <StrProposalSend initialHostId={hostId} />
      ) : selected === "property_manager" ? (
        <PmProposalSend initialPmAccountId={pmAccountId} />
      ) : (
        <CommercialProposalSend
          initialAccountId={accountId}
          inProposalsHub
          lockedAccountType={selected}
          walkthroughsHref={walkthroughsHref}
        />
      )}
    </div>
  );
}
