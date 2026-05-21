"use client";

import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  RiArrowLeftLine as ArrowLeft,
  RiArrowRightLine as ArrowRight,
  RiCheckboxCircleLine as CheckCircle2,
  RiTimeLine as Clock,
  RiMoneyDollarCircleLine as DollarSign,
  RiMapPinLine as MapPin,
  RiSparklingLine as Sparkles,
} from "@remixicon/react";

export default function FieldCleanerPosting() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-secondary/5">
      <header className="border-b bg-white/80 backdrop-blur-lg">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/hiring" className="flex items-center gap-2">
            <Image src="/novara-logo.png" alt="Novara" width={40} height={40} className="rounded-xl" />
            <span className="font-bold text-xl">Novara Careers</span>
          </Link>
          <Link href="/hiring">
            <Button variant="ghost"><ArrowLeft className="w-4 h-4 mr-2" />Back</Button>
          </Link>
        </div>
      </header>

      <section className="container mx-auto max-w-3xl px-4 py-12 space-y-10">
        <div className="text-center">
          <Badge className="mb-4">Field Operations</Badge>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Field Cleaner</h1>
          <p className="text-muted-foreground mt-4 max-w-2xl mx-auto">
            Join a growing team of professional residential cleaners in the DMV. Set your own schedule,
            grow your pay tier through performance, and build a real career — not a side hustle.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Role overview</CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-4 mt-2">
              <span className="flex items-center gap-1"><Clock className="w-4 h-4" />Part-time / Full-time</span>
              <span className="flex items-center gap-1"><MapPin className="w-4 h-4" />Maryland, Virginia, DC</span>
              <span className="flex items-center gap-1"><DollarSign className="w-4 h-4" />$18/hr starting</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pt-0">
            <div>
              <h3 className="font-semibold mb-2">What you&apos;ll do</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> Deliver standard, deep, and move-in/out cleans for residential customers</li>
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> Accept job offers in your zones using our mobile dashboard</li>
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> Check in / check out at each job for accurate, on-time payouts</li>
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> Maintain high ratings and on-time percentage to unlock the next tier</li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold mb-2 flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" /> Tier-based pay</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><strong>Foundation</strong> — $18/hr starting. 10% platform fee.</li>
                <li><strong>Proven</strong> — Unlock after 6 months, 25+ jobs, 90%+ on-time, 4.8★+.</li>
                <li><strong>Elite</strong> — Unlock after 12 months, 50+ jobs, 95%+ on-time, 4.8★+.</li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold mb-2">What you&apos;ll get</h3>
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-primary" /> Weekly direct deposit</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-primary" /> Flexible scheduling</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-primary" /> Tips & performance bonuses</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-primary" /> Mobile job dispatch app</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-primary" /> Real career progression</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-primary" /> 1099 contractor — own your time</li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold mb-2">Requirements</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> Reliable transportation</li>
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> Smartphone for accepting jobs + check-in</li>
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> Background check + general liability insurance (or willing to obtain)</li>
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> Authorized to work in the U.S.</li>
              </ul>
            </div>
          </CardContent>
        </Card>

        <div className="text-center space-y-4">
          <p className="text-sm text-muted-foreground">Ready to apply? Verify your email and we&apos;ll get you onboarded in under 15 minutes.</p>
          <Link href="/cleaner/onboarding">
            <Button size="lg" className="px-8">Start application <ArrowRight className="w-4 h-4 ml-2" /></Button>
          </Link>
        </div>
      </section>

      <footer className="border-t mt-12 py-6 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} Novara Cleaning. Equal opportunity employer.
      </footer>
    </div>
  );
}

export const dynamic = "force-dynamic";
