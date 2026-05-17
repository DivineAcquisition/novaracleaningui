import GoogleCalendarStatus from "@/views/admin/GoogleCalendarStatus";
import { ProtectedRoute } from "@/components/ProtectedRoute";

export default function Page() {
  return (
    <ProtectedRoute requiredRole="admin">
      <GoogleCalendarStatus />
    </ProtectedRoute>
  );
}

export const dynamic = "force-dynamic";
