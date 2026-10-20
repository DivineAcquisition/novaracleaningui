import type { Metadata } from "next";
import WelcomeOfferPage from "@/views/customer/WelcomeOffer";

export const metadata: Metadata = {
  title: "Your Glow membership offer | Novara Cleaning",
  robots: { index: false, follow: false },
};

export default function Page({ params }: { params: { token: string } }) {
  return <WelcomeOfferPage token={params.token} />;
}

export const dynamic = "force-dynamic";
