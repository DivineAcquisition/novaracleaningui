import TestimonialSubmitPage from "@/views/testimonial/Submit";

export default function Page({ params }: { params: { token: string } }) {
  return <TestimonialSubmitPage token={params.token} />;
}

export const dynamic = "force-dynamic";
