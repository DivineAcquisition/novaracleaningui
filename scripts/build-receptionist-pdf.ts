// Printable receptionist knowledge, generated from src/lib/receptionist-knowledge.ts.
//
// Run: npm run receptionist:pdf
// Writes the same PDF to docs/ai-receptionist and public/receptionist.

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { RECEPTIONIST_KNOWLEDGE as K } from "../src/lib/receptionist-knowledge";

const PAGE = { w: 612, h: 792 };
const MARGIN = 54;
const BODY = 10;
const LINE = 13.5;
const INK = rgb(0.09, 0.11, 0.15);
const MUTED = rgb(0.38, 0.4, 0.45);
const PURPLE = rgb(0.486, 0.416, 0.969);
const HAIRLINE = rgb(0.86, 0.87, 0.9);

type Ctx = { doc: PDFDocument; page: PDFPage; y: number; regular: PDFFont; bold: PDFFont; pageNo: number };

function plain(value: string): string {
  return value
    .replace(/\u2013|\u2014/g, "-")
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201c|\u201d/g, '"')
    .replace(/\u00d7/g, "x")
    .replace(/\u2022/g, "-")
    .replace(/\u00a0/g, " ");
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = plain(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function footer(ctx: Ctx) {
  ctx.page.drawLine({
    start: { x: MARGIN, y: 40 },
    end: { x: PAGE.w - MARGIN, y: 40 },
    thickness: 0.6,
    color: HAIRLINE,
  });
  ctx.page.drawText("NovaraCleaning LLC  |  Receptionist knowledge  |  " + K.version, {
    x: MARGIN,
    y: 26,
    size: 8,
    font: ctx.regular,
    color: MUTED,
  });
  const label = String(ctx.pageNo);
  ctx.page.drawText(label, {
    x: PAGE.w - MARGIN - ctx.regular.widthOfTextAtSize(label, 8),
    y: 26,
    size: 8,
    font: ctx.regular,
    color: MUTED,
  });
}

function newPage(ctx: Ctx) {
  footer(ctx);
  ctx.page = ctx.doc.addPage([PAGE.w, PAGE.h]);
  ctx.pageNo += 1;
  ctx.y = PAGE.h - MARGIN;
}

function ensure(ctx: Ctx, needed: number) {
  if (ctx.y - needed < 64) newPage(ctx);
}

function h1(ctx: Ctx, title: string) {
  ensure(ctx, 36);
  ctx.page.drawText(plain(title), { x: MARGIN, y: ctx.y, size: 16, font: ctx.bold, color: PURPLE });
  ctx.y -= 8;
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y },
    end: { x: PAGE.w - MARGIN, y: ctx.y },
    thickness: 1,
    color: PURPLE,
  });
  ctx.y -= 18;
}

function h2(ctx: Ctx, title: string) {
  ensure(ctx, 28);
  ctx.y -= 6;
  ctx.page.drawText(plain(title), { x: MARGIN, y: ctx.y, size: 12, font: ctx.bold, color: INK });
  ctx.y -= 16;
}

function para(ctx: Ctx, text: string, opts?: { size?: number; color?: typeof INK; indent?: number }) {
  const size = opts?.size ?? BODY;
  const indent = opts?.indent ?? 0;
  const color = opts?.color ?? INK;
  const width = PAGE.w - MARGIN * 2 - indent;
  for (const line of wrap(text, ctx.regular, size, width)) {
    ensure(ctx, LINE);
    ctx.page.drawText(line, { x: MARGIN + indent, y: ctx.y, size, font: ctx.regular, color });
    ctx.y -= LINE;
  }
}

function bullet(ctx: Ctx, text: string) {
  const width = PAGE.w - MARGIN * 2 - 14;
  const lines = wrap(text, ctx.regular, BODY, width);
  ensure(ctx, lines.length * LINE);
  ctx.page.drawText("-", { x: MARGIN, y: ctx.y, size: BODY, font: ctx.bold, color: PURPLE });
  lines.forEach((line, i) => {
    ctx.page.drawText(line, { x: MARGIN + 14, y: ctx.y - i * LINE, size: BODY, font: ctx.regular, color: INK });
  });
  ctx.y -= lines.length * LINE;
}

function labelLine(ctx: Ctx, label: string, value: string) {
  ensure(ctx, LINE);
  const left = plain(label);
  ctx.page.drawText(left, { x: MARGIN, y: ctx.y, size: BODY, font: ctx.bold, color: INK });
  const x = MARGIN + ctx.bold.widthOfTextAtSize(left, BODY) + 6;
  const rest = wrap(value, ctx.regular, BODY, PAGE.w - MARGIN - x);
  rest.forEach((line, i) => {
    if (i > 0) ensure(ctx, LINE);
    ctx.page.drawText(line, { x: i === 0 ? x : MARGIN + 14, y: ctx.y, size: BODY, font: ctx.regular, color: INK });
    ctx.y -= LINE;
  });
}

