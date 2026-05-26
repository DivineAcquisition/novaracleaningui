"use client";

// Mounts the JobOffersList view at /cleaner/job-offers. Auth is handled
// inline by the view via resolveCleanerAuth() — cleaners don't have a
// user_roles row, so ProtectedRoute wouldn't help here.

import JobOffersList from "@/views/cleaner/JobOffersList";

export default function Page() {
  return <JobOffersList />;
}

export const dynamic = "force-dynamic";
