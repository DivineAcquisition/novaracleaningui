// Knowledge-base PDFs. One topic per file so an AI retrieval system can
// pull the right document. Generated from src/lib/receptionist-knowledge.ts.
//
// Run: npm run receptionist:pdf

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { RECEPTIONIST_KNOWLEDGE as K } from "../src/lib/receptionist-knowledge";

const PAGE = { w: 612, h: 792 };
const MARGIN = 54;
const BODY = 10.5;
const LINE = 14;
const INK = rgb(0.09, 0.11, 0.15);
const MUTED = rgb(0.38, 0.4, 0.45);
const PURPLE = rgb(0.486, 0.416, 0.969);
const HAIRLINE = rgb(0.86, 0.87, 0.9);

type Ctx = { doc: PDFDocument; page: PDFPage; y: number; regular: PDFFont; bold: PDFFont; pageNo: number; title: string };

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
    } else line = next;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function footer(ctx: Ctx) {
  ctx.page.drawLine({ start: { x: MARGIN, y: 40 }, end: { x: PAGE.w - MARGIN, y: 40 }, thickness: 0.6, color: HAIRLINE });
  ctx.page.drawText(plain(`NovaraCleaning LLC  |  ${ctx.title}`), { x: MARGIN, y: 26, size: 8, font: ctx.regular, color: MUTED });
  const n = String(ctx.pageNo);
  ctx.page.drawText(n, { x: PAGE.w - MARGIN - ctx.regular.widthOfTextAtSize(n, 8), y: 26, size: 8, font: ctx.regular, color: MUTED });
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
  ensure(ctx, 34);
  ctx.y -= 4;
  ctx.page.drawText(plain(title), { x: MARGIN, y: ctx.y, size: 15, font: ctx.bold, color: PURPLE });
  ctx.y -= 8;
  ctx.page.drawLine({ start: { x: MARGIN, y: ctx.y }, end: { x: PAGE.w - MARGIN, y: ctx.y }, thickness: 1, color: PURPLE });
  ctx.y -= 18;
}

function h2(ctx: Ctx, title: string) {
  ensure(ctx, 26);
  ctx.y -= 4;
  ctx.page.drawText(plain(title), { x: MARGIN, y: ctx.y, size: 12, font: ctx.bold, color: INK });
  ctx.y -= 16;
}

function para(ctx: Ctx, text: string, color = INK) {
  for (const line of wrap(text, ctx.regular, BODY, PAGE.w - MARGIN * 2)) {
    ensure(ctx, LINE);
    ctx.page.drawText(line, { x: MARGIN, y: ctx.y, size: BODY, font: ctx.regular, color });
    ctx.y -= LINE;
  }
  ctx.y -= 3;
}

function bullet(ctx: Ctx, text: string) {
  const lines = wrap(text, ctx.regular, BODY, PAGE.w - MARGIN * 2 - 16);
  ensure(ctx, lines.length * LINE);
  ctx.page.drawText("-", { x: MARGIN, y: ctx.y, size: BODY, font: ctx.bold, color: PURPLE });
  lines.forEach((line, i) => {
    ctx.page.drawText(line, { x: MARGIN + 14, y: ctx.y - i * LINE, size: BODY, font: ctx.regular, color: INK });
  });
  ctx.y -= lines.length * LINE;
}

function money(n: number | null): string {
  if (n == null) return "-";
  return `$${n.toLocaleString("en-US")}`;
}

async function open(title: string, blurb: string): Promise<Ctx> {
  const doc = await PDFDocument.create();
  doc.setTitle(`NovaraCleaning ${title}`);
  doc.setAuthor("Novara Cleaning LLC");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ctx: Ctx = { doc, page: doc.addPage([PAGE.w, PAGE.h]), y: PAGE.h - MARGIN, regular, bold, pageNo: 1, title };
  ctx.page.drawRectangle({ x: 0, y: PAGE.h - 8, width: PAGE.w, height: 8, color: PURPLE });
  ctx.page.drawText("NOVARACLEANING LLC", { x: MARGIN, y: ctx.y, size: 10, font: bold, color: PURPLE });
  ctx.y -= 28;
  ctx.page.drawText(plain(title), { x: MARGIN, y: ctx.y, size: 22, font: bold, color: INK });
  ctx.y -= 22;
  para(ctx, blurb, MUTED);
  para(ctx, `${K.business.legalName}. Phone ${K.business.phone}. Bookings ${K.business.emails.bookingsAndAccount}. Speak a dollar amount only after a live price function returns it.`, MUTED);
  return ctx;
}

