"use client";

import Link from "next/link";
import {
  RiCheckboxCircleFill,
  RiCheckLine,
  RiCloseLine,
  RiExternalLinkLine,
} from "@remixicon/react";
import { cn } from "@/lib/utils";
import {
  COMMERCIAL_COMPARISON,
  COMMERCIAL_SCOPE_LABEL,
  commercialChecklistPath,
  commercialChecklistSections,
  commercialChecklistSectionsForJob,
  parseCommercialScope,
  type CommercialChecklistKind,
  type CommercialScopeKey,
} from "@/lib/commercial-checklists";
import { CHECKLISTS } from "@/lib/checklists";

const KIND_SLUG: Record<CommercialChecklistKind, keyof typeof CHECKLISTS> = {
  light: "commercial-light",
  standard: "commercial-standard",
  detailed: "commercial-detailed",
  office: "office",
};

export function CommercialScopePreview({
  kind,
  office = false,
  className,
  compact = false,
}: {
  kind: CommercialChecklistKind;
  /** After-hours office extras on top of the selected scope depth. */
  office?: boolean;
  className?: string;
  compact?: boolean;
}) {
  const scope: CommercialScopeKey = kind === "office" ? "standard" : kind;
  const showOffice = office || kind === "office";
  const sections = showOffice && kind !== "office"
    ? commercialChecklistSectionsForJob(scope, true)
    : commercialChecklistSections(kind);
  const slug = KIND_SLUG[kind === "office" ? "office" : kind];
  const published = CHECKLISTS[slug];
  const href = commercialChecklistPath(showOffice ? "office" : "commercial", scope);
  const title = showOffice && kind !== "office"
    ? `Office Clean — ${COMMERCIAL_SCOPE_LABEL[scope]}`
    : published.name;
  const tagline = showOffice && kind !== "office"
    ? `${published.tagline} plus after-hours desk and lock-up rules.`
    : published.tagline;

  return (
    <div className={cn("rounded-xl border border-slate-200 bg-white", className)}>
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">{title}</p>
          <p className="text-xs text-slate-500 mt-0.5">{tagline}</p>
        </div>
        <Link
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-violet-700 hover:underline shrink-0"
        >
          Public page <RiExternalLinkLine className="w-3.5 h-3.5" />
        </Link>
      </div>
      <div className={cn("p-4 space-y-4", compact && "max-h-80 overflow-y-auto")}>
        {sections.map((section) => (
          <div key={section.title}>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              {section.title}
            </p>
            <ul className="space-y-1.5">
              {section.items.map((item) => (
                <li key={item} className="flex items-start gap-2 text-xs text-slate-800">
                  <RiCheckboxCircleFill className="w-3.5 h-3.5 mt-0.5 shrink-0 text-violet-600" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CommercialScopeComparison({ className }: { className?: string }) {
  return (
    <div className={cn("overflow-x-auto rounded-xl border border-slate-200 bg-white", className)}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50/80 text-left">
            <th className="px-3 py-2 font-semibold text-slate-700">What&apos;s included</th>
            <th className="px-3 py-2 font-semibold text-slate-700 text-center w-24">Light</th>
            <th className="px-3 py-2 font-semibold text-slate-700 text-center w-24">Standard</th>
            <th className="px-3 py-2 font-semibold text-slate-700 text-center w-24">Detailed</th>
          </tr>
        </thead>
        <tbody>
          {COMMERCIAL_COMPARISON.map((group) => (
            <GroupRows key={group.title} title={group.title} rows={group.rows} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroupRows({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; light: boolean; standard: boolean; detailed: boolean }[];
}) {
  return (
    <>
      <tr className="bg-slate-50/60">
        <td colSpan={4} className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          {title}
        </td>
      </tr>
      {rows.map((row) => (
        <tr key={row.label} className="border-t border-slate-100">
          <td className="px-3 py-2 text-slate-800">{row.label}</td>
          <Cell included={row.light} />
          <Cell included={row.standard} />
          <Cell included={row.detailed} />
        </tr>
      ))}
    </>
  );
}

function Cell({ included }: { included: boolean }) {
  return (
    <td className="px-3 py-2 text-center">
      {included ? (
        <RiCheckLine className="w-4 h-4 text-emerald-600 mx-auto" />
      ) : (
        <RiCloseLine className="w-4 h-4 text-slate-300 mx-auto" />
      )}
    </td>
  );
}

export function commercialKindFromBooking(
  serviceType?: string | null,
  scopeLevel?: string | null,
): CommercialChecklistKind {
  if (String(serviceType || "").toLowerCase() === "office") {
    const scope = parseCommercialScope(scopeLevel);
    return scope === "standard" ? "office" : scope;
  }
  return parseCommercialScope(scopeLevel);
}

export function isOfficeBooking(serviceType?: string | null): boolean {
  return String(serviceType || "").toLowerCase() === "office";
}
