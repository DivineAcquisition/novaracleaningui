"use client";

// hiring.novaracleaning.com — same shape as the Divine Acquisition careers
// page (status, centered hero, counts, values, filters, featured role, list),
// in Novara's white UI.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RiArrowRightLine, RiMapPin2Line } from "@remixicon/react";
import { SEO } from "@/components/SEO";
import { HIRING_ROLES, type HiringRole, type HiringRoleGroup } from "@/lib/hiring/roles";
import { RoleHiringCards } from "@/components/hiring/RoleHiringCards";
import {
  EvergreenBadge,
  HiringFooter,
  HiringNav,
  HiringShell,
  HIRING_GRADIENT,
} from "@/components/hiring/HiringChrome";
import {
  accessFromCatalog,
  publicRoleCards,
  rolePaySettings,
  seedRoleCatalog,
  type PublicRoleCard,
} from "@/lib/contractor-roles";
import { DEFAULT_INTAKE_SETTINGS } from "@/lib/contractor-intake/settings";
import { cn } from "@/lib/utils";

const LEVELS = ["", "Starting", "Practiced", "Lead", "Specialty"];

const FILTERS: Array<{ id: "all" | HiringRoleGroup; label: string }> = [
  { id: "all", label: "All roles" },
  { id: "field", label: "Field" },
  { id: "lead", label: "Lead" },
  { id: "specialty", label: "Specialty" },
];

const VALUES = [
  { name: "Show up", detail: "On time, with your kit, ready to work the home in front of you." },
  { name: "Own the work", detail: "You run the clean. Novara handles the schedule, the clients, and the payout." },
  { name: "Client first", detail: "It is someone’s home. Finish the checklist and leave a clear record." },
];

function LevelMeter({ level }: { level: number }) {
  return (
    <span className="flex items-center gap-2" title={`${LEVELS[level] || "Role"} level`}>
      <span className="flex items-end gap-[3px]" aria-hidden>
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            style={{ height: `${5 + step * 2.5}px` }}
            className={cn("w-[3px] rounded-full", step <= level ? "bg-[#5C0FFE]" : "bg-slate-200")}
          />
        ))}
      </span>
      <span className="text-xs font-medium text-slate-500">{LEVELS[level]}</span>
    </span>
  );
}

function RoleMeta({ role }: { role: HiringRole }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs font-medium text-slate-500">
      <span className="inline-flex items-center gap-1.5">
        <RiMapPin2Line className="h-3.5 w-3.5 text-[#8F7BFD]" aria-hidden />
        {role.location}
      </span>
      <span>{role.type}</span>
      <span className="font-semibold text-[#5C0FFE]">{role.pay}</span>
    </div>
  );
}