async function save(ctx: Ctx, filename: string) {
  footer(ctx);
  const bytes = await ctx.doc.save();
  for (const dir of ["docs/ai-receptionist/knowledge-base", "public/receptionist/knowledge-base"]) {
    const out = resolve(process.cwd(), dir, filename);
    mkdirSync(resolve(out, ".."), { recursive: true });
    writeFileSync(out, bytes);
  }
  console.log(`${filename}: ${ctx.doc.getPageCount()} pages`);
}

async function identity() {
  const ctx = await open("01 Identity", "Who Novara is, what the receptionist may claim, and when to stop and hand the call to a person.");
  h1(ctx, "Business");
  bullet(ctx, `Legal name: ${K.business.legalName}`);
  bullet(ctx, `Brand: ${K.business.brandName}`);
  bullet(ctx, `Phone: ${K.business.phone}`);
  bullet(ctx, `Mailing address: ${K.business.mailingAddress}`);
  bullet(ctx, `Bookings and account: ${K.business.emails.bookingsAndAccount}`);
  bullet(ctx, `Billing: ${K.business.emails.billing}`);
  bullet(ctx, `Refunds: ${K.business.emails.refunds}`);
  bullet(ctx, `Book online: ${K.business.websites.book}`);
  bullet(ctx, `Account: ${K.business.websites.account}`);
  para(ctx, K.business.serviceArea);
  para(ctx, "Arrival windows on the website: " + K.business.arrivalWindows.join(", ") + ".");
  h1(ctx, "You may say");
  for (const line of K.business.claimsYouMayMake) bullet(ctx, line);
  h1(ctx, "You must not say");
  for (const line of K.business.claimsYouMustNotMake) bullet(ctx, line);
  h1(ctx, "Hand the call to a person");
  for (const line of K.callFlow.transfer) bullet(ctx, line);
  await save(ctx, "01-identity.pdf");
}

async function menus() {
  const ctx = await open("02 Service menus", "What each service includes. Use this to recommend a service. Do not invent a task that is not listed.");
  for (const item of K.menus.residential) {
    h1(ctx, item.name);
    if ("useWhen" in item && item.useWhen) para(ctx, item.useWhen);
    if ("note" in item && item.note) para(ctx, item.note);
    if ("included" in item && item.included) {
      h2(ctx, "Included");
      for (const line of item.included) bullet(ctx, line);
    }
    if ("notIncluded" in item && item.notIncluded) {
      h2(ctx, "Not included unless added");
      for (const line of item.notIncluded) bullet(ctx, line);
    }
    if ("areas" in item && item.areas) {
      for (const area of item.areas) bullet(ctx, `${area.name}: $${area.priceUsd}${area.note ? ` (${area.note})` : ""}`);
      bullet(ctx, `Minimum $${item.minimumUsd}`);
    }
  }
  h1(ctx, K.menus.membership.name);
  for (const plan of K.menus.membership.plans) bullet(ctx, `${plan.id}: ${plan.visits}`);
  para(ctx, K.menus.membership.say);
  para(ctx, K.menus.membership.doNotSay);
  h1(ctx, "Commercial");
  para(ctx, K.menus.commercial.name + ". " + K.menus.commercial.say);
  h1(ctx, "Short-term rental");
  para(ctx, K.menus.shortTermRental.name + ". " + K.menus.shortTermRental.say);
  await save(ctx, "02-menus.pdf");
}

