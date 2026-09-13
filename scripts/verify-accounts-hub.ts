// ─── verify-accounts-hub ────────────────────────────────────────────────────
// The Accounts hub folds the old nine-tab bar into three tabs. Old ?tab=
// aliases have to keep working so bookmarks, emails, and the ops assistant
// do not 404 into a blank list.

import {
  accountsHubHref,
  resolveAccountsHubLocation,
} from "../src/lib/accounts-hub";

function commercialTab(tab: string, extra?: Record<string, string>): string {
  return accountsHubHref(resolveAccountsHubLocation(tab, extra), extra);
}

function check(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    console.error(`FAIL ${label}\n  got  ${g}\n  want ${w}`);
    process.exitCode = 1;
    return;
  }
  console.log(`ok   ${label}`);
}

check("default is the account list", resolveAccountsHubLocation(null), {
  tab: "accounts",
  panel: "list",
  kind: null,
  create: false,
});

check("jobs stays a tab", resolveAccountsHubLocation("jobs"), {
  tab: "jobs",
  panel: "list",
  kind: null,
  create: false,
});

check("book becomes jobs + create", resolveAccountsHubLocation("book"), {
  tab: "jobs",
  panel: "list",
  kind: null,
  create: true,
});

check("compliance becomes an Accounts panel", resolveAccountsHubLocation("compliance"), {
  tab: "accounts",
  panel: "compliance",
  kind: null,
  create: false,
});

check("str becomes the STR type filter", resolveAccountsHubLocation("str"), {
  tab: "accounts",
  panel: "list",
  kind: "str",
  create: false,
});

check("portfolio becomes the portfolio type filter", resolveAccountsHubLocation("portfolio"), {
  tab: "accounts",
  panel: "list",
  kind: "portfolio",
  create: false,
});

check("checklists and comms stay on Accounts", resolveAccountsHubLocation("comms"), {
  tab: "accounts",
  panel: "comms",
  kind: null,
  create: false,
});

check("commercialTab(str) writes the new query", commercialTab("str"), "/admin/accounts?tab=accounts&kind=str");
check("commercialTab(book) writes create=1", commercialTab("book"), "/admin/accounts?tab=jobs&create=1");
check("commercialTab(compliance) writes the panel", commercialTab("compliance"), "/admin/accounts?tab=accounts&panel=compliance");
check("href omits list/empty flags", accountsHubHref({ tab: "accounts", panel: "list", kind: null, create: false }), "/admin/accounts?tab=accounts");

if (process.exitCode) {
  console.error("\naccounts hub aliases drifted");
  process.exit(1);
}
console.log("\naccounts hub aliases ok");
