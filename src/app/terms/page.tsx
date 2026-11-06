import { CustomerPolicyPage, customerPolicyMetadata } from "@/components/legal/CustomerPolicyPage";

export const metadata = customerPolicyMetadata("terms");

export default function Page() {
  return <CustomerPolicyPage slug="terms" />;
}
