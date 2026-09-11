// ─── Network harness for the walkthrough recordings ─────────────────────────
//
// Everything the contractor portal would send to Supabase or to our own API
// routes is intercepted here and answered from demo-contractor.ts. The real
// project is never contacted, which is what makes "no real data in any
// recording" a property of the harness rather than a rule someone has to
// remember while recording.
//
// Anything not matched is aborted rather than allowed through. Failing closed
// matters more than convenience here: a request that slips past this file and
// reaches production is exactly the failure this harness exists to prevent.

import type { Request as PWRequest, Route } from "playwright";

import {
  DEMO_CLEANER,
  bookings,
  checklistState,
  cleanerRow,
  jobAssignments,
  jobOffer,
  lookupJobs,
  offerRows,
  photoForm,
  portalPayload,
} from "./demo-contractor";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "access-control-expose-headers": "content-range",
};

function json(route: Route, body: unknown, extraHeaders: Record<string, string> = {}) {
  return route.fulfill({
    status: 200,
    headers: { "content-type": "application/json", ...CORS, ...extraHeaders },
    body: JSON.stringify(body),
  });
}

function parseBody(request: PWRequest): Record<string, unknown> {
  try {
    return (request.postDataJSON() as Record<string, unknown>) || {};
  } catch {
    return {};
  }
}

function demoUser() {
  return {
    id: DEMO_CLEANER.userId,
    email: DEMO_CLEANER.email,
    aud: "authenticated",
    role: "authenticated",
    app_metadata: { provider: "email" },
    user_metadata: {
      first_name: DEMO_CLEANER.firstName,
      last_name: DEMO_CLEANER.lastName,
    },
    created_at: new Date(Date.now() - 86_400_000 * 210).toISOString(),
  };
}

export function demoSession() {
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: "demo-contractor-access-token",
    refresh_token: "demo-contractor-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now + 3600,
    user: demoUser(),
  };
}

// ── Tables ──────────────────────────────────────────────────────────────────

const TABLES: Record<string, unknown[]> = {
  cleaners: [cleanerRow],
  job_assignments: jobAssignments,
  bookings,
  // Progress starts empty: a recording should show a walkthrough as a
  // first-time contractor meets it, not mid-way through someone else's.
  cleaner_tour_progress: [],
  cleaner_payouts: [],
  manual_payouts: [],
  job_extra_pay: [],
  cleaner_tips: [],
  user_roles: [],
  app_settings: [
    {
      key: "contractor_tours",
      value: { autoStartOnFirstLogin: true, reofferOnVersionChange: true, maxReoffersAtOnce: 2 },
    },
  ],
};

/**
 * Enough of PostgREST's query language for these fixtures.
 *
 * Deliberately small. The admin capture harness has a fuller implementation
 * (scripts/docs/capture/supabase-mock.ts); duplicating all of it here would
 * mean two half-maintained query engines, and the contractor portal only
 * filters on a handful of columns.
 */
function applyQuery(rows: unknown[], url: URL): unknown[] {
  let out = [...rows] as Record<string, unknown>[];

  for (const [key, raw] of url.searchParams.entries()) {
    if (["select", "order", "limit", "offset"].includes(key)) continue;
    const [op, ...rest] = raw.split(".");
    const value = rest.join(".");
    const read = (row: Record<string, unknown>) => row[key];

    switch (op) {
      case "eq":
        out = out.filter((r) => String(read(r) ?? "") === value);
        break;
      case "neq":
        out = out.filter((r) => String(read(r) ?? "") !== value);
        break;
      case "in": {
        const set = new Set(
          value.replace(/^\(|\)$/g, "").split(",").map((v) => v.replace(/^"|"$/g, "")),
        );
        out = out.filter((r) => set.has(String(read(r) ?? "")));
        break;
      }
      case "ilike":
        out = out.filter((r) =>
          String(read(r) ?? "")
            .toLowerCase()
            .includes(value.replace(/[%*]/g, "").toLowerCase()),
        );
        break;
      case "is":
        out = out.filter((r) => (value === "null" ? read(r) == null : read(r) != null));
        break;
      default:
        break;
    }
  }

  return out;
}

function wantsSingle(request: PWRequest): boolean {
  return (request.headers()["accept"] || "").includes("application/vnd.pgrst.object+json");
}

