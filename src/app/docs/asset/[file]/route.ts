// ─── Screenshot delivery, behind the same gate as the guides ───────────────
//
// The screenshots deliberately do NOT live in public/. Anything under public/
// is served as a static file on every host and bypasses the middleware
// entirely, which would leave the images fetchable by anyone who guessed a
// filename — the documentation would be gated and its pictures would not be.
//
// Instead they are read from docs/admin-workspace/screenshots/ by this route,
// which re-runs the admin check on every request.

import { NextResponse } from "next/server";

import { getDocsAccess } from "@/lib/docs/auth";
import { readScreenshotFile } from "@/lib/docs/content";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { file: string } }) {
  const access = await getDocsAccess();
  if (!access.allowed) {
    // 404 rather than 403: an unauthenticated caller learns nothing about
    // which screenshots exist.
    return new NextResponse("Not found", { status: 404 });
  }

  const bytes = readScreenshotFile(params.file);
  if (!bytes) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": "image/png",
      // Private: usable by the reader's browser, never by a shared cache.
      "cache-control": "private, max-age=300",
      "x-robots-tag": "noindex, nofollow, noimageindex",
      "content-disposition": `inline; filename="${params.file}"`,
    },
  });
}
