// Builds the customer's signed One-Time Service Agreement in the browser.
//
// Loads the source agreement PDF (served as a static asset), stamps an
// "Executed by Client" page with the customer's mapped details + signature
// image, and returns the bytes as a base64 string for upload/email.

export interface AgreementFields {
  name: string;
  email: string;
  serviceType?: string;
  serviceDate?: string;
  totalCents?: number;
  depositCents?: number;
  balanceCents?: number;
  signatureDataUrl?: string; // PNG data URL from SignaturePad (customer e-sign)
  verbalNote?: string; // used when agreed over the phone (no signature)
  // Membership variant — recurring / Glow enrollment rather than a one-time
  // clean. Renders a standalone membership acceptance record (no one-time
  // source PDF) with recurring-billing wording.
  variant?: "one-time" | "membership";
  planLabel?: string;
  perCleanCents?: number;
}

const SOURCE_PDF_URL = "/agreements/one-time-service-agreement.pdf";

function money(cents?: number): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

export async function buildSignedAgreementBase64(fields: AgreementFields): Promise<string> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");

  const isMembership = fields.variant === "membership";

  // One-time stamps the executed page onto the source agreement PDF;
  // membership produces a standalone acceptance record.
  const pdf = isMembership
    ? await PDFDocument.create()
    : await PDFDocument.load(
        await fetch(SOURCE_PDF_URL).then((r) => {
          if (!r.ok) throw new Error("Could not load the service agreement document.");
          return r.arrayBuffer();
        }),
      );
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const page = pdf.addPage([612, 792]);
  const purple = rgb(0.486, 0.227, 0.929);
  const dark = rgb(0.12, 0.11, 0.18);
  const gray = rgb(0.42, 0.42, 0.5);
  let y = 740;

  const line = (text: string, opts: { size?: number; f?: typeof font; color?: typeof dark; dy?: number } = {}) => {
    const size = opts.size ?? 11;
    page.drawText(text, { x: 56, y, size, font: opts.f ?? font, color: opts.color ?? dark });
    y -= opts.dy ?? size + 8;
  };

  line(isMembership ? "Membership / Recurring Service Agreement" : "One-Time Service Agreement", {
    size: 18,
    f: bold,
    color: purple,
    dy: 14,
  });
  line("Executed by Client — signed acceptance record", { size: 11, color: gray, dy: 24 });

  const field = (label: string, value: string) => {
    page.drawText(label, { x: 56, y, size: 9, font: bold, color: gray });
    page.drawText(value || "—", { x: 56, y: y - 15, size: 12, font, color: dark });
    y -= 40;
  };

  field("CLIENT NAME", fields.name);
  field("EMAIL", fields.email);
  if (isMembership) {
    field("MEMBERSHIP PLAN", fields.planLabel || fields.serviceType || "Recurring membership");
    field("FIRST SERVICE DATE", fields.serviceDate || "As scheduled");
    field("PRICE PER CLEAN", money(fields.perCleanCents));
    field("DATE SIGNED", new Date().toLocaleString());
    y -= 4;
    line("By signing below, Client enrolls in the recurring membership and agrees to the", { size: 9, color: gray, dy: 12 });
    line("Membership / Recurring Service Agreement, Terms of Service, Disclaimer, and Refund", { size: 9, color: gray, dy: 12 });
    line("Policy, and authorizes recurring charges each billing cycle until the plan is cancelled.", { size: 9, color: gray, dy: 24 });
  } else {
    field("SERVICE", (fields.serviceType || "Cleaning").toString());
    field("SERVICE DATE", fields.serviceDate || "As scheduled at checkout");
    field("TOTAL SERVICE FEE", money(fields.totalCents));
    field("DEPOSIT AMOUNT", money(fields.depositCents));
    field("BALANCE DUE", money(fields.balanceCents));
    field("DATE SIGNED", new Date().toLocaleString());
    y -= 4;
    line("By signing below, Client agrees to the One-Time Service Agreement, Terms of Service,", { size: 9, color: gray, dy: 12 });
    line("Disclaimer, and Refund Policy, and authorizes the deposit + post-service balance charge.", { size: 9, color: gray, dy: 24 });
  }

  page.drawText("Client Acceptance", { x: 56, y, size: 9, font: bold, color: gray });
  y -= 8;
  if (fields.signatureDataUrl) {
    try {
      const png = await pdf.embedPng(fields.signatureDataUrl);
      const scaled = png.scaleToFit(220, 70);
      page.drawImage(png, { x: 56, y: y - scaled.height, width: scaled.width, height: scaled.height });
      y -= scaled.height + 6;
    } catch {
      y -= 40;
    }
  } else {
    page.drawText(fields.verbalNote || "Agreed verbally", { x: 56, y: y - 16, size: 11, font, color: dark });
    y -= 40;
  }
  page.drawLine({ start: { x: 56, y }, end: { x: 320, y }, thickness: 1, color: gray });
  page.drawText(fields.name, { x: 56, y: y - 14, size: 10, font, color: dark });

  const bytes = await pdf.save();
  // Base64-encode without blowing the stack on large buffers.
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
