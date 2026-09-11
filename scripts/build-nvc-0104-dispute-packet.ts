/**
 * Builds the NVC-0104 (Ben) representment PDF from the live public photos
 * plus the agreed merchant findings. Output: artifacts path or --out.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { wrapPacketText } from "../src/lib/dispute-packet";

const POLICY_URLS: Array<{ label: string; url: string }> = [
  { label: "Terms of Service", url: "https://novaracleaning.com/terms" },
  { label: "Refund Policy", url: "https://novaracleaning.com/refund-policy" },
  { label: "Cancellation Policy", url: "https://novaracleaning.com/cancellation-policy" },
  { label: "Disclaimer", url: "https://novaracleaning.com/disclaimer" },
  { label: "Standard Clean checklist", url: "https://try.novaracleaning.com/checklist/standard-clean" },
];

const POLICY_REFS: Array<{ claim: string; cite: string }> = [
  { claim: "Acceptance is binding on booking: clicking agree, submitting a booking, providing payment, or granting property access constitutes acceptance of all policies.", cite: "Terms of Service §1.2, §1.4" },
  { claim: "The customer purchased professional labor performed to a documented checklist standard, not a guaranteed subjective outcome.", cite: "Refund Policy §1.3 · Terms of Service §6.4" },
  { claim: "The primary and default remedy for a legitimate quality concern is a complimentary re-clean of the reported areas — not a refund of the completed visit.", cite: "Terms of Service §7.1, §7.3 · Refund Policy §1.2, §2.1" },
  { claim: "Declining the complimentary re-clean without a documented valid reason (such as relocation) waives further refund eligibility under the Refund Policy.", cite: "Refund Policy §2.5" },
  { claim: "Concerns must be reported in writing within 24 hours of completion, with specific itemized areas. The merchant reviews that report against retained before/after photographs and the service checklist.", cite: "Terms of Service §7.1 · Refund Policy §3.1–3.3" },
  { claim: "Subjective dissatisfaction, buyer's remorse, and services performed to the applicable checklist standard are not refundable. A single missed punch-list item is cured by re-clean, not reversal of the full charge.", cite: "Terms of Service §6.4 · Refund Policy §5.1–5.2, §6" },
  { claim: "The customer consented to timestamped before/after photographs, checklists, and communication logs being retained and used to resolve service concerns.", cite: "Terms of Service §13.1–13.4 · Refund Policy §3.3 · Disclaimer §8.4" },
];

const BOOKING_ID = "6a005147-2b96-4fc4-8d6d-2fce862251b7";
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4ZHJhZXB0enVhbXNnamN2ZmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNzYzMzMsImV4cCI6MjA3NDk1MjMzM30.g7Ipg_qYJiC7uASufDsDqIMtRGPg_dJbSZClJCuAa5I";
const REST = "https://sxdraeptzuamsgjcvfeg.supabase.co/rest/v1";

const REPRESENTMENT = {
  headline:
    "Standard Clean was performed and documented. The customer received the published checklist at confirmation. On review, the only verified miss is kitchen and bathroom trash. A complimentary re-clean of those bins was offered the same day and declined in favor of a refund. A missed trash pull does not reverse the $155.10 visit.",
  findings: [
    {
      ruling: "completed",
      claim: "Living room dusting, surfaces, window sills, furniture vacuum",
      evidence:
        "Before B3 vs after A8: sofa staged, coffee table cleared, floors completed. Wide shots; dusting is a reviewed finding against those frames, not a microscopic close-up.",
    },
    {
      ruling: "completed",
      claim: "Bathroom mirrors",
      evidence: "Powder-room after A2 shows a clear mirror. Hall-bath vanity was cleared (B4 → A3).",
    },
    {
      ruling: "completed",
      claim: "Kitchen appliances, surfaces, stove top",
      evidence:
        "Before B1 vs after A9: island and floor cleared, Target bag removed, room reset. Stove is visible in the kitchen after shot as part of a completed kitchen.",
    },
    {
      ruling: "missed",
      claim: "Kitchen and bathroom trash not removed / bags not replaced",
      evidence:
        "Kitchen black bin is in the same corner in B1 and A9. Hall-bath bin is visible in B4. This is the only verified checklist miss.",
    },
  ],
  remedy:
    "Complimentary targeted re-clean offered by SMS on 10 Sep 2026 at 21:53 UTC (48-hour claim window). Customer had already asked for a refund and did not accept the re-clean. Per Refund Policy §2.1 and §2.5, the re-clean is the primary remedy; declining it waives a refund of the completed visit.",
};

const COMMS: Array<{ at: string; who: string; body: string }> = [
  { at: "2026-09-10T20:50:13Z", who: "NOVARA", body: "Clean complete — before & after photo link sent." },
  { at: "2026-09-10T20:55:09Z", who: "NOVARA", body: "Remaining balance of $77.55 charged to the card on file." },
  { at: "2026-09-10T20:55:51Z", who: "CUSTOMER", body: "Can I get a follow up on this? The cleaning checklist was not followed/incomplete." },
  { at: "2026-09-10T21:03:05Z", who: "NOVARA", body: "Checklist link sent: https://try.novaracleaning.com/checklist/standard-clean" },
  { at: "2026-09-10T21:03:51Z", who: "CUSTOMER", body: "I am aware of the checklist. It was not followed and we are not satisfied." },
  { at: "2026-09-10T21:09:32Z", who: "CUSTOMER", body: "Kitchen fine. Living room: no dusting/sills/furniture vac. Bathrooms: no trash/bags, one mirror. Dusting is the biggest complaint." },
  { at: "2026-09-10T21:10:38Z", who: "CUSTOMER", body: "Sorry, appliances and surfaces in kitchen not fully cleaned (dusty). Stove top also not cleaned well." },
  { at: "2026-09-10T21:17:14Z", who: "NOVARA", body: "Creating a case and scheduling a re-clean for the specific areas after review." },
  { at: "2026-09-10T21:18:34Z", who: "CUSTOMER", body: "We would prefer a refund." },
  { at: "2026-09-10T21:53:36Z", who: "NOVARA", body: "Case opened. 48 hours to claim the re-clean." },
];

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${REST}/${path}`, { headers: { apikey: KEY } });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return await res.json() as T;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`photo ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function main() {
  const rows = await fetchJson<Array<{
    booking_number: number;
    first_name: string;
    email: string;
    address: string;
    city: string;
    state: string;
    zip_code: string;
    service_type: string;
    service_date: string;
    time_slot: string;
    completed_at: string;
    total_estimate_cents: number;
    deposit_cents: number;
    payment_intent_id: string;
    completion_hold_pi_id: string;
    completion_hold_captured_amount: number;
    confirmation_email_sent: boolean;
    before_photos: string[];
    after_photos: string[];
  }>>(`bookings?id=eq.${BOOKING_ID}&select=booking_number,first_name,email,address,city,state,zip_code,service_type,service_date,time_slot,completed_at,total_estimate_cents,deposit_cents,payment_intent_id,completion_hold_pi_id,completion_hold_captured_amount,confirmation_email_sent,before_photos,after_photos`);
  const b = rows[0];
  if (!b) throw new Error("booking not found");

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const violet = rgb(0.33, 0, 1);
  const gray = rgb(0.32, 0.36, 0.42);
  const dark = rgb(0.07, 0.09, 0.15);
  const PAGE_W = 612, PAGE_H = 792, MARGIN = 54;
  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  const ascii = (text: string) =>
    text.replace(/[→–—•’‘“”]/g, (ch) => ({ "→": "->", "–": "-", "—": "-", "•": "-", "’": "'", "‘": "'", "“": '"', "”": '"' }[ch] || "-"))
      .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, "");
  const line = (text: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; gap?: number } = {}) => {
    const size = opts.size ?? 11;
    if (y < MARGIN + size) { page = pdf.addPage([PAGE_W, PAGE_H]); y = PAGE_H - MARGIN; }
    page.drawText(ascii(text).slice(0, 110), { x: MARGIN, y, size, font: opts.bold ? bold : font, color: opts.color ?? dark });
    y -= size + (opts.gap ?? 6);
  };
  const para = (text: string, opts: { size?: number; color?: ReturnType<typeof rgb> } = {}) => {
    for (const c of wrapPacketText(text, 100)) line(c, { size: opts.size ?? 9, color: opts.color ?? gray, gap: 3 });
  };

  line("NOVARA CLEANING", { size: 20, bold: true, color: violet, gap: 2 });
  line("Dispute Packet — Merchant Representment", { size: 13, color: gray, gap: 16 });
  const rowsOut: Array<[string, string]> = [
    ["Booking", `NVC-${String(b.booking_number).padStart(4, "0")}`],
    ["Client", `${b.first_name} <${b.email}>`],
    ["Service", `Standard Clean on ${b.service_date} · ${b.time_slot}`],
    ["Address", `${b.address}, ${b.city}, ${b.state} ${b.zip_code}`],
    ["Completed", b.completed_at],
    ["Photos", `${b.before_photos.length} before · ${b.after_photos.length} after`],
    ["Amount", `$${(b.total_estimate_cents / 100).toFixed(2)} (deposit $${(b.deposit_cents / 100).toFixed(2)} + balance $${((b.completion_hold_captured_amount || 0) / 100).toFixed(2)})`],
    ["Deposit PI", b.payment_intent_id],
    ["Balance PI", b.completion_hold_pi_id],
    ["Checklist email", b.confirmation_email_sent ? "Confirmation email sent (includes checklist link)" : "not recorded"],
    ["Checklist URL", "https://try.novaracleaning.com/checklist/standard-clean"],
    ["Signed agreement", "Pay-page hard gate: PaymentIntent cannot mint until a signed pay_page agreement exists. Deposit captured 2026-09-05 18:52 UTC."],
  ];
  for (const [k, v] of rowsOut) {
    line(`${k}:`, { size: 10, bold: true, color: gray, gap: 2 });
    para(v, { size: 10, color: dark });
    y -= 4;
  }

  y -= 6;
  line("Merchant Representment", { size: 12, bold: true, color: violet, gap: 8 });
  para(REPRESENTMENT.headline, { size: 10, color: dark });
  y -= 4;
  for (const f of REPRESENTMENT.findings) {
    line(`${f.ruling.toUpperCase()} — ${f.claim}`, { size: 9, bold: true, gap: 3 });
    para(f.evidence, { size: 8.5 });
    y -= 2;
  }
  line("Remedy offered", { size: 9, bold: true, gap: 3 });
  para(REPRESENTMENT.remedy, { size: 9 });

  y -= 8;
  line("Customer communication (quality complaint)", { size: 12, bold: true, color: violet, gap: 8 });
  for (const m of COMMS) {
    line(`${m.who} · ${m.at}`, { size: 8, bold: true, gap: 2 });
    para(m.body, { size: 8 });
  }

  y -= 8;
  line("Policies the client agreed to (bank-safe citations)", { size: 12, bold: true, color: violet, gap: 8 });
  for (const ref of POLICY_REFS) {
    para(`• ${ref.claim}`, { size: 8.5 });
    line(`   Source: ${ref.cite}`, { size: 8, bold: true, color: violet, gap: 5 });
  }
  line("Full policy texts:", { size: 10, bold: true, gap: 4 });
  for (const p of POLICY_URLS) line(`   ${p.label}: ${p.url}`, { size: 8, color: gray, gap: 3 });

  const photoPairs: Array<{ label: string; url: string }> = [
    ...b.before_photos.map((url, i) => ({ label: `Before ${i + 1}`, url })),
    ...b.after_photos.map((url, i) => ({ label: `After ${i + 1}`, url })),
  ];
  for (let i = 0; i < photoPairs.length; i += 2) {
    const photoPage = pdf.addPage([PAGE_W, PAGE_H]);
    for (let slot = 0; slot < 2; slot++) {
      const p = photoPairs[i + slot];
      if (!p) break;
      try {
        const bytes = await fetchBytes(p.url);
        const img = await pdf.embedJpg(bytes);
        const maxW = PAGE_W - MARGIN * 2;
        const maxH = (PAGE_H - MARGIN * 2 - 60) / 2;
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);
        const w = img.width * scale, h = img.height * scale;
        const topY = slot === 0 ? PAGE_H - MARGIN : PAGE_H / 2 - 10;
        photoPage.drawText(p.label, { x: MARGIN, y: topY - 12, size: 10, font: bold, color: violet });
        photoPage.drawImage(img, { x: MARGIN, y: topY - 20 - h, width: w, height: h });
      } catch (e) {
        photoPage.drawText(`${p.label} — could not embed`, {
          x: MARGIN, y: slot === 0 ? PAGE_H - MARGIN - 12 : PAGE_H / 2 - 22, size: 9, font, color: gray,
        });
        console.warn(p.label, e);
      }
    }
  }

  const out = process.argv.includes("--out")
    ? process.argv[process.argv.indexOf("--out") + 1]
    : "/opt/cursor/artifacts/NVC-0104-dispute-packet.pdf";
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(await pdf.save()));
  console.log(`wrote ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
