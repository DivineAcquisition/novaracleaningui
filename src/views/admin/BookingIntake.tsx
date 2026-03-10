"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { SEO } from "@/components/SEO";

export default function BookingIntake() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/admin/sales");
  }, [router]);

  return (
    <>
      <SEO title="Booking Intake" noindex />
    </>
  );
}
