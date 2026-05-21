"use client";

import { useEffect, useState, type ReactNode } from "react";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import {
  RiArrowLeftLine,
  RiClipboardLine,
  RiCheckboxCircleLine,
} from "@remixicon/react";

const HIRING_HOST = "https://hiring.novaracleaning.com/hiring";

export interface RoleSection {
  title: string;
  items: string[];
}

export interface RoleBenefit {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
}

export interface RoleDetailProps {
  jobData: {
    title: string;
    subtitle: string;
    department: string;
    location: string;
    type: string;
    compensation: string;
    mission: string;
    description: string;
    techStack?: string[];
    sections: RoleSection[];
    benefits: RoleBenefit[];
  };
  /** Fillout form ID (e.g. "p9FCwh89JPus"). */
  filloutId: string;
  /** Optional extra section (used by Field Cleaner for the Ascension Program). */
  extraSection?: ReactNode;
}

function GlowDot() {
  return (
    <span className="relative flex h-2 w-2">
      <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-75 animate-ping-dot" />
      <span className="relative inline-flex rounded-full h-2 w-2 bg-primary shadow-[0_0_10px_hsl(260_100%_50%/0.5)]" />
    </span>
  );
}

const aboutContent = `Novara Cleaning delivers premium residential cleaning services across the DC, Maryland & Virginia area. We exist to transform homes and create peace of mind for busy families.

Our philosophy rests on three pillars:
• Excellence — We hold ourselves to the highest standards
• Care — Every home is treated like our own
• Reliability — Consistent, dependable service every time

What we believe:
• Customer first — every decision starts with the customer
• Quality over quantity — we'd rather do fewer jobs exceptionally
• Team success — we win and lose together
• Continuous improvement — we're always getting better

Why join us:
Novara is more than a cleaning company. We're building a team of professionals who take pride in their work and care about making a difference.`;

const SHOULD_USE_ICONS = new Set(["Responsibilities", "Requirements"]);

