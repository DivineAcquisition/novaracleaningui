// Shapes returned by /api/va/eod, mirrored for the browser.

import type { MetricProvenance, MetricValues, SourceStatusMap } from "@/lib/va-performance/metrics";

export interface EodSubmissionView {
  id: string;
  vaId: string;
  workDate: string;
  status: "draft" | "submitted" | "reviewed" | "flagged";
  tasksSelected: string[];
  selfReported: Record<string, number>;
  taskNotes: Record<string, string | string[]>;
  blockers: string | null;
  priorities: string | null;
  wins: string | null;
  escalations: string | null;
  submittedAt: string | null;
  submittedLate: boolean;
  lockedAt: string | null;
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
  };
  submission: EodSubmissionView;
  verified: VerifiedView;
  locked: boolean;
  flags: FlagSummary[];
}
