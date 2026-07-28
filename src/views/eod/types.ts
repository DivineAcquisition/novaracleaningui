// Shapes returned by /api/va/eod, mirrored for the browser.

import type { MetricProvenance, MetricValues, SourceStatusMap } from "@/lib/va-performance/metrics";

export interface EodSubmissionView {
  id: string;
  vaId: string;
  workDate: string;
  status: "draft" | "submitted" | "reviewed" | "flagged";
  /** Entered metrics keyed by metric field key. Money is in cents. */
  metrics: Record<string, number>;
  /** The four single-select answers. */
  selects: Record<string, string>;
  blockers: string | null;
  escalations: string | null;
  cleanerIssueNotes: string | null;
  priorities: string | null;
  wins: string | null;
  submittedAt: string | null;
  submittedLate: boolean;
  lockedAt: string | null;
  pdfStatus: string;
  pdfPath: string | null;
  driveUrl: string | null;
  updatedAt: string;
}

export interface VerifiedView {
  vaId: string;
  workDate: string;
  values: MetricValues;
  provenance: MetricProvenance;
  sourceStatus: SourceStatusMap;
  lastSyncedAt: string | null;
}

export interface FlagSummary {
  id: string;
  metricKey: string;
  metricLabel: string | null;
  selfReported: number | null;
  verified: number | null;
  variance: number | null;
  variancePct: number | null;
  severity: string;
  status: string;
  vaExplanation: string | null;
  reviewNote: string | null;
  workDate: string;
  createdAt: string;
}

export interface BootstrapPayload {
  va: { id: string; name: string; email: string; functionsAssigned: string[] };
  workDate: string;
  allowedDates: string[];
  settings: {
    timezone: string;
    backdateDays: number;
    cutoffLocalTime: string;
    lockAfterHours: number;
    linkTtlHours: number;
  };
  submission: EodSubmissionView;
  verified: VerifiedView;
  locked: boolean;
  flags: FlagSummary[];
  /** Present when opened through a per-day link. */
  link?: { workDate: string; expiresAt: string } | null;
}