function money(n: number | null): string {
  if (n == null) return "-";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

async function build() {
  const doc = await PDFDocument.create();
  doc.setTitle("NovaraCleaning receptionist knowledge");
  doc.setAuthor("Novara Cleaning LLC");
  doc.setSubject("Menus, prices, FAQs, and the sales-call script for the AI receptionist.");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ctx: Ctx = {
    doc,
    page: doc.addPage([PAGE.w, PAGE.h]),
    y: PAGE.h - MARGIN,
    regular,
    bold,
    pageNo: 1,
  };

  ctx.page.drawRectangle({ x: 0, y: PAGE.h - 8, width: PAGE.w, height: 8, color: PURPLE });
  ctx.page.drawText("NOVARACLEANING LLC", { x: MARGIN, y: ctx.y, size: 11, font: bold, color: PURPLE });
  ctx.y -= 42;
  ctx.page.drawText("Receptionist", { x: MARGIN, y: ctx.y, size: 32, font: bold, color: INK });
  ctx.y -= 36;
  ctx.page.drawText("knowledge", { x: MARGIN, y: ctx.y, size: 32, font: bold, color: INK });
  ctx.y -= 28;
  para(ctx, "Menus, price lists, policies, and the sales-call script for the AI receptionist and the outbound dialer. Quote only what is in this document. If a number is not here, do not invent it.");
  ctx.y -= 8;
  labelLine(ctx, "Version", K.version);
  labelLine(ctx, "JSON", K.pullUrl);
  labelLine(ctx, "This PDF", K.pdfUrl);
  ctx.y -= 8;
  para(ctx, K.transcripts.reason, { color: MUTED });

  h1(ctx, "Who we are");
  labelLine(ctx, "Legal name", K.business.legalName);
  labelLine(ctx, "Brand", K.business.brandName);
  labelLine(ctx, "Phone", K.business.phone);
  labelLine(ctx, "Address", K.business.mailingAddress);
  labelLine(ctx, "Bookings", K.business.emails.bookingsAndAccount);
  labelLine(ctx, "Billing", K.business.emails.billing);
  labelLine(ctx, "Refunds", K.business.emails.refunds);
  ctx.y -= 6;
  para(ctx, K.business.serviceArea);
  ctx.y -= 4;
  para(ctx, "Arrival windows: " + K.business.arrivalWindows.join("  ·  "));
  h2(ctx, "You may say");
  for (const line of K.business.claimsYouMayMake) bullet(ctx, line);
  h2(ctx, "You must not say");
  for (const line of K.business.claimsYouMustNotMake) bullet(ctx, line);

  h1(ctx, "Menus");
  for (const item of K.menus.residential) {
    h2(ctx, item.name);
    if ("useWhen" in item && item.useWhen) para(ctx, item.useWhen);
    if ("note" in item && item.note) para(ctx, item.note);
    if ("included" in item && item.included) {
      para(ctx, "Included", { size: 10 });
      for (const line of item.included) bullet(ctx, line);
    }
    if ("notIncluded" in item && item.notIncluded) {
      para(ctx, "Not included unless added", { size: 10 });
      for (const line of item.notIncluded) bullet(ctx, line);
    }
    if ("areas" in item && item.areas) {
      for (const area of item.areas) {
        bullet(ctx, `${area.name}: $${area.priceUsd}${area.note ? ` (${area.note})` : ""}`);
      }
      bullet(ctx, `Minimum $${item.minimumUsd}`);
    }
  }
  h2(ctx, K.menus.membership.name);
  for (const plan of K.menus.membership.plans) bullet(ctx, `${plan.id}: ${plan.visits}`);
  para(ctx, K.menus.membership.say);
  para(ctx, K.menus.membership.doNotSay, { color: MUTED });
  h2(ctx, "Commercial");
  para(ctx, K.menus.commercial.say);
  h2(ctx, "Short-term rental");
  para(ctx, K.menus.shortTermRental.say);

  h1(ctx, "How to build a price");
  for (const step of K.prices.howToQuote) bullet(ctx, step);
  h2(ctx, "Condition");
  for (const row of K.prices.condition) bullet(ctx, `${row.id}: ${row.meaning}. Multiply by ${row.multiplier}.`);
  h2(ctx, "Zone");
  for (const zone of K.prices.zones) bullet(ctx, `Zone ${zone.id} x${zone.multiplier}. ${zone.where}`);

  h2(ctx, "Zone B base rates, before condition");
  para(ctx, "Combo, before condition and zone, is the standard base plus the deep base.", { color: MUTED });
  ctx.y -= 4;
  const headers = ["Home size", "Hrs", "Crew", "Standard", "Deep", "Move"];
  const cols = [150, 36, 40, 70, 62, 70];
  ensure(ctx, 20);
  let x = MARGIN;
  headers.forEach((header, i) => {
    ctx.page.drawText(header, { x, y: ctx.y, size: 8, font: bold, color: MUTED });
    x += cols[i];
  });
  ctx.y -= 12;
  for (const row of K.prices.zoneBBaseUsd) {
    ensure(ctx, 14);
    const cells = [row.band, String(row.hours), String(row.crew), money(row.standard), money(row.deep), money(row.moveInOut)];
    let cx = MARGIN;
    cells.forEach((cell, i) => {
      ctx.page.drawText(plain(cell), { x: cx, y: ctx.y, size: 9, font: regular, color: INK });
      cx += cols[i];
    });
    ctx.y -= 13;
  }
  ctx.y -= 8;
  h2(ctx, "Worked example");
  para(ctx, K.prices.workedExample.home);
  for (const step of K.prices.workedExample.steps) bullet(ctx, step);
  para(ctx, `Customer pays $${K.prices.workedExample.customerPaysUsd.toFixed(2)}. Deposit $${K.prices.workedExample.depositUsd.toFixed(2)}. Balance after the clean $${K.prices.workedExample.balanceAfterUsd.toFixed(2)}.`);

  h2(ctx, "Add-ons (flat, never multiplied)");
  for (const addOn of K.prices.addOnsUsd) {
    bullet(ctx, `${addOn.name}: $${addOn.price}${addOn.note ? `. ${addOn.note}` : ""}`);
  }
  para(ctx, `Same-day fee: $${K.prices.sameDayFeeUsd}. ${K.prices.sameDayCutoff}`);
  para(ctx, K.prices.deposit);

  h2(ctx, "Glow membership, Zone B");
  para(ctx, K.prices.membershipNote, { color: MUTED, size: 9 });
  ctx.y -= 4;
  ensure(ctx, 18);
  const mCols = [170, 80, 80, 80];
  const mHeads = ["Home size", "Monthly", "Biweekly", "Weekly"];
  let mx = MARGIN;
  mHeads.forEach((header, i) => {
    ctx.page.drawText(header, { x: mx, y: ctx.y, size: 8, font: bold, color: MUTED });
    mx += mCols[i];
  });
  ctx.y -= 12;
  for (const row of K.prices.membershipMonthlyUsdZoneB) {
    ensure(ctx, 14);
    const cells = [row.band, money(row.monthly), money(row.biweekly), money(row.weekly)];
    let cx = MARGIN;
    cells.forEach((cell, i) => {
      ctx.page.drawText(cell, { x: cx, y: ctx.y, size: 9, font: regular, color: INK });
      cx += mCols[i];
    });
    ctx.y -= 13;
  }

  h1(ctx, "Policies");
  para(ctx, K.policies.reclean);
  ctx.y -= 4;
  para(ctx, K.policies.residentialCancel);
  ctx.y -= 4;
  para(ctx, K.policies.residentialReschedule);
  ctx.y -= 4;
  para(ctx, K.policies.hostCancel);
  ctx.y -= 4;
  para(ctx, K.policies.payment);
  ctx.y -= 4;
  para(ctx, K.policies.access);
  ctx.y -= 4;
  para(ctx, `A saved quote holds for ${K.policies.quotesLockHours} hours.`);

  h1(ctx, "FAQs");
  for (const item of K.faqs) {
    h2(ctx, item.q);
    para(ctx, item.a);
  }

  h1(ctx, "How a sales call should go");
  para(ctx, K.callFlow.source, { color: MUTED, size: 9 });
  ctx.y -= 4;
  para(ctx, K.callFlow.goal);
  for (const step of K.callFlow.steps) {
    h2(ctx, `${step.step}. ${step.name}`);
    if ("say" in step && step.say) para(ctx, step.say);
    if ("collect" in step && step.collect) {
      for (const field of step.collect) bullet(ctx, field);
    }
    if ("alternate" in step && step.alternate) para(ctx, step.alternate);
  }
  h2(ctx, "Objections");
  for (const item of K.callFlow.objections) {
    h2(ctx, item.theySay);
    para(ctx, item.say);
    if (item.doNotSay) para(ctx, item.doNotSay, { color: MUTED });
  }
  h2(ctx, "On the phone");
  for (const line of K.callFlow.phoneHabits) bullet(ctx, line);
  h2(ctx, "Hand the call to a person");
  for (const line of K.callFlow.transfer) bullet(ctx, line);

  h1(ctx, "Transcripts");
  para(ctx, K.transcripts.reason);
  ctx.y -= 4;
  para(ctx, K.transcripts.useInstead);

  footer(ctx);
  const bytes = await doc.save();
  const targets = [
    "docs/ai-receptionist/NovaraCleaning_Receptionist_Knowledge.pdf",
    "public/receptionist/NovaraCleaning_Receptionist_Knowledge.pdf",
  ];
  for (const target of targets) {
    const out = resolve(process.cwd(), target);
    mkdirSync(resolve(out, ".."), { recursive: true });
    writeFileSync(out, bytes);
    console.log(`Wrote ${out}`);
  }
  console.log(`${doc.getPageCount()} pages, ${(bytes.length / 1024).toFixed(0)} KB`);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