async function prices() {
  const ctx = await open("03 Price list", "How a residential price is built. The booking screen is the price the customer pays. If a live function returns a different total, do not quote. Hand it to a person.");
  h1(ctx, "Steps, in this order");
  for (const step of K.prices.howToQuote) bullet(ctx, step);
  h1(ctx, "Condition");
  for (const row of K.prices.condition) bullet(ctx, `${row.id}: ${row.meaning}. Multiply by ${row.multiplier}.`);
  h1(ctx, "Zone, chosen by ZIP");
  for (const zone of K.prices.zones) bullet(ctx, `Zone ${zone.id} x${zone.multiplier}. ${zone.where}`);
  h1(ctx, "Zone B base, before condition");
  para(ctx, K.prices.comboNote);
  for (const row of K.prices.zoneBBaseUsd) {
    bullet(ctx, `${row.band}: ${row.hours} hrs, crew ${row.crew}. Standard ${money(row.standard)}. Deep ${money(row.deep)}. Move-in/out ${money(row.moveInOut)}.`);
  }
  h1(ctx, "Worked example");
  para(ctx, K.prices.workedExample.home);
  for (const step of K.prices.workedExample.steps) bullet(ctx, step);
  para(ctx, `Customer pays $${K.prices.workedExample.customerPaysUsd.toFixed(2)}. Deposit $${K.prices.workedExample.depositUsd.toFixed(2)}. Balance $${K.prices.workedExample.balanceAfterUsd.toFixed(2)}.`);
  h1(ctx, "Add-ons, added last and never multiplied");
  for (const addOn of K.prices.addOnsUsd) bullet(ctx, `${addOn.name}: $${addOn.price}${addOn.note ? `. ${addOn.note}` : ""}`);
  para(ctx, `Same-day fee $${K.prices.sameDayFeeUsd}. ${K.prices.sameDayCutoff}`);
  para(ctx, K.prices.deposit);
  h1(ctx, "Glow membership, Zone B");
  para(ctx, K.prices.membershipNote);
  for (const row of K.prices.membershipMonthlyUsdZoneB) {
    bullet(ctx, `${row.band}: monthly ${money(row.monthly)}, biweekly ${money(row.biweekly)}, weekly ${money(row.weekly)}.`);
  }
  h1(ctx, "Hesitant-buyer courtesy");
  para(ctx, `Only after the real price is said, and only when that service total is over $${K.sales.hesitationOffer.serviceMustBeOverUsd}. Offer $${K.sales.hesitationOffer.firstOfferUsd} first. If they are still hesitating, $${K.sales.hesitationOffer.ifStillHesitantUsd}. Never more. The live booking function does not save this courtesy yet, so do not promise it until the payment link shows the reduced total.`);
  await save(ctx, "03-prices.pdf");
}

async function policies() {
  const ctx = await open("04 Policies", "Cancellation, reschedule, re-clean, deposit, and what not to collect on a sales call.");
  h1(ctx, "Re-clean");
  para(ctx, K.policies.reclean);
  h1(ctx, "Residential cancel");
  para(ctx, K.policies.residentialCancel);
  h1(ctx, "Residential reschedule");
  para(ctx, K.policies.residentialReschedule);
  h1(ctx, "Host and short-term rental cancel");
  para(ctx, K.policies.hostCancel);
  h1(ctx, "Payment");
  para(ctx, K.policies.payment);
  para(ctx, K.prices.deposit);
  para(ctx, `A saved quote holds for ${K.policies.quotesLockHours} hours. After that, re-quote before booking.`);
  h1(ctx, "Access");
  para(ctx, K.policies.access);
  await save(ctx, "04-policies.pdf");
}

async function faqs() {
  const ctx = await open("05 FAQs", "Answers the receptionist may give. If the question is not here, do not guess. Hand it to a person.");
  for (const item of K.faqs) {
    h2(ctx, item.q);
    para(ctx, item.a);
  }
  await save(ctx, "05-faqs.pdf");
}

async function sales() {
  const ctx = await open("06 Sales call", "How to run the call, when to offer $10 then $15, and which details to capture before anything is sent.");
  para(ctx, K.sales.job);
  h1(ctx, "Capture before you price");
  para(ctx, "A quote cannot be saved without: " + K.sales.capture.saveWillNotWorkWithout.join(", ") + ".");
  h2(ctx, "Also capture before you send a booking");
  for (const field of K.sales.capture.sendTheBookingWith) bullet(ctx, field);
  h1(ctx, "Say the real price first");
  para(ctx, "Do not open with a discount. Read the total, the half deposit, and the balance.");
  h1(ctx, "$10, then $15");
  para(ctx, K.sales.hesitationOffer.when);
  for (const rule of K.sales.hesitationOffer.rules) bullet(ctx, rule);
  para(ctx, K.sales.hesitationOffer.sayTen);
  para(ctx, K.sales.hesitationOffer.sayFifteen);
  para(ctx, "Example. $298.75 is over $175. $10 off is $288.75. If they are still unsure, $15 off is $283.75. Stop there. Do not say either number until the payment link shows it.");
  h1(ctx, "If they book");
  for (const step of K.sales.ifTheyProceed) bullet(ctx, step);
  h1(ctx, "If they do not book today");
  para(ctx, K.sales.ifTheyDoNotProceed);
  para(ctx, K.sales.readBack);
  h1(ctx, "Objections");
  for (const item of K.callFlow.objections) {
    h2(ctx, item.theySay);
    para(ctx, item.say);
    if (item.doNotSay) para(ctx, item.doNotSay, MUTED);
  }
  await save(ctx, "06-sales-call.pdf");
}

