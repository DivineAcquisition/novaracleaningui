import { CustomerPolicyPage, customerPolicyMetadata } from "@/components/legal/CustomerPolicyPage";

export const metadata = customerPolicyMetadata("refund-policy");

export default function Page() {
  return <CustomerPolicyPage slug="refund-policy" />;
}
