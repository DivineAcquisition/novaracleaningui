"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

export default function UrgentHireReturnLink() {
  const params = useSearchParams();
  const token = params?.get("uh")?.trim() || "";
  if (!token) return null;
  return (
    <p className="text-center text-xs">
      <Link
        href={`/cleaner/urgent-hire/${encodeURIComponent(token)}`}
        className="font-semibold text-violet-700 hover:underline"
      >
        Back to Urgent Hire offer
      </Link>
    </p>
  );
}
