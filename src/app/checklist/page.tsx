import { Suspense } from "react";
import ChecklistIndex from "@/views/ChecklistIndex";

export const metadata = {
  title: "Cleaning Service Checklists | Novara Cleaning",
  description:
    "See exactly what's included in every Novara Cleaning service — Standard, Deep, Move In/Out, and Recurring checklists.",
};

export default function Page() {
  return (
    <Suspense>
      <ChecklistIndex />
    </Suspense>
  );
}
