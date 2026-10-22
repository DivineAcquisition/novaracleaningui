// The contractor directory keeps ended engagements out of the main list.
// A terminated contractor appears only in the termination view.

export interface DirectoryCleaner {
  status?: string | null;
  engagement_end_action?: string | null;
  termination_basis?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  home_zip?: string | null;
  state?: string | null;
  pay_tier?: string | null;
}

const TERMINATION_END_FILTERS = new Set(["terminated", "no_cause", "for_cause", "job_abandonment"]);

export function isTerminatedCleaner(row: Pick<DirectoryCleaner, "status" | "engagement_end_action">): boolean {
  const status = String(row.status || "").toLowerCase();
  const action = String(row.engagement_end_action || "").toLowerCase();
  return status === "terminated" || action === "terminated";
}

/** True when the directory is showing the termination list and nothing else. */
export function terminationOnlyView(statusFilter: string, endFilter: string): boolean {
  return statusFilter === "terminated" || TERMINATION_END_FILTERS.has(endFilter);
}

export function cleanerMatchesDirectory<T extends DirectoryCleaner>(
  row: T,
  filters: { statusFilter: string; endFilter: string; search: string },
): boolean {
  const terminated = isTerminatedCleaner(row);
  const terminationView = terminationOnlyView(filters.statusFilter, filters.endFilter);
  if (terminationView) {
    if (!terminated) return false;
  } else if (terminated) {
    return false;
  }

  const status = String(row.status || "pending").toLowerCase();
  if (
    filters.statusFilter !== "all" &&
    filters.statusFilter !== "terminated" &&
    status !== filters.statusFilter
  ) {
    return false;
  }

  const action = String(row.engagement_end_action || "");
  if (filters.endFilter === "terminated" || filters.endFilter === "resigned") {
    if (action !== filters.endFilter) return false;
  } else if (filters.endFilter !== "all" && String(row.termination_basis || "") !== filters.endFilter) {
    return false;
  }

  const q = filters.search.trim().toLowerCase();
  if (!q) return true;
  const blob = [row.first_name, row.last_name, row.email, row.phone, row.home_zip, row.state, row.pay_tier]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return blob.includes(q);
}
