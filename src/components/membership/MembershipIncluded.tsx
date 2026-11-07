// "Every Glow membership includes" — the member benefits from
// src/lib/membership-benefits.ts (the same source as /membership-benefits),
// shown on the membership plans page and each plan's detail page.

import Link from "next/link";
import {
  RiArrowRightLine,
  RiCalendarCheckLine,
  RiCameraLine,
  RiCheckLine,
  RiCoupon3Line,
  RiDashboardLine,
  RiPriceTag3Line,
  RiRefreshLine,
  RiShieldCheckLine,
  RiUserStarLine,
} from "@/components/icons";
import { HERO_BENEFITS, MEMBERSHIP_BENEFITS_PATH, MORE_BENEFITS, type BenefitSection } from "@/lib/membership-benefits";
import { cn } from "@/lib/utils";

const ICONS: Record<BenefitSection["icon"], typeof RiCheckLine> = {
  portal: RiDashboardLine,
  camera: RiCameraLine,
  cleaner: RiUserStarLine,
  price: RiPriceTag3Line,
  calendar: RiCalendarCheckLine,
  shield: RiShieldCheckLine,
  credit: RiCoupon3Line,
  flex: RiRefreshLine,
};

export function MembershipIncluded({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <section aria-labelledby="membership-included-title" className={cn("space-y-6", className)}>
      <div className="text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5A1FD6]">Member benefits</p>
        <h2 id="membership-included-title" className="mt-1 text-[1.6rem] font-semibold tracking-[-0.03em] text-[#0B0A11] sm:text-[2rem]">
          Every Glow membership includes
        </h2>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {HERO_BENEFITS.map((b) => {
          const Icon = ICONS[b.icon];
          return (
            <article key={b.title} className="rounded-2xl border border-[#E9E7EE] bg-white p-5 shadow-[0_1px_2px_rgba(11,10,17,0.04),0_14px_34px_-28px_rgba(11,10,17,0.35)]">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#F3EEFF] text-[#6810FE]">
                <Icon className="h-5 w-5" />
              </span>
              <h3 className="mt-3 text-[16px] font-semibold tracking-[-0.01em] text-[#0B0A11]">{b.title}</h3>
              <p className="mt-1 text-[13.5px] text-[#5F5B6B]">{b.tagline}</p>
              {!compact ? (
                <ul className="mt-3 space-y-1.5 border-t border-[#F0EEF4] pt-3">
                  {b.items.map((item) => (
                    <li key={item} className="flex gap-2 text-[13.5px] leading-snug text-[#0B0A11]">
                      <RiCheckLine className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#6810FE]" />
                      {item}
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          );
        })}
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {MORE_BENEFITS.map((b) => {
          const Icon = ICONS[b.icon];
          return (
            <li key={b.title} className="rounded-xl border border-[#E9E7EE] bg-[#FAFAFC] p-4">
              <span className="flex items-center gap-2 text-[14px] font-semibold text-[#0B0A11]">
                <Icon className="h-4 w-4 text-[#6810FE]" />
                {b.title}
              </span>
              <p className="mt-1 text-[12.5px] leading-snug text-[#5F5B6B]">{b.items[0]}</p>
            </li>
          );
        })}
      </ul>

      <p className="text-center">
        <Link href={MEMBERSHIP_BENEFITS_PATH} className="inline-flex items-center gap-1.5 text-[14px] font-medium text-[#5A1FD6] hover:underline">
          See every member benefit
          <RiArrowRightLine className="h-4 w-4" />
        </Link>
      </p>
    </section>
  );
}
