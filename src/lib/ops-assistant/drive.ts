// ─── On-demand Drive / file retrieval ─────────────────────────────────────
//
// Search the Drive URLs (and signed-agreement storage paths) this system
// already stores. No new Drive connection. Retrieval, not ingestion-as-
// training: we look up on demand and return the actual link.
//
// Permission boundary matches the workspace, not raw RLS:
//   job_documentation (QC photos / dispute PDF) — admin and VA
//   service_agreements (residential signed PDF) — admin and VA (QC case file)
//   commercial_walkthroughs (proposal walkthrough PDF / Drive folder) — admin and VA (Proposals tab)
//   weekly_reports.drive_url — admin only (Weekly Report is admin_strict)
//   va_eod_submissions.drive_url — admin only (VA Performance is admin_strict)
//   commercial_agreements / COI documents — admin only (Commercial is admin_strict)
//
// Never describe image contents. If we cannot confirm what's in a file, say so
// and link it.

import type { AssistantRole, NextAction, PageContext } from "./types";

type SB = { from: (t: string) => any; storage: { from: (b: string) => any } };

export interface DriveHit {
  title: string;
  url: string;
  kind: "folder" | "pdf" | "photos";
  source: string;
  /** True only when we have a structured field that names the artifact. Never inferred from pixels. */
  contentsConfirmed: boolean;
  contentsNote: string;
}

export function wantsDriveLookup(message: string): boolean {
  return /\b(photos?|before\/after|before and after|drive (folder|link|file)|signed agreement|service agreement|walkthrough (pdf|folder|photos)|eod (pdf|report)|weekly report pdf|dispute packet|coi (doc|certificate|pdf)|certificate of insurance|pull up the|show me the (before|after|photos|pdf|agreement|folder))\b/i.test(
    message || "",
  );
}

function tokensFrom(message: string): string[] {
  const quoted = [...(message || "").matchAll(/"([^"]{2,80})"/g)].map((m) => m[1].trim());
  const cleaned = (message || "")
    .replace(/[“”]/g, '"')
    .replace(
      /\b(show me|pull up|find|open|the|a|an|photos?|from|for|job|signed|agreement|pdf|walkthrough|before|after|drive|folder|last|this|that|our|please)\b/gi,
      " ",
    )
    .replace(/[?!.,]/g, " ");
  const rest = cleaned
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
  return [...quoted, ...rest].slice(0, 8);
}

function ilikeContains(term: string): string {
  return `%${term.replace(/[%_,]/g, "")}%`;
}

async function signedStorageUrl(sb: SB, bucket: string, path: string | null): Promise<string | null> {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  try {
    const { data } = await sb.storage.from(bucket).createSignedUrl(path, 3600);
    return data?.signedUrl || null;
  } catch {
    return null;
  }
}

function asHit(args: Omit<DriveHit, "contentsNote"> & { contentsNote?: string }): DriveHit {
  return {
    ...args,
    contentsNote:
      args.contentsNote ||
      (args.contentsConfirmed
        ? `Stored ${args.kind} from ${args.source}.`
        : "I can't confirm what's inside this file from here — open the link rather than taking my word for the contents."),
  };
}

