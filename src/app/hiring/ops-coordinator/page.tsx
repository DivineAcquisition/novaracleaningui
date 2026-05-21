"use client";

import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  RiArrowLeftLine as ArrowLeft,
  RiCheckboxCircleLine as CheckCircle2,
  RiTimeLine as Clock,
  RiMoneyDollarCircleLine as DollarSign,
  RiMapPinLine as MapPin,
  RiMailLine as Mail,
} from "@remixicon/react";

export default function OpsCoordinatorPosting() {
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
          <Badge className="mb-4">Operations</Badge>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Operations Coordinator</h1>
          <p className="text-muted-foreground mt-4 max-w-2xl mx-auto">
            Run the daily heartbeat of Novara: dispatch jobs, coach the field team, and own customer
            satisfaction across the DMV.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Role overview</CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-4 mt-2">
              <span className="flex items-center gap-1"><Clock className="w-4 h-4" />Full-time</span>
              <span className="flex items-center gap-1"><MapPin className="w-4 h-4" />Baltimore, MD (hybrid)</span>
              <span className="flex items-center gap-1"><DollarSign className="w-4 h-4" />Based on experience</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pt-0">
            <div>
              <h3 className="font-semibold mb-2">What you&apos;ll own</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> Daily dispatch of bookings to the field cleaner roster</li>
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> Schedule conflict resolution + on-the-fly reassignments</li>
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> Customer issue triage + recovery plays (refunds, re-cleans, escalations)</li>
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> Cleaner performance reviews, compliance tracking, tier promotions</li>
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> Weekly ops KPIs: on-time %, completion rate, NPS, revenue per cleaner</li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold mb-2">You&apos;re a fit if you</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> Thrive on operational chaos and turn it into clean systems</li>
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> Have 2+ years of ops / dispatch / service industry experience</li>
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> Communicate clearly via SMS, phone, and dashboards</li>
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> Are comfortable in HighLevel, Supabase, or willing to learn fast</li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold mb-2">Benefits</h3>
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-primary" /> Health benefits</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-primary" /> Paid time off</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-primary" /> Hybrid work</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-primary" /> Ascension Program: clear path to Director of Ops</li>
              </ul>
            </div>
          </CardContent>
        </Card>

        <div className="text-center space-y-4">
          <a href="mailto:careers@novaracleaning.com?subject=Ops%20Coordinator%20Application">
            <Button size="lg" className="px-8"><Mail className="w-4 h-4 mr-2" />Apply via email</Button>
          </a>
          <p className="text-xs text-muted-foreground">careers@novaracleaning.com — include your resume + a paragraph on a time you cleaned up an ops mess.</p>
        </div>
      </section>

      <footer className="border-t mt-12 py-6 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} Novara Cleaning. Equal opportunity employer.
      </footer>
    </div>
  );
}

export const dynamic = "force-dynamic";
