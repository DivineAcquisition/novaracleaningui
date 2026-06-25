import { Suspense } from "react";
import PhotoGalleryPage from "@/views/PhotoGallery";

export default function Page() {
  return (
    <Suspense>
      <PhotoGalleryPage />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";
