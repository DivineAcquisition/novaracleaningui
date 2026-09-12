"use client";

// Public landing page for one onboarding guide PDF.
//
// Phones will not paint a cross-origin (or even a same-origin) PDF in an
// iframe, so this uses PdfViewer — the same pdf.js renderer as the contractor
// agreement. The page is unauthenticated on purpose: the emails that point
// here are meant to open without a login.

import { RiDownloadLine, RiExternalLinkLine } from "@remixicon/react";

import { PdfViewer } from "@/components/PdfViewer";
import { SEO } from "@/components/SEO";
import { onboardingGuide, type OnboardingGuideId } from "@/lib/cleaner-onboarding-guides";

export function GuidePdfLanding({ guideId }: { guideId: OnboardingGuideId }) {
  const guide = onboardingGuide(guideId);

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <SEO
        title={guide.title}
        description={guide.lede}
        canonical={`https://contractor.novaracleaning.com${guide.landingPath}`}
        noindex
      />

      <header className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <img src="/novara-logo.png" alt="Novara Cleaning" className="h-8 w-auto shrink-0" />
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold tracking-tight">{guide.title}</h1>
              <p className="hidden truncate text-xs text-slate-400 sm:block">{guide.lede}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <a
              href={guide.pdf}
              download
              className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-200 hover:text-white"
            >
              <RiDownloadLine className="h-3.5 w-3.5" />
              Download
            </a>
            <a
              href={guide.pdf}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-200 hover:text-white"
            >
              <RiExternalLinkLine className="h-3.5 w-3.5" />
              Open PDF
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-3 py-4 sm:px-4 sm:py-6">
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-white shadow-2xl">
          <PdfViewer
            url={guide.pdf}
            title={guide.title}
            className="min-h-[80vh] bg-white text-slate-900"
          />
        </div>
      </main>
    </div>
  );
}
