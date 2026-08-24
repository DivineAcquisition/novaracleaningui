// Builds the executed Commercial Cleaning Services Agreement in the browser.
//
// Same approach as the residential one-time agreement: pdf-lib renders the
// document with the client's details and drawn signature, and the bytes are
// posted back as base64 to be stored privately and kept permanently.
//
// The difference is Exhibit A. A commercial agreement without the schedule of
// sites and rates attached is not the agreement anybody negotiated, so the
// schedule is rendered into the document itself rather than referenced.

import { money, NET_TERMS_LABELS, INVOICE_CYCLE_LABELS, TERM_LABELS, titleCase } from "@/lib/commercial-proposal";
import type { NetTerms, InvoiceCycle, ProposalSite } from "@/lib/commercial-proposal";

export interface CommercialAgreementPdfFields {
  businessName: string;
  clientAddress?: string | null;
  signerName: string;
  signerTitle?: string | null;
  signerEmail: string;
  term: string;
  billingMethod: "auto_pay" | "invoiced";
  invoiceCycle?: string | null;
  netTerms?: string | null;
  sites: ProposalSite[];
  totalPerVisitCents: number;
  estimatedMonthlyCents?: number | null;
  signatureDataUrl?: string | null;
  companyName?: string;
  companyRep?: string;
  countersignedAt?: string | null;
}

const CLAUSES: Array<[string, string]> = [
  [
    "1. Services",
    "Company will provide commercial janitorial services at each location listed in Exhibit A, " +
      "at the scope level and frequency stated there. Scope is defined by the facility checklist " +
      "for each location's facility type and the findings of its site walkthrough.",
  ],
  [
    "2. Term",
    "This Agreement begins on the Effective Date and continues month-to-month. Either party may " +
      "terminate on thirty (30) days' written notice. No early-termination fee applies.",
  ],
  [
    "3. Personnel",
    "All personnel entering Client premises are background-checked and engaged by Company. " +
      "Company remains responsible for supervision, scheduling and payment of its personnel.",
  ],
  [
    "4. Access and Security",
    "Client will provide the access method, hours and any security or badge requirements recorded " +
      "for each location. Company will honour site-specific access and security instructions and " +
      "will notify Client of any change in assigned crew where the site requires it.",
  ],
  [
    "5. Fees and Payment",
    "Fees are the per-visit rates set out in Exhibit A. The billing method selected below governs " +
      "collection. Rates are held for the term and may be adjusted only on thirty (30) days' notice " +
      "or following a re-walkthrough that materially changes scope or square footage.",
  ],
  [
    "6. Supplies and Equipment",
    "Company supplies labour, standard cleaning chemicals and equipment. Consumables (paper goods, " +
      "liners, soap) are provided by Client unless Exhibit A states otherwise.",
  ],
  [
    "7. Quality and the Novara Guarantee",
    "Every visit is documented against the site checklist with photographic evidence. If work is " +
      "missed or deficient, Client may notify Company within twenty-four (24) hours of the visit and " +
      "Company will return to correct it at no additional charge.",
  ],
  [
    "8. Insurance",
    "8.1 Company maintains commercial general liability insurance and will furnish Client with a " +
      "current certificate of insurance upon execution of this Agreement and upon each renewal for " +
      "as long as this Agreement remains in force. 8.2 Each party is responsible for its own " +
      "workers' compensation coverage as required by law.",
  ],
  [
    "9. Non-Solicitation",
    "During the term and for six (6) months after, Client will not directly engage Company personnel " +
      "assigned to Client's locations other than through Company.",
  ],
  [
    "10. Entire Agreement",
    "This Agreement, including Exhibit A, is the entire agreement between the parties and supersedes " +
      "any prior proposal or discussion. Amendments must be in writing.",
  ],
];

