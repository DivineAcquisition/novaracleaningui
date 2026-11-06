import { redirect } from "next/navigation";

// The old "Book Your Cleaning Today" page is gone. Every booking starts at the
// ZIP form on the landing page, so this path forwards there with its query
// string (zip, ref, membership, homeSize, welcome, utm_*, fbclid) intact.
export default function Page({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (typeof v === "string") params.set(k, v);
    else if (Array.isArray(v) && v[0]) params.set(k, v[0]);
  }
  const q = params.toString();
  redirect(q ? `/?${q}` : "/");
}

export const dynamic = "force-dynamic";
