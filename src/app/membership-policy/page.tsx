import { CustomerPolicyPage, customerPolicyMetadata } from "@/components/legal/CustomerPolicyPage";

export const metadata = customerPolicyMetadata("membership-policy");

export default function Page() {
  return <CustomerPolicyPage slug="membership-policy" />;
}
