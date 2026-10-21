"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RiArrowLeftLine } from "@remixicon/react";
import { SEO } from "@/components/SEO";
import { HiringFooter, HiringNav, HiringShell, HIRING_GRADIENT } from "@/components/hiring/HiringChrome";
import { hiringApplyUrl } from "@/lib/site-hosts";
import {
  LEAD_CLOSED_NOTICE,
  accessFromCatalog,
  publicRoleCards,
  rolePaySettings,
  seedRoleCatalog,
  type ContractorRoleId,
  type PublicRoleCard,
} from "@/lib/contractor-roles";
import { DEFAULT_INTAKE_SETTINGS } from "@/lib/contractor-intake/settings";

export function HiringRoleDetail({ roleId }: { roleId: ContractorRoleId }) {
  const [card, setCard] = useState<PublicRoleCard | null>(() => {
    const catalog = seedRoleCatalog();
    const access = accessFromCatalog(catalog, { leadRoleOpenToPublic: false, eligibleOrInvited: false });
    return publicRoleCards(catalog, rolePaySettings(DEFAULT_INTAKE_SETTINGS), access).find((row) => row.id === roleId) || null;
  });

  useEffect(() => {
    fetch("/api/hiring/intake")
      .then((res) => res.json())
      .then((data: { cards?: PublicRoleCard[] }) => {
        const next = (data.cards || []).find((row) => row.id === roleId);
        if (next) setCard(next);
      })
      .catch(() => undefined);
  }, [roleId]);

  if (!card) {
    return (
      <HiringShell>
        <main className="mx-auto max-w-3xl px-5 py-16">
          <p className="text-slate-700">This role is not on the public hiring page.</p>
          <Link href="/hiring" className="mt-4 inline-flex text-sm font-semibold text-slate-900">All roles</Link>
        </main>
      </HiringShell>
    );
  }

  return (
    <HiringShell>
      <SEO title={card.name} description={card.shortDescription} canonical={`https://hiring.novaracleaning.com${card.detailPath}`} />
      <HiringNav ctaHref={card.applyQuery ? hiringApplyUrl(`?role=${card.applyQuery}`) : "/hiring"} ctaLabel={card.applyQuery ? "Apply" : "See roles"} />
      <main className="mx-auto max-w-3xl px-5 py-12 sm:px-6 sm:py-16">
        <Link href="/hiring" className="inline-flex items-center gap-1 text-sm font-semibold text-slate-500">
          <RiArrowLeftLine className="h-4 w-4" aria-hidden />
          All roles
        </Link>
        <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5C0FFE]">{card.tag}</p>
        <h1 className="mt-3 font-heading text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">{card.name}</h1>
        <p className="mt-4 text-lg leading-relaxed text-slate-600">{card.shortDescription}</p>
        {card.applyQuery ? (
          <a href={hiringApplyUrl(`?role=${card.applyQuery}`)} className="mt-8 inline-flex h-12 items-center rounded-full px-6 text-sm font-semibold text-white" style={{ background: HIRING_GRADIENT }}>
            Apply as {card.name}
          </a>
        ) : (
          <p className="mt-8 text-sm font-medium text-slate-700">{card.closedNotice || LEAD_CLOSED_NOTICE}</p>
        )}
        <section className="mt-10">
          <h2 className="font-heading text-2xl font-bold text-slate-900">What you'll do</h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-slate-700">
            {card.whatYoullDo.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </section>
        <section className="mt-8">
          <h2 className="font-heading text-2xl font-bold text-slate-900">What you'll need</h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-slate-700">
            {card.whatYoullNeed.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </section>
        <p className="mt-8 text-base font-semibold text-slate-900">Pay: {card.payLine}</p>
      </main>
      <HiringFooter />
    </HiringShell>
  );
}
