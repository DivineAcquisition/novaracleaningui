import { Suspense } from "react";
import ValueStackPage from "@/views/ValueStack";

export const metadata = {
  title: "What's Included — Value Stack | Novara Cleaning",
  description:
    "See everything included with every Novara clean — photo proof, loyalty credit, your customer dashboard, and vetted pros.",
};

export default function Page() {
  return (
    <Suspense>
      <ValueStackPage />
    </Suspense>
  );
}
