"use client";

// ─── /commercial/success — intake confirmation ──────────────────────────────
// Sets expectations: no pricing shown; the team reviews and reaches out.

import { useSearchParams } from "next/navigation";
import { RiCheckboxCircleFill, RiTimeLine, RiFileList3Line, RiTeamLine } from "@remixicon/react";
import { SEO } from "@/components/SEO";
import { CompanyCoiDownloadLink } from "@/components/commercial/CompanyCoiDownloadLink";

const PURPLE_GRADIENT = "linear-gradient(135deg,#5C0FFE 0%,#8F7BFD 100%)";

export default function CommercialSuccess() {
  const params = useSearchParams();
  const type = params.get("type");
  const isStr = type === "str";

  const steps = [
    { icon: RiFileList3Line, title: "We review your request", desc: "Our partnerships team looks at your details and prepares a tailored plan — no cookie-cutter quotes." },
    { icon: RiTeamLine, title: "We reach out", desc: "Usually within one business day, to talk scope, walkthroughs, and rates." },
    { icon: RiTimeLine, title: "Onboarding & go-live", desc: isStr ? "Agreement, payment setup, property details — then you can request turnovers from your partner portal." : "Agreement, payment setup, site details — then your service schedule goes live." },
  ];

  return (
    <div className="min-h-screen bg-background">
      <SEO title="Request received — Novara Cleaning Partnerships" description="Your partnership request has been received. Our team will reach out with next steps." />
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center">
          <img src="/novara-email-logo.png" alt="Novara Cleaning" className="h-[22px] w-auto" />
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-12 text-center space-y-8">
        <div>
          <div className="w-16 h-16 rounded-full mx-auto flex items-center justify-center mb-4" style={{ background: PURPLE_GRADIENT }}>
            <RiCheckboxCircleFill className="w-9 h-9 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900">Request received!</h1>
          <p className="text-slate-500 mt-2">
            We'll review your details and reach out with next steps — usually within one business day.
          </p>
        </div>
        <div className="grid gap-3 text-left">
          {steps.map((s, i) => (
            <div key={i} className="token-card flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: PURPLE_GRADIENT }}>
                <s.icon className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="font-bold text-slate-900">{i + 1}. {s.title}</p>
                <p className="text-sm text-slate-500 mt-0.5">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="text-sm text-slate-600">
          Need our certificate of insurance for your building manager in the meantime?{" "}
          <CompanyCoiDownloadLink tone="quiet" />
        </p>
        <p className="text-xs text-slate-400">
          Questions in the meantime? Email <a href="mailto:contact@novaracleaning.com" className="text-violet-600 font-semibold">contact@novaracleaning.com</a> or call +1 (844) 735-2070.
        </p>
      </main>
    </div>
  );
}
