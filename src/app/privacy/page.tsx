import { CustomerPolicyPage, customerPolicyMetadata } from "@/components/legal/CustomerPolicyPage";

export const metadata = customerPolicyMetadata("privacy");

export default function Page() {
  return <CustomerPolicyPage slug="privacy" />;
}
