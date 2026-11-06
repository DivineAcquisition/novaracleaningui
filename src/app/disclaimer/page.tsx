import { CustomerPolicyPage, customerPolicyMetadata } from "@/components/legal/CustomerPolicyPage";

export const metadata = customerPolicyMetadata("disclaimer");

export default function Page() {
  return <CustomerPolicyPage slug="disclaimer" />;
}
