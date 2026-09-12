"use client";

// Same-origin contractor ICA preview. DocuSeal's file links can be fetched,
// but an <iframe src="https://docuseal.com/...pdf"> is a blank box on a lot
// of phones (and some desktops). VA / commercial / host already proxy the
// template through our origin and render it with pdf.js — this is that
// pattern for cleaners.

import { RiExternalLinkLine } from "@remixicon/react";

import { PdfViewer } from "@/components/PdfViewer";

export const CLEANER_AGREEMENT_PDF_URL = "/api/cleaner/agreement-preview";

export function AgreementPdfPreview({
  className = "h-80 overflow-y-auto rounded-lg border border-slate-200 bg-slate-100",
}: {
  className?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end">
        <a
          href={CLEANER_AGREEMENT_PDF_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-violet-700 underline underline-offset-2"
        >
          <RiExternalLinkLine className="h-3.5 w-3.5" />
          Open in a new tab
        </a>
      </div>
      <PdfViewer
        url={CLEANER_AGREEMENT_PDF_URL}
        title="Independent Contractor Agreement"
        className={className}
      />
    </div>
  );
}