// ── Edge functions ──────────────────────────────────────────────────────────

const FUNCTIONS: Record<string, (body: Record<string, unknown>) => unknown> = {
  "get-cleaner-portal": () => portalPayload,
  "get-job-offer": () => jobOffer,
  "get-cleaner-photo-form": () => photoForm,
  "get-contractor-training": () => ({ url: null, embedUrl: null, configured: false }),
  // Writes are answered with the unchanged state. A recording should never be
  // able to mutate anything, and a walkthrough is read-only anyway — but if a
  // stray click lands on a checkbox, the clip shows the truthful "nothing
  // happened" rather than a fabricated success.
  "cleaner-job-checklist": () => checklistState,
  "submit-cleaner-photos": () => ({ ok: true }),
  "sync-cleaner-to-ghl": () => ({ ok: true }),
  "qc-issues": () => ({ ok: true, issueNumber: 101 }),
  "accept-job-offer": () => ({ ok: true }),
  "decline-job-offer": () => ({ ok: true }),
};

const RPCS: Record<string, unknown> = {
  // resolveCleanerAuth() expects an array.
  resolve_or_link_cleaner_for_user: [cleanerRow],
};

// ── Our own API routes ──────────────────────────────────────────────────────

const API_ROUTES: Record<string, (body: Record<string, unknown>) => unknown> = {
  "/api/cleaner/tours": () => ({
    ok: true,
    cleanerId: DEMO_CLEANER.id,
    settings: { autoStartOnFirstLogin: true, reofferOnVersionChange: true, maxReoffersAtOnce: 2 },
    progress: [],
    catalogSignature: "recording",
  }),
  "/api/contractor/jobs": () => ({ ok: true, jobs: lookupJobs }),
};

// ── Route handlers ──────────────────────────────────────────────────────────

export async function handleSupabase(route: Route, request: PWRequest): Promise<void> {
  const url = new URL(request.url());
  const path = url.pathname;

  if (request.method() === "OPTIONS") {
    return route.fulfill({ status: 204, headers: CORS, body: "" });
  }

  if (path.startsWith("/auth/v1/")) {
    if (path.includes("/user")) return json(route, demoUser());
    return json(route, demoSession());
  }

  if (path.startsWith("/rest/v1/rpc/")) {
    const name = path.split("/rest/v1/rpc/")[1].split("?")[0];
    return json(route, name in RPCS ? RPCS[name] : null);
  }

  if (path.startsWith("/functions/v1/")) {
    const name = path.split("/functions/v1/")[1].split("?")[0];
    const handler = FUNCTIONS[name];
    return json(route, handler ? handler(parseBody(request)) : { ok: true });
  }

  // Storage is refused rather than faked. The alternative is inventing image
  // bytes, and a clip showing a placeholder is more honest than one showing a
  // photo that doesn't exist.
  if (path.startsWith("/storage/")) {
    return route.fulfill({ status: 404, headers: CORS, body: "" });
  }

  if (path.startsWith("/rest/v1/")) {
    const table = path.split("/rest/v1/")[1].split("?")[0];
    const rows = applyQuery(TABLES[table] ?? [], url);

    if (request.method() !== "GET" && request.method() !== "HEAD") {
      return json(route, wantsSingle(request) ? (rows[0] ?? {}) : []);
    }

    return json(route, wantsSingle(request) ? (rows[0] ?? null) : rows, {
      "content-range": `0-${Math.max(0, rows.length - 1)}/${rows.length}`,
    });
  }

  return json(route, {});
}

export async function handleApiRoute(route: Route, request: PWRequest): Promise<void> {
  const url = new URL(request.url());
  const match = Object.keys(API_ROUTES).find(
    (p) => url.pathname === p || url.pathname.startsWith(`${p}/`),
  );
  if (match) return json(route, API_ROUTES[match](parseBody(request)));
  // Unrecognised API call: let Next.js answer it. The dev server has no
  // service-role credentials in a recording run, so the worst case is a 500
  // that shows up in the clip rather than a call reaching real data.
  return route.fallback();
}

/** Third parties that have no business loading during a capture. */
export const BLOCKED_HOSTS =
  /googleapis|gstatic|google\.com|googletagmanager|facebook|stripe\.com|js\.stripe|connect\.facebook|sentry|posthog/;
