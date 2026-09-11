import { Suspense } from "react";
import QcStatementForm from "@/views/cleaner/QcStatementForm";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense>
      <QcStatementForm />
    </Suspense>
  );
}
