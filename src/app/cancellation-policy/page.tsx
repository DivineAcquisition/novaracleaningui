import { CustomerPolicyPage, customerPolicyMetadata } from "@/components/legal/CustomerPolicyPage";

export const metadata = customerPolicyMetadata("cancellation-policy");

export default function Page() {
  return <CustomerPolicyPage slug="cancellation-policy" />;
}