export async function buildCommercialAgreementBase64(
  fields: CommercialAgreementPdfFields,
): Promise<string> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const purple = rgb(0.486, 0.227, 0.929);
  const dark = rgb(0.12, 0.11, 0.18);
  const gray = rgb(0.42, 0.42, 0.5);
  const rule = rgb(0.88, 0.88, 0.92);

  const MARGIN = 56;
  const WIDTH = 612;
  const HEIGHT = 792;
  const RIGHT = WIDTH - MARGIN;

  let page = pdf.addPage([WIDTH, HEIGHT]);
  let y = HEIGHT - 56;

  const newPage = () => {
    page = pdf.addPage([WIDTH, HEIGHT]);
    y = HEIGHT - 56;
  };
  const room = (needed: number) => {
    if (y - needed < 64) newPage();
  };

  const text = (
    value: string,
    opts: { size?: number; f?: typeof font; color?: typeof dark; x?: number; dy?: number } = {},
  ) => {
    const size = opts.size ?? 10;
    page.drawText(value, {
      x: opts.x ?? MARGIN,
      y,
      size,
      font: opts.f ?? font,
      color: opts.color ?? dark,
    });
    y -= opts.dy ?? size + 6;
  };

  /** Greedy wrap — pdf-lib has no layout engine. */
  const wrap = (
    value: string,
    opts: { size?: number; f?: typeof font; color?: typeof dark; width?: number; x?: number } = {},
  ) => {
    const size = opts.size ?? 9.5;
    const f = opts.f ?? font;
    const maxWidth = opts.width ?? RIGHT - (opts.x ?? MARGIN);
    const words = value.split(/\s+/);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (f.widthOfTextAtSize(candidate, size) > maxWidth && line) {
        room(size + 5);
        text(line, { size, f, color: opts.color, x: opts.x, dy: size + 4 });
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) {
      room(size + 5);
      text(line, { size, f, color: opts.color, x: opts.x, dy: size + 4 });
    }
  };

  const divider = () => {
    page.drawLine({
      start: { x: MARGIN, y: y + 4 },
      end: { x: RIGHT, y: y + 4 },
      thickness: 0.75,
      color: rule,
    });
    y -= 12;
  };

  const today = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const company = fields.companyName || "NovaraCleaning LLC";

  // ── Header ───────────────────────────────────────────────────────────
  text("Commercial Cleaning Services Agreement", { size: 17, f: bold, color: purple, dy: 22 });
  text(`${company} · Executed copy`, { size: 10, color: gray, dy: 18 });
  divider();

  const field = (label: string, value: string) => {
    room(16);
    page.drawText(label, { x: MARGIN, y, size: 9, font: bold, color: gray });
    page.drawText(value || "—", { x: MARGIN + 132, y, size: 10, font, color: dark });
    y -= 17;
  };

  field("Effective Date", today);
  field("Client", fields.businessName);
  if (fields.clientAddress) field("Client Address", fields.clientAddress);
  field("Authorized Signer", fields.signerName + (fields.signerTitle ? `, ${fields.signerTitle}` : ""));
  field("Signer Email", fields.signerEmail);
  field("Term", TERM_LABELS[fields.term] || titleCase(fields.term));
  field(
    "Billing Method",
    fields.billingMethod === "auto_pay"
      ? "Auto-Pay (card or ACH on file)"
      : `Invoiced — ${INVOICE_CYCLE_LABELS[(fields.invoiceCycle || "monthly") as InvoiceCycle] || "Monthly"}, ${
        NET_TERMS_LABELS[(fields.netTerms || "on_receipt") as NetTerms] || "Due on receipt"
      }`,
  );
  field("Total Per Visit", money(fields.totalPerVisitCents));
  if (fields.estimatedMonthlyCents) {
    field("Estimated Monthly", money(fields.estimatedMonthlyCents));
  }

  y -= 6;
  divider();

  // ── Terms ────────────────────────────────────────────────────────────
  for (const [heading, copy] of CLAUSES) {
    room(46);
    text(heading, { size: 10.5, f: bold, color: dark, dy: 14 });
    wrap(copy, { size: 9.5, color: dark });
    y -= 6;
  }

  // ── Exhibit A ────────────────────────────────────────────────────────
  newPage();
  text("Exhibit A — Schedule of Sites and Rates", { size: 15, f: bold, color: purple, dy: 20 });
  wrap(
    "Each rate below was set from that location's own walkthrough or from the rate engine for " +
      "locations under the walkthrough threshold. These are the rates billed — there is no separate " +
      "account-level rate.",
    { size: 9, color: gray },
  );
  y -= 8;

  // Column layout: site | details | rate
  const COL_RATE = RIGHT - 92;
  const header = () => {
    room(24);
    page.drawText("Location", { x: MARGIN, y, size: 8.5, font: bold, color: gray });
    page.drawText("Scope / cadence", { x: MARGIN + 190, y, size: 8.5, font: bold, color: gray });
    page.drawText("Per visit", { x: COL_RATE, y, size: 8.5, font: bold, color: gray });
    y -= 6;
    divider();
  };
  header();

  for (const site of fields.sites) {
    room(40);
    page.drawText(site.nickname.slice(0, 30), { x: MARGIN, y, size: 10, font: bold, color: dark });
    const details = [
      site.sqft ? `${site.sqft.toLocaleString()} sq ft` : null,
      site.facility_type ? titleCase(site.facility_type) : null,
      site.scope_level ? `${titleCase(site.scope_level)} scope` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    page.drawText(details.slice(0, 42), { x: MARGIN + 190, y, size: 8.5, font, color: dark });
    page.drawText(money(site.per_visit_price_cents), {
      x: COL_RATE,
      y,
      size: 10,
      font: bold,
      color: dark,
    });
    y -= 12;

    if (site.address) {
      page.drawText(site.address.slice(0, 44), { x: MARGIN, y, size: 8, font, color: gray });
    }
    const cadence = [
      site.frequency || null,
      site.crew_size ? `crew of ${site.crew_size}` : null,
      site.service_window_start && site.service_window_end
        ? `${String(site.service_window_start).slice(0, 5)}–${String(site.service_window_end).slice(0, 5)}`
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
    if (cadence) {
      page.drawText(cadence.slice(0, 42), { x: MARGIN + 190, y, size: 8, font, color: gray });
    }
    y -= 16;
  }

  divider();
  room(20);
  page.drawText("Total per visit, all locations", { x: MARGIN, y, size: 10, font: bold, color: dark });
  page.drawText(money(fields.totalPerVisitCents), {
    x: COL_RATE,
    y,
    size: 11,
    font: bold,
    color: purple,
  });
  y -= 24;

  // ── Signatures ───────────────────────────────────────────────────────
  room(200);
  if (y < 300) newPage();
  divider();
  text("Signatures", { size: 13, f: bold, color: purple, dy: 20 });

  text("CLIENT", { size: 8.5, f: bold, color: gray, dy: 14 });
  if (fields.signatureDataUrl && /^data:image\/png;base64,/.test(fields.signatureDataUrl)) {
    try {
      const png = await pdf.embedPng(fields.signatureDataUrl);
      const scaled = png.scaleToFit(210, 62);
      page.drawImage(png, { x: MARGIN, y: y - scaled.height + 10, width: scaled.width, height: scaled.height });
      y -= scaled.height + 6;
    } catch {
      // An unreadable signature image must not lose the executed record.
      y -= 10;
    }
  }
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: MARGIN + 240, y },
    thickness: 0.75,
    color: rule,
  });
  y -= 14;
  text(fields.signerName, { size: 10, f: bold, dy: 13 });
  if (fields.signerTitle) text(fields.signerTitle, { size: 9, color: gray, dy: 13 });
  text(fields.businessName, { size: 9, color: gray, dy: 13 });
  text(`Signed electronically on ${today}`, { size: 8.5, color: gray, dy: 24 });

  text("COMPANY", { size: 8.5, f: bold, color: gray, dy: 14 });
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: MARGIN + 240, y },
    thickness: 0.75,
    color: rule,
  });
  y -= 14;
  text(fields.companyRep || "Malik Sannie", { size: 10, f: bold, dy: 13 });
  text(company, { size: 9, color: gray, dy: 13 });
  text(
    fields.countersignedAt
      ? `Countersigned ${new Date(fields.countersignedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`
      : `Countersigned ${today}`,
    { size: 8.5, color: gray, dy: 20 },
  );

  const bytes = await pdf.save();
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
