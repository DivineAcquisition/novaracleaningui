// In-memory compliance store. The API uses this when Supabase is not
// configured, and the verify script uses it directly. Acceptance rows are
// insert-only. Wording bodies are insert-only; status may move to reviewed.

import {
  appendDataRequestLog,
  type AcceptanceRecord,
  type ComplianceSettings,
  type CookieChoice,
  type DataRequest,
  DEFAULT_SETTINGS,
} from "./engine";
import { SEEDED_WORDING, type WordingStatus, type WordingVersion } from "./wording";

export interface SmsSuppression {
  phoneDigits: string;
  suppressedAt: string;
  source: string;
  liftedAt: string | null;
}

export interface AccessView {
  id: string;
  bookingId: string | null;
  viewerRole: string;
  viewerId: string | null;
  viewedAt: string;
  purpose: string;
}

export interface SignedCopy {
  id: string;
  email: string;
  subject: string;
  body: string;
  storedAt: string;
  bookingId: string | null;
}

export interface ComplianceStore {
  listWording(): WordingVersion[];
  publishWording(input: { kind: WordingVersion["kind"]; title: string; body: string; status: WordingStatus; actor: string; now: string }): WordingVersion;
  setWordingStatus(id: string, status: WordingStatus): WordingVersion;
  addAcceptance(row: AcceptanceRecord): AcceptanceRecord;
  listAcceptances(filter?: { bookingId?: string; email?: string }): AcceptanceRecord[];
  addCookie(choice: CookieChoice): CookieChoice;
  listCookies(): CookieChoice[];
  addDataRequest(request: DataRequest): DataRequest;
  updateDataRequest(id: string, entry: { at: string; action: string; note: string; status?: DataRequest["status"]; retainedBecause?: string | null }): DataRequest;
  listDataRequests(): DataRequest[];
  getSettings(): ComplianceSettings;
  saveSettings(next: ComplianceSettings): ComplianceSettings;
  suppressSms(phoneDigits: string, at: string, source: string): SmsSuppression;
  liftSms(phoneDigits: string, at: string): void;
  isSmsSuppressed(phoneDigits: string): boolean;
  logAccessView(entry: AccessView): AccessView;
  listAccessViews(bookingId?: string): AccessView[];
  addSignedCopy(copy: SignedCopy): SignedCopy;
}

export function createMemoryStore(): ComplianceStore {
  const wording: WordingVersion[] = SEEDED_WORDING.map((row) => ({ ...row }));
  const acceptances: AcceptanceRecord[] = [];
  const cookies: CookieChoice[] = [];
  const requests: DataRequest[] = [];
  const views: AccessView[] = [];
  const copies: SignedCopy[] = [];
  const sms = new Map<string, SmsSuppression>();
  let settings: ComplianceSettings = structuredClone(DEFAULT_SETTINGS);

  return {
    listWording: () => wording.map((row) => ({ ...row })),
    publishWording(input) {
      const version = wording.filter((row) => row.kind === input.kind).reduce((max, row) => Math.max(max, row.version), 0) + 1;
      const row: WordingVersion = {
        id: `${input.kind}-v${version}`,
        kind: input.kind,
        version,
        status: input.status,
        title: input.title,
        body: input.body,
        createdAt: input.now,
        createdBy: input.actor,
      };
      wording.push(row);
      return { ...row };
    },
    setWordingStatus(id, status) {
      const row = wording.find((item) => item.id === id);
      if (!row) throw new Error("Wording version not found.");
      row.status = status;
      return { ...row };
    },
    addAcceptance(row) {
      if (acceptances.some((item) => item.id === row.id)) {
        throw new Error("Acceptance records cannot be edited.");
      }
      const stored = { ...row };
      acceptances.push(stored);
      return { ...stored };
    },
    listAcceptances(filter) {
      return acceptances
        .filter((row) => {
          if (filter?.bookingId && row.bookingId !== filter.bookingId) return false;
          if (filter?.email && row.email?.toLowerCase() !== filter.email.toLowerCase()) return false;
          return true;
        })
        .map((row) => ({ ...row }));
    },
    addCookie(choice) {
      cookies.push({ ...choice });
      return { ...choice };
    },
    listCookies: () => cookies.map((row) => ({ ...row })),
    addDataRequest(request) {
      requests.push(request);
      return request;
    },
    updateDataRequest(id, entry) {
      const index = requests.findIndex((row) => row.id === id);
      if (index < 0) throw new Error("Data request not found.");
      requests[index] = appendDataRequestLog(requests[index], entry);
      return requests[index];
    },
    listDataRequests: () => requests.map((row) => ({ ...row, log: [...row.log] })),
    getSettings: () => structuredClone(settings),
    saveSettings(next) {
      settings = structuredClone(next);
      return structuredClone(settings);
    },
    suppressSms(phoneDigits, at, source) {
      const row: SmsSuppression = { phoneDigits, suppressedAt: at, source, liftedAt: null };
      sms.set(phoneDigits, row);
      return { ...row };
    },
    liftSms(phoneDigits, at) {
      const row = sms.get(phoneDigits);
      if (row) row.liftedAt = at;
    },
    isSmsSuppressed(phoneDigits) {
      const row = sms.get(phoneDigits);
      return Boolean(row && !row.liftedAt);
    },
    logAccessView(entry) {
      views.push({ ...entry });
      return { ...entry };
    },
    listAccessViews(bookingId) {
      return views.filter((row) => !bookingId || row.bookingId === bookingId).map((row) => ({ ...row }));
    },
    addSignedCopy(copy) {
      copies.push({ ...copy });
      return { ...copy };
    },
  };
}

const GLOBAL_KEY = "__novaraComplianceStore";

export function getProcessStore(): ComplianceStore {
  const holder = globalThis as typeof globalThis & { [GLOBAL_KEY]?: ComplianceStore };
  if (!holder[GLOBAL_KEY]) holder[GLOBAL_KEY] = createMemoryStore();
  return holder[GLOBAL_KEY];
}