export async function searchDriveFiles(args: {
  supabase: SB | null;
  role: AssistantRole;
  message: string;
  page?: PageContext | null;
}): Promise<DriveHit[]> {
  if (!args.supabase) return [];
  const sb = args.supabase;
  const terms = tokensFrom(args.message);
  const bookingId = args.page?.record?.kind === "booking" ? args.page.record.id : null;
  const accountId = args.page?.record?.kind === "account" ? args.page.record.id : null;
  const hits: DriveHit[] = [];
  const wantAgreement = /\bagreement|signed\b/i.test(args.message);
  const wantWalkthrough = /\bwalkthrough\b/i.test(args.message);
  const wantEod = /\beod\b/i.test(args.message);
  const wantWeekly = /\bweekly report\b/i.test(args.message);
  const wantCoi = /\bcoi\b|certificate of insurance/i.test(args.message);
  const wantPhotos = /\bphotos?|before|after|dispute packet|job doc/i.test(args.message);

  try {
    if (wantPhotos || (!wantAgreement && !wantWalkthrough && !wantEod && !wantWeekly && !wantCoi)) {
      let q = sb
        .from("job_documentation")
        .select(
          "id, booking_id, booking_ref, client_name, service_date, address, drive_folder_url, drive_pdf_url, photo_count, documented",
        )
        .order("service_date", { ascending: false })
        .limit(8);
      if (bookingId) q = q.eq("booking_id", bookingId);
      else if (terms[0]) {
        const t = ilikeContains(terms[0]);
        q = q.or(`client_name.ilike.${t},address.ilike.${t},booking_ref.ilike.${t}`);
      }
      const { data } = await q;
      for (const row of data || []) {
        const label = [row.client_name, row.service_date, row.address].filter(Boolean).join(" · ") || "Job documentation";
        if (row.drive_folder_url) {
          hits.push(
            asHit({
              title: `Job photos — ${label}`,
              url: String(row.drive_folder_url),
              kind: "folder",
              source: "job_documentation.drive_folder_url",
              contentsConfirmed: false,
            }),
          );
        }
        if (row.drive_pdf_url) {
          hits.push(
            asHit({
              title: `Dispute packet PDF — ${label}`,
              url: String(row.drive_pdf_url),
              kind: "pdf",
              source: "job_documentation.drive_pdf_url",
              contentsConfirmed: true,
              contentsNote: "This is the stored completion-summary / dispute-packet PDF for that job. Open it to read the contents.",
            }),
          );
        }
      }
    }
  } catch (err) {
    console.warn("[ops-assistant] job_documentation lookup failed", err);
  }

  if (wantWalkthrough || /\bwalkthrough pdf\b/i.test(args.message)) {
    try {
      let q = sb
        .from("commercial_walkthroughs")
        .select("id, site_address, conducted_on, scheduled_for, pdf_url, drive_folder_url")
        .order("conducted_on", { ascending: false, nullsFirst: false })
        .limit(6);
      if (terms[0]) {
        const t = ilikeContains(terms[0]);
        q = q.ilike("site_address", t);
      }
      const { data } = await q;
      for (const row of data || []) {
        const label = [row.site_address, row.conducted_on || row.scheduled_for].filter(Boolean).join(" · ") || "Walkthrough";
        if (row.drive_folder_url) {
          hits.push(
            asHit({
              title: `Walkthrough folder — ${label}`,
              url: String(row.drive_folder_url),
              kind: "folder",
              source: "commercial_walkthroughs.drive_folder_url",
              contentsConfirmed: false,
            }),
          );
        }
        if (row.pdf_url) {
          hits.push(
            asHit({
              title: `Walkthrough PDF — ${label}`,
              url: String(row.pdf_url),
              kind: "pdf",
              source: "commercial_walkthroughs.pdf_url",
              contentsConfirmed: true,
              contentsNote: "This is the stored walkthrough PDF. Open it to read the contents.",
            }),
          );
        }
      }
    } catch (err) {
      console.warn("[ops-assistant] walkthrough lookup failed", err);
    }
  }

  if (wantAgreement) {
    try {
      let q = sb
        .from("service_agreements")
        .select("id, customer_name, customer_email, signed_by, pdf_path, created_at, booking_id")
        .order("created_at", { ascending: false })
        .limit(5);
      if (bookingId) q = q.eq("booking_id", bookingId);
      else if (terms[0]) {
        const t = ilikeContains(terms[0]);
        q = q.or(`customer_name.ilike.${t},customer_email.ilike.${t},signed_by.ilike.${t}`);
      }
      const { data } = await q;
      for (const row of data || []) {
        const url = await signedStorageUrl(sb, "service-agreements", row.pdf_path);
        if (!url) continue;
        hits.push(
          asHit({
            title: `Signed service agreement — ${row.signed_by || row.customer_name || "customer"}`,
            url,
            kind: "pdf",
            source: "service_agreements.pdf_path (signed URL, 1h)",
            contentsConfirmed: true,
            contentsNote: "This is the stored signed service-agreement PDF. Open it to read the contents.",
          }),
        );
      }
    } catch (err) {
      console.warn("[ops-assistant] service_agreements lookup failed", err);
    }
  }

  // Admin-only sources — match workspace visibility, not just table RLS.
  if (args.role === "admin") {
    if (wantWeekly) {
      try {
        const { data } = await sb
          .from("weekly_reports")
          .select("period_start, period_end, drive_url")
          .not("drive_url", "is", null)
          .order("period_start", { ascending: false })
          .limit(3);
        for (const row of data || []) {
          hits.push(
            asHit({
              title: `Weekly report PDF — ${row.period_start} → ${row.period_end}`,
              url: String(row.drive_url),
              kind: "pdf",
              source: "weekly_reports.drive_url",
              contentsConfirmed: true,
              contentsNote: "This is the stored weekly-report PDF in Drive. Open it to read the contents.",
            }),
          );
        }
      } catch (err) {
        console.warn("[ops-assistant] weekly_reports drive lookup failed", err);
      }
    }

    if (wantEod) {
      try {
        const { data } = await sb
          .from("va_eod_submissions")
          .select("id, work_date, drive_url, va_id")
          .not("drive_url", "is", null)
          .order("work_date", { ascending: false })
          .limit(5);
        for (const row of data || []) {
          hits.push(
            asHit({
              title: `VA EOD PDF — ${row.work_date}`,
              url: String(row.drive_url),
              kind: "pdf",
              source: "va_eod_submissions.drive_url",
              contentsConfirmed: true,
              contentsNote: "This is the stored EOD PDF in Drive. Open it to read the contents.",
            }),
          );
        }
      } catch (err) {
        console.warn("[ops-assistant] va_eod_submissions drive lookup failed", err);
      }
    }

    if (wantAgreement || accountId) {
      try {
        let q = sb
          .from("commercial_agreements")
          .select("id, signed_by_name, status, document_path, business_account_id, signed_at")
          .eq("status", "signed")
          .order("signed_at", { ascending: false })
          .limit(5);
        if (accountId) q = q.eq("business_account_id", accountId);
        const { data } = await q;
        for (const row of data || []) {
          const url = await signedStorageUrl(sb, "commercial-agreements", row.document_path);
          if (!url) continue;
          hits.push(
            asHit({
              title: `Signed commercial agreement — ${row.signed_by_name || "signer"}`,
              url,
              kind: "pdf",
              source: "commercial_agreements.document_path (signed URL, 1h)",
              contentsConfirmed: true,
              contentsNote: "This is the stored executed commercial agreement. Open it to read the contents.",
            }),
          );
        }
      } catch (err) {
        console.warn("[ops-assistant] commercial_agreements lookup failed", err);
      }
    }

    if (wantCoi) {
      try {
        let q = sb
          .from("commercial_coi_documents")
          .select("id, document_path, expiration_date, business_account_id, lifecycle")
          .order("created_at", { ascending: false })
          .limit(5);
        if (accountId) q = q.eq("business_account_id", accountId);
        const { data } = await q;
        for (const row of data || []) {
          const url = await signedStorageUrl(sb, "coi-documents", row.document_path);
          if (!url) continue;
          hits.push(
            asHit({
              title: `COI document — expires ${row.expiration_date || "unknown"}`,
              url,
              kind: "pdf",
              source: "commercial_coi_documents.document_path (signed URL, 1h)",
              contentsConfirmed: true,
              contentsNote: "This is the stored certificate file. Open it to read the contents.",
            }),
          );
        }
      } catch (err) {
        console.warn("[ops-assistant] commercial_coi_documents lookup failed", err);
      }
    }
  }

  return hits.slice(0, 8);
}

export function driveActions(hits: DriveHit[]): NextAction[] {
  return hits.map((h) => ({
    label: h.title,
    href: h.url,
    kind: "drive",
  }));
}