async function booking() {
  const ctx = await open("07 How a booking is finished", "What the customer does after they say yes, and what the system does. Sending a link is not a booked visit.");
  h1(ctx, "On the website");
  bullet(ctx, "Page 1: ZIP at try.novaracleaning.com/book/zip. Out of area stops here. Offer the waitlist.");
  bullet(ctx, "Page 2: home size, service, and add-ons. The price on this page is the price.");
  bullet(ctx, "Page 3: date and an arrival window, 8-12, 12-4, or 4-8.");
  bullet(ctx, "Page 4: checkout. They pay the 50% deposit on Stripe, on our site.");
  bullet(ctx, "Page 5: home details. Beds, baths, pets, access, and the agreements. The visit is not fully set until this page is finished.");
  bullet(ctx, "Then the confirmation email: booking number, date, arrival window, service, address, total, deposit, and balance.");
  h1(ctx, "On a phone or text, through the live functions");
  for (const line of K.liveTools.bookedMeans) bullet(ctx, line);
  h1(ctx, "What to tell them");
  para(ctx, "I am sending a link. Open it, confirm the service and the window, and pay half. Then finish the short details page. When the deposit clears, the confirmation email has the booking number and the balance due after the clean.");
  h1(ctx, "What not to tell them");
  bullet(ctx, "Do not say the visit is confirmed when you have only sent the link.");
  bullet(ctx, "Do not ask for a card number, a gate code, or an alarm code.");
  bullet(ctx, "Do not send a summary at a price the payment link does not show.");
  await save(ctx, "07-booking-flow.pdf");
}

async function tools() {
  const ctx = await open("08 Live functions", "The only actions the receptionist may execute. Call them in order. Speak the return value, not a number you worked out yourself.");
  para(ctx, "Endpoint: " + K.liveTools.endpoint);
  para(ctx, K.liveTools.rule);
  h1(ctx, "Call in this order");
  for (const step of K.liveTools.order) bullet(ctx, step);
  for (const tool of K.liveTools.tools) {
    h1(ctx, tool.name);
    para(ctx, "Pass: " + tool.pass);
    para(ctx, "Returns: " + tool.returns);
    para(ctx, tool.say);
  }
  h1(ctx, "What booked means");
  for (const line of K.liveTools.bookedMeans) bullet(ctx, line);
  h1(ctx, "What these functions cannot do yet");
  for (const line of K.liveTools.cannotDoYet) bullet(ctx, line);
  await save(ctx, "08-live-functions.pdf");
}

async function index() {
  const ctx = await open("00 Upload these", "Upload every PDF in this set into the receptionist knowledge base. Each file is one topic.");
  const files = [
    ["01-identity.pdf", "Name, phone, emails, claims you may make, and when to hand off."],
    ["02-menus.pdf", "Standard, Deep, combo, move-in/out, focused, Glow, commercial, and turnovers."],
    ["03-prices.pdf", "Condition, zone, base rates, add-ons, membership, and the $10 / $15 rule."],
    ["04-policies.pdf", "Re-clean, cancel, reschedule, deposit, and access."],
    ["05-faqs.pdf", "The answers. If it is not in this file, do not guess."],
    ["06-sales-call.pdf", "The call, the courtesy, the fields to capture, and the objections."],
    ["07-booking-flow.pdf", "The website pages and what happens after they say yes."],
    ["08-live-functions.pdf", "The eight functions, the required fields, and what they cannot do yet."],
  ];
  for (const [file, about] of files) {
    h2(ctx, file);
    para(ctx, about);
  }
  para(ctx, "JSON for a system that can call a URL: " + K.pullUrl);
  await save(ctx, "00-index.pdf");
}

async function main() {
  await index();
  await identity();
  await menus();
  await prices();
  await policies();
  await faqs();
  await sales();
  await booking();
  await tools();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
