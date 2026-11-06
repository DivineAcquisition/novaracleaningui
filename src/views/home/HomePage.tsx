// Main home page for novaracleaning.com. Server component.
//
// Speaks to homeowners, Airbnb / short-term rental hosts, commercial clients
// and property managers. There is no ZIP form here: booking starts on
// try.novaracleaning.com. Photos are from a real Novara deep clean (approved
// for marketing use); every number comes from the booking code or the
// database.

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import {
  RiArrowRightLine,
  RiArrowRightUpLine,
  RiBriefcaseLine,
  RiBuilding2Line,
  RiCalendarCheckLine,
  RiCameraLine,
  RiCheckLine,
  RiDownload2Line,
  RiFileTextLine,
  RiHandHeartLine,
  RiHome4Line,
  RiHotelBedLine,
  RiKey2Line,
  RiListCheck2,
  RiMailLine,
  RiMapPinLine,
  RiPhoneLine,
  RiPriceTag3Line,
  RiRefreshLine,
  RiShieldCheckLine,
  RiSparklingLine,
  RiWallet3Line,
} from "@/components/icons";
import { INBOUND_PHONE } from "@/config/brand-config";
import { SiteHeader } from "@/components/landing/Chrome";
import { Faq, Pricing } from "@/components/landing/Closing";
import { SiteFooter } from "@/components/landing/Footer";
import { dollars } from "@/components/landing/format";
import { Hosts } from "@/components/landing/Hosts";
import { Chip, Eyebrow, Frame, Index, btnOutline, btnPrimary, gutter, lead, sectionTitle, shell } from "@/components/landing/primitives";
import { Standard } from "@/components/landing/Story";
import { GuaranteeBand } from "@/components/landing/Value";
import { BookNowLink, HomeMobileBar, TickingChecklist } from "@/components/home/HomeIslands";
import { CHECKLISTS } from "@/lib/checklists";
import type { CoverageState } from "@/lib/landing/coverage";
import { TRY_URL } from "@/lib/landing/links";
import { onlinePrice, startingOnlinePrice, visibleProof, type LandingData } from "@/lib/landing/prices";
import { cn } from "@/lib/utils";

const PHOTO = {
  counter: "/home/kitchen-counter.jpg",
  quartz: "/home/kitchen-quartz.jpg",
  range: "/home/kitchen-range.jpg",
  sink: "/home/kitchen-sink.jpg",
  cabinets: "/home/kitchen-cabinets.jpg",
  shower: "/home/bath-shower.jpg",
  tub: "/home/bath-tub.jpg",
  dining: "/home/dining.jpg",
  living: "/home/living-room.jpg",
};

const COMMERCIAL_URL = "https://commercial.novaracleaning.com";
const HIRING_URL = "https://hiring.novaracleaning.com";
const COI_PATH = "/commercial/novara-certificate-of-insurance.pdf";

const STATE_NAME: Record<CoverageState["state"], string> = { MD: "Maryland", DC: "Washington, DC", VA: "Northern Virginia" };
const STATE_CITIES: Record<CoverageState["state"], string[]> = {
  MD: ["Baltimore", "Silver Spring", "Bethesda", "Rockville", "Gaithersburg", "Annapolis", "Bowie", "Laurel", "Hyattsville", "Frederick", "Towson", "Upper Marlboro"],
  DC: ["Washington", "Navy Yard"],
  VA: ["Arlington", "Alexandria", "Fairfax", "Springfield", "Reston", "Falls Church", "Vienna", "McLean", "Manassas"],
};

function Photo({ src, alt, className }: { src: string; alt: string; className?: string }) {
  return <img src={src} alt={alt} loading="lazy" decoding="async" className={cn("h-full w-full object-cover", className)} />;
}

