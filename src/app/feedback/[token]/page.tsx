import { Suspense } from "react";
import JobFeedbackPage from "@/views/feedback/JobFeedback";

export default function Page({ params }: { params: { token: string } }) {
  return (
    <Suspense>
      <JobFeedbackPage token={params.token} />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";
