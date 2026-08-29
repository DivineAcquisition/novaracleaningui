import { Suspense } from "react";
import ChecklistIndex from "@/views/ChecklistIndex";

export const metadata = {
  title: "Cleaning Service Checklists | Novara Cleaning",
  description:
    "See exactly what's included in every Novara Cleaning service — home Standard, Deep, Move In/Out, and Recurring, plus commercial Light, Standard, Detailed, and office.",
};

export default function Page() {
  return (
    <Suspense>
      <ChecklistIndex />
    </Suspense>
  );
}
