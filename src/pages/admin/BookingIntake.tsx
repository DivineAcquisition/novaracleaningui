import { Navigate, useSearchParams } from "react-router-dom";

export default function BookingIntake() {
  const [searchParams] = useSearchParams();
  const existing = searchParams.toString();
  const target = existing ? `/admin/sales?tab=intake&${existing}` : "/admin/sales?tab=intake";
  return <Navigate to={target} replace />;
}
