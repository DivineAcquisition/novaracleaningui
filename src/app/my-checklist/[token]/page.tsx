import type { Metadata } from "next";
import MyChecklistPage from "@/views/customer/MyChecklist";

export const metadata: Metadata = {
  title: "Your cleaning checklist | Novara Cleaning",
  robots: { index: false, follow: false },
};

export default function Page({ params }: { params: { token: string } }) {
  return <MyChecklistPage token={params.token} />;
}

export const dynamic = "force-dynamic";
