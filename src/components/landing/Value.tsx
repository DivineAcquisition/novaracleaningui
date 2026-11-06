// "What you get" and the 48-hour guarantee: the service itself, in plain
// outcomes, near the top of the page. Server-rendered.

import { RiArrowRightLine, RiCalendarCheckLine, RiFileList3Line, RiRefreshLine, RiShoppingBasket2Line } from "@/components/icons";
import { GUARANTEE, VALUE } from "@/lib/landing/content";
import { PriceButton } from "./Chrome";
import { Section, gutter, shell } from "./primitives";

const ICONS = {
  time: RiCalendarCheckLine,
  list: RiFileList3Line,
  supplies: RiShoppingBasket2Line,
  reclean: RiRefreshLine,
} as const;

export function ValueSection() {
  return (
    <Section id={VALUE.id} eyebrow={VALUE.eyebrow} headline={VALUE.headline} lead={VALUE.lead}>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {VALUE.items.map((item) => {
          const Icon = ICONS[item.id as keyof typeof ICONS];
          return (
            <li key={item.id} className="rounded-2xl border border-line bg-white p-5 shadow-[0_16px_40px_-32px_rgba(11,10,17,0.35)]">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#F3EEFF]">
                <Icon className="h-5 w-5 text-[#6810FE]" aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-[18px] font-semibold tracking-[-0.02em] text-ink">{item.title}</h3>
              <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-muted">{item.body}</p>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

export function GuaranteeBand() {
  return (
    <section id={GUARANTEE.id} aria-labelledby="guarantee-title" className={`${gutter} scroll-mt-20 border-t border-line py-16 sm:py-20`}>
      <div className={shell}>
        <div className="grid items-center gap-8 rounded-3xl bg-[#16043F] p-7 text-white sm:p-10 md:grid-cols-[auto_1fr]">
          <svg viewBox="0 0 120 120" className="mx-auto h-32 w-32 md:h-40 md:w-40" role="img" aria-label="48-hour re-clean guarantee">
            <defs>
              <path id="g-seal" d="M60,60 m-44,0 a44,44 0 1,1 88,0 a44,44 0 1,1 -88,0" />
            </defs>
            <circle cx="60" cy="60" r="57" fill="#ffffff" fillOpacity="0.06" stroke="#ffffff" strokeOpacity="0.2" />
            <circle cx="60" cy="60" r="34" fill="#6810FE" />
            <text fontSize="9.2" fontWeight="600" fill="#CFC6EE" letterSpacing="2.1" fontFamily="var(--font-inter), Inter, sans-serif">
              <textPath href="#g-seal">RE-CLEAN GUARANTEE · FREE · NO FORMS ·</textPath>
            </text>
            <text x="60" y="63" textAnchor="middle" fontSize="27" fontWeight="800" fill="#fff" fontFamily="var(--font-inter), Inter, sans-serif">
              48
            </text>
            <text x="60" y="77" textAnchor="middle" fontSize="9" fontWeight="700" fill="#fff" fontFamily="var(--font-inter), Inter, sans-serif">
              HOURS
            </text>
          </svg>
          <div>
            <h2 id="guarantee-title" className="text-[1.75rem] font-semibold leading-tight tracking-[-0.03em] text-white sm:text-[2.4rem]">
              {GUARANTEE.headline}
            </h2>
            <p className="mt-3 max-w-2xl text-[15.5px] leading-relaxed text-white/75">{GUARANTEE.body}</p>
            <ul className="mt-5 flex flex-wrap gap-2">
              {GUARANTEE.points.map((p) => (
                <li key={p} className="rounded-full border border-white/20 px-3 py-1 text-[13px] text-white/85">
                  {p}
                </li>
              ))}
            </ul>
            <PriceButton className="mt-6 bg-none bg-white text-[#16043F] shadow-none hover:bg-white/90">
              Book with the guarantee
              <RiArrowRightLine className="h-4 w-4" aria-hidden="true" />
            </PriceButton>
          </div>
        </div>
      </div>
    </section>
  );
}
