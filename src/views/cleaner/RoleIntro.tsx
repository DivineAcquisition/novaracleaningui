"use client";

// ─── Cleaner Role Introduction ─────────────────────────────────────────
//
// Public-facing introduction to the independent-contractor cleaner role on
// the contractor domain (contractor.novaracleaning.com/cleaner/role).
// Reached from the Framer hiring funnel, recruiting messages, and the
// onboarding emails. Includes:
//   • an intro video (Wistia)
//   • what the role is + how pay works + expectations
//   • a one-tap download of the official supply checklist PDF
//   • CTAs into the application / sign-in flow

import Link from "next/link";
import {
  RiArrowRightLine,
  RiCheckboxCircleFill,
  RiDownload2Line,
  RiFileTextLine,
  RiMoneyDollarCircleLine,
  RiCalendarScheduleLine,
  RiMapPin2Line,
  RiShieldCheckLine,
  RiSparklingLine,
  RiStarSmileLine,
} from "@remixicon/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SEO } from "@/components/SEO";
import { WistiaPlayer } from "@/components/cleaner/WistiaPlayer";

const SUPPLY_CHECKLIST_PDF = "/NovaraCleaning_Supply_Checklist_dd14.pdf";

const HIGHLIGHTS = [
  {
    icon: RiMoneyDollarCircleLine,
    title: "Revenue-share pay",
    body: "Earn a percentage of every job's revenue — 35% to start, rising to 45% as you prove yourself. The more jobs you ace, the more you make per clean.",
  },
  {
    icon: RiCalendarScheduleLine,
    title: "You set your availability",
    body: "Accept the jobs that fit your schedule. We text you offers nearby; tap accept and the address + details unlock in your dashboard.",
  },
  {
    icon: RiMapPin2Line,
    title: "Work in your area",
    body: "We route jobs based on your home base and service ZIPs, so you spend less time driving and more time earning.",
  },
  {
    icon: RiShieldCheckLine,
    title: "Independent & in control",
    body: "You're an independent contractor: you bring your own supplies and run your own clean, backed by Novara's scheduling, payments, and support.",
  },
];

const EXPECTATIONS = [
  "Show up on time and check in through the app when you arrive.",
  "Follow the job's cleaning checklist and our quality standards.",
  "Bring your own supplies (see the checklist below).",
  "Treat every home and customer with care and professionalism.",
  "Upload before/after photos and mark the job complete when done.",
];

export default function CleanerRoleIntro() {
  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="The Cleaner Role"
        description="Learn what it's like to clean with Novara Cleaning as an independent contractor — flexible jobs, revenue-share pay, and the supplies you'll need to get started."
        noindex
      />

      {/* Hero */}
      <header
        className="border-b border-emerald-200 bg-gradient-to-br from-emerald-50 to-white"
        style={{
          backgroundImage:
            "radial-gradient(circle at top left, rgba(22,163,74,0.10), transparent 60%)",
        }}
      >
        <div className="max-w-3xl mx-auto px-4 py-8 sm:py-10">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center shadow-sm">
              <RiSparklingLine className="w-5 h-5 text-white" />
            </span>
            <p className="text-[11px] uppercase tracking-wider font-semibold text-emerald-700">
              Novara Cleaning · Contractor
            </p>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
            Welcome to the cleaner role
          </h1>
          <p className="mt-2 text-slate-600 sm:text-lg max-w-2xl">
            Here&apos;s a quick look at what cleaning with Novara is all about —
            how the work flows, how you get paid, and exactly what you&apos;ll
            need to bring to your first job.
          </p>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 sm:py-8 space-y-8">
        {/* Intro video */}
        <section>
          <Card className="overflow-hidden border-slate-200 shadow-sm">
            <div className="bg-slate-900">
              <WistiaPlayer mediaId="9toazzorrp" aspect={1.6783216783216783} />
            </div>
            <CardContent className="py-3 px-4">
              <p className="text-sm text-slate-500 inline-flex items-center gap-1.5">
                <RiStarSmileLine className="w-4 h-4 text-emerald-600" />
                A 2-minute intro to cleaning with Novara.
              </p>
            </CardContent>
          </Card>
        </section>

        {/* What the role is */}
        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">
              What the role is
            </h2>
            <p className="text-slate-600 mt-1">
              You&apos;re an independent cleaning contractor. Novara brings you
              the customers, scheduling, and payments — you bring the supplies
              and a great clean.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {HIGHLIGHTS.map((h) => (
              <Card key={h.title} className="border-slate-200">
                <CardContent className="p-4 flex gap-3">
                  <span className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                    <h.icon className="w-5 h-5" />
                  </span>
                  <div>
                    <p className="font-semibold text-slate-900">{h.title}</p>
                    <p className="text-sm text-slate-600 mt-0.5">{h.body}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* What we expect */}
        <section>
          <Card className="border-slate-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg text-slate-900">
                What we expect on every job
              </CardTitle>
              <CardDescription>
                Simple standards that keep our customers happy and our cleaners
                booked.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {EXPECTATIONS.map((e) => (
                  <li key={e} className="flex items-start gap-2.5 text-sm text-slate-700">
                    <RiCheckboxCircleFill className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                    <span>{e}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>

        {/* Supply checklist download */}
        <section>
          <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50 to-white">
            <CardContent className="p-5 sm:p-6">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <span className="w-12 h-12 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                  <RiFileTextLine className="w-6 h-6" />
                </span>
                <div className="flex-1">
                  <h2 className="text-lg font-bold text-slate-900">
                    Download the supply checklist
                  </h2>
                  <p className="text-sm text-slate-600 mt-0.5">
                    As an independent contractor you provide your own supplies.
                    This checklist covers everything you need before your first
                    job, plus optional items for premium cleans.
                  </p>
                </div>
                <Button
                  asChild
                  size="lg"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white shrink-0 w-full sm:w-auto"
                >
                  <a
                    href={SUPPLY_CHECKLIST_PDF}
                    download="Novara-Cleaning-Supply-Checklist.pdf"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <RiDownload2Line className="w-5 h-5 mr-2" />
                    Download PDF
                  </a>
                </Button>
              </div>
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-600">
                <span className="inline-flex items-center gap-1.5">
                  <RiCheckboxCircleFill className="w-3.5 h-3.5 text-emerald-600" />
                  Cleaning solutions, tools & safety gear
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <RiCheckboxCircleFill className="w-3.5 h-3.5 text-emerald-600" />
                  What to add later for premium jobs
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <RiCheckboxCircleFill className="w-3.5 h-3.5 text-emerald-600" />
                  Natural-stone safety do&apos;s and don&apos;ts
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <RiCheckboxCircleFill className="w-3.5 h-3.5 text-emerald-600" />
                  Pro tips to stay organized & efficient
                </span>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* CTAs */}
        <section className="flex flex-col sm:flex-row gap-3">
          <Button
            asChild
            size="lg"
            className="flex-1 h-12 bg-gradient-to-br from-emerald-500 to-emerald-700 hover:from-emerald-600 hover:to-emerald-800 text-white font-semibold"
          >
            <Link href="/cleaner/onboarding">
              Start your application
              <RiArrowRightLine className="w-5 h-5 ml-1.5" />
            </Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant="outline"
            className="flex-1 h-12 border-slate-200 text-slate-700"
          >
            <Link href="/cleaner/auth">Already approved? Sign in</Link>
          </Button>
        </section>

        <p className="text-center text-[11px] text-slate-400 pt-2">
          Questions? Message us in the operations channel.
        </p>
      </main>
    </div>
  );
}
