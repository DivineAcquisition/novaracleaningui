// ─── Accounts hub URLs ─────────────────────────────────────────────────────
//
// Pure query-string helpers. Kept off commercial-proposal.ts so scripts can
// check aliases without loading DocuSeal / Supabase.

export const ACCOUNTS_HUB_PATH = "/admin/accounts";

export type AccountsHubTab = "accounts" | "jobs" | "recurring";
export type AccountsHubPanel = "list" | "compliance" | "turnovers" | "checklists" | "comms";

export interface AccountsHubLocation {
  tab: AccountsHubTab;
  panel: AccountsHubPanel;
  kind: string | null;
  create: boolean;
}

/**
 * Fold the old nine-tab hub into three tabs. STR, portfolio, certificates,
 * checklists, and comms live on Accounts (type filter or panel). Book is
 * Jobs with the create form open. Old ?tab= aliases keep working.
 */
export function resolveAccountsHubLocation(
  rawTab: string | null | undefined,
  extras?: Record<string, string | undefined>,
): AccountsHubLocation {
  const extraKind = extras?.kind || extras?.type || null;
  const extraPanel = extras?.panel as AccountsHubPanel | undefined;
  const extraCreate = extras?.create === "1" || extras?.create === "true";
  const panelOr = (fallback: AccountsHubPanel): AccountsHubPanel =>
    extraPanel && extraPanel !== "list" ? extraPanel : fallback;

  switch (rawTab) {
    case "jobs":
      return { tab: "jobs", panel: "list", kind: extraKind, create: extraCreate };
    case "book":
      return { tab: "jobs", panel: "list", kind: extraKind, create: true };
    case "recurring":
      return { tab: "recurring", panel: "list", kind: extraKind, create: false };
    case "compliance":
      return { tab: "accounts", panel: panelOr("compliance"), kind: extraKind, create: false };
    case "turnovers":
      return { tab: "accounts", panel: "turnovers", kind: extraKind, create: false };
    case "str":
    case "ops":
      return { tab: "accounts", panel: extraPanel && extraPanel !== "list" ? extraPanel : "list", kind: extraKind || "str", create: false };
    case "portfolio":
      return { tab: "accounts", panel: extraPanel && extraPanel !== "list" ? extraPanel : "list", kind: extraKind || "portfolio", create: false };
    case "checklists":
      return { tab: "accounts", panel: "checklists", kind: extraKind, create: false };
    case "comms":
      return { tab: "accounts", panel: "comms", kind: extraKind, create: false };
    default:
      return { tab: "accounts", panel: extraPanel || "list", kind: extraKind, create: extraCreate };
  }
}

export function accountsHubHref(loc: AccountsHubLocation, extra?: Record<string, string>): string {
  const params = new URLSearchParams();
  params.set("tab", loc.tab);
  if (loc.panel !== "list") params.set("panel", loc.panel);
  if (loc.kind) params.set("kind", loc.kind);
  if (loc.create) params.set("create", "1");
  for (const [k, v] of Object.entries(extra || {})) {
    if (k === "tab" || k === "panel" || k === "kind" || k === "type" || k === "create") continue;
    if (v) params.set(k, v);
  }
  const qs = params.toString();
  return qs ? `${ACCOUNTS_HUB_PATH}?${qs}` : ACCOUNTS_HUB_PATH;
}