export default function RoleDetailLayout({ jobData, filloutId, extraSection }: RoleDetailProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    // Load Fillout embed script once per page-mount.
    const SCRIPT_ID = "novara-fillout-embed";
    if (!document.getElementById(SCRIPT_ID)) {
      const script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src = "https://server.fillout.com/embed/v1/";
      script.async = true;
      document.body.appendChild(script);
    }
  }, []);

  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased selection:bg-primary/20 selection:text-primary overflow-x-hidden">
      <div className="fixed inset-0 pointer-events-none grid-pattern" />

      <div className="fixed inset-0 pointer-events-none">
        <div
          className="absolute top-[-15%] left-1/2 -translate-x-1/2 w-full md:w-[1200px] h-[700px]"
          style={{
            background:
              "radial-gradient(ellipse at center, hsl(260 100% 50% / 0.08) 0%, hsl(260 100% 50% / 0.03) 40%, transparent 70%)",
            filter: "blur(60px)",
          }}
        />
        <div
          className="absolute bottom-[-10%] right-0 w-[500px] h-[500px]"
          style={{
            background:
              "radial-gradient(ellipse at bottom right, hsl(260 100% 70% / 0.1) 0%, transparent 60%)",
            filter: "blur(80px)",
          }}
        />
      </div>

      <nav className="fixed top-0 left-0 right-0 z-50 h-20 border-b border-slate-200/50 bg-white/90 backdrop-blur-xl">
        <div className="max-w-5xl mx-auto h-full px-6 flex items-center justify-between">
          <a href={HIRING_HOST} className="flex items-center gap-3 group">
            <Image
              src="/novara-logo.png"
              alt="Novara"
              width={40}
              height={40}
              className="h-10 w-10 rounded-xl group-hover:opacity-80 transition-opacity"
            />
            <span className="font-bold text-xl text-slate-900">Novara</span>
          </a>
          <a
            href={HIRING_HOST}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold bg-primary text-white hover:bg-primary/90 transition-all shadow-lg shadow-primary/25"
          >
            <RiArrowLeftLine className="w-4 h-4" />
            All Positions
          </a>
        </div>
      </nav>

      <main className="relative z-10 pt-28 pb-20 px-6">
        <div className="max-w-4xl mx-auto">
          {/* Hero */}
          <section className={`mb-16 ${mounted ? "animate-fade-in" : "opacity-0"}`}>
            <div className="flex items-center gap-3 mb-6">
              <span className="w-8 h-px bg-gradient-to-r from-primary to-transparent" />
              <span className="text-xs font-semibold text-primary uppercase tracking-widest">
                {jobData.department}
              </span>
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-slate-900 tracking-tight mb-6">
              {jobData.title}
            </h1>
            <p className="text-xl text-slate-600 leading-relaxed mb-10 max-w-3xl">
              {jobData.description}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 p-6 rounded-2xl bg-slate-50/80 border border-slate-200/50 backdrop-blur-sm">
              <div>
                <p className="section-label mb-1">Department</p>
                <p className="text-sm font-medium text-slate-900">{jobData.department}</p>
              </div>
              <div>
                <p className="section-label mb-1">Location</p>
                <p className="text-sm font-medium text-slate-900">{jobData.location}</p>
              </div>
              <div>
                <p className="section-label mb-1">Type</p>
                <p className="text-sm font-medium text-slate-900">{jobData.type}</p>
              </div>
              <div>
                <p className="section-label mb-1">Compensation</p>
                <p className="text-sm font-medium text-primary">{jobData.compensation}</p>
              </div>
            </div>
          </section>

          {/* Mission */}
          <section className={`mb-16 ${mounted ? "animate-fade-in animation-delay-100" : "opacity-0"}`}>
            <div className="flex items-center gap-3 mb-6">
              <GlowDot />
              <h2 className="section-label">The Mission</h2>
            </div>
            <p className="text-lg text-slate-600 leading-relaxed">{jobData.mission}</p>
          </section>

          {/* Tech stack (optional) */}
          {jobData.techStack && jobData.techStack.length > 0 && (
            <section className={`mb-16 ${mounted ? "animate-fade-in animation-delay-200" : "opacity-0"}`}>
              <div className="flex items-center gap-3 mb-4">
                <GlowDot />
                <h2 className="section-label">Tech Stack</h2>
              </div>
              <div className="flex flex-wrap gap-2">
                {jobData.techStack.map((t) => (
                  <Badge key={t} variant="secondary" className="bg-slate-100 text-slate-700 border-0">
                    {t}
                  </Badge>
                ))}
              </div>
            </section>
          )}

          {/* Sections */}
          {jobData.sections.map((section, sectionIndex) => {
            const useIcons = SHOULD_USE_ICONS.has(section.title);
            return (
              <section
                key={sectionIndex}
                className={`mb-16 ${mounted ? "animate-fade-in" : "opacity-0"}`}
                style={{ animationDelay: `${(sectionIndex + 2) * 100}ms` }}
              >
                <div className="flex items-center gap-3 mb-6">
                  {useIcons ? (
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                      {section.title === "Responsibilities" ? (
                        <RiClipboardLine className="w-4 h-4" />
                      ) : (
                        <RiCheckboxCircleLine className="w-4 h-4" />
                      )}
                    </div>
                  ) : (
                    <GlowDot />
                  )}
                  <h2 className="section-label">{section.title}</h2>
                </div>
                <div className="space-y-4">
                  {section.items.map((item, itemIndex) => (
                    <div key={itemIndex} className="flex items-start gap-4 group">
                      {useIcons ? (
                        <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-primary group-hover:bg-primary/10 group-hover:border-primary/20 transition-all">
                          <RiCheckboxCircleLine className="w-4 h-4" />
                        </div>
                      ) : (
                        <div className="flex-shrink-0 mt-2">
                          <span className="block w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_8px_hsl(260_100%_50%/0.4)]" />
                        </div>
                      )}
                      <div className="flex-1 pt-1">
                        <p className="text-slate-600 leading-relaxed">{item}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}

          {/* Benefits */}
          <section className={`mb-16 ${mounted ? "animate-fade-in animation-delay-400" : "opacity-0"}`}>
            <div className="flex items-center gap-3 mb-6">
              <GlowDot />
              <h2 className="section-label">What We Offer</h2>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {jobData.benefits.map((benefit, idx) => (
                <div
                  key={idx}
                  className="p-4 rounded-xl bg-slate-50/80 border border-slate-200/50 hover:border-primary/30 hover:bg-white transition-all group"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-white transition-all">
                      <benefit.icon className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="font-medium text-sm text-slate-900">{benefit.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{benefit.desc}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {extraSection}

          {/* About */}
          <section
            className={`mb-16 p-8 rounded-2xl bg-gradient-to-br from-primary/5 to-transparent border border-primary/10 ${
              mounted ? "animate-fade-in animation-delay-400" : "opacity-0"
            }`}
          >
            <div className="flex items-center gap-3 mb-6">
              <GlowDot />
              <h2 className="section-label">About Novara Cleaning</h2>
            </div>
            <p className="text-slate-600 leading-relaxed whitespace-pre-line text-sm">{aboutContent}</p>
          </section>

          {/* Application / Fillout */}
          <section id="apply">
            <div className="relative rounded-2xl bg-white border border-slate-200 overflow-hidden shadow-lg shadow-slate-200/50">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[150px] bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />
              <div className="relative flex items-center gap-4 px-6 py-4 border-b border-slate-200 bg-slate-50">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-red-400" />
                  <span className="w-3 h-3 rounded-full bg-yellow-400" />
                  <span className="w-3 h-3 rounded-full bg-green-400" />
                </div>
                <div className="flex items-center gap-3 flex-1">
                  <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-white text-sm font-bold shadow-lg shadow-primary/30">
                    2
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">
                      Apply for {jobData.title}
                    </h2>
                    <p className="text-xs text-slate-500">
                      Complete the form below to submit your application
                    </p>
                  </div>
                </div>
              </div>
              <div className="relative" style={{ minHeight: 600 }}>
                <div
                  data-fillout-id={filloutId}
                  data-fillout-embed-type="standard"
                  data-fillout-inherit-parameters
                  style={{ width: "100%", height: 600 }}
                />
              </div>
            </div>
          </section>
        </div>
      </main>

      <footer className="relative z-10 border-t border-slate-200">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-3">
              <Image
                src="/novara-logo.png"
                alt="Novara"
                width={32}
                height={32}
                className="h-8 w-8 rounded-lg opacity-80 hover:opacity-100 transition-opacity"
              />
              <span className="text-slate-500 text-sm font-medium">
                {new Date().getFullYear()} © Novara Cleaning. All rights reserved.
              </span>
            </div>
            <div className="flex items-center gap-6">
              <a
                href="https://novaracleaning.com"
                className="text-xs text-slate-400 font-medium hover:text-primary transition-colors"
              >
                Website
              </a>
              <a
                href="mailto:careers@novaracleaning.com"
                className="text-xs text-slate-400 font-medium hover:text-primary transition-colors"
              >
                Contact
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