export default function HomePage({ data, coverage }: { data: LandingData; coverage: CoverageState[] | null }) {
  const { prices, stats } = data;
  const proof = visibleProof(stats);
  const standardFrom = startingOnlinePrice(prices, "standard");
  const exampleBand = prices.bands.find((b) => b.id === "1501_2000") || prices.bands[0];
  const exampleDeepList = exampleBand ? prices.base[exampleBand.id]?.deep || 0 : 0;
  const exampleDeep = onlinePrice(exampleDeepList, "deep");
  const kitchen = CHECKLISTS["standard-clean"].sections[0];
  const totalZips = coverage ? coverage.reduce((n, s) => n + s.zips, 0) : 0;

  return (
    <div className="landing min-h-screen bg-white font-sans text-ink antialiased">
      <SiteHeader withMenus bookHref={TRY_URL} />

      <main id="main">
        {/* ─── Hero ──────────────────────────────────────────────────── */}
        <section id="home-hero" className={cn(gutter, "relative overflow-hidden pb-16 pt-12 sm:pb-24 sm:pt-16")}>
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-gradient-to-b from-[#F5F0FF] to-white" />
          <div className={cn(shell, "relative grid items-center gap-12 lg:grid-cols-[1.05fr_1fr]")}>
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-[#E3D7FF] bg-white px-3 py-1 text-[13px] font-medium text-[#5A1FD6]">
                <RiMapPinLine className="h-4 w-4" />
                Maryland, Washington DC &amp; Northern Virginia
              </p>
              <h1 className="mt-5 text-[2.5rem] font-semibold leading-[1.04] tracking-[-0.035em] text-ink sm:text-[3.4rem] lg:text-[3.9rem]">
                Devotion, Value &amp; Care{" "}
                <span className="text-[#6810FE]">Across Every Clean</span>
              </h1>
              <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-ink-muted sm:text-lg">
                House cleaning, Airbnb turnovers, and office cleaning. You see the price before you book, your cleaner works from a
                written checklist, and photos show the work when it&rsquo;s done.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <BookNowLink className={cn(btnPrimary, "h-[52px] px-7 text-[16px]")}>
                  Book Now
                  <RiArrowRightLine className="h-5 w-5" />
                </BookNowLink>
                <a href={INBOUND_PHONE.tel} className={cn(btnOutline, "h-[52px] px-6 text-[16px]")}>
                  <RiPhoneLine className="h-5 w-5 text-[#6810FE]" />
                  {INBOUND_PHONE.display}
                </a>
              </div>
              <ul className="mt-8 flex flex-wrap gap-2">
                {[
                  { href: "#services", label: "Homes", icon: RiHome4Line },
                  { href: "/str", label: "Airbnb hosts", icon: RiHotelBedLine },
                  { href: COMMERCIAL_URL, label: "Offices", icon: RiBuilding2Line },
                  { href: "/portfolio", label: "Property managers", icon: RiKey2Line },
                ].map(({ href, label, icon: Icon }) => (
                  <li key={label}>
                    <a
                      href={href}
                      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-[13.5px] text-ink transition hover:border-[#C9B6FF]"
                    >
                      <Icon className="h-4 w-4 text-[#6810FE]" />
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Photo collage with product cards on top */}
            <div className="relative mx-auto w-full max-w-[560px]">
              <div className="grid grid-cols-[1.35fr_1fr] gap-3">
                <div className="row-span-2 aspect-[4/5] overflow-hidden rounded-3xl border border-line shadow-[0_30px_60px_-30px_rgba(11,10,17,0.45)]">
                  <img src={PHOTO.counter} alt="A kitchen Novara cleaned: white cabinets, quartz counters, stainless dishwasher" fetchPriority="high" className="h-full w-full object-cover" />
                </div>
                <div className="aspect-square overflow-hidden rounded-3xl border border-line">
                  <Photo src={PHOTO.shower} alt="Glass shower after a Novara clean" />
                </div>
                <div className="aspect-square overflow-hidden rounded-3xl border border-line">
                  <Photo src={PHOTO.tub} alt="Bathtub after a Novara clean" />
                </div>
              </div>
              <TickingChecklist
                title={`Checklist · ${kitchen.title}`}
                items={kitchen.items.slice(0, 4)}
                className="absolute -bottom-8 -left-3 w-[250px] sm:-left-8 sm:w-[280px]"
              />
              <div className="absolute -top-4 right-3 flex items-center gap-2.5 rounded-2xl border border-line bg-white/95 px-3.5 py-2.5 shadow-[0_20px_40px_-20px_rgba(11,10,17,0.45)] backdrop-blur sm:-right-4">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#F3EEFF] text-[#6810FE]">
                  <RiCameraLine className="h-[18px] w-[18px]" />
                </span>
                <div>
                  <p className="text-[13px] font-medium text-ink">Photo report sent</p>
                  <p className="text-[11.5px] text-ink-muted">Before &amp; after, every visit</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ─── Proof strip ───────────────────────────────────────────── */}
        <section aria-label="Why customers book Novara" className={cn(gutter, "border-y border-line bg-[#FAFAFC] py-8")}>
          <ul className={cn(shell, "grid grid-cols-2 gap-6 md:grid-cols-4")}>
            {[
              standardFrom > 0
                ? { icon: RiPriceTag3Line, big: dollars(standardFrom), small: "Standard clean, from (online price)" }
                : { icon: RiPriceTag3Line, big: "15% off", small: "Standard cleans booked online" },
              { icon: RiRefreshLine, big: "24 hours", small: "To flag anything for a free re-clean" },
              proof.completedCleans
                ? { icon: RiSparklingLine, big: `${proof.completedCleans.toLocaleString()}+`, small: "Cleans completed" }
                : { icon: RiListCheck2, big: "Written", small: "Checklist on every visit" },
              { icon: RiShieldCheckLine, big: "Insured", small: "Certificate available to download" },
            ].map(({ icon: Icon, big, small }) => (
              <li key={small} className="flex items-start gap-3">
                <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl bg-white text-[#6810FE] shadow-[0_8px_20px_-14px_rgba(11,10,17,0.4)]">
                  <Icon className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-[19px] font-semibold tracking-[-0.02em] text-ink">{big}</p>
                  <p className="text-[13px] leading-snug text-ink-muted">{small}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* ─── Who we clean for ──────────────────────────────────────── */}
        <section id="services" aria-labelledby="services-title" className={cn(gutter, "scroll-mt-20 py-20 sm:py-28")}>
          <div className={shell}>
            <Eyebrow>Who we clean for</Eyebrow>
            <h2 id="services-title" className={sectionTitle}>
              One team for homes, rentals, offices, and portfolios.
            </h2>
            <p className={cn(lead, "mt-4")}>Pick what you need. Each one has its own checklist, its own price, and its own way to book.</p>

            <div className="mt-10 grid gap-5 lg:grid-cols-2">
              {/* Homes */}
              <article className="group relative overflow-hidden rounded-3xl border border-line bg-white">
                <div className="aspect-[16/10] overflow-hidden">
                  <Photo src={PHOTO.living} alt="Living room after a Novara clean" className="transition duration-500 group-hover:scale-[1.03]" />
                </div>
                <div className="p-6">
                  <div className="flex items-center gap-2">
                    <RiHome4Line className="h-5 w-5 text-[#6810FE]" />
                    <h3 className="text-[20px] font-semibold tracking-[-0.02em] text-ink">Homes</h3>
                    <Chip tone="brand">Book online</Chip>
                  </div>
                  <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">
                    Standard, deep, and move-in / move-out cleans, or a membership every month, two weeks, or week.
                  </p>
                  <BookNowLink className={cn(btnPrimary, "mt-5")}>
                    Book Now
                    <RiArrowRightLine className="h-4 w-4" />
                  </BookNowLink>
                </div>
              </article>

              {/* Airbnb */}
              <article className="group relative overflow-hidden rounded-3xl border border-line bg-white">
                <div className="aspect-[16/10] overflow-hidden">
                  <Photo src={PHOTO.dining} alt="Dining area reset after a turnover clean" className="transition duration-500 group-hover:scale-[1.03]" />
                </div>
                <div className="p-6">
                  <div className="flex items-center gap-2">
                    <RiHotelBedLine className="h-5 w-5 text-[#6810FE]" />
                    <h3 className="text-[20px] font-semibold tracking-[-0.02em] text-ink">Airbnb &amp; short-term rentals</h3>
                  </div>
                  <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">
                    Turnovers between guests with linens, restocking, and photos after every clean. See your per-turnover rate in seconds.
                  </p>
                  <Link href="/str" className={cn(btnPrimary, "mt-5")}>
                    Get my turnover rate
                    <RiArrowRightLine className="h-4 w-4" />
                  </Link>
                </div>
              </article>

              {/* Commercial */}
              <article className="relative overflow-hidden rounded-3xl border border-line bg-gradient-to-br from-[#F7F3FF] to-white p-6">
                <div className="flex items-center gap-2">
                  <RiBuilding2Line className="h-5 w-5 text-[#6810FE]" />
                  <h3 className="text-[20px] font-semibold tracking-[-0.02em] text-ink">Offices &amp; commercial</h3>
                </div>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">
                  After-hours office cleaning on a written scope: light, standard, or detailed, plus desk and lock-up rules.
                </p>
                <Frame label="Office scope" className="mt-5">
                  <ul className="space-y-2">
                    {(CHECKLISTS["office"]?.sections[0]?.items || ["Empty trash and replace liners", "Wipe desks and shared surfaces", "Vacuum and mop floors", "Lock up and set the alarm"])
                      .slice(0, 4)
                      .map((item) => (
                        <li key={item} className="flex items-start gap-2 text-[13.5px] text-ink">
                          <RiCheckLine className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#6810FE]" />
                          {item}
                        </li>
                      ))}
                  </ul>
                </Frame>
                <div className="mt-5 flex flex-wrap gap-3">
                  <a href={COMMERCIAL_URL} className={btnPrimary}>
                    Book Now
                    <RiArrowRightUpLine className="h-4 w-4" />
                  </a>
                  <Link href="/checklist#commercial" className={btnOutline}>
                    See the scopes
                  </Link>
                </div>
              </article>

              {/* Property managers */}
              <article className="relative overflow-hidden rounded-3xl border border-line bg-gradient-to-br from-[#F7F3FF] to-white p-6">
                <div className="flex items-center gap-2">
                  <RiKey2Line className="h-5 w-5 text-[#6810FE]" />
                  <h3 className="text-[20px] font-semibold tracking-[-0.02em] text-ink">Property managers</h3>
                </div>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">
                  One partner for every unit: turnovers, move-outs, and recurring cleans, requested from one portal.
                </p>
                <Frame label="Example portfolio" className="mt-5">
                  <ul className="divide-y divide-line">
                    {[
                      { unit: "Unit 2B · move-out", status: "Scheduled", tone: "brand" as const },
                      { unit: "Unit 4A · turnover", status: "Photos sent", tone: "good" as const },
                      { unit: "Unit 1C · recurring", status: "Every 2 weeks", tone: "neutral" as const },
                    ].map((r) => (
                      <li key={r.unit} className="flex items-center justify-between py-2 text-[13.5px] text-ink">
                        {r.unit}
                        <Chip tone={r.tone}>{r.status}</Chip>
                      </li>
                    ))}
                  </ul>
                </Frame>
                <Link href="/portfolio" className={cn(btnPrimary, "mt-5")}>
                  Book Now
                  <RiArrowRightLine className="h-4 w-4" />
                </Link>
              </article>
            </div>
          </div>
        </section>

        {/* ─── Devotion · Value · Care ───────────────────────────────── */}
        <section id="why" aria-labelledby="why-title" className={cn(gutter, "scroll-mt-20 border-t border-line bg-[#FAFAFC] py-20 sm:py-28")}>
          <div className={shell}>
            <Eyebrow>Why Novara</Eyebrow>
            <h2 id="why-title" className={sectionTitle}>
              What devotion, value, and care mean on a cleaning day.
            </h2>
            <div className="mt-10 grid gap-5 md:grid-cols-3">
              {[
                {
                  word: "Devotion",
                  icon: RiHandHeartLine,
                  photo: PHOTO.sink,
                  alt: "Kitchen sink and counter after a Novara clean",
                  body: "Every visit follows the written checklist for your service, room by room, and a photo report shows it was done.",
                  link: { href: "/checklist", label: "See the checklists" },
                },
                {
                  word: "Value",
                  icon: RiWallet3Line,
                  photo: PHOTO.cabinets,
                  alt: "Kitchen cabinets and backsplash after a Novara clean",
                  body: "You see the exact price for your home before you book. Standard cleans are 15% off online and deep cleans are 25% off.",
                  link: { href: "#prices", label: "See prices" },
                },
                {
                  word: "Care",
                  icon: RiShieldCheckLine,
                  photo: PHOTO.quartz,
                  alt: "Quartz counter wiped down after a Novara clean",
                  body: "Missed something? Tell us within 24 hours and we come back to re-clean it free. Novara Cleaning is insured.",
                  link: { href: "#guarantee", label: "Our guarantee" },
                },
              ].map((p) => (
                <article key={p.word} className="overflow-hidden rounded-3xl border border-line bg-white">
                  <div className="aspect-[4/3] overflow-hidden">
                    <Photo src={p.photo} alt={p.alt} />
                  </div>
                  <div className="p-6">
                    <div className="flex items-center gap-2">
                      <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#F3EEFF] text-[#6810FE]">
                        <p.icon className="h-5 w-5" />
                      </span>
                      <h3 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">{p.word}</h3>
                    </div>
                    <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">{p.body}</p>
                    <a href={p.link.href} className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-medium text-[#5A1FD6] hover:underline">
                      {p.link.label}
                      <RiArrowRightLine className="h-4 w-4" />
                    </a>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ─── How it works, with product frames ─────────────────────── */}
        <section id="how" aria-labelledby="how-title" className={cn(gutter, "scroll-mt-20 border-t border-line py-20 sm:py-28")}>
          <div className={shell}>
            <Eyebrow>How it works</Eyebrow>
            <h2 id="how-title" className={sectionTitle}>
              From booking to a checked, photographed clean.
            </h2>
            <p className={cn(lead, "mt-4")}>The screens below are examples of what you see at each step.</p>

            <ol className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
              <li className="flex flex-col">
                <Index n={1} />
                <h3 className="mt-1 text-[18px] font-semibold tracking-[-0.02em] text-ink">Book online</h3>
                <p className="mt-1 text-[14px] leading-relaxed text-ink-muted">Pick your home size and clean. The price is shown before you pay a 50% deposit.</p>
                <Frame label="Example" className="mt-4 flex-1">
                  <p className="text-[12px] text-ink-muted">{exampleBand ? `${exampleBand.label} sq ft` : "Your home"}</p>
                  <p className="mt-1 text-[15px] font-medium text-ink">Deep clean</p>
                  {exampleDeep > 0 ? (
                    <p className="mt-2 flex items-baseline gap-2">
                      <span className="text-[26px] font-semibold tracking-[-0.03em] text-ink">{dollars(exampleDeep)}</span>
                      <span className="text-[13px] text-ink-muted line-through">{dollars(exampleDeepList)}</span>
                    </p>
                  ) : null}
                  <Chip tone="brand" className="mt-2">25% off online</Chip>
                </Frame>
              </li>
              <li className="flex flex-col">
                <Index n={2} />
                <h3 className="mt-1 text-[18px] font-semibold tracking-[-0.02em] text-ink">Get your confirmation</h3>
                <p className="mt-1 text-[14px] leading-relaxed text-ink-muted">One confirmation with your visit time and a private link to your checklist.</p>
                <Frame label="Example" className="mt-4 flex-1">
                  <div className="flex items-center gap-2 text-[13px] text-ink">
                    <RiMailLine className="h-4 w-4 text-[#6810FE]" />
                    Your cleaning is confirmed
                  </div>
                  <div className="mt-3 rounded-lg border border-line bg-[#FAFAFC] p-3 text-[12.5px] text-ink-muted">
                    <p className="flex items-center gap-1.5"><RiCalendarCheckLine className="h-3.5 w-3.5 text-[#6810FE]" /> Your date and arrival window</p>
                    <p className="mt-1.5 flex items-center gap-1.5"><RiFileTextLine className="h-3.5 w-3.5 text-[#6810FE]" /> Your private checklist link</p>
                  </div>
                </Frame>
              </li>
              <li className="flex flex-col">
                <Index n={3} />
                <h3 className="mt-1 text-[18px] font-semibold tracking-[-0.02em] text-ink">We clean to the list</h3>
                <p className="mt-1 text-[14px] leading-relaxed text-ink-muted">Your cleaner brings the supplies and works through the checklist room by room.</p>
                <Frame label="Example" className="mt-4 flex-1">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#5A1FD6]">{kitchen.title}</p>
                  <ul className="mt-2 space-y-1.5">
                    {kitchen.items.slice(0, 3).map((item) => (
                      <li key={item} className="flex items-start gap-2 text-[12.5px] text-ink">
                        <RiCheckLine className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[#6810FE]" />
                        <span className="line-clamp-1">{item}</span>
                      </li>
                    ))}
                  </ul>
                </Frame>
              </li>
              <li className="flex flex-col">
                <Index n={4} />
                <h3 className="mt-1 text-[18px] font-semibold tracking-[-0.02em] text-ink">See the photos</h3>
                <p className="mt-1 text-[14px] leading-relaxed text-ink-muted">Before and after photos arrive when the clean is done. The balance is charged after.</p>
                <Frame label="Example" className="mt-4 flex-1">
                  <div className="grid grid-cols-2 gap-1.5">
                    {[PHOTO.range, PHOTO.sink, PHOTO.shower, PHOTO.tub].map((src) => (
                      <div key={src} className="aspect-square overflow-hidden rounded-md">
                        <Photo src={src} alt="" />
                      </div>
                    ))}
                  </div>
                </Frame>
              </li>
            </ol>
          </div>
        </section>

        <Standard />

        {/* ─── Customer portal ───────────────────────────────────────── */}
        <section id="portal" aria-labelledby="portal-title" className={cn(gutter, "scroll-mt-20 border-t border-line bg-[#FAFAFC] py-20 sm:py-28")}>
          <div className={cn(shell, "grid items-center gap-12 lg:grid-cols-2")}>
            <div>
              <Eyebrow>Your account</Eyebrow>
              <h2 id="portal-title" className={sectionTitle}>
                Every visit, photo, and receipt in one place.
              </h2>
              <p className={cn(lead, "mt-4")}>
                Sign in to see your upcoming visits, reschedule, look back at your photo reports, and manage a membership.
              </p>
              <ul className="mt-6 space-y-3">
                {["Upcoming visits and arrival windows", "Reschedule or cancel from your account", "Before and after photos from each clean", "Membership visits and billing"].map((t) => (
                  <li key={t} className="flex items-start gap-2.5 text-[15px] text-ink">
                    <RiCheckLine className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#6810FE]" />
                    {t}
                  </li>
                ))}
              </ul>
              <div className="mt-8 flex flex-wrap gap-3">
                <BookNowLink className={btnPrimary}>
                  Book Now
                  <RiArrowRightLine className="h-4 w-4" />
                </BookNowLink>
                <Link href="/auth" className={btnOutline}>
                  Sign in
                </Link>
              </div>
            </div>
            <Frame glow label="Example account">
              <div className="flex items-center justify-between">
                <p className="text-[15px] font-medium text-ink">Upcoming visit</p>
                <Chip tone="good" dot>Confirmed</Chip>
              </div>
              <div className="mt-3 grid grid-cols-[auto_1fr] items-center gap-4 rounded-xl border border-line p-3">
                <div className="h-16 w-16 overflow-hidden rounded-lg">
                  <Photo src={PHOTO.living} alt="" />
                </div>
                <div>
                  <p className="text-[14px] font-medium text-ink">Deep clean</p>
                  <p className="text-[12.5px] text-ink-muted">Arrival window · 3 hours</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[12.5px]">
                {[
                  { icon: RiCalendarCheckLine, label: "Reschedule" },
                  { icon: RiCameraLine, label: "Photos" },
                  { icon: RiWallet3Line, label: "Receipts" },
                ].map(({ icon: Icon, label }) => (
                  <div key={label} className="rounded-lg border border-line bg-[#FAFAFC] px-2 py-3 text-ink">
                    <Icon className="mx-auto mb-1 h-5 w-5 text-[#6810FE]" />
                    {label}
                  </div>
                ))}
              </div>
              <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#5A1FD6]">Last photo report</p>
              <div className="mt-2 grid grid-cols-4 gap-1.5">
                {[PHOTO.counter, PHOTO.range, PHOTO.quartz, PHOTO.cabinets].map((src) => (
                  <div key={src} className="aspect-square overflow-hidden rounded-md">
                    <Photo src={src} alt="" />
                  </div>
                ))}
              </div>
            </Frame>
          </div>
        </section>

        <GuaranteeBand />
        <div id="prices" className="scroll-mt-20">
          <Pricing prices={prices} />
        </div>
        <Hosts />

        {/* ─── Service areas ─────────────────────────────────────────── */}
        <section id="areas" aria-labelledby="areas-title" className={cn(gutter, "scroll-mt-20 border-t border-line py-20 sm:py-28")}>
          <div className={shell}>
            <Eyebrow>Where we clean</Eyebrow>
            <h2 id="areas-title" className={sectionTitle}>
              {totalZips > 0 ? `${totalZips.toLocaleString()} ZIP codes across the DMV.` : "Maryland, Washington DC, and Northern Virginia."}
            </h2>
            <p className={cn(lead, "mt-4")}>
              Booking checks your ZIP first. If we don&rsquo;t serve it yet, we tell you and add you to the waitlist.
            </p>
            <div className="mt-10 grid gap-5 md:grid-cols-3">
              {(coverage || (["MD", "DC", "VA"] as const).map((state) => ({ state, zips: 0 }))).map(({ state, zips }) => (
                <div key={state} className="rounded-3xl border border-line bg-white p-6 shadow-[0_16px_40px_-32px_rgba(11,10,17,0.35)]">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[19px] font-semibold tracking-[-0.02em] text-ink">{STATE_NAME[state]}</h3>
                    {zips > 0 ? <Chip tone="brand">{zips} ZIPs</Chip> : null}
                  </div>
                  <ul className="mt-4 flex flex-wrap gap-1.5">
                    {STATE_CITIES[state].map((c) => (
                      <li key={c} className="rounded-full border border-line bg-[#FAFAFC] px-2.5 py-1 text-[12.5px] text-ink-muted">
                        {c}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <BookNowLink className={cn(btnOutline, "mt-8")}>
              <RiMapPinLine className="h-4 w-4 text-[#6810FE]" />
              Check your ZIP
            </BookNowLink>
          </div>
        </section>

        {/* ─── Insurance + hiring ────────────────────────────────────── */}
        <section aria-label="Insurance and careers" className={cn(gutter, "border-t border-line py-14")}>
          <div className={cn(shell, "grid gap-5 md:grid-cols-2")}>
            <a href={COI_PATH} target="_blank" rel="noopener" className="group flex items-center gap-4 rounded-3xl border border-line bg-white p-6 transition hover:border-[#C9B6FF]">
              <span className="grid h-12 w-12 flex-shrink-0 place-items-center rounded-2xl bg-[#F3EEFF] text-[#6810FE]">
                <RiShieldCheckLine className="h-6 w-6" />
              </span>
              <span className="flex-1">
                <span className="block text-[17px] font-semibold tracking-[-0.02em] text-ink">Insured company</span>
                <span className="block text-[14px] text-ink-muted">Download our current certificate of insurance (PDF).</span>
              </span>
              <RiDownload2Line className="h-5 w-5 text-ink-muted transition group-hover:text-[#6810FE]" />
            </a>
            <a href={HIRING_URL} className="group flex items-center gap-4 rounded-3xl border border-line bg-white p-6 transition hover:border-[#C9B6FF]">
              <span className="grid h-12 w-12 flex-shrink-0 place-items-center rounded-2xl bg-[#F3EEFF] text-[#6810FE]">
                <RiBriefcaseLine className="h-6 w-6" />
              </span>
              <span className="flex-1">
                <span className="block text-[17px] font-semibold tracking-[-0.02em] text-ink">Join the team</span>
                <span className="block text-[14px] text-ink-muted">We&rsquo;re hiring cleaners in Maryland, DC, and Virginia.</span>
              </span>
              <RiArrowRightUpLine className="h-5 w-5 text-ink-muted transition group-hover:text-[#6810FE]" />
            </a>
          </div>
        </section>

        <Faq />

        {/* ─── Final call to action ──────────────────────────────────── */}
        <section aria-labelledby="final-title" className={cn(gutter, "pb-24 pt-6")}>
          <div className={cn(shell, "relative overflow-hidden rounded-[2rem]")}>
            <Photo src={PHOTO.range} alt="" className="absolute inset-0" />
            <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-r from-[#16043F]/95 via-[#16043F]/85 to-[#16043F]/40" />
            <div className="relative px-7 py-14 sm:px-12 sm:py-20">
              <h2 id="final-title" className="max-w-xl text-[2rem] font-semibold leading-tight tracking-[-0.03em] text-white sm:text-[2.6rem]">
                Ready for a clean you can check?
              </h2>
              <p className="mt-3 max-w-lg text-[16px] leading-relaxed text-white/80">
                Book a home clean online, get a turnover rate for your rental, or ask about your office.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <BookNowLink className={cn(btnPrimary, "bg-none bg-white text-[#16043F] shadow-none hover:bg-white/90")}>
                  <RiHome4Line className="h-5 w-5" />
                  Book a home clean
                </BookNowLink>
                <Link href="/str" className="inline-flex h-12 items-center justify-center gap-2 rounded-[9px] border border-white/30 px-5 text-[15px] font-medium text-white transition hover:bg-white/10">
                  <RiHotelBedLine className="h-5 w-5" />
                  Airbnb turnover rate
                </Link>
                <a href={COMMERCIAL_URL} className="inline-flex h-12 items-center justify-center gap-2 rounded-[9px] border border-white/30 px-5 text-[15px] font-medium text-white transition hover:bg-white/10">
                  <RiBuilding2Line className="h-5 w-5" />
                  Office cleaning
                </a>
              </div>
              <a href={INBOUND_PHONE.tel} className="mt-6 inline-flex items-center gap-2 text-[15px] text-white/85 hover:text-white">
                <RiPhoneLine className="h-5 w-5" />
                Or call {INBOUND_PHONE.display}
              </a>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
      <HomeMobileBar />
    </div>
  );
}
