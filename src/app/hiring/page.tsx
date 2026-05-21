"use client";

import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  RiArrowRightLine as ArrowRight,
  RiBriefcaseLine as Briefcase,
  RiMapPinLine as MapPin,
  RiMoneyDollarCircleLine as DollarSign,
  RiCheckboxCircleLine as CheckCircle2,
} from "@remixicon/react";

const positions = [
  {
    id: "field-cleaner",
    title: "Field Cleaner",
    type: "Part-Time / Full-Time",
    location: "DMV — Maryland, Virginia, DC",
    pay: "Starts at $18/hr — based on experience",
    description:
      "Join our team of professional cleaners and deliver exceptional residential cleaning across the DMV. Tier-based pay progression from Foundation → Proven → Elite.",
    benefits: ["Flexible scheduling", "Weekly direct deposit", "Tips & bonuses", "Tier-based pay growth"],
    applyHref: "/cleaner/onboarding",
  },
  {
    id: "ops-coordinator",
    title: "Operations Coordinator",
    type: "Full-Time",
    location: "Baltimore, MD",
    pay: "Based on experience",
    description:
      "Coordinate daily operations, manage cleaner schedules, dispatch jobs, and ensure customer satisfaction across the field team.",
    benefits: ["Health benefits", "Paid time off", "Hybrid work", "Ascension Program eligibility"],
    applyHref: "/hiring/ops-coordinator",
  },
  {
    id: "executive-assistant",
    title: "Executive Assistant",
    type: "Full-Time",
    location: "Remote",
    pay: "Based on experience",
    description:
      "Support executive leadership with administrative tasks, project management, and high-leverage operations support.",
    benefits: ["100% remote", "Health benefits", "Flexible hours", "Professional development"],
    applyHref: "/hiring/executive-assistant",
  },
];

export default function Hiring() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-secondary/5">
      <header className="border-b bg-white/80 backdrop-blur-lg">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/hiring" className="flex items-center gap-2">
            <Image src="/novara-logo.png" alt="Novara" width={40} height={40} className="rounded-xl" />
            <span className="font-bold text-xl">Novara Careers</span>
          </Link>
          <a href="https://try.novaracleaning.com" target="_blank" rel="noopener noreferrer">
            <Button variant="outline">Visit novaracleaning.com</Button>
          </a>
        </div>
      </header>

      <section className="py-16 md:py-24 px-4">
        <div className="container mx-auto max-w-4xl text-center">
          <Badge className="mb-4">We&apos;re Hiring</Badge>
          <h1 className="text-4xl md:text-6xl font-bold mb-6 tracking-tight">
            Build the future of cleaning at <span className="text-primary">Novara</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            We&apos;re a tech-forward residential cleaning company serving the DMV. Join a team that values
            craft, transparency, and growth — with a real tier-based path from field work to leadership.
          </p>
        </div>
      </section>

      <section className="py-12 px-4">
        <div className="container mx-auto max-w-4xl">
          <h2 className="text-2xl font-bold mb-8 text-center">Open Positions</h2>
          <div className="space-y-6">
            {positions.map((position) => (
              <Card key={position.id} className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                    <div>
                      <CardTitle className="text-xl">{position.title}</CardTitle>
                      <CardDescription className="flex flex-wrap items-center gap-4 mt-2">
                        <span className="flex items-center gap-1"><Briefcase className="w-4 h-4" />{position.type}</span>
                        <span className="flex items-center gap-1"><MapPin className="w-4 h-4" />{position.location}</span>
                        <span className="flex items-center gap-1"><DollarSign className="w-4 h-4" />{position.pay}</span>
                      </CardDescription>
                    </div>
                    <Link href={position.applyHref}>
                      <Button>
                        Apply Now <ArrowRight className="w-4 h-4 ml-2" />
                      </Button>
                    </Link>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground mb-4">{position.description}</p>
                  <div className="flex flex-wrap gap-2">
                    {position.benefits.map((benefit) => (
                      <Badge key={benefit} variant="secondary" className="flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        {benefit}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 px-4 bg-primary/5">
        <div className="container mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-bold mb-4">Don&apos;t see the right fit?</h2>
          <p className="text-muted-foreground mb-6">
            Send us your resume anyway. We&apos;re always looking for talented people who want to grow with us.
          </p>
          <a href="mailto:careers@novaracleaning.com">
            <Button variant="outline" size="lg">Send your resume</Button>
          </a>
        </div>
      </section>

      <footer className="border-t mt-12 py-6 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} Novara Cleaning. Equal opportunity employer.
      </footer>
    </div>
  );
}

export const dynamic = "force-dynamic";