function RoleRow({ role }: { role: HiringRole }) {
  const body = (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 transition group-hover:border-[#8F7BFD]/50 group-hover:shadow-[0_16px_40px_-28px_rgba(92,15,254,0.45)] sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-heading text-lg font-bold text-slate-900">{role.title}</h3>
            {role.evergreen ? <EvergreenBadge /> : (
              <span className="rounded-full bg-[#5C0FFE]/8 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#5C0FFE]">
                Open
              </span>
            )}
          </div>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{role.tagline}</p>
          <RoleMeta role={role} />
        </div>
        <div className="flex items-center justify-between gap-4 sm:justify-end">
          <LevelMeter level={role.level} />
          {!role.evergreen && (
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition group-hover:border-[#5C0FFE] group-hover:bg-[#5C0FFE] group-hover:text-white">
              <RiArrowRightLine className="h-4 w-4" aria-hidden />
            </span>
          )}
        </div>
      </div>
    </article>
  );
  if (role.evergreen) return <div className="opacity-90">{body}</div>;
  return (
    <Link href={`/hiring/${role.slug}`} className="group block">
      {body}
    </Link>
  );
}

function seedCards(): PublicRoleCard[] {
  const catalog = seedRoleCatalog();
  const access = accessFromCatalog(catalog, { leadRoleOpenToPublic: false, eligibleOrInvited: false });
  access.recurringPublic = Boolean((DEFAULT_INTAKE_SETTINGS.recurringHomeCleanerPayLabel || "").trim());
  access.turnoverPublic = Boolean((DEFAULT_INTAKE_SETTINGS.turnoverCleanerPayLabel || "").trim());
  return publicRoleCards(catalog, rolePaySettings(DEFAULT_INTAKE_SETTINGS), access);
}

export default function HiringHome() {
  const [group, setGroup] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [cards, setCards] = useState<PublicRoleCard[]>(seedCards);
  useEffect(() => {
    fetch("/api/hiring/intake")
      .then((res) => res.json())
      .then((data: { cards?: PublicRoleCard[] }) => {
        if (Array.isArray(data.cards) && data.cards.length) setCards(data.cards);
      })
      .catch(() => undefined);
  }, []);
  const visibleCards = cards.filter((card) => {
    if (group === "specialty") return false;
    if (group === "lead") return card.id === "lead_field_cleaner";
    if (group === "field") return card.id !== "lead_field_cleaner";
    return true;
  });
  const openCount = cards.filter((card) => card.applyQuery).length;
  const specialty = useMemo(
    () => HIRING_ROLES.filter((role) => role.group === "specialty" && (group === "all" || group === "specialty")),
    [group],
  );

  return (
    <HiringShell>
      <SEO
        title="Careers"
        description="Independent contractor roles at Novara Cleaning. Field Cleaner, Recurring Home Cleaner, Turnover Cleaner, and Lead Field Cleaner across the DMV."
        canonical="https://hiring.novaracleaning.com/hiring"
      />
      <HiringNav ctaHref="#positions" ctaLabel={`${openCount} open roles`} />

      <section className="relative overflow-hidden px-5 pb-14 pt-16 sm:px-6 sm:pb-20 sm:pt-24">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(60% 50% at 50% -8%, rgba(143,123,253,0.22), transparent 58%), linear-gradient(180deg, #FFFFFF 0%, #FAFAFC 100%)",
          }}
        />
        <div className="relative mx-auto max-w-3xl text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#5C0FFE]">Now open</p>
          <h1 className="mt-4 font-heading text-4xl font-extrabold leading-[1.05] tracking-tight text-slate-900 sm:text-6xl">
            Clean the homes.
            <span className="mt-1 block text-[#5C0FFE]">Run your own work.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg">
            Independent contractor roles across the DMV. You accept the jobs. Novara handles the schedule, the clients, and the payout.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a href="#positions" className="inline-flex h-12 items-center gap-2 rounded-full px-6 text-sm font-semibold text-white" style={{ background: HIRING_GRADIENT }}>
              See open roles
              <RiArrowRightLine className="h-4 w-4" aria-hidden />
            </a>
            {cards.some((card) => card.id === "lead_field_cleaner" && card.applyQuery) && (
              <a href="#positions" className="inline-flex h-12 items-center rounded-full border border-slate-200 bg-white px-6 text-sm font-semibold text-slate-800">
                Lead Field Cleaner is open
              </a>
            )}
          </div>
        </div>
        <dl className="relative mx-auto mt-12 grid max-w-4xl grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            [String(openCount), "Open roles"],
            ["DMV", "Maryland, DC, Virginia"],
            ["1099", "Independent contractor"],
            ["35–47%", "Share of the job"],
          ].map(([value, label]) => (
            <div key={label} className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-center">
              <dt className="font-heading text-2xl font-bold text-slate-900">{value}</dt>
              <dd className="mt-1 text-xs font-medium text-slate-500">{label}</dd>
            </div>
          ))}
        </dl>
        <div className="relative mx-auto mt-4 grid max-w-4xl gap-3 sm:grid-cols-3">
          {VALUES.map((value) => (
            <div key={value.name} className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-left">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <span className="h-1.5 w-1.5 rounded-full bg-[#5C0FFE]" aria-hidden />
                {value.name}
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{value.detail}</p>
            </div>
          ))}
        </div>
      </section>

      <main id="positions" className="scroll-mt-24 mx-auto max-w-6xl px-5 pb-20 sm:px-6">
        <div className="mb-8 flex flex-col gap-2 border-t border-slate-200 pt-10 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#5C0FFE]">Open positions</p>
            <h2 className="mt-2 font-heading text-3xl font-bold text-slate-900">Find where you fit</h2>
          </div>
          <p className="text-sm text-slate-500">
            Showing <span className="font-semibold text-slate-900">{visibleCards.length + specialty.length}</span> roles
          </p>
        </div>

        <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
          <aside className="lg:w-56 lg:shrink-0">
            <div className="rounded-2xl border border-slate-200 bg-white p-3 lg:sticky lg:top-24">
              <h3 className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Role</h3>
              <div className="flex gap-1.5 overflow-x-auto lg:flex-col" role="group" aria-label="Filter roles">
                {FILTERS.map((filter) => {
                  const cardCount = filter.id === "specialty"
                    ? 0
                    : cards.filter((card) => filter.id === "all" || (filter.id === "lead" ? card.id === "lead_field_cleaner" : card.id !== "lead_field_cleaner")).length;
                  const specialtyCount = filter.id === "lead" ? 0 : HIRING_ROLES.filter((role) => role.group === "specialty").length;
                  const count = cardCount + (filter.id === "field" ? 0 : specialtyCount);
                  const on = group === filter.id;
                  return (
                    <button
                      key={filter.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setGroup(filter.id)}
                      className={cn(
                        "flex shrink-0 items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium",
                        on ? "bg-[#5C0FFE]/10 text-[#5C0FFE] ring-1 ring-[#5C0FFE]/30" : "text-slate-600 hover:bg-slate-50",
                      )}
                    >
                      {filter.label}
                      <span className="text-xs tabular-nums">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </aside>
          <div className="min-w-0 flex-1 space-y-3">
            <RoleHiringCards cards={visibleCards} />
            {specialty.map((role) => <RoleRow key={role.id} role={role} />)}
            {visibleCards.length + specialty.length === 0 && <p className="text-sm text-slate-600">No roles in this filter.</p>}
          </div>
        </div>
      </main>
      <HiringFooter />
    </HiringShell>
  );
}
