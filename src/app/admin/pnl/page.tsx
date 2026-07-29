import { redirect } from "next/navigation";

// P&L Data is retired. The only part of it anyone was using day to day —
// logging an expense or reimbursement — now lives in Payroll, next to the rest
// of the money. Ad spend and EOD entry are gone from the app; the underlying
// tables and the Google Sheet mirror are untouched, so nothing that was already
// captured is lost and the sheet remains the reporting surface.
export default function Page() {
  redirect("/admin/payroll");
}

export const dynamic = "force-dynamic";
