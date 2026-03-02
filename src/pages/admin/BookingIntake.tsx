import { Navigate } from "react-router-dom";
import { SEO } from "@/components/SEO";

export default function BookingIntake() {
  return (
    <>
      <SEO title="Booking Intake" noindex />
      <Navigate to="/admin/sales" replace />
    </>
  );
}
