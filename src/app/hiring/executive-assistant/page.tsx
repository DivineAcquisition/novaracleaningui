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

export default function ExecutiveAssistantPosting() {
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
          <Badge className="mb-4">Leverage</Badge>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Executive Assistant</h1>
          <p className="text-muted-foreground mt-4 max-w-2xl mx-auto">
            Be the operating leverage behind Novara&apos;s founder. Own calendar, inbox, projects, and the
            high-trust details that keep the business moving.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Role overview</CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-4 mt-2">
              <span className="flex items-center gap-1"><Clock className="w-4 h-4" />Full-time</span>
              <span className="flex items-center gap-1"><MapPin className="w-4 h-4" />Remote</span>
              <span className="flex items-center gap-1"><DollarSign className="w-4 h-4" />Based on experience</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pt-0">
            <div>
              <h3 className="font-semibold mb-2">What you&apos;ll own</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> Calendar + inbox management for the founder</li>
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> Travel, logistics, and project tracking</li>
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> Vendor communications, contract follow-ups, light bookkeeping</li>
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> Drafting messages, briefs, and SOP documentation</li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold mb-2">You&apos;re a fit if you</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> Have 2+ years supporting an executive or founder</li>
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> Are obsessively organized and great at written communication</li>
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> Move fast without sacrificing quality or discretion</li>
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> Comfortable with Gmail, Notion, GHL, Slack, Linear (or able to learn)</li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold mb-2">Benefits</h3>
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-primary" /> 100% remote</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-primary" /> Health benefits</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-primary" /> Flexible hours</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-primary" /> Professional development stipend</li>
              </ul>
            </div>
          </CardContent>
        </Card>

        <div className="text-center space-y-4">
          <a href="mailto:careers@novaracleaning.com?subject=Executive%20Assistant%20Application">
            <Button size="lg" className="px-8"><Mail className="w-4 h-4 mr-2" />Apply via email</Button>
          </a>
          <p className="text-xs text-muted-foreground">careers@novaracleaning.com — include your resume + a paragraph on the last project you ran end-to-end.</p>
        </div>
      </section>

      <footer className="border-t mt-12 py-6 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} Novara Cleaning. Equal opportunity employer.
      </footer>
    </div>
  );
}

export const dynamic = "force-dynamic";
