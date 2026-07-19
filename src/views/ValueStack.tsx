"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  RiArrowLeftLine,
  RiArrowRightLine,
  RiCheckboxCircleFill,
  RiExternalLinkLine,
  RiSparklingLine,
} from "@remixicon/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SEO } from "@/components/SEO";
import { CHECKLIST_INDEX_PATH, VALUE_STACK_ITEMS } from "@/lib/value-stack";

export default function ValueStackPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="What's Included — Value Stack | Novara Cleaning"
        description="See everything included with every Novara clean — photo proof, loyalty credit, your customer dashboard, and vetted pros."
        canonical="https://try.novaracleaning.com/value-stack"
      />

      <div className="border-b border-border/50">
        <div className="container max-w-3xl mx-auto px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/")}
            className="text-muted-foreground -ml-2"
          >
            <RiArrowLeftLine className="w-4 h-4 mr-1.5" /> Back home
          </Button>
        </div>
      </div>

      <div className="bg-gradient-to-b from-violet-50/70 via-white to-white dark:from-violet-950/20 dark:via-background dark:to-background">
        <div className="container max-w-3xl mx-auto px-4 py-12 md:py-16 text-center">
          <Badge
            variant="outline"
            className="bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/30 dark:text-violet-300 dark:border-violet-900 px-3 py-1 text-xs font-medium"
          >
            <RiSparklingLine className="w-3.5 h-3.5 mr-1.5" />
            Included with every clean
          </Badge>
          <h1 className="text-3xl md:text-5xl font-bold font-jakarta tracking-tight mt-4">
            The Novara value stack
          </h1>
          <p className="text-base md:text-lg text-muted-foreground mt-3 max-w-2xl mx-auto">
            You&apos;re not just booking a clean — you get documented proof, a loyalty credit,
            your own dashboard, and vetted pros. Here&apos;s everything that comes with the job.
          </p>
        </div>
      </div>

      <div className="container max-w-3xl mx-auto px-4 pb-16 space-y-4">
        {VALUE_STACK_ITEMS.map((item) => (
          <Card key={item.headline} className="border-primary/10 shadow-sm">
            <CardContent className="p-5 md:p-6 flex gap-3">
              <RiCheckboxCircleFill className="w-6 h-6 text-primary shrink-0 mt-0.5" />
              <div className="min-w-0 text-left">
                <h2 className="text-lg md:text-xl font-bold font-jakarta text-foreground">
                  {item.headline}
                </h2>
                <p className="text-sm font-medium text-primary mt-1">{item.tagline}</p>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                  {item.description}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}

        <div className="rounded-2xl border border-border bg-muted/30 p-5 md:p-6 space-y-3 text-center">
          <h3 className="text-base font-semibold font-jakarta">Want the room-by-room scope?</h3>
          <p className="text-sm text-muted-foreground">
            Open the cleaning checklist for exact line items your team will execute.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center pt-1">
            <Button asChild className="bg-gradient-primary hover:opacity-90">
              <Link href={CHECKLIST_INDEX_PATH}>
                View cleaning checklists
                <RiArrowRightLine className="w-4 h-4 ml-1.5" />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/book/zip">
                Book a clean
                <RiExternalLinkLine className="w-4 h-4 ml-1.5" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
