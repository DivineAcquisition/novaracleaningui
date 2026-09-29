// ─── The Day To Day guide's own artwork, at full resolution ───────────────
//
// public/cleaner/guide-pdfs/day-to-day-job-operations.pdf is one page holding
// a single 3000×4296 RGB image (the 3× copy of the onboarding graphic). The
// video frames reuse it — the whole page for the intro, the four figures for
// the stage cards — so the video looks like the handout contractors already
// read. Pulled straight out of the PDF so there is one source for the art.
//
// No image library is needed: the stream is Flate-compressed raw RGB, and a
// PNG is a few chunks of zlib data with CRCs.

import { readFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";
import { PDFDocument, PDFName, PDFNumber, PDFRawStream } from "pdf-lib";

export interface RgbImage {
  width: number;
  height: number;
  /** Packed 8-bit RGB, row-major. */
  data: Buffer;
}

export async function loadGuideImage(pdfPath: string): Promise<RgbImage> {
  const doc = await PDFDocument.load(readFileSync(pdfPath));
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;
    if (dict.get(PDFName.of("Subtype"))?.toString() !== "/Image") continue;
    const filter = dict.get(PDFName.of("Filter"))?.toString();
    const space = dict.get(PDFName.of("ColorSpace"))?.toString();
    if (filter !== "/FlateDecode" || space !== "/DeviceRGB") {
      throw new Error(`Guide image is ${filter} ${space}; expected FlateDecode DeviceRGB`);
    }
    const width = (dict.get(PDFName.of("Width")) as PDFNumber).asNumber();
    const height = (dict.get(PDFName.of("Height")) as PDFNumber).asNumber();
    const data = inflateSync(Buffer.from(obj.contents));
    if (data.length !== width * height * 3) throw new Error("Guide image size does not match its dimensions");
    return { width, height, data };
  }
  throw new Error(`No image found in ${pdfPath}`);
}

/** Copy a rectangle out of an image. */
export function crop(img: RgbImage, x: number, y: number, width: number, height: number): RgbImage {
  const data = Buffer.alloc(width * height * 3);
  for (let row = 0; row < height; row++) {
    const from = ((y + row) * img.width + x) * 3;
    img.data.copy(data, row * width * 3, from, from + width * 3);
  }
  return { width, height, data };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

/** Encode RGB as PNG. Each row uses the "Up" filter, which suits flat art. */
export function encodePng(img: RgbImage): Buffer {
  const stride = img.width * 3;
  const raw = Buffer.alloc((stride + 1) * img.height);
  for (let y = 0; y < img.height; y++) {
    const out = y * (stride + 1);
    raw[out] = 2;
    for (let i = 0; i < stride; i++) {
      const cur = img.data[y * stride + i];
      const up = y > 0 ? img.data[(y - 1) * stride + i] : 0;
      raw[out + 1 + i] = (cur - up) & 0xff;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(img.width, 0);
  header.writeUInt32BE(img.height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolor RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Hex colour of one pixel — used to keep frame colours on the guide's palette. */
export function pixelHex(img: RgbImage, x: number, y: number): string {
  const i = (y * img.width + x) * 3;
  return `#${[img.data[i], img.data[i + 1], img.data[i + 2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
