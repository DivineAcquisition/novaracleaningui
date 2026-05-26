"use client";

// Mounts the existing Profile view at /cleaner/profile so the cleaner
// portal's bottom-nav "Profile" link stops 404-ing. Profile.tsx already
// handles its own auth gate via useAuth — no ProtectedRoute wrapper
// needed (cleaners don't have a user_roles row).

import Profile from "@/views/cleaner/Profile";

export default function Page() {
  return <Profile />;
}

export const dynamic = "force-dynamic";
